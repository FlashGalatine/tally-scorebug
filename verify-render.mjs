// Real-pixel verification: prove the UNTOUCHED Primetime theme renders the
// Streamer.bot broadcast in a real browser, driven only by the SB shim + mock. This
// is the render half that verify.mjs (protocol-only) deliberately skips.
//
// Requires a Chromium channel on the machine (system Edge/Chrome):
//   npm install --no-save playwright-core
// It opens the title panel + the P1 strip over the mock's HTTP server, asserts the
// synced values paint, drives live changes (name/score/flag via /mock/cmd and the
// control panel), asserts the panels update, and writes test-render.png /
// control-render.png (gitignored).
//
// It never writes tally-shared/roster.json: the sample rosters are served to the page
// by intercepting the request, so an operator's imported roster is left alone even
// if this run is interrupted.

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTTP_PORT = Number(process.env.SB_HTTP_PORT) || 7476;
const WS_PORT = Number(process.env.SB_WS_PORT) || 8082;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;
// Panels are served over http://, so the ?sbport override reaches the shim (a file://
// OBS source could not take this query param — see the README gotcha).
const titleUrl = `${BASE}/tally-themes/primetime/panels/title-309x49.html?sbport=${WS_PORT}`;
const stripUrl = `${BASE}/tally-themes/primetime/panels/player1-strip-545x63.html?sbport=${WS_PORT}`;

