// Automated end-to-end verification of the scoreboard's Streamer.bot seam — no
// Streamer.bot required. It spawns the mock SB server, then:
//
//   1. Loads the REAL tally-shared/panel-core.js (the SB shim) into a minimal browser shim
//      (real `ws` WebSocket) and asserts it re-emits `scoreboard:update` carrying the
//      mock's state — proving Subscribe(lowercase general) + DoAction-on-connect + the
//      General.Custom -> scoreboard:update unwrap into the theme-facing event.
//   2. Drives /mock/cmd mutations (the Stream Deck / chat analog) and asserts each
//      re-broadcast reflects the change (score incr, name set, swap, reset).
//   3. Fetches the shim + real theme panels over the mock's HTTP server and asserts
//      200 + that panels still load "/tally-shared/panel-core.js" — proving SB-style
//      Path->Folder serving of the bundled themes.
//
// It does NOT render pixels; verify-render.mjs does that in a real browser.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = resolve(__dirname, 'tally-shared', 'panel-core.js');
const HTTP_PORT = Number(process.env.SB_HTTP_PORT) || 7475; // off the SB defaults so it coexists with a running SB
const WS_PORT = Number(process.env.SB_WS_PORT) || 8081;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

function startMock() {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['mock-sb-server.mjs'], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SB_HTTP_PORT: String(HTTP_PORT), SB_WS_PORT: String(WS_PORT) },
    });
    let out = '';
    const timer = setTimeout(() => rej(new Error('mock did not start in 8s\n' + out)), 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('[mock] HTTP') && out.includes('[mock] WS')) { clearTimeout(timer); res(child); }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => { if (code) rej(new Error('mock exited ' + code + '\n' + out)); });
  });
}

// Run the real shim under a minimal browser shim; return a `next()` that yields the
// next scoreboard:update/sync detail it dispatches.
async function runShim() {
  const q = [];
  let waiter = null;
  const push = (detail) => {
    q.push(detail);
    if (waiter) { clearTimeout(waiter.timer); const w = waiter; waiter = null; w.resolve(q.shift()); }
  };
  const next = (ms = 4000) => {
    if (q.length) return Promise.resolve(q.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiter = null; reject(new Error('timeout waiting for scoreboard:update')); }, ms);
      waiter = { resolve, timer };
    });
  };

  const listeners = {};
  const window = {
    __SB_WS_URL: `ws://127.0.0.1:${WS_PORT}/`,
    __SB_SYNC_ACTION: 'Scoreboard Push',
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    dispatchEvent(evt) { (listeners[evt.type] || []).forEach((fn) => fn(evt)); },
  };
  const document = {
    readyState: 'complete',
    body: { classList: { toggle() {} } },
    querySelector: () => null,
    addEventListener: () => {},
  };
  const location = { search: '' };
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }

  window.addEventListener('scoreboard:update', (e) => push(e.detail));
  window.addEventListener('scoreboard:sync', (e) => push(e.detail));

  const src = await readFile(SHIM_PATH, 'utf8');
  const fn = new Function('window', 'document', 'location', 'WebSocket', 'CustomEvent', 'setTimeout', 'clearTimeout', 'JSON', 'Math', 'String', 'URLSearchParams', 'console', src);
  fn(window, document, location, WebSocket, CustomEvent, setTimeout, clearTimeout, JSON, Math, String, URLSearchParams, console);
  return { next };
}

