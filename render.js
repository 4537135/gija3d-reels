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
// Math format: one full-screen silent animation (script.json: { format:'math', duration, code, colors }) with ambient audio.
const MATH = job.format === 'math';
if (MATH) job.scenes = [{ kind: 'math', title: '', say: '', code: job.code, engine: job.engine }];
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

// No voice in math reels: a soft generated pad (A major, slow shimmer, echo). Original audio, nothing to license.
// Set AMBIENT_AUDIO=<file> in .env to use your own track instead (looped / trimmed to length).
function ambient(out, D) {
  const fade = `afade=t=in:d=1.2,afade=t=out:st=${Math.max(0, D - 1.6).toFixed(2)}:d=1.6`;
  const own = process.env.AMBIENT_AUDIO;
  if (own && fs.existsSync(own)) return execFileSync(FFMPEG, ['-y', '-v', 'error', '-stream_loop', '-1', '-i', own, '-t', String(D), '-af', fade, '-ar', '44100', '-ac', '2', '-c:a', 'aac', '-b:a', '160k', out]);
  const v = (hz, amp, lfo, ph) => `${amp}*sin(2*PI*${hz}*t)*(0.6+0.4*sin(2*PI*${lfo}*t+${ph}))`;
  const L = [v(110, 0.20, 0.11, 0), v(164.81, 0.13, 0.17, 1), v(220, 0.11, 0.23, 2), v(277.18, 0.08, 0.13, 3), v(329.63, 0.06, 0.19, 4), v(554.37, 0.025, 0.29, 5)].join('+');
  const R = [v(110, 0.20, 0.11, 0.6), v(164.81, 0.13, 0.17, 1.9), v(220.4, 0.11, 0.23, 2.4), v(277.18, 0.08, 0.13, 3.7), v(330.1, 0.06, 0.19, 4.5), v(659.26, 0.02, 0.31, 5.5)].join('+');
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc=${L}|${R}:s=44100:d=${D}`,
    '-af', `aecho=0.8:0.6:180|370:0.35|0.22,lowpass=f=2200,${fade},volume=1.4`, '-c:a', 'aac', '-b:a', '160k', out]);
}

(async () => {
  // 1. Voice: one mp3 per scene so we know exact scene timing (no word timestamps needed).
  const parts = [];
  if (MATH) job.scenes[0].dur = Math.min(60, Math.max(4, Number(job.duration) || 12));
  for (const [i, s] of MATH ? [] : job.scenes.entries()) {
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
  if (MATH) ambient(voice, total);
  else execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', concat, '-ar', '44100', '-ac', '1', '-c:a', 'aac', '-b:a', '160k', voice]);

  // 2. Frames: template.html exposes seek(t); we screenshot every frame and pipe to ffmpeg.
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.goto(pathToFileURL(path.join(__dirname, 'template.html')).href);
  const scenes = job.scenes.map(s => ({ ...s, image: s.image ? pathToFileURL(path.resolve(dir, s.image)).href : null,
    art: s.art ? fs.readFileSync(path.resolve(dir, s.art), 'utf8') : null,
    code: s.code ? fs.readFileSync(path.resolve(dir, s.code), 'utf8') : null })); // code = canvas JS for math scenes
  const lib = fs.readFileSync(path.join(__dirname, 'plotlib.js'), 'utf8');
  const three = job.scenes.some(s => s.engine === 'three') ? require('./threelib').threeLib() : '';
  await page.evaluate(d => window.load(d), { scenes, brand: job.brand || {}, lib, three, math: MATH ? { colors: job.colors || {} } : null });
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
  for (const e of await page.evaluate(() => window.artErrors)) console.warn(`warning: scene ${e.scene} drawing code failed: ${e.error}`);
  ff.stdin.end();
  await new Promise((r, j) => ff.on('close', c => c ? j(new Error('ffmpeg ' + c)) : r()));
  await browser.close();
  console.log(`done: ${out} (${total.toFixed(1)}s, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`);
})().catch(e => { console.error(e.message); process.exit(1); });