let passed = 0, failed = 0;
const check = (n, ok, d) => { ok ? passed++ : failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${!ok && d ? ' — ' + d : ''}`); };

function startMock() {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['mock-sb-server.mjs'], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SB_HTTP_PORT: String(HTTP_PORT), SB_WS_PORT: String(WS_PORT) },
    });
    let out = '';
    const timer = setTimeout(() => rej(new Error('mock did not start in 8s\n' + out)), 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; if (out.includes('[mock] HTTP') && out.includes('[mock] WS')) { clearTimeout(timer); res(child); } });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { out += d; });
    child.on('exit', (code) => { if (code) rej(new Error('mock exited ' + code + '\n' + out)); });
  });
}

async function launch() {
  for (const ch of ['msedge', 'chrome']) { try { return await chromium.launch({ channel: ch, headless: true }); } catch {} }
  return await chromium.launch({ headless: true });
}

async function main() {
  console.log('Scorebug — real-pixel render verification (Primetime)\n');
  let mock, browser;
  try {
    mock = await startMock();
    console.log(`mock SB up (:${HTTP_PORT} HTTP, :${WS_PORT} WS)\n`);
    browser = await launch();

    // ── Title panel: header + subheader from sync ───────────────────────────────
    const titlePage = await browser.newPage({ viewport: { width: 309, height: 49 }, deviceScaleFactor: 2 });
    await titlePage.goto(titleUrl, { waitUntil: 'load' });
    const titleSynced = await titlePage.waitForFunction(
      () => document.getElementById('header') && document.getElementById('header').textContent.trim() === 'Streamer.bot Lite'
        && document.getElementById('subheader').textContent.trim() === 'FT2',
      { timeout: 8000 }).then(() => true).catch(() => false);
    check('title panel renders synced header + subheader (DoAction-on-connect)', titleSynced,
      await titlePage.evaluate(() => document.getElementById('header').textContent + ' / ' + document.getElementById('subheader').textContent));

    // ── P1 strip: name + score sync, then live edits ────────────────────────────
    const stripPage = await browser.newPage({ viewport: { width: 545, height: 63 }, deviceScaleFactor: 2 });
    await stripPage.goto(stripUrl, { waitUntil: 'load' });
    const stripSynced = await stripPage.waitForFunction(
      () => { const el = document.getElementById('pname'); return el && el.textContent.trim() === 'Player 1'; },
      { timeout: 8000 }).then(() => true).catch(() => false);
    check('strip renders the synced name', stripSynced, await stripPage.evaluate(() => document.getElementById('pname').textContent));

    await fetch(`${BASE}/mock/cmd?command=p1name&value=PUNK`);
    const nameLive = await stripPage.waitForFunction(
      () => document.getElementById('pname').textContent.trim() === 'PUNK', { timeout: 6000 }).then(() => true).catch(() => false);
    check('strip updates the name live on /mock/cmd', nameLive, await stripPage.evaluate(() => document.getElementById('pname').textContent));

    await fetch(`${BASE}/mock/cmd?command=p1%2B`);
    const scoreLive = await stripPage.waitForFunction(
      () => document.getElementById('score').textContent.trim() === '1', { timeout: 6000 }).then(() => true).catch(() => false);
    check('strip score increments live on p1+', scoreLive, await stripPage.evaluate(() => document.getElementById('score').textContent));

    // Sponsor | Player split is a strip feature — prove it renders both parts.
    await fetch(`${BASE}/mock/cmd?command=p1name&value=${encodeURIComponent('PG | Punk')}`);
    const sponsorOK = await stripPage.waitForFunction(
      () => document.getElementById('sponsor').textContent.trim() === 'PG'
        && document.getElementById('pname').textContent.trim() === 'Punk'
        && !document.getElementById('sponsor').classList.contains('hidden'),
      { timeout: 6000 }).then(() => true).catch(() => false);
    check('strip splits "Sponsor | Player" into the sponsor plate', sponsorOK,
      await stripPage.evaluate(() => document.getElementById('sponsor').textContent + ' | ' + document.getElementById('pname').textContent));

    // ── Control panel: roster autofill + flags, no chat ─────────────────────────
    const JP = '\u{1F1EF}\u{1F1F5}';
    const sampleRoster = {
      tournament: 'sample-cup', platform: 'sample',
      names: ['Blanka-chan', 'The Tyrant', 'Vamp Fatale', 'Wicked Thunder'],
      players: [
        { name: 'Blanka-chan', flag: '\u{1F1E7}\u{1F1F7}' },
        { name: 'The Tyrant', flag: '\u{1F1EC}\u{1F1E7}' },
        { name: 'Vamp Fatale', flag: JP },
        { name: 'Wicked Thunder', flag: null },
      ],
    };
    const ctrlPage = await browser.newPage({ viewport: { width: 420, height: 760 } });
    await ctrlPage.route('**/tally-shared/roster.json', (route) => route.fulfill({ json: sampleRoster }));
    // Tap outbound WebSocket frames before the page's own script runs. The count is
    // the load-bearing assertion below: SB 1.0.4 arg-bleeds two DoActions to the same
    // action within a few ms, so a Set click must produce exactly ONE.
    await ctrlPage.addInitScript(() => {
      window.__sent = [];
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) { try { window.__sent.push(String(data)); } catch {} return send.call(this, data); };
    });
    await ctrlPage.goto(`${BASE}/tally-shared/control.html?sbport=${WS_PORT}`, { waitUntil: 'load' });
    const ctrlSynced = await ctrlPage.waitForFunction(
      () => document.getElementById('p1name').value === 'PG | Punk' && document.getElementById('p1score').textContent.trim() === '1',
      { timeout: 8000 }).then(() => true).catch(() => false);
    check('control panel connects + reflects current state', ctrlSynced,
      await ctrlPage.evaluate(() => document.getElementById('p1name').value + ' / ' + document.getElementById('p1score').textContent));

    await ctrlPage.click('button[data-cmd="p1+"]');
    const ctrlBump = await ctrlPage.waitForFunction(
      () => document.getElementById('p1score').textContent.trim() === '2', { timeout: 6000 }).then(() => true).catch(() => false);
    check('control panel "+" button bumps the score to 2', ctrlBump, await ctrlPage.evaluate(() => document.getElementById('p1score').textContent));

    // ── In-page typeahead (replaces the native <datalist>) ────────────────────
    // OBS docks/sources are CEF *Alloy-style* browsers: Chromium draws <datalist>
    // suggestions with the browser's Autofill popup, which Alloy CEF does not have
    // (CEF issue #906, wontfix) — the list worked in Chrome/Firefox tabs and showed
    // nothing in an OBS dock. So the suggestions are rendered IN the page.
    await ctrlPage.evaluate(() => { window.__sent.length = 0; });
    await ctrlPage.fill('#p1name', 'vam');
    const taOpen = await ctrlPage.waitForFunction(() => {
      const ul = document.getElementById('p1suggest');
      return ul && !ul.hidden && ul.querySelectorAll('[role="option"]').length === 1 && ul.textContent.includes('Vamp Fatale');
    }, { timeout: 4000 }).then(() => true).catch(() => false);
    const noDatalist = await ctrlPage.evaluate(() => !document.getElementById('p1name').hasAttribute('list') && !document.querySelector('datalist'));
    check('typing a roster prefix opens the in-page suggestion list (no native <datalist>)', taOpen && noDatalist,
      await ctrlPage.evaluate(() => { const ul = document.getElementById('p1suggest'); return ul ? ('hidden=' + ul.hidden + ' ' + ul.textContent) : '(no #p1suggest)'; }));

    // Keyboard pick: ArrowDown highlights, Enter picks — and that Enter must NOT be
    // the "Enter in a name box = Set" shortcut (no DoAction until the user Sets).
    await ctrlPage.keyboard.press('ArrowDown');
    await ctrlPage.keyboard.press('Enter');
    const picked = await ctrlPage.waitForFunction(
      () => document.getElementById('p1name').value === 'Vamp Fatale' && document.getElementById('p1suggest').hidden,
      { timeout: 4000 }).then(() => true).catch(() => false);
    const enterDidNotSet = await ctrlPage.evaluate(() => !window.__sent.some((s) => s.includes('"DoAction"')));
    check('ArrowDown + Enter picks the suggestion and closes the list (no Set fired)', picked && enterDidNotSet,
      await ctrlPage.evaluate(() => document.getElementById('p1name').value + ' / sent=' + window.__sent.length));

    // Roster autofill: picking/typing an exact roster name fills that player's flag.
    const autofill = await ctrlPage.waitForFunction(
      (jp) => document.getElementById('p1flag').value === jp && document.getElementById('p1flagprev').textContent === jp,
      JP, { timeout: 4000 }).then(() => true).catch(() => false);
    check('roster pick auto-fills the flag box (+ preview)', autofill,
      await ctrlPage.evaluate(() => document.getElementById('p1flag').value + ' / ' + document.getElementById('p1flagprev').textContent));

    await ctrlPage.evaluate(() => { window.__sent.length = 0; });
    await ctrlPage.click('button[data-set="p1name"]');
    // The regression guard for the bug where Set on a name did nothing: the click must
    // emit ONE DoAction carrying both `value` (name) and `flag`. Two DoActions here
    // arg-bleed on real SB — both landed as p1flag, the name never applied, and the
    // next broadcast reflected the old name back into the box.
    const sentForSet = await ctrlPage.evaluate(() => window.__sent.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean));
    const doActions = sentForSet.filter((m) => m.request === 'DoAction');
    check('name Set emits exactly ONE DoAction (SB burst arg-bleed guard)', doActions.length === 1,
      doActions.length + ': ' + JSON.stringify(doActions.map((m) => m.args)));
    check('that DoAction carries the name in `value` and the flag alongside it',
      doActions[0]?.args?.command === 'p1name' && doActions[0]?.args?.value === 'Vamp Fatale' && doActions[0]?.args?.flag === JP,
      JSON.stringify(doActions[0]?.args));

    // One Set applies name + flag: the strip shows the name AND maps the emoji to
    // the flag-icons jp.svg, from the theme's own flags/ folder, in its flag cell.
    const nameEcho = await stripPage.waitForFunction(
      () => document.getElementById('pname').textContent.trim() === 'Vamp Fatale', { timeout: 6000 }).then(() => true).catch(() => false);
    check('typing a name in the control panel updates the strip (no chat)', nameEcho, await stripPage.evaluate(() => document.getElementById('pname').textContent));
    const flagShown = await stripPage.waitForFunction(() => {
      const img = document.getElementById('flag');
      const cell = document.getElementById('flag-cell');
      return img && img.dataset.code === 'jp' && img.naturalWidth > 0 && cell && !cell.classList.contains('hidden');
    }, { timeout: 6000 }).then(() => true).catch(() => false);
    check('strip flag cell shows the autofilled flag (jp.svg)', flagShown,
      await stripPage.evaluate(() => { const i = document.getElementById('flag'); return i ? (i.dataset.code + ' w=' + i.naturalWidth) : '(no img)'; }));

    // Override: type a nation alias over the autofill and Set just the flag.
    await ctrlPage.fill('#p1flag', 'uk');
    await ctrlPage.click('button[data-set="p1flag"]');
    const flagOverride = await stripPage.waitForFunction(
      () => { const i = document.getElementById('flag'); return !!i && i.dataset.code === 'gb' && i.naturalWidth > 0; },
      { timeout: 6000 }).then(() => true).catch(() => false);
    check("flag override: 'uk' alias → gb.svg on the strip", flagOverride,
      await stripPage.evaluate(() => (document.getElementById('flag') || {}).src || '(no img)'));

    // ── Batched Set: edit BOTH players, click Set once, both land ─────────────
    // First the dirty guard: a typed-but-unset edit must survive a broadcast
    // (this was the bug — reflect() snapped Player 2's box back to the old name).
    await ctrlPage.fill('#p2name', 'Kakeru');
    await ctrlPage.click('button[data-cmd="p1+"]'); // triggers a state broadcast
    const dirtyKept = await ctrlPage.waitForFunction(
      () => document.getElementById('p1score').textContent.trim() === '3' && document.getElementById('p2name').value === 'Kakeru',
      { timeout: 6000 }).then(() => true).catch(() => false);
    check('typed-but-unset Player 2 name survives a broadcast (dirty guard)', dirtyKept,
      await ctrlPage.evaluate(() => document.getElementById('p2name').value));
    // Then the flush: editing P1 too and clicking ONE Set sends ONE setmany
    // DoAction carrying both players (a burst would arg-bleed on real SB).
    await ctrlPage.fill('#p1name', 'MenaRD');
    await ctrlPage.evaluate(() => { window.__sent.length = 0; });
    await ctrlPage.click('button[data-set="p1name"]');
    const sentBatch = await ctrlPage.evaluate(() => window.__sent.map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(Boolean));
    const batchDo = sentBatch.filter((m) => m.request === 'DoAction');
    check('two-player edit + one Set click emits ONE setmany DoAction',
      batchDo.length === 1 && batchDo[0]?.args?.command === 'setmany'
      && batchDo[0]?.args?.p1name === 'MenaRD' && batchDo[0]?.args?.p2name === 'Kakeru',
      JSON.stringify(batchDo.map((m) => m.args)));
    const bothLanded = await stripPage.waitForFunction(
      () => document.getElementById('pname').textContent.trim() === 'MenaRD', { timeout: 6000 }).then(() => true).catch(() => false)
      && await ctrlPage.evaluate(() => document.getElementById('p2name').value === 'Kakeru');
    check('setmany applied both names (strip shows P1, panel keeps P2)', !!bothLanded,
      await stripPage.evaluate(() => document.getElementById('pname').textContent));

    // The same gesture with the mock's arg-bleed mode ON (Streamer.bot's default,
    // non-blocking queue): because the click is ONE DoAction there is nothing for the
    // arguments to mix with, so both names must still land. A regression to two
    // DoActions would lose the first one here.
    await fetch(`${BASE}/mock/bleed?on=1`);
    await ctrlPage.fill('#p1name', 'Bleed One');
    await ctrlPage.fill('#p2name', 'Bleed Two');
    await ctrlPage.click('button[data-set="p1name"]');
    let bleedState = null;
    for (const until = Date.now() + 4000; Date.now() < until;) {
      bleedState = (await (await fetch(`${BASE}/mock/stats`)).json()).state;
      if (bleedState.p1name === 'Bleed One' && bleedState.p2name === 'Bleed Two') break;
      await ctrlPage.waitForTimeout(25);
    }
    await fetch(`${BASE}/mock/bleed?on=0`);
    check('arg-bleed mode on: one Set click still applies both players',
      bleedState?.p1name === 'Bleed One' && bleedState?.p2name === 'Bleed Two', JSON.stringify({ p1: bleedState?.p1name, p2: bleedState?.p2name }));

    // Browse: an empty name box + ArrowDown lists the whole roster; Escape closes it.
    await ctrlPage.fill('#p2name', '');
    await ctrlPage.keyboard.press('ArrowDown');
    const browse = await ctrlPage.waitForFunction(() => {
      const ul = document.getElementById('p2suggest'); return ul && !ul.hidden && ul.querySelectorAll('[role="option"]').length === 4;
    }, { timeout: 4000 }).then(() => true).catch(() => false);
    check('empty name + ArrowDown browses the full roster (4 entrants)', browse,
      await ctrlPage.evaluate(() => { const ul = document.getElementById('p2suggest'); return ul ? ('hidden=' + ul.hidden + ' n=' + ul.querySelectorAll('[role="option"]').length) : '(no #p2suggest)'; }));
    await ctrlPage.keyboard.press('Escape');
    const escClosed = await ctrlPage.waitForFunction(
      () => document.getElementById('p2suggest').hidden && document.getElementById('p2name').value === '',
      { timeout: 4000 }).then(() => true).catch(() => false);
    check('Escape closes the list without touching the box', escClosed);

    // Substring match + mouse pick: "thunder" finds Wicked Thunder; clicking it fills the box.
    await ctrlPage.fill('#p2name', 'thunder');
    const subMatch = await ctrlPage.waitForFunction(() => {
      const ul = document.getElementById('p2suggest');
      return ul && !ul.hidden && ul.querySelectorAll('[role="option"]').length === 1 && ul.textContent.includes('Wicked Thunder');
    }, { timeout: 4000 }).then(() => true).catch(() => false);
    if (subMatch) await ctrlPage.click('#p2suggest [role="option"]');
    const clicked = await ctrlPage.waitForFunction(
      () => document.getElementById('p2name').value === 'Wicked Thunder' && document.getElementById('p2suggest').hidden,
      { timeout: 4000 }).then(() => true).catch(() => false);
    check('substring match ("thunder") + click picks Wicked Thunder', subMatch && clicked,
      await ctrlPage.evaluate(() => document.getElementById('p2name').value));

    // ── Teams mode: P3 strip hides at 2 teams, paints at 3+, control cards follow ─
    const p3Page = await browser.newPage({ viewport: { width: 545, height: 63 }, deviceScaleFactor: 2 });
    await p3Page.goto(`${BASE}/tally-themes/primetime/panels/player3-strip-545x63.html?sbport=${WS_PORT}`, { waitUntil: 'load' });
    const p3Hidden = await p3Page.waitForFunction(
      () => document.querySelector('.pt-root') && document.querySelector('.pt-root').classList.contains('hidden'),
      { timeout: 8000 }).then(() => true).catch(() => false);
    check('P3 strip hidden in two-team mode', p3Hidden);
    await fetch(`${BASE}/mock/cmd?command=teams&value=3`);
    await fetch(`${BASE}/mock/cmd?command=p3name&value=${encodeURIComponent('Third Wheel')}`);
    const p3Shown = await p3Page.waitForFunction(
      () => !document.querySelector('.pt-root').classList.contains('hidden')
        && document.getElementById('pname').textContent.trim() === 'Third Wheel',
      { timeout: 6000 }).then(() => true).catch(() => false);
    check('teams 3 → P3 strip appears + renders the name', p3Shown,
      await p3Page.evaluate(() => document.getElementById('pname').textContent));
    const p3Card = await ctrlPage.waitForFunction(
      () => !document.getElementById('card-p3').classList.contains('hide')
        && document.getElementById('card-p4').classList.contains('hide'),
      { timeout: 6000 }).then(() => true).catch(() => false);
    check('control panel shows the P3 card (and not P4) at teams 3', p3Card);
    await fetch(`${BASE}/mock/cmd?command=teams&value=2`);
    const p3Rehidden = await p3Page.waitForFunction(
      () => document.querySelector('.pt-root').classList.contains('hidden'), { timeout: 6000 }).then(() => true).catch(() => false);
    check('teams 2 → P3 strip hides again', p3Rehidden);
    await p3Page.close();

    await verifyOpponentAutofill(browser);
    await verifyFlagBox(browser);
    await verifySendQueue(browser);
    await verifyImport(browser);
    await verifyOffline(browser);

    await stripPage.screenshot({ path: resolve(__dirname, 'test-render.png') });
    await ctrlPage.screenshot({ path: resolve(__dirname, 'control-render.png') });
    console.log('  screenshots → test-render.png, control-render.png');
  } catch (err) {
    failed++;
    console.log('\n  ERROR ' + ((err && err.stack) || err));
  } finally {
    if (browser) { try { await browser.close(); } catch {} }
    if (mock) mock.kill();
  }

  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

async function verifyOpponentAutofill(browser) {
  const p = await browser.newPage({ viewport: { width: 380, height: 820 } });
  const errors = [];
  p.on('pageerror', err => errors.push(err.message));
  const fixture = { platform: 'startgg', tournament: 'fixture/singles', eventId: '101', players: [
    { id: '11', name: 'Alpha', flag: '🇯🇵' }, { id: '22', name: 'Beta', flag: '🇺🇸' },
    { id: '33', name: 'Gamma', flag: null },
  ] };
  let calls = 0, answered = 0, held, release;
  let result = { ok: true, status: 'found', opponent: { id: '22', name: 'Beta', flag: '🇺🇸' }, set: { round: 'Winners Final' } };
  await p.route('**/tally-shared/roster.json', route => route.fulfill({ json: fixture }));
  await p.route('http://127.0.0.1:7481/opponent?**', async route => {
    calls++;
    const response = result;
    if (held) { const wait = held; held = null; await wait; }
    try { await route.fulfill({ json: response }); } catch { /* the page aborted this lookup */ }
    answered++;
  });
  await p.addInitScript(() => {
    window.__sent = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { window.__scorebugSocket = this; window.__sent.push(JSON.parse(data)); return send.call(this, data); };
  });
  async function fresh() {
    await fetch(`${BASE}/mock/cmd?command=teams&value=2`);
    await fetch(`${BASE}/mock/cmd?command=setmany&p1name=Prior%20Left&p2name=Prior%20Right&p2flag=gb`);
    await p.goto(`${BASE}/tally-shared/control.html?sbport=${WS_PORT}`);
    await p.waitForFunction(() => document.getElementById('rosterInfo').textContent.includes('3 players') && document.getElementById('p1name').value === 'Prior Left');
  }
  const waitFor = fn => p.waitForFunction(fn, null, { timeout: 3000 }).then(() => true).catch(() => false);
  // After release(): wait until every held lookup has been answered, then give the
  // page one more turn to act on it. Replaces a fixed 100 ms sleep, which let a late
  // effect pass unnoticed on a slow machine.
  async function delivered() {
    const until = Date.now() + 3000;
    while (answered < calls && Date.now() < until) await p.waitForTimeout(10);
    await p.evaluate(() => new Promise((r) => setTimeout(r, 60)));
  }
  async function waitForCall(before) {
    const until = Date.now() + 3000;
    while (calls === before && Date.now() < until) await p.waitForTimeout(20);
    if (calls === before) throw new Error('Expected an opponent lookup request');
  }
  await fresh();
  const present = await p.locator('#autoOpponent').count() === 1;
  check('control offers optional start.gg opponent autofill', present);
  if (!present) { await p.close(); return; }
  check('opponent autofill defaults off', !await p.isChecked('#autoOpponent'));
  await p.fill('#p1name', 'Alpha');
  check('disabled option makes no opponent request', calls === 0);
  await p.check('#autoOpponent');
  await p.fill('#p1name', 'alp');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter');
  check('P1 roster pick fills opposing name and flag', await waitFor(() =>
    document.getElementById('p2name').value === 'Beta' && document.getElementById('p2flag').value === '🇺🇸'));
  check('lookup stages edits without sending a command', await p.evaluate(() =>
    !window.__sent.some(m => m.action?.name === 'Scoreboard Command')));
  await p.evaluate(() => { window.__sent.length = 0; });
  const scores = await p.locator('.score .val').allTextContents();
  await p.click('button[data-set="p1name"]');
  const sent = await p.evaluate(() => window.__sent.filter(m => m.action?.name === 'Scoreboard Command'));
  check('one Set batches both names and flags in one command', sent.length === 1 &&
    sent[0].args.command === 'setmany' && sent[0].args.p1name === 'Alpha' && sent[0].args.p2name === 'Beta' &&
    sent[0].args.p1flag === '🇯🇵' && sent[0].args.p2flag === '🇺🇸');
  check('opponent autofill leaves scores unchanged', JSON.stringify(scores) === JSON.stringify(await p.locator('.score .val').allTextContents()));

  await fresh(); await p.check('#autoOpponent');
  result = { ok: true, status: 'found', opponent: { id: '11', name: 'Alpha', flag: '🇯🇵' } };
  await p.fill('#p2name', 'Beta');
  check('P2 selection fills P1', await waitFor(() => document.getElementById('p1name').value === 'Alpha'));

  await fresh(); await p.check('#autoOpponent');
  await p.fill('#p2name', 'Manual opponent');
  await p.fill('#p2flag', 'gb');
  await p.fill('#p1name', 'Alpha');
  check('manual opposing edits are preserved with an explanation', await waitFor(() =>
    document.getElementById('p2name').value === 'Manual opponent' && document.getElementById('p2flag').value === 'gb' &&
    /manual/i.test(document.getElementById('opponentInfo').textContent)));

  await fresh(); await p.check('#autoOpponent');
  result = { ok: true, status: 'ambiguous', message: 'Multiple possible matchups' };
  await p.fill('#p1name', 'Gamma');
  check('ambiguous lookup shows status without changing the opponent', await waitFor(() =>
    /Multiple/.test(document.getElementById('opponentInfo').textContent) && document.getElementById('p2name').value === 'Prior Right'));

  await fresh(); await p.check('#autoOpponent');
  result = { ok: true, status: 'found', opponent: { id: '33', name: 'Gamma', flag: null } };
  held = new Promise(resolve => { release = resolve; });
  const before = calls;
  await p.fill('#p1name', 'Alpha');
  await waitForCall(before);
  await p.fill('#p2name', 'Late manual edit'); release();
  check('manual edits made during lookup survive the response', await waitFor(() =>
    /manual/i.test(document.getElementById('opponentInfo').textContent) && document.getElementById('p2name').value === 'Late manual edit'));

  await fresh(); await p.check('#autoOpponent');
  held = new Promise(resolve => { release = resolve; });
  const beforeRace = calls;
  await p.fill('#p1name', 'Alpha');
  await waitForCall(beforeRace);
  result = { ok: true, status: 'found', opponent: { id: '11', name: 'Alpha', flag: '🇯🇵' } };
  await p.fill('#p1name', 'Beta');
  check('newer player selection wins over a delayed earlier lookup', await waitFor(() => document.getElementById('p2name').value === 'Alpha'));
  release(); await delivered();
  check('late lookup cannot replace the newer opponent', await p.inputValue('#p2name') === 'Alpha');

  await fresh(); await p.check('#autoOpponent');
  held = new Promise(resolve => { release = resolve; });
  const beforeTeams = calls;
  await p.fill('#p1name', 'Gamma');
  await waitForCall(beforeTeams);
  await p.click('button[data-teams="3"]');
  await p.waitForFunction(() => !document.getElementById('card-p3').classList.contains('hide'));
  release(); await delivered();
  check('switching to three teams disables autofill and ignores pending lookup', await p.isDisabled('#autoOpponent') && await p.inputValue('#p2name') === 'Prior Right');
  const multiCalls = calls;
  await p.fill('#p1name', 'Alpha'); await p.waitForTimeout(100);
  check('three-team mode performs no opponent lookup', calls === multiCalls);

  await fresh(); await p.check('#autoOpponent');
  held = new Promise(resolve => { release = resolve; });
  const beforeOff = calls;
  await p.fill('#p1name', 'Gamma');
  await waitForCall(beforeOff);
  await p.uncheck('#autoOpponent'); release(); await delivered();
  check('disabling autofill ignores a pending lookup', await p.inputValue('#p2name') === 'Prior Right');

  await fresh(); await p.check('#autoOpponent');
  held = new Promise(resolve => { release = resolve; });
  const beforeSet = calls;
  await p.fill('#p1name', 'Gamma');
  await waitForCall(beforeSet);
  await p.click('button[data-set="p1name"]'); release(); await delivered();
  check('Set during lookup prevents late edits and clears the loading status', await p.inputValue('#p2name') === 'Prior Right' &&
    !/Looking up/.test(await p.textContent('#opponentInfo')));

  await fresh(); await p.check('#autoOpponent');
  result = { ok: true, status: 'found', opponent: { id: '22', name: 'Beta', flag: '🇺🇸' } };
  await p.fill('#p2name', 'Unsent manual opponent');
  await p.evaluate(() => window.__scorebugSocket.close());
  await p.waitForFunction(() => document.getElementById('statusText').textContent.includes('disconnected'));
  await p.click('button[data-set="p2name"]');
  await p.fill('#p1name', 'Alpha');
  check('Set while disconnected keeps unsent manual edits protected', await waitFor(() =>
    document.getElementById('p2name').value === 'Unsent manual opponent' && /manual/i.test(document.getElementById('opponentInfo').textContent)));

  await fresh(); await p.check('#autoOpponent');
  result = { ok: true, status: 'found', opponent: { id: '33', name: 'Gamma', flag: null } };
  await p.fill('#p1name', 'Alpha');
  check('opponent without country clears the previous player flag', await waitFor(() =>
    document.getElementById('p2name').value === 'Gamma' && document.getElementById('p2flag').value === ''));
  await p.setViewportSize({ width: 340, height: 820 });
  check('narrow OBS dock has no horizontal overflow', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  if (process.env.TALLY_QA_DIR) await p.locator('.card').filter({ has: p.locator('#autoOpponent') }).screenshot({ path: resolve(process.env.TALLY_QA_DIR, 'opponent-roster.png') });

  await fresh(); await p.check('#autoOpponent');
  result = { ok: false, error: 'start.gg rate limit exceeded' };
  await p.fill('#p1name', 'Alpha');
  check('lookup errors leave opposing fields alone with a useful status', await waitFor(() =>
    /rate limit/.test(document.getElementById('opponentInfo').textContent) && document.getElementById('p2name').value === 'Prior Right'));

  await fresh(); await p.check('#autoOpponent');
  await p.click('button[data-teams="4"]');
  await p.waitForFunction(() => !document.getElementById('card-p4').classList.contains('hide'));
  const fourCalls = calls;
  await p.fill('#p1name', 'Alpha'); await p.waitForTimeout(100);
  check('four-team mode disables opponent autofill', await p.isDisabled('#autoOpponent') && calls === fourCalls);

  fixture.platform = 'sample';
  await fresh();
  check('other roster platforms disable opponent autofill', await p.isDisabled('#autoOpponent'));
  fixture.platform = 'startgg'; delete fixture.eventId;
  await fresh();
  check('old start.gg rosters prompt re-import and cannot guess identity', await p.isDisabled('#autoOpponent') && /re-import/.test(await p.textContent('#opponentInfo')));
  check('opponent flow raises no browser script errors', errors.length === 0, errors.join('; '));
  await p.close();
}

// Sprint 2: the flag box always matches what a Set will send (TAL-01, 02, 08, 17, 18).
async function verifyFlagBox(browser) {
  console.log('\n  flag box and unsent edits');
  const JP = '\u{1F1EF}\u{1F1F5}', GB = '\u{1F1EC}\u{1F1E7}';
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  p.on('pageerror', (err) => errors.push(err.message));
  await p.route('**/tally-shared/roster.json', (route) => route.fulfill({ json: {
    tournament: 'sample-cup', platform: 'sample',
    players: [{ name: 'Vamp Fatale', flag: JP }, { name: 'Wicked Thunder', flag: null }, { name: 'The Tyrant', flag: GB }],
  } }));
  await p.addInitScript(() => {
    window.__sent = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { try { window.__sent.push(JSON.parse(data)); } catch {} return send.call(this, data); };
  });
  const mockState = async () => (await (await fetch(`${BASE}/mock/stats`)).json()).state;
  const mockUntil = async (pred) => { let st; for (const until = Date.now() + 4000; Date.now() < until;) { st = await mockState(); if (pred(st)) return st; await p.waitForTimeout(25); } return st; };
  const cmds = () => p.evaluate(() => window.__sent.filter((m) => m.action && m.action.name === 'Scoreboard Command').map((m) => m.args));
  const clearSent = () => p.evaluate(() => { window.__sent.length = 0; });
  const waitFor = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true).catch(() => false);
  async function fresh() {
    await fetch(`${BASE}/mock/cmd?command=teams&value=2`);
    await fetch(`${BASE}/mock/cmd?command=setmany&p1name=Vamp%20Fatale&p1flag=jp&p2name=The%20Tyrant&p2flag=gb&header=Cup&subheader=FT2`);
    await p.goto(`${BASE}/tally-shared/control.html?sbport=${WS_PORT}`);
    await p.waitForFunction((jp) => document.getElementById('rosterInfo').textContent.includes('3 players')
      && document.getElementById('p1name').value === 'Vamp Fatale' && document.getElementById('p1flag').value === jp, JP);
    await clearSent();
  }

  // TAL-01: a roster player with no flag must not inherit the previous player's flag.
  await fresh();
  await p.fill('#p1name', 'Wicked Thunder');
  check('picking a roster player with no flag clears the flag box',
    await waitFor(() => document.getElementById('p1flag').value === '' && document.getElementById('p1flagprev').textContent === '\u2014'),
    await p.inputValue('#p1flag'));
  await p.click('button[data-set="p1name"]');
  const st1 = await mockUntil((s) => s.p1name === 'Wicked Thunder');
  check('…and the Set removes the old flag on stream', st1.p1name === 'Wicked Thunder' && st1.p1flag === '', JSON.stringify({ n: st1.p1name, f: st1.p1flag }));

  // TAL-02: a focused, unedited box follows a change made elsewhere.
  await fresh();
  await p.click('#p1flag'); // focus it, type nothing
  await fetch(`${BASE}/mock/cmd?command=swap`);
  check('a focused but unedited flag box follows a swap made elsewhere',
    await waitFor((gb) => document.activeElement.id === 'p1flag' && document.getElementById('p1flag').value === gb, GB),
    await p.inputValue('#p1flag'));
  // …and a name Set for a non-roster name does not send the flag box at all.
  await p.fill('#p1name', 'Walk-in Player');
  await clearSent();
  await p.click('button[data-set="p1name"]');
  const st2 = await mockUntil((s) => s.p1name === 'Walk-in Player');
  const sent2 = await cmds();
  check('a name Set with an untouched flag box sends the name alone',
    sent2.length === 1 && sent2[0].command === 'p1name' && !('flag' in sent2[0]), JSON.stringify(sent2));
  check('…so the flag on stream is left as it was', st2.p1flag === GB, JSON.stringify(st2.p1flag));

  // TAL-08: a word every object inherits is just an unknown nation.
  await fresh();
  await p.fill('#p1flag', 'constructor');
  check("typing 'constructor' as a flag shows the unknown marker, no script error",
    await waitFor(() => document.getElementById('p1flagprev').textContent === '?') && errors.length === 0, errors.join('; '));
  await p.fill('#p2name', 'Also Edited');
  await clearSent();
  await p.click('button[data-set="p1flag"]');
  const sent3 = await cmds();
  check('…and Set sends the other edited field, holding the unknown nation back',
    sent3.length === 1 && sent3[0].command === 'p2name' && sent3[0].value === 'Also Edited', JSON.stringify(sent3));
  check('…the unknown nation stays in its box, marked, and is named in the notice',
    await p.inputValue('#p1flag') === 'constructor' && await p.evaluate(() => document.getElementById('p1flag').classList.contains('dirty'))
    && /Unknown nation.*Player 1/.test(await p.textContent('#notice')), await p.textContent('#notice'));

  // TAL-17: unsent edits are visible, Esc discards one, a hidden card keeps none.
  await fresh();
  await p.fill('#header', 'Half typed');
  check('an edited box is marked dirty', await p.evaluate(() => document.getElementById('header').classList.contains('dirty')));
  await p.press('#header', 'Escape');
  check('Esc puts the live value back and clears the mark',
    await p.inputValue('#header') === 'Cup' && !await p.evaluate(() => document.getElementById('header').classList.contains('dirty')), await p.inputValue('#header'));
  await p.click('button[data-teams="3"]');
  await p.waitForFunction(() => !document.getElementById('card-p3').classList.contains('hide'));
  await p.fill('#p3name', 'Ghost Entry');
  await p.click('button[data-teams="2"]');
  await p.waitForFunction(() => document.getElementById('card-p3').classList.contains('hide'));
  await p.fill('#subheader', 'Grand Finals');
  await clearSent();
  await p.click('button[data-set="subheader"]');
  const sent4 = await cmds();
  check('an edit left in a card that was then hidden is not sent by a later Set',
    sent4.length === 1 && sent4[0].command === 'subheader' && sent4[0].value === 'Grand Finals', JSON.stringify(sent4));
  const st4 = await mockUntil((s) => s.subheader === 'Grand Finals');
  check('…and never reaches the scoreboard', st4.p3name !== 'Ghost Entry', st4.p3name);
  await p.close();

  // TAL-18: a port parameter that is not a plain number is ignored. The page's
  // WebSocket is replaced by a recorder so nothing is dialled.
  const q = await browser.newPage();
  await q.route('**/tally-shared/roster.json', (route) => route.fulfill({ json: { players: [] } }));
  await q.addInitScript(() => {
    window.__dialled = [];
    window.WebSocket = function (url) { window.__dialled.push(String(url)); this.readyState = 0; this.send = function () {}; this.close = function () {}; };
  });
  await q.goto(`${BASE}/tally-shared/control.html?sbport=${encodeURIComponent('8082@evil.example')}&rosterport=${encodeURIComponent('7481@evil.example')}`);
  const dialled = await q.evaluate(() => window.__dialled);
  check('control panel ignores ?sbport=8082@evil.example (default port, local host)',
    dialled.length === 1 && dialled[0] === 'ws://127.0.0.1:8080/', JSON.stringify(dialled));
  await q.close();
  check('flag-box flow raises no browser script errors', errors.length === 0, errors.join('; '));
}

// Sprint 3: one send in flight, replies read, failures shown (TAL-05, page half of TAL-09).
async function verifySendQueue(browser) {
  console.log('\n  send queue and failure display');
  const GB = '\u{1F1EC}\u{1F1E7}';
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  p.on('pageerror', (err) => errors.push(err.message));
  await p.route('**/tally-shared/roster.json', (route) => route.fulfill({ json: { players: [] } }));
  await p.addInitScript(() => {
    window.__sent = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { window.__socket = this; try { window.__sent.push(JSON.parse(data)); } catch {} return send.call(this, data); };
  });
  const mock = (path) => fetch(`${BASE}${path}`).then((r) => r.json());
  const mockUntil = async (pred) => { let st; for (const until = Date.now() + 4000; Date.now() < until;) { st = (await mock('/mock/stats')).state; if (pred(st)) return st; await p.waitForTimeout(25); } return st; };
  const cmds = () => p.evaluate(() => window.__sent.filter((m) => m.action && m.action.name === 'Scoreboard Command').map((m) => m.args));
  const clearSent = () => p.evaluate(() => { window.__sent.length = 0; });
  const waitFor = (fn, arg) => p.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true).catch(() => false);
  const isDirty = (id) => p.evaluate((i) => document.getElementById(i).classList.contains('dirty'), id);
  const notice = () => p.textContent('#notice');
  async function fresh() {
    await mock('/mock/bleed?on=0'); await mock('/mock/oldcs?on=0');
    await mock('/mock/missing?name=Scoreboard%20Command&on=0');
    await mock('/mock/cmd?command=teams&value=2');
    await mock('/mock/cmd?command=setmany&p1name=Left&p1flag=none&p2name=Right&p2flag=none&header=Cup&subheader=FT2');
    await mock('/mock/cmd?command=reset');
    await p.goto(`${BASE}/tally-shared/control.html?sbport=${WS_PORT}`);
    await p.waitForFunction(() => document.getElementById('p1name').value === 'Left' && document.getElementById('dot').classList.contains('on'));
    await clearSent();
  }

  // Success settles the edit: the mark goes and the box shows the live value.
  await fresh();
  await p.fill('#p1flag', 'uk');
  await p.click('button[data-set="p1flag"]');
  check('after a Set is confirmed the box shows the live value and is no longer marked',
    await waitFor((gb) => document.getElementById('p1flag').value === gb && !document.getElementById('p1flag').classList.contains('dirty'), GB),
    await p.inputValue('#p1flag'));

  // Arg-bleed on (Streamer.bot's default queue): two different clicks in the same
  // instant must both land. Without the queue both run as the second one.
  await fresh(); await mock('/mock/bleed?on=1');
  await p.evaluate(() => { document.querySelector('button[data-cmd="p1+"]').click(); document.querySelector('button[data-cmd="p2+"]').click(); });
  const st1 = await mockUntil((st) => st.p1score === 1 && st.p2score === 1);
  check('arg-bleed on: two score clicks in the same instant both land', st1.p1score === 1 && st1.p2score === 1, JSON.stringify({ p1: st1.p1score, p2: st1.p2score }));
  check('the panel warns that the action is in the Default queue',
    await waitFor(() => !document.getElementById('queueWarn').hidden && /blocking queue/.test(document.getElementById('queueWarn').textContent)),
    await p.textContent('#queueWarn'));

  // A held Enter repeats the key about every 30 ms. It must send the Set once.
  await p.fill('#p1name', 'Held One');
  await p.fill('#p2name', 'Held Two');
  await p.focus('#p1name');
  await clearSent();
  await p.keyboard.down('Enter'); await p.keyboard.down('Enter'); await p.keyboard.down('Enter'); await p.keyboard.down('Enter');
  await p.keyboard.up('Enter');
  const st2 = await mockUntil((st) => st.p1name === 'Held One' && st.p2name === 'Held Two');
  const sent2 = await cmds();
  check('arg-bleed on: a held Enter sends the Set once and both names land',
    sent2.length === 1 && sent2[0].command === 'setmany' && st2.p1name === 'Held One' && st2.p2name === 'Held Two',
    JSON.stringify({ sent: sent2.map((a) => a.command), p1: st2.p1name, p2: st2.p2name }));
  await mock('/mock/bleed?on=0');
  await p.click('button[data-cmd="p1+"]');
  check('the queue warning clears once the action answers from another queue', await waitFor(() => document.getElementById('queueWarn').hidden));

  // The action is missing in Streamer.bot: say so and keep the edit.
  await fresh(); await mock('/mock/missing?name=Scoreboard%20Command&on=1');
  await p.fill('#header', 'Typed Title');
  await p.click('button[data-set="header"]');
  check('a missing action is reported in the panel',
    await waitFor(() => /was not found/.test(document.getElementById('notice').textContent)), await notice());
  check('…and the edit stays in its box, still marked', await p.inputValue('#header') === 'Typed Title' && await isDirty('header'));
  await mock('/mock/missing?name=Scoreboard%20Command&on=0');
  await p.click('button[data-set="header"]');
  const st3 = await mockUntil((st) => st.header === 'Typed Title');
  check('…so one more Set applies it once the action is back', st3.header === 'Typed Title' && await waitFor(() => !document.getElementById('header').classList.contains('dirty') && document.getElementById('notice').textContent === ''), await notice());

  // An older pasted Scoreboard Command that does not know setmany: nothing comes back.
  await fresh(); await mock('/mock/oldcs?on=1');
  await p.fill('#p1name', 'New Left');
  await p.fill('#p2name', 'New Right');
  await p.click('button[data-set="p1name"]');
  check('an older Scoreboard Command (no setmany) is reported, with what to do',
    await waitFor(() => /re-paste/.test(document.getElementById('notice').textContent)), await notice());
  check('…and both edits stay in their boxes, still marked',
    await p.inputValue('#p1name') === 'New Left' && await p.inputValue('#p2name') === 'New Right' && await isDirty('p1name') && await isDirty('p2name'));
  await mock('/mock/oldcs?on=0');

  // A scoreboard:error broadcast is shown.
  await fresh();
  await mock('/mock/error?message=' + encodeURIComponent('Object reference not set'));
  check('a scoreboard:error broadcast is shown in the panel',
    await waitFor(() => /Object reference not set/.test(document.getElementById('notice').textContent)), await notice());

  // A double click on Set is one request.
  await fresh();
  await p.fill('#subheader', 'Top 8');
  await p.evaluate(() => { const b = document.querySelector('button[data-set="subheader"]'); b.click(); b.click(); });
  await mockUntil((st) => st.subheader === 'Top 8');
  const sent5 = await cmds();
  check('a double click on Set sends one request', sent5.length === 1, JSON.stringify(sent5));

  // Disconnected: the click is refused out loud, and the team count is not assumed.
  await fresh();
  await p.evaluate(() => window.__socket.close());
  await p.waitForFunction(() => document.getElementById('statusText').textContent.includes('disconnected'));
  await clearSent();
  await p.click('button[data-cmd="p1+"]');
  check('a click while disconnected says it was not sent', /not sent/.test(await notice()), await notice());
  await p.click('button[data-teams="3"]');
  check('…and a team-count click while disconnected changes nothing in the panel',
    await p.evaluate(() => !document.getElementById('autoOpponent').closest('.card').textContent.includes('available with 2 teams')) && (await cmds()).length === 0,
    await p.textContent('#opponentInfo'));

  check('send-queue flow raises no browser script errors', errors.length === 0, errors.join('; '));
  await p.close();
}

// Sprint 5: the panel's side of the roster helper contract (TAL-04, 12, 15).
async function verifyImport(browser) {
  console.log('\n  roster import from the panel');
  const p = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  p.on('pageerror', (err) => errors.push(err.message));
  let health = { status: 200, json: { ok: true, name: 'tally-roster-helper', api: 2, version: 'test' } };
  let importReply = { ok: true, roster: { tournament: 'cup', platform: 'sample', players: [{ name: 'Alpha', flag: null }, { name: 'Beta', flag: null }] } };
  const seen = [];
  await p.route('**/tally-shared/roster.json', (route) => route.fulfill({ status: 404, body: 'none' }));
  await p.route('http://127.0.0.1:7481/health', (route) => route.fulfill(health));
  await p.route('http://127.0.0.1:7481/import**', async (route) => {
    const req = route.request();
    seen.push({ method: req.method(), url: req.url(), type: req.headers()['content-type'] || '', body: req.postData() });
    await route.fulfill({ json: importReply });
  });
  await p.goto(`${BASE}/tally-shared/control.html?sbport=${WS_PORT}`);
  await p.waitForFunction(() => document.getElementById('dot').classList.contains('on'));
  const info = () => p.textContent('#rosterInfo');
  const waitInfo = (re) => p.waitForFunction((src) => new RegExp(src).test(document.getElementById('rosterInfo').textContent), re.source, { timeout: 4000 }).then(() => true).catch(() => false);

  await p.fill('#rosterUrl', 'https://challonge.com/cup');
  await p.click('#importRoster');
  check('Import shows the imported roster', await waitInfo(/2 players/), await info());
  check('Import is a POST with a JSON body and no URL in the query string',
    seen.length === 1 && seen[0].method === 'POST' && /application\/json/.test(seen[0].type)
    && JSON.parse(seen[0].body).url === 'https://challonge.com/cup' && !seen[0].url.includes('?'), JSON.stringify(seen));

  // An older helper left running after an update answers /health with its 404 text.
  health = { status: 404, json: { ok: false, error: 'Use GET /import?url=<tournament-url> or /opponent?eventId=<id>&entrantId=<id>' } };
  seen.length = 0;
  await p.click('#importRoster');
  check('an older helper is named as the problem, and no import is attempted',
    await waitInfo(/older roster helper/) && seen.length === 0, await info());

  health = { status: 403, json: { ok: false, error: 'Origin http://127.0.0.1:9999 is not allowed to use the roster helper.' } };
  await p.click('#importRoster');
  check('a refused origin is reported with the helper\u2019s own explanation', await waitInfo(/refused this panel.*not allowed/), await info());

  health = { status: 200, json: { ok: true, api: 2 } };
  importReply = { ok: false, error: 'config.json is not valid JSON (check for a trailing comma or a missing quote). Your API keys were not used.' };
  await p.click('#importRoster');
  check('a helper-side error is shown as it came', await waitInfo(/import failed: config\.json is not valid JSON/), await info());
  check('the Import button is usable again afterwards', !await p.isDisabled('#importRoster'));
  check('import flow raises no browser script errors', errors.length === 0, errors.join('; '));
  await p.close();
}

// Sprint 7: the panels need nothing from the internet (TAL-19).
async function verifyOffline(browser) {
  console.log('\n  panels with no internet');
  const JP = '\u{1F1EF}\u{1F1F5}';
  await fetch(`${BASE}/mock/cmd?command=teams&value=2`);
  await fetch(`${BASE}/mock/cmd?command=setmany&p1name=Offline%20One&p1flag=jp&header=Offline%20Cup&subheader=FT2`);
  const ctx = await browser.newContext({ viewport: { width: 545, height: 63 }, deviceScaleFactor: 2 });
  const outside = [];
  // Refuse everything that is not this machine, and remember what was asked for.
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.protocol === 'data:') return route.continue();
    outside.push(u.href);
    return route.abort();
  });
  const strip = await ctx.newPage();
  const errors = [];
  strip.on('pageerror', (err) => errors.push(err.message));
  await strip.goto(`${BASE}/tally-themes/primetime/panels/player1-strip-545x63.html?sbport=${WS_PORT}`, { waitUntil: 'load' });
  const drew = await strip.waitForFunction(() => {
    const i = document.getElementById('flag');
    return i && i.dataset.code === 'jp' && i.naturalWidth > 0 && !document.getElementById('flag-cell').classList.contains('hidden');
  }, null, { timeout: 6000 }).then(() => true).catch(() => false);
  check('the flag draws from the theme\u2019s own folder', drew,
    await strip.evaluate(() => { const i = document.getElementById('flag'); return i ? (i.dataset.code + ' w=' + i.naturalWidth) : '(no img)'; }));
  const fontOk = await strip.evaluate(async () => { await document.fonts.ready; await document.fonts.load('700 20px Quantico'); return document.fonts.check('700 20px Quantico') && document.fonts.check('400 20px Quantico'); });
  check('Quantico (400 and 700) loads from the theme\u2019s own folder', fontOk);
  const used = await strip.evaluate(() => getComputedStyle(document.getElementById('pname')).fontFamily);
  check('the name is set in Quantico', /Quantico/.test(used), used);

  // Why the theme fetches the file: Streamer.bot (and so the mock) serves .svg as
  // application/octet-stream, which a plain <img> will not draw.
  const type = (await fetch(`${BASE}/tally-themes/primetime/flags/jp.svg`)).headers.get('content-type');
  const plain = await strip.evaluate((url) => new Promise((res) => {
    const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = url;
  }), `${BASE}/tally-themes/primetime/flags/jp.svg`);
  check('the mock serves .svg as Streamer.bot does (application/octet-stream), which a plain <img> cannot draw',
    type === 'application/octet-stream' && plain === 0, type + ' / naturalWidth ' + plain);

  // A code with no file hides the cell instead of leaving an empty plate.
  await fetch(`${BASE}/mock/cmd?command=p1flag&value=${encodeURIComponent('\u{1F1FF}\u{1F1FF}')}`); // the regional-indicator pair "ZZ"
  check('a flag emoji with no picture file hides the flag cell',
    await strip.waitForFunction(() => document.getElementById('flag-cell').classList.contains('hidden'), null, { timeout: 4000 }).then(() => true).catch(() => false));
  await fetch(`${BASE}/mock/cmd?command=p1flag&value=gb`);
  check('…and a real code brings it back',
    await strip.waitForFunction(() => { const i = document.getElementById('flag'); return i.dataset.code === 'gb' && i.naturalWidth > 0 && !document.getElementById('flag-cell').classList.contains('hidden'); }, null, { timeout: 4000 }).then(() => true).catch(() => false));

  const title = await ctx.newPage();
  await title.goto(`${BASE}/tally-themes/primetime/panels/title-309x49.html?sbport=${WS_PORT}`, { waitUntil: 'load' });
  await title.waitForFunction(() => document.getElementById('header').textContent.trim() === 'Offline Cup');
  await title.evaluate(() => document.fonts.ready);
  check('no panel asked for anything outside this machine', outside.length === 0, outside.slice(0, 3).join(', '));
  check('offline panels raise no browser script errors', errors.length === 0, errors.join('; '));
  await fetch(`${BASE}/mock/cmd?command=p1flag&value=none`);
  await ctx.close();
}

main();
