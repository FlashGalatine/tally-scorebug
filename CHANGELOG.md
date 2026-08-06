# Changelog

All notable changes to **Tally** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the patch number
tracks the repository's commit count at release time.

Nothing was tagged between the initial release and 1.0.10, so that release
collects every change in between. Commit hashes and landing dates are noted for
traceability.

## [Unreleased]

### Added

- **Batched Set (`setmany`).** New panel-only command applying many text fields
  (`pNname`/`pNflag`/`header`/`subheader` sibling args) in ONE `DoAction` — the
  SB 1.0.4 arg-bleed rule means a multi-field apply must never be a burst. The
  control panel now tracks *dirty* (edited-but-unset) fields: broadcasts no
  longer snap a typed-but-unset input back to its old value, and any **Set**
  click flushes all dirty fields at once — edit Player 1 and Player 2, click one
  Set, both land. Single-field Sets keep the existing chat-compatible commands;
  name + own flag keeps the companion-`flag` form. `verify` 61/61,
  `verify:render` 21/21.

## [1.0.10] — 2026-07-29

### Added

- **Optional 3–4 team mode.** A `teams 2-4` command (backed by the `sb.teams`
  global) makes broadcasts carry `teams` plus `player3` / `player4` only when
  enabled — the two-team payload shape is unchanged. Full `p3*` / `p4*` command
  set (score / name / flag, from chat, Stream Deck or the control panel);
  `reset` clears all four slots while `swap` stays 1 ↔ 2. The control panel
  gains a Teams selector and Player 3/4 cards that appear at teams 3/4, and the
  Primetime theme gains P3 (green) and P4 (gold) strips that stay hidden until
  teams mode reaches them and re-hide when it is lowered. The README adds a
  teams walkthrough and a "not just scores" counter section (deaths, attempts,
  running gags). `verify` 53/53, `verify:render` 16/16.
  (`bc27277`, 2026-07-20)

### Changed

- **BREAKING — SB HTTP paths renamed `themes` / `shared` → `tally-themes` /
  `tally-shared`** (#1). The generic prefixes were liable to collide with other
  Streamer.bot add-ons serving the same paths, so both the URL paths and the
  on-disk folders are now prefixed. Panels load `/tally-shared/panel-core.js`;
  the mock server, verify suites, shots tool and roster helpers follow.
  **Upgrading:** re-map both SB paths and update the OBS panel/control URLs
  together — old `/themes/` and `/shared/` URLs 404. StreamScoreboard themes no
  longer port byte-for-byte; `THEMING.md` documents the one-line `src` repoint
  (or a `shared` compatibility alias mapping). Verified 43/43 + 12/12.
  (`88e8396`, 2026-07-10)

### Fixed

- **Control panel's name Set silently never applied.** Clicking **Set** on a
  player name did nothing — the input snapped back to the previous name — while
  the same edit via chat worked. `doSet()` sent two back-to-back `DoAction`s to
  `Scoreboard Command` (the name, then that player's flag), and Streamer.bot
  1.0.4 bleeds the arguments of same-action `DoAction`s landing within a few ms
  together, so **both** ran as `p<N>flag`; the name was never written and the
  following Push reflected the old name back into the box. Fix: one `DoAction`
  carrying both — the name in `value` and the resolved nation in a new optional
  `flag` companion argument that `scoreboard-command.cs` reads on a `pNname`
  command. A bad flag only warns; the name still applies. Panel-only upgraders
  degrade gracefully — an un-re-pasted C# ignores `flag`, so the name applies
  and only the ride-along flag waits for the re-paste. The render suite now taps
  the page's outbound WebSocket frames and asserts a name Set emits exactly one
  `DoAction` carrying both fields. `verify` 57/57, render 18/18.
  (`343e2bd`, 2026-07-25)
- **Roster Helper could zombie Streamer.bot's ports.** With
  `UseShellExecute = false` the spawned node process inherited SB's listening
  sockets (WS `:8080` / HTTP `:7474`); if SB then exited uncleanly, the orphaned
  helper kept those ports bound and SB could not restart its WebSocket server
  until the node process was killed. `UseShellExecute = true` launches via the
  shell, which does not pass SB's handles to the child (`WindowStyle Hidden`
  keeps it invisible). The README adds a troubleshooting entry for the
  zombie-`:8080` symptom and notes that `:8080` is only the default —
  `?sbport=` and `window.__SB_WS_URL` override it. (`b38c578`, 2026-07-10)

### Documentation

- README: clone / Download-ZIP as the first setup step. (`53f2175`, 2026-07-21)
- Support links point at the personal Discord server. (`32e241d`, 2026-07-20)
- README states Tally was never OBS-specific — the panels are plain local web
  pages over HTTP + WebSocket — with the real floor (Chromium ≥ 80), the
  old-XSplit caveat, each app's source type, and the standard Author & support
  block. (`361ccc5`, 2026-07-09)
- Repository URL added to `package.json`. (`3b27a3f`, 2026-07-09)

## [0.1.0] — 2026-07-09

Initial release — Streamer.bot-native tournament scorebug for OBS. (`d90adf2`)

### Added

- Names, scores and nationality flags on stream, driven from Twitch chat, a
  Stream Deck, hotkeys or a browser control panel. Streamer.bot serves the
  overlays over HTTP and holds the state in global variables — there is no
  dedicated server process.
- **`themes/primetime`** — ESPN-style title plate and combined player strips
  (score | flag | name) with auto-fit type and score-bump / name-swap
  animation.
- **`shared/panel-core.js`** — the SB transport every panel loads (Subscribe →
  `General.Custom` → `scoreboard:sync` / `update` DOM events, with a
  DoAction-on-connect so late-added panels paint immediately).
- **`actions/`** — two zero-reference C# actions (hand-written JSON, flat state
  across 8 globals) plus an optional roster-helper launcher (needs `System.dll`
  via the References tab).
- **Flags** — ~260 nation names and aliases resolve to flag emoji, from a shared
  table in `nations.js` with a mechanical copy in the C# that `verify`
  parity-checks.
- **Roster import** — pull a bracket from start.gg, Challonge, TourneyBot,
  Matcherino or RoundOne for control-panel name autocomplete and flag autofill;
  helper service, `.bat` and SB-action launchers, all terminal-free.
- **`docs/THEMING.md`** — build-your-own-theme tutorial (single-file scorebug vs
  per-field components) with complete runnable examples.
- Mock Streamer.bot and verify suites: protocol 43/43, real-pixel render 12/12
  (Playwright); `npm run shots` regenerates the README screenshots.

Primetime theme and roster scrapers vendored from StreamScoreboard (same
author, MIT).

[1.0.10]: https://github.com/FlashGalatine/tally-scorebug/compare/d90adf2...main
