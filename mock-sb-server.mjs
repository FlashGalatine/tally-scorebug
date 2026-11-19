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
//   • WebSocket Server on :8080 — speaks SB's envelope. On `Subscribe` it acks. On
//     `DoAction` it replies the way Streamer.bot 1.0.7 was measured to (see the
//     DoAction handler), then runs a mirror of the named C# action: "Scoreboard Push"
//     broadcasts the state to every subscriber, "Scoreboard Command" changes it and
//     then pushes. Any other action name gets SB's "was not found" error reply.
//     /mock/bleed?on=1 makes same-action requests that arrive together run with one
//     request's arguments, as they do in SB's default (non-blocking) queue.
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
  '.ttf': 'font/ttf',
  // Measured on Streamer.bot 1.0.7: .svg, .woff and .woff2 are NOT given their own
  // type; they fall through to application/octet-stream. The theme has to work with that.
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
// `flag` is the optional companion arg that rides along with a pNname command, so the
// control panel applies name + flag in ONE DoAction (SB 1.0.4 arg-bleeds bursts).
// `extra` is the full args object — `setmany` reads its per-field sibling args
// (pNname/pNflag/header/subheader) from it, one batched DoAction for many fields.
const KNOWN = new Set(['reset', 'swap', 'teams', 'header', 'subheader', 'setmany']);
for (let i = 1; i <= 4; i++) for (const op of ['+', '-', 'score', 'name', 'flag']) KNOWN.add('p' + i + op);

// C# int.TryParse(s, NumberStyles.Integer, InvariantCulture): optional sign, digits
// only, surrounding white space allowed, must fit an Int32. Anything else fails and
// the caller's default applies. JS parseInt is NOT this ('5.5' → 5, '12abc' → 12).
function parseIntCs(s, dflt) {
  const t = String(s == null ? '' : s).trim();
  if (!/^[+-]?\d+$/.test(t)) return dflt;
  const n = Number(t);
  return n >= -2147483648 && n <= 2147483647 ? n : dflt;
}

// Mirror of the token/value resolution at the top of Execute() in
// scoreboard-command.cs, including the two chat styles (a command per action, or one
// dispatch command with the token as the first input word).
function resolveCommand(args) {
  const a = args || {};
  const str = (v) => (v == null ? null : String(v));
  let cmdArg = (str(a.command) || '').trim();
  while (cmdArg.length && !/[\p{L}\p{Nd}]/u.test(cmdArg[0])) cmdArg = cmdArg.slice(1);
  const sp = cmdArg.indexOf(' ');
  let token = (sp >= 0 ? cmdArg.slice(0, sp) : cmdArg).toLowerCase();
  const cmdRest = sp >= 0 ? cmdArg.slice(sp + 1).trim() : '';
  let value = (str(a.value) ?? str(a.rawInput) ?? cmdRest ?? '').trim();
  if (!KNOWN.has(token)) {
    const in0 = (str(a.input0) || '').trim().toLowerCase();
    if (KNOWN.has(in0)) {
      token = in0;
      const ri = (str(a.rawInput) || '').trim();
      const s2 = ri.indexOf(' ');
      value = (s2 >= 0 ? ri.slice(s2 + 1) : '').trim();
    }
  }
  return { token, value };
}

