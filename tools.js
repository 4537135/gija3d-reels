// Paths to ffmpeg / ffprobe / yt-dlp. Env vars win, then the npm-bundled binaries, then PATH.
function pick(envName, mod, fallback) {
  if (process.env[envName]) return process.env[envName];
  try { const m = mod(); if (m) return m; } catch {}
  return fallback;
}
module.exports = {
  FFMPEG: pick('FFMPEG_PATH', () => require('ffmpeg-static'), 'ffmpeg'),
  FFPROBE: pick('FFPROBE_PATH', () => require('ffprobe-static').path, 'ffprobe'),
  YTDLP: pick('YTDLP_PATH', () => require('youtube-dl-exec/src/constants').YOUTUBE_DL_PATH, 'yt-dlp'),
};
