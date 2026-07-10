# Tally

**A Streamer.bot-native tournament scorebug for OBS.** Player names, scores, and
nationality flags on stream — driven from **Twitch chat**, a **Stream Deck**, **hotkeys**,
or a small **browser control panel**. No dedicated server: Streamer.bot serves the
overlays and holds the state.

![Title](docs/primetime-title.png)

![Player 1 strip](docs/primetime-strip-p1.png)
![Player 2 strip](docs/primetime-strip-p2.png)

Type `!sb p1flag japan` in chat and the flag appears. Import a start.gg or Challonge
bracket once and every entrant's name autocompletes in the control panel — with their
flag. Made for FGC / esports streams that run fast matches and don't want to alt-tab.

| | |
|---|---|
| **Overlay** | the bundled **Primetime** theme — an ESPN-style title plate + one combined strip per player (score · flag · name), with auto-fit type and score-bump/name-swap animation |
| **State** | eight Streamer.bot global variables (persist across restarts) |
| **Control** | chat commands, Stream Deck, hotkeys, and `shared/control.html` |
| **Roster** | import a bracket (start.gg, Challonge, TourneyBot, Matcherino, RoundOne) → name autocomplete + flag autofill |
| **Needs** | Streamer.bot (tested on 1.0.4) + OBS. Node.js 18+ only for the roster import and the local no-SB mock — the scorebug itself runs on Streamer.bot alone |

## Quick start

1. **WebSocket Server** — Streamer.bot → *Servers/Clients → WebSocket Server*: enable,
   `127.0.0.1:8080`, authentication **off**.
2. **HTTP Server** — *Servers/Clients → HTTP Server*: enable, `127.0.0.1:7474`, add two
   Path → Folder mappings (folders from wherever you cloned this repo):

   | Path | Folder |
   |---|---|
   | `themes` | `<repo>\themes` |
   | `shared` | `<repo>\shared` |

3. **Two actions** — Actions → new action named **exactly** `Scoreboard Push`; add a
   sub-action *Core → C# → Execute C# Code*; paste [`actions/scoreboard-push.cs`](actions/scoreboard-push.cs);
   **Compile**. Repeat for `Scoreboard Command` with
   [`actions/scoreboard-command.cs`](actions/scoreboard-command.cs). Both compile with **no
   added references**. (The names matter: panels request `Scoreboard Push` on connect, and
   `Scoreboard Command` runs it by name.)
4. **OBS** — add a Browser Source per panel, at its native size:

   ```
   http://127.0.0.1:7474/themes/primetime/panels/title-309x49.html            (309×49)
   http://127.0.0.1:7474/themes/primetime/panels/player1-strip-545x63.html    (545×63)
   http://127.0.0.1:7474/themes/primetime/panels/player2-strip-545x63.html    (545×63)
   ```

