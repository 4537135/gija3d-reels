// Stateless Discord inbox: a message is "done" once the bot has reacted ✅ (or ❌) to it.
//   node discord.js pull                        -> downloads new requests into jobs/<msgId>/, prints JSON list
//   node discord.js post <msgId> <file> [text]  -> replies with the file, marks message ✅
//   node discord.js say <msgId> <text>          -> text-only reply (errors, questions)
// Also a module used by bot.js.
// Needs DISCORD_TOKEN (bot token) and DISCORD_CHANNEL_ID (defaults to #reels-inbox).
// The bot needs: View Channel, Send Messages, Attach Files, Add Reactions, Read Message History,
// and the "Message Content" privileged intent enabled in the Developer Portal.
const fs = require('fs'), path = require('path');
const API = 'https://discord.com/api/v10', CH = process.env.DISCORD_CHANNEL_ID || '1571986287232286801'; // #reels-inbox
const H = { Authorization: `Bot ${process.env.DISCORD_TOKEN || 'proxy'}` };
const MAX_UPLOAD_MB = Number(process.env.DISCORD_MAX_MB || 10);
const E = { done: '✅', fail: '❌', busy: '⏳' };

async function api(p, opt = {}) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + p, { ...opt, headers: { ...H, ...opt.headers } });
    if (r.status === 429 && attempt < 5) { // rate limited: wait and retry
      const wait = Number((await r.json().catch(() => ({}))).retry_after || 1);
      await new Promise(res => setTimeout(res, wait * 1000 + 100));
      continue;
    }
    if (!r.ok) throw new Error(`Discord ${r.status} ${p}: ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
}

let meId;
async function me() { return meId || (meId = (await api('/users/@me')).id); }

// New = not from the bot, and the bot hasn't marked it ✅ / ❌ (or ⏳ unless retryBusy) yet. Oldest first.
// retryBusy: on startup, pick up jobs that were ⏳ when the bot stopped or crashed.
async function listNew({ retryBusy = false } = {}) {
  const id = await me();
  const msgs = await api(`/channels/${CH}/messages?limit=50`);
  const skip = retryBusy ? [E.done, E.fail] : Object.values(E);
  const marked = m => (m.reactions || []).some(r => r.me && skip.includes(r.emoji.name));
  return msgs.filter(m => m.author.id !== id && !m.author.bot && !marked(m)).reverse();
}

const LINK_RE = /https?:\/\/[^\s<>]+/g;
const linksIn = text => (text.match(LINK_RE) || []).map(u => u.replace(/[)>.,]+$/, ''));

async function saveAttachments(m, dir) {
  const files = [];
  for (const a of m.attachments) {
    const f = path.join(dir, 'src_' + path.basename(a.filename).replace(/[^\w.-]/g, '_'));
    fs.writeFileSync(f, Buffer.from(await (await fetch(a.url)).arrayBuffer()));
    files.push(f);
  }
  return files;
}

const react = (id, emoji) => api(`/channels/${CH}/messages/${id}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT' });
const unreact = (id, emoji) => api(`/channels/${CH}/messages/${id}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'DELETE' }).catch(() => {});

async function reply(id, text, file, mark = E.done) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: (text || '').slice(0, 2000), message_reference: { message_id: id, fail_if_not_exists: false } }));
  if (file) {
    const mb = fs.statSync(file).size / 1e6;
    if (mb > MAX_UPLOAD_MB) throw new Error(`${file} is ${mb.toFixed(1)} MB, over Discord's ${MAX_UPLOAD_MB} MB bot limit`);
    form.append('files[0]', new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  await api(`/channels/${CH}/messages`, { method: 'POST', body: form });
  if (mark) await react(id, mark);
}

module.exports = { listNew, linksIn, saveAttachments, react, unreact, reply, E, MAX_UPLOAD_MB };

// ---- CLI (manual mode, kept for compatibility) ----
async function pull() {
  const out = [];
  for (const m of await listNew()) {
    const dir = path.join(__dirname, 'jobs', m.id);
    fs.mkdirSync(dir, { recursive: true });
    const files = await saveAttachments(m, dir);
    const { download } = require('./download');
    for (const url of linksIn(m.content)) {
      try { files.push((await download(url, dir)).file); } catch { files.push(`LINK_FAILED ${url}`); }
    }
    fs.writeFileSync(path.join(dir, 'request.txt'), m.content);
    out.push({ id: m.id, dir, text: m.content, files });
  }
  console.log(JSON.stringify(out, null, 2));
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  ({ pull: () => pull(), post: () => reply(a, c, b), say: () => reply(a, b) }[cmd] || (() => { throw new Error('cmd: pull | post | say'); }))()
    .catch(e => { console.error(e.message); process.exit(1); });
}
