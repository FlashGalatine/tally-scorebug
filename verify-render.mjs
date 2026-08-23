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

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';
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
  const rosterPath = resolve(__dirname, 'tally-shared', 'roster.json');
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
    await writeFile(rosterPath, JSON.stringify({
      tournament: 'sample-cup', platform: 'sample',
      names: ['Blanka-chan', 'The Tyrant', 'Vamp Fatale', 'Wicked Thunder'],
      players: [
        { name: 'Blanka-chan', flag: '\u{1F1E7}\u{1F1F7}' },
        { name: 'The Tyrant', flag: '\u{1F1EC}\u{1F1E7}' },
        { name: 'Vamp Fatale', flag: JP },
        { name: 'Wicked Thunder', flag: null },
      ],
    }));
    const ctrlPage = await browser.newPage({ viewport: { width: 420, height: 760 } });
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
    // the flag-icons jp.svg in its flag cell.
    const nameEcho = await stripPage.waitForFunction(
      () => document.getElementById('pname').textContent.trim() === 'Vamp Fatale', { timeout: 6000 }).then(() => true).catch(() => false);
    check('typing a name in the control panel updates the strip (no chat)', nameEcho, await stripPage.evaluate(() => document.getElementById('pname').textContent));
    const flagShown = await stripPage.waitForFunction(() => {
      const img = document.getElementById('flag');
      const cell = document.getElementById('flag-cell');
      return img && (img.getAttribute('src') || '').includes('/jp.svg') && cell && !cell.classList.contains('hidden');
    }, { timeout: 6000 }).then(() => true).catch(() => false);
    check('strip flag cell shows the autofilled flag (jp.svg)', flagShown,
      await stripPage.evaluate(() => (document.getElementById('flag') || {}).src || '(no img)'));

    // Override: type a nation alias over the autofill and Set just the flag.
    await ctrlPage.fill('#p1flag', 'uk');
    await ctrlPage.click('button[data-set="p1flag"]');
    const flagOverride = await stripPage.waitForFunction(
      () => ((document.getElementById('flag') || {}).getAttribute('src') || '').includes('/gb.svg'),
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

    await stripPage.screenshot({ path: resolve(__dirname, 'test-render.png') });
    await ctrlPage.screenshot({ path: resolve(__dirname, 'control-render.png') });
    console.log('  screenshots → test-render.png, control-render.png');
  } catch (err) {
    failed++;
    console.log('\n  ERROR ' + ((err && err.stack) || err));
  } finally {
    try { await rm(rosterPath); } catch {}
    if (browser) { try { await browser.close(); } catch {} }
    if (mock) mock.kill();
  }

  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'FAILURES'}: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
