// Optional Streamer.bot action: "Roster Helper" — starts the roster-import helper
// (node roster-helper.mjs) in the background, hidden, so the control panel's Import
// button works without ever opening a terminal.
//
// HOW TO USE:
//   1. Actions -> add an action named "Roster Helper"; sub-action Core -> C# ->
//      Execute C# Code; paste this file; edit BUNDLE below.
//   2. THE REFERENCES STEP (required): compiling as-is fails with
//        CS0246 'ProcessStartInfo' could not be found / CS0103 'Process' does not exist
//      because SB 1.0.4 (a .NET Framework 4.7.2 app) does NOT reference System.dll by
//      default — the same root cause as the known 'Uri' gap; Process/ProcessStartInfo/Uri
//      all live in System.dll. Fix: in the C# editor open the **References** tab (next to
//      "Compiling Log") and add
//        System.dll
//      (browse to C:\Windows\Microsoft.NET\Framework64\v4.0.30319\System.dll if it wants
//      a full path). Then COMPILE — it should go green.
//   3. Make it start with Streamer.bot: in the action's Triggers box search "start"
//      and add the application-started trigger your SB version offers — or just
//      right-click -> run the action once after launching SB. Either way: no terminal.
//
// Requires Node.js on PATH (node.exe) — no npm install is needed at runtime; the
// helper has zero package dependencies. Running the action twice is harmless: the
// second instance finds the port taken (EADDRINUSE) and exits, the first keeps serving.
//
// If you'd rather not add the reference, skip this action entirely and double-click
// start-roster-helper.bat instead — same result, visible log window.

using System;
using System.Diagnostics;

public class CPHInline
{
    // ── Edit for your machine: the folder containing roster-helper.mjs ──────────
    const string BUNDLE = @"C:\path\to\this\repo";

    public bool Execute()
    {
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = "node";
            psi.Arguments = "roster-helper.mjs";
            psi.WorkingDirectory = BUNDLE;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            Process.Start(psi);
            CPH.LogInfo("[Roster Helper] started hidden: node roster-helper.mjs in " + BUNDLE + " (http://127.0.0.1:7481)");
            return true;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[Roster Helper] failed to start: " + ex.Message + " — is Node.js installed and on PATH? Fallback: double-click start-roster-helper.bat");
            return false;
        }
    }
}
