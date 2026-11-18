// Compiles the REAL Streamer.bot action files with the Windows C# compiler and runs
// their logic against a stand-in for `CPH` (tools/cs/CphStub.cs). Before this, no test
// executed the C# at all; the mock only mirrors it.
//
// Needs csc.exe from the .NET Framework (present on Windows; set CSC to override).
// Elsewhere the tests are skipped. It proves the actions compile as C# 5 against
// mscorlib alone and behave as expected. It does not replace compiling them in
// Streamer.bot, whose own compiler and reference set have the final say.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const CSC = process.env.CSC || 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const HAVE_CSC = existsSync(CSC);
const skip = HAVE_CSC ? false : 'csc.exe not found (set CSC to its path); the C# was not compiled';

const JP = '🇯🇵', GB = '🇬🇧', TR = '🇹🇷', CI = '🇨🇮';
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';
const PIRATE = '\u{1F3F4}\u200D\u2620\uFE0F';

// Build an exe from the stub, the harness and one action file. Streamer.bot injects
// the `CPH` member itself; here the class is given a field of the stub's type.
async function build(dir, actionFile, { refs = [] } = {}) {
  let src = (await readFile(join(ROOT, 'actions', actionFile), 'utf8')).replace(/\r\n/g, '\n');
  const marker = 'public class CPHInline\n{';
  assert.ok(src.includes(marker), actionFile + ' declares class CPHInline');
  src = src.replace(marker, marker + '\n    public CphStub CPH;');
  const actionPath = join(dir, actionFile);
  await writeFile(actionPath, src, 'utf8');
  const exe = join(dir, actionFile.replace(/\.cs$/, '.exe'));
  // /noconfig: no default reference list, so only mscorlib (plus any `refs`) is available.
  const r = spawnSync(CSC, ['/nologo', '/noconfig', '/warnaserror-', '/target:exe', '/out:' + exe, ...refs.map((x) => '/r:' + x),
    join(ROOT, 'tools', 'cs', 'CphStub.cs'), join(ROOT, 'tools', 'cs', 'Harness.cs'), actionPath], { encoding: 'utf8' });
  return { exe, ok: r.status === 0, log: (r.stdout || '') + (r.stderr || '') };
}

// Run a script through a built action; returns one parsed record per Execute().
async function run(dir, exe, lines) {
  const script = join(dir, 'script.txt'), out = join(dir, 'out.txt');
  await writeFile(script, lines.join('\n') + '\n', 'utf8');
  const r = spawnSync(exe, [script, out], { encoding: 'utf8' });
  assert.equal(r.status, 0, 'harness ran: ' + (r.stderr || r.stdout));
  return (await readFile(out, 'utf8')).split('\n').filter(Boolean).map((line) => {
    const rec = { g: {} };
    for (const part of line.split('\t')) {
      const e = part.indexOf('='), k = part.slice(0, e), v = part.slice(e + 1);
      if (k === 'ret') rec.ret = v === 'true';
      else if (k === 'warn') rec.warn = Number(v);
      else if (k === 'ran') rec.ran = v ? v.split(',') : [];
      else if (k === 'bc') rec.bc = v ? v.split('\u001e') : [];
      else rec.g[k] = v;
    }
    return rec;
  });
}
const args = (o) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\t') || '(no args)';

