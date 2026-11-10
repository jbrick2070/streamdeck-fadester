// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>The transition trace with a scripted OBS, a hand-wound clock and hand-rung timers: no OBS, no waiting.</summary>
internal static class TransitionTraceSelfTests
{
    private static void Check(bool ok, string why) { if (!ok) throw new InvalidOperationException("Transition trace test failed: " + why); }
    private static void Same(string[] got, string why, params string[] want) =>
        Check(got.SequenceEqual(want), why + " | got: " + (got.Length == 0 ? "(nothing)" : string.Join(" | ", got)));

    private sealed class Rig
    {
        private DateTime time = new(2026, 11, 9, 14, 5, 6, 7);
        private readonly List<string> lines = [];
        private readonly List<TaskCompletionSource> timers = [];
        public readonly List<(string Request, JsonObject? Args)> Sent = [];
        public Exception? Fail;
        public bool LogFails;
        public JsonObject Reply = new();
        public readonly TransitionTrace Trace;

        private Rig() => Trace = new TransitionTrace(Call, line => { if (LogFails) throw new IOException("The log is closed."); lines.Add(line); },
            () => time, _ => { var timer = new TaskCompletionSource(); timers.Add(timer); return timer.Task; });

        /// <summary>A trace that has read <paramref name="selected"/> from OBS, or has read nothing when it is null.</summary>
        public static async Task<Rig> Start(string? selected = "Fade")
        {
            var rig = new Rig();
            if (selected == null) return rig;
            rig.Reply = new() { ["transitionName"] = selected };
            await rig.Trace.StartAsync();
            rig.Reply = new(); rig.lines.Clear(); rig.Sent.Clear();
            return rig;
        }

        private Task<JsonObject> Call(string request, JsonObject? args)
        {
            Sent.Add((request, args));
            return Fail != null ? Task.FromException<JsonObject>(Fail) : Task.FromResult(Reply);
        }

        public void After(int ms) => time = time.AddMilliseconds(ms);
        public Task Select(string name) => Trace.Call("SetCurrentSceneTransition", new() { ["transitionName"] = name });
        public Task Take() => Trace.Call("TriggerStudioModeTransition", null);
        public void Announce(string name) => Trace.OnEvent("CurrentSceneTransitionChanged", name);
        /// <summary>Every pending three-second check comes due.</summary>
        public void Ring() { var due = timers.ToArray(); timers.Clear(); foreach (var timer in due) timer.SetResult(); }
        public string[] Raw() { var said = lines.ToArray(); lines.Clear(); return said; }
        /// <summary>The lines since the last look, without their stamps.</summary>
        public string[] Said() => Raw().Select(line => line[(line.IndexOf(" trace: ", StringComparison.Ordinal) + 8)..]).ToArray();
    }

