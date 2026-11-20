// Dry-run the drawing code of every "code" scene at a few moments and report runtime errors,
// so the writer can ask Claude to fix them before a full render.
//   const { checkCode } = require('./artcheck'); const errs = await checkCode([{ code: '...' }, ...])
//   -> [{ scene: 2, error: 'g.foo is not a function' }]
const fs = require('fs'), path = require('path'), { pathToFileURL } = require('url');
const { chromium } = require('playwright');

async function checkCode(scenes, { shotDir, math } = {}) { // math: { colors } = full-screen math format
  if (!scenes.some(s => s.code)) return [];
  const D = 5; // pretend every scene lasts 5 s
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    await page.goto(pathToFileURL(path.join(__dirname, 'template.html')).href);
    const lib = fs.readFileSync(path.join(__dirname, 'plotlib.js'), 'utf8');
    await page.evaluate(d => window.load(d), {
      scenes: scenes.map(s => ({ kind: s.kind || 'tip', title: s.title || '', say: s.say || 'x', dur: D, code: s.code || null, engine: s.engine || null, art: null })),
      brand: {}, lib, math: math || null, three: scenes.some(s => s.engine === 'three') ? require('./threelib').threeLib() : '',
    });
    for (const [i, s] of scenes.entries()) {
      if (!s.code) continue;
      for (const u of [0.02, 0.35, 0.7, 0.99]) await page.evaluate(t => window.seek(t), i * D + u * D);
      if (shotDir) await page.screenshot({ path: path.join(shotDir, `check_${i}.jpg`), type: 'jpeg', quality: 80 });
    }
    return await page.evaluate(() => window.artErrors);
  } finally { await browser.close(); }
}

module.exports = { checkCode };