5. **Drive it.** Create a chat command `!sb` (Commands tab), then — the step that's easy to
   miss — open the `Scoreboard Command` action and **add the command as a Trigger** on it
   (Triggers box → search the command's name). Then, in chat:

   ```
   !sb header SOLUTION TO SUNDAY      !sb p1name FGC | Vamp Fatale
   !sb subheader Grand Finals · FT10  !sb p1flag japan
   !sb p1+                            !sb swap
   ```

A panel added mid-match paints immediately: on connect it asks Streamer.bot to re-broadcast
current state (there is no "blank until the next update").

## Commands

Everything runs through the one parametric `Scoreboard Command` action:

| `command` | `value` | Effect |
|---|---|---|
| `p1+` `p1-` `p2+` `p2-` | — | score ±1 (clamped 0–99) |
| `p1score` `p2score` | number | set a score directly |
| `reset` | — | both scores → 0 |
| `swap` | — | swap the two players (name + score + flag) |
| `p1name` `p2name` | text | set a name — `Sponsor \| Player` renders as a sponsor plate |
| `p1flag` `p2flag` | nation | set the nationality flag (see below) |
| `header` `subheader` | text | match title / subtitle |

**Flags & nation aliases.** A nation can be an ISO-3166 code (`jp`, `gb`, `fr`), one of
~260 country names/aliases (`japan`, `uk`, `britain`, `great britain`, `united kingdom`,
`usa`, `america`, `holland`, …), a flag emoji pasted directly (covers 🏴‍☠️ and friends), or
`none`/`clear` to remove. Values resolve to the flag emoji internally and the theme renders
real SVG flags (flag-icons). Unknown nations are rejected with a warning in SB → Logs, so a
typo can't blank the panel. The alias table lives in [`shared/nations.js`](shared/nations.js)
with a mechanical copy in the C# — `npm run verify` diffs the two so they can't drift.

**Chat styles.** Either one dispatch command (`!sb p1+` — a single trigger handles
everything) or a dedicated command per action (`!p1+`, `!p1flag`, …) — create each command
and add each as a trigger on `Scoreboard Command`. The command text must include the `!`
you actually type. Watch **SB → Logs** for `[Scoreboard Command] token='…'` to see what
each message parsed to.

**Stream Deck / hotkeys.** Make a wrapper action per button: *Set Argument* `command` =
`p1+` → *Run Action* `Scoreboard Command`; bind the key to the wrapper (Stream Deck plugin
→ Do Action). Best for the no-typing commands: scores, reset, swap.

## The control panel

![Control panel](docs/control-panel.png)

Open **`http://127.0.0.1:7474/shared/control.html`** — or add it as an **OBS Custom
Browser Dock** (View → Docks → Custom Browser Docks). Name fields with roster
autocomplete, flag fields with alias resolution + live preview, score buttons,
titles, reset/swap. It drives the same `Scoreboard Command` over SB's WebSocket and
live-reflects state, so it never fights chat or the deck.

**Roster import (names + flags).** Paste a tournament URL in the Roster card and click
**Import**: every entrant autocompletes, and picking a player auto-fills their flag (from
their start.gg profile location — editable before you Set; that's the override). Setting a
name sends the flag with it, so one click applies both.

The Import button talks to a tiny local helper (it does the scraping — needed only at
import time, never mid-match). Start it any of three ways, no terminal required:

- **From Streamer.bot (automatic):** third action `Roster Helper` with
  [`actions/streamerbot-roster-helper.cs`](actions/streamerbot-roster-helper.cs) — edit
  `BUNDLE`, add **`System.dll`** in the C# editor's **References** tab (required — see the
  file header), Compile, and give it your SB's application-started trigger.
- **Double-click** [`start-roster-helper.bat`](start-roster-helper.bat).
- **Terminal:** `npm run roster` (alias for `node roster-helper.mjs`).

API keys are optional — public Challonge brackets and start.gg's public path work keyless
(a live start.gg test returned 12/12 entrants *with* flags). If a bracket imports flagless,
copy `config.example.json` → `config.json` and set `startggApiKey`. CLI alternative:
`npm run import -- <tournament-url>`.

## Make it yours

The Primetime theme is one look — the wire format is deliberately tiny and any HTML page
can be a panel. **[docs/THEMING.md](docs/THEMING.md)** is a full tutorial with two worked
approaches: a **single-file scorebug** (fewest OBS sources — one combined strip per player,
or one full-scene overlay) and **per-field components** (one small panel per name/score/
flag, maximum layout freedom in OBS), plus the copy-paste flag renderer and the dev loop.

## Try it without Streamer.bot

```
npm install
npm start          # mock Streamer.bot: http://127.0.0.1:7474/ lists the panels
npm run verify     # protocol + HTTP + nation-table parity  → ALL GREEN
```

`npm start` runs a small mock of SB's two servers so you can develop themes and poke the
panels with zero setup: drive state with the console keys (`q/a` P1 ±, `w/s` P2 ±, `r`
reset, `x` swap) or `GET /mock/cmd?command=p1+`. `npm run verify:render` (needs
`npm i --no-save playwright-core`) renders the real theme headless and checks pixels;
`npm run shots` regenerates the screenshots above.

## Troubleshooting

- **Chat command does nothing** → the command isn't a **trigger** on `Scoreboard Command`
  (the action shows Triggers: 0), or its text doesn't match what you type (`p1+` configured
  vs `!p1+` typed). SB → Logs shows `[Scoreboard Command] token='…'` for every hit.
- **Panels blank** → state never arrived over the WS. Check the WS Server is on `:8080`
  with auth off, and that the action is named exactly `Scoreboard Push` and **compiles**
  (`DoAction` returning ok only means the action *started* — a compile error broadcasts
  nothing). On error the actions broadcast `{ type:'scoreboard:error', message }`.
- **`Uri`/`Process`/`Newtonsoft` "does not exist" when writing your own actions** → SB
  (a .NET Framework 4.7.2 app) resolves a minimal default reference set. Add `System.dll`
  (or SB's own `Newtonsoft.Json.dll`) in the C# editor's **References** tab. Tally's two
  scoreboard actions need no references on purpose.
- **Import fails with "helper not running"** → start the roster helper (see above).
- **Flags show as letters (GB) in the control panel** → Windows has no color flag-emoji
  glyphs; cosmetic and panel-only. The theme renders real SVG flags.
- **`npm start` fails with `EADDRINUSE`/`EACCES`** → real Streamer.bot already owns
  `:7474`/`:8080`. You don't need the mock when SB is serving; or relocate it:
  `SB_HTTP_PORT=7480 SB_WS_PORT=8090 npm start`.
- **Subscribe case gotcha (for integrators):** the shim subscribes with lowercase
  `events: { general: ['Custom'] }` even though delivered events carry `General.Custom` —
  capital `General` in the Subscribe silently receives nothing.

## Credits & license

MIT — see [LICENSE](LICENSE). The Primetime theme and the roster platform scrapers are
vendored from [StreamScoreboard](https://github.com/FlashGalatine) (same author, MIT) —
if you want a full web dashboard, more themes, and per-player add-in fields, that's the
bigger sibling this project is the Streamer.bot-native distillation of. Flag SVGs by
[flag-icons](https://github.com/lipis/flag-icons) (MIT, via jsDelivr); Quantico typeface
via Google Fonts (OFL). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
