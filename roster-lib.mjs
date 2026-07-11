// roster-lib.mjs — shared roster-import logic.
//
// Used by both import-roster.mjs (CLI) and roster-helper.mjs (the tiny local HTTP
// service behind the control panel's Import button). It drives the platform scrapers
// vendored under roster/ (Challonge, start.gg, TourneyBot, Matcherino, RoundOne —
// from StreamScoreboard, same author, MIT) and produces tally-shared/roster.json:
//
//   { tournament, platform, fetchedAt, count, flagged,
//     names:   ["PG | Punk", ...],                  // legacy/simple consumers
//     players: [{ name: "PG | Punk", flag: "🇺🇸" }] } // flag = emoji or null
//
// Flags currently come from start.gg only (profile location → country → emoji).
// start.gg's public proxy exposed locations in live testing; if a bracket imports
// flagless, set startggApiKey and re-import.
//
// Scraping stays in Node ON PURPOSE: it needs `new URL` + fetch + HTML/JSON parsing,
// which Streamer.bot's C# can't do out of the box and the browser can't either (CORS).
// Streamer.bot only ever serves the resulting roster.json.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectPlatform, listSupportedPlatforms } from './roster/platforms/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROSTER_PATH = resolve(__dirname, 'tally-shared', 'roster.json');
const CONFIG_PATH = resolve(__dirname, 'config.json');

export { listSupportedPlatforms };

// API keys are OPTIONAL (public Challonge brackets + the start.gg public proxy work
// without one). Copy config.example.json to config.json to set them, or use the
// CHALLONGE_API_KEY / STARTGG_API_KEY environment variables.
async function loadConfig() {
  let cfg = {};
  try { cfg = JSON.parse(await readFile(CONFIG_PATH, 'utf8')); } catch { /* no config → keyless paths */ }
  return {
    challongeApiKey: process.env.CHALLONGE_API_KEY || cfg.challongeApiKey || null,
    startggApiKey: process.env.STARTGG_API_KEY || cfg.startggApiKey || null,
  };
}

// Fetch + normalize a tournament's participants into the roster.json shape.
// Throws with a human-readable message on unsupported/unparseable/failed input.
export async function fetchRoster(url) {
  const platform = detectPlatform(url);
  if (!platform) {
    throw new Error('Unsupported URL. Supported: ' + listSupportedPlatforms().map((p) => p.displayName).join(', '));
  }
  const id = platform.parseId(url);
  if (!id) throw new Error(`Could not parse a tournament id from that ${platform.displayName} URL.`);

  const config = await loadConfig();
  const participants = await platform.fetchParticipants(id, config, url);

  // Dedupe by name (keep the first entry's flag), sorted case-insensitively.
  const byName = new Map();
  for (const p of participants) {
    const name = String(p.name || '').trim();
    if (!name || byName.has(name)) continue;
    byName.set(name, { name, flag: p.flag || null });
  }
  const players = [...byName.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  return {
    tournament: id,
    platform: platform.name,
    fetchedAt: new Date().toISOString(),
    count: players.length,
    flagged: players.filter((p) => p.flag).length,
    names: players.map((p) => p.name),
    players,
  };
}

export async function writeRoster(roster) {
  await writeFile(ROSTER_PATH, JSON.stringify(roster, null, 2) + '\n', 'utf8');
  return ROSTER_PATH;
}
