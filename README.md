# gija3d-reels

Paste a TikTok or Instagram link into `#reels-inbox` on Discord. The bot replies with a new faceless reel
(1080×1920 H.264/AAC, ready for TikTok and Instagram) and a caption.

```
link ──► yt-dlp ──► Fish ASR transcript + 6 frames ──► Claude Fable 5.2 rewrites the script
     ──► one animated SVG per scene ──► Fish TTS voice ──► Playwright render ──► Discord reply
```

Reactions on your message: ⏳ working · ✅ done · ❌ failed (the bot replies with the reason).
You can also upload a video file, paste several links in one message (one reel each), or paste plain text.
Any other text in the message is passed to Claude as instructions, e.g.
`https://www.tiktok.com/@x/video/123  make it about PETG, keep it under 25s`.

## Setup (Windows)

1. Install [Node.js 20.6+](https://nodejs.org).
2. In this folder:
   ```powershell
   npm install
   copy .env.example .env
   ```
   `npm install` also downloads ffmpeg, ffprobe, yt-dlp and Chromium, so nothing else needs installing.
3. Fill in `.env`: `ANTHROPIC_API_KEY`, `FISH_API_KEY`, `DISCORD_TOKEN`.
4. Discord Developer Portal → your app → **Bot** → enable **Message Content Intent**.
   The bot needs View Channel, Send Messages, Attach Files, Add Reactions and Read Message History in `#reels-inbox`.
5. Run it:
   ```powershell
   npm start
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

Per reel roughly: Claude Fable 5.2 ≈ $0.30–0.80 (most of it is the SVG animations), Fish Audio TTS + ASR a few cents.
Set `CLAUDE_MODEL=claude-opus-5-5` in `.env` for about half the Claude cost.

## Files

| file | what |
|---|---|
| `bot.js` | the loop: Discord → download → transcribe → write → render → reply |
| `download.js` | yt-dlp wrapper (TikTok, Instagram, Shorts, …) |
| `transcribe.js` | Fish Audio speech-to-text |
| `writer.js` | Claude prompt: rewritten script + animated SVG per scene |
| `render.js` | Fish TTS + frame-by-frame Playwright render → `reel.mp4` |
| `template.html` | the visual design of the reel |
| `discord.js` | Discord REST helpers (also a CLI for the old manual flow) |
