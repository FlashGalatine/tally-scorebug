// TourneyBot — no public REST API, but every public tournament page embeds the
// full state as a Next.js __NEXT_DATA__ JSON blob. We GET the page and pull
// `pageProps.players` out of it. No auth required for public tournaments.

const NEXT_DATA_RE = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/;

export const tourneybot = {
  name: 'tourneybot',
  displayName: 'TourneyBot',

  matches(input) {
    if (!input) return false;
    try {
      const u = new URL(input);
      return /(^|\.)tourneybot\.gg$/i.test(u.hostname);
    } catch {
      return false;
    }
  },

  parseId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!/(^|\.)tourneybot\.gg$/i.test(url.hostname)) return null;
      // Path looks like /tourneys/<id>
      const m = url.pathname.match(/\/tourneys\/(\d+)/);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  },

  async fetchParticipants(tournamentId, _config) {
    if (!tournamentId || !/^\d+$/.test(String(tournamentId))) {
      throw new Error('Missing or invalid TourneyBot tournament id');
    }
    const url = `https://tourneybot.gg/tourneys/${encodeURIComponent(tournamentId)}`;
    const res = await fetch(url, {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'StreamScoreboard/0.1 (+https://github.com/)',
      },
    });
    if (!res.ok) {
      throw new Error(`TourneyBot ${res.status}: ${res.statusText}`);
    }
    const html = await res.text();
    const match = html.match(NEXT_DATA_RE);
    if (!match) throw new Error('TourneyBot: could not locate __NEXT_DATA__ in page (private tournament, or page format changed)');

    let data;
    try {
      data = JSON.parse(match[1]);
    } catch (err) {
      throw new Error(`TourneyBot: failed to parse __NEXT_DATA__ (${err.message})`);
    }

    const players = data?.props?.pageProps?.players;
    if (!Array.isArray(players)) {
      throw new Error('TourneyBot: pageProps.players missing — tournament may be private or unpublished');
    }

    return players
      .filter((p) => p && !p.removed)
      .map((p) => ({
        id: String(p.id),
        name: String(p.name || '').trim(),
        seed: Number.isFinite(p.seedId) ? p.seedId : null,
      }))
      .filter((p) => p.name);
  },
};
