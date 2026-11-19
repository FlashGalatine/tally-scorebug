# Changelog

All notable changes to **Tally** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the patch number
tracks the repository's commit count at release time.

Nothing was tagged between the initial release and 1.0.10, so that release
collects every change in between. Commit hashes and landing dates are noted for
traceability.

## [Unreleased]

## [1.0.20] — 2026-11-18

### Changed

- **The mock now answers like Streamer.bot.** Development only; nothing deploys. An
  unknown action name gets SB's "was not found" error reply instead of `ok`. A known
  one gets `ok` at once with its arguments echoed and its queue named, as measured on
  1.0.7. A rejected command (unknown nation, unknown command, empty `setmany`) no
  longer sends state back to the sender. `Scoreboard Push` broadcasts to every
  subscriber. Numbers parse as C# `int.TryParse` does (`5.5` and `12abc` are rejected,
  where JS `parseInt` accepted them), single-field values are trimmed, and the three
  chat calling styles are mirrored.
- **Arg-bleed mode.** `GET /mock/bleed?on=1` or `MOCK_ARG_BLEED=1` makes same-action
  requests that arrive together all run with the last one's arguments, which is what
  SB's default queue does. `GET /mock/stats` reports the runs. `verify` proves the mode
  loses the first of two back-to-back commands, from one socket and from two;
  `verify:render` proves one Set click still applies both players with it on.

### Fixed

- **The test tools no longer touch `tally-shared/roster.json`.** `npm run shots` used
  to overwrite the file with a sample and then delete it, and an interrupted
  `verify:render` left the sample in place. Both now serve their sample roster by
  intercepting the page's request.
- **Checks that could not fail.** The "dispatched on connect" check now tests the
  payload, and the opponent-lookup tests wait for the held response to be delivered
  instead of sleeping 100 ms. A malformed percent-escape in a request path no longer
  crashes the mock. `verify` 82/82, `verify:opponent` 22/22, `verify:render` 51/51.

## [1.0.18] — 2026-11-18

### Documentation

- **Put both actions in one blocking queue.** Setup step 3 now says to create a
  blocking action queue and assign `Scoreboard Push` and `Scoreboard Command` to it.
  Measured on Streamer.bot 1.0.7 with a probe action: in the default queue two runs of
  one action overlap, and two back-to-back commands ran with one command's arguments
  in 25 of 25 tries, from one client and from two. In a blocking queue it was 0 of 25
  both ways. So the "arg-bleed" that the companion `flag` argument and `setmany` work
  around is not specific to 1.0.4 or to one client, and the queue setting is the fix
  that also covers chat and Stream Deck. Troubleshooting gains an entry for a command
  lost when two arrive together. No code changed; nothing needs re-pasting.

## [1.0.16] — 2026-11-18

### Added

- **Optional start.gg opponent autofill.** In 2-team mode, enable the Roster
  card's checkbox and select a player to stage their opposing name and flag
  from current start.gg sets. Prefer an in-progress set, otherwise require one
  unambiguous upcoming matchup. Manual edits are protected; missing opponents
  and ambiguous matches show a status instead. Review and Set both players
  together; scores stay unchanged. Re-import older rosters and keep the roster
  helper running for live lookups.

- **Batched Set (`setmany`).** New panel-only command applying many text fields
  (`pNname`/`pNflag`/`header`/`subheader` sibling args) in ONE `DoAction` — the
  SB 1.0.4 arg-bleed rule means a multi-field apply must never be a burst. The
  control panel now tracks *dirty* (edited-but-unset) fields: broadcasts no
  longer snap a typed-but-unset input back to its old value, and any **Set**
  click flushes all dirty fields at once — edit Player 1 and Player 2, click one
  Set, both land. Single-field Sets keep the existing chat-compatible commands;
  name + own flag keeps the companion-`flag` form. `verify` 61/61,
  `verify:render` 21/21.

### Fixed

- **Name autocomplete did nothing inside the OBS dock.** The control panel's roster
  suggestions were a native `<datalist>`, which worked in Chrome/Firefox tabs but
  never appeared when the panel ran as an OBS Custom Browser Dock: OBS docks (and
  browser sources) are CEF *Alloy-style* browsers, and Chromium draws `<datalist>`
  suggestions with the browser's own Autofill popup, which Alloy CEF does not
  implement (CEF #906, wontfix). The suggestions are now an in-page listbox under
  each name box — same roster source, same flag autofill on pick — so the dock
  behaves like a tab: type to filter (case/accent-insensitive substring, prefix
  matches first, matched text highlighted, flag shown), ↓ on an empty box browses
  the roster, ↑/↓ move, Enter or click picks, Esc/blur close; Enter without a
  highlighted row is still the "Set" shortcut. Evo-sized rosters render the first
  200 matches and say how many more. `verify` 61/61, `verify:render` 25/25.

### Documentation

- **Restrict the chat command.** The quick start now says to limit the `!sb` command
  (and any other chat command pointed at `Scoreboard Command`) to moderators and the
  broadcaster. The action does not check who typed a command, so an unrestricted
  command lets any viewer set names and titles, reset scores or change the team count.

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

[1.0.20]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.18...v1.0.20
[1.0.18]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.16...v1.0.18
[1.0.16]: https://github.com/FlashGalatine/tally-scorebug/compare/f264150...v1.0.16
[1.0.10]: https://github.com/FlashGalatine/tally-scorebug/compare/d90adf2...f264150