test('Scoreboard Command compiles with mscorlib alone and behaves as specified', { skip }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tally-cs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const b = await build(dir, 'scoreboard-command.cs');
  assert.ok(b.ok, 'compiles:\n' + b.log);

  // Each case: [arguments, check(record)]. They run in order on one state.
  const long = 'N'.repeat(70), longTitle = 'T'.repeat(90);
  const cases = [
    // ── scores ──
    [{ command: 'p1+' }, (r) => r.ret && r.g['sb.p1score'] === '1' && r.ran.join() === 'Scoreboard Push'],
    [{ command: 'p1+' }, (r) => r.g['sb.p1score'] === '2'],
    [{ command: 'p1-' }, (r) => r.g['sb.p1score'] === '1'],
    [{ command: 'p2-' }, (r) => r.g['sb.p2score'] === '0'], // clamped at 0
    [{ command: 'p1score', value: '7' }, (r) => r.g['sb.p1score'] === '7'],
    [{ command: 'p1score', value: ' 8 ' }, (r) => r.g['sb.p1score'] === '8'],
    [{ command: 'p1score', 'value:int': '9' }, (r) => r.g['sb.p1score'] === '9'], // a number argument
    [{ command: 'p1score', value: '100' }, (r) => r.g['sb.p1score'] === '99'],
    [{ command: 'p1score', value: '-3' }, (r) => r.g['sb.p1score'] === '0'],
    [{ command: 'p1score', value: '6' }, (r) => r.g['sb.p1score'] === '6'],
    // TAL-06: not a whole number → rejected, nothing changes, no push
    [{ command: 'p1score', value: '1o' }, (r) => !r.ret && r.warn === 1 && r.ran.length === 0 && r.g['sb.p1score'] === '6'],
    [{ command: 'p1score', value: '5.5' }, (r) => !r.ret && r.g['sb.p1score'] === '6'],
    [{ command: 'p1score' }, (r) => !r.ret && r.g['sb.p1score'] === '6'],
    [{ command: 'p1score', value: '100000000000' }, (r) => !r.ret && r.g['sb.p1score'] === '6'],
    // ── teams ──
    [{ command: 'teams', value: '4' }, (r) => r.ret && r.g['sb.teams'] === '4'],
    [{ command: 'teams', value: '9' }, (r) => r.g['sb.teams'] === '4'],
    [{ command: 'teams', value: 'four' }, (r) => !r.ret && r.warn === 1 && r.ran.length === 0 && r.g['sb.teams'] === '4'],
    [{ command: 'teams', value: '3.5' }, (r) => !r.ret && r.g['sb.teams'] === '4'],
    [{ command: 'teams', value: '2' }, (r) => r.ret && r.g['sb.teams'] === '2'],
    // ── the three calling styles ──
    [{ command: '!p2name', rawInput: '  FGC | Vamp Fatale ', commandId: 'abc' }, (r) => r.g['sb.p2name'] === 'FGC | Vamp Fatale'],
    [{ command: '!sb', input0: 'p1name', rawInput: 'p1name NFC | The Tyrant' }, (r) => r.g['sb.p1name'] === 'NFC | The Tyrant'],
    [{ command: '!sb', input0: 'P1+', rawInput: 'P1+' }, (r) => r.ret && r.g['sb.p1score'] === '7'],
    [{ command: '!sb', input0: 'header', rawInput: 'header' }, (r) => r.ret && r.g['sb.header'] === ''], // "!sb header" clears it
    [{ command: 'header', value: 'Explicit', rawInput: 'ignored' }, (r) => r.g['sb.header'] === 'Explicit'],
    [{ command: 'subheader Grand Finals' }, (r) => r.g['sb.subheader'] === 'Grand Finals'], // value after the token
    [{ command: '!sb', input0: 'nope', rawInput: 'nope x' }, (r) => !r.ret && r.warn === 1 && r.ran.length === 0],
    [{}, (r) => !r.ret && r.warn === 1],
    // ── flags (TAL-07) ──
    [{ command: 'p1flag', value: 'japan' }, (r) => r.ret && r.g['sb.p1flag'] === JP],
    [{ command: 'p1flag', value: 'UK' }, (r) => r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: 'Great-Britain' }, (r) => r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: 'jp' }, (r) => r.g['sb.p1flag'] === JP],
    [{ command: 'p1flag', value: 'Türkiye' }, (r) => r.ret && r.g['sb.p1flag'] === TR],
    [{ command: 'p1flag', value: 'Côte d’Ivoire' }, (r) => r.ret && r.g['sb.p1flag'] === CI],
    [{ command: 'p1flag', value: 'méxico' }, (r) => r.ret && r.g['sb.p1flag'] === '🇲🇽'],
    [{ command: 'p1flag', value: ENGLAND }, (r) => r.ret && r.g['sb.p1flag'] === ENGLAND], // a subdivision flag passes through
    [{ command: 'p1flag', value: PIRATE }, (r) => r.ret && r.g['sb.p1flag'] === PIRATE],
    [{ command: 'p1flag', value: GB }, (r) => r.ret && r.g['sb.p1flag'] === GB],
    // every flag file the theme ships can be typed as its code or its name
    [{ command: 'p1flag', value: 'im' }, (r) => r.ret && r.g['sb.p1flag'] === '🇮🇲'],
    [{ command: 'p1flag', value: 'Jersey' }, (r) => r.ret && r.g['sb.p1flag'] === '🇯🇪'],
    [{ command: 'p1flag', value: 'EU' }, (r) => r.ret && r.g['sb.p1flag'] === '🇪🇺'],
    [{ command: 'p1flag', value: GB }, (r) => r.ret && r.g['sb.p1flag'] === GB],
    // nothing visible: a joiner, a variation selector or tag characters alone
    [{ command: 'p1flag', value: '\u200D' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: '\uFE0F\u200D' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: '\u{E0067}\u{E007F}' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: 'zz' }, (r) => !r.ret && r.warn === 1 && r.ran.length === 0 && r.g['sb.p1flag'] === GB], // two letters, not a code
    [{ command: 'p1flag', value: 'en' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: 'florpland' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: 'café' }, (r) => !r.ret && r.g['sb.p1flag'] === GB], // accented text that is not a nation
    [{ command: 'p1flag', value: '日本' }, (r) => !r.ret && r.g['sb.p1flag'] === GB],
    [{ command: 'p1flag', value: GB + ' x' }, (r) => !r.ret && r.g['sb.p1flag'] === GB], // emoji mixed with text
    [{ command: 'p1flag', value: 'none' }, (r) => r.ret && r.g['sb.p1flag'] === ''],
    // ── name + companion flag; a bad flag keeps the name ──
    [{ command: 'p1name', value: 'Alpha', flag: 'japan' }, (r) => r.ret && r.g['sb.p1name'] === 'Alpha' && r.g['sb.p1flag'] === JP],
    [{ command: 'p1name', value: 'Beta', flag: 'florpland' }, (r) => r.ret && r.warn === 1 && r.g['sb.p1name'] === 'Beta' && r.g['sb.p1flag'] === JP],
    // ── setmany ──
    [{ command: 'setmany', p1name: ' One ', p2name: 'Two', p2flag: 'uk', header: ' Cup ', subheader: '' },
      (r) => r.ret && r.g['sb.p1name'] === 'One' && r.g['sb.p2name'] === 'Two' && r.g['sb.p2flag'] === GB && r.g['sb.header'] === 'Cup' && r.g['sb.subheader'] === ''],
    [{ command: 'setmany', p1name: 'Kept', p1flag: 'florpland' }, (r) => r.ret && r.warn === 1 && r.g['sb.p1name'] === 'Kept' && r.g['sb.p1flag'] === JP],
    [{ command: 'setmany' }, (r) => !r.ret && r.warn === 1 && r.ran.length === 0],
    // ── length caps (decision 2) ──
    [{ command: 'p1name', value: long }, (r) => r.ret && r.warn === 1 && r.g['sb.p1name'].length === 64],
    [{ command: 'header', value: longTitle }, (r) => r.warn === 1 && r.g['sb.header'].length === 80],
    [{ command: 'setmany', p2name: long, subheader: longTitle }, (r) => r.warn === 2 && r.g['sb.p2name'].length === 64 && r.g['sb.subheader'].length === 80],
    // 63 letters + one flag emoji (4 UTF-16 units) is cut before the emoji, not through it
    [{ command: 'p3name', value: 'x'.repeat(63) + JP }, (r) => r.g['sb.p3name'] === 'x'.repeat(63)],
    [{ command: 'p3name', value: 'x'.repeat(62) + '😀' + 'tail' }, (r) => r.g['sb.p3name'] === 'x'.repeat(62) + '😀'],
    // ── swap and reset ──
    [{ command: 'setmany', p1name: 'Left', p1flag: 'jp', p2name: 'Right', p2flag: 'gb' }, (r) => r.ret],
    [{ command: 'p1score', value: '3' }, (r) => r.ret],
    [{ command: 'swap' }, (r) => r.g['sb.p1name'] === 'Right' && r.g['sb.p2name'] === 'Left' && r.g['sb.p1flag'] === GB && r.g['sb.p2flag'] === JP && r.g['sb.p2score'] === '3'],
    [{ command: 'reset' }, (r) => ['1', '2', '3', '4'].every((n) => r.g['sb.p' + n + 'score'] === '0')],
    // ── failures are loud (TAL-09) ──
    ['#pushfails=1'],
    [{ command: 'p1+' }, (r) => r.ret && r.warn === 1 && r.g['sb.p1score'] === '1'], // stored, and the missing push is warned about
    ['#pushfails=0'],
    ['#throw=sb.header'],
    [{ command: 'header', value: 'boom' }, (r) => !r.ret && r.warn === 1 && r.bc.length === 1
      && JSON.parse(r.bc[0]).type === 'scoreboard:error' && /Scoreboard Command: stub: this write was made to fail/.test(JSON.parse(r.bc[0]).message)],
    ['#throw='],
    // ── a first-ever swap leaves the placeholders alone ──
    ['#reset'],
    [{ command: 'swap' }, (r) => r.ret && !('sb.p1name' in r.g) && !('sb.p2name' in r.g)],
    [{ command: 'p2name', value: 'Solo' }, (r) => r.g['sb.p2name'] === 'Solo'],
    // one name set: it moves across, and the placeholder is never stored
    [{ command: 'swap' }, (r) => r.g['sb.p1name'] === 'Solo' && !('sb.p2name' in r.g)],
    [{ command: 'swap' }, (r) => r.g['sb.p2name'] === 'Solo' && !('sb.p1name' in r.g)],
    // ── the answer the control panel waits for ──
    [{ command: 'p1+', rid: 'a-1' }, (r) => r.ret && r.bc.length === 1 && JSON.stringify(JSON.parse(r.bc[0])) === JSON.stringify({ type: 'scoreboard:ack', rid: 'a-1', ok: true, message: '' })],
    [{ command: 'p1score', value: '1o', rid: 'a-2' }, (r) => !r.ret && r.bc.length === 1 && JSON.parse(r.bc[0]).rid === 'a-2' && JSON.parse(r.bc[0]).ok === false && /needs a whole number/.test(JSON.parse(r.bc[0]).message)],
    [{ command: 'p1flag', value: 'florpland', rid: 'a-3' }, (r) => !r.ret && JSON.parse(r.bc[0]).ok === false && /unknown nation/.test(JSON.parse(r.bc[0]).message)],
    [{ command: 'p1name', value: 'Named', flag: 'florpland', rid: 'a-4' }, (r) => r.ret && JSON.parse(r.bc[0]).ok === true && JSON.parse(r.bc[0]).message === ''], // the name applied
    ['#pushfails=1'],
    [{ command: 'p1+', rid: 'a-5' }, (r) => r.ret && JSON.parse(r.bc[0]).ok === false && /Scoreboard Push/.test(JSON.parse(r.bc[0]).message)],
    ['#pushfails=0'],
    ['#throw=sb.header'],
    [{ command: 'header', value: 'boom', rid: 'a-6' }, (r) => !r.ret && r.bc.length === 2 && JSON.parse(r.bc[0]).type === 'scoreboard:error'
      && JSON.parse(r.bc[1]).type === 'scoreboard:ack' && JSON.parse(r.bc[1]).ok === false && /made to fail/.test(JSON.parse(r.bc[1]).message)],
    ['#throw='],
    [{ command: 'p1+' }, (r) => r.ret && r.bc.length === 0], // chat and Stream Deck send no rid and get no answer
  ];
  const lines = cases.map(([a]) => (typeof a === 'string' ? a : args(a)));
  const records = await run(dir, b.exe, lines);
  const checks = cases.filter(([a]) => typeof a !== 'string');
  assert.equal(records.length, checks.length, 'one result per call');
  checks.forEach(([a, ok], i) => {
    assert.ok(ok(records[i]), `case ${i + 1}: ${JSON.stringify(a)} → ${JSON.stringify(records[i])}`);
  });
});

