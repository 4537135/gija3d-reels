// node transcribe.js <video-or-audio> -> prints transcript (Fish Audio ASR)
// Also usable as a module: const { transcribe } = require('./transcribe'); await transcribe(file)
const fs = require('fs'), { execFileSync } = require('child_process');
const { FFMPEG } = require('./tools');

async function transcribe(src) {
  const mp3 = src.replace(/\.\w+$/, '') + '_audio.mp3';
  execFileSync(FFMPEG, ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3]);
  const form = new FormData();
  form.append('audio', new Blob([fs.readFileSync(mp3)]), 'audio.mp3');
  form.append('ignore_timestamps', 'true');
  const r = await fetch('https://api.fish.audio/v1/asr', { method: 'POST', headers: { 'api-key': process.env.FISH_API_KEY || 'proxy' }, body: form });
  if (!r.ok) throw new Error(`Fish ASR ${r.status}: ${await r.text()}`);
  return ((await r.json()).text || '').trim();
}

module.exports = { transcribe };

if (require.main === module) {
  transcribe(process.argv[2]).then(t => console.log(t)).catch(e => { console.error(e.message); process.exit(1); });
}
