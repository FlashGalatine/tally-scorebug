// Streamer.bot "Scoreboard Command" action — the whole control surface in one
// parametric action. It mutates the flat scoreboard state (eight global variables)
// then runs "Scoreboard Push" to re-broadcast to every overlay: the score/name/
// flag/title core an operator drives live.
//
// It accepts THREE calling styles, so one action covers chat, Stream Deck, and hotkeys:
//   A) One chat command per action (RECOMMENDED). Create commands !p1+, !p1-, !p2+,
//      !p2-, !reset, !swap, !p1name, !p2name, !p1flag, !p2flag, !p1score, !p2score,
//      !header, !subheader and add each as a TRIGGER on this action. SB passes the
//      matched command in the `command` argument and any trailing text in `rawInput`.
//   B) One dispatch command. Create a single command (e.g. !sb) as the trigger and type
//      "!sb p1+" / "!sb p1flag united kingdom". The token is the first input word.
//   C) Stream Deck / hotkey. Add a *Set Argument* sub-action for `command` (and `value`
//      for the set-* commands) before *Run Action* → this one.
//
// command ∈ p1+ | p1- | p2+ | p2- | p1score | p2score | reset | swap
//          | p1name | p2name | p1flag | p2flag | header | subheader
// value   = the name / number / title / nation text (set-* commands only)
//
// FLAGS: p1flag/p2flag accept a nation in any of these forms — an ISO-3166 alpha-2
// code (gb, jp), a country name or alias (uk, britain, great britain, united kingdom,
// japan…), a flag emoji directly, or none/clear to remove. The value is resolved to a
// flag EMOJI (the format every theme renders) and stored in sb.p1flag / sb.p2flag.
// Unknown nations are rejected with a warning (typo protection). The alias table is a
// mechanical copy of shared/nations.js — verify.mjs diffs the two, keep them in sync.
//
// Requires the companion "Scoreboard Push" action (it does the broadcast). Uses ONLY
// SB's default C# reference set — no Newtonsoft, no System.Uri.

using System;
using System.Text;
using System.Globalization;
using System.Collections.Generic;

public class CPHInline
{
    static readonly string[] KNOWN = {
        "p1+", "p1-", "p2+", "p2-", "p1score", "p2score",
        "reset", "swap", "p1name", "p2name", "p1flag", "p2flag", "header", "subheader",
    };

    public bool Execute()
    {
        // 1) Token: prefer the `command` arg (chat match or Stream Deck), strip a
        //    leading prefix like '!', and take just the first word.
        string cmdArg = (Arg("command", "") ?? "").Trim();
        while (cmdArg.Length > 0 && !char.IsLetterOrDigit(cmdArg[0])) cmdArg = cmdArg.Substring(1);
        int sp = cmdArg.IndexOf(' ');
        string token = (sp >= 0 ? cmdArg.Substring(0, sp) : cmdArg).ToLowerInvariant();

        // 2) Value: explicit `value` arg wins (Stream Deck); else chat `rawInput`; else
        //    any remainder of the command text.
        string cmdRest = sp >= 0 ? cmdArg.Substring(sp + 1).Trim() : "";
        string value = (Arg("value", null) ?? Arg("rawInput", null) ?? cmdRest ?? "").Trim();

        // 3) Dispatch style (B): if the token isn't a known command but the first input
        //    word is, treat input0 as the token and the rest of rawInput as the value.
        if (Array.IndexOf(KNOWN, token) < 0)
        {
            string in0 = (Arg("input0", "") ?? "").Trim().ToLowerInvariant();
            if (Array.IndexOf(KNOWN, in0) >= 0)
            {
                token = in0;
                string ri = (Arg("rawInput", "") ?? "").Trim();
                int s2 = ri.IndexOf(' ');
                value = (s2 >= 0 ? ri.Substring(s2 + 1) : "").Trim();
            }
        }

        CPH.LogInfo("[Scoreboard Command] token='" + token + "' value='" + value + "'");

        switch (token)
        {
            case "p1+": SetScore("sb.p1score", Score("sb.p1score") + 1); break;
            case "p1-": SetScore("sb.p1score", Score("sb.p1score") - 1); break;
            case "p2+": SetScore("sb.p2score", Score("sb.p2score") + 1); break;
            case "p2-": SetScore("sb.p2score", Score("sb.p2score") - 1); break;
            case "p1score": SetScore("sb.p1score", ParseInt(value, 0)); break;
            case "p2score": SetScore("sb.p2score", ParseInt(value, 0)); break;
            case "reset": SetScore("sb.p1score", 0); SetScore("sb.p2score", 0); break;
            case "swap": Swap(); break;
            case "p1name": CPH.SetGlobalVar("sb.p1name", value, true); break;
            case "p2name": CPH.SetGlobalVar("sb.p2name", value, true); break;
            case "p1flag": if (!SetFlag("sb.p1flag", value)) return false; break;
            case "p2flag": if (!SetFlag("sb.p2flag", value)) return false; break;
            case "header": CPH.SetGlobalVar("sb.header", value, true); break;
            case "subheader": CPH.SetGlobalVar("sb.subheader", value, true); break;
            default:
                CPH.LogWarn("[Scoreboard Command] unknown command: '" + token + "' (expected one of p1+/p1-/p2+/p2-/p1score/p2score/reset/swap/p1name/p2name/p1flag/p2flag/header/subheader)");
                return false;
        }

        // Re-scan + re-broadcast to all overlays. Same action the overlay's
        // DoAction-on-connect fires, so live edits and sync share one code path.
        CPH.RunAction("Scoreboard Push");
        return true;
    }

