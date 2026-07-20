// Throwaway mock of Streamer.bot — lets the whole scoreboard run with NO Streamer.bot
// install, for local theme development and the verify suites. It faithfully mimics
// the two SB surfaces the scoreboard depends on:
//
//   • HTTP Server on :7474 — SB Path->Folder file serving. Maps:
//       /tally-shared/*        -> tally-shared/ (the SB shim panel-core.js + control panel)
//       /tally-themes/*        -> tally-themes/ (the bundled theme(s), untouched)
//       /mock/cmd?command=..   -> applies a mutation + re-broadcasts (the Stream Deck
//                                 analog: a button/chat hitting one control surface)
//       /                      -> a panel index for quick manual testing
//   • WebSocket Server on :8080 — speaks SB's envelope. On `Subscribe` it acks; on
//     `DoAction` it acks AND broadcasts current state (mimicking the C# "Scoreboard
//     Push" action), which is what recreates the server's sync-on-connect.
//
// Interactive keys (when attached to a TTY): q/a = P1 +/-, w/s = P2 +/-, r reset,
// x swap — each re-broadcasts a live scoreboard:update, proving the live path.
//
// This is a REFERENCE/TEST harness. The real thing uses Streamer.bot itself (see
// README.md) with the same wire shapes.

import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './tally-shared/nations.js'; // side-effect: globalThis.Nations (same resolver the panel uses)

const { resolveFlag } = globalThis.Nations;

const __dirname = dirname(fileURLToPath(import.meta.url));
const THEMES_DIR = resolve(__dirname, 'tally-themes');
const BUNDLE_SHARED = resolve(__dirname, 'tally-shared'); // SB `tally-shared` map → the shim + control.html

const HTTP_PORT = Number(process.env.SB_HTTP_PORT) || 7474; // SB HTTP Server default
const WS_PORT = Number(process.env.SB_WS_PORT) || 8080; // SB WebSocket Server default

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

// Flat lite state — the exact values the C# "Scoreboard Push" reads from globals.
// Slots 3-4 exist but only broadcast when teams > 2 (the optional 3-4 team mode).
const state = {
  p1name: 'Player 1', p2name: 'Player 2', p3name: 'Player 3', p4name: 'Player 4',
  p1score: 0, p2score: 0, p3score: 0, p4score: 0,
  p1flag: '', p2flag: '', p3flag: '', p4flag: '',
  teams: 2,
  header: 'Streamer.bot Lite', subheader: 'FT2',
};

// Mirror of the C# "Scoreboard Command" dispatch — the single control surface.
function applyCommand(command, value) {
  const cmd = String(command || '').trim().toLowerCase();
  const val = value == null ? '' : String(value);
  const clamp = (n, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, Math.trunc(n) || 0));
  const pn = /^p([1-4])(\+|-|score|name|flag)$/.exec(cmd);
  if (pn) {
    const [, n, op] = pn;
    switch (op) {
      case '+': state['p' + n + 'score'] = clamp(state['p' + n + 'score'] + 1); break;
      case '-': state['p' + n + 'score'] = clamp(state['p' + n + 'score'] - 1); break;
      case 'score': state['p' + n + 'score'] = clamp(parseInt(val, 10)); break;
      case 'name': state['p' + n + 'name'] = val; break;
      case 'flag': { const f = resolveFlag(val); if (f == null) return false; state['p' + n + 'flag'] = f; break; }
    }
    return true;
  }
  switch (cmd) {
    case 'reset': for (let i = 1; i <= 4; i++) state['p' + i + 'score'] = 0; break;
    case 'swap': { // slots 1↔2 only, matching the C#
      const n = state.p1name; state.p1name = state.p2name; state.p2name = n;
      const s = state.p1score; state.p1score = state.p2score; state.p2score = s;
      const f = state.p1flag; state.p1flag = state.p2flag; state.p2flag = f;
      break;
    }
    case 'teams': state.teams = clamp(parseInt(val, 10) || 2, 2, 4); break;
    case 'header': state.header = val; break;
    case 'subheader': state.subheader = val; break;
    default: return false;
  }
  return true;
}

