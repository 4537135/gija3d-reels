// Loads the bundled three.js (vendor/three.iife.js, built from the `three` package by `npm run build:three`).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const FILE = path.join(__dirname, 'vendor', 'three.iife.js');
function threeLib() {
  if (!fs.existsSync(FILE)) { // first run after a fresh clone: build it
    execFileSync(process.execPath, [path.join(__dirname, 'node_modules', 'esbuild', 'bin', 'esbuild'), path.join(__dirname, 'vendor', 'three-entry.mjs'),
      '--bundle', '--format=iife', '--global-name=THREE', '--minify', '--log-level=warning', '--outfile=' + FILE]);
  }
  return fs.readFileSync(FILE, 'utf8');
}
module.exports = { threeLib };
