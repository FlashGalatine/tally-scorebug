// import-roster.mjs — CLI: populate the control panel's name autocomplete from a
// tournament bracket. Thin wrapper over roster-lib.mjs (the platform scrapers live
// under roster/); the control panel's Import button drives the same lib through
// roster-helper.mjs instead.
//
// Usage:
//   node import-roster.mjs <tournament-url>
//   node import-roster.mjs https://challonge.com/mytourney
//   node import-roster.mjs https://www.start.gg/tournament/<t>/event/<e>
//
// API keys are OPTIONAL (public Challonge brackets + the start.gg public proxy work
// without one). When needed they're read from config.json (copy config.example.json;
// challongeApiKey / startggApiKey), or from CHALLONGE_API_KEY / STARTGG_API_KEY env.
// start.gg flags (from player profile locations) may need the authenticated key path.

import { fetchRoster, writeRoster, listSupportedPlatforms } from './roster-lib.mjs';

function usage(code) {
  console.log('Usage: node import-roster.mjs <tournament-url>\n');
  console.log('Supported platforms:');
  for (const p of listSupportedPlatforms()) console.log('  - ' + p.displayName);
  console.log('\nAPI keys (optional) come from config.json (copy config.example.json) or CHALLONGE_API_KEY / STARTGG_API_KEY.');
  process.exit(code);
}

async function main() {
  const url = process.argv[2];
  if (!url || url === '-h' || url === '--help') usage(url ? 0 : 1);

  console.log('Importing…');
  const roster = await fetchRoster(url);
  const out = await writeRoster(roster);
  console.log(`Wrote ${roster.count} name(s) (${roster.flagged} with flags) → ${out}`);
  console.log('Open (or "Reload" in) the control panel to pick them up.');
}

main().catch((err) => { console.error('Import failed:', err.message); process.exit(1); });