// SB's General.Custom envelope for a WebsocketBroadcastJson payload.
function customEvent(data) {
  return JSON.stringify({
    timeStamp: '1970-01-01T00:00:00.0000000',
    event: { source: 'General', type: 'Custom' },
    data,
  });
}

// The exact `scoreboard:update` shape the themes consume (docs/PROTOCOL.md). Lite
// carries one add-in field — the flag — mirroring scoreboard-push.cs: per-player
// fields.flag plus fieldsEnabled['player.flag'] (on when either player has one).
function stateMessage() {
  const msg = { type: 'scoreboard:update' };
  if (state.teams > 2) msg.teams = state.teams; // absent in two-team mode (original shape)
  let anyFlag = false;
  for (let i = 1; i <= state.teams; i++) {
    const flag = state['p' + i + 'flag'];
    if (flag) anyFlag = true;
    msg['player' + i] = { name: state['p' + i + 'name'], score: state['p' + i + 'score'], fields: flag ? { flag } : {} };
  }
  msg.header = state.header;
  msg.subheader = state.subheader;
  msg.fields = {};
  msg.fieldsEnabled = anyFlag ? { 'player.flag': true } : {};
  return customEvent(msg);
}

// Resolve a request path to a file inside `base`, guarding against traversal.
function safeResolve(base, rel) {
  const file = resolve(base, '.' + rel);
  return file === base || file.startsWith(base + '\\') || file.startsWith(base + '/') ? file : null;
}

async function serveFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  }
}

// A small index of the theme panels, for quick manual testing in a browser.
async function landingHtml() {
  const sections = [];
  try {
    const themes = (await readdir(THEMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory());
    for (const t of themes) {
      let mani;
      try { mani = JSON.parse(await readFile(resolve(THEMES_DIR, t.name, 'manifest.json'), 'utf8')); } catch { continue; }
      const links = (mani.panels || []).map((p) => {
        const href = `/tally-themes/${t.name}/${p.file}?sbport=${WS_PORT}`;
        return `<li><a href="${href}" target="_blank">${p.label || p.file}</a> <span class="dim">${p.width}×${p.height}</span></li>`;
      }).join('');
      sections.push(`<section><h2>${mani.displayName || t.name}</h2><ul>${links}</ul></section>`);
    }
  } catch { /* themes dir missing */ }
  if (!sections.length) sections.push(`<p class="dim">No themes found at ${THEMES_DIR}.</p>`);
  return `<!doctype html><meta charset="utf-8"><title>Scorebug — mock Streamer.bot</title>
<style>
  body{font:15px/1.5 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#e6e6e6;background:#141414}
  h1{font-size:1.3rem} h2{font-size:1rem;margin:1.4rem 0 .3rem;color:#8be9fd}
  a{color:#9ad}.dim{color:#888;font-size:.85em} ul{margin:.2rem 0;padding-left:1.2rem}
  code{background:#222;padding:.1em .4em;border-radius:4px}
</style>
<h1>Scorebug &mdash; mock Streamer.bot</h1>
<p>Open a panel below as an OBS Browser Source (or in a tab). Drive the score from the
mock's console keys (<code>q/a</code> P1 &plusmn;, <code>w/s</code> P2 &plusmn;, <code>r</code> reset, <code>x</code> swap)
or by hitting <code>/mock/cmd?command=p1+</code>. Current:
<code>${state.p1name} ${state.p1score} - ${state.p2score} ${state.p2name}</code></p>
${sections.join('\n')}`;
}

// ── HTTP server (SB HTTP Server mimic) ───────────────────────────────────────
const http = createServer(async (req, res) => {
  const url = req.url || '/';
  const path = decodeURIComponent(url.split('?')[0]);
  const query = new URLSearchParams(url.split('?')[1] || '');

  if (path === '/mock/cmd') {
    const ok = applyCommand(query.get('command'), query.get('value'));
    if (ok) broadcast();
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, state }));
    return;
  }
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await landingHtml());
    return;
  }
  // Two SB HTTP maps, identical to the real-SB config: `tally-themes` → tally-themes/
  // and `tally-shared` → tally-shared/ (the SB shim panel-core.js that every panel
  // loads, plus control.html + nations.js). The panels load "/tally-shared/panel-core.js"
  // by absolute path, so which file is served there is the whole transport swap.
  let file = null;
  if (path.startsWith('/tally-themes/')) file = safeResolve(THEMES_DIR, path.slice('/tally-themes'.length));
  else if (path.startsWith('/tally-shared/')) file = safeResolve(BUNDLE_SHARED, path.slice('/tally-shared'.length));
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Map /tally-themes/ (tally-themes/) or /tally-shared/ (this bundle: panel-core.js + control.html).');
    return;
  }
  return serveFile(res, file);
});

