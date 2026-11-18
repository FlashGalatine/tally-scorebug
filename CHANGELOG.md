# Changelog

All notable changes to **Tally** are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the patch number
tracks the repository's commit count at release time.

Nothing was tagged between the initial release and 1.0.10, so that release
collects every change in between. Commit hashes and landing dates are noted for
traceability.

## [Unreleased]

### Fixed

- **Opponent autofill prefers a called set.** In a round-robin pool every pending set
  exists at once, so a set that had been called was still reported as ambiguous. The
  order is now: in progress, then called, then the rest.

### Documentation

- The Primetime theme's README lists all five panels, no longer describes pronoun and
  picker add-ins that Tally does not have, and says the flags come from the theme's own
  folder. Its manifest no longer declares an `angle` field nothing can set.
- Code that Tally's actions never reach (the `sync` message, pronouns, the name
  animation, the outward angle) is marked as kept for themes shared with StreamScoreboard.
- THEMING.md says which script reads `__SLOT`; the mock no longer cites a file that does
  not exist; the roster helper's window title says Tally.

### Changed

- `ws` is a development dependency (only the mock and the tests use it), and the docs
  pin `playwright-core@1.65.1` for the render suite.

## [1.0.32] — 2026-11-18

### Changed

- **A score or team count that is not a whole number is rejected.** `!sb p1score 1o`,
  `!sb p1score` with nothing after it, or `5.5` used to set the score to 0 on stream, and
  `!sb teams four` dropped to two teams. Now nothing changes and SB → Logs says why.
- **Flag typo protection is complete.** Country names resolve with or without accents
  (`Türkiye`, `Côte d'Ivoire`, `méxico`); they used to be stored as typed and showed no
  flag. Two letters count as a code only when the table knows the code (`zz` and `en`
  used to become flags that do not exist). Text that is not an emoji is no longer stored
  as a flag. The control panel and the roster import follow the same rules.
- **Names are cut to 64 characters and titles to 80,** so a chat command cannot flood the
  overlay. The control panel's boxes stop at the same lengths.

### Fixed

- **`Scoreboard Command` no longer fails silently.** An exception is logged and broadcast
  as `scoreboard:error` (which the control panel shows), and a missing or disabled
  `Scoreboard Push` is reported in the log instead of being ignored.
- **A first-ever `swap` no longer stores the placeholder names swapped** (slot 1 used to
  read "Player 2" from then on).
- **The `Roster Helper` action checks before and after launching.** It does not start a
  second helper when the port already answers, reports a wrong `BUNDLE` folder, and logs
  a warning when the helper did not come up, instead of always logging "started".

### Added

- **`npm run verify:cs`** compiles the real C# actions with the .NET Framework compiler
  and runs their logic against a stand-in for Streamer.bot's `CPH` object: 66 calls of
  `Scoreboard Command` (chat styles, numbers, flags, caps, swap, failures) and the
  `Scoreboard Push` payload. Until now no test executed the C#.

**Re-paste `actions/scoreboard-command.cs` into the `Scoreboard Command` action and
compile.** `Scoreboard Push` is unchanged. Re-paste `actions/streamerbot-roster-helper.cs`
if you use the `Roster Helper` action (it still needs `System.dll` in References, and its
`BUNDLE` line must be set again). Copy `tally-shared` and reload the dock.

## [1.0.30] — 2026-11-18

### Changed

- **The Primetime panels need no internet.** The Quantico font and the country flags are
  now files in the theme folder (`fonts/`, `flags/`) instead of being loaded from Google
  Fonts and jsDelivr on every page load. On a venue network with no internet the flags
  used to be empty cells and the font fell back; both now work, and no third party is
  contacted. Flags: flag-icons 7.2.3 (MIT), the 257 two-letter codes. Font: Quantico 400
  and 700 (SIL OFL 1.1). Licence texts are beside the files. The repository grows by
  about 2.2 MB.
- **Flags are fetched and embedded.** Streamer.bot's HTTP server sends `.svg` files as
  `application/octet-stream`, which a browser will not draw as an image, so the theme
  fetches each flag once and gives the image a data URI. A panel opened straight from
  disk points at the file directly.

### Fixed

- **A flag code with no picture hides the flag cell** instead of leaving an empty plate
  (for example a mistyped two-letter code).

Copy `tally-themes` (it now includes `flags/` and `fonts/`) and refresh the OBS sources.

## [1.0.28] — 2026-11-18

### Fixed

- **A start.gg tournament URL no longer picks an event for you.** With several events it
  used to import the Street Fighter 6 one whenever there was exactly one, without saying
  so, which gave a streamer running another game the wrong entrants. It now always lists
  the events and asks for the event URL. A tournament with a single event still imports.
- **More URL shapes are understood.** A Challonge URL with a language prefix
  (`challonge.com/fr/mytourney`) used to import a tournament called `fr`. start.gg
  admin-page URLs, and URLs pasted without `https://`, now work. Round.one slugs with
  accented letters are no longer encoded twice. Challonge's own pages
  (`/tournaments/…`, `/communities/…`) are refused with a message that says what to paste.
- **Imported flags use the same nation table as the control panel.** The importer had a
  second, smaller table, so entrants from Syria, Georgia, Armenia, Moldova, Kosovo and
  others imported with no flag although the panel knew the country.

