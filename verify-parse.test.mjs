// Roster import: URL parsing for every platform, event choice on start.gg, and flag
// mapping (Sprint 6 of the 2026-11-18 remediation plan). Offline: HTTP is stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from './roster/platforms/index.js';
import { startgg, flagEmojiForCountry } from './roster/platforms/startgg.js';
import { challongeSlug } from './roster/platforms/challonge.js';

// Point the library at a config file that does not exist BEFORE it loads, so these
// tests never read an operator's real keys.
process.env.TALLY_CONFIG = 'no-such-config.json';
const rosterLib = await import('./roster-lib.mjs');

// [input, platform name or null, parsed id or null]
const CASES = [
  // start.gg
  ['https://www.start.gg/tournament/cup/event/singles', 'startgg', 'cup/singles'],
  ['https://start.gg/tournament/cup/events/singles/brackets/1/2', 'startgg', 'cup/singles'],
  ['https://www.start.gg/tournament/cup/details', 'startgg', 'cup'],
  ['https://www.start.gg/tournament/cup', 'startgg', 'cup'],
  ['https://www.start.gg/admin/tournament/cup/event/singles/seeding', 'startgg', 'cup/singles'],
  ['https://www.start.gg/admin/tournament/cup/dashboard', 'startgg', 'cup'],
  ['https://www.start.gg/user/abc123', 'startgg', null],
  // Challonge
  ['https://challonge.com/mytourney', 'challonge', 'mytourney'],
  ['https://challonge.com/mytourney/standings', 'challonge', 'mytourney'],
  ['https://challonge.com/fr/mytourney', 'challonge', 'mytourney'],
  ['https://challonge.com/pt_BR/mytourney/participants', 'challonge', 'mytourney'],
  ['https://challonge.com/xy', 'challonge', 'xy'], // a two-letter slug on its own is a slug, not a locale
  ['https://nfc.challonge.com/weekly42', 'challonge', 'nfc-weekly42'],
  ['https://www.challonge.com/mytourney', 'challonge', 'mytourney'],
  ['https://challonge.com/tournaments/123', 'challonge', null],
  ['https://challonge.com/communities/foo/tournaments/bar', 'challonge', null],
  ['https://challonge.com/users/someone', 'challonge', null],
  ['https://challonge.com/', 'challonge', null],
  ['mytourney', 'challonge', 'mytourney'], // a bare slug
  // Matcherino, TourneyBot, Round.one
  ['https://matcherino.com/tournaments/12345', 'matcherino', '12345'],
  ['https://matcherino.com/tournaments/12345/overview', 'matcherino', '12345'],
  ['https://matcherino.com/t/some-slug', 'matcherino', null],
  ['https://tourneybot.gg/tourneys/987', 'tourneybot', '987'],
  ['https://tourneybot.gg/about', 'tourneybot', null],
  ['https://round.one/tournament/spring-cup', 'roundone', 'spring-cup'],
  ['https://round.one/tournament/caf%C3%A9-cup', 'roundone', 'café-cup'],
  // Hosts that only look right
  ['https://start.gg.evil.example/tournament/cup/event/singles', null, null],
  ['https://evil.example/start.gg/tournament/cup', null, null],
  ['https://evilchallonge.com/mytourney', null, null],
  ['https://challonge.com.evil.example/mytourney', null, null],
  ['https://start.gg@evil.example/tournament/cup', null, null],
  ['https://example.com/not-a-bracket', null, null],
];

test('every platform: which input it claims and the id it parses', () => {
  for (const [input, platform, id] of CASES) {
    const p = detectPlatform(input);
    assert.equal(p ? p.name : null, platform, `platform for ${input}`);
    if (p) assert.equal(p.parseId(input), id, `id for ${input}`);
  }
});

test('input pasted without a scheme is given https://, a bare word is left alone', () => {
  const n = rosterLib.normalizeInput;
  assert.equal(n('start.gg/tournament/cup/event/singles'), 'https://start.gg/tournament/cup/event/singles');
  assert.equal(n('  www.challonge.com/abc '), 'https://www.challonge.com/abc');
  assert.equal(n('challonge.com'), 'https://challonge.com');
  assert.equal(n('mytourney'), 'mytourney');
  assert.equal(n('https://challonge.com/abc'), 'https://challonge.com/abc');
  assert.equal(n('fixture:cup'), 'fixture:cup');
  assert.equal(detectPlatform(n('start.gg/tournament/cup/event/singles')).name, 'startgg');
});

test('the Challonge scrape always uses https, the default port and the bare slug', () => {
  assert.equal(challongeSlug(new URL('http://challonge.com:8443/fr/mytourney')), 'mytourney');
  assert.equal(challongeSlug(new URL('https://challonge.com/tournaments/1')), null);
});

test('an unusable URL gets an error that says what to paste', async () => {
  await assert.rejects(rosterLib.fetchRoster('https://challonge.com/tournaments/123'), /Could not find a tournament in that Challonge URL.*challonge\.com\/mytourney/);
  await assert.rejects(rosterLib.fetchRoster('https://example.com/x'), /Unsupported URL/);
});

// ── start.gg event choice ──
function stubStartgg(t, handler) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body), request = Array.isArray(body) ? body[0] : body;
    calls.push(request.operationName);
    const data = handler(request);
    return { ok: true, status: 200, json: async () => (Array.isArray(body) ? [{ data }] : { data }) };
  });
  return calls;
}
const entrant = (id, name, country) => ({ id, name, participants: [{ player: { user: { location: { country } } } }] });
const entrants = { event: { id: 7, entrants: { nodes: [entrant(1, 'Alpha', 'Japan'), entrant(2, 'Beta', 'Türkiye'), entrant(3, 'Gamma', null)], pageInfo: { totalPages: 1 } } } };