    public static async Task RunAsync()
    {
        // The reading at the start, and the stamp on every line.
        var rig = await Rig.Start(null);
        rig.Reply = new() { ["transitionName"] = "Fade" };
        await rig.Trace.StartAsync();
        Same(rig.Raw(), "the trace opens with the selection it read, stamped to the millisecond", "14:05:06.007 trace: on. OBS has Fade selected.");
        Check(rig.Sent.Count == 1 && rig.Sent[0] == ("GetCurrentSceneTransition", null), "the trace reads the selection once and writes nothing");

        // A change the companion asked for, and what the desk gets back.
        rig.After(100);
        var args = new JsonObject { ["transitionName"] = "Cut" };
        rig.Reply = new() { ["fixture"] = true };
        var got = await rig.Trace.Call("SetCurrentSceneTransition", args);
        Check(ReferenceEquals(got, rig.Reply) && rig.Sent[^1].Request == "SetCurrentSceneTransition" && ReferenceEquals(rig.Sent[^1].Args, args),
            "a traced request reaches OBS unchanged and its answer comes back unchanged");
        Same(rig.Raw(), "a selection request is noted before it is sent", "14:05:06.107 trace: the companion asks OBS to select Cut.");
        rig.After(40); rig.Announce("Cut");
        Same(rig.Said(), "OBS's announcement of a requested change is credited with the gap", "OBS selected Cut (the companion asked 40 ms earlier).");

        // A change nobody here asked for.
        rig.After(5000); rig.Announce("Fade");
        Same(rig.Said(), "a change after the request was used up is not the companion's", "OBS selected Fade: NOT asked by the companion (its last request was Cut, 5040 ms earlier).");
        rig = await Rig.Start(null);
        rig.Announce("Stinger");
        Same(rig.Said(), "a change before any request is not the companion's", "OBS selected Stinger: NOT asked by the companion (it has asked for nothing).");

        // The cut this was written for: Cut asked and announced, the take, Fade put back, then Cut again from elsewhere.
        // The stray Cut arrives within three seconds of the companion's own Cut and must still not be credited to it.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(30); rig.Announce("Cut");
        rig.After(10); await rig.Take();
        rig.Trace.OnEvent("SceneTransitionStarted", "Cut"); rig.Trace.OnEvent("SceneTransitionEnded", "Cut");
        rig.After(50); await rig.Select("Fade"); rig.After(20); rig.Announce("Fade");
        rig.After(500); rig.Announce("Cut");
        Same(rig.Said(), "a cut, its restore and a later stray Cut read in order",
            "the companion asks OBS to select Cut.",
            "OBS selected Cut (the companion asked 30 ms earlier).",
            "the companion asks OBS to take (OBS last announced Cut).",
            "OBS started the transition Cut.",
            "OBS ended the transition Cut.",
            "the companion asks OBS to select Fade.",
            "OBS selected Fade (the companion asked 20 ms earlier).",
            "OBS selected Cut: NOT asked by the companion (its last request was Fade, 520 ms earlier).");
        Check(rig.Sent.Select(s => s.Request).SequenceEqual(["SetCurrentSceneTransition", "TriggerStudioModeTransition", "SetCurrentSceneTransition"]),
            "the trace sends exactly the desk's requests, in order");

        // OBS passes over a request: the later one is announced, the earlier one never.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(25); await rig.Select("Wipe"); rig.After(15); rig.Announce("Wipe");
        Same(rig.Said(), "a request OBS skipped is named when a later one is announced",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Wipe.",
            "OBS did not announce Cut, which the companion asked for 40 ms earlier; it last announced Fade.",
            "OBS selected Wipe (the companion asked 15 ms earlier).");
        rig.After(10); rig.Announce("Cut");
        Same(rig.Said(), "a skipped request cannot claim a later change", "OBS selected Cut: NOT asked by the companion (its last request was Wipe, 25 ms earlier).");

        // A request OBS never announces is reported when its three seconds are up, with nothing else happening.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a dropped request is reported by its own timer",
            "the companion asks OBS to select Cut.",
            "OBS did not announce Cut, which the companion asked for 3050 ms earlier; it last announced Fade.");
        rig.Announce("Cut");
        Same(rig.Said(), "a request past its time cannot claim a change", "OBS selected Cut: NOT asked by the companion (its last request was Cut, 3050 ms earlier).");
        // Exactly three seconds is still in time.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(3000); rig.Ring(); rig.Announce("Cut");
        Same(rig.Said(), "a request is good for the whole window",
            "the companion asks OBS to select Cut.",
            "OBS selected Cut (the companion asked 3000 ms earlier).");
        // Without the timer, the next request finds it.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(3100); await rig.Take();
        Same(rig.Said(), "a dropped request is reported before the next request at the latest",
            "the companion asks OBS to select Cut.",
            "OBS did not announce Cut, which the companion asked for 3100 ms earlier; it last announced Fade.",
            "the companion asks OBS to take (OBS last announced Fade).");

        // Nothing to report: OBS repeats itself, or the companion asks for what is already selected.
        rig = await Rig.Start();
        rig.Announce("Fade");
        Same(rig.Said(), "a repeated announcement is not a change", "OBS announced Fade again (no change).");
        await rig.Select("Fade"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "asking for the selected transition is not a dropped request when OBS stays silent", "the companion asks OBS to select Fade (already selected).");
        await rig.Select("Fade"); rig.After(5); rig.Announce("Fade");
        Same(rig.Said(), "and is credited when OBS does announce it",
            "the companion asks OBS to select Fade (already selected).",
            "OBS selected Fade (the companion asked 5 ms earlier).");
        // Once someone else moves the selection, that request is used up: it cannot claim a return to Fade, and it
        // is not reported as dropped either.
        rig = await Rig.Start();
        await rig.Select("Fade"); rig.After(100); rig.Announce("Cut"); rig.After(100); rig.Announce("Fade"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a request for what was already selected claims nothing after the selection moved",
            "the companion asks OBS to select Fade (already selected).",
            "OBS selected Cut: NOT asked by the companion (its last request was Fade, 100 ms earlier).",
            "OBS selected Fade: NOT asked by the companion (its last request was Fade, 200 ms earlier).");

