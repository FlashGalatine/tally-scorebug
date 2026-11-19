// roster-lib.mjs — shared roster-import logic.
//
// Used by both import-roster.mjs (CLI) and roster-helper.mjs (the tiny local HTTP
// service behind the control panel's Import button). It drives the platform scrapers
// vendored under roster/ (Challonge, start.gg, TourneyBot, Matcherino, RoundOne —
// from StreamScoreboard, same author, MIT) and produces tally-shared/roster.json:
//
//   { tournament, platform, eventId?, fetchedAt, count, flagged,
//     names:   ["PG | Punk", ...],                  // legacy/simple consumers
//     players: [{ id?, name: "PG | Punk", flag: "🇺🇸" }] } // flag = emoji or null
// start.gg includes event/entrant IDs for optional fresh opponent lookups.
//
// Flags currently come from start.gg only (profile location → country → emoji).
// start.gg's public proxy exposed locations in live testing; if a bracket imports
// flagless, set startggApiKey and re-import.
//
// Scraping stays in Node ON PURPOSE: it needs `new URL` + fetch + HTML/JSON parsing,
// which Streamer.bot's C# can't do out of the box and the browser can't either (CORS).
// Streamer.bot only ever serves the resulting roster.json.

import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPlatform, listSupportedPlatforms } from './roster/platforms/index.js';
import { startgg } from './roster/platforms/startgg.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// TALLY_ROSTER_FILE / TALLY_CONFIG relocate the two files (the test suites use them
// so they never touch an operator's roster or keys).
export const ROSTER_PATH = process.env.TALLY_ROSTER_FILE || resolve(__dirname, 'tally-shared', 'roster.json');
const CONFIG_PATH = process.env.TALLY_CONFIG || resolve(__dirname, 'config.json');

export { listSupportedPlatforms };

// API keys are OPTIONAL (public Challonge brackets + the start.gg public proxy work
// without one). Copy config.example.json to config.json to set them, or use the
// CHALLONGE_API_KEY / STARTGG_API_KEY environment variables.
// A missing config.json is normal (keyless paths). A config.json that EXISTS but
// cannot be read as JSON is an error the operator must see: silently ignoring it
// meant a key that was never used and a puzzling "event not found".
export async function loadConfig() {
  let cfg = {};
  let raw = null;
  try { raw = await readFile(CONFIG_PATH, 'utf8'); }
  catch (err) { if (err.code !== 'ENOENT') throw new Error('config.json could not be read: ' + err.message); }
  if (raw != null) {
    raw = raw.replace(/^\uFEFF/, ''); // a byte-order mark (Notepad, PowerShell 5 Out-File)
    try { cfg = JSON.parse(raw); }
    catch { throw new Error('config.json is not valid JSON (check for a trailing comma or a missing quote). Your API keys were not used.'); }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('config.json must hold a JSON object.');
  }
  return {
    challongeApiKey: cleanKey('challongeApiKey', process.env.CHALLONGE_API_KEY || cfg.challongeApiKey),
    startggApiKey: cleanKey('startggApiKey', process.env.STARTGG_API_KEY || cfg.startggApiKey),
    rosterAllowedOrigins: Array.isArray(cfg.rosterAllowedOrigins) ? cfg.rosterAllowedOrigins.map(String) : [],
  };
}

// A key is printable ASCII with no spaces. Anything else (a stray line break pasted
// into the middle, a smart quote) is refused HERE with a message that does not quote
// the key; otherwise the HTTP layer rejects it later and echoes the whole value.
function cleanKey(name, value) {
  if (value == null) return null;
  const key = String(value).trim();
  if (!key) return null;
  if (!/^[\x21-\x7e]+$/.test(key)) {
    throw new Error(`${name} contains a space, a line break or another character that cannot be part of a key. Paste it again.`);
  }
  return key;
}

// Fetch + normalize a tournament's participants into the roster.json shape.
// Throws with a human-readable message on unsupported/unparseable/failed input.
// Test hook: with TALLY_ROSTER_FIXTURES=<folder> set, "fixture:<name>" loads
// <folder>/<name>.json ({ platform, id, participants }) instead of the network. Off
// unless the variable is set, and the name cannot leave the folder.
async function fixturePlatform(url) {
  const dir = process.env.TALLY_ROSTER_FIXTURES;
  const m = /^fixture:([a-z0-9_-]+)$/i.exec(String(url || ''));
  if (!dir || !m) return null;
  const data = JSON.parse(await readFile(resolve(dir, m[1] + '.json'), 'utf8'));
  return {
    name: data.platform || 'fixture', displayName: 'Fixture',
    parseId: () => data.id || m[1],
    fetchParticipants: async () => { if (data.delayMs) await new Promise((r) => setTimeout(r, data.delayMs)); return data.participants || []; },
  };
}

// "start.gg/tournament/x/event/y" or "challonge.com/abc" pasted without a scheme.
// A bare word with no dot is left alone (Challonge accepts a bare slug).
export function normalizeInput(input) {
  const s = String(input || '').trim();
  if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
  return /^[^\s\/]+\.[^\s\/]+(\/|$)/.test(s) ? 'https://' + s : s;
}

export async function fetchRoster(input) {
  const url = normalizeInput(input);
  const platform = (await fixturePlatform(url)) || detectPlatform(url);
  if (!platform) {
    throw new Error('Unsupported URL. Supported: ' + listSupportedPlatforms().map((p) => p.displayName).join(', '));
  }
  const id = platform.parseId(url);
  if (!id) throw new Error(`Could not find a tournament in that ${platform.displayName} URL. Paste the bracket's own page (for example https://challonge.com/mytourney or https://www.start.gg/tournament/<t>/event/<e>).`);

  const config = await loadConfig();
  const participants = await platform.fetchParticipants(id, config, url);

  // Dedupe by name (keep the first entry's flag), sorted case-insensitively.
  const byName = new Map();
  for (const p of participants) {
    const name = String(p.name || '').trim();
    if (!name) continue;
    if (byName.has(name)) {
      // Autocomplete is name-based; duplicate names must not pick an arbitrary ID.
      if (platform.name === 'startgg' && byName.get(name).id !== String(p.id)) byName.get(name).id = null;
      continue;
    }
    byName.set(name, { ...(platform.name === 'startgg' ? { id: String(p.id) } : {}), name, flag: p.flag || null });
  }
  const players = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    tournament: id,
    platform: platform.name,
    ...(platform.name === 'startgg' ? { eventId: participants[0]?.eventId || null } : {}),
    fetchedAt: new Date().toISOString(),
    count: players.length,
    flagged: players.filter((p) => p.flag).length,
    names: players.map((p) => p.name),
    players,
  };
}

export async function fetchOpponent(eventId, entrantId) {
  if (!/^[1-9]\d*$/.test(eventId || '') || !/^[1-9]\d*$/.test(entrantId || '')) {
    throw new Error('Missing or invalid start.gg event / entrant ID — re-import the roster.');
  }
  return startgg.fetchOpponent(String(eventId), String(entrantId), await loadConfig());
}

// Written to a temp file and renamed into place, so a panel that reloads during an
// import never reads half a file.
export async function writeRoster(roster) {
  const tmp = ROSTER_PATH + '.' + process.pid + '.tmp';
  try {
    await writeFile(tmp, JSON.stringify(roster, null, 2) + '\n', 'utf8');
    await rename(tmp, ROSTER_PATH);
  } catch (err) {
    try { await rm(tmp, { force: true }); } catch { /* nothing to clean */ }
    throw err;
  }
  return ROSTER_PATH;
}
