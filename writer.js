// Claude writes the reel: rewritten script + one animated SVG per scene -> script.json + artN.svg
//   const { writeScript } = require('./writer'); await writeScript({ dir, transcript, info, frames, note })
// Runs through the Claude Code CLI in headless mode (`claude -p`) on your claude.ai subscription,
// so there is no per-call API bill. Log in once with `claude` (then /login) on this PC.
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');

const MODEL = process.env.CLAUDE_MODEL || 'claude-fable-5-2';
const EFFORT = process.env.CLAUDE_EFFORT || 'high';
const NICHE = process.env.CHANNEL_NICHE || 'Short educational explainers: 3D printing and making, plus maths and the geometry behind mechanisms. Follow the topic of the source video.';
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const { checkCode } = require('./artcheck');

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
- Each scene's "say" is at most 24 words (it is shown as a caption under the visual). Split a longer idea into two scenes.
- "title": max 4 words. "sub": optional short detail line (max ~5 words), e.g. a setting or value.
- The "cta" scene is a plain call to action (save / follow). No brand name, website, handle or logo anywhere in it:
  not in "title", "sub", "say" or the art. Leave its "sub" empty unless it adds something useful.
- "caption": 1-2 lines for the post, then 3-5 relevant hashtags on a new line. No brand hashtags.

- Maths topics: the scenes of kind "tip" are the steps of the explanation (the idea, the formula, what it causes).
  State formulas exactly in "sub" using unicode (r = a·φ^(2θ/π), ω₂/ω₁ = r₁/r₂), and say them in plain words in "say".
  Check every formula and number yourself before you use it.

TWO OUTPUT FORMATS. Pick one:
(A) "math" format - use it whenever the source is a mathematical / geometric / mechanism visualisation
    (curves, gears, fractals, proofs without words, physics simulations), or the sender asks for it.
    It is ONE continuous full-screen animation, no narration, no captions, no scenes. Described below under MATH FORMAT.
(B) "talk" format - narrated tips (how-to advice, settings, mistakes to avoid). Scenes with voice-over. Everything
    above about hook / tip / cta scenes applies to this format only.

MATH FORMAT (reply shape: {"format":"math","caption":...,"source_summary":...,"title":...,"duration":number,"code":string}):
- "code" is the BODY of draw(ctx, t, d, P, C), called once per frame, drawing the WHOLE 1080 x 1920 frame.
  The background is pure black and already cleared: never fill a background, never draw a grid or a logo.
- "duration": 10-20 seconds. Make it a seamless loop: the picture at t = d must equal the picture at t = 0
  (use periodic motion with period d or d/n).
- Recreate the same mathematical idea as the source, computed from the real formulas, with your own framing and layout.
  It must be mathematically correct: derive positions, angles and speeds from the equations (rolling without slipping,
  correct ratios, exact curves). Smooth, slow, satisfying motion. Fill the frame: the main figure spans roughly
  x 90..990, y 380..1380.
- Layout like a typeset maths poster: a bold title near the top (P.text(ctx, 540, 190, 'TITLE', { font:'title', size:76,
  align:'center', color: C.ink })), the defining formula under it in the 'math' font (size ~44, colour C.muted), the figure
  in the middle, and 1-3 key relations near the bottom (y 1500..1700) with a LIVE numeric value that changes with t.
  Keep all text inside x 60..1020 and y 120..1760.
- Colours: C.accent, C.second, C.third are sampled from the source video (use them for the main objects, the same roles
  as in the source); C.ink is white, C.muted light grey. P.tint(colour, 0.35) gives a lighter edge colour,
  P.alpha(colour, 0.3) a translucent fill. Filled shapes with a lighter outline look best on black.
- Formula helpers: P.row(ctx, cx, y, [['r₁', C.accent], [' + ', C.ink], ['r₂', C.second], [' = D', C.ink]], { size:52 })
  draws one centred line of coloured pieces; P.frac(ctx, cx, y, 'ω₂', 'ω₁', { size:52, topColor, bottomColor }) a stacked
  fraction (returns its width); P.measure(ctx, str, { size, font }) a text width. Use unicode for symbols (φ θ π ω ₁ ₂ √ ·).
- All the "code" rules below apply too (pure function of t, P.axes / g.plot / g.polar / g.param, ctx allowed directly),
  except the canvas is 1080 x 1920 and labels should be size >= 34. With P.axes pass an explicit box, e.g.
  box:[90, 380, 900, 1000], and usually grid:false, axis:false for mechanisms. Code may be up to ~150 lines.

