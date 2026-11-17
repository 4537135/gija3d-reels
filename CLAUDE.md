# gija3d-reels — faceless IG reels from viral 3D-printing tips

You (Claude) are the editor. Flow per request:

0. Keys live in `.env` (gitignored). Run every node command as `node --env-file=.env ...`.
1. `node discord.js pull` → list of new requests (each has `dir`, `text`, `files`).
   Nothing new → stop.
2. Get the source content:
   - video/audio file → `node transcribe.js <file>`; also grab 3–4 frames with
     `ffmpeg -i <file> -vf fps=1/3 <dir>/frame_%02d.jpg` and Read them to see what it shows.
   - pasted text → use it directly.
   - `LINK_FAILED` → `node discord.js say <id> "Could not download that link - upload the video file or paste the text."` and skip.
3. Write `<dir>/script.json` (shape: `jobs/example/script.json`). Rules:
   - REWRITE, never copy: same tip, new wording, new order where it makes sense, our own examples.
     Fact-check the tip; drop or fix anything wrong.
   - English, educational, direct, short sentences. Spell numbers/units as spoken in `say`
     ("twenty millimeters per second"); keep digits in `title`/`sub`.
   - 1 hook (kind "hook", ≤ 2 s of speech, a problem or surprising claim), 2–5 tips (kind "tip"),
     1 CTA (kind "cta"). Total 20–40 s. `title` ≤ 4 words.
   - Optional `"image": "../../assets/<file>.jpg"` per scene — only real gija3d photos from `assets/`.
   - `caption`: 1–2 lines + 3–5 hashtags.
   - `voice`: Fish Audio voice id from `voice.txt`. TTS model defaults to `s2.1-pro-free`.
4. `node render.js <dir>/script.json` → `<dir>/reel.mp4`. Grab 2 frames with ffmpeg and look at them.
5. `node discord.js post <id> <dir>/reel.mp4 "<caption>"`.

Channel: #reels-inbox (id in discord.js). Keys: `.env`.