http.on('error', (err) => { console.error('[mock] HTTP error:', err.message); process.exit(1); });
http.listen(HTTP_PORT, '127.0.0.1', () => {
  console.log(`[mock] HTTP  http://127.0.0.1:${HTTP_PORT}/  (panel index; themes from ${THEMES_DIR})`);
});

// ── WebSocket server (SB WebSocket Server mimic) ─────────────────────────────
const wss = new WebSocketServer({ host: '127.0.0.1', port: WS_PORT });
const clients = new Set();

wss.on('error', (err) => { console.error('[mock] WS error:', err.message); process.exit(1); });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.subscribedCustom = false; // only a correctly-subscribed client receives broadcasts
  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.request === 'Subscribe') {
      // Real Streamer.bot uses a LOWERCASE source key ('general') in Subscribe, while
      // delivered events carry a capitalized source ('General'). Enforce that here so
      // a wrong-case subscribe gets nothing — exactly how real SB behaves.
      const gen = m.events && m.events.general;
      ws.subscribedCustom = Array.isArray(gen) && gen.includes('Custom');
      console.log('[mock] Subscribe', ws.subscribedCustom ? 'OK (general.Custom)' : 'IGNORED (expected lowercase events.general:["Custom"])');
      ws.send(JSON.stringify({ id: m.id, status: 'ok', result: { events: m.events } }));
    } else if (m.request === 'DoAction') {
      ws.send(JSON.stringify({ id: m.id, status: 'ok' }));
      const name = m.action && m.action.name;
      if (name === 'Scoreboard Command' && m.args && applyCommand(m.args.command, m.args.value)) {
        broadcast(); // mutate + notify all overlays (mimics Scoreboard Command → Scoreboard Push)
      } else if (ws.subscribedCustom) {
        ws.send(stateMessage()); // Scoreboard Push / sync-on-connect re-broadcast
      }
    }
  });
  ws.on('close', () => clients.delete(ws));
});
wss.on('listening', () => console.log(`[mock] WS    ws://127.0.0.1:${WS_PORT}  (Streamer.bot mock)`));

function broadcast() {
  const msg = stateMessage();
  for (const ws of clients) { if (ws.subscribedCustom) { try { ws.send(msg); } catch {} } }
  console.log(`[mock] broadcast  ${state.p1name} ${state.p1score} - ${state.p2score} ${state.p2name}`);
}

// ── Interactive controls (only when attached to a TTY) ───────────────────────
if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  console.log('[mock] keys: q/a P1 +/-, w/s P2 +/-, r reset, x swap, Ctrl+C quit');
  process.stdin.on('data', (k) => {
    if (k.charCodeAt(0) === 3) process.exit(0); // Ctrl+C
    const map = { q: 'p1+', a: 'p1-', w: 'p2+', s: 'p2-', r: 'reset', x: 'swap' };
    if (!map[k]) return;
    applyCommand(map[k]);
    broadcast();
  });
}