TALK FORMAT visuals. Every scene has exactly ONE visual: either "code" (canvas drawing program) or "art" (SVG). Choose per scene:
- "code" for anything mathematical or precise: graphs of functions, polar/parametric curves, geometry, vectors,
  rolling or rotating mechanisms, anything whose shape comes from a formula. Never hand-draw a curve in SVG.
- "art" for simple objects and before/after pictures (a nozzle, a spool, a bookmark icon).

"code" rules (the field is the BODY of a JavaScript function draw(ctx, t, d, P, C), called once per video frame):
- ctx: CanvasRenderingContext2D, logical size 920 x 620, already cleared, transparent over a dark background.
  t: seconds since the scene started. d: scene length in seconds (about 3-9). Draw the complete picture for time t.
- It must be a pure function of t: no state kept between frames, no timers, no DOM, no network, no images.
  Compute everything from t (positions, angles, how much of a curve is drawn). Make motion span the scene using d.
- C: colours { accent (acid lime, the key element), ink (off-white), muted (grey), dim (dark grey), grid }.
- P helpers: P.clamp(v,a,b), P.lerp(a,b,u), P.ease(u), P.prog(t, start, end) -> eased 0..1 between two times,
  P.text(ctx, px, py, str, { size, color, align, weight }) in pixels, P.PI, P.TAU.
- const g = P.axes(ctx, { x:[min,max], y:[min,max], equal:true|false, grid:true, axis:true, numbers:false, box:[left,top,w,h] })
  draws axes and returns a graph in MATH coordinates (equal:true keeps circles round; use it for geometry and polar curves):
    g.plot(x => f(x), { progress, color, width, from, to, dash })      exact y = f(x), gaps at asymptotes handled
    g.param(s => x(s), s => y(s), { t:[a,b], progress, color, width })  parametric curve
    g.polar(th => r(th), { theta:[a,b], rot, at:[cx,cy], progress })    polar curve, rotated by rot radians about pole at
    g.area(x => f(x), a, b, { color, alpha })   shaded region to the x axis
    g.line(x1,y1,x2,y2,{color,width,dash})  g.circle(x,y,r,{color,fill,dash})  g.poly([[x,y],...],{color,fill,close})
    g.dot(x,y,{ label, color, r })  g.text(x,y,str,{ size, color, align, dx, dy })  g.X(x), g.Y(y) -> pixel coordinates
  progress (0..1) draws only the first part of a curve: use P.prog(t, 0.2, 2) to draw it on.
  You may also use ctx directly (with g.X / g.Y) for anything the helpers do not cover.
- Animate the idea, not decoration: draw the curve on, move a point along it, sweep a parameter and show its value,
  rotate the mechanism at the correct ratio. Real maths only: compute positions from the actual formulas.
- At most 3 short text labels, size >= 24, kept inside 0..920 x 0..620 and off the curves. Keep code under ~60 lines.
- Example ("code" for y = sin x with a point riding the curve):
  const g = P.axes(ctx, { x: [-7, 7], y: [-1.6, 1.6] });
  g.plot(x => Math.sin(x), { progress: P.prog(t, 0.2, d * 0.45) });
  const x = P.lerp(-6, 6, P.prog(t, d * 0.45, d - 0.3));
  if (t > d * 0.45) g.dot(x, Math.sin(x), { label: 'sin x = ' + Math.sin(x).toFixed(2) });

3D ("engine": "three" next to "code"). Real-time three.js (r187, global THREE, WebGL) for anything that is
truly spatial: solid objects and printed parts, surfaces z = f(x, y), 3D curves and knots, polyhedra, rotations in
space, layer-by-layer builds. ALWAYS use it when the sender asks for 3D, three.js, Blender or "nicer graphics"
(Blender itself is not available; three.js is the substitute). Keep flat graphs and 2D mechanisms in the 2D canvas.
- With engine "three", "code" is the BODY of setup(THREE, P, C, W, H) and must END with
  return { scene, camera, update(t, d, ctx) { ... } }
  setup runs once: build geometry, materials, lights and camera there (W x H is the canvas size in pixels).
  update runs every frame: set every moving value from t ABSOLUTELY (rotation.y = P.TAU * t / d, positions from formulas,
  geometry.setDrawRange to build something up); never accumulate (no += per frame). The renderer draws after update.
  ctx is a transparent 2D canvas ON TOP of the 3D view, already cleared: draw titles, labels, formulas there with
  P.text / P.row / P.frac exactly as in 2D code.
