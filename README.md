# gija3d-reels

Paste a TikTok or Instagram link into `#reels-inbox` on Discord. The bot replies with a new faceless reel
(1080×1920 H.264/AAC, ready for TikTok and Instagram) and a caption.

```
link ──► yt-dlp ──► Fish ASR transcript + 6 frames ──► Claude Fable 5.2 (your subscription) rewrites the script
     ──► one animated SVG per scene ──► Fish TTS voice ──► Playwright render ──► Discord reply
```

Reactions on your message: ⏳ working · ✅ done · ❌ failed (the bot replies with the reason).
You can also upload a video file, paste several links in one message (one reel each), or paste plain text.
Any other text in the message is passed to Claude as instructions, e.g.
`https://www.tiktok.com/@x/video/123  make it about PETG, keep it under 25s`.

## Two formats (picked automatically from the source)

- **Talk**: narrated tips. Hook, 2-5 numbered scenes, call to action; Fish Audio voice, captions, an animated
  illustration per scene (SVG, or exact graphs drawn by code).
- **Math**: for mathematical / mechanism visualisations. One continuous full-screen animation on pure black, drawn by
  code from the real formulas, in colours sampled from the source video. No voice and no captions: a generated
  ambient pad plays instead (set `AMBIENT_AUDIO=<file>` in `.env` to use your own track). Uses no Fish credit for voice.

Add "math format" or "talk format" to your Discord message to force one.

## Setup (Windows)

1. Install [Node.js 20.6+](https://nodejs.org).
2. Install [Claude Code](https://claude.com/claude-code) and log in once with your claude.ai account:
   run `claude` in a terminal, finish the login, then type `/exit`. The bot uses it in headless mode
   (`claude -p`), so script writing runs on your subscription. No Anthropic API key, no per-reel cost.
3. In this folder (use `npm.cmd` if PowerShell says running scripts is disabled):
   ```powershell
   npm.cmd install
   copy .env.example .env
   ```
   `npm install` also downloads ffmpeg, ffprobe, yt-dlp and Chromium, so nothing else needs installing.
   Fill in `.env`: `FISH_API_KEY` and `DISCORD_TOKEN`.
4. Discord Developer Portal → your app → **Bot** → enable **Message Content Intent**.
   The bot needs View Channel, Send Messages, Attach Files, Add Reactions and Read Message History in `#reels-inbox`.
5. Run it:
   ```powershell
   npm.cmd start
   ```
   Leave the window open. Stop with Ctrl+C. Jobs that were ⏳ when it stopped are retried on the next start.

Test one link without Discord (writes to `out/`):

```powershell
node --env-file=.env bot.js --url https://www.tiktok.com/@someone/video/123
```

## Output

- Discord reply: the reel (re-compressed to fit the 10 MB bot upload limit if needed) + caption.
- `out/<date>_<msgId>_<title>.mp4`: full-quality reel to post, with `.txt` caption next to it.
- `jobs/<msgId>/`: everything for that job (source, transcript audio, frames, `script.json`, `art*.svg`).
  To tweak a reel by hand, edit `script.json` / `art*.svg` and run `node --env-file=.env render.js jobs/<msgId>/script.json`.

## Instagram links fail?

Instagram often refuses logged-out downloads. Either upload the video file to Discord instead, or give yt-dlp cookies:
`YTDLP_COOKIES_FROM_BROWSER=firefox` (any browser you're logged into IG with; Chrome may need to be closed),
or export a `cookies.txt` and set `YTDLP_COOKIES`. Use a throwaway IG account for this.
If TikTok/IG downloads start failing for everyone, update yt-dlp: `npm update youtube-dl-exec`.

## Cost

- Script writing: free with your Claude plan. Each reel takes about a minute of Fable 5.2 and counts toward your
  plan's usage limits. If you hit the limit, the bot replies with the error; try again after the reset, or set
  `CLAUDE_EFFORT=medium` to use less.
- Fish Audio: TTS + transcription, the only paid service.
- Everything else (yt-dlp, ffmpeg, Playwright, Discord) is free.

## Files

| file | what |
|---|---|
| `bot.js` | the loop: Discord → download → transcribe → write → render → reply |
| `download.js` | yt-dlp wrapper (TikTok, Instagram, Shorts, …) |
| `transcribe.js` | Fish Audio speech-to-text |
| `writer.js` | Claude prompt (run via `claude -p`): rewritten script + animated SVG per scene |
| `render.js` | Fish TTS (or ambient audio) + frame-by-frame Playwright render → `reel.mp4` |
| `plotlib.js` | graphing helpers available to the drawing code (axes, exact curves, polar, formulas) |
| `artcheck.js` | dry-runs generated drawing code so errors get fixed before rendering |
| `palette.js` | samples the source video's colours |
| `template.html` | the visual design of the reel |
| `discord.js` | Discord REST helpers (also a CLI for the old manual flow) |

## Fixing a reel

Reply in Discord to the reel the bot posted (or to your original link) and say what to change, e.g.
"make the title FIBONACCI GEARS, slow it down, 12 seconds". The bot revises that reel's script, re-renders and
replies with **Version 2**. Reply to Version 2 for a Version 3, and so on. Only changed voice lines are re-voiced.
