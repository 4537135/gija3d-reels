// The whole loop, no human in it:
//   paste a TikTok / Instagram link (or upload a video, or paste text) in #reels-inbox
//   -> ⏳ -> download -> transcribe (Fish) -> frames -> Claude rewrites script + animations
//   -> Fish TTS + render (render.js) -> reply with the reel + caption -> ✅   (❌ + reason on failure)
//
//   npm start            run forever, polling Discord every POLL_SECONDS (default 20)
//   npm run once         process whatever is waiting, then exit
//   node --env-file=.env bot.js --url <link>   make one reel from a link locally (no Discord)
const fs = require('fs'), path = require('path'), { execFileSync, spawn } = require('child_process');
const discord = require('./discord');
const { download } = require('./download');
const { transcribe } = require('./transcribe');
const { writeScript, MODEL } = require('./writer');
const { FFMPEG, FFPROBE } = require('./tools');
const { palette } = require('./palette');

const POLL = Number(process.env.POLL_SECONDS || 20) * 1000;
const OUT = path.join(__dirname, 'out');
const VIDEO_RE = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const dur = f => parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

function grabFrames(video, dir, n = 6) {
  const d = dur(video) || 10, frames = [];
  for (let i = 0; i < n; i++) {
    const t = (d * (i + 0.5)) / n, f = path.join(dir, `frame_${String(i).padStart(2, '0')}.jpg`);
    try {
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', video, '-frames:v', '1', '-vf', 'scale=540:-2', '-q:v', '4', f]);
      if (fs.existsSync(f)) frames.push(f);
    } catch {}
  }
  return frames;
}

function renderReel(scriptPath) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'render.js'), scriptPath], { stdio: 'inherit', env: process.env });
    p.on('close', c => c ? rej(new Error(`render.js exited with ${c}`)) : res(path.join(path.dirname(scriptPath), 'reel.mp4')));
  });
}

// Discord bots can only upload ~10 MB. Keep the full-quality reel for posting, send a squeezed copy if needed.
function fitForDiscord(file) {
  const limit = discord.MAX_UPLOAD_MB * 0.92 * 1e6;
  if (fs.statSync(file).size <= limit) return file;
  const small = file.replace(/\.mp4$/, '_discord.mp4');
  const kbps = Math.floor((limit * 8) / dur(file) / 1000) - 140;
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', file, '-c:v', 'libx264', '-preset', 'medium', '-b:v', `${kbps}k`, '-maxrate', `${kbps}k`,
    '-bufsize', `${kbps * 2}k`, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', small]);
  return small;
}

// One source (a link, an uploaded video, or pasted text) -> finished reel.
async function makeReel({ dir, url, video, text, note }) {
  fs.mkdirSync(dir, { recursive: true });
  let info = {}, transcript = '', frames = [];
  if (url) {
    log('  downloading', url);
    ({ file: video, info } = await download(url, dir));
  }
  if (video) {
    log('  transcribing');
    try { transcript = await transcribe(video); } catch (e) { log('  transcribe failed, continuing with frames only:', e.message); }
    frames = grabFrames(video, dir);
  } else transcript = text;

  log(`  writing script with ${MODEL}`);
  const { path: scriptPath, script } = await writeScript({ dir, transcript, info, frames, note, palette: palette(frames) });
  log('  rendering');
  const reel = await renderReel(scriptPath);

  fs.mkdirSync(OUT, { recursive: true });
  const slug = (script.title || script.scenes[0].title || 'reel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  const keep = path.join(OUT, `${new Date().toISOString().slice(0, 10)}_${path.basename(dir)}_${slug}.mp4`);
  fs.copyFileSync(reel, keep);
  fs.writeFileSync(keep.replace(/\.mp4$/, '.txt'), script.caption + '\n');
  return { reel, keep, script };
}

async function handle(m) {
  const id = m.id, base = path.join(__dirname, 'jobs', id);
  log(`job ${id}: ${JSON.stringify(m.content).slice(0, 120)}`);
  await discord.react(id, discord.E.busy).catch(() => {});
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, 'request.txt'), m.content);

  const urls = discord.linksIn(m.content);
  const note = m.content.replace(/https?:\/\/[^\s<>]+/g, '').trim();
  const uploads = (await discord.saveAttachments(m, base)).filter(f => VIDEO_RE.test(f));
  const sources = [...urls.map(url => ({ url })), ...uploads.map(video => ({ video }))];
  if (!sources.length) {
    if (note.length >= 40) sources.push({ text: note });
    else {
      await discord.reply(id, 'Paste a TikTok / Instagram link (or upload a video, or paste the tip as text) and I\'ll make a reel from it.', null, discord.E.fail);
      return discord.unreact(id, discord.E.busy);
    }
  }

  let failed = 0;
  for (const [i, src] of sources.entries()) {
    const dir = sources.length > 1 ? path.join(base, String(i + 1)) : base;
    const label = src.url || (src.video && path.basename(src.video)) || 'your text';
    try {
      const { reel, script } = await makeReel({ dir, ...src, note: src.text ? '' : note });
      const send = fitForDiscord(reel);
      await discord.reply(id, `${sources.length > 1 ? `**${i + 1}/${sources.length}**\n` : ''}${script.caption}`, send, null);
      log(`  done -> ${reel}`);
    } catch (e) {
      failed++;
      log(`  FAILED ${label}: ${e.stack || e.message}`);
      const hint = src.url && /instagram/i.test(src.url) && /login|cookie|rate|private|empty media/i.test(e.message)
        ? '\nInstagram blocked the logged-out download - set YTDLP_COOKIES or YTDLP_COOKIES_FROM_BROWSER (see README), or upload the video file.' : '';
      await discord.reply(id, `Could not make a reel from ${src.url ? `<${src.url}>` : label}: ${e.message.slice(0, 300)}${hint}`, null, null).catch(() => {});
    }
  }
  await discord.react(id, failed === sources.length ? discord.E.fail : discord.E.done).catch(() => {});
  await discord.unreact(id, discord.E.busy);
}

async function tick(first) {
  const todo = await discord.listNew({ retryBusy: first });
  for (const m of todo) await handle(m).catch(e => log(`job ${m.id} crashed: ${e.message}`));
  return todo.length;
}

async function main() {
  const args = process.argv.slice(2);
  for (const k of ['FISH_API_KEY']) if (!process.env[k]) console.warn(`warning: ${k} is not set (.env)`);

  const ui = args.indexOf('--url');
  if (ui >= 0) { // local test: one link -> out/, no Discord
    const url = args[ui + 1], dir = path.join(__dirname, 'jobs', 'local-' + Date.now());
    const { keep, script } = await makeReel({ dir, url, note: args.slice(ui + 2).join(' ') });
    return log(`done: ${keep}\n\n${script.caption}`);
  }
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not set (.env)');

  if (args.includes('--once')) return log(`processed ${await tick(true)} message(s)`);
  log(`bot running, model ${MODEL}, polling every ${POLL / 1000}s. Ctrl+C to stop.`);
  for (let first = true; ; first = false) {
    try { await tick(first); } catch (e) { log('poll error:', e.message); }
    await new Promise(r => setTimeout(r, POLL));
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
