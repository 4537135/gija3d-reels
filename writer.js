// Claude writes the reel: rewritten script + one animated SVG per scene -> script.json + artN.svg
//   const { writeScript } = require('./writer'); await writeScript({ dir, transcript, info, frames, note })
const fs = require('fs'), path = require('path');
const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk');

const MODEL = process.env.CLAUDE_MODEL || 'claude-fable-5-2';
const EFFORT = process.env.CLAUDE_EFFORT || 'high';
const NICHE = process.env.CHANNEL_NICHE || '3D printing tips for hobbyists. Brand: GIJA3D (gija3d.lt).';
const client = new Anthropic(); // reads ANTHROPIC_API_KEY

const example = fs.readFileSync(path.join(__dirname, 'jobs/example/script.json'), 'utf8');
const artExamples = ['art0.svg', 'art1.svg', 'art4.svg']
  .map(f => `<example file="${f}">\n${fs.readFileSync(path.join(__dirname, 'art-examples', f), 'utf8')}\n</example>`).join('\n');

// Stable system prompt (cached across jobs). Nothing per-job goes here.
const SYSTEM = `You are the editor of a faceless short-form video channel (TikTok + Instagram Reels).
Channel niche: ${NICHE}

You get a source video someone else posted (transcript, caption/description, and a few frames).
You produce an ORIGINAL reel that teaches the same useful idea, voiced by text-to-speech over animated illustrations.

Script rules:
- REWRITE, never copy. Same core idea, new wording, new structure where it helps, your own examples.
  Fact-check it; drop or correct anything wrong or unsafe. Never mention the original creator or platform.
- If the source is off-niche, still make the best educational reel about its topic, in the channel's voice.
- English, direct, short punchy sentences, no filler. Spell out numbers and units as spoken in "say"
  ("twenty millimeters per second"); keep digits in "title" / "sub".
- Structure: exactly 1 scene of kind "hook" first (under ~2 seconds of speech: a problem or surprising claim),
  then 2-5 scenes of kind "tip", then exactly 1 scene of kind "cta" last. Total speech 20-40 seconds
  (roughly 55-110 words overall, the voice is sped up 15%).
- "title": max 4 words. "sub": optional short detail line (max ~5 words), e.g. a setting or value.
- "caption": 1-2 lines for the post, then 3-5 relevant hashtags on a new line.

Illustration rules (one per scene, the "art" field = a complete SVG string):
- <svg viewBox="0 0 920 620" xmlns="http://www.w3.org/2000/svg"> with a <style> inside holding CSS @keyframes animations.
- The renderer seeks animations frame-by-frame, so use only CSS animations (no <script>, no SMIL, no external images/fonts/links).
  var(--d) is the scene length in seconds; use it in animation durations/delays (calc(var(--d) - 1s)) so motion fills the scene.
- Show the actual mechanism of the tip (the object, the before/after, the setting being changed, the motion), not decoration.
- Colours: var(--accent) (acid lime, for the key element), var(--ink) (off-white), var(--muted) (grey), dark greys like #2a2a28 #4a4944 #77746c.
  Background is a dark graphite grid, so do not paint a full background rect.
- Text inside the SVG is optional, at most 3 short labels, font-family Unbounded, >= 26px, kept inside the viewBox.
- Keep each SVG under ~6 KB. Elements must stay inside 0..920 x 0..620 and not overlap labels.

Style references from an existing reel (ironing tip):
${artExamples}

Output format: reply with ONE JSON object and nothing else (no markdown fences):
{"caption": string, "source_summary": string (1 sentence: what the original was about),
 "scenes": [{"kind": "hook"|"tip"|"cta", "title": string, "sub": string (may be ""), "say": string, "art": string (SVG)}]}

For reference, a finished script.json (art omitted) looks like:
${example}`;

function extractJson(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  return JSON.parse(t.slice(a, b + 1));
}

function validate(j) {
  if (!j || !Array.isArray(j.scenes)) throw new Error('missing scenes[]');
  const s = j.scenes;
  if (s.length < 3 || s.length > 8) throw new Error(`expected 3-8 scenes, got ${s.length}`);
  if (s[0].kind !== 'hook' || s[s.length - 1].kind !== 'cta') throw new Error('first scene must be hook, last must be cta');
  for (const [i, x] of s.entries()) {
    if (!['hook', 'tip', 'cta'].includes(x.kind)) throw new Error(`scene ${i}: bad kind ${x.kind}`);
    if (!x.say || !x.title) throw new Error(`scene ${i}: needs title and say`);
    if (typeof x.art !== 'string' || !/<svg[\s>]/i.test(x.art)) throw new Error(`scene ${i}: art is not an SVG`);
  }
  if (!j.caption) throw new Error('missing caption');
}

// Strip anything that could reach outside the page or break the frame-seeking renderer.
const cleanSvg = svg => svg
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+="[^"]*"/gi, '')
  .replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*\/?>/gi, '')
  .replace(/(href|xlink:href)="(?!#)[^"]*"/gi, '');

async function askClaude(content) {
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default', // if the model declines, the API retries on a fallback model in the same call
    output_config: { effort: EFFORT },
    cache_control: { type: 'ephemeral' },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') throw new Error(`Claude declined this source (${msg.stop_details?.category || 'policy'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude reply was cut off (max_tokens)');
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const u = msg.usage || {};
  console.log(`  claude: ${u.input_tokens} in (+${u.cache_read_input_tokens || 0} cached), ${u.output_tokens} out`);
  return text;
}

async function writeScript({ dir, transcript, info = {}, frames = [], note = '' }) {
  const content = [];
  for (const f of frames) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(f).toString('base64') } });
  content.push({ type: 'text', text: [
    frames.length ? `Above: ${frames.length} frames from the source video, in order.` : 'No frames available.',
    info.platform ? `Platform: ${info.platform}` : '',
    info.title ? `Source title: ${info.title}` : '',
    info.description ? `Source caption/description:\n${info.description}` : '',
    `Source transcript:\n${transcript || '(no speech detected - rely on the frames and caption)'}`,
    note ? `Extra instructions from the person who sent this:\n${note}` : '',
    'Write the reel now. Reply with the JSON object only.',
  ].filter(Boolean).join('\n\n') });

  let j, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { j = extractJson(await askClaude(content)); validate(j); lastErr = null; break; }
    catch (e) { lastErr = e; if (/declined/.test(e.message)) break; console.log(`  writer attempt ${attempt + 1} failed: ${e.message}`); }
  }
  if (lastErr) throw lastErr;

  const voice = process.env.FISH_VOICE_ID || fs.readFileSync(path.join(__dirname, 'voice.txt'), 'utf8').trim();
  const script = { voice, caption: j.caption, source_summary: j.source_summary || '', scenes: [] };
  j.scenes.forEach((s, i) => {
    const art = `art${i}.svg`;
    fs.writeFileSync(path.join(dir, art), cleanSvg(s.art));
    script.scenes.push({ kind: s.kind, title: s.title, ...(s.sub ? { sub: s.sub } : {}), say: s.say, art });
  });
  const out = path.join(dir, 'script.json');
  fs.writeFileSync(out, JSON.stringify(script, null, 2));
  return { path: out, script };
}

module.exports = { writeScript, MODEL };
