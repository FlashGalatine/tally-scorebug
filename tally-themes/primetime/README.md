# Primetime — broadcast sportscast theme

A professional ESPN-style scoreboard: slight gradients, accented borders, and 55° angular plates with a glossy sheen. Designed to sit directly above a fighting game's health bars, with a trapezoid match-title plate top-center.

## Panels (3)

One combined strip per player plus a title — three OBS browser sources total.

| Panel                          | Dimensions | Notes                                                        |
|--------------------------------|------------|--------------------------------------------------------------|
| `title-309x49.html`            | 309×49     | Trapezoid (NW/NE 55°), purple/black. Header + optional subheader; header grows and centers when the subheader is empty. |
| `player1-strip-545x63.html`    | 545×63     | Red/black parallelogram cells (NW/SE 55°): score, full-bleed flag, sponsor/name/pronouns. Score at the outer (left) edge. |
| `player2-strip-545x63.html`    | 545×63     | Blue/black, mirrored (NE/SW 55°): name, flag, score at the outer (right) edge. |

Inside each strip the name plate flexes: when the flag is toggled off (or empty) its cell collapses and the name plate widens to fill the space.

## Field handling

- **Sponsor** — set the name as `Sponsor | Player` (chat or control panel); the sponsor renders in light gray at regular weight, the player name in bold white (no visible pipe).
- **Pronouns** — built-in add-in, rendered smaller after the name when enabled.
- **Flag** — built-in add-in, rendered as a full-bleed SVG filling its cell. The emoji value is converted to an ISO-3166 alpha-2 code and fetched from the flag-icons CDN (a raw 2-letter code also works). The picker's specialty flags (chequered, pirate, rainbow, transgender) render from inline SVGs — no network needed.
- **Auto-fit** — sponsor + name + pronouns shrink together to fit the plate; header/subheader likewise.
- Names render exactly as typed — set them in UPPERCASE for the full broadcast look.
- `logo` and `color` add-ins are not rendered by this theme.

## Customisation

- Palette lives at the top of `theme.css` in the `:root` block (`--p1-red`, `--p2-blue`, `--purple`, `--lt-gray`); per-cell `--accent` (border) and `--fill` (plate gradient) pairs are grouped under "Plate colors".
- The 55° slant is `--slant` (44px on 63px-tall cells, 34px on the 49px title): `slant = height / tan(angle)`.
- Cell widths are the `flex-basis` values on `.pt-score` / `.pt-flag` in `theme.css`.
- The sheen overlay is the first background layer in `.pt-plate::after` — remove it for flat plates.

## Network dependencies

- Google Fonts (Quantico 400/700) — loaded via `@import` in `theme.css`.
- [flag-icons](https://github.com/lipis/flag-icons) v7.2.3 (MIT) — flag SVGs loaded per-country from jsDelivr by the strip panels.

Both can be self-hosted for fully offline use.

## Author

Flash Galatine — see the project [README](../../README.md).

MIT License.
