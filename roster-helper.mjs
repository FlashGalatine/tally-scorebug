// roster-helper.mjs — tiny local HTTP service behind the control panel's Import
// button. The panel can't scrape tournament sites itself (browser CORS) and neither
// can Streamer.bot's C# out of the box, so this keeps the scrape in Node: the panel
// calls GET /import?url=<tournament-url>, this fetches the bracket via roster-lib.mjs
// (the platform scrapers under roster/), writes tally-shared/roster.json, and returns
// the roster in the response so the panel updates immediately.
//
// Run it while setting up a bracket (it's only needed at import time, not mid-match):
//   npm run roster          → http://127.0.0.1:7481
//
// CORS is wide open (Access-Control-Allow-Origin: *) because the panel is served from
// SB's HTTP port (:7474) — a different origin than this helper.

import { createServer } from 'node:http';
import { fetchRoster, writeRoster } from './roster-lib.mjs';

const PORT = Number(process.env.ROSTER_PORT) || 7481;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  const url = req.url || '/';
  const path = url.split('?')[0];
  const query = new URLSearchParams(url.split('?')[1] || '');

  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }

  if (path === '/import') {
    const target = (query.get('url') || '').trim();
    if (!target) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing ?url=<tournament-url>' }));
      return;
    }
    try {
      const roster = await fetchRoster(target);
      await writeRoster(roster);
      console.log(`[roster] imported ${roster.count} (${roster.flagged} flagged) from ${roster.platform}:${roster.tournament}`);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ok: true, roster }));
    } catch (err) {
      console.log('[roster] import failed:', err.message);
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ ok: false, error: 'Use GET /import?url=<tournament-url>' }));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`[roster] helper listening on http://127.0.0.1:${PORT}  (GET /import?url=...)`);
});
