// Stateless Discord inbox: a message is "done" once the bot has reacted ✅ to it.
//   node discord.js pull                 -> downloads new requests into jobs/<msgId>/, prints JSON list
//   node discord.js post <msgId> <file> [text]  -> replies with the file, marks message ✅
//   node discord.js say <msgId> <text>   -> text-only reply (errors, questions)
// Needs DISCORD_CHANNEL_ID. Token: injected by the session proxy for discord.com ("Bot" prefix),
// or set DISCORD_TOKEN when running locally.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const API = 'https://discord.com/api/v10', CH = process.env.DISCORD_CHANNEL_ID;
const H = { Authorization: `Bot ${process.env.DISCORD_TOKEN || 'proxy'}` };
const DONE = encodeURIComponent('✅');
if (!CH) throw new Error('set DISCORD_CHANNEL_ID');

async function api(p, opt = {}) {
  const r = await fetch(API + p, { ...opt, headers: { ...H, ...opt.headers } });
  if (!r.ok) throw new Error(`Discord ${r.status} ${p}: ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

async function pull() {
  const me = await api('/users/@me');
  const msgs = await api(`/channels/${CH}/messages?limit=50`);
  const todo = msgs.filter(m => m.author.id !== me.id && !(m.reactions || []).some(r => r.me && r.emoji.name === '✅'));
  const out = [];
  for (const m of todo.reverse()) {
    const dir = path.join(__dirname, 'jobs', m.id);
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    for (const a of m.attachments) {
      const f = path.join(dir, 'src_' + path.basename(a.filename));
      fs.writeFileSync(f, Buffer.from(await (await fetch(a.url)).arrayBuffer()));
      files.push(f);
    }
    // Instagram/TikTok links: best effort, IG often blocks logged-out downloads.
    for (const url of m.content.match(/https?:\/\/\S+/g) || []) {
      try { execFileSync('yt-dlp', ['-q', '-o', path.join(dir, 'src_link.%(ext)s'), url], { stdio: 'ignore', timeout: 120000 }); files.push(...fs.readdirSync(dir).filter(f => f.startsWith('src_link')).map(f => path.join(dir, f))); }
      catch { files.push(`LINK_FAILED ${url}`); }
    }
    fs.writeFileSync(path.join(dir, 'request.txt'), m.content);
    out.push({ id: m.id, dir, text: m.content, files });
  }
  console.log(JSON.stringify(out, null, 2));
}

async function reply(id, text, file) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: text || '', message_reference: { message_id: id } }));
  if (file) {
    const mb = fs.statSync(file).size / 1e6;
    if (mb > 10) throw new Error(`${file} is ${mb.toFixed(1)} MB, over Discord's 10 MB bot limit`);
    form.append('files[0]', new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  await api(`/channels/${CH}/messages`, { method: 'POST', body: form });
  await api(`/channels/${CH}/messages/${id}/reactions/${DONE}/@me`, { method: 'PUT' });
}

const [cmd, a, b, c] = process.argv.slice(2);
({ pull: () => pull(), post: () => reply(a, c, b), say: () => reply(a, b) }[cmd] || (() => { throw new Error('cmd: pull | post | say'); }))()
  .catch(e => { console.error(e.message); process.exit(1); });