- Looks: MeshStandardMaterial / MeshPhysicalMaterial with new THREE.Color(C.accent) etc., metalness 0.1-0.4, roughness
  0.3-0.6; one AmbientLight (~0.35) + a key DirectionalLight (~2) + a coloured rim light from behind. Smooth geometry
  (enough segments). Background stays transparent: never set scene.background, never add a floor that fills the frame.
- Camera: PerspectiveCamera(35-45, W / H, 0.1, 100); frame the object so it fills about 70% of the width and stays
  clear of the text areas; slow orbits or turntable rotation read best. Extra geometry helpers: THREE.TubeGeometry along a
  THREE.CatmullRomCurve3 or a custom THREE.Curve, THREE.ParametricGeometry is NOT available (build a BufferGeometry
  from a grid of points instead), THREE.ExtrudeGeometry from a THREE.Shape, THREE.LatheGeometry for turned parts.
- Example (scene body, 3D):
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, W / H, 0.1, 100); camera.position.set(0, 1.5, 9);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 4, 5); scene.add(key);
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(1.2, 0.35, 300, 40, 2, 3),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(C.accent), metalness: 0.25, roughness: 0.35 }));
  scene.add(knot); camera.lookAt(0, 0, 0);
  return { scene, camera, update(t, d, ctx) { knot.rotation.y = P.TAU * t / d; P.text(ctx, W / 2, 80, 'p = 2, q = 3', { size: 34, align: 'center' }); } };
- 3D renders slower: use it for the scenes that need it, not for icons or text-only scenes.

"art" rules (the field is a complete SVG string):
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

Output format: reply with ONE JSON object and nothing else (no markdown fences).
Math format: {"format":"math","caption": string,"source_summary": string,"title": string,"duration": number,"code": string,
              "engine": "canvas" | "three"}
Talk format:
{"format":"talk","caption": string, "source_summary": string (1 sentence: what the original was about),
 "scenes": [{"kind": "hook"|"tip"|"cta", "title": string, "sub": string (may be ""), "say": string,
             "code": string (JS function body), "engine": "canvas" | "three"   OR  "art": string (SVG)}]}
"engine" defaults to "canvas" (the 2D draw function); "three" means the 3D setup function described above.
In math format with engine "three", the 3D view is the full 1080 x 1920 frame on black and ctx is the overlay for the
title / formula / live values; all the math-format layout rules still apply.

