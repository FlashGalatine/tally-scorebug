// Runs one Tally action (compiled in beside this file as class CPHInline) through a
// script of calls and writes what happened. Used only by verify-cs.test.mjs.
//
//   Harness.exe <script.txt> <out.txt>      both UTF-8
//
// Script lines:
//   #reset                 forget every global, warning and broadcast
//   #global <key>=<value>  set a global directly
//   #pushfails=1|0         make RunAction return false | true
//   #throw=<key>           make writing that global throw (empty = off)
//   <k>=<v><TAB><k>=<v>…   one Execute() with those arguments. A key ending in ":int"
//                          is passed as an integer, as a number argument would be.
// Output, one line per Execute(), TAB separated:
//   ret=<true|false>  warn=<new warnings>  ran=<actions run, comma separated>
//   bc=<broadcast JSON, joined by U+001E>  then every global as <key>=<value>, sorted.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

public static class Harness
{
    public static int Main(string[] argv)
    {
        var utf8 = new UTF8Encoding(false);
        string[] lines = File.ReadAllLines(argv[0], utf8);
        var outp = new StringBuilder();
        var cph = new CphStub();

        foreach (string raw in lines)
        {
            string line = raw.TrimEnd('\r');
            if (line.Length == 0) continue;
            if (line == "#reset") { cph = new CphStub(); continue; }
            if (line.StartsWith("#global ")) { string kv = line.Substring(8); int e = kv.IndexOf('='); cph.Globals[kv.Substring(0, e)] = kv.Substring(e + 1); continue; }
            if (line.StartsWith("#pushfails=")) { cph.RunActionResult = line.Substring(11) != "1"; continue; }
            if (line.StartsWith("#throw=")) { string k = line.Substring(7); cph.ThrowOnSetKey = k.Length == 0 ? null : k; continue; }
            if (line.StartsWith("#")) continue;

            cph.Args = new Dictionary<string, object>();
            if (line != "(no args)")
            {
                foreach (string part in line.Split('\t'))
                {
                    int e = part.IndexOf('=');
                    if (e < 0) continue;
                    string key = part.Substring(0, e), val = part.Substring(e + 1);
                    if (key.EndsWith(":int")) cph.Args[key.Substring(0, key.Length - 4)] = int.Parse(val);
                    else cph.Args[key] = val;
                }
            }
            int warnBefore = cph.Warnings.Count, bcBefore = cph.Broadcasts.Count, ranBefore = cph.RanActions.Count;

            var action = new CPHInline();
            action.CPH = cph;
            bool ret = action.Execute();

            outp.Append("ret=").Append(ret ? "true" : "false");
            outp.Append("\twarn=").Append(cph.Warnings.Count - warnBefore);
            outp.Append("\tran=").Append(string.Join(",", cph.RanActions.GetRange(ranBefore, cph.RanActions.Count - ranBefore).ToArray()));
            outp.Append("\tbc=").Append(string.Join("\u001e", cph.Broadcasts.GetRange(bcBefore, cph.Broadcasts.Count - bcBefore).ToArray()));
            var keys = new List<string>(cph.Globals.Keys);
            keys.Sort(StringComparer.Ordinal);
            foreach (string k in keys) outp.Append('\t').Append(k).Append('=').Append(cph.Globals[k]);
            outp.Append('\n');
        }
        File.WriteAllText(argv[1], outp.ToString(), utf8);
        return 0;
    }
}