        // The desk sends a selection again while OBS ignores it. That is one request: one announcement answers it,
        // and the spares cannot claim a change someone else makes afterwards.
        rig = await Rig.Start("Cut");
        await rig.Select("Fade"); rig.After(100); await rig.Select("Fade"); rig.After(100); await rig.Select("Fade");
        rig.After(10); rig.Announce("Fade"); rig.After(10); rig.Announce("Fade");
        rig.After(200); rig.Announce("Cut"); rig.After(200); rig.Announce("Fade"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a re-sent request is answered once, and its spares claim nothing later",
            "the companion asks OBS to select Fade.",
            "the companion asks OBS to select Fade again.",
            "the companion asks OBS to select Fade again.",
            "OBS selected Fade (the companion asked 210 ms earlier and 2 more times since).",
            "OBS announced Fade again (no change).",
            "OBS selected Cut: NOT asked by the companion (its last request was Fade, 220 ms earlier).",
            "OBS selected Fade: NOT asked by the companion (its last request was Fade, 420 ms earlier).");
        // Sending it again keeps the claim for three seconds after the last time, and the report counts from the first.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(100); await rig.Select("Cut"); rig.After(2950); rig.Ring(); rig.Announce("Cut");
        Same(rig.Said(), "a re-sent request is good for the window after its last sending",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Cut again.",
            "OBS selected Cut (the companion asked 3050 ms earlier and once more since).");
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(100); await rig.Select("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a re-sent request OBS never announces is reported once",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Cut again.",
            "OBS did not announce Cut, which the companion asked for 3150 ms earlier and once more since; it last announced Fade.");

