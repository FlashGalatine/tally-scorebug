// Round.one — single unauthenticated REST call:
//   GET https://round.one/api/tournaments/<slug>
// returns the full tournament document including a top-level `players[]`
// array with `id`, `name`, `prefix`, `seed`, `disqualified`. We map each
// player to our roster shape, building `Sponsor | Player` when `prefix` is
// set so themes that split on `|` (e.g. Cyberpunk) get the right styling.

const API_BASE = 'https://round.one/api/tournaments';

export const roundone = {
  name: 'roundone',
  displayName: 'Round.one',

  matches(input) {
    if (!input) return false;
    try {
      const u = new URL(input);
      return /(^|\.)round\.one$/i.test(u.hostname);
    } catch {
      return false;
    }
  },

  parseId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!/(^|\.)round\.one$/i.test(url.hostname)) return null;
      const m = url.pathname.match(/^\/tournament\/([^\/?#]+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  },

  async fetchParticipants(slug, _config, _originalUrl) {
    if (!slug) throw new Error('Missing Round.one tournament slug');

    const res = await fetch(`${API_BASE}/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'StreamScoreboard/0.1' },
    });
    if (!res.ok) {
      throw new Error(`Round.one ${res.status}: ${res.statusText}`);
    }

    let data;
    try { data = await res.json(); } catch (err) {
      throw new Error(`Round.one: failed to parse response (${err.message})`);
    }

    const players = data?.players;
    if (!Array.isArray(players) || players.length === 0) {
      throw new Error('Round.one: no players on this tournament (private, unpublished, or empty)');
    }

    return players
      .map((p) => {
        const name = String(p.name || '').trim();
        if (!name) return null;
        const prefix = String(p.prefix || '').trim();
        const fullName = prefix ? `${prefix} | ${name}` : name;
        const seed = Number.isFinite(p.seed) && p.seed > 0 ? p.seed : null;
        return { id: String(p.id), name: fullName, seed };
      })
      .filter(Boolean);
  },
};
