// Roster-import platform registry.
//
// Each platform module exports an object with:
//   name             — short id ("challonge", "tourneybot")
//   displayName      — human label
//   matches(input)   — returns true if this platform should handle the input
//   parseId(input)   — returns a tournament identifier string, or null
//   fetchParticipants(id, config, originalUrl)
//                    — returns Promise<{id, name, seed}[]>
//                      `originalUrl` is the raw input the operator pasted —
//                      passed through so platforms that need the full URL
//                      (e.g. Challonge's subdomain-aware scrape path) can use it.
//
// Order matters for `detectPlatform` — first match wins. Put URL-host-specific
// platforms before any platform that accepts loose bare-string input.
//
// Adding a new service (e.g. start.gg): drop a new module into this folder,
// import it here, and add it to PLATFORMS. No other code changes required.

import { tourneybot } from './tourneybot.js';
import { matcherino } from './matcherino.js';
import { startgg } from './startgg.js';
import { roundone } from './roundone.js';
import { challonge } from './challonge.js';

export const PLATFORMS = [tourneybot, matcherino, startgg, roundone, challonge];

export function detectPlatform(input) {
  for (const p of PLATFORMS) {
    if (p.matches(input)) return p;
  }
  return null;
}

export function listSupportedPlatforms() {
  return PLATFORMS.map((p) => ({ name: p.name, displayName: p.displayName }));
}
