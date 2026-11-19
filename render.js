// Usage: node render.js jobs/<name>/script.json [--no-tts]
// Reads a scene script, voices each scene with Fish Audio, renders 1080x1920 frames
// with Playwright, muxes with ffmpeg -> jobs/<name>/reel.mp4
const fs = require('fs'), path = require('path'), { execFileSync, spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { FFMPEG, FFPROBE } = require('./tools');

const FPS = 30, W = 1080, H = 1920, GAP = 0.25; // GAP = silence between scenes (s)
const scriptPath = process.argv[2];
const noTts = process.argv.includes('--no-tts');
if (!scriptPath) { console.error('usage: node render.js jobs/<name>/script.json [--no-tts]'); process.exit(1); }
const dir = path.dirname(path.resolve(scriptPath));
const job = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
if (!Array.isArray(job.scenes) || !job.scenes.length) throw new Error('script.json needs scenes[]');

const fwd = p => p.replace(/\\/g, '/'); // ffmpeg concat lists want forward slashes on Windows
const dur = f => parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

async function tts(text, out) {
  // Key is injected by the session proxy for api.fish.audio; FISH_API_KEY is only needed when run locally.
  const res = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { 'api-key': process.env.FISH_API_KEY || 'proxy', 'Content-Type': 'application/json', model: process.env.FISH_MODEL || 's2.1-pro-free' },
    body: JSON.stringify({ text, reference_id: job.voice || undefined, format: 'mp3', normalize: true, latency: 'normal' }),
  });
  if (!res.ok) throw new Error(`Fish TTS ${res.status}: ${await res.text()}`);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
}

(async () => {
  // 1. Voice: one mp3 per scene so we know exact scene timing (no word timestamps needed).
  const parts = [];
  for (const [i, s] of job.scenes.entries()) {
    const f = path.join(dir, `vo_${i}.mp3`);
    if (noTts) execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(Math.max(1.5, s.say.split(/\s+/).length / 2.6)), f]);
    else {
      const raw = path.join(dir, `vo_${i}_raw.mp3`);
      if (!fs.existsSync(raw) || job.retts) await tts(s.say, raw);
      execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', raw, '-af', `atempo=${job.speed || 1.15}`, f]); // 15% faster by default
    }
    s.dur = dur(f) + GAP;
    parts.push(f);
  }
  const total = job.scenes.reduce((a, s) => a + s.dur, 0);
  const concat = path.join(dir, 'vo_list.txt'), gap = path.join(dir, 'gap.mp3');
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', String(GAP), gap]);
  fs.writeFileSync(concat, parts.map(p => `file '${fwd(p)}'\nfile '${fwd(gap)}'`).join('\n'));
  const voice = path.join(dir, 'voice.m4a');
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '160k', voice]);

  // 2. Frames: template.html exposes seek(t); we screenshot every frame and pipe to ffmpeg.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(pathToFileURL(path.join(__dirname, 'template.html')).href);
  const scenes = job.scenes.map(s => ({ ...s, image: s.image ? pathToFileURL(path.resolve(dir, s.image)).href : null,
    art: s.art ? fs.readFileSync(path.resolve(dir, s.art), 'utf8') : null }));
  await page.evaluate(d => window.load(d), { scenes, brand: job.brand || {} });
  await page.evaluate(() => document.fonts.ready);
  const fontsOk = await page.evaluate(() => document.fonts.check('800 40px Unbounded') && document.fonts.check('400 40px Manrope'));
  if (!fontsOk) throw new Error('Brand fonts did not load (check fonts.googleapis.com access)');

  const out = path.join(dir, 'reel.mp4');
  const ff = spawn(FFMPEG, ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-', '-i', voice,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  const n = Math.ceil(total * FPS);
  for (let f = 0; f < n; f++) {
    await page.evaluate(t => window.seek(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) process.stdout.write(`frame ${f}/${n}\n`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', c => c ? j(new Error('ffmpeg ' + c)) : r()));
  await browser.close();
  console.log(`done: ${out} (${total.toFixed(1)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
})().catch(e => { console.error(e.message); process.exit(1); });
