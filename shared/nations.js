// nations.js — nation-name/alias → flag-emoji resolver for the lite scoreboard.
//
// One canonical map, used by BOTH the browser control panel (<script src="nations.js">
// → window.Nations) and the Node mock (`import './shared/nations.js'` → globalThis.Nations).
// The Streamer.bot C# action (scoreboard-command.cs) carries a mechanical copy of the
// same entries — verify.mjs diffs the two, so they cannot silently drift.
//
// resolveFlag(input) accepts, in priority order:
//   ''            → ''    (clear the flag)  — also 'none' | 'clear' | 'off' | 'remove'
//   any non-ASCII → as-is (already a flag emoji like 🇬🇧, or a specialty flag like 🏴‍☠️)
//   a known name/alias ('uk', 'britain', 'great britain', 'united kingdom', …) → emoji
//   a bare ISO-3166 alpha-2 code ('gb', 'jp') → emoji
//   anything else → null (unknown — callers warn and change nothing)
//
// The name list extends StreamScoreboard's country-codes.js (same author/MIT) with more
// countries, territories, and colloquial aliases. Keys are stored PRE-NORMALIZED:
// lowercase, no apostrophes/periods, '&'→'and', '-'/'_'→' ', single spaces.

(function (root) {
  'use strict';

  var MAP = {
    // ── Americas ──────────────────────────────────────────────────────────────
    'antigua and barbuda': 'ag', 'argentina': 'ar', 'aruba': 'aw', 'bahamas': 'bs',
    'barbados': 'bb', 'belize': 'bz', 'bermuda': 'bm', 'bolivia': 'bo',
    'bolivia, plurinational state of': 'bo', 'brazil': 'br', 'canada': 'ca',
    'cayman islands': 'ky', 'chile': 'cl', 'colombia': 'co', 'costa rica': 'cr',
    'cuba': 'cu', 'curacao': 'cw', 'dominica': 'dm', 'dominican republic': 'do',
    'ecuador': 'ec', 'el salvador': 'sv', 'greenland': 'gl', 'grenada': 'gd',
    'guadeloupe': 'gp', 'guatemala': 'gt', 'guyana': 'gy', 'haiti': 'ht',
    'honduras': 'hn', 'jamaica': 'jm', 'martinique': 'mq', 'mexico': 'mx',
    'nicaragua': 'ni', 'panama': 'pa', 'paraguay': 'py', 'peru': 'pe',
    'puerto rico': 'pr', 'saint kitts and nevis': 'kn', 'st kitts and nevis': 'kn',
    'saint lucia': 'lc', 'st lucia': 'lc', 'saint vincent and the grenadines': 'vc',
    'st vincent': 'vc', 'suriname': 'sr', 'trinidad and tobago': 'tt',
    'united states': 'us', 'united states of america': 'us', 'usa': 'us', 'america': 'us',
    'uruguay': 'uy', 'us virgin islands': 'vi', 'venezuela': 've',
    'venezuela, bolivarian republic of': 've',
    // ── Europe ────────────────────────────────────────────────────────────────
    'albania': 'al', 'andorra': 'ad', 'armenia': 'am', 'austria': 'at',
    'azerbaijan': 'az', 'belarus': 'by', 'belgium': 'be', 'bosnia and herzegovina': 'ba',
    'bosnia': 'ba', 'bulgaria': 'bg', 'croatia': 'hr', 'cyprus': 'cy',
    'czechia': 'cz', 'czech republic': 'cz', 'denmark': 'dk', 'estonia': 'ee',
    'faroe islands': 'fo', 'finland': 'fi', 'france': 'fr', 'georgia': 'ge',
    'germany': 'de', 'gibraltar': 'gi', 'greece': 'gr', 'hungary': 'hu',
    'iceland': 'is', 'ireland': 'ie', 'italy': 'it', 'kosovo': 'xk',
    'latvia': 'lv', 'liechtenstein': 'li', 'lithuania': 'lt', 'luxembourg': 'lu',
    'malta': 'mt', 'moldova': 'md', 'monaco': 'mc', 'montenegro': 'me',
    'netherlands': 'nl', 'the netherlands': 'nl', 'holland': 'nl',
    'north macedonia': 'mk', 'macedonia': 'mk', 'norway': 'no', 'poland': 'pl',
    'portugal': 'pt', 'romania': 'ro', 'russia': 'ru', 'russian federation': 'ru',
    'san marino': 'sm', 'serbia': 'rs', 'slovakia': 'sk', 'slovenia': 'si',
    'spain': 'es', 'sweden': 'se', 'switzerland': 'ch', 'ukraine': 'ua',
    'united kingdom': 'gb', 'united kingdom of great britain and northern ireland': 'gb',
    'great britain': 'gb', 'britain': 'gb', 'uk': 'gb',
    'england': 'gb', 'scotland': 'gb', 'wales': 'gb',
    'vatican': 'va', 'vatican city': 'va',
    // ── Asia ──────────────────────────────────────────────────────────────────
    'afghanistan': 'af', 'bahrain': 'bh', 'bangladesh': 'bd', 'bhutan': 'bt',
    'brunei': 'bn', 'cambodia': 'kh', 'china': 'cn', 'hong kong': 'hk',
    'hong kong sar': 'hk', 'india': 'in', 'indonesia': 'id', 'iran': 'ir',
    'iran, islamic republic of': 'ir', 'iraq': 'iq', 'israel': 'il', 'japan': 'jp',
    'jordan': 'jo', 'kazakhstan': 'kz', 'kuwait': 'kw', 'kyrgyzstan': 'kg',
    'laos': 'la', 'lebanon': 'lb', 'macau': 'mo', 'macao': 'mo', 'macao sar': 'mo',
    'malaysia': 'my', 'maldives': 'mv', 'mongolia': 'mn', 'myanmar': 'mm',
    'burma': 'mm', 'nepal': 'np', 'north korea': 'kp', 'dprk': 'kp',
    'oman': 'om', 'pakistan': 'pk', 'palestine': 'ps', 'philippines': 'ph',
    'qatar': 'qa', 'saudi arabia': 'sa', 'singapore': 'sg', 'south korea': 'kr',
    'korea': 'kr', 'korea, republic of': 'kr', 'republic of korea': 'kr',
    'sri lanka': 'lk', 'syria': 'sy', 'syrian arab republic': 'sy',
    'taiwan': 'tw', 'taiwan, province of china': 'tw', 'chinese taipei': 'tw',
    'tajikistan': 'tj', 'thailand': 'th', 'timor leste': 'tl', 'east timor': 'tl',
    'turkey': 'tr', 'turkiye': 'tr', 'turkmenistan': 'tm', 'uae': 'ae',
    'united arab emirates': 'ae', 'uzbekistan': 'uz', 'vietnam': 'vn', 'viet nam': 'vn',
    'yemen': 'ye',
    // ── Oceania ───────────────────────────────────────────────────────────────
    'american samoa': 'as', 'australia': 'au', 'fiji': 'fj', 'french polynesia': 'pf',
    'guam': 'gu', 'kiribati': 'ki', 'marshall islands': 'mh', 'micronesia': 'fm',
    'nauru': 'nr', 'new caledonia': 'nc', 'new zealand': 'nz', 'palau': 'pw',
    'papua new guinea': 'pg', 'samoa': 'ws', 'solomon islands': 'sb', 'tonga': 'to',
    'tuvalu': 'tv', 'vanuatu': 'vu',
    // ── Africa ────────────────────────────────────────────────────────────────
    'algeria': 'dz', 'angola': 'ao', 'benin': 'bj', 'botswana': 'bw',
    'burkina faso': 'bf', 'burundi': 'bi', 'cameroon': 'cm', 'cape verde': 'cv',
    'cabo verde': 'cv', 'central african republic': 'cf', 'chad': 'td',
    'comoros': 'km', 'congo': 'cg', 'dr congo': 'cd', 'drc': 'cd',
    'democratic republic of the congo': 'cd', 'djibouti': 'dj', 'egypt': 'eg',
    'equatorial guinea': 'gq', 'eritrea': 'er', 'eswatini': 'sz', 'swaziland': 'sz',
    'ethiopia': 'et', 'gabon': 'ga', 'gambia': 'gm', 'ghana': 'gh',
    'guinea': 'gn', 'guinea bissau': 'gw', 'ivory coast': 'ci', 'cote divoire': 'ci',
    'kenya': 'ke', 'lesotho': 'ls', 'liberia': 'lr', 'libya': 'ly',
    'madagascar': 'mg', 'malawi': 'mw', 'mali': 'ml', 'mauritania': 'mr',
    'mauritius': 'mu', 'morocco': 'ma', 'mozambique': 'mz', 'namibia': 'na',
    'niger': 'ne', 'nigeria': 'ng', 'reunion': 're', 'rwanda': 'rw',
    'sao tome and principe': 'st', 'sao tome': 'st', 'senegal': 'sn',
    'seychelles': 'sc', 'sierra leone': 'sl', 'somalia': 'so', 'south africa': 'za',
    'south sudan': 'ss', 'sudan': 'sd', 'tanzania': 'tz', 'togo': 'tg',
    'tunisia': 'tn', 'uganda': 'ug', 'zambia': 'zm', 'zimbabwe': 'zw',
  };

  // MUST match NormalizeNation() in scoreboard-command.cs exactly.
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/['’.]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isoToEmoji(iso) {
    var out = '';
    for (var i = 0; i < iso.length; i++) out += String.fromCodePoint(0x1f1e6 + iso.charCodeAt(i) - 97);
    return out;
  }

  // → emoji string, '' (clear), or null (unknown).
  function resolveFlag(input) {
    var raw = String(input == null ? '' : input).trim();
    if (!raw) return '';
    var lower = raw.toLowerCase();
    if (lower === 'none' || lower === 'clear' || lower === 'off' || lower === 'remove') return '';
    for (var i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 127) return raw; // emoji passthrough
    var key = normalize(raw);
    var iso = MAP[key];
    if (iso) return isoToEmoji(iso);
    if (/^[a-z]{2}$/.test(key)) return isoToEmoji(key); // bare ISO code
    return null;
  }

  root.Nations = { MAP: MAP, normalize: normalize, isoToEmoji: isoToEmoji, resolveFlag: resolveFlag };
})(typeof window !== 'undefined' ? window : globalThis);
