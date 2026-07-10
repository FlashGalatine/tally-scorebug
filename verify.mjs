// Automated end-to-end verification of the scoreboard's Streamer.bot seam — no
// Streamer.bot required. It spawns the mock SB server, then:
//
//   1. Loads the REAL shared/panel-core.js (the SB shim) into a minimal browser shim
//      (real `ws` WebSocket) and asserts it re-emits `scoreboard:update` carrying the
//      mock's state — proving Subscribe(lowercase general) + DoAction-on-connect + the
//      General.Custom -> scoreboard:update unwrap into the theme-facing event.
//   2. Drives /mock/cmd mutations (the Stream Deck / chat analog) and asserts each
//      re-broadcast reflects the change (score incr, name set, swap, reset).
//   3. Fetches the shim + real theme panels over the mock's HTTP server and asserts
//      200 + that panels still load "/shared/panel-core.js" — proving SB-style
//      Path->Folder serving with the themes byte-for-byte untouched.
//
// It does NOT render pixels; verify-render.mjs does that in a real browser.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = resolve(__dirname, 'shared', 'panel-core.js');
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

async function main() {
  console.log('Lite Scoreboard — Streamer.bot seam verification\n');
  let mock;
  try {
    mock = await startMock();
    console.log(`mock SB up (:${HTTP_PORT} HTTP, :${WS_PORT} WS)\n`);

    // ── 1. Transport: shim re-emits scoreboard:update from a DoAction sync ──────
    console.log('[1] transport: shared/panel-core.js (SB shim) against the mock WS');
    const { next } = await runShim();
    const sync = await next();
    check('scoreboard:update dispatched on connect (DoAction sync)', !!sync);
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

    // Control-panel path: a DoAction carrying { command, value } args — exactly what
    // shared/control.html sends to type names (and header/subheader) without chat.
    const ctrl = new WebSocket(`ws://127.0.0.1:${WS_PORT}/`);
    await new Promise((res, rej) => { ctrl.on('open', res); ctrl.on('error', rej); });
    ctrl.send(JSON.stringify({ request: 'Subscribe', id: 'c1', events: { general: ['Custom'] } }));
    await new Promise((r) => setTimeout(r, 120));
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c2', action: { name: 'Scoreboard Command' }, args: { command: 'p1name', value: 'The Tyrant' } }));
    check('control-panel DoAction(Scoreboard Command) sets a name', (await next())?.player1?.name === 'The Tyrant');
    ctrl.send(JSON.stringify({ request: 'DoAction', id: 'c3', action: { name: 'Scoreboard Command' }, args: { command: 'header', value: 'Capcom Cup' } }));
    check('control-panel DoAction sets the header', (await next())?.header === 'Capcom Cup');
    ctrl.close();

    // ── 3. HTTP: SB-style serving of the shim + untouched themes ───────────────
    console.log('\n[3] HTTP: SB-style Path->Folder serving');
    const shimRes = await fetch(`${BASE}/shared/panel-core.js`);
    const shimBody = await shimRes.text();
    check('/shared/panel-core.js 200 javascript', shimRes.status === 200 && (shimRes.headers.get('content-type') || '').includes('javascript'));
    check('served shim subscribes with LOWERCASE general', shimBody.includes("general: ['Custom']"), 'the SB Subscribe case gotcha');
    check('served shim dispatches scoreboard:update', shimBody.includes('scoreboard:update'));

    for (const panel of [
      '/themes/primetime/panels/title-309x49.html',
      '/themes/primetime/panels/player1-strip-545x63.html',
      '/themes/primetime/panels/player2-strip-545x63.html',
    ]) {
      const r = await fetch(`${BASE}${panel}`);
      const b = await r.text();
      check(`panel 200 + loads /shared/panel-core.js: ${panel.split('/').slice(-2).join('/')}`, r.status === 200 && b.includes('/shared/panel-core.js'), 'status ' + r.status);
    }
    const cssRes = await fetch(`${BASE}/themes/primetime/theme.css`);
    await cssRes.arrayBuffer();
    check('theme.css 200 text/css', cssRes.status === 200 && (cssRes.headers.get('content-type') || '').includes('text/css'));

    const idxRes = await fetch(`${BASE}/`);
    const idxBody = await idxRes.text();
    check('panel index 200 lists themes', idxRes.status === 200 && /Primetime/i.test(idxBody));

    const ctrlRes = await fetch(`${BASE}/shared/control.html`);
    const ctrlBody = await ctrlRes.text();
    check('/shared/control.html 200 + wired to Scoreboard Command', ctrlRes.status === 200 && ctrlBody.includes('Scoreboard Command'));
    check('control.html loads nations.js + has flag inputs', ctrlBody.includes('nations.js') && ctrlBody.includes('p1flag'));
    const natRes = await fetch(`${BASE}/shared/nations.js`);
    check('/shared/nations.js 200 javascript', natRes.status === 200 && (natRes.headers.get('content-type') || '').includes('javascript'));
    await natRes.arrayBuffer();

    // ── 4. Nation table parity: shared/nations.js ↔ scoreboard-command.cs ───────
    // The C# carries a mechanical copy of the JS map; diff them so they can't drift.
    console.log('\n[4] nations: JS ↔ C# alias-table parity');
    await import('./shared/nations.js');
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
