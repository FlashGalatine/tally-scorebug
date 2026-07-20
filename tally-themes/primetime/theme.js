// Primetime theme — overlay logic.
//
// ESPN-style broadcast plates. Combined player strips (score | flag | name)
// plus a trapezoid title. Auto-fit typography (the name row wraps onto a
// second line rather than shrinking below readable size), a score bump on
// change, full-bleed SVG flags (flag-icons via jsDelivr) resolved from the
// emoji value, and a quick fade/slide name swap when the server flags
// `animate: true` (roster import).
//
// The panel HTML sets window.__SLOT and window.__FIELD; we listen for the
// scoreboard:sync / scoreboard:update CustomEvents dispatched by panel-core.

(function () {
  'use strict';

  const slot = window.__SLOT || null;
  const field = window.__FIELD || null;

  const FLAG_CDN = 'https://cdn.jsdelivr.net/gh/lipis/flag-icons@7.2.3/flags/4x3/';

  // Name row: shrink a single line down to WRAP_AT; if it still doesn't fit,
  // wrap to two lines at WRAP_SIZE and shrink from there as a last resort.
  const NAME_MIN = 11;
  const WRAP_AT = 17;
  const WRAP_SIZE = 18;

  let lastNameKey = null;
  let lastScore = null;
  let lastFlagSrc = null;
  let lastHeader = null;
  let lastSub = null;
  let lastNoSub = null;
  let lastState = null;
  let swapTimer = null;

  window.addEventListener('scoreboard:sync', (e) => apply(e.detail));
  window.addEventListener('scoreboard:update', (e) => apply(e.detail));

  // Quantico loads async — text measured against the fallback font is wrong,
  // so replay the last state once the webfont is in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!lastState) return;
      lastNameKey = null;
      lastScore = null; // null = treated as first render, so no bump replays
      lastHeader = null;
      lastSub = null;
      apply(lastState);
    });
  }

  function apply(state) {
    if (!state || !slot || !field) return;
    lastState = state;
    // Angle variant: A (inward, default) / B (outward) — the operator flips it
    // with the match-level "Outward angle (B)" add-in checkbox. theme.css swaps
    // the cell/title clip polygons when body has .angle-b.
    document.body.classList.toggle('angle-b', state.fieldsEnabled?.['match.angle'] === true);
    if (slot === 'match' && field === 'title') {
      renderTitle(state);
    } else if (field === 'strip') {
      renderStrip(state);
    }
  }

  // ── Title ──────────────────────────────────────────────────────────
  function renderTitle(state) {
    const headerEl = document.getElementById('header');
    const subEl = document.getElementById('subheader');
    if (!headerEl || !subEl) return;

    const header = String(state.header ?? '');
    const sub = String(state.subheader ?? '');
    const noSub = sub.trim() === '';

    let refitHeader = false;
    if (lastNoSub !== noSub) {
      // Layout mode flipped — the header's CSS font ceiling changes, so the
      // cached auto-fit max is stale.
      document.body.classList.toggle('no-sub', noSub);
      delete headerEl.dataset.autofitMax;
      refitHeader = true;
      lastNoSub = noSub;
    }
    if (header !== lastHeader || refitHeader) {
      headerEl.textContent = header;
      autoFit(headerEl, 24, 11);
      lastHeader = header;
    }
    if (sub !== lastSub) {
      subEl.textContent = sub;
      autoFit(subEl, 11, 8);
      lastSub = sub;
    }
  }

  // ── Player strip ───────────────────────────────────────────────────
  function renderStrip(state) {
    const p = state[slot];
    // player3/player4 are absent from the payload when teams mode doesn't reach
    // them — hide the whole strip (and un-hide when teams is raised again).
    const root = document.querySelector('.pt-root');
    if (root) root.classList.toggle('hidden', !p);
    if (!p) return;
    renderScore(p);
    renderFlag(state, p);
    renderNameRow(state, p);
  }

  function renderScore(p) {
    const el = document.getElementById('score');
    if (!el) return;
    const n = Number(p.score ?? 0);
    if (lastScore === n) return;
    el.textContent = String(n);
    autoFit(el, 28, 14);
    if (lastScore !== null) {
      el.classList.remove('bump');
      void el.offsetWidth; // restart the animation
      el.classList.add('bump');
    }
    lastScore = n;
  }

  function svgUri(svg) {
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // Specialty flags from the picker's "Special" group — no ISO code exists,
  // so they ship as inline SVGs. Keys are the emoji sequence with the U+FE0F
  // variation selectors stripped (see flagSrc); built from codepoints so the
  // source stays ASCII-clean.
  const ZWJ = String.fromCodePoint(0x200D);
  const SPECIALTY_FLAGS = {
    // chequered flag
    [String.fromCodePoint(0x1F3C1)]: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 60"><rect width="150" height="60" fill="#F4F4F4"/><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#141414"/><rect x="10" y="10" width="10" height="10" fill="#141414"/></pattern><rect width="150" height="60" fill="url(#c)"/></svg>'),
    // pirate flag (black flag + skull and crossbones)
    [String.fromCodePoint(0x1F3F4) + ZWJ + String.fromCodePoint(0x2620)]: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 60"><rect width="150" height="60" fill="#101010"/><g fill="#E8E8E8"><rect x="49" y="34" width="52" height="6" rx="3" transform="rotate(22 75 37)"/><rect x="49" y="34" width="52" height="6" rx="3" transform="rotate(-22 75 37)"/><ellipse cx="75" cy="23" rx="12.5" ry="11.5"/><rect x="68.5" y="31" width="13" height="7.5" rx="2.5"/></g><g fill="#101010"><circle cx="70" cy="22" r="3.1"/><circle cx="80" cy="22" r="3.1"/><path d="M75 31.5 L77.3 27 H72.7 Z"/><rect x="71.2" y="33.8" width="1.7" height="4.7"/><rect x="74.15" y="33.8" width="1.7" height="4.7"/><rect x="77.1" y="33.8" width="1.7" height="4.7"/></g></svg>'),
    // rainbow flag (white flag + rainbow)
    [String.fromCodePoint(0x1F3F3) + ZWJ + String.fromCodePoint(0x1F308)]: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 60"><rect width="150" height="10" fill="#E40303"/><rect y="10" width="150" height="10" fill="#FF8C00"/><rect y="20" width="150" height="10" fill="#FFED00"/><rect y="30" width="150" height="10" fill="#008026"/><rect y="40" width="150" height="10" fill="#24408E"/><rect y="50" width="150" height="10" fill="#732982"/></svg>'),
    // transgender flag (white flag + transgender symbol)
    [String.fromCodePoint(0x1F3F3) + ZWJ + String.fromCodePoint(0x26A7)]: svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 60"><rect width="150" height="12" fill="#5BCEFA"/><rect y="12" width="150" height="12" fill="#F5A9B8"/><rect y="24" width="150" height="12" fill="#FFFFFF"/><rect y="36" width="150" height="12" fill="#F5A9B8"/><rect y="48" width="150" height="12" fill="#5BCEFA"/></svg>')
  };

  // Flag value → image src. Handles raw ISO-3166 alpha-2 codes and regional-
  // indicator emoji pairs (both → flag-icons CDN), plus the specialty flags
  // above. Null when the value is none of those.
  function flagSrc(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    if (/^[A-Za-z]{2}$/.test(s)) return FLAG_CDN + s.toLowerCase() + '.svg';
    const special = SPECIALTY_FLAGS[s.split(String.fromCodePoint(0xFE0F)).join('')];
    if (special) return special;
    const cps = Array.from(s).map((c) => c.codePointAt(0));
    if (cps.length === 2 && cps.every((cp) => cp >= 0x1F1E6 && cp <= 0x1F1FF)) {
      return FLAG_CDN + String.fromCharCode(cps[0] - 0x1F1E6 + 97, cps[1] - 0x1F1E6 + 97) + '.svg';
    }
    return null;
  }

  function renderFlag(state, p) {
    const cell = document.getElementById('flag-cell');
    const img = document.getElementById('flag');
    if (!cell || !img) return;
    const enabled = state.fieldsEnabled?.['player.flag'] === true;
    const src = enabled ? flagSrc(p.fields?.flag) : null;
    if (src === lastFlagSrc) return;
    lastFlagSrc = src;
    if (src) {
      img.src = src;
      cell.classList.remove('hidden');
    } else {
      img.removeAttribute('src');
      cell.classList.add('hidden');
    }
    // The name cell just changed width — re-fit its text to the new space.
    if (lastNameKey !== null) {
      const row = document.getElementById('name-row');
      if (row) fitNameRow(row);
    }
  }

  function renderNameRow(state, p) {
    const row = document.getElementById('name-row');
    const sponsorEl = document.getElementById('sponsor');
    const nameEl = document.getElementById('pname');
    const proEl = document.getElementById('pronouns');
    if (!row || !sponsorEl || !nameEl || !proEl) return;

    const raw = String(p.name ?? '');
    let sponsor = '';
    let name = raw;
    if (raw.includes('|')) {
      const parts = raw.split('|');
      sponsor = parts[0].trim();
      name = parts.slice(1).join('|').trim();
    }
    const proOn = state.fieldsEnabled?.['player.pronouns'] === true;
    const pronouns = proOn ? String(p.fields?.pronouns ?? '').trim() : '';

    const key = sponsor + '' + name + '' + pronouns;
    if (key === lastNameKey) return;
    const isFirst = lastNameKey === null;
    lastNameKey = key;

    const write = () => {
      sponsorEl.textContent = sponsor;
      sponsorEl.classList.toggle('hidden', sponsor === '');
      nameEl.textContent = name;
      proEl.textContent = pronouns;
      proEl.classList.toggle('hidden', pronouns === '');
      fitNameRow(row);
    };

    if (state.animate === true && !isFirst) {
      if (swapTimer) clearTimeout(swapTimer);
      row.classList.remove('swap-in');
      row.classList.add('swap-out');
      swapTimer = setTimeout(() => {
        write();
        row.classList.remove('swap-out');
        row.classList.add('swap-in');
        swapTimer = setTimeout(() => row.classList.remove('swap-in'), 280);
      }, 190);
    } else {
      write();
    }
  }

  // ── Measurement helpers ────────────────────────────────────────────
  // scrollWidth misses overflow on centered flex content and silently eats
  // the right padding (our slant safe-area), so measure the real content
  // extent with a Range and compare against the content box.

  function contentBox(el) {
    const s = getComputedStyle(el);
    return {
      width: el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight),
      height: el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)
    };
  }

  function contentRect(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  // Single-line shrink-to-fit. Captures the CSS-declared font size as the
  // ceiling on first use (see docs/THEMING.md "Auto-fit type").
  function autoFit(el, defaultMaxPx, minPx) {
    if (el.dataset.autofitMax === undefined) {
      el.style.fontSize = '';
      const css = parseFloat(getComputedStyle(el).fontSize);
      const max = Number.isFinite(css) && css > 0 ? css : defaultMaxPx;
      el.dataset.autofitMax = String(max);
    }
    let size = Number(el.dataset.autofitMax);
    el.style.fontSize = size + 'px';
    requestAnimationFrame(() => {
      while (size > minPx && contentRect(el).width > contentBox(el).width + 0.5) {
        size--;
        el.style.fontSize = size + 'px';
      }
    });
  }

  // Name row: single line shrinking to WRAP_AT, then bleed onto a second
  // line at WRAP_SIZE and shrink only if the wrapped block overflows.
  function fitNameRow(row) {
    const value = row.parentElement; // .pt-value
    if (!value) return;
    requestAnimationFrame(() => {
      value.classList.remove('two-line');
      let size = Number(row.dataset.fitMax || 24);
      row.style.fontSize = size + 'px';
      while (size > WRAP_AT && contentRect(row).width > contentBox(value).width + 0.5) {
        size--;
        row.style.fontSize = size + 'px';
      }
      if (contentRect(row).width <= contentBox(value).width + 0.5) return;

      value.classList.add('two-line');
      size = WRAP_SIZE;
      row.style.fontSize = size + 'px';
      const overflows = () => {
        const box = contentBox(value);
        const rect = row.getBoundingClientRect();
        return rect.height > box.height + 0.5 || contentRect(row).width > box.width + 0.5;
      };
      while (size > NAME_MIN && overflows()) {
        size--;
        row.style.fontSize = size + 'px';
      }
    });
  }
})();
