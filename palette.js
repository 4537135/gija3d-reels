// Dominant non-black colours of the reference video's frames, so a math reel can reuse its palette.
//   const { palette } = require('./palette'); palette(['frame_00.jpg', ...]) -> ['#1f9e8f', '#c8562e', ...]
const { execFileSync } = require('child_process');
const { FFMPEG } = require('./tools');

function palette(frames, max = 5) {
  const bins = new Map(); let total = 0;
  for (const f of frames) {
    let buf;
    try { buf = execFileSync(FFMPEG, ['-v', 'error', '-i', f, '-vf', 'scale=96:-2', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 }); } catch { continue; }
    for (let i = 0; i + 2 < buf.length; i += 3) {
      const r = buf[i], g = buf[i + 1], b = buf[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      total++;
      if (mx < 70 || mx - mn < 45) continue; // skip black/dark and greys/white: we want the accent colours
      const k = (r >> 4) << 8 | (g >> 4) << 4 | (b >> 4);
      const e = bins.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += r; e[2] += g; e[3] += b; bins.set(k, e);
    }
  }
  const cols = [...bins.values()].sort((a, b) => b[0] - a[0]).map(([n, r, g, b]) => ({ n, r: r / n, g: g / n, b: b / n }));
  const out = [];
  for (const c of cols) {
    if (c.n < total * 0.002) break;
    if (out.some(o => Math.hypot(o.r - c.r, o.g - c.g, o.b - c.b) < 70)) continue; // too close to one we have
    out.push(c); if (out.length >= max) break;
  }
  const hex = v => Math.round(v).toString(16).padStart(2, '0');
  return out.map(c => '#' + hex(c.r) + hex(c.g) + hex(c.b));
}
// Share of pixels that are near-black: tells us whether the reference uses a black background.
module.exports = { palette };
if (require.main === module) console.log(palette(process.argv.slice(2)));
