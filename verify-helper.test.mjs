// Roster helper: who may call it, lifecycle, config and file safety (Sprint 5 of the
// 2026-11-18 remediation plan). Fully offline: tournaments come from fixture files,
// and the roster and config live in a temp folder, never in the repo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PANEL = 'http://127.0.0.1:7476'; // the origin these tests allow
const FOREIGN = 'https://evil.example';

async function sandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'tally-helper-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'cup.json'), JSON.stringify({ platform: 'fixture', id: 'cup', participants: [
    { id: 1, name: 'Alpha', flag: '🇯🇵' }, { id: 2, name: 'Beta', flag: null }] }));
  await writeFile(join(dir, 'slow.json'), JSON.stringify({ platform: 'fixture', id: 'slow', delayMs: 300, participants: [{ id: 9, name: 'Slowpoke' }] }));
  return { dir, roster: join(dir, 'roster.json'), config: join(dir, 'config.json') };
}

function startHelper(t, box, port, extraEnv = {}) {
  const child = spawn(process.execPath, ['roster-helper.mjs'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ROSTER_PORT: String(port), ROSTER_ALLOWED_ORIGINS: PANEL,
      TALLY_ROSTER_FILE: box.roster, TALLY_CONFIG: box.config, TALLY_ROSTER_FIXTURES: box.dir, ...extraEnv },
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  t.after(() => child.kill());
  const exited = new Promise((resolve) => child.once('exit', (code) => resolve({ code, out })));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('helper did not start\n' + out)), 6000);
    child.stdout.on('data', () => { if (out.includes('helper listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  return { child, ready, exited, output: () => out };
}

// node:http, not fetch: these tests set Host, Origin and Sec-Fetch-Site by hand.
function call(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ } resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const post = (port, path, obj, headers = {}) => call(port, 'POST', path, { headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(obj) });
const exists = (file) => readFile(file, 'utf8').then(() => true, () => false);
let nextPort = 21000 + (process.pid % 500) * 10;

test('health reports the helper and its API level', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  const r = await call(port, 'GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.name, 'tally-roster-helper');
  assert.ok(r.json.api >= 2);
  assert.equal(r.headers['access-control-allow-origin'], undefined, 'no CORS header without an Origin');
});

test('a foreign origin is refused everywhere and nothing is written', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  for (const [method, path, opts] of [
    ['GET', '/health', {}],
    ['GET', '/opponent?eventId=1&entrantId=2', {}],
    ['GET', '/import?url=fixture:cup', {}],
    ['POST', '/import', { body: JSON.stringify({ url: 'fixture:cup' }), headers: { 'content-type': 'application/json' } }],
    ['POST', '/import', { body: JSON.stringify({ url: 'fixture:cup' }), headers: { 'content-type': 'text/plain' } }],
    ['OPTIONS', '/import', {}],
    ['POST', '/shutdown', {}],
  ]) {
    const r = await call(port, method, path, { ...opts, headers: { ...(opts.headers || {}), origin: FOREIGN } });
    assert.equal(r.status, 403, `${method} ${path} from a foreign origin`);
    assert.equal(r.headers['access-control-allow-origin'], undefined, `${method} ${path} must not grant CORS`);
  }
  assert.equal(await exists(box.roster), false, 'the roster file must not have been created');
  assert.equal((await call(port, 'GET', '/health')).status, 200, 'the helper is still running');
});

test('the allowed panel origin can import with POST; the file is written whole', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  const r = await post(port, '/import', { url: 'fixture:cup' }, { origin: PANEL });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], PANEL, 'echoes the allowed origin, never *');
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.roster.players.map((p) => p.name), ['Alpha', 'Beta']);
  const onDisk = JSON.parse(await readFile(box.roster, 'utf8'));
  assert.equal(onDisk.count, 2);
  assert.deepEqual((await readdir(box.dir)).filter((f) => f.endsWith('.tmp')), [], 'no temp file left behind');
  const pre = await call(port, 'OPTIONS', '/import', { headers: { origin: PANEL, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], PANEL);
  assert.match(pre.headers['access-control-allow-methods'], /POST/);
});

test('a request with no Origin: scripts are allowed, browser cross-site requests are not', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  assert.equal((await post(port, '/import', { url: 'fixture:cup' })).status, 200, 'curl-style POST works');
  const img = await call(port, 'GET', '/opponent?eventId=1&entrantId=2', { headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(img.status, 403, 'an <img> or form on another site carries Sec-Fetch-Site: cross-site');
  const get = await call(port, 'GET', '/import?url=fixture:cup');
  assert.equal(get.status, 403, 'the state-changing GET needs a named, allowed origin');
});

test('the deprecated GET /import still works for an allowed origin (one release)', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  const h = startHelper(t, box, port); await h.ready;
  const r = await call(port, 'GET', '/import?url=' + encodeURIComponent('fixture:cup'), { headers: { origin: PANEL } });
  assert.equal(r.status, 200);
  assert.equal(r.json.roster.count, 2);
  assert.match(h.output(), /deprecated/);
});

