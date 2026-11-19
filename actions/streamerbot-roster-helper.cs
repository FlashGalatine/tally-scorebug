// Optional Streamer.bot action: "Roster Helper" — starts the roster-import helper
// (node roster-helper.mjs) in the background, hidden, so the control panel's Import
// button works without ever opening a terminal.
//
// HOW TO USE:
//   1. Actions -> add an action named "Roster Helper"; sub-action Core -> C# ->
//      Execute C# Code; paste this file; edit BUNDLE below.
//   2. THE REFERENCES STEP (required): compiling as-is fails with
//        CS0246 'ProcessStartInfo' could not be found / CS0103 'Process' does not exist
//      because Streamer.bot (a .NET Framework 4.7.2 app; seen on 1.0.4 and 1.0.7) does NOT reference System.dll by
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
// second instance finds the port taken, says so and exits; the first keeps serving.
// To stop the hidden helper: POST http://127.0.0.1:7481/shutdown (see the README).
//
// If you'd rather not add the reference, skip this action entirely and double-click
// start-roster-helper.bat instead — same result, visible log window.

using System;
using System.Diagnostics;
using System.Net.Sockets;

public class CPHInline
{
    // ── Edit for your machine: the folder containing roster-helper.mjs ──────────
    const string BUNDLE = @"C:\path\to\this\repo";

    const int PORT = 7481; // change it here too if you start the helper with ROSTER_PORT

    public bool Execute()
    {
        try
        {
            // Something already answers on the port: a helper is running (or another
            // program holds the port). Starting a second one would only exit again, so
            // say what was found instead of logging "started".
            if (PortOpen(PORT))
            {
                CPH.LogInfo("[Roster Helper] port " + PORT + " already answers — a roster helper is running, not starting another. After updating Tally, stop the old one first (POST http://127.0.0.1:" + PORT + "/shutdown).");
                return true;
            }
            if (!System.IO.File.Exists(System.IO.Path.Combine(BUNDLE, "roster-helper.mjs")))
            {
                CPH.LogWarn("[Roster Helper] roster-helper.mjs was not found in BUNDLE = " + BUNDLE + " — edit BUNDLE at the top of this action to the Tally folder.");
                return false;
            }
            var psi = new ProcessStartInfo();
            psi.FileName = "node";
            psi.Arguments = "roster-helper.mjs";
            psi.WorkingDirectory = BUNDLE;
            // UseShellExecute = true is load-bearing: launching via the shell does NOT
            // pass SB's open handles to the child. With UseShellExecute = false the node
            // process inherits SB's listening sockets (WS :8080 / HTTP :7474), and if SB
            // then exits uncleanly the orphaned helper keeps those ports bound — SB can't
            // restart its WebSocket server until the helper is killed.
            psi.UseShellExecute = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(psi);
            // Give node a moment, then check that it really is listening. A hidden
            // window hides its own errors (old Node, a syntax error, a blocked port).
            bool up = false;
            for (int i = 0; i < 20 && !up; i++) { CPH.Wait(150); up = PortOpen(PORT); }
            if (up) CPH.LogInfo("[Roster Helper] started hidden: node roster-helper.mjs in " + BUNDLE + " (http://127.0.0.1:" + PORT + ")");
            else CPH.LogWarn("[Roster Helper] node was launched in " + BUNDLE + " but nothing answers on port " + PORT + " after 3 seconds. Run start-roster-helper.bat once to see its error.");
            return up;
        }
        catch (Exception ex)
        {
            CPH.LogWarn("[Roster Helper] failed to start: " + ex.Message + " — is Node.js installed and on PATH? Fallback: double-click start-roster-helper.bat");
            return false;
        }
    }

    // True when something accepts a TCP connection on 127.0.0.1:<port> within 300 ms.
    static bool PortOpen(int port)
    {
        try
        {
            using (var c = new TcpClient())
            {
                IAsyncResult r = c.BeginConnect("127.0.0.1", port, null, null);
                bool ok = r.AsyncWaitHandle.WaitOne(300) && c.Connected;
                if (ok) c.EndConnect(r);
                return ok;
            }
        }
        catch { return false; }
    }
}