test('a tournament URL with several events is refused, even when exactly one is Street Fighter 6', async (t) => {
  stubStartgg(t, (req) => (/TournamentEvents/.test(req.operationName)
    ? { tournament: { id: 1, name: 'Big Major', events: [
      { id: 10, name: 'Street Fighter 6', slug: 'tournament/major/event/sf6', videogame: { id: 43868 } },
      { id: 11, name: 'TEKKEN 8', slug: 'tournament/major/event/tekken-8', videogame: { id: 49783 } }] } }
    : entrants));
  await assert.rejects(rosterLib.fetchRoster('https://www.start.gg/tournament/major/details'),
    (err) => /multiple events/.test(err.message) && /Street Fighter 6/.test(err.message) && /TEKKEN 8/.test(err.message));
});

test('a tournament URL with one event imports that event', async (t) => {
  const calls = stubStartgg(t, (req) => (/TournamentEvents/.test(req.operationName)
    ? { tournament: { id: 1, name: 'Local', events: [{ id: 7, name: 'Singles', slug: 'tournament/local/event/singles' }] } }
    : entrants));
  const roster = await rosterLib.fetchRoster('start.gg/tournament/local');
  assert.equal(roster.count, 3);
  assert.equal(roster.eventId, '7');
  assert.ok(calls.some((c) => /TournamentEvents/.test(c)), 'the events were looked up');
});

test('an admin-page event URL imports the event directly', async (t) => {
  const calls = stubStartgg(t, () => entrants);
  const roster = await rosterLib.fetchRoster('https://www.start.gg/admin/tournament/local/event/singles/seeding');
  assert.equal(roster.count, 3);
  assert.ok(!calls.some((c) => /TournamentEvents/.test(c)), 'no event lookup was needed');
});

// ── flags ──
test('imported flags come from the one nation table', async (t) => {
  stubStartgg(t, () => entrants);
  const roster = await rosterLib.fetchRoster('https://www.start.gg/tournament/local/event/singles');
  assert.deepEqual(roster.players.map((p) => [p.name, p.flag]), [['Alpha', '🇯🇵'], ['Beta', '🇹🇷'], ['Gamma', null]]);
  assert.equal(roster.flagged, 2);
});

test('countries the old import table lacked now resolve; non-countries do not', () => {
  const want = { Syria: '🇸🇾', Georgia: '🇬🇪', Armenia: '🇦🇲', Moldova: '🇲🇩', Kosovo: '🇽🇰', Afghanistan: '🇦🇫', Libya: '🇱🇾',
    Yemen: '🇾🇪', Bahamas: '🇧🇸', Guam: '🇬🇺', Belize: '🇧🇿', 'North Korea': '🇰🇵', 'United States': '🇺🇸',
    'Korea, Republic of': '🇰🇷', 'Türkiye': '🇹🇷', 'Côte d’Ivoire': '🇨🇮', 'Trinidad & Tobago': '🇹🇹' };
  for (const [name, flag] of Object.entries(want)) assert.equal(flagEmojiForCountry(name), flag, name);
  for (const not of ['', null, 'jp', 'zz', 'Narnia', 'constructor', 'toString']) assert.equal(flagEmojiForCountry(not), null, String(not));
  assert.equal(typeof startgg.fetchOpponent, 'function');
});

// Review fixes (Release after 1.0.34).
test('Challonge: a two-letter bracket name is not taken for a language prefix', async () => {
  const { challongeSlug } = await import('./roster/platforms/challonge.js');
  const slug = (u) => challongeSlug(new URL(u));
  assert.equal(slug('https://challonge.com/ab/standings'), 'ab');
  assert.equal(slug('https://challonge.com/ab/participants'), 'ab');
  assert.equal(slug('https://challonge.com/ab'), 'ab');
  assert.equal(slug('https://challonge.com/fr/mytourney'), 'mytourney');
  assert.equal(slug('https://challonge.com/fr/mytourney/standings'), 'mytourney');
  assert.equal(slug('https://challonge.com/pt_BR/mytourney'), 'mytourney');
});

test('every flag file the Primetime theme ships can be typed as its two-letter code', async () => {
  await import('./tally-shared/nations.js');
  const { readdir } = await import('node:fs/promises');
  const { resolveFlag, isoToEmoji, isEmojiOnly } = globalThis.Nations;
  const files = await readdir(new URL('./tally-themes/primetime/flags/', import.meta.url));
  const codes = files.map((f) => /^([a-z]{2})\.svg$/.exec(f)).filter(Boolean).map((m) => m[1]);
  assert.ok(codes.length >= 250, 'the flag folder is there');
  // flag-icons' own extras with no flag emoji: xx (unknown) and pc (Pacific Community).
  const refused = codes.filter((c) => c !== 'xx' && c !== 'pc' && resolveFlag(c) !== isoToEmoji(c));
  assert.deepEqual(refused, []);
  assert.equal(resolveFlag('isle of man'), isoToEmoji('im'));
  assert.equal(resolveFlag('zz'), null, 'two letters that are no code are still refused');
  for (const sub of ['gb-eng', 'gb-sct', 'gb-wls']) assert.ok(files.includes(sub + '.svg'), sub + '.svg is shipped');
  assert.equal(isEmojiOnly('\u200D'), false, 'a joiner alone shows nothing');
  assert.equal(isEmojiOnly('\uFE0F'), false);
  assert.equal(isEmojiOnly('\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}'), true, 'England');
});
