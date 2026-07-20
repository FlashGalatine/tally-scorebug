# Make your own theme

The bundled Primetime look is one opinion. The wire format underneath is deliberately
tiny, and **any HTML page can be a panel** — this tutorial builds one from scratch, in
the two shapes people actually want:

- **[Approach A — as few OBS sources as possible](#approach-a--the-single-file-scorebug):**
  one combined strip per player (or even one full-scene overlay). Fewer browser sources,
  fewer things to drag around; the layout lives in your CSS.
- **[Approach B — many individual components](#approach-b--per-field-components):** one
  tiny panel per field (name, score, flag, title). Every element is its own OBS source you
  can place, scale, and animate independently.

Both consume the exact same events. Pick per project — you can even mix them.

---

## How a panel works (the contract)

Every panel is a static HTML file served by Streamer.bot's HTTP Server under
`/tally-themes/<your-theme>/…`. It does three things:

```html
<script>window.__SLOT = "player1"; window.__FIELD = "strip";</script>
<script src="/tally-shared/panel-core.js"></script>
<script src="../theme.js"></script>  <!-- or inline your JS -->
```

1. **Declare what it renders** — `window.__SLOT` (`player1` … `player4` / `match`) and
   `window.__FIELD` (your choice of label) — *before* loading panel-core.
2. **Load `/tally-shared/panel-core.js`** by that **absolute path**. This is the transport: it
   connects to Streamer.bot's WebSocket (`:8080`), subscribes, asks for the current state
   (so a panel added mid-match paints immediately), and re-dispatches every update as DOM
   events. Your code never touches the socket.
3. **Listen for two `window` CustomEvents** and update the DOM:

```js
window.addEventListener('scoreboard:sync',   (e) => render(e.detail));
window.addEventListener('scoreboard:update', (e) => render(e.detail));
```

Both carry the same state shape in `detail`:

```json
{
  "player1": { "name": "FGC | Vamp Fatale", "score": 9,  "fields": { "flag": "🇯🇵" } },
  "player2": { "name": "NFC | The Tyrant",  "score": 10, "fields": { "flag": "🇬🇧" } },
  "header": "SOLUTION TO SUNDAY",
  "subheader": "Grand Finals · FT10",
  "fields": {},
  "fieldsEnabled": { "player.flag": true }
}
```

Conventions worth honoring:

- **`fieldsEnabled["player.flag"]`** — render flags only when this is `true` *and* the
  player's `fields.flag` is non-empty. (It's `true` whenever any player has a flag.)
- **3–4 team mode** — when the operator runs `teams 3` or `teams 4`, the payload gains
  a `"teams": 3|4` key plus `"player3"` (and `"player4"`) objects in the same shape.
  All three are **absent** in the default two-team mode, so a theme that only knows
  `player1`/`player2` keeps working unchanged. A `player3`/`player4` panel should hide
  itself when its slot is missing from the payload (Primetime's theme.js toggles
  `.hidden` on the strip root — teams was lowered back, don't show stale state).
- **`Sponsor | Player` names** — a `|` in the name is a sponsor prefix; split it if your
  design has a sponsor treatment, or render the string as-is if not.
- **`body.offline`** — panel-core toggles the `offline` class on `<body>` when the
  Streamer.bot connection drops; style it if you want a "disconnected" look (dim, hide…).
- Values are already resolved: `score` is a clamped integer, `flag` is a flag **emoji**
  (convert to an SVG yourself — snippet below — or render the emoji as text).

That's the whole integration. No library, no build step.

**Porting a StreamScoreboard theme** takes one edit per panel: its stock panels load
`<script src="/shared/panel-core.js">`, so repoint each to `/tally-shared/panel-core.js`
and drop the theme into `tally-themes/`. (Or, if nothing else on your SB claims the
`shared` path, add a third HTTP Server mapping `shared` → `<repo>\tally-shared` as a
compatibility alias and the stock panels work unedited.) Everything else — the events,
the state shape, `__SLOT`/`__FIELD` — is identical in both projects.

---

## Approach A — the single-file scorebug

One HTML file per player strip. Two OBS sources total (plus a title if you want one).
Because panels are served over `http://`, a **query parameter can pick the slot**, so
both players share one file.

Save this as `tally-themes/mytheme/strip.html` — it's complete and runnable as-is:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>My Strip</title>
<style>
  /* Canvas = OBS source size. Keep body exactly this size. */
  body { margin: 0; width: 520px; height: 60px; background: transparent;
         font-family: "Segoe UI", system-ui, sans-serif; overflow: hidden; }
  .strip { display: flex; align-items: center; height: 100%;
           background: linear-gradient(105deg, #101318 70%, #1b2130);
           border-left: 6px solid #e0405f; color: #f2f2f2; }
  .score { width: 64px; text-align: center; font-size: 32px; font-weight: 800;
           background: #e0405f; color: #fff; align-self: stretch;
           display: grid; place-items: center; }
  .flag  { height: 34px; margin: 0 12px; border-radius: 3px; display: none; }
  .flag.on { display: block; }
  .name  { font-size: 24px; font-weight: 600; white-space: nowrap; }
  .sponsor { opacity: .6; font-weight: 400; margin-right: .45em; }
  body.offline .strip { opacity: .35; }        /* connection lost */
  .p2 .score { background: #3b82f6; }          /* player 2 accent */
  .p2 { border-left-color: #3b82f6; }
</style>
</head>
<body>
  <div class="strip" id="strip">
    <div class="score" id="score">0</div>
    <img class="flag" id="flag" alt="">
    <div class="name"><span class="sponsor" id="sponsor"></span><span id="pname"></span></div>
  </div>

  <!-- ?player=2 turns this same file into the P2 strip -->
  <script>
    var who = new URLSearchParams(location.search).get('player') === '2' ? 'player2' : 'player1';
    window.__SLOT = who; window.__FIELD = 'strip';
    if (who === 'player2') document.getElementById('strip').classList.add('p2');
  </script>
  <script src="/tally-shared/panel-core.js"></script>
  <script>
    var FLAG_CDN = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';

    // Flag emoji (🇯🇵) or ISO code (jp) → flag-icons SVG url; null if neither.
    function flagSrc(v) {
      var s = String(v || '').trim();
      if (!s) return null;
      if (/^[A-Za-z]{2}$/.test(s)) return FLAG_CDN + s.toLowerCase() + '.svg';
      var cps = Array.from(s).map(function (c) { return c.codePointAt(0); });
      if (cps.length === 2 && cps.every(function (cp) { return cp >= 0x1F1E6 && cp <= 0x1F1FF; }))
        return FLAG_CDN + String.fromCharCode(cps[0] - 0x1F1E6 + 97, cps[1] - 0x1F1E6 + 97) + '.svg';
      return null; // specialty flags: see tally-themes/primetime/theme.js for inline-SVG handling
    }

    function render(state) {
      var p = state[window.__SLOT];
      if (!p) return;

      document.getElementById('score').textContent = p.score;

      // Sponsor | Player split
      var raw = String(p.name || ''), sponsor = '', name = raw;
      var i = raw.indexOf('|');
      if (i >= 0) { sponsor = raw.slice(0, i).trim(); name = raw.slice(i + 1).trim(); }
      document.getElementById('sponsor').textContent = sponsor;
      document.getElementById('pname').textContent = name;

      // Flag: gated on the operator toggle + a non-empty value
      var img = document.getElementById('flag');
      var src = state.fieldsEnabled && state.fieldsEnabled['player.flag'] === true
        ? flagSrc(p.fields && p.fields.flag) : null;
      if (src) { if (img.getAttribute('src') !== src) img.src = src; img.classList.add('on'); }
      else { img.removeAttribute('src'); img.classList.remove('on'); }
    }

    window.addEventListener('scoreboard:sync',   function (e) { render(e.detail); });
    window.addEventListener('scoreboard:update', function (e) { render(e.detail); });
  </script>
</body>
</html>
```

Add two OBS Browser Sources, both 520×60:

```
http://127.0.0.1:7474/tally-themes/mytheme/strip.html
http://127.0.0.1:7474/tally-themes/mytheme/strip.html?player=2
```

Restyle to taste — everything visual is the `<style>` block. The JS only ever sets text,
an image src, and classes.

### Variant: ONE source for the whole scene

The logical extreme of Approach A: a single 1920×1080 page that renders the title and
both strips, absolutely positioned where you want them on screen — **one** OBS source
for the entire scorebug. Same contract; the render function just fills every element:

```html
<style>
  body { margin: 0; width: 1920px; height: 1080px; background: transparent; }
  .strip  { position: absolute; }                  /* style as above */
  #p1     { left: 60px;  top: 40px; }
  #p2     { left: 60px;  top: 110px; }
  #title  { position: absolute; left: 60px; top: 170px; }
</style>
...
<script>window.__SLOT = 'match'; window.__FIELD = 'scene';</script>
<script src="/tally-shared/panel-core.js"></script>
<script>
  function render(s) {
    fillStrip(document.getElementById('p1'), s.player1, s);
    fillStrip(document.getElementById('p2'), s.player2, s);
    document.getElementById('header').textContent = s.header || '';
    document.getElementById('subheader').textContent = s.subheader || '';
  }
  // fillStrip = the same score/name/flag logic as the single strip above
</script>
```

Pros: one browser source, one page to reason about, elements can share animations.
Cons: repositioning means editing CSS instead of dragging sources in OBS, and you can't
show/hide parts per scene without CSS tricks. Pick your trade.

---

## Approach B — per-field components

One small panel per field — this is how the bundled Primetime's sibling themes
(cyberpunk/sakura in StreamScoreboard) ship: separate name, score, and flag panels that
you place independently in OBS. Maximum layout freedom, more sources to manage.

A complete name-only component, `tally-themes/mytheme/panels/p1-name.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
  body { margin: 0; width: 300px; height: 48px; background: transparent; overflow: hidden; }
  #value { height: 100%; display: flex; align-items: center; padding: 0 12px;
           font: 600 24px "Segoe UI", sans-serif; color: #fff;
           background: rgba(12,14,20,.85); border-radius: 6px; }
</style>
</head>
<body>
  <div id="value"></div>
  <script>window.__SLOT = "player1"; window.__FIELD = "name";</script>
  <script src="/tally-shared/panel-core.js"></script>
  <script>
    function render(s) {
      var p = s[window.__SLOT]; if (!p) return;
      document.getElementById('value').textContent = p.name || '';
    }
    window.addEventListener('scoreboard:sync',   function (e) { render(e.detail); });
    window.addEventListener('scoreboard:update', function (e) { render(e.detail); });
  </script>
</body>
</html>
```

Clone it per field and change only the render line (and `__FIELD`, which is just a label
for your own bookkeeping):

| Component | render reads | notes |
|---|---|---|
| score | `p.score` | integer, already clamped 0–99 |
| flag | `p.fields.flag` + `s.fieldsEnabled['player.flag']` | use the `flagSrc()` snippet from Approach A |
| title | `s.header` / `s.subheader` | use `__SLOT = "match"` |

Duplicate the set with `__SLOT = "player2"` for the other side (or use the
`?player=` query trick from Approach A so each file serves both slots).

For polish beyond this skeleton — auto-fit text that shrinks to the box, score-bump
animation, name-swap transitions, specialty flags (🏴‍☠️ etc. have no ISO code and need
inline SVGs) — read [`tally-themes/primetime/theme.js`](../tally-themes/primetime/theme.js); it's
~290 commented lines implementing all of those against the same contract.

---

## The dev loop (no Streamer.bot needed)

```
npm install
npm start        # mock Streamer.bot: HTTP :7474 + WS :8080
```

Open `http://127.0.0.1:7474/` — your theme's panels appear in the index if you add a
`manifest.json` next to them (optional; only the index uses it):

```json
{
  "name": "mytheme",
  "displayName": "My Theme",
  "panels": [
    { "file": "strip.html",          "label": "P1 Strip", "width": 520, "height": 60 },
    { "file": "strip.html?player=2", "label": "P2 Strip", "width": 520, "height": 60 }
  ]
}
```

Drive state while you style: press `q`/`a` (P1 ±), `w`/`s` (P2 ±), `r` (reset), `x`
(swap) in the mock's console, or hit any command over HTTP:

```
http://127.0.0.1:7474/mock/cmd?command=p1name&value=FGC%20%7C%20Vamp%20Fatale
http://127.0.0.1:7474/mock/cmd?command=p1flag&value=japan
```

When it looks right, point the same files at real Streamer.bot — the panels can't tell
the difference; that's the point of the mock.

## OBS notes

- Make the Browser Source exactly the `body` size and leave OBS's own CSS box empty.
- After editing panel JS/CSS, right-click the source → **Refresh cache of current page**
  (CEF caches aggressively).
- Panels must be loaded over `http://` (as in the URLs above), not as local files —
  `file://` sources can't take `?player=`/`?sbport=` query params, and the absolute
  `/tally-shared/panel-core.js` include needs a server anyway.
- Webfonts via `@import`/`<link>` (Google Fonts) work fine; if the machine is offline
  they fall back to system fonts — design so that's acceptable. If your theme re-measures
  text (auto-fit), re-run the fit on `document.fonts.ready` like Primetime does.
- Flag SVGs come from the flag-icons CDN (jsDelivr) — they need network. If you want a
  fully-offline theme, render the flag *emoji* as text instead (Windows shows letter
  pairs; macOS/Linux show real flags) or vendor the handful of SVGs you need.
