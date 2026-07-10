# Third-party notices

Tally is MIT-licensed (see [LICENSE](LICENSE)). It includes or loads the following
third-party material:

## Vendored code (included in this repository)

- **StreamScoreboard** components — the `themes/primetime/` theme and the
  `roster/` platform importers (Challonge, start.gg, TourneyBot, Matcherino, RoundOne,
  and `country-codes.js`) are vendored from the author's own StreamScoreboard project.
  MIT © Ashe "Flash" Galatine — same license and author as this repository.

## Loaded at runtime from CDNs (not distributed with this repository)

- **flag-icons** v7.2.3 — <https://github.com/lipis/flag-icons> (MIT © Panayiotis
  Lipiridis). Country flag SVGs, loaded per-flag from jsDelivr by the Primetime theme
  and the theming-tutorial snippets.
- **Quantico** typeface — loaded via Google Fonts by the Primetime theme. SIL Open Font
  License 1.1.
- **jsDelivr** — CDN serving the flag SVGs (<https://www.jsdelivr.com/terms>).

## Development dependencies (npm)

- **ws** — <https://github.com/websockets/ws> (MIT). Used only by the local mock
  Streamer.bot server and the verify suite; not needed to run the scorebug.
- **playwright-core** (optional, `--no-save`) — <https://playwright.dev> (Apache-2.0).
  Used only by `verify:render` and `shots`.

The specialty flags (chequered, pirate, rainbow, transgender) in the Primetime theme are
original inline SVGs in this repository, not third-party assets.
