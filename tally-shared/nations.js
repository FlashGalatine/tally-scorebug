// nations.js — nation-name/alias → flag-emoji resolver for the lite scoreboard.
//
// One canonical map, used by BOTH the browser control panel (<script src="nations.js">
// → window.Nations) and the Node mock (`import './tally-shared/nations.js'` → globalThis.Nations).
// The Streamer.bot C# action (scoreboard-command.cs) carries a mechanical copy of the
// same entries — verify.mjs diffs the two, so they cannot silently drift.
//
// resolveFlag(input) accepts, in priority order:
//   ''            → ''    (clear the flag)  — also 'none' | 'clear' | 'off' | 'remove'
//   flag/emoji only → as-is (a flag emoji like 🇬🇧, or a specialty flag like 🏴‍☠️)
//   a known name/alias, with or without accents ('uk', 'britain', 'Türkiye', …) → emoji
//   a two-letter code the table maps to ('gb', 'jp') → emoji
//   anything else → null (unknown — callers warn and change nothing). That includes two
//   letters that are no known code ('zz'), accented text that is no nation ('café'), and
//   an emoji mixed with other text.
//
// The name list extends StreamScoreboard's country list (same author/MIT) with more
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
  // Drop accents: decompose, then remove the combining marks ("Türkiye" → "Turkiye").
  // MUST match Fold() in actions/scoreboard-command.cs.
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/\p{Mn}/gu, '');
  }

  // True when every code point belongs to a flag or emoji sequence: regional
  // indicators, the emoji blocks, the variation selector, the joiner, and the tag
  // characters of subdivision flags. MUST match IsEmojiOnly() in the C#.
  function isEmojiOnly(s) {
    if (!s) return false;
    for (var i = 0; i < s.length; i++) {
      var cp = s.codePointAt(i);
      if (cp >= 0xD800 && cp <= 0xDFFF) return false; // a lone surrogate
      if (cp > 0xFFFF) i++;
      var ok = (cp >= 0x1F1E6 && cp <= 0x1F1FF) || (cp >= 0x1F300 && cp <= 0x1FAFF)
        || (cp >= 0x2600 && cp <= 0x27BF) || cp === 0xFE0F || cp === 0x200D
        || (cp >= 0xE0020 && cp <= 0xE007F);
      if (!ok) return false;
    }
    return true;
  }

  var ISO_VALUES = {};
  Object.keys(MAP).forEach(function (k) { ISO_VALUES[MAP[k]] = true; });

  function normalize(s) {
    return fold(s)
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
    if (isEmojiOnly(raw)) return raw; // already a flag / emoji — pass through
    var key = normalize(raw);
    // Own keys only: MAP is a plain object, so "constructor" or "toString" would
    // otherwise find an inherited function and throw in isoToEmoji.
    var iso = Object.prototype.hasOwnProperty.call(MAP, key) ? MAP[key] : null;
    if (iso) return isoToEmoji(iso);
    // A bare two-letter code counts only when the table maps to it, so a typo such as
    // "zz" or "en" is unknown instead of becoming a flag that does not exist.
    if (/^[a-z]{2}$/.test(key) && ISO_VALUES[key] === true) return isoToEmoji(key);
    return null;
  }

  root.Nations = { MAP: MAP, normalize: normalize, fold: fold, isEmojiOnly: isEmojiOnly, isoToEmoji: isoToEmoji, resolveFlag: resolveFlag };
})(typeof window !== 'undefined' ? window : globalThis);