// Returns true when the C# would go on to run "Scoreboard Push", false when it
// returns early (unknown command, unknown nation, empty setmany): no push then.
function applyCommand(args) {
  const { token: cmd, value: val } = resolveCommand(args);
  const flag = args && args.flag;
  const extra = args;
  const clamp = (n, lo = 0, hi = 99) => Math.max(lo, Math.min(hi, n));
  const pn = /^p([1-4])(\+|-|score|name|flag)$/.exec(cmd);
  if (pn) {
    const [, n, op] = pn;
    switch (op) {
      case '+': state['p' + n + 'score'] = clamp(state['p' + n + 'score'] + 1); break;
      case '-': state['p' + n + 'score'] = clamp(state['p' + n + 'score'] - 1); break;
      case 'score': state['p' + n + 'score'] = clamp(parseIntCs(val, 0)); break;
      case 'name': {
        state['p' + n + 'name'] = val;
        // A bad flag only warns in the C# — the name still applies.
        if (flag != null) { const f = resolveFlag(String(flag)); if (f != null) state['p' + n + 'flag'] = f; }
        break;
      }
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
    case 'teams': state.teams = clamp(parseIntCs(val, 2), 2, 4); break;
    case 'header': state.header = val; break;
    case 'subheader': state.subheader = val; break;
    case 'setmany': { // mirror of the C# SetMany(): apply every present field, bad flags skip
      if (oldCs) return false; // an older pasted action: unknown command, no push
      const a = extra || {};
      let any = false;
      for (let i = 1; i <= 4; i++) {
        if (a['p' + i + 'name'] != null) { state['p' + i + 'name'] = String(a['p' + i + 'name']).trim(); any = true; }
        if (a['p' + i + 'flag'] != null) { const f = resolveFlag(String(a['p' + i + 'flag'])); if (f != null) state['p' + i + 'flag'] = f; any = true; }
      }
      if (a.header != null) { state.header = String(a.header).trim(); any = true; }
      if (a.subheader != null) { state.subheader = String(a.subheader).trim(); any = true; }
      return any;
    }
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
  let path;
  try { path = decodeURIComponent(url.split('?')[0]); }
  catch { res.writeHead(400, { 'content-type': 'text/plain' }); res.end('bad path'); return; }
  const query = new URLSearchParams(url.split('?')[1] || '');

  if (path === '/mock/cmd') {
    const ok = applyCommand(Object.fromEntries(query));
    if (ok) broadcast();
    res.writeHead(ok ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, state }));
    return;
  }
  // Test controls. /mock/bleed?on=1|0 switches the arg-bleed mode (see runAction);
  // /mock/stats reports what the mock has seen.
  if (path === '/mock/bleed') {
    if (query.has('on')) argBleed = query.get('on') === '1';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ argBleed }));
    return;
  }
  // /mock/missing?name=<action>&on=1|0  pretend an action is not imported.
  // /mock/oldcs?on=1|0                   pretend Scoreboard Command predates `setmany`.
  // /mock/error?message=…                broadcast a scoreboard:error, as the Push action does on an exception.
  if (path === '/mock/missing') {
    const name = query.get('name') || '';
    if (query.get('on') === '1') missingActions.add(name); else missingActions.delete(name);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ missing: [...missingActions] }));
    return;
  }
  if (path === '/mock/oldcs') {
    if (query.has('on')) oldCs = query.get('on') === '1';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ oldCs }));
    return;
  }
  if (path === '/mock/error') {
    const msg = customEvent({ type: 'scoreboard:error', message: query.get('message') || 'mock error' });
    for (const ws of clients) { if (ws.subscribedCustom) { try { ws.send(msg); } catch {} } }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
    return;
  }
  if (path === '/mock/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ argBleed, totalRuns, totalBroadcasts, runs: runLog.slice(-50), state }));
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
      const name = m.action && m.action.name;
      // Measured on Streamer.bot 1.0.7: an action that does not exist gets an error
      // reply; one that exists gets "ok" AT ONCE, when it is queued (not when it has
      // run), echoing the request's own args plus the queue it was put in.
      if (!ACTIONS.has(name) || missingActions.has(name)) {
        ws.send(JSON.stringify({ id: m.id, status: 'error', error: `The action '${name}' was not found` }));
        return;
      }
      const args = (m.args && typeof m.args === 'object') ? m.args : {};
      ws.send(JSON.stringify({
        id: m.id, status: 'ok',
        args: { ...args, actionName: name, queueName: argBleed ? 'Default' : 'Mock Blocking', actionQueuedAt: new Date().toISOString() },
      }));
      queueAction(name, args);
    }
  });
  ws.on('close', () => clients.delete(ws));
});
wss.on('listening', () => console.log(`[mock] WS    ws://127.0.0.1:${WS_PORT}  (Streamer.bot mock)`));

// ── Action runs ──────────────────────────────────────────────────────────────
// Default (argBleed off) behaves like actions in a BLOCKING queue: one run at a time,
// in arrival order, each with its own args.
//
// argBleed on behaves like Streamer.bot's DEFAULT queue as measured on 1.0.7: runs of
// one action that overlap all see ONE request's arguments (the later one, in 25 of 25
// same-client tries). The mock holds each request for BLEED_WINDOW_MS and then runs
// every request for that action that arrived in the window with the LAST one's args.
// Turn it on with MOCK_ARG_BLEED=1 or GET /mock/bleed?on=1.
const ACTIONS = new Set(['Scoreboard Command', 'Scoreboard Push']);
const BLEED_WINDOW_MS = 15;
let argBleed = process.env.MOCK_ARG_BLEED === '1';
let oldCs = false;                 // true: Scoreboard Command does not know `setmany`
const missingActions = new Set();  // action names to answer "was not found" for
const pendingByAction = new Map(); // name → [{ args }]
const runLog = [];                 // [{ action, token, bled }] newest last
let totalRuns = 0, totalBroadcasts = 0;

function runAction(name, args, bled) {
  totalRuns++;
  if (name === 'Scoreboard Command') {
    runLog.push({ action: name, token: resolveCommand(args).token, bled: !!bled });
    // The C# returns false before the push on a rejected command: no broadcast at all.
    if (applyCommand(args)) broadcast();
  } else {
    runLog.push({ action: name, bled: !!bled });
    broadcast(); // "Scoreboard Push" uses WebsocketBroadcastJson: every subscriber gets it
  }
  if (runLog.length > 500) runLog.splice(0, runLog.length - 500);
}

function queueAction(name, args) {
  if (!argBleed) { runAction(name, args, false); return; }
  let pending = pendingByAction.get(name);
  if (!pending) {
    pending = [];
    pendingByAction.set(name, pending);
    setTimeout(() => {
      pendingByAction.delete(name);
      const last = pending[pending.length - 1].args;
      for (let i = 0; i < pending.length; i++) runAction(name, last, pending.length > 1);
    }, BLEED_WINDOW_MS);
  }
  pending.push({ args });
}

function broadcast() {
  totalBroadcasts++;
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
    if (applyCommand({ command: map[k] })) broadcast();
  });
}