// A bare Streamer.bot WebSocket client: request() resolves with the reply to a
// DoAction, nextUpdate() with the next scoreboard:update broadcast not yet consumed.
async function rawClient() {
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/`);
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  const replies = new Map(), waiters = new Map(), updates = [];
  let seq = 0, taken = 0, updWaiter = null;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.id && !m.event) { const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); } else replies.set(m.id, m); return; }
    if (m.event && m.event.source === 'General' && m.event.type === 'Custom' && m.data && m.data.type === 'scoreboard:update') {
      updates.push(m.data);
      if (updWaiter) { const w = updWaiter; updWaiter = null; w(); }
    }
  });
  const frame = (name, args) => { const id = 'r' + (++seq); return { id, text: JSON.stringify({ request: 'DoAction', id, action: { name }, args }) }; };
  const reply = (id, ms = 3000) => new Promise((res, rej) => {
    if (replies.has(id)) return res(replies.get(id));
    const t = setTimeout(() => { waiters.delete(id); rej(new Error('no reply to ' + id)); }, ms);
    waiters.set(id, (m) => { clearTimeout(t); res(m); });
  });
  const c = {
    ws, frame, reply,
    request(name, args) { const f = frame(name, args); ws.send(f.text); return reply(f.id); },
    async nextUpdate(ms = 3000) {
      const until = Date.now() + ms;
      while (taken >= updates.length) {
        const left = until - Date.now();
        if (left <= 0) throw new Error('timeout waiting for a scoreboard:update');
        await new Promise((res) => { updWaiter = res; setTimeout(res, left); });
      }
      return updates[taken++];
    },
    clear() { taken = updates.length; },
    pending() { return updates.length - taken; },
    close() { ws.close(); },
  };
  const sub = 's' + (++seq);
  ws.send(JSON.stringify({ request: 'Subscribe', id: sub, events: { general: ['Custom'] } }));
  await reply(sub);
  return c;
}

async function main() {
  console.log('Lite Scoreboard — Streamer.bot seam verification\n');
  let mock;
  try {
    mock = await startMock();
    console.log(`mock SB up (:${HTTP_PORT} HTTP, :${WS_PORT} WS)\n`);

    // ── 1. Transport: shim re-emits scoreboard:update from a DoAction sync ──────
    console.log('[1] transport: tally-shared/panel-core.js (SB shim) against the mock WS');
    const { next } = await runShim();
    const sync = await next();
    check('scoreboard:update dispatched on connect (DoAction sync)', sync?.fullPayload?.type === 'scoreboard:update', JSON.stringify(sync?.fullPayload?.type));
    check('player1 name/score mapped from state', sync?.player1?.name === 'Player 1' && sync?.player1?.score === 0, JSON.stringify(sync?.player1));
    check('player2 name/score mapped from state', sync?.player2?.name === 'Player 2' && sync?.player2?.score === 0, JSON.stringify(sync?.player2));
    check('header carried through', sync?.header === 'Streamer.bot Lite', sync?.header);

    // ── 2. Live path: /mock/cmd mutations re-broadcast (Stream Deck analog) ─────
    console.log('\n[2] live: /mock/cmd mutations broadcast to the overlay');
    await fetch(`${BASE}/mock/cmd?command=p1%2B`);
    check('p1+ → player1 score 1', (await next())?.player1?.score === 1);
    await fetch(`${BASE}/mock/cmd?command=p1name&value=${encodeURIComponent('PG | Punk')}`);
    check('p1name → player1 name set', (await next())?.player1?.name === 'PG | Punk');
    await fetch(`${BASE}/mock/cmd?command=swap`);
    const sw = await next();
    check('swap → players exchanged (name + score)', sw?.player2?.name === 'PG | Punk' && sw?.player2?.score === 1, JSON.stringify(sw?.player2));
    await fetch(`${BASE}/mock/cmd?command=reset`);
    const rs = await next();
    check('reset → both scores 0', rs?.player1?.score === 0 && rs?.player2?.score === 0, `${rs?.player1?.score}/${rs?.player2?.score}`);

    // ── Flags: alias resolution + payload shape (the C# mirror lives in [4]) ────
    console.log('\n[2b] flags: nation aliases → emoji, fieldsEnabled toggle, swap');
    const GB = '\u{1F1EC}\u{1F1E7}', JP = '\u{1F1EF}\u{1F1F5}';
    for (const alias of ['uk', 'gb', 'britain', 'great%20britain', 'united%20kingdom']) {
      await fetch(`${BASE}/mock/cmd?command=p1flag&value=${alias}`);
      const fl = await next();
      check(`p1flag ${decodeURIComponent(alias)} → 🇬🇧`, fl?.player1?.fields?.flag === GB, JSON.stringify(fl?.player1?.fields));
    }
    await fetch(`${BASE}/mock/cmd?command=p2flag&value=japan`);
    const fj = await next();
    check('p2flag japan → 🇯🇵 + player.flag enabled', fj?.player2?.fields?.flag === JP && fj?.fieldsEnabled?.['player.flag'] === true, JSON.stringify(fj?.fieldsEnabled));
    await fetch(`${BASE}/mock/cmd?command=swap`);
    const fs2 = await next();
    check('swap carries flags', fs2?.player1?.fields?.flag === JP && fs2?.player2?.fields?.flag === GB);
    const bad = await fetch(`${BASE}/mock/cmd?command=p1flag&value=florpland`);
    check('unknown nation rejected (400, no broadcast)', bad.status === 400);
    await fetch(`${BASE}/mock/cmd?command=p1flag&value=none`);
    check('p1flag none → cleared', Object.keys((await next())?.player1?.fields || { x: 1 }).length === 0);
    await fetch(`${BASE}/mock/cmd?command=p2flag&value=clear`);
    const fc = await next();
    check('both cleared → fieldsEnabled empty', !(fc?.fieldsEnabled || {})['player.flag']);
    await fetch(`${BASE}/mock/cmd?command=swap`); await next(); // undo the swap for the tests below

    // ── 2c. Teams mode: optional 3rd/4th slots via the `teams` command ──────────
    console.log('\n[2c] teams: 3-4 team mode payload shape');
    await fetch(`${BASE}/mock/cmd?command=teams&value=4`);
    const t4 = await next();
    check('teams 4 → payload carries teams:4 + player3/player4', t4?.teams === 4 && t4?.player3?.name === 'Player 3' && t4?.player4?.name === 'Player 4', JSON.stringify({ teams: t4?.teams }));
    await fetch(`${BASE}/mock/cmd?command=p3%2B`);
    check('p3+ → player3 score 1', (await next())?.player3?.score === 1);
    await fetch(`${BASE}/mock/cmd?command=p4name&value=${encodeURIComponent('DFM | Squad D')}`);
    check('p4name → player4 name set', (await next())?.player4?.name === 'DFM | Squad D');
    await fetch(`${BASE}/mock/cmd?command=p3flag&value=brazil`);
    const t3f = await next();
    check('p3flag brazil → 🇧🇷 + player.flag enabled', t3f?.player3?.fields?.flag === '\u{1F1E7}\u{1F1F7}' && t3f?.fieldsEnabled?.['player.flag'] === true);
    await fetch(`${BASE}/mock/cmd?command=reset`);
    const t4r = await next();
    check('reset clears all four scores', [1, 2, 3, 4].every((i) => t4r?.['player' + i]?.score === 0));
    await fetch(`${BASE}/mock/cmd?command=teams&value=3`);
    const t3 = await next();
    check('teams 3 → player3 kept, player4 dropped', t3?.teams === 3 && !!t3?.player3 && t3?.player4 === undefined);
    await fetch(`${BASE}/mock/cmd?command=p3flag&value=none`); await next();
    await fetch(`${BASE}/mock/cmd?command=teams&value=2`);
    const t2 = await next();
    check('teams 2 → original two-team shape (no teams/player3 keys)', t2?.teams === undefined && t2?.player3 === undefined && !!t2?.player1);

    // Control-panel path: a DoAction carrying { command, value } args — exactly what
    // tally-shared/control.html sends to type names (and header/subheader) without chat.
    const ctrl = new WebSocket(`ws://127.0.0.1:${WS_PORT}/`);
    await new Promise((res, rej) => { ctrl.on('open', res); ctrl.on('error', rej); });
    ctrl.send(JSON.stringify({ request: 'Subscribe', id: 'c1', events: { general: ['Custom'] } }));
    await new Promise((r) => setTimeout(r, 120));
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c2', action: { name: 'Scoreboard Command' }, args: { command: 'p1name', value: 'The Tyrant' } }));
    check('control-panel DoAction(Scoreboard Command) sets a name', (await next())?.player1?.name === 'The Tyrant');
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c3', action: { name: 'Scoreboard Command' }, args: { command: 'header', value: 'Capcom Cup' } }));
    check('control-panel DoAction sets the header', (await next())?.header === 'Capcom Cup');

    // Name + flag ride ONE DoAction (the `flag` companion arg). Two back-to-back
    // DoActions to the same action arg-bleed on SB 1.0.4 — both ran as p1flag and the
    // name silently never applied, so the panel's box snapped back to the old name.
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c4', action: { name: 'Scoreboard Command' }, args: { command: 'p1name', value: 'Vamp Fatale', flag: 'japan' } }));
    const both = await next();
    check('one DoAction sets name AND flag together (no burst needed)',
      both?.player1?.name === 'Vamp Fatale' && both?.player1?.fields?.flag === JP,
      JSON.stringify(both?.player1));
    // A typo'd nation must not cost you the name — the C# warns and keeps going.
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c5', action: { name: 'Scoreboard Command' }, args: { command: 'p1name', value: 'Blanka-chan', flag: 'florpland' } }));
    const badFlag = await next();
    check('bad companion flag warns but the name still applies',
      badFlag?.player1?.name === 'Blanka-chan' && badFlag?.player1?.fields?.flag === JP,
      JSON.stringify(badFlag?.player1));
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c6', action: { name: 'Scoreboard Command' }, args: { command: 'p1name', value: 'Player 1', flag: 'none' } }));
    await next();

    // `setmany`: many text fields in ONE DoAction — the "edit Player 1 AND Player 2,
    // click Set once" panel flow. Same arg-bleed rationale as the companion flag.
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c7', action: { name: 'Scoreboard Command' }, args: { command: 'setmany', p1name: 'MenaRD', p1flag: 'dominican republic', p2name: 'Kakeru', p2flag: 'japan', header: 'Grand Finals' } }));
    const many = await next();
    check('setmany applies both players + header in one DoAction',
      many?.player1?.name === 'MenaRD' && many?.player2?.name === 'Kakeru'
      && many?.player2?.fields?.flag === JP && many?.header === 'Grand Finals',
      JSON.stringify({ p1: many?.player1, p2: many?.player2, header: many?.header }));
    // A typo'd flag in the batch skips only that field — the rest still lands.
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c8', action: { name: 'Scoreboard Command' }, args: { command: 'setmany', p1name: 'Player 1', p1flag: 'florpland', p2name: 'Player 2', p2flag: 'none', header: 'HEADER', subheader: '' } }));
    const many2 = await next();
    check('setmany bad flag skips that field, rest of batch applies',
      many2?.player1?.name === 'Player 1' && many2?.player2?.name === 'Player 2'
      && many2?.player2?.fields?.flag === undefined && many2?.header === 'HEADER',
      JSON.stringify({ p1: many2?.player1, p2: many2?.player2 }));
    ctrl.close();

    // ── 2d. The mock behaves like Streamer.bot (measured on 1.0.7, see mock header) ─
    console.log('\n[2d] mock fidelity: replies, rejected commands, C# parsing, arg-bleed mode');
    const raw = await rawClient();
    const other = await rawClient();
    const CMD = 'Scoreboard Command';
    // The mock's own counters: how many action runs and broadcasts it has done, and
    // its state. run() sends requests and waits until the mock has run them all, so
    // nothing here depends on the order broadcasts arrive in.
    const stats = async () => (await fetch(`${BASE}/mock/stats`)).json();
    async function run(...frames) { // frames: [client, actionName, args]
      const before = await stats();
      const sent = frames.map(([c, name, args]) => { const f = c.frame(name, args); c.ws.send(f.text); return [c, f.id]; });
      const replies = [];
      for (const [c, id] of sent) replies.push(await c.reply(id));
      const until = Date.now() + 3000;
      let now = await stats();
      while (now.totalRuns < before.totalRuns + frames.length && Date.now() < until) { await new Promise((r) => setTimeout(r, 10)); now = await stats(); }
      return { replies, state: now.state, runs: now.totalRuns - before.totalRuns, broadcasts: now.totalBroadcasts - before.totalBroadcasts, log: now.runs };
    }

    const miss = await raw.request('No Such Action', {});
    check("unknown action → error reply \"was not found\"", miss.status === 'error' && /was not found/.test(miss.error || ''), JSON.stringify(miss));
    const trimmed = await run([raw, CMD, { command: 'header', value: '  Trimmed  ' }]);
    const okReply = trimmed.replies[0];
    check('known action → ok reply echoing its args and naming the queue',
      okReply.status === 'ok' && okReply.args?.command === 'header' && okReply.args?.queueName === 'Mock Blocking' && !!okReply.args?.actionQueuedAt,
      JSON.stringify(okReply));
    check('a single-field value is trimmed, as the C# does', trimmed.state.header === 'Trimmed', JSON.stringify(trimmed.state.header));

    other.clear();
    await raw.request('Scoreboard Push', { reason: 'fidelity' });
    check('Scoreboard Push reaches every subscriber, not only the requester',
      await other.nextUpdate(1500).then((u) => u.header === 'Trimmed', () => false));

    // Rejected commands return before the push in the C#: three runs, no broadcast.
    const rejected = await run(
      [raw, CMD, { command: 'p1flag', value: 'florpland' }],
      [raw, CMD, { command: 'bogus' }],
      [raw, CMD, { command: 'setmany' }]);
    check('rejected commands (bad nation, unknown, empty setmany) run but broadcast nothing',
      rejected.runs === 3 && rejected.broadcasts === 0, JSON.stringify({ runs: rejected.runs, broadcasts: rejected.broadcasts }));

    // Numbers parse as C# int.TryParse does, not as JS parseInt.
    const score = async (v) => (await run([raw, CMD, { command: 'p1score', value: v }])).state.p1score;
    check("p1score '7' → 7", await score('7') === 7);
    check("p1score ' 8 ' → 8 (surrounding spaces)", await score(' 8 ') === 8);
    check("p1score '5.5' → 0 (C# rejects it; JS parseInt would say 5)", await score('5.5') === 0);
    await score('7');
    check("p1score '12abc' → 0 (JS parseInt would say 12)", await score('12abc') === 0);
    check("p1score '100' → clamped to 99", await score('100') === 99);
    check("p1score '-3' → clamped to 0", await score('-3') === 0);
    await run([raw, CMD, { command: 'teams', value: '3' }]);
    check("teams 'four' → falls back to 2, as the C# does today", (await run([raw, CMD, { command: 'teams', value: 'four' }])).state.teams === 2);

    // The calling styles the C# accepts.
    check("chat style A: command '!p1+' → score +1", (await run([raw, CMD, { command: '!p1+' }])).state.p1score === 1);
    check('chat style A: rawInput is the value', (await run([raw, CMD, { command: '!p2name', rawInput: '  Raw Name ' }])).state.p2name === 'Raw Name');
    check("chat style B: '!sb p1name …' dispatches on the first input word",
      (await run([raw, CMD, { command: '!sb', input0: 'p1name', rawInput: 'p1name Dispatch Name' }])).state.p1name === 'Dispatch Name');
    check('an explicit value argument wins over rawInput', (await run([raw, CMD, { command: 'p1name', value: 'Explicit', rawInput: 'ignored' }])).state.p1name === 'Explicit');

    // Arg-bleed mode: what SB's default queue does to same-action requests that arrive
    // together. Both runs see the LATER request's arguments, so the first command is lost.
    const reset1 = () => run([raw, CMD, { command: 'p1score', value: '1' }]).then(() => run([raw, CMD, { command: 'p2score', value: '1' }]));
    const burst = (a, b) => run([a, CMD, { command: 'p1score', value: '4' }], [b, CMD, { command: 'p2score', value: '6' }]);
    await reset1();
    const calm = await burst(raw, raw);
    check('bleed off (blocking queue): two back-to-back commands both apply',
      calm.state.p1score === 4 && calm.state.p2score === 6, JSON.stringify({ p1: calm.state.p1score, p2: calm.state.p2score }));
    await fetch(`${BASE}/mock/bleed?on=1`);
    await reset1();
    const bledSame = await burst(raw, raw);
    check('bleed on, one socket: both runs use the later arguments (first command lost)',
      bledSame.state.p1score === 1 && bledSame.state.p2score === 6 && bledSame.replies[0].args?.queueName === 'Default',
      JSON.stringify({ p1: bledSame.state.p1score, p2: bledSame.state.p2score, q: bledSame.replies[0].args?.queueName }));
    check('the mock logs both of those runs as bled, with the later token',
      bledSame.log.slice(-2).every((r) => r.bled && r.token === 'p2score'), JSON.stringify(bledSame.log.slice(-2)));
    await reset1();
    const bledCross = await burst(raw, other);
    check('bleed on, two sockets: the same loss', bledCross.state.p1score === 1 && bledCross.state.p2score === 6,
      JSON.stringify({ p1: bledCross.state.p1score, p2: bledCross.state.p2score }));
    await fetch(`${BASE}/mock/bleed?on=0`);
    const badPath = await fetch(`${BASE}/%E0%A4%A`);
    check('a malformed percent-escape in a path gets a 400, and the mock stays up', badPath.status === 400 && (await fetch(`${BASE}/mock/stats`)).status === 200);
    raw.close(); other.close();

    // ── 3. HTTP: SB-style serving of the shim + untouched themes ───────────────
    console.log('\n[3] HTTP: SB-style Path->Folder serving');
    const shimRes = await fetch(`${BASE}/tally-shared/panel-core.js`);
    const shimBody = await shimRes.text();
    check('/tally-shared/panel-core.js 200 javascript', shimRes.status === 200 && (shimRes.headers.get('content-type') || '').includes('javascript'));
    check('served shim subscribes with LOWERCASE general', shimBody.includes("general: ['Custom']"), 'the SB Subscribe case gotcha');
    check('served shim dispatches scoreboard:update', shimBody.includes('scoreboard:update'));

    for (const panel of [
      '/tally-themes/primetime/panels/title-309x49.html',
      '/tally-themes/primetime/panels/player1-strip-545x63.html',
      '/tally-themes/primetime/panels/player2-strip-545x63.html',
      '/tally-themes/primetime/panels/player3-strip-545x63.html',
      '/tally-themes/primetime/panels/player4-strip-545x63.html',
    ]) {
      const r = await fetch(`${BASE}${panel}`);
      const b = await r.text();
      check(`panel 200 + loads /tally-shared/panel-core.js: ${panel.split('/').slice(-2).join('/')}`, r.status === 200 && b.includes('/tally-shared/panel-core.js'), 'status ' + r.status);
    }
    const cssRes = await fetch(`${BASE}/tally-themes/primetime/theme.css`);
    await cssRes.arrayBuffer();
    check('theme.css 200 text/css', cssRes.status === 200 && (cssRes.headers.get('content-type') || '').includes('text/css'));

    const idxRes = await fetch(`${BASE}/`);
    const idxBody = await idxRes.text();
    check('panel index 200 lists themes', idxRes.status === 200 && /Primetime/i.test(idxBody));

    const ctrlRes = await fetch(`${BASE}/tally-shared/control.html`);
    const ctrlBody = await ctrlRes.text();
    check('/tally-shared/control.html 200 + wired to Scoreboard Command', ctrlRes.status === 200 && ctrlBody.includes('Scoreboard Command'));
    check('control.html loads nations.js + has flag inputs', ctrlBody.includes('nations.js') && ctrlBody.includes('p1flag'));
    check('control.html has teams selector + P3/P4 cards', ctrlBody.includes('data-teams') && ctrlBody.includes('card-p3') && ctrlBody.includes('card-p4'));
    // Both halves of the one-DoAction name+flag fix must exist, or a Set silently
    // half-applies: the panel sends the companion arg, the C# has to read it.
    const cmdSrc = await readFile(resolve(__dirname, 'actions', 'scoreboard-command.cs'), 'utf8');
    check('control.html sends the flag as a companion arg (not a 2nd DoAction)', /send\(setCmd,\s*vals\[setCmd\],\s*\{\s*flag:/.test(ctrlBody));
    check('scoreboard-command.cs reads the companion `flag` arg', /Arg\("flag"/.test(cmdSrc));
    // The batched-Set halves: the panel tracks dirty fields + sends `setmany`,
    // and the C# dispatches it — missing either side half-applies a multi-edit.
    check('control.html tracks dirty fields + batches via setmany', /dirty\[f\]/.test(ctrlBody) && /send\('setmany'/.test(ctrlBody));
    check('scoreboard-command.cs dispatches setmany', /case "setmany"/.test(cmdSrc) && /"setmany",/.test(cmdSrc));
    const natRes = await fetch(`${BASE}/tally-shared/nations.js`);
    check('/tally-shared/nations.js 200 javascript', natRes.status === 200 && (natRes.headers.get('content-type') || '').includes('javascript'));
    await natRes.arrayBuffer();

    // ── 4. Nation table parity: tally-shared/nations.js ↔ scoreboard-command.cs ─
    // The C# carries a mechanical copy of the JS map; diff them so they can't drift.
    console.log('\n[4] nations: JS ↔ C# alias-table parity');
    await import('./tally-shared/nations.js');
    const jsMap = globalThis.Nations.MAP;
    const csSrc = await readFile(resolve(__dirname, 'actions', 'scoreboard-command.cs'), 'utf8');
    const csMap = {};
    for (const m of csSrc.matchAll(/M\["([^"]+)"\]\s*=\s*"([a-z]{2})"/g)) csMap[m[1]] = m[2];
    const jsKeys = Object.keys(jsMap), csKeys = Object.keys(csMap);
    const missingInCs = jsKeys.filter((k) => csMap[k] !== jsMap[k]);
    const missingInJs = csKeys.filter((k) => jsMap[k] !== csMap[k]);
    check(`entry counts match (js=${jsKeys.length}, cs=${csKeys.length})`, jsKeys.length === csKeys.length && jsKeys.length > 200);
    check('every JS entry present in C# with same ISO', missingInCs.length === 0, missingInCs.slice(0, 5).join(', '));
    check('every C# entry present in JS with same ISO', missingInJs.length === 0, missingInJs.slice(0, 5).join(', '));
    check("resolver: 'uk' → 🇬🇧", globalThis.Nations.resolveFlag('uk') === GB);
    check("resolver: 'Great-Britain' → 🇬🇧 (normalization)", globalThis.Nations.resolveFlag('Great-Britain') === GB);
    check("resolver: bare ISO 'fr' → 🇫🇷", globalThis.Nations.resolveFlag('fr') === '\u{1F1EB}\u{1F1F7}');
    check('resolver: emoji passthrough', globalThis.Nations.resolveFlag(GB) === GB);
    check("resolver: 'florpland' → null", globalThis.Nations.resolveFlag('florpland') === null);

    // ── 5. Roster helper: CORS + input validation (no external network) ─────────
    console.log('\n[5] roster helper: starts, CORS, rejects bad input');
    const HELPER_PORT = Number(process.env.ROSTER_PORT) || 7482;
    const helper = await new Promise((res2, rej2) => {
      const child = spawn(process.execPath, ['roster-helper.mjs'], {
        cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ROSTER_PORT: String(HELPER_PORT) },
      });
      let out = '';
      const t = setTimeout(() => rej2(new Error('helper no start\n' + out)), 6000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (d) => { out += d; if (out.includes('[roster] helper listening')) { clearTimeout(t); res2(child); } });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (d) => { out += d; });
    });
    try {
      const HB = `http://127.0.0.1:${HELPER_PORT}`;
      const noUrl = await fetch(`${HB}/import`);
      check('GET /import without url → 400 {ok:false}', noUrl.status === 400 && (await noUrl.json()).ok === false);
      check('CORS header present', noUrl.headers.get('access-control-allow-origin') === '*');
      const badUrl = await fetch(`${HB}/import?url=${encodeURIComponent('https://example.com/not-a-bracket')}`);
      const badBody = await badUrl.json();
      check('unsupported URL → 400 + platform list in error', badUrl.status === 400 && /Challonge/i.test(badBody.error || ''), JSON.stringify(badBody));
      const opt = await fetch(`${HB}/import`, { method: 'OPTIONS' });
      check('OPTIONS preflight → 204 + CORS', opt.status === 204 && opt.headers.get('access-control-allow-origin') === '*');
    } finally {
      helper.kill();
    }
  } catch (err) {
    failed++;
    console.log('\n  ERROR ' + ((err && err.stack) || err));
  } finally {
    if (mock) mock.kill();
  }

  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
