# Third-party notices

Tally is MIT-licensed (see [LICENSE](LICENSE)). It includes or loads the following
third-party material:

## Vendored code (included in this repository)

- **StreamScoreboard** components — the `tally-themes/primetime/` theme and the
  `roster/` platform importers (Challonge, start.gg, TourneyBot, Matcherino, RoundOne,
  and the nation table) are vendored from the author's own StreamScoreboard project.
  MIT © Ashe "Flash" Galatine — same license and author as this repository.

## Third-party files included in this repository

- **flag-icons** v7.2.3 — <https://github.com/lipis/flag-icons> (MIT © Panayiotis
  Lipiridis). The 257 two-letter country flags (4x3 SVG), unmodified, in
  `tally-themes/primetime/flags/`. Licence text: `tally-themes/primetime/flags/LICENSE.txt`.
- **Quantico** typeface — © 2011 Matthew Desmond, SIL Open Font License 1.1. The Latin
  400 and 700 weights as WOFF2, from the `@fontsource/quantico` 5.3.0 package, in
  `tally-themes/primetime/fonts/`. Licence text: `tally-themes/primetime/fonts/OFL.txt`.

The Primetime theme loads nothing from the internet.

## Loaded at runtime from CDNs (not distributed with this repository)

- The example theme in [docs/THEMING.md](docs/THEMING.md) loads flag SVGs per flag from
  jsDelivr (<https://www.jsdelivr.com/terms>). That is the tutorial snippet only.

## Development dependencies (npm)

- **ws** — <https://github.com/websockets/ws> (MIT). Used only by the local mock
  Streamer.bot server and the verify suite; not needed to run the scorebug.
- **playwright-core** (optional, `--no-save`) — <https://playwright.dev> (Apache-2.0).
  Used only by `verify:render` and `shots`.

The specialty flags (chequered, pirate, rainbow, transgender) in the Primetime theme are
original inline SVGs in this repository, not third-party assets.
