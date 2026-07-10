// Matcherino — uses the (undocumented) public JSON endpoint
//   GET https://api.matcherino.com/__api/bounties/findById?id=<id>
// which returns `body.individualParticipants[]` with `{ userId, displayName,
// entryWeight, placement, ... }`.
//
// `entryWeight` is Matcherino's seeding field — non-zero means the organiser
// has explicitly seeded that participant. For tournaments without weighted
// seeding (e.g. random brackets), every entryWeight is 0; we surface those as
// `seed: null` so alpha sort behaves sensibly.

const API_BASE = 'https://api.matcherino.com/__api';

export const matcherino = {
  name: 'matcherino',
  displayName: 'Matcherino',

  matches(input) {
    if (!input) return false;
    try {
      const u = new URL(input);
      return /(^|\.)matcherino\.com$/i.test(u.hostname);
    } catch {
      return false;
    }
  },

  parseId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!/(^|\.)matcherino\.com$/i.test(url.hostname)) return null;
      const m = url.pathname.match(/\/tournaments\/(\d+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  },

  async fetchParticipants(tournamentId, _config) {
    if (!/^\d+$/.test(String(tournamentId))) {
      throw new Error('Missing or invalid Matcherino tournament id');
    }

    const res = await fetch(`${API_BASE}/bounties/findById?id=${encodeURIComponent(tournamentId)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'StreamScoreboard/0.1' },
    });
    if (!res.ok) {
      throw new Error(`Matcherino ${res.status}: ${res.statusText}`);
    }

    let env;
    try { env = await res.json(); } catch (err) {
      throw new Error(`Matcherino: failed to parse response (${err.message})`);
    }
    const body = env?.body;
    if (!body) {
      throw new Error('Matcherino: empty response body (tournament may not exist)');
    }

    const participants = body.individualParticipants;
    if (!Array.isArray(participants) || participants.length === 0) {
      // Some bracket types (team tournaments) won't populate individualParticipants.
      throw new Error('Matcherino: no individual participants on this tournament (private, unpublished, team-only, or empty)');
    }

    return participants
      .map((p) => {
        const name = String(p.displayName || '').trim();
        if (!name) return null;
        const seed = Number.isFinite(p.entryWeight) && p.entryWeight > 0 ? p.entryWeight : null;
        return { id: String(p.userId), name, seed };
      })
      .filter(Boolean);
  },
};
