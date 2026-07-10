// start.gg — two fetch paths:
//   • Official Developer API (preferred when `startggApiKey` is configured):
//       POST https://api.start.gg/gql/alpha   with Authorization: Bearer <token>
//     Documented, stable, and authenticated — required for private
//     tournaments or any data the public surface doesn't expose.
//   • Public proxy (fallback when no key):
//       POST https://www.start.gg/api/-/gql
//     The undocumented Next.js backend the start.gg website itself drives.
//     No token, but enforces a `client-version` header — when start.gg bumps
//     it, the server replies 400 with the required version and we retry once.
//
// We use the event-level entrants query in both modes because
// `initialSeedNum` is the overall event seed (correct even for multi-phase /
// multi-pool tournaments). Both URL shapes are accepted:
//   /tournament/<t>/event/<e>                    (event landing)
//   /tournament/<t>/events/<e>/...               (any sub-page incl. standings)

import { flagEmojiForCountry } from '../country-codes.js';

const PUBLIC_ENDPOINT = 'https://www.start.gg/api/-/gql';
const API_ENDPOINT = 'https://api.start.gg/gql/alpha';
const DEFAULT_CLIENT_VERSION = '20';
const PAGE_SIZE = 100;
const MAX_PAGES = 50; // safety cap (5,000 entrants)
const SF6_VIDEOGAME_ID = 43868; // disambiguates multi-event tournaments toward SF6

// Resolve a tournament-level URL (no event segment) to its events so we can pick
// the one to import. Returns each event's full slug (tournament/<t>/event/<e>).
const TOURNAMENT_EVENTS_QUERY = `
query StreamScoreboardTournamentEvents($slug: String!) {
  tournament(slug: $slug) {
    id
    name
    events { id name slug videogame { id } }
  }
}`;

const ENTRANTS_QUERY = `
query StreamScoreboardEventEntrants($slug: String!, $page: Int = 1, $perPage: Int = 100) {
  event(slug: $slug) {
    id
    name
    state
    entrants(query: { perPage: $perPage, page: $page, sortBy: "Entrant.initialSeedNum ASC" }) {
      nodes {
        id name initialSeedNum
        participants { player { user { location { country } } } }
      }
      pageInfo { page total perPage totalPages }
    }
  }
}`;

export const startgg = {
  name: 'startgg',
  displayName: 'start.gg',

  matches(input) {
    if (!input) return false;
    try {
      const u = new URL(input);
      return /(^|\.)start\.gg$/i.test(u.hostname);
    } catch {
      return false;
    }
  },

  parseId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (!/(^|\.)start\.gg$/i.test(url.hostname)) return null;
      // Event-level URL → "<t>/<e>"; tournament-level URL (any sub-page incl.
      // /details, or no sub-page) → bare "<t>" so the import doesn't bail and
      // fetchParticipants can resolve the event from the tournament's events.
      const ev = url.pathname.match(/^\/tournament\/([^\/]+)\/(?:event|events)\/([^\/]+)/);
      if (ev) return `${ev[1]}/${ev[2]}`;
      const t = url.pathname.match(/^\/tournament\/([^\/]+)/);
      if (t) return t[1];
      return null;
    } catch {
      return null;
    }
  },

  async fetchParticipants(displayId, config, originalUrl) {
    const apiKey = config?.startggApiKey ?? null;
    // Prefer an explicit event slug; fall back to resolving the event from a
    // tournament-level URL (e.g. the /details page) via its events list.
    let eventSlug = deriveEventSlug(originalUrl, displayId);
    if (!eventSlug) {
      const tournamentSlug = deriveTournamentSlug(originalUrl, displayId);
      if (!tournamentSlug) {
        throw new Error('start.gg: paste a tournament or event URL (e.g. https://www.start.gg/tournament/<t> or .../tournament/<t>/event/<e>)');
      }
      eventSlug = await resolveEventSlug(tournamentSlug, apiKey);
    }
    return await fetchAllEntrants(eventSlug, apiKey);
  },
};

// An entrant's location lives on the first participant's player→user. SF6 and
// other 1v1 events have one participant; for team events we just read the first.
function flagFromEntrant(node) {
  const country = node?.participants?.[0]?.player?.user?.location?.country;
  return country ? flagEmojiForCountry(country) : null;
}

function deriveEventSlug(originalUrl, displayId) {
  if (originalUrl) {
    try {
      const url = new URL(originalUrl);
      if (/(^|\.)start\.gg$/i.test(url.hostname)) {
        const m = url.pathname.match(/^\/tournament\/([^\/]+)\/(?:event|events)\/([^\/]+)/);
        if (m) return `tournament/${m[1]}/event/${m[2]}`;
      }
    } catch { /* fall through */ }
  }
  if (typeof displayId === 'string') {
    const parts = displayId.split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return `tournament/${parts[0]}/event/${parts[1]}`;
    }
  }
  return null;
}

// Derive the tournament slug ("tournament/<t>") from a tournament-level URL (no
// event segment) or a bare single-segment displayId. Returns null otherwise.
function deriveTournamentSlug(originalUrl, displayId) {
  if (originalUrl) {
    try {
      const url = new URL(originalUrl);
      if (/(^|\.)start\.gg$/i.test(url.hostname)) {
        const m = url.pathname.match(/^\/tournament\/([^\/]+)/);
        if (m) return `tournament/${m[1]}`;
      }
    } catch { /* fall through */ }
  }
  if (typeof displayId === 'string') {
    const parts = displayId.split('/').filter(Boolean);
    if (parts.length >= 1 && parts[0]) return `tournament/${parts[0]}`;
  }
  return null;
}

