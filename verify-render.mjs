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

    await ctrlPage.fill('#p1name', 'Vamp Fatale');
    // Roster autofill: picking/typing an exact roster name fills that player's flag.
    const autofill = await ctrlPage.waitForFunction(
      (jp) => document.getElementById('p1flag').value === jp && document.getElementById('p1flagprev').textContent === jp,
      JP, { timeout: 4000 }).then(() => true).catch(() => false);
    check('roster pick auto-fills the flag box (+ preview)', autofill,
      await ctrlPage.evaluate(() => document.getElementById('p1flag').value + ' / ' + document.getElementById('p1flagprev').textContent));

    await ctrlPage.click('button[data-set="p1name"]');
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

    const rosterOK = await ctrlPage.waitForFunction(() => {
      const dl = document.getElementById('roster'); return dl && dl.options.length >= 4;
    }, { timeout: 5000 }).then(() => ctrlPage.evaluate(() => ({
      count: document.getElementById('roster').options.length,
      has: Array.from(document.getElementById('roster').options).some((o) => o.value === 'Vamp Fatale'),
      bound: document.getElementById('p1name').getAttribute('list') === 'roster',
    }))).catch(() => ({ count: 0, has: false, bound: false }));
    check('roster.json → <datalist> autocomplete (name inputs bound)', rosterOK.count >= 4 && rosterOK.has && rosterOK.bound, JSON.stringify(rosterOK));

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
