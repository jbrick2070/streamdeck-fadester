// SPDX-License-Identifier: GPL-2.0-or-later
using System.Globalization;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>Opt-in diagnostic (--trace-transitions). Stamps every change of OBS's selected scene transition and every
/// transition OBS runs, next to the companion's own transition, scene and T-bar requests, so a change the companion did
/// not ask for can be told from one it did. OBS's events do not name the client behind a change: "asked" means the
/// companion sent SetCurrentSceneTransition for that name and OBS had not announced it yet. Apart from one reading of
/// the selection at the start it sends OBS nothing of its own.</summary>
internal sealed class TransitionTrace(Func<string, JsonObject?, Task<JsonObject>> rpc, Action<string> log,
    Func<DateTime>? clock = null, Func<TimeSpan, Task>? delay = null)
{
    // A request OBS has not announced within this time is taken as dropped: OBS drops a selection made while a
    // transition runs, and otherwise announces one within a frame or two.
    internal static readonly TimeSpan Window = TimeSpan.FromSeconds(3);
    // Not transition requests, but they show what the desk was doing when the selection changed.
    private static readonly HashSet<string> Context = ["SetCurrentPreviewScene", "SetCurrentProgramScene", "SetStudioModeEnabled", "SetTBarPosition"];

    /// <summary>The companion's request for one transition, with the times it sent that request again before OBS
    /// announced anything: the desk re-sends a selection OBS ignores, and OBS answers the lot with one change.</summary>
    private sealed class Ask(string name, DateTime at, bool settled)
    {
        public readonly string Name = name;
        public readonly DateTime First = at;
        public DateTime Last = at;
        public int Count = 1;
        // Asked for while OBS already had it selected and nothing else was waiting: OBS has nothing to announce.
        public readonly bool Settled = settled;
    }

    // The wall clock, so a line can be matched with what was seen on screen.
    private readonly Func<DateTime> now = clock ?? (() => DateTime.Now);
    private readonly Func<TimeSpan, Task> wait = delay ?? Task.Delay;
    private readonly object gate = new();
    // The companion's requests OBS has not announced yet, oldest first.
    private readonly List<Ask> asked = [];
    private (string Name, DateTime At)? last;
    // The selection OBS announced last, or the one read at the start.
    private string? selected;
    // A T-bar move is on the log and nothing has been said since: the moves that follow it are left out.
    private bool moving;

    private void Say(DateTime at, string text)
    {
        moving = false;
        // A log that fails must not stop a request, replace OBS's error or cost the connection.
        try { log(at.ToString("HH:mm:ss.fff", CultureInfo.InvariantCulture) + " trace: " + text); } catch (Exception) { }
    }

    private static long Ms(DateTime from, DateTime to) => (long)Math.Round((to - from).TotalMilliseconds);
    private static string Again(Ask ask) => ask.Count == 1 ? "" : ask.Count == 2 ? " and once more since" : " and " + (ask.Count - 1) + " more times since";

    /// <summary>Reads the selection once, so the first change has something to be compared with.</summary>
    public async Task StartAsync()
    {
        try
        {
            string? name = (await rpc("GetCurrentSceneTransition", null))["transitionName"] is JsonValue v && v.TryGetValue<string>(out var read) ? read : null;
            // An event that arrived meanwhile is OBS's own announcement and stands.
            lock (gate) { selected ??= name; Say(now(), "on. OBS has " + (selected ?? "no transition") + " selected."); }
        }
        catch (Exception e) { lock (gate) Say(now(), "on. Could not read the selected transition: " + e.Message); }
    }

    /// <summary>The rpc handed to the desk. Every request passes through unchanged; the ones that write a transition,
    /// a scene, Studio Mode or the T-bar are noted first, so OBS's announcement always follows its request in the log.</summary>
    public async Task<JsonObject> Call(string request, JsonObject? args)
    {
        bool transition = !request.StartsWith("Get", StringComparison.Ordinal) && request.Contains("Transition", StringComparison.Ordinal);
        if (!transition && !Context.Contains(request)) return await rpc(request, args);
        Ask? ask = null;
        lock (gate)
        {
            var at = now();
            Expire(at);
            if (request == "SetCurrentSceneTransition" && args?["transitionName"] is JsonValue v && v.TryGetValue<string>(out var name))
            {
                last = (name, at);
                if (asked.Count > 0 && asked[^1].Name == name)
                {
                    ask = asked[^1]; ask.Count++; ask.Last = at;
                    Say(at, "the companion asks OBS to select " + name + " again.");
                }
                else
                {
                    asked.Add(ask = new Ask(name, at, settled: asked.Count == 0 && name == selected));
                    Say(at, "the companion asks OBS to select " + name + (ask.Settled ? " (already selected)." : "."));
                }
            }
            else if (request == "TriggerStudioModeTransition")
                Say(at, "the companion asks OBS to take" + (selected != null ? " (OBS last announced " + selected + ")." : "."));
            else if (request == "SetTBarPosition" && !(args?["release"] is JsonValue r && r.TryGetValue<bool>(out var released) && released))
            {
                // A pull sends a position many times a second. The first one and the release tell the story.
                if (!moving) { Say(at, "the companion sends SetTBarPosition " + (args?.ToJsonString() ?? "{}") + "; the moves that follow are left out."); moving = true; }
            }
            else Say(at, "the companion sends " + request + " " + (args?.ToJsonString() ?? "{}") + ".");
        }
        if (ask != null) _ = Recheck();
        try { return await rpc(request, args); }
        catch (Exception e)
        {
            lock (gate)
            {
                // A request OBS refused cannot be behind a later change. One that got no answer may still have been
                // applied, so it stays.
                if (e is ObsError && ask != null && --ask.Count == 0) asked.Remove(ask);
                Say(now(), e is ObsError ? "OBS refused " + e.Message : request + " failed: " + e.Message);
            }
            throw;
        }
    }

    // Reports a dropped request when its time is up, not only when the next event or request happens to arrive.
    private async Task Recheck()
    {
        try { await wait(Window + TimeSpan.FromMilliseconds(50)); lock (gate) Expire(now()); }
        catch (Exception) { /* A diagnostic never faults its host. */ }
    }

    /// <summary>OBS's transition events, from <see cref="ObsConnection.TransitionEvent"/>.</summary>
    public void OnEvent(string kind, string name)
    {
        lock (gate)
        {
            var at = now();
            Expire(at);
            switch (kind)
            {
                case "CurrentSceneTransitionChanged": Selected(at, name); break;
                case "SceneTransitionStarted":
                    Say(at, "OBS started the transition " + name + (selected != null && selected != name ? " while " + selected + " is selected." : "."));
                    break;
                case "SceneTransitionEnded": Say(at, "OBS ended the transition " + name + "."); break;
            }
        }
    }

    private void Selected(DateTime at, string name)
    {
        int i = asked.FindIndex(a => a.Name == name);
        if (i >= 0)
        {
            // OBS handles requests in order, so an older one it passed over without a word was dropped. Dropping it
            // here also keeps a stale request from claiming a later change that someone else made.
            for (int j = 0; j < i; j++) Unannounced(at, asked[j]);
            var ask = asked[i];
            asked.RemoveRange(0, i + 1);
            Say(at, "OBS selected " + name + " (the companion asked " + Ms(ask.First, at) + " ms earlier" + Again(ask) + ").");
        }
        else if (name == selected) Say(at, "OBS announced " + name + " again (no change).");
        else
        {
            // The selection moved and nobody here asked for that. A request for what was selected until now changed
            // nothing then and must not claim a later return to it.
            asked.RemoveAll(a => a.Settled);
            Say(at, "OBS selected " + name + ": NOT asked by the companion" +
                (last is { } l ? " (its last request was " + l.Name + ", " + Ms(l.At, at) + " ms earlier)." : " (it has asked for nothing)."));
        }
        selected = name;
    }

    private void Unannounced(DateTime at, Ask ask)
    {
        // Silence is no dropped request when OBS had the transition selected already, or has it selected now.
        if (ask.Settled || ask.Name == selected) return;
        Say(at, "OBS did not announce " + ask.Name + ", which the companion asked for " + Ms(ask.First, at) + " ms earlier" + Again(ask) +
            (selected != null ? "; it last announced " + selected + "." : "."));
    }

    private void Expire(DateTime at)
    {
        // A request sent again keeps its claim for the window after the last time it was sent.
        int keep = asked.FindIndex(a => at - a.Last <= Window);
        if (keep < 0) keep = asked.Count;
        for (int j = 0; j < keep; j++) Unannounced(at, asked[j]);
        asked.RemoveRange(0, keep);
    }
}