### Removed

- `roster/country-codes.js`, replaced by `tally-shared/nations.js`.

Copy the helper files and restart the helper.

## [1.0.26] — 2026-11-18

### Security

- **The roster helper no longer answers every web page.** It used to send
  `Access-Control-Allow-Origin: *` and take an import as a plain GET, so any page open in
  a browser could make it import a bracket, overwrite `roster.json`, and read entrants
  through your start.gg key. It now answers a named origin only if it is allowed
  (by default the control panel at `http://127.0.0.1:7474` or `http://localhost:7474`;
  add others with `rosterAllowedOrigins` in `config.json` or `ROSTER_ALLOWED_ORIGINS`),
  refuses browser requests marked cross-site, and checks the `Host` header. Import is a
  POST with a JSON body. The old `GET /import?url=` is still answered for one release,
  and only for an allowed origin, so a panel that was not refreshed keeps working.

### Added

- **`GET /health`** reports the helper's version and API level. The Import button checks
  it and says when an older helper is still running, or when the helper refused the
  panel's address.
- **`POST /shutdown`** stops the helper, including the hidden one started from
  Streamer.bot. The README no longer suggests ending every `node.exe`.

### Fixed

- **A `config.json` that is not valid JSON stops the import and says so.** It used to be
  ignored without a word, so the API key was never used. A byte-order mark is accepted.
- **A malformed API key is refused without being echoed.** A key with a line break in it
  used to come back, in full, in the error text.
- **Imports cannot hang or collide.** Every request to a tournament site has a 12-second
  limit (only start.gg had one), the panel gives up after two minutes, imports run one
  at a time, and `roster.json` is written to a temp file and renamed into place.
- **A second helper start says the port is taken** and exits cleanly instead of crashing.
- **A roster the panel cannot read** is reported as such, not as "helper not running".

Copy the helper files and `tally-shared`, restart the helper, reload the dock.

## [1.0.24] — 2026-11-18

### Changed

- **The control panel sends one command at a time.** Each command waits for the
  scoreboard's own broadcast before the next is sent (with an 800 ms fail-safe).
  Streamer.bot answers a request when the action is queued, not when it has run, so the
  answer cannot be used for this. Two score clicks in the same instant, or a held Enter,
  no longer lose a command on an install whose actions are still in the Default queue.
- **An edit stays marked until its Set is confirmed.** Before, the mark was cleared the
  moment the click was sent, so a lost or rejected command silently reverted the box.
- **An unknown nation is held back and named.** It used to be sent raw and only earned a
  warning in the Streamer.bot log. The other edited fields still go.

### Added

- **The panel says what went wrong.** A line under the connection status reports a
  missing action (Streamer.bot's "was not found" reply), an older `Scoreboard Command`
  that did not answer a `setmany`, a `scoreboard:error` broadcast, an unknown nation, and
  a click made while disconnected.
- **Default-queue warning.** Streamer.bot's reply names the queue an action is in. While
  either action answers from `Default`, the panel shows a yellow box pointing at setup
  step 3.

### Fixed

- **A held Enter no longer repeats the Set,** and a held Enter or Space on a +/− button
  no longer streams score changes. A double click on Set sends one request.
- **A team-count click while disconnected** no longer changes the panel's idea of the
  team count.

Copy `tally-shared` and reload the dock. No action needs re-pasting.

## [1.0.22] — 2026-11-18

### Fixed

- **A roster player with no flag no longer inherits the previous player's flag.** Picking
  or typing a roster name whose entrant has no flag now clears the flag box. Before, the
  box kept the last player's flag and the name Set sent it along.
- **A focused box follows changes made elsewhere.** A box left focused after pressing
  Enter used to keep its old value for good, so a later name Set could send a stale flag.
  Only an unsent edit is protected now, not focus.
- **A name Set sends the flag box only when the flag box was filled or edited.** An
  untouched flag box is no longer sent, so it cannot overwrite a flag changed from chat
  or a Stream Deck.
- **Typing `constructor` (or `toString`, …) as a flag no longer breaks the Set click.**
  The nation lookup matched names every object inherits and threw.
- **`?sbport=` and `?rosterport=` accept only a port number.** A value such as
  `8080@other.host` used to be read as a different host.

### Added

- **Unsent edits are visible and can be discarded.** An edited box gets a yellow edge;
  Esc puts the live value back. Edits left in a Player 3/4 card are dropped when the card
  is hidden, so a later Set cannot send them unseen.

Copy `tally-shared` and reload the dock and panels. No action needs re-pasting.

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

[1.0.32]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.30...v1.0.32
[1.0.30]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.28...v1.0.30
[1.0.28]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.26...v1.0.28
[1.0.26]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.24...v1.0.26
[1.0.24]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.22...v1.0.24
[1.0.22]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.20...v1.0.22
[1.0.20]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.18...v1.0.20
[1.0.18]: https://github.com/FlashGalatine/tally-scorebug/compare/v1.0.16...v1.0.18
[1.0.16]: https://github.com/FlashGalatine/tally-scorebug/compare/f264150...v1.0.16
[1.0.10]: https://github.com/FlashGalatine/tally-scorebug/compare/d90adf2...f264150
