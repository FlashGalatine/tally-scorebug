// Challonge — two fetch paths:
//   • API (preferred when a `challongeApiKey` is configured):
//       GET https://api.challonge.com/v1/tournaments/<id>/participants.json
//     Authoritative, works for tournaments without a generated bracket, has
//     no Cloudflare gate.
//   • Scrape (fallback for OSS users without an API key):
//       GET https://[<subdomain>.]challonge.com/<slug>/module
//     The public bracket-embed page hydrates a Redux store
//     (`window._initialStoreState['TournamentStore']`) that includes every
//     match's player1/player2 with `id`, `seed`, and `display_name`. We
//     dedupe across matches to recover the participant list. Requires the
//     bracket to have been generated (pending tournaments without matches
//     return an empty list).

const API_BASE = 'https://api.challonge.com/v1';
const TOURNAMENT_STORE_RE = /window\._initialStoreState\['TournamentStore'\]\s*=\s*/;

export const challonge = {
  name: 'challonge',
  displayName: 'Challonge',

  matches(input) {
    if (!input) return false;
    try {
      const u = new URL(input);
      return /(^|\.)challonge\.com$/i.test(u.hostname);
    } catch {
      const s = String(input).trim();
      return s.length > 0 && /^[a-z0-9][a-z0-9_-]*$/i.test(s) && !/^\d+$/.test(s);
    }
  },

  parseId(input) {
    const raw = String(input || '').trim();
    if (!raw) return null;
    let slug = raw;
    try {
      const url = new URL(raw);
      if (!/(^|\.)challonge\.com$/i.test(url.hostname)) return null;
      const subdomain = url.hostname.replace(/\.?challonge\.com$/i, '').replace(/\.$/, '');
      slug = url.pathname.replace(/^\/+/, '').split(/[\/?#]/)[0];
      if (!slug) return null;
      if (subdomain && subdomain !== 'www') return `${subdomain}-${slug}`;
      return slug;
    } catch {
      return slug.replace(/^\/+/, '').split(/[\/?#]/)[0] || null;
    }
  },

  async fetchParticipants(tournamentId, config, originalUrl) {
    if (config?.challongeApiKey) {
      return fetchViaApi(tournamentId, config.challongeApiKey);
    }
    return fetchViaScrape(originalUrl, tournamentId);
  },
};

async function fetchViaApi(tournamentId, apiKey) {
  if (!tournamentId) throw new Error('Missing tournament id');
  const url = `${API_BASE}/tournaments/${encodeURIComponent(tournamentId)}/participants.json?api_key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch {}
    throw new Error(`Challonge API ${res.status}: ${detail.slice(0, 200) || res.statusText}`);
  }
  const body = await res.json();
  if (!Array.isArray(body)) throw new Error('Unexpected Challonge response shape');
  return body
    .map((entry) => entry?.participant)
    .filter(Boolean)
    .map((p) => ({
      id: String(p.id),
      name: String(p.display_name || p.name || p.username || '').trim(),
      seed: Number(p.seed) || null,
    }))
    .filter((p) => p.name);
}

async function fetchViaScrape(originalUrl, tournamentId) {
  const moduleUrl = deriveModuleUrl(originalUrl, tournamentId);
  if (!moduleUrl) throw new Error('Could not derive Challonge embed URL');

  const res = await fetch(moduleUrl, {
    headers: {
      Accept: 'text/html',
      // A realistic UA helps avoid surprises if Challonge ever tightens the embed gate.
      'User-Agent': 'Mozilla/5.0 (compatible; StreamScoreboard/0.1)',
    },
  });
  if (!res.ok) {
    throw new Error(`Challonge ${res.status}: ${res.statusText} (no api key configured; fell back to public scrape)`);
  }
  const html = await res.text();
  const store = extractTournamentStore(html);
  if (!store) {
    throw new Error('Challonge: could not extract TournamentStore from embed page (set "challongeApiKey" in config.json for the authoritative API path)');
  }

  const seen = new Map();
  for (const round of Object.values(store.matches_by_round || {})) {
    if (!Array.isArray(round)) continue;
    for (const match of round) {
      for (const p of [match?.player1, match?.player2]) {
        if (!p) continue;
        const id = p.id;
        const name = String(p.display_name || '').trim();
        if (!id || !name || seen.has(id)) continue;
        seen.set(id, {
          id: String(id),
          name,
          seed: Number(p.seed) || null,
        });
      }
    }
  }

  if (seen.size === 0) {
    throw new Error('Challonge: bracket has no participants yet (pending tournaments without a generated bracket can\'t be scraped — set "challongeApiKey" to use the API instead)');
  }
  return [...seen.values()];
}

function deriveModuleUrl(originalUrl, tournamentId) {
  // Prefer the original URL the operator pasted — it carries the right host.
  if (originalUrl) {
    try {
      const u = new URL(originalUrl);
      if (/(^|\.)challonge\.com$/i.test(u.hostname)) {
        const slug = u.pathname.replace(/^\/+/, '').split(/[\/?#]/)[0];
        if (slug) return `${u.origin}/${slug}/module`;
      }
    } catch {
      // Bare slug — fall through to challonge.com root.
    }
  }
  if (tournamentId && /^[a-z0-9_-]+$/i.test(tournamentId)) {
    return `https://challonge.com/${tournamentId}/module`;
  }
  return null;
}

function extractTournamentStore(html) {
  const re = /<script[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    if (!TOURNAMENT_STORE_RE.test(body)) continue;
    const idx = body.search(TOURNAMENT_STORE_RE);
    if (idx < 0) continue;
    const after = body.slice(idx).replace(TOURNAMENT_STORE_RE, '');
    const json = consumeJsonObject(after);
    if (!json) continue;
    try { return JSON.parse(json); } catch { /* try next match */ }
  }
  return null;
}

// Walk balanced braces, respecting strings and escapes, to find the end of
// the `{...}` JSON object that begins at position 0.
function consumeJsonObject(s) {
  if (s[0] !== '{') return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return s.slice(0, i + 1);
    }
  }
  return null;
}
