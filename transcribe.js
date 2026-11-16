// node transcribe.js <video-or-audio> -> prints transcript (Fish Audio ASR)
const fs = require('fs'), { execFileSync } = require('child_process');
const src = process.argv[2], mp3 = src.replace(/\.\w+$/, '') + '_audio.mp3';
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', mp3]);
const form = new FormData();
form.append('audio', new Blob([fs.readFileSync(mp3)]), 'audio.mp3');
form.append('ignore_timestamps', 'true');
fetch('https://api.fish.audio/v1/asr', { method: 'POST', headers: { 'api-key': process.env.FISH_API_KEY || 'proxy' }, body: form })
  .then(async r => { if (!r.ok) throw new Error(`Fish ASR ${r.status}: ${await r.text()}`); console.log((await r.json()).text); })
  .catch(e => { console.error(e.message); process.exit(1); });