For reference, a finished script.json (art omitted) looks like:
${example}`;

function extractJson(text) {
  const t = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('no JSON object in reply');
  return JSON.parse(t.slice(a, b + 1));
}

function validate(j) {
  if (j && j.format === 'math') {
    if (typeof j.code !== 'string' || j.code.trim().length < 40) throw new Error('math format needs "code"');
    if (!j.caption) throw new Error('missing caption');
    j.duration = Math.min(30, Math.max(6, Number(j.duration) || 12));
    j.engine = j.engine === 'three' ? 'three' : 'canvas';
    if (j.engine === 'three' && !/return\s*\{/.test(j.code)) throw new Error('3D code must end with return { scene, camera, update }');
    return;
  }
  if (!j || !Array.isArray(j.scenes)) throw new Error('missing scenes[]');
  const s = j.scenes;
  if (s.length < 3 || s.length > 8) throw new Error(`expected 3-8 scenes, got ${s.length}`);
  if (s[0].kind !== 'hook' || s[s.length - 1].kind !== 'cta') throw new Error('first scene must be hook, last must be cta');
  for (const [i, x] of s.entries()) {
    if (!['hook', 'tip', 'cta'].includes(x.kind)) throw new Error(`scene ${i}: bad kind ${x.kind}`);
    if (!x.say || !x.title) throw new Error(`scene ${i}: needs title and say`);
    const hasCode = typeof x.code === 'string' && x.code.trim().length > 20;
    const hasArt = typeof x.art === 'string' && /<svg[\s>]/i.test(x.art);
    if (!hasCode && !hasArt) throw new Error(`scene ${i}: needs "code" (canvas JS) or "art" (SVG)`);
    if (hasCode) delete x.art; else delete x.code;
    x.engine = hasCode && x.engine === 'three' ? 'three' : undefined;
  }
  if (!j.caption) throw new Error('missing caption');
}

// Strip anything that could reach outside the page or break the frame-seeking renderer.
const cleanSvg = svg => svg
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/\son\w+="[^"]*"/gi, '')
  .replace(/<(animate|animateTransform|animateMotion|set)\b[^>]*\/?>/gi, '')
  .replace(/(href|xlink:href)="(?!#)[^"]*"/gi, '');

// Headless Claude Code: only the Read tool (to look at the frames), working dir = the job folder.
// API-key env vars are removed so it always uses the claude.ai subscription login, never a paid key.
function askClaude(dir, prompt) {
  dir = path.resolve(dir);
  const sysFile = path.join(dir, 'writer_system.txt');
  fs.writeFileSync(sysFile, SYSTEM);
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; delete env.ANTHROPIC_AUTH_TOKEN;
  const args = ['-p', '--model', MODEL, '--effort', EFFORT, '--tools', 'Read', '--allowedTools', 'Read',
    '--no-session-persistence', '--output-format', 'json', '--system-prompt-file', sysFile];
  return new Promise((res, rej) => {
    const p = execFile(CLAUDE, args, { cwd: dir, env, timeout: 20 * 60 * 1000, maxBuffer: 1 << 26, windowsHide: true }, (err, stdout, stderr) => {
      let j;
      try { j = JSON.parse(stdout); } catch {
        const why = (stderr || err?.message || stdout || '').toString().trim().slice(-400);
        return rej(new Error(err?.code === 'ENOENT' ? 'Claude Code CLI not found - install it and log in (see README)' : `claude -p failed: ${why}`));
      }
      if (j.is_error) return rej(new Error(`claude -p: ${String(j.result || j.subtype).slice(0, 300)}`));
      const u = j.usage || {};
      console.log(`  claude (${MODEL}, subscription): ${u.output_tokens} tokens out, ${Math.round((j.duration_ms || 0) / 1000)}s`);
      res(String(j.result || ''));
    });
    p.stdin.end(prompt);
  });
}

async function writeScript({ dir, transcript, info = {}, frames = [], note = '', palette = [], promptOverride = '' }) {
  const content = [{ type: 'text', text: [
    frames.length ? `First use the Read tool to look at these ${frames.length} frames from the source video, in order: ${frames.map(f => path.basename(f)).join(', ')}.` : 'No frames available.',
    info.platform ? `Platform: ${info.platform}` : '',
    info.title ? `Source title: ${info.title}` : '',
    info.description ? `Source caption/description:\n${info.description}` : '',
    `Source transcript:\n${transcript || '(no speech detected - rely on the frames and caption)'}`,
    palette.length ? `Colours sampled from the source video (most common first): ${palette.join(', ')}. In math format these are C.accent, C.second, C.third.` : '',
    note ? `Extra instructions from the person who sent this:\n${note}` : '',
    'Write the reel now. Your final reply must be the JSON object only.',
  ].filter(Boolean).join('\n\n') }];
  const prompt = promptOverride || content[0].text;
  if (!promptOverride) fs.writeFileSync(path.join(dir, 'writer_prompt.txt'), prompt); // kept so a later revision has the source context

  let j, lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { j = extractJson(await askClaude(dir, prompt)); validate(j); lastErr = null; break; }
    catch (e) { lastErr = e; if (/not found|usage limit|rate limit|login/i.test(e.message)) break; console.log(`  writer attempt ${attempt + 1} failed: ${e.message}`); }
  }
  if (lastErr) throw lastErr;

  // Dry-run the drawing code. If a scene throws, send the error back once for a fix;
  // a scene that still fails loses its visual rather than sinking the whole reel.
  const colors = { ink: '#ffffff', muted: '#a8a8a8', accent: palette[0] || '#19a394', second: palette[1] || '#d9603a', third: palette[2] || '#e8c547' };
  if (j.format === 'math') {
    // The whole reel is one program, so it gets two repair rounds and then fails loudly.
    for (let round = 0; ; round++) {
      const errs = await checkCode([{ code: j.code, engine: j.engine }], { math: { colors }, shotDir: path.resolve(dir) }).catch(e => { console.log(`  code check skipped: ${e.message}`); return []; });
      if (!errs.length) break;
      console.log(`  drawing code error: ${errs[0].error}`);
      if (round >= 2) throw new Error(`the animation code kept failing: ${errs[0].error}`);
      const fix = `${prompt}\n\nYou already wrote this reel:\n${JSON.stringify(j)}\n\nBut its "code" threw when run: ${errs[0].error}\n` +
        'Use only the documented P / g helpers. Fix it and reply with the complete corrected JSON object only.';
      const k = extractJson(await askClaude(dir, fix)); validate(k);
      if (k.format !== 'math') throw new Error('fix attempt changed the format');
      j = k;
    }
    j.caption = j.caption.replace(/[ \t]*#gija3d\b/gi, '');
    fs.writeFileSync(path.join(dir, 'code.js'), j.code);
    const script = { format: 'math', caption: j.caption, source_summary: j.source_summary || '', title: j.title || 'reel', duration: j.duration, colors, code: 'code.js', engine: j.engine };
    const out = path.join(dir, 'script.json');
    fs.writeFileSync(out, JSON.stringify(script, null, 2));
    return { path: out, script };
  }
  for (let round = 0; round < 2 && j.scenes.some(s => s.code); round++) {
    const errs = await checkCode(j.scenes).catch(e => { console.log(`  code check skipped: ${e.message}`); return []; });
    if (!errs.length) break;
    console.log(`  drawing code errors: ${errs.map(e => `scene ${e.scene}: ${e.error}`).join('; ')}`);
    if (round === 0) {
      const fix = `${prompt}\n\nYou already wrote this reel:\n${JSON.stringify(j)}\n\nBut the "code" of these scenes threw when run:\n` +
        errs.map(e => `- scene index ${e.scene}: ${e.error}`).join('\n') +
        '\nUse only the documented P / g helpers. Fix those scenes and reply with the complete corrected JSON object only.';
      try { const k = extractJson(await askClaude(dir, fix)); validate(k); j = k; continue; }
      catch (e) { console.log(`  fix attempt failed: ${e.message}`); }
    }
    for (const e of errs) { delete j.scenes[e.scene].code; console.log(`  scene ${e.scene}: visual dropped`); }
    break;
  }

  const voice = process.env.FISH_VOICE_ID || fs.readFileSync(path.join(__dirname, 'voice.txt'), 'utf8').trim();
  // Belt and braces: no brand at the end of the reel or in the hashtags, even if the model adds one.
  const BRAND = /gija\s*3d/i;
  j.caption = j.caption.replace(/[ \t]*#gija3d\b/gi, '');
  for (const s of j.scenes) if (s.kind === 'cta' && BRAND.test(s.sub || '')) s.sub = '';
  const script = { voice, caption: j.caption, source_summary: j.source_summary || '', scenes: [] };
  j.scenes.forEach((s, i) => {
    const visual = {};
    if (s.code) { visual.code = `code${i}.js`; fs.writeFileSync(path.join(dir, visual.code), s.code); if (s.engine === 'three') visual.engine = 'three'; }
    else if (s.art) { visual.art = `art${i}.svg`; fs.writeFileSync(path.join(dir, visual.art), cleanSvg(s.art)); }
    script.scenes.push({ kind: s.kind, title: s.title, ...(s.sub ? { sub: s.sub } : {}), say: s.say, ...visual });
  });
  const out = path.join(dir, 'script.json');
  fs.writeFileSync(out, JSON.stringify(script, null, 2));
  return { path: out, script };
}

// Revise a finished reel from the owner's feedback (a Discord reply to the reel). Same folder, same pipeline.
async function reviseScript({ dir, feedback }) {
  const old = JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8'));
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  // Rebuild the JSON Claude originally produced (file names -> contents).
  const prev = old.format === 'math'
    ? { format: 'math', caption: old.caption, source_summary: old.source_summary, title: old.title, duration: old.duration, code: read(old.code), engine: old.engine || 'canvas' }
    : { format: 'talk', caption: old.caption, source_summary: old.source_summary,
        scenes: old.scenes.map(s => ({ kind: s.kind, title: s.title, sub: s.sub || '', say: s.say, ...(s.code ? { code: read(s.code), engine: s.engine || 'canvas' } : s.art ? { art: read(s.art) } : {}) })) };
  const pf = path.join(dir, 'writer_prompt.txt');
  const base = fs.existsSync(pf) ? read('writer_prompt.txt').split('Write the reel now.')[0].trim() : `Source summary: ${old.source_summary || '(unknown)'}`;
  const promptOverride = `${base}

You already made this reel from that source:
${JSON.stringify(prev)}

` +
    `The channel owner watched it and wants these changes:
${feedback}

` +
    'Apply exactly what they ask and keep everything else as it is (same format unless they ask to switch). ' +
    'Reply with the complete updated JSON object only.';
  const c = old.colors || {};
  const out = await writeScript({ dir, palette: [c.accent, c.second, c.third].filter(Boolean), promptOverride });
  // Voice files are cached per scene: drop the ones whose line changed so they get re-voiced.
  const oldSay = (old.scenes || []).map(s => s.say), newSay = (out.script.scenes || []).map(s => s.say);
  for (let i = 0; i < Math.max(oldSay.length, newSay.length); i++)
    if (oldSay[i] !== newSay[i]) fs.rmSync(path.join(dir, `vo_${i}_raw.mp3`), { force: true });
  return out;
}

module.exports = { writeScript, reviseScript, MODEL };
