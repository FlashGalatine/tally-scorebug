// Streamer.bot "Scoreboard Push" action — broadcasts the current scoreboard state
// to every connected overlay panel. It reads flat state from SB global variables and
// emits the exact `scoreboard:update` shape the themes consume (see docs/THEMING.md
// for the wire format).
//
// HOW TO USE (see README.md for the full walkthrough):
//   1. Streamer.bot -> Actions -> add an action named EXACTLY "Scoreboard Push"
//      (the name matters: panel-core.js does DoAction { name: "Scoreboard Push" }
//      on connect to recreate the server's sync-on-connect replay).
//   2. Add a sub-action: Core -> C# -> Execute C# Code. Paste EVERYTHING below and
//      click COMPILE — it must report success. A compile error means the action runs
//      but broadcasts nothing, which shows up as a blank/stale overlay.
//
// State lives in persisted global variables (all set by "Scoreboard Command"):
//   sb.pNname (string), sb.pNscore (int as string, 0-99), sb.pNflag (flag emoji,
//   "" = none) for N = 1-4; sb.header, sb.subheader (string); and sb.teams (2-4,
//   default 2). player3/player4 appear in the payload only when sb.teams >= 3/4 —
//   two-team setups broadcast the exact same shape as before the teams feature.
//
// NOTE: uses ONLY types in Streamer.bot's default C# reference set — JSON is
// hand-written (no Newtonsoft) and there is no System.Uri. Verified pattern from the
// Ken Burns port on Streamer.bot 1.0.4. Any exception is logged AND broadcast as
// { type:"scoreboard:error", message } so failures are visible, not silent.

using System;
using System.Text;
using System.Globalization;

public class CPHInline
{
    public bool Execute()
    {
        try
        {
            int teams = Clamp(IntVar("sb.teams", 2), 2, 4);
            string header = Var("sb.header", "");
            string subheader = Var("sb.subheader", "");

            var names = new string[teams];
            var scores = new int[teams];
            var flags = new string[teams];
            bool anyFlag = false;
            for (int i = 0; i < teams; i++)
            {
                string n = (i + 1).ToString(CultureInfo.InvariantCulture);
                names[i] = Var("sb.p" + n + "name", "Player " + n);
                scores[i] = Clamp(IntVar("sb.p" + n + "score", 0), 0, 99);
                flags[i] = Var("sb.p" + n + "flag", "");
                if (flags[i].Length > 0) anyFlag = true;
            }

            // Build the exact `scoreboard:update` payload the themes consume. The lite
            // build carries ONE add-in field — the flag (emoji) — surfaced exactly like
            // the full app does it: per-player `fields.flag` plus a shared
            // `fieldsEnabled["player.flag"]` toggle (on when any player has one).
            // Other add-ins (pronouns/logo/color) stay absent, so those panels render
            // nothing; the core name/score/title panels are unaffected. `teams` plus
            // playerN keys past player2 appear only when sb.teams > 2, so two-team
            // consumers see the original shape untouched.
            var sb = new StringBuilder();
            sb.Append("{\"type\":\"scoreboard:update\",");
            if (teams > 2) sb.Append("\"teams\":").Append(teams.ToString(CultureInfo.InvariantCulture)).Append(',');
            for (int i = 0; i < teams; i++)
            {
                sb.Append("\"player").Append((i + 1).ToString(CultureInfo.InvariantCulture))
                  .Append("\":{\"name\":").Append(JsonStr(names[i]))
                  .Append(",\"score\":").Append(scores[i].ToString(CultureInfo.InvariantCulture))
                  .Append(",\"fields\":").Append(FieldsJson(flags[i])).Append("},");
            }
            sb.Append("\"header\":").Append(JsonStr(header)).Append(',');
            sb.Append("\"subheader\":").Append(JsonStr(subheader)).Append(',');
            sb.Append("\"fields\":{},\"fieldsEnabled\":");
            sb.Append(anyFlag ? "{\"player.flag\":true}" : "{}");
            sb.Append('}');

            string json = sb.ToString();
            CPH.LogInfo("[Scoreboard Push] " + names[0] + " " + scores[0] + " - " + scores[1] + " " + names[1]
                + (teams > 2 ? " (+" + (teams - 2) + " more)" : "") + " (" + json.Length + " bytes)");
            CPH.WebsocketBroadcastJson(json);
            return true;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[Scoreboard Push] ERROR: " + ex);
            CPH.WebsocketBroadcastJson("{\"type\":\"scoreboard:error\",\"message\":" + JsonStr(ex.Message) + "}");
            return false;
        }
    }

    // Per-player fields bag: just the flag, omitted entirely when unset.
    static string FieldsJson(string flag)
    {
        return string.IsNullOrEmpty(flag) ? "{}" : "{\"flag\":" + JsonStr(flag) + "}";
    }

    // Minimal, correct JSON string encoder (escapes quotes, backslashes, controls).
    static string JsonStr(string s)
    {
        if (s == null) return "\"\"";
        var sb = new StringBuilder(s.Length + 2);
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\b': sb.Append("\\b"); break;
                case '\f': sb.Append("\\f"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.Append("\\u").Append(((int)c).ToString("x4"));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    // Global-var readers. GetGlobalVar returns null when unset → fall back to default,
    // but preserve an explicitly-set empty string (header/subheader may be "").
    string Var(string key, string dflt)
    {
        var v = CPH.GetGlobalVar<string>(key, true);
        return v == null ? dflt : v;
    }
    int IntVar(string key, int dflt)
    {
        int n;
        return int.TryParse(CPH.GetGlobalVar<string>(key, true), NumberStyles.Integer, CultureInfo.InvariantCulture, out n) ? n : dflt;
    }
    static int Clamp(int v, int lo, int hi) { return Math.Min(hi, Math.Max(lo, v)); }
}