test('the Host header must be the helper itself', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  assert.equal((await call(port, 'GET', '/health', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await call(port, 'GET', '/health', { headers: { host: `evil.example:${port}` } })).status, 403);
  assert.equal((await call(port, 'GET', '/health', { headers: { host: `localhost:${port}` } })).status, 200);
});

test('methods and content types are checked', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  assert.equal((await call(port, 'DELETE', '/import')).status, 405);
  assert.equal((await call(port, 'POST', '/opponent')).status, 405);
  assert.equal((await call(port, 'GET', '/shutdown')).status, 405);
  assert.equal((await call(port, 'POST', '/import', { headers: { 'content-type': 'text/plain' }, body: '{"url":"fixture:cup"}' })).status, 415);
  assert.equal((await call(port, 'POST', '/import', { headers: { 'content-type': 'application/json' }, body: 'not json' })).status, 400);
  assert.equal((await post(port, '/import', {})).status, 400);
  const bad = await post(port, '/import', { url: 'https://example.com/not-a-bracket' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Challonge/i, 'the error lists the supported platforms');
  assert.equal(await exists(box.roster), false);
});

test('overlapping imports run one at a time and leave a whole file', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  const [slow, quick] = await Promise.all([post(port, '/import', { url: 'fixture:slow' }), post(port, '/import', { url: 'fixture:cup' })]);
  assert.equal(slow.status, 200);
  assert.equal(quick.status, 200);
  const onDisk = JSON.parse(await readFile(box.roster, 'utf8'));
  assert.equal(onDisk.tournament, 'cup', 'the import that was requested last finished last');
});

test('a second helper on the same port says so and exits cleanly', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await startHelper(t, box, port).ready;
  const second = startHelper(t, box, port);
  const { code, out } = await second.exited;
  assert.equal(code, 0);
  assert.match(out, /already in use/);
  assert.equal((await call(port, 'GET', '/health')).status, 200, 'the first helper keeps serving');
});

test('POST /shutdown stops the helper', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  const h = startHelper(t, box, port); await h.ready;
  const r = await call(port, 'POST', '/shutdown');
  assert.equal(r.status, 200);
  const { code } = await h.exited;
  assert.equal(code, 0);
});

test('a broken config.json is reported; a byte-order mark is not an error', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  await writeFile(box.config, '{ "startggApiKey": "abc", }'); // trailing comma
  await startHelper(t, box, port).ready;
  const r = await post(port, '/import', { url: 'fixture:cup' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /config\.json is not valid JSON/);
  assert.equal(await exists(box.roster), false);

  await writeFile(box.config, '﻿{ "startggApiKey": "abc123" }');
  assert.equal((await post(port, '/import', { url: 'fixture:cup' })).status, 200, 'a BOM is stripped');
});

test('a malformed API key is refused without being echoed', async (t) => {
  const box = await sandbox(t), port = nextPort++;
  const secret = 'sk_live_AAAA\nBBBB_SECRET';
  await writeFile(box.config, JSON.stringify({ startggApiKey: secret }));
  await startHelper(t, box, port).ready;
  const r = await post(port, '/import', { url: 'fixture:cup' });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /startggApiKey contains/);
  assert.ok(!r.text.includes('AAAA') && !r.text.includes('SECRET'), 'the key must not appear in the response');
});

test('loadConfig: keys, allowed origins and a missing file', async (t) => {
  const box = await sandbox(t);
  process.env.TALLY_CONFIG = box.config;
  t.after(() => { delete process.env.TALLY_CONFIG; });
  const lib = async () => import('./roster-lib.mjs?case=' + Math.random());
  const saved = { c: process.env.CHALLONGE_API_KEY, s: process.env.STARTGG_API_KEY };
  delete process.env.CHALLONGE_API_KEY; delete process.env.STARTGG_API_KEY;
  t.after(() => { if (saved.c) process.env.CHALLONGE_API_KEY = saved.c; if (saved.s) process.env.STARTGG_API_KEY = saved.s; });
  assert.deepEqual(await (await lib()).loadConfig(), { challongeApiKey: null, startggApiKey: null, rosterAllowedOrigins: [] }, 'a missing file is fine');
  await writeFile(box.config, JSON.stringify({ challongeApiKey: '  key-1  ', rosterAllowedOrigins: ['http://127.0.0.1:9000'] }));
  const cfg = await (await lib()).loadConfig();
  assert.equal(cfg.challongeApiKey, 'key-1', 'surrounding spaces are trimmed');
  assert.deepEqual(cfg.rosterAllowedOrigins, ['http://127.0.0.1:9000']);
  await writeFile(box.config, '[1,2]');
  await assert.rejects((await lib()).loadConfig(), /must hold a JSON object/);
});

test('every platform request has a time limit', async () => {
  for (const f of ['challonge', 'matcherino', 'roundone', 'startgg', 'tourneybot']) {
    const src = await readFile(join(ROOT, 'roster', 'platforms', f + '.js'), 'utf8');
    const fetches = (src.match(/\bfetch\(/g) || []).length;
    const limits = (src.match(/AbortSignal\.timeout\(/g) || []).length;
    assert.ok(fetches > 0 && limits >= fetches, `${f}.js: ${fetches} fetch call(s), ${limits} time limit(s)`);
  }
});