    void Swap()
    {
        string n1 = Var("sb.p1name", "Player 1"), n2 = Var("sb.p2name", "Player 2");
        string f1 = Var("sb.p1flag", ""), f2 = Var("sb.p2flag", "");
        int s1 = Score("sb.p1score"), s2 = Score("sb.p2score");
        CPH.SetGlobalVar("sb.p1name", n2, true);
        CPH.SetGlobalVar("sb.p2name", n1, true);
        CPH.SetGlobalVar("sb.p1flag", f2, true);
        CPH.SetGlobalVar("sb.p2flag", f1, true);
        SetScore("sb.p1score", s2);
        SetScore("sb.p2score", s1);
    }

    bool SetFlag(string key, string value)
    {
        string flag = ResolveFlag(value);
        if (flag == null)
        {
            CPH.LogWarn("[Scoreboard Command] unknown nation: '" + value + "' (use an ISO code like gb/jp, a country name like 'united kingdom', a flag emoji, or 'none' to clear)");
            return false;
        }
        CPH.SetGlobalVar(key, flag, true);
        return true;
    }

    void SetScore(string key, int v) { CPH.SetGlobalVar(key, Clamp(v, 0, 99).ToString(CultureInfo.InvariantCulture), true); }
    int Score(string key) { return ParseInt(Var(key, "0"), 0); }

