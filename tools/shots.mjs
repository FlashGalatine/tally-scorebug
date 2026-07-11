// tools/shots.mjs — regenerate the README screenshots in docs/.
//
// Spawns the mock Streamer.bot, stages a sample match via /mock/cmd (the same
// control surface chat / Stream Deck / the panel use), waits for the Quantico
// webfont, and captures the Primetime panels + the control panel at 2x.
//
// Requires: npm install --no-save playwright-core  (uses system Edge/Chrome)
// Run: npm run shots

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DOCS = resolve(ROOT, 'docs');
const HTTP_PORT = Number(process.env.SB_HTTP_PORT) || 7477;
const WS_PORT = Number(process.env.SB_WS_PORT) || 8083;
const BASE = `http://127.0.0.1:${HTTP_PORT}`;

function startMock() {
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, ['mock-sb-server.mjs'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SB_HTTP_PORT: String(HTTP_PORT), SB_WS_PORT: String(WS_PORT) },
    });
    let out = '';
    const t = setTimeout(() => rej(new Error('mock no start\n' + out)), 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => { out += d; if (out.includes('[mock] HTTP') && out.includes('[mock] WS')) { clearTimeout(t); res(child); } });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { out += d; });
  });
}

async function launch() {
  for (const ch of ['msedge', 'chrome']) { try { return await chromium.launch({ channel: ch, headless: true }); } catch {} }
  return await chromium.launch({ headless: true });
}

const cmd = (c, v) => fetch(`${BASE}/mock/cmd?command=${encodeURIComponent(c)}${v !== undefined ? '&value=' + encodeURIComponent(v) : ''}`);

// Give the page time to receive the broadcast, load the webfont, and re-fit type
// (the theme replays its layout once document.fonts.ready resolves).
async function settle(page) {
  await page.evaluate(() => (document.fonts && document.fonts.ready) || Promise.resolve());
  await page.waitForTimeout(900);
}

async function shot(browser, url, w, h, out) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'load' });
  await settle(page);
  await page.screenshot({ path: resolve(DOCS, out) });
  await page.close();
  console.log('  docs/' + out);
}

async function main() {
  await mkdir(DOCS, { recursive: true });
  let mock, browser;
  const rosterPath = resolve(ROOT, 'tally-shared', 'roster.json');
  try {
    mock = await startMock();
    browser = await launch();

    // Stage a sample match through the real command surface.
    await cmd('header', 'SOLUTION TO SUNDAY');
    await cmd('subheader', 'Grand Finals · FT10');
    await cmd('p1name', 'FGC | Vamp Fatale');
    await cmd('p1flag', 'japan');
    await cmd('p1score', '9');
    await cmd('p2name', 'NFC | The Tyrant');
    await cmd('p2flag', 'uk');
    await cmd('p2score', '10');

    // Sample roster so the control panel shows the autocomplete state.
    await writeFile(rosterPath, JSON.stringify({
      tournament: 'solution-to-sunday', platform: 'startgg',
      players: [
        { name: 'Blanka-chan', flag: '\u{1F1E7}\u{1F1F7}' },
        { name: 'FGC | Vamp Fatale', flag: '\u{1F1EF}\u{1F1F5}' },
        { name: 'NFC | The Tyrant', flag: '\u{1F1EC}\u{1F1E7}' },
        { name: 'Wicked Thunder', flag: '\u{1F1FA}\u{1F1F8}' },
      ],
      names: ['Blanka-chan', 'FGC | Vamp Fatale', 'NFC | The Tyrant', 'Wicked Thunder'],
    }));

    console.log('capturing…');
    await shot(browser, `${BASE}/tally-themes/primetime/panels/title-309x49.html?sbport=${WS_PORT}`, 309, 49, 'primetime-title.png');
    await shot(browser, `${BASE}/tally-themes/primetime/panels/player1-strip-545x63.html?sbport=${WS_PORT}`, 545, 63, 'primetime-strip-p1.png');
    await shot(browser, `${BASE}/tally-themes/primetime/panels/player2-strip-545x63.html?sbport=${WS_PORT}`, 545, 63, 'primetime-strip-p2.png');
    await shot(browser, `${BASE}/tally-shared/control.html?sbport=${WS_PORT}`, 420, 780, 'control-panel.png');
    console.log('done.');
  } finally {
    try { await rm(rosterPath); } catch {}
    if (browser) { try { await browser.close(); } catch {} }
    if (mock) mock.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
