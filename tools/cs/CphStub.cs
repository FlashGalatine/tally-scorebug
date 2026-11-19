// A stand-in for the `CPH` object Streamer.bot gives an Execute C# Code sub-action.
// It lets verify-cs.test.mjs compile the REAL action files with the Windows C#
// compiler and run their logic outside Streamer.bot. It implements only the calls the
// Tally actions make, and only what mscorlib offers, because that is all Streamer.bot
// references by default.
//
// This is not Streamer.bot: it proves the C# compiles as C# 5 and that its logic does
// what the tests expect. It does not prove Streamer.bot's own compiler accepts it.

using System;
using System.Collections.Generic;
using System.Globalization;

public class CphStub
{
    public Dictionary<string, string> Globals = new Dictionary<string, string>();
    public Dictionary<string, object> Args = new Dictionary<string, object>();
    public List<string> Warnings = new List<string>();
    public List<string> Infos = new List<string>();
    public List<string> Broadcasts = new List<string>();
    public List<string> RanActions = new List<string>();
    public bool RunActionResult = true; // false: the named action is missing or disabled
    public string ThrowOnSetKey = null; // a global whose write throws, to test the catch

    public T GetGlobalVar<T>(string name, bool persisted = true)
    {
        string v;
        if (!Globals.TryGetValue(name, out v)) return default(T);
        return (T)Convert.ChangeType(v, typeof(T), CultureInfo.InvariantCulture);
    }

    public void SetGlobalVar(string name, object value, bool persisted = true)
    {
        if (ThrowOnSetKey != null && name == ThrowOnSetKey) throw new InvalidOperationException("stub: this write was made to fail");
        Globals[name] = Convert.ToString(value, CultureInfo.InvariantCulture);
    }

    public bool TryGetArg<T>(string name, out T value)
    {
        object o;
        if (Args.TryGetValue(name, out o) && o != null)
        {
            value = (T)Convert.ChangeType(o, typeof(T), CultureInfo.InvariantCulture);
            return true;
        }
        value = default(T);
        return false;
    }

    public void LogInfo(string message) { Infos.Add(message); }
    public void LogWarn(string message) { Warnings.Add(message); }
    public void WebsocketBroadcastJson(string json) { Broadcasts.Add(json); }
    public void Wait(int milliseconds) { /* the stub does not sleep */ }

    public bool RunAction(string actionName, bool runImmediately = true)
    {
        RanActions.Add(actionName);
        return RunActionResult;
    }
}