        // The restore after a cut, asked while the Cut is still waiting, is a request of its own: when OBS drops
        // it, that is reported, although Fade was the selection when it was sent.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(5); await rig.Select("Fade"); rig.After(10); rig.Announce("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a dropped restore is reported",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Fade.",
            "OBS selected Cut (the companion asked 15 ms earlier).",
            "OBS did not announce Fade, which the companion asked for 3060 ms earlier; it last announced Cut.");
        // A request for what OBS shows by then is not reported as dropped.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(5); await rig.Select("Fade"); rig.After(5); await rig.Select("Cut");
        rig.After(5); rig.Announce("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "only the request OBS does not show is reported",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Fade.",
            "the companion asks OBS to select Cut.",
            "OBS selected Cut (the companion asked 15 ms earlier).",
            "OBS did not announce Fade, which the companion asked for 3060 ms earlier; it last announced Cut.");

        // What passes through unmentioned, and the other writes that are shown.
        rig = await Rig.Start();
        await rig.Trace.Call("GetCurrentSceneTransition", null); await rig.Trace.Call("GetSceneTransitionList", null);
        await rig.Trace.Call("SetInputVolume", new() { ["inputVolumeDb"] = -6 }); await rig.Trace.Call("SetSceneItemEnabled", new() { ["sceneItemEnabled"] = true });
        Check(rig.Said().Length == 0 && rig.Sent.Count == 4, "reads, and writes that have nothing to do with a transition, pass through unmentioned");
        await rig.Trace.Call("SetCurrentSceneTransitionDuration", new() { ["transitionDuration"] = 300 });
        await rig.Trace.Call("SetCurrentSceneTransition", new() { ["transitionName"] = 7 });
        Same(rig.Said(), "other transition writes are shown as sent",
            "the companion sends SetCurrentSceneTransitionDuration {\"transitionDuration\":300}.",
            "the companion sends SetCurrentSceneTransition {\"transitionName\":7}.");
        // Scene, Studio Mode and T-bar writes are shown too. A pull of the T-bar is its first move and its release;
        // after another line, the next move is shown again.
        rig = await Rig.Start();
        await rig.Trace.Call("SetCurrentPreviewScene", new() { ["sceneName"] = "B" });
        await rig.Trace.Call("SetTBarPosition", new() { ["position"] = 0.25, ["release"] = false });
        await rig.Trace.Call("SetTBarPosition", new() { ["position"] = 0.5, ["release"] = false });
        rig.Trace.OnEvent("SceneTransitionStarted", "Fade");
        await rig.Trace.Call("SetTBarPosition", new() { ["position"] = 0.75, ["release"] = false });
        await rig.Trace.Call("SetTBarPosition", new() { ["position"] = 0.9 });
        await rig.Trace.Call("SetTBarPosition", new() { ["position"] = 1, ["release"] = true });
        await rig.Trace.Call("SetStudioModeEnabled", new() { ["studioModeEnabled"] = false });
        await rig.Trace.Call("SetCurrentProgramScene", new() { ["sceneName"] = "A" });
        Check(rig.Sent.Count == 8, "every scene, Studio Mode and T-bar write still reaches OBS");
        Same(rig.Said(), "the desk's scene, Studio Mode and T-bar writes are shown, a pull by its first move and its release",
            "the companion sends SetCurrentPreviewScene {\"sceneName\":\"B\"}.",
            "the companion sends SetTBarPosition {\"position\":0.25,\"release\":false}; the moves that follow are left out.",
            "OBS started the transition Fade.",
            "the companion sends SetTBarPosition {\"position\":0.75,\"release\":false}; the moves that follow are left out.",
            "the companion sends SetTBarPosition {\"position\":1,\"release\":true}.",
            "the companion sends SetStudioModeEnabled {\"studioModeEnabled\":false}.",
            "the companion sends SetCurrentProgramScene {\"sceneName\":\"A\"}.");
        rig = await Rig.Start(null);
        await rig.Take();
        rig.Trace.OnEvent("SceneTransitionStarted", "Cut");
        Same(rig.Said(), "with no selection known, the take and the start say only what happened",
            "the companion asks OBS to take.",
            "OBS started the transition Cut.");

        // The transitions OBS runs.
        rig = await Rig.Start();
        rig.Trace.OnEvent("SceneTransitionStarted", "Cut"); rig.Trace.OnEvent("SceneTransitionStarted", "Fade");
        rig.Trace.OnEvent("SceneTransitionEnded", "Fade"); rig.Trace.OnEvent("SceneTransitionVideoEnded", "Fade");
        Same(rig.Said(), "a transition that runs while another is selected says so; other events are left out",
            "OBS started the transition Cut while Fade is selected.",
            "OBS started the transition Fade.",
            "OBS ended the transition Fade.");

        // A request OBS refuses reaches the desk as the same error, and cannot claim a later change.
        rig = await Rig.Start();
        rig.Fail = new ObsError("SetCurrentSceneTransition", 600, "No transition by that name");
        Exception? thrown = null;
        try { await rig.Select("Cut"); } catch (Exception e) { thrown = e; }
        Check(ReferenceEquals(thrown, rig.Fail), "the desk gets OBS's own error");
        rig.Fail = null; rig.After(100); rig.Announce("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a refused request is shown, and a change after it is not the companion's",
            "the companion asks OBS to select Cut.",
            "OBS refused SetCurrentSceneTransition: No transition by that name (600)",
            "OBS selected Cut: NOT asked by the companion (its last request was Cut, 100 ms earlier).");
        // One that got no answer may still have been applied, so it keeps its claim.
        rig = await Rig.Start();
        rig.Fail = new IOException("SetCurrentSceneTransition timed out or disconnected; command was not retried.");
        thrown = null;
        try { await rig.Select("Cut"); } catch (Exception e) { thrown = e; }
        Check(ReferenceEquals(thrown, rig.Fail), "the desk gets the connection's own error");
        rig.Fail = null; rig.After(100); rig.Announce("Cut");
        Same(rig.Said(), "a request with no answer is shown and may still be credited",
            "the companion asks OBS to select Cut.",
            "SetCurrentSceneTransition failed: SetCurrentSceneTransition timed out or disconnected; command was not retried.",
            "OBS selected Cut (the companion asked 100 ms earlier).");

        // Refused when it was sent again: the first sending keeps its claim.
        rig = await Rig.Start();
        await rig.Select("Cut"); rig.After(100);
        rig.Fail = new ObsError("SetCurrentSceneTransition", 207, "OBS is not ready");
        thrown = null;
        try { await rig.Select("Cut"); } catch (Exception e) { thrown = e; }
        Check(ReferenceEquals(thrown, rig.Fail), "the desk gets OBS's error for the request it sent again");
        rig.Fail = null; rig.After(10); rig.Announce("Cut"); rig.After(3050); rig.Ring();
        Same(rig.Said(), "a refused re-send leaves the first request its claim",
            "the companion asks OBS to select Cut.",
            "the companion asks OBS to select Cut again.",
            "OBS refused SetCurrentSceneTransition: OBS is not ready (207)",
            "OBS selected Cut (the companion asked 110 ms earlier).");

        // The log the companion gives the trace never holds up its caller. While nothing can be written the lines
        // wait; they come out in order, and one that cannot be written does not stop the next.
        using (var taking = new ManualResetEventSlim(false))
        {
            var written = new List<string>();
            var all = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var queued = TransitionTrace.Queued(line =>
            {
                taking.Wait();
                lock (written) { written.Add(line); if (written.Count == 3) all.TrySetResult(); }
                if (line == "two") throw new IOException("The log is closed.");
            });
            Check(Task.Run(() => { queued("one"); queued("two"); queued("three"); }).Wait(TimeSpan.FromSeconds(5)),
                "a log that has stopped taking lines does not hold up the caller");
            lock (written) Check(written.Count == 0, "nothing is written while the log takes no lines");
            taking.Set();
            await all.Task.WaitAsync(TimeSpan.FromSeconds(5));
            lock (written) Same([.. written], "queued lines are written in order, past one that fails", "one", "two", "three");
        }

        // A log that cannot be written changes nothing for the desk: the request goes out, OBS's answer or error
        // comes back, and events and the first reading do not throw.
        rig = await Rig.Start();
        rig.LogFails = true;
        rig.Reply = new() { ["fixture"] = true };
        got = await rig.Trace.Call("SetCurrentSceneTransition", new() { ["transitionName"] = "Cut" });
        Check(ReferenceEquals(got, rig.Reply) && rig.Sent.Count == 1, "a log that fails does not stop a request or its answer");
        rig.Fail = new ObsError("TriggerStudioModeTransition", 506, "Studio mode is not active");
        thrown = null;
        try { await rig.Take(); } catch (Exception e) { thrown = e; }
        Check(ReferenceEquals(thrown, rig.Fail), "a log that fails does not replace OBS's error");
        rig.Fail = null;
        rig.Announce("Cut"); rig.Trace.OnEvent("SceneTransitionStarted", "Cut"); rig.After(3050); rig.Ring();
        await rig.Trace.StartAsync();
        rig.LogFails = false; rig.After(10); rig.Announce("Fade");
        Same(rig.Said(), "after a failed log the trace still knows what OBS announced",
            "OBS selected Fade: NOT asked by the companion (its last request was Cut, 3060 ms earlier).");

        // The first reading: it may fail, come back empty, or come after OBS has already announced something.
        rig = await Rig.Start(null);
        rig.Fail = new IOException("OBS is disconnected.");
        await rig.Trace.StartAsync();
        Same(rig.Said(), "a failed first reading is said, not thrown", "on. Could not read the selected transition: OBS is disconnected.");
        rig = await Rig.Start(null);
        await rig.Trace.StartAsync();
        Same(rig.Said(), "a first reading without a name is said plainly", "on. OBS has no transition selected.");
        rig = await Rig.Start(null);
        rig.Announce("Cut"); rig.Reply = new() { ["transitionName"] = "Fade" };
        await rig.Trace.StartAsync();
        Same(rig.Said(), "an announcement that came before the first reading stands",
            "OBS selected Cut: NOT asked by the companion (it has asked for nothing).",
            "on. OBS has Cut selected.");
    }
}
