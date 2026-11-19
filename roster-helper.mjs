// roster-helper.mjs — tiny local HTTP service behind the control panel's Import
// button. The panel can't scrape tournament sites itself (browser CORS) and neither
// can Streamer.bot's C# out of the box, so this keeps the scrape in Node.
//
//   GET  /health                          → { ok, name, api, version }
//   POST /import   { "url": "<tournament-url>" }   → fetches the bracket via
//        roster-lib.mjs, writes tally-shared/roster.json and returns the roster
//   GET  /opponent?eventId=<id>&entrantId=<id>     → current start.gg opponent
//        (reads only; changes neither the roster nor the scoreboard)
//   POST /shutdown                        → stops this helper
//   GET  /import?url=…  is still answered for one release, for a control panel that
//        has not been refreshed yet, and only from an allowed origin.
//
// Keep it running for imports and optional live start.gg opponent lookup:
//   npm run roster          → http://127.0.0.1:7481
//
// WHO MAY CALL IT. The helper holds your API keys and overwrites roster.json, so it
// does not answer every web page:
//   • a request that names an Origin must name an allowed one (any other gets a 403
//     that says so, and nothing else). Allowed by default:
//     http://127.0.0.1:7474 and http://localhost:7474 (the control panel on
//     Streamer.bot's HTTP server). Add more with ROSTER_ALLOWED_ORIGINS (comma
//     separated) or "rosterAllowedOrigins" in config.json, e.g. when you moved SB's
//     HTTP server to another port.
//   • a request a browser marks as cross-site is refused even without an Origin
//     (an <img> or a plain form on some other site).
//   • the Host header must be this helper's own address, which stops a foreign
//     domain that has been pointed at 127.0.0.1.
//   • a request with no Origin and no browser markers (curl, a script) is allowed.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fetchRoster, writeRoster, fetchOpponent, loadConfig } from './roster-lib.mjs';

const PORT = Number(process.env.ROSTER_PORT) || 7481;
// Bumped when the HTTP contract changes; the control panel compares it.
const API_LEVEL = 2;
const DEFAULT_ORIGINS = ['http://127.0.0.1:7474', 'http://localhost:7474'];
const MAX_BODY = 8 * 1024;

let version = '0.0.0';
try { version = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8')).version || version; } catch { /* unknown */ }

async function allowedOrigins() {
  const list = [...DEFAULT_ORIGINS];
  const add = (v) => String(v || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean).forEach((o) => list.push(o));
  add(process.env.ROSTER_ALLOWED_ORIGINS);
  try { const cfg = await loadConfig(); (cfg.rosterAllowedOrigins || []).forEach(add); } catch { /* a broken config is reported by /import */ }
  return list;
}

function send(res, status, body, origin) {
  const headers = { 'content-type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Origin' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('Request body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// One import at a time: two overlapping imports would race on roster.json.
let importChain = Promise.resolve();
function runImport(target) {
  const job = importChain.then(async () => {
    const roster = await fetchRoster(target);
    await writeRoster(roster);
    console.log(`[roster] imported ${roster.count} (${roster.flagged} flagged) from ${roster.platform}:${roster.tournament}`);
    return roster;
  });
  importChain = job.catch(() => {});
  return job;
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const query = new URLSearchParams(url.split('?')[1] || '');
  const origin = req.headers.origin ? String(req.headers.origin).replace(/\/+$/, '') : null;

  // 1. Host: only this helper's own address.
  const host = String(req.headers.host || '').toLowerCase();
  if (host !== `127.0.0.1:${PORT}` && host !== `localhost:${PORT}`) {
    return send(res, 403, { ok: false, error: 'Unexpected Host header.' });
  }
  // 2. Origin: when a browser names one, it must be allowed.
  const allowed = await allowedOrigins();
  if (origin && !allowed.includes(origin)) {
    console.log(`[roster] refused a request from origin ${origin}`);
    // This one answer carries the CORS header, so a control panel on an address that
    // is not allowed can read WHY it was refused. Without it the browser hides the
    // reply and the panel can only say "helper not running". Nothing else is exposed:
    // every other answer to this origin is this same refusal.
    return send(res, 403, { ok: false, error: `Origin ${origin} is not allowed to use the roster helper. Add it to ROSTER_ALLOWED_ORIGINS or "rosterAllowedOrigins" in config.json if it is your control panel.` }, origin);
  }
  // 3. A cross-site browser request that carries no Origin (an <img>, a plain form).
  if (!origin && String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') {
    return send(res, 403, { ok: false, error: 'Cross-site requests are not allowed.' });
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    });
    return res.end();
  }

  if (path === '/health') {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Use GET /health' }, origin);
    return send(res, 200, { ok: true, name: 'tally-roster-helper', api: API_LEVEL, version }, origin);
  }

  if (path === '/opponent') {
    if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'Use GET /opponent' }, origin);
    try {
      const result = await fetchOpponent(query.get('eventId'), query.get('entrantId'));
      return send(res, 200, { ok: true, ...result }, origin);
    } catch (err) {
      return send(res, 400, { ok: false, error: err.message }, origin);
    }
  }

  if (path === '/import') {
    let target = '';
    if (req.method === 'POST') {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) {
        return send(res, 415, { ok: false, error: 'POST /import needs Content-Type: application/json and a body {"url":"<tournament-url>"}' }, origin);
      }
      try { target = String(JSON.parse(await readBody(req)).url || '').trim(); }
      catch { return send(res, 400, { ok: false, error: 'POST /import body must be JSON: {"url":"<tournament-url>"}' }, origin); }
    } else if (req.method === 'GET') {
      // Kept for one release for a control panel that has not been refreshed. A GET
      // changes roster.json, so it is only honoured for a named, allowed origin.
      if (!origin) return send(res, 403, { ok: false, error: 'Use POST /import with a JSON body {"url":"<tournament-url>"}' });
      console.log('[roster] GET /import is deprecated — refresh the control panel (it now uses POST).');
      target = (query.get('url') || '').trim();
    } else {
      return send(res, 405, { ok: false, error: 'Use POST /import' }, origin);
    }
    if (!target) return send(res, 400, { ok: false, error: 'Missing tournament URL' }, origin);
    try {
      return send(res, 200, { ok: true, roster: await runImport(target) }, origin);
    } catch (err) {
      console.log('[roster] import failed:', err.message);
      return send(res, 400, { ok: false, error: err.message }, origin);
    }
  }

  if (path === '/shutdown') {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Use POST /shutdown' }, origin);
    send(res, 200, { ok: true, stopping: true }, origin);
    console.log('[roster] shutdown requested — stopping.');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
    return;
  }

  send(res, 404, { ok: false, error: 'Use GET /health, POST /import {"url":…}, GET /opponent?eventId=<id>&entrantId=<id> or POST /shutdown' }, origin);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`[roster] port ${PORT} is already in use — a roster helper is probably running already. Not starting a second one.`);
    console.log(`[roster] To replace it: POST http://127.0.0.1:${PORT}/shutdown (or close its window), then start this again.`);
    process.exit(0);
  }
  console.error('[roster] server error:', err.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[roster] helper listening on http://127.0.0.1:${PORT}  (v${version}, api ${API_LEVEL})`);
});
