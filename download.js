// Download a TikTok / Instagram (or YouTube Shorts, etc.) video with yt-dlp.
//   node download.js <url> <dir>
// Instagram often blocks logged-out downloads. If that happens set ONE of:
//   YTDLP_COOKIES=C:\path\to\cookies.txt          (Netscape cookies.txt exported from a logged-in browser)
//   YTDLP_COOKIES_FROM_BROWSER=firefox            (yt-dlp reads cookies straight from that browser profile)
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const { YTDLP, FFMPEG } = require('./tools');

function run(bin, args, timeout) {
  return new Promise((res, rej) => execFile(bin, args, { timeout, maxBuffer: 1 << 24, windowsHide: true },
    (err, stdout, stderr) => err ? rej(new Error((stderr || err.message).toString().trim().split('\n').slice(-3).join(' | '))) : res(stdout)));
}

async function download(url, dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith('src_link')) fs.rmSync(path.join(dir, f));
  const args = [
    '--no-playlist', '--no-progress', '--no-warnings', '--restrict-filenames',
    '-f', 'bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b',
    '--merge-output-format', 'mp4', '--ffmpeg-location', FFMPEG,
    '--max-filesize', '400M', '--write-info-json',
    '-o', path.join(dir, 'src_link.%(ext)s'),
  ];
  if (process.env.YTDLP_COOKIES) args.push('--cookies', process.env.YTDLP_COOKIES);
  else if (process.env.YTDLP_COOKIES_FROM_BROWSER) args.push('--cookies-from-browser', process.env.YTDLP_COOKIES_FROM_BROWSER);
  args.push(url);
  await run(YTDLP, args, 5 * 60 * 1000);

  const files = fs.readdirSync(dir).filter(f => f.startsWith('src_link'));
  const video = files.find(f => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f));
  if (!video) throw new Error('yt-dlp finished but produced no video file (photo post or carousel?)');
  let info = {};
  const infoFile = files.find(f => f.endsWith('.info.json'));
  if (infoFile) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, infoFile), 'utf8'));
    info = { title: j.title, description: j.description, uploader: j.uploader || j.channel, duration: j.duration, platform: j.extractor_key, url: j.webpage_url || url };
  }
  return { file: path.join(dir, video), info };
}

module.exports = { download, run };

if (require.main === module) {
  download(process.argv[2], process.argv[3] || 'jobs/dl-test')
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(e => { console.error(e.message); process.exit(1); });
}