// Pick the event to import from a tournament. One event → use it (any game);
// many → prefer the single SF6 event; otherwise throw, naming the events so the
// operator can paste a specific event URL.
async function resolveEventSlug(tournamentSlug, apiKey) {
  const data = await gql({
    operationName: 'StreamScoreboardTournamentEvents',
    query: TOURNAMENT_EVENTS_QUERY,
    variables: { slug: tournamentSlug },
    apiKey,
  });
  const tournament = data?.tournament;
  if (!tournament) {
    throw new Error('start.gg: tournament not found (private or draft events need an API token with admin access)');
  }
  const events = Array.isArray(tournament.events) ? tournament.events : [];
  if (events.length === 0) {
    throw new Error('start.gg: this tournament has no events yet');
  }

  let chosen = null;
  if (events.length === 1) {
    chosen = events[0];
  } else {
    const sf6 = events.filter((e) => Number(e?.videogame?.id) === SF6_VIDEOGAME_ID);
    if (sf6.length === 1) chosen = sf6[0];
  }

  if (!chosen || !chosen.slug) {
    const list = events.map((e) => `${e.name} → ${e.slug}`).join('; ');
    throw new Error(`start.gg: tournament has multiple events — paste a specific event URL. Events: ${list}`);
  }
  // start.gg returns the slug already as "tournament/<t>/event/<e>".
  return chosen.slug;
}

async function fetchAllEntrants(slug, apiKey) {
  const out = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && page <= MAX_PAGES) {
    const data = await gql({
      operationName: 'StreamScoreboardEventEntrants',
      query: ENTRANTS_QUERY,
      variables: { slug, page, perPage: PAGE_SIZE },
      apiKey,
    });
    const event = data?.event;
    if (!event) {
      throw new Error('start.gg: event not found (private, deleted, or wrong URL path)');
    }
    const conn = event.entrants;
    if (!conn || !Array.isArray(conn.nodes)) {
      throw new Error('start.gg: no entrants visible (team events use a different field; v1 supports individual events only)');
    }
    for (const n of conn.nodes) {
      if (!n?.id || !n.name) continue;
      out.push({
        id: String(n.id),
        name: String(n.name).trim(),
        seed: Number.isFinite(n.initialSeedNum) ? n.initialSeedNum : null,
        // Derived from the entrant's start.gg profile location, when set and
        // recognized. roster.js uses this only for fresh entries (never
        // overwrites an operator's manual flag pick). Requires the
        // authenticated API path — the public proxy may not expose location.
        flag: flagFromEntrant(n) || undefined,
      });
    }
    totalPages = Number(conn.pageInfo?.totalPages) || 1;
    page++;
  }

  if (out.length === 0) {
    throw new Error('start.gg: event has no entrants yet');
  }
  return out;
}

async function gql({ operationName, query, variables, apiKey }) {
  return apiKey
    ? gqlOfficialApi({ operationName, query, variables, apiKey })
    : gqlPublicProxy({ operationName, query, variables });
}

async function gqlOfficialApi({ operationName, query, variables, apiKey }) {
  const res = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'User-Agent': 'StreamScoreboard/0.1',
    },
    body: JSON.stringify({ operationName, variables, query }),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error('start.gg API: token rejected (check "startggApiKey" in config.json — get one at start.gg → developer settings)');
  }
  if (res.status === 429) {
    throw new Error('start.gg API: rate limit exceeded (default 80 requests / 60 seconds per token) — wait a minute and retry');
  }
  if (!res.ok) {
    throw new Error(`start.gg API ${res.status}: ${res.statusText}`);
  }
  const obj = await res.json();
  if (obj.errors) {
    throw new Error(`start.gg API GraphQL: ${obj.errors[0]?.message ?? 'unknown'}`);
  }
  return obj.data ?? null;
}

let cachedClientVersion = DEFAULT_CLIENT_VERSION;

async function gqlPublicProxy({ operationName, query, variables }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(PUBLIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'StreamScoreboard/0.1',
        'client-version': cachedClientVersion,
        'x-web-source': 'gg-web-gql-client',
        'apollo-client-id': 'smashgg-legacy',
      },
      body: JSON.stringify([{ operationName, variables, query }]),
    });

    if (res.status === 400) {
      const text = await res.text();
      // Self-heal when start.gg bumps the required client-version.
      try {
        const obj = JSON.parse(text);
        const required = obj?.meta?.requiredClientVersion;
        if (required && String(required) !== cachedClientVersion && attempt === 0) {
          cachedClientVersion = String(required);
          continue;
        }
      } catch { /* fall through to throw below */ }
      throw new Error(`start.gg 400: ${text.slice(0, 240)}`);
    }
    if (!res.ok) {
      throw new Error(`start.gg ${res.status}: ${res.statusText}`);
    }
    const arr = await res.json();
    const first = arr[0];
    if (first?.errors) {
      throw new Error(`start.gg GraphQL: ${first.errors[0]?.message ?? 'unknown error'}`);
    }
    return first?.data ?? null;
  }
  throw new Error('start.gg: gql retries exhausted');
}
