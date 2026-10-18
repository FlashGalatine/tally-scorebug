// Offline fixtures exercise the real importer and resolver; only start.gg HTTP is replaced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { startgg } from './roster/platforms/startgg.js';
import * as rosterLib from './roster-lib.mjs';

const JP = '🇯🇵', US = '🇺🇸';
const entrant = (id, name, country = 'Japan') => ({ id, name,
  participants: [{ player: { user: { location: { country } } } }] });
const player = entrant(11, 'Alpha');
const rival = entrant(22, 'Beta', 'United States');
const set = (id, state, opponents = [player, rival]) => ({
  id, state, fullRoundText: 'Winners Final', slots: opponents.map(entrant => ({ entrant })),
});
function stubStartgg(t, handler) {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body), request = Array.isArray(body) ? body[0] : body;
    const data = handler(request, url, options);
    return { ok: true, status: 200, json: async () => Array.isArray(body) ? [{ data }] : { data } };
  });
}
function setsResponse(nodes, page = 1, totalPages = 1) {
  return { event: { id: 101, sets: { nodes, pageInfo: { page, totalPages } } } };
}
async function lookup() {
  assert.equal(typeof startgg.fetchOpponent, 'function', 'start.gg must support current opponent lookup');
  return startgg.fetchOpponent('101', '11', {});
}

test('roster keeps event and entrant IDs for current opponent lookup', async t => {
  stubStartgg(t, () => ({ event: { id: 101, entrants: {
    nodes: [player, rival], pageInfo: { totalPages: 1 },
  } } }));
  const roster = await rosterLib.fetchRoster('https://www.start.gg/tournament/cup/event/singles');
  assert.equal(roster.eventId, '101');
  assert.deepEqual(roster.players, [
    { id: '11', name: 'Alpha', flag: JP }, { id: '22', name: 'Beta', flag: US },
  ]);
});

test('duplicate names cannot silently select the wrong entrant', async t => {
  stubStartgg(t, () => ({ event: { id: 101, entrants: {
    nodes: [player, entrant(33, 'Alpha')], pageInfo: { totalPages: 1 },
  } } }));
  const roster = await rosterLib.fetchRoster('https://www.start.gg/tournament/cup/event/singles');
  assert.equal(roster.players.length, 1);
  assert.equal(roster.players[0].id, null);
});

test('in-progress set takes priority over upcoming and completed sets', async t => {
  stubStartgg(t, req => {
    assert.equal(req.variables.eventId, '101');
    assert.equal(req.variables.entrantId, '11');
    return setsResponse([set('old', 3), set('next', 1, [player, entrant(33, 'Gamma')]), set('now', 2)]);
  });
  const result = await lookup();
  assert.equal(result.status, 'found');
  assert.deepEqual(result.opponent, { id: '22', name: 'Beta', flag: US });
  assert.equal(result.set.id, 'now');
});

test('a single upcoming head-to-head set supplies the opponent', async t => {
  stubStartgg(t, () => setsResponse([set('next', 1)]));
  assert.equal((await lookup()).opponent.name, 'Beta');
});

test('all pages are considered before choosing a matchup', async t => {
  stubStartgg(t, req => req.variables.page === 1
    ? setsResponse([set('next', 1)], 1, 2)
    : setsResponse([set('now', 2, [player, entrant(33, 'Gamma')])], 2, 2));
  assert.equal((await lookup()).opponent.name, 'Gamma');
});

for (const [label, nodes, status] of [
  ['multiple upcoming sets', [set('a', 1), set('b', 1, [player, entrant(33, 'Gamma')])], 'ambiguous'],
  ['multiple active sets', [set('a', 2), set('b', 2)], 'ambiguous'],
  ['completed sets', [set('done', 3)], 'unavailable'],
  ['invalid reset set', [set('reset', 5)], 'unavailable'],
  ['bye or unresolved opponent', [set('bye', 1, [player, null])], 'unavailable'],
  ['active unresolved opponent ahead of upcoming', [set('now', 2, [player, null]), set('later', 1)], 'unavailable'],
  ['free-for-all set', [set('ffa', 2, [player, rival, entrant(33, 'Gamma')])], 'unavailable'],
  ['unrelated entrants', [set('wrong', 2, [rival, entrant(33, 'Gamma')])], 'unavailable'],
  ['no sets', [], 'unavailable'],
]) test(`${label} does not invent an opponent`, async t => {
  stubStartgg(t, () => setsResponse(nodes));
  const result = await lookup();
  assert.equal(result.status, status);
  assert.equal(result.opponent, undefined);
  assert.ok(result.message);
});

test('official API lookup uses the configured token and returns a missing flag as null', async t => {
  stubStartgg(t, (req, url, options) => {
    assert.equal(url, 'https://api.start.gg/gql/alpha');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    return setsResponse([set('now', 2, [player, entrant(22, 'Beta', null)])]);
  });
  assert.equal(typeof startgg.fetchOpponent, 'function');
  const result = await startgg.fetchOpponent('101', '11', { startggApiKey: 'test-token' });
  assert.equal(result.opponent.flag, null);
});

test('truncated or malformed match data cannot be treated as unambiguous', async t => {
  stubStartgg(t, () => setsResponse([set('next', 1)], 1, 1000));
  await assert.rejects(lookup, /too many|incomplete|limit/i);
});

test('helper library rejects missing identity before making a remote request', async t => {
  stubStartgg(t, () => assert.fail('invalid identity must not reach start.gg'));
  assert.equal(typeof rosterLib.fetchOpponent, 'function');
  await assert.rejects(() => rosterLib.fetchOpponent('', '11'), /event|identity|id/i);
});

for (const state of [4, 6, 7]) test(`unambiguous pending set in state ${state} supplies its opponent`, async t => {
  stubStartgg(t, () => setsResponse([set('pending', state)]));
  assert.equal((await lookup()).opponent.name, 'Beta');
});

test('missing event data reports a lookup error', async t => {
  stubStartgg(t, () => ({ event: null }));
  await assert.rejects(lookup, /unavailable/i);
});

test('helper HTTP route returns fresh matchup, validation errors and CORS headers', async t => {
  const port = 20000 + process.pid % 20000;
  const preload = `globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    const req = Array.isArray(body) ? body[0] : body;
    const data = req.variables.eventId === '101' && req.variables.entrantId === '11'
      ? ${JSON.stringify(setsResponse([set('now', 2)]))} : { event: null };
    return new Response(JSON.stringify(Array.isArray(body) ? [{ data }] : { data }));
  };`;
  const child = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), 'roster-helper.mjs'], {
    cwd: new URL('.', import.meta.url), env: { ...process.env, ROSTER_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Helper did not start')), 5000);
    child.once('error', err => { clearTimeout(timer); reject(err); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Helper exited: ' + code)); });
    child.stdout.on('data', data => { if (String(data).includes('helper listening')) { clearTimeout(timer); resolve(); } });
  });
  const endpoint = `http://127.0.0.1:${port}/opponent`;
  const response = await fetch(endpoint + '?eventId=101&entrantId=11');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.opponent.name, 'Beta');
  const invalid = await fetch(endpoint + '?eventId=101');
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).ok, false);
  const missing = await fetch(endpoint + '?eventId=404&entrantId=11');
  assert.equal(missing.status, 400);
  const preflight = await fetch(endpoint, { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
});
