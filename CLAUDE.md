# gija3d-reels — faceless reels from TikTok / Instagram links

The pipeline is automatic now: `npm start` runs `bot.js`, which polls #reels-inbox, downloads each link
(yt-dlp), transcribes (Fish ASR), asks Claude (`writer.js` runs `claude -p` on the user's claude.ai subscription, default `claude-fable-5-2`; never switch it to a paid API key) for the rewritten
script + one animated SVG per scene, renders (`render.js`, Fish TTS + Playwright) and replies with the reel.
See README.md for setup. Keys live in `.env` (gitignored); run node with `--env-file=.env`.

When asked to improve reel quality, the place to change is the `SYSTEM` prompt in `writer.js`
(script and illustration rules) and `template.html` (layout). Art SVGs render inside a shadow root, so their CSS can't leak. Keep `writer.js`'s JSON contract
(`caption`, `scenes[{kind,title,sub,say,art}]`) in sync with `render.js`.

## Manual fix-up of one reel
1. `jobs/<msgId>/` has the source, frames, `script.json`, `art*.svg`.
2. Edit them, then `node --env-file=.env render.js jobs/<msgId>/script.json` (`--no-tts` for a silent preview;
   delete `vo_*_raw.mp3` or set `"retts": true` to re-voice changed lines).
3. Look at 2 frames: `node_modules/ffmpeg-static/ffmpeg -ss 5 -i jobs/<id>/reel.mp4 -frames:v 1 f.jpg`.
4. `node --env-file=.env discord.js post <msgId> jobs/<msgId>/reel.mp4 "<caption>"`.

Script rules (also in writer.js): rewrite never copy, fact-check, 1 hook + 2–5 tips + 1 CTA, 20–40 s,
numbers spelled out in `say`, titles ≤ 4 words, SVG viewBox `0 0 920 620` with CSS keyframes using `var(--d)`.

## Math format
Sources that are maths/mechanism visualisations become `{ format: 'math', duration, colors, code: 'code.js' }`:
one full-screen 1080x1920 canvas program `draw(ctx, t, d, P, C)` on pure black, no voice (ambient audio from
`render.js`), colours from `palette.js`. Drawing code runs in a sandboxed iframe (no network / files) with the
`plotlib.js` helpers; `artcheck.js` dry-runs it and the writer sends errors back to Claude for a fix.
The user wants math reels with NO background grid, NO logo, NO voice.