test('Scoreboard Push compiles and broadcasts the documented shape', { skip }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tally-cs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const b = await build(dir, 'scoreboard-push.cs');
  assert.ok(b.ok, 'compiles:\n' + b.log);
  const recs = await run(dir, b.exe, [
    '(no args)', // nothing set yet: defaults
    '#global sb.p1name=PG | "Punk"', '#global sb.p1score=3', '#global sb.p1flag=' + JP, '#global sb.header=Cup\\Finals', '#global sb.subheader=FT2',
    'reason=overlay-connect',
    '#global sb.teams=4', '#global sb.p3name=Third', '#global sb.p4score=abc',
    '(no args)',
    '#global sb.teams=nonsense',
    '(no args)',
  ]);
  const first = JSON.parse(recs[0].bc[0]);
  assert.deepEqual(first, { type: 'scoreboard:update', player1: { name: 'Player 1', score: 0, fields: {} }, player2: { name: 'Player 2', score: 0, fields: {} },
    header: '', subheader: '', fields: {}, fieldsEnabled: {} });
  const second = JSON.parse(recs[1].bc[0]);
  assert.equal(second.player1.name, 'PG | "Punk"', 'quotes survive the hand-written JSON');
  assert.equal(second.header, 'Cup\\Finals', 'backslashes survive');
  assert.deepEqual(second.player1.fields, { flag: JP });
  assert.deepEqual(second.fieldsEnabled, { 'player.flag': true });
  assert.equal(second.teams, undefined, 'two teams: no teams key');
  const third = JSON.parse(recs[2].bc[0]);
  assert.equal(third.teams, 4);
  assert.equal(third.player3.name, 'Third');
  assert.deepEqual(third.player4, { name: 'Player 4', score: 0, fields: {} }, 'a non-numeric stored score reads as 0');
  assert.equal(JSON.parse(recs[3].bc[0]).teams, undefined, 'a nonsense team count falls back to 2');
  assert.ok(recs.every((r) => r.ret));
});

test('the Roster Helper launcher compiles once System.dll is referenced', { skip }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'tally-cs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const without = await build(dir, 'streamerbot-roster-helper.cs');
  assert.ok(!without.ok && /CS0246|CS0234|CS0103/.test(without.log), 'as its header says, it does not compile without System.dll');
  const withRef = await build(dir, 'streamerbot-roster-helper.cs', { refs: ['System.dll'] });
  assert.ok(withRef.ok, 'compiles with System.dll:\n' + withRef.log);
});