    string Var(string key, string dflt) { var v = CPH.GetGlobalVar<string>(key, true); return v == null ? dflt : v; }
    string Arg(string key, string dflt) { string a; return CPH.TryGetArg(key, out a) ? a : dflt; }
    static int ParseInt(string s, int dflt) { int n; return int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out n) ? n : dflt; }
    static int Clamp(int v, int lo, int hi) { return Math.Min(hi, Math.Max(lo, v)); }

    // ── Nation → flag-emoji resolution ─────────────────────────────────────────
    // Returns the flag emoji, "" to clear, or null for unknown input.
    static string ResolveFlag(string input)
    {
        string raw = (input ?? "").Trim();
        if (raw.Length == 0) return "";
        string lower = raw.ToLowerInvariant();
        if (lower == "none" || lower == "clear" || lower == "off" || lower == "remove") return "";
        foreach (char c in raw) if (c > 127) return raw; // already an emoji / flag — pass through
        string key = NormalizeNation(raw);
        string iso;
        if (NATIONS.TryGetValue(key, out iso)) return IsoToEmoji(iso);
        if (key.Length == 2 && key[0] >= 'a' && key[0] <= 'z' && key[1] >= 'a' && key[1] <= 'z')
            return IsoToEmoji(key); // bare ISO-3166 alpha-2 code
        return null;
    }

    // MUST match normalize() in shared/nations.js exactly.
    static string NormalizeNation(string s)
    {
        s = (s ?? "").ToLowerInvariant();
        var sb = new StringBuilder(s.Length + 8);
        foreach (char c in s)
        {
            if (c == '\'' || c == '’' || c == '.') continue; // ’ = right single quote
            if (c == '&') { sb.Append(" and "); continue; }
            if (c == '-' || c == '_') { sb.Append(' '); continue; }
            sb.Append(c);
        }
        string outp = sb.ToString();
        while (outp.IndexOf("  ", StringComparison.Ordinal) >= 0) outp = outp.Replace("  ", " ");
        return outp.Trim();
    }

    // ISO-2 → regional-indicator emoji, via manual surrogate pairs (no ConvertFromUtf32
    // dependency surprises in SB's curated reference set).
    static string IsoToEmoji(string iso)
    {
        var sb = new StringBuilder(4);
        foreach (char c in iso)
        {
            int cp = 0x1F1E6 + (c - 'a');
            int v = cp - 0x10000;
            sb.Append((char)(0xD800 + (v >> 10)));
            sb.Append((char)(0xDC00 + (v & 0x3FF)));
        }
        return sb.ToString();
    }

    // Mechanical copy of shared/nations.js MAP — keep the M["name"] = "iso"; format
    // (verify.mjs parses these lines and diffs them against nations.js).
    static readonly Dictionary<string, string> NATIONS = BuildNations();
    static Dictionary<string, string> BuildNations()
    {
        var M = new Dictionary<string, string>();
        // Americas
        M["antigua and barbuda"] = "ag"; M["argentina"] = "ar"; M["aruba"] = "aw"; M["bahamas"] = "bs";
        M["barbados"] = "bb"; M["belize"] = "bz"; M["bermuda"] = "bm"; M["bolivia"] = "bo";
        M["bolivia, plurinational state of"] = "bo"; M["brazil"] = "br"; M["canada"] = "ca";
        M["cayman islands"] = "ky"; M["chile"] = "cl"; M["colombia"] = "co"; M["costa rica"] = "cr";
        M["cuba"] = "cu"; M["curacao"] = "cw"; M["dominica"] = "dm"; M["dominican republic"] = "do";
        M["ecuador"] = "ec"; M["el salvador"] = "sv"; M["greenland"] = "gl"; M["grenada"] = "gd";
        M["guadeloupe"] = "gp"; M["guatemala"] = "gt"; M["guyana"] = "gy"; M["haiti"] = "ht";
        M["honduras"] = "hn"; M["jamaica"] = "jm"; M["martinique"] = "mq"; M["mexico"] = "mx";
        M["nicaragua"] = "ni"; M["panama"] = "pa"; M["paraguay"] = "py"; M["peru"] = "pe";
        M["puerto rico"] = "pr"; M["saint kitts and nevis"] = "kn"; M["st kitts and nevis"] = "kn";
        M["saint lucia"] = "lc"; M["st lucia"] = "lc"; M["saint vincent and the grenadines"] = "vc";
        M["st vincent"] = "vc"; M["suriname"] = "sr"; M["trinidad and tobago"] = "tt";
        M["united states"] = "us"; M["united states of america"] = "us"; M["usa"] = "us"; M["america"] = "us";
        M["uruguay"] = "uy"; M["us virgin islands"] = "vi"; M["venezuela"] = "ve";
        M["venezuela, bolivarian republic of"] = "ve";
        // Europe
        M["albania"] = "al"; M["andorra"] = "ad"; M["armenia"] = "am"; M["austria"] = "at";
        M["azerbaijan"] = "az"; M["belarus"] = "by"; M["belgium"] = "be"; M["bosnia and herzegovina"] = "ba";
        M["bosnia"] = "ba"; M["bulgaria"] = "bg"; M["croatia"] = "hr"; M["cyprus"] = "cy";
        M["czechia"] = "cz"; M["czech republic"] = "cz"; M["denmark"] = "dk"; M["estonia"] = "ee";
        M["faroe islands"] = "fo"; M["finland"] = "fi"; M["france"] = "fr"; M["georgia"] = "ge";
        M["germany"] = "de"; M["gibraltar"] = "gi"; M["greece"] = "gr"; M["hungary"] = "hu";
        M["iceland"] = "is"; M["ireland"] = "ie"; M["italy"] = "it"; M["kosovo"] = "xk";
        M["latvia"] = "lv"; M["liechtenstein"] = "li"; M["lithuania"] = "lt"; M["luxembourg"] = "lu";
        M["malta"] = "mt"; M["moldova"] = "md"; M["monaco"] = "mc"; M["montenegro"] = "me";
        M["netherlands"] = "nl"; M["the netherlands"] = "nl"; M["holland"] = "nl";
        M["north macedonia"] = "mk"; M["macedonia"] = "mk"; M["norway"] = "no"; M["poland"] = "pl";
        M["portugal"] = "pt"; M["romania"] = "ro"; M["russia"] = "ru"; M["russian federation"] = "ru";
        M["san marino"] = "sm"; M["serbia"] = "rs"; M["slovakia"] = "sk"; M["slovenia"] = "si";
        M["spain"] = "es"; M["sweden"] = "se"; M["switzerland"] = "ch"; M["ukraine"] = "ua";
        M["united kingdom"] = "gb"; M["united kingdom of great britain and northern ireland"] = "gb";
        M["great britain"] = "gb"; M["britain"] = "gb"; M["uk"] = "gb";
        M["england"] = "gb"; M["scotland"] = "gb"; M["wales"] = "gb";
        M["vatican"] = "va"; M["vatican city"] = "va";
        // Asia
        M["afghanistan"] = "af"; M["bahrain"] = "bh"; M["bangladesh"] = "bd"; M["bhutan"] = "bt";
        M["brunei"] = "bn"; M["cambodia"] = "kh"; M["china"] = "cn"; M["hong kong"] = "hk";
        M["hong kong sar"] = "hk"; M["india"] = "in"; M["indonesia"] = "id"; M["iran"] = "ir";
        M["iran, islamic republic of"] = "ir"; M["iraq"] = "iq"; M["israel"] = "il"; M["japan"] = "jp";
        M["jordan"] = "jo"; M["kazakhstan"] = "kz"; M["kuwait"] = "kw"; M["kyrgyzstan"] = "kg";
        M["laos"] = "la"; M["lebanon"] = "lb"; M["macau"] = "mo"; M["macao"] = "mo"; M["macao sar"] = "mo";
        M["malaysia"] = "my"; M["maldives"] = "mv"; M["mongolia"] = "mn"; M["myanmar"] = "mm";
        M["burma"] = "mm"; M["nepal"] = "np"; M["north korea"] = "kp"; M["dprk"] = "kp";
        M["oman"] = "om"; M["pakistan"] = "pk"; M["palestine"] = "ps"; M["philippines"] = "ph";
        M["qatar"] = "qa"; M["saudi arabia"] = "sa"; M["singapore"] = "sg"; M["south korea"] = "kr";
        M["korea"] = "kr"; M["korea, republic of"] = "kr"; M["republic of korea"] = "kr";
        M["sri lanka"] = "lk"; M["syria"] = "sy"; M["syrian arab republic"] = "sy";
        M["taiwan"] = "tw"; M["taiwan, province of china"] = "tw"; M["chinese taipei"] = "tw";
        M["tajikistan"] = "tj"; M["thailand"] = "th"; M["timor leste"] = "tl"; M["east timor"] = "tl";
        M["turkey"] = "tr"; M["turkiye"] = "tr"; M["turkmenistan"] = "tm"; M["uae"] = "ae";
        M["united arab emirates"] = "ae"; M["uzbekistan"] = "uz"; M["vietnam"] = "vn"; M["viet nam"] = "vn";
        M["yemen"] = "ye";
        // Oceania
        M["american samoa"] = "as"; M["australia"] = "au"; M["fiji"] = "fj"; M["french polynesia"] = "pf";
        M["guam"] = "gu"; M["kiribati"] = "ki"; M["marshall islands"] = "mh"; M["micronesia"] = "fm";
        M["nauru"] = "nr"; M["new caledonia"] = "nc"; M["new zealand"] = "nz"; M["palau"] = "pw";
        M["papua new guinea"] = "pg"; M["samoa"] = "ws"; M["solomon islands"] = "sb"; M["tonga"] = "to";
        M["tuvalu"] = "tv"; M["vanuatu"] = "vu";
        // Africa
        M["algeria"] = "dz"; M["angola"] = "ao"; M["benin"] = "bj"; M["botswana"] = "bw";
        M["burkina faso"] = "bf"; M["burundi"] = "bi"; M["cameroon"] = "cm"; M["cape verde"] = "cv";
        M["cabo verde"] = "cv"; M["central african republic"] = "cf"; M["chad"] = "td";
        M["comoros"] = "km"; M["congo"] = "cg"; M["dr congo"] = "cd"; M["drc"] = "cd";
        M["democratic republic of the congo"] = "cd"; M["djibouti"] = "dj"; M["egypt"] = "eg";
        M["equatorial guinea"] = "gq"; M["eritrea"] = "er"; M["eswatini"] = "sz"; M["swaziland"] = "sz";
        M["ethiopia"] = "et"; M["gabon"] = "ga"; M["gambia"] = "gm"; M["ghana"] = "gh";
        M["guinea"] = "gn"; M["guinea bissau"] = "gw"; M["ivory coast"] = "ci"; M["cote divoire"] = "ci";
        M["kenya"] = "ke"; M["lesotho"] = "ls"; M["liberia"] = "lr"; M["libya"] = "ly";
        M["madagascar"] = "mg"; M["malawi"] = "mw"; M["mali"] = "ml"; M["mauritania"] = "mr";
        M["mauritius"] = "mu"; M["morocco"] = "ma"; M["mozambique"] = "mz"; M["namibia"] = "na";
        M["niger"] = "ne"; M["nigeria"] = "ng"; M["reunion"] = "re"; M["rwanda"] = "rw";
        M["sao tome and principe"] = "st"; M["sao tome"] = "st"; M["senegal"] = "sn";
        M["seychelles"] = "sc"; M["sierra leone"] = "sl"; M["somalia"] = "so"; M["south africa"] = "za";
        M["south sudan"] = "ss"; M["sudan"] = "sd"; M["tanzania"] = "tz"; M["togo"] = "tg";
        M["tunisia"] = "tn"; M["uganda"] = "ug"; M["zambia"] = "zm"; M["zimbabwe"] = "zw";
        return M;
    }
}
