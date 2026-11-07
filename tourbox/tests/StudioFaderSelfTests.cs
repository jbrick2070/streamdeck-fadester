// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class StudioFaderSelfTests
{
    // Models OBS 33's difference between its reported Program, the on-screen blend, and Qt's T-bar widget.
    private sealed class Obs
    {
        public string Program = "a", Preview = "b", Transition = "Fondu", Version = "33.0.1";
        public string? Override, Origin;
        public bool Studio = true, LoseLeaveReply, RejectTrigger, IgnoreModeWrite;
        public double Cursor, Slider;
        public bool SliderOffscreen;
        public List<(double From, double To)> NativeCalls = [];
        public int Commits, Releases, Takes, StaleTransitionReads;
        public string? TransitionAtTake;
        private readonly Queue<string> queuedTransitions = new();
        private int readsRemaining;
        public List<string> Writes = [];
        public Task NativeMove(double expected, double target)
        {
            NativeCalls.Add((expected, target));
            if (SliderOffscreen || Slider != expected) throw new InvalidOperationException("OBS slider is unavailable or changed.");
            if (expected != target)
            {
                Slider = target;
                MoveCursor(target);
            }
            return Task.CompletedTask;
        }
        private void MoveCursor(double target)
        {
            Origin ??= Program;
            Program = Preview;
            Cursor = Math.Clamp(target, 0.01, 0.99);
        }
        public Task<JsonObject> Call(string action, JsonObject? data)
        {
            JsonObject result = new();
            if (!action.StartsWith("Get")) Writes.Add(action);
            switch (action)
            {
                case "GetStudioModeEnabled": result["studioModeEnabled"] = Studio; break;
                case "GetSceneList": result["currentProgramSceneUuid"] = Program; result["currentPreviewSceneUuid"] = Preview; break;
                case "GetCurrentProgramScene": result["sceneUuid"] = Program; break;
                case "GetCurrentSceneTransitionCursor": result["transitionCursor"] = Cursor; break;
                case "GetVersion": result["obsVersion"] = Version; break;
                case "GetSceneSceneTransitionOverride": result["transitionName"] = Override; break;
                case "GetCurrentSceneTransition":
                    if (queuedTransitions.Count > 0 && readsRemaining-- == 0)
                    {
                        Transition = queuedTransitions.Dequeue();
                        readsRemaining = StaleTransitionReads;
                    }
                    result["transitionName"] = Transition; result["transitionUuid"] = Transition + "-id";
                    result["transitionKind"] = Transition == "Fondu" ? "fade_transition" : "cut_transition"; break;
                case "GetSceneTransitionList":
                    result["currentSceneTransitionName"] = Transition;
                    result["transitions"] = new JsonArray(new JsonObject { ["transitionName"] = "Coupe", ["transitionKind"] = "cut_transition" });
                    break;
                case "SetCurrentSceneTransition":
                    var requested = (string)data!["transitionName"]!;
                    if (StaleTransitionReads == 0) { Transition = requested; break; }
                    if (queuedTransitions.Count == 0) readsRemaining = StaleTransitionReads;
                    queuedTransitions.Enqueue(requested);
                    break;
                case "SetCurrentPreviewScene": Preview = (string)data!["sceneUuid"]!; break;
                case "SetTBarPosition":
                    Check(Studio, "T-bar write with Studio Mode off");
                    MoveCursor((double)data!["position"]!);
                    if ((bool)data["release"]!)
                    {
                        if (Slider == 1) { Preview = Origin!; Commits++; }
                        else Program = Origin!;
                        Origin = null; Cursor = 0; Slider = 0; Releases++;
                    }
                    break;
                case "SetStudioModeEnabled":
                    if (IgnoreModeWrite) break;
                    Studio = (bool)data!["studioModeEnabled"]!;
                    if (!Studio && Origin != null) { Commits++; Origin = null; Cursor = 0; }
                    if (!Studio && LoseLeaveReply) { LoseLeaveReply = false; throw new IOException("Leave acknowledgement lost"); }
                    break;
                case "TriggerStudioModeTransition":
                    if (RejectTrigger) throw new InvalidOperationException("Take failed");
                    TransitionAtTake = Transition;
                    (Preview, Program) = (Program, Preview); Takes++; break;
                default: throw new InvalidOperationException("Unexpected request " + action);
            }
            return Task.FromResult(result);
        }
    }

    private static void Check(bool ok, string why)
    {
        if (!ok) throw new InvalidOperationException("Studio fader test failed: " + why);
    }

    private static async Task Blocked(Func<Task> f)
    {
        try { await f(); }
        catch (Exception e) when (e is InvalidOperationException or IOException) { return; }
        throw new Exception("Studio fader test expected the operation to stop.");
    }

    public static async Task RunAsync()
    {
        var nativeObs = new Obs();
        var native = new StudioFader(nativeObs.Call, step: 0.5, nativeMove: nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward");
        await native.DispatchAsync("fader.fineBack");
        Check(nativeObs.Slider == 0.375 && nativeObs.Cursor == 0.375 && nativeObs.Writes.Count == 0,
            "native partial moves and reversals update the visible slider and mix with one writer");
        await native.DispatchAsync("fader.cancel");
        Check(native.Position == 0 && nativeObs.Program == "a" && nativeObs.Cursor == 0 &&
            nativeObs.NativeCalls.TakeLast(2).SequenceEqual([(0.375, 0d), (0d, 0d)]) &&
            nativeObs.Writes.SequenceEqual(["SetTBarPosition"]), "native cancel releases at zero and verifies the parked widget");
        // The native widget can reach its target before the compositor catches up.
        // Drive that lag by read count, not a timing-sensitive background task.
        var laggingObs = new Obs();
        int partialCursorReads = 0;
        Task<JsonObject> LaggingRpc(string action, JsonObject? data)
        {
            if (action == "GetCurrentSceneTransitionCursor" && laggingObs.Origin != null && laggingObs.Slider > 0)
            {
                double cursor = ++partialCursorReads switch { 1 or 2 => 0, 3 => 0.013281249441206455, _ => 0.0498046875 };
                return Task.FromResult(new JsonObject { ["transitionCursor"] = cursor });
            }
            return laggingObs.Call(action, data);
        }
        var lagging = new StudioFader(LaggingRpc, 0.05, laggingObs.NativeMove);
        await lagging.DispatchAsync("fader.forward");
        Check(partialCursorReads == 3 && lagging.Position == 0.05 && laggingObs.Slider == 0.05 &&
            laggingObs.NativeCalls.SequenceEqual([(0d, 0.05)]) && laggingObs.Writes.Count == 0,
            "a nonterminal renderer confirms one native move without waiting for or replaying its target");
        await lagging.DispatchAsync("fader.cancel");
        Check(partialCursorReads == 4 && laggingObs.Program == "a" && laggingObs.Preview == "b" &&
            laggingObs.Cursor == 0 && laggingObs.Slider == 0 && laggingObs.Commits == 0 && laggingObs.Releases == 1 &&
            laggingObs.NativeCalls.SequenceEqual([(0d, 0.05), (0.05, 0d), (0d, 0d)]) &&
            laggingObs.Writes.SequenceEqual(["SetTBarPosition"]),
            "a lagging first blend can be cancelled once through native zero and frontend release");

        foreach (bool loseNativeZeroReply in new[] { true, false })
        {
            var uncertainCancelObs = new Obs();
            async Task UncertainNative(double from, double to)
            {
                await uncertainCancelObs.NativeMove(from, to);
                if (loseNativeZeroReply && from > 0 && to == 0)
                    throw new IOException("Synthetic native zero acknowledgement lost after its write");
            }
            async Task<JsonObject> UncertainRpc(string action, JsonObject? data)
            {
                var result = await uncertainCancelObs.Call(action, data);
                if (!loseNativeZeroReply && action == "SetTBarPosition" && (double?)data?["position"] == 0 && (bool?)data?["release"] == true)
                    throw new IOException("Synthetic cancel release acknowledgement lost after its write");
                return result;
            }
            var uncertainCancel = new StudioFader(UncertainRpc, 0.05, UncertainNative);
            await uncertainCancel.DispatchAsync("fader.forward");
            await Blocked(() => uncertainCancel.DispatchAsync("fader.cancel"));
            await Blocked(() => uncertainCancel.DispatchAsync("fader.forward"));
            await Blocked(() => uncertainCancel.DispatchAsync("take"));
            // Explicitly clearing the latch must not replay an uncertain release.
            await uncertainCancel.DispatchAsync("fader.cancel");
            Check(uncertainCancelObs.NativeCalls.SequenceEqual([(0d, 0.05), (0.05, 0d)]) &&
                uncertainCancelObs.Slider == 0 && uncertainCancelObs.Commits == 0 && uncertainCancelObs.Takes == 0 &&
                uncertainCancelObs.Releases == (loseNativeZeroReply ? 0 : 1) &&
                uncertainCancelObs.Writes.SequenceEqual(loseNativeZeroReply ? Array.Empty<string>() : ["SetTBarPosition"]),
                "uncertain native zero or frontend release disarms without replay, fallback or extra take");
        }
        await native.DispatchAsync("fader.forward"); await native.DispatchAsync("fader.forward");
        Check(nativeObs.Slider == 0 && nativeObs.Program == "b" && nativeObs.Preview == "a" &&
            nativeObs.Commits == 1 && nativeObs.NativeCalls.TakeLast(2).SequenceEqual([(0.5, 1d), (0d, 0d)]) &&
            nativeObs.Writes.SequenceEqual(["SetTBarPosition", "SetTBarPosition"]),
            "native endpoint commits once in Studio Mode and verifies the widget reset");
        await native.DispatchAsync("fader.forward");
        await native.DispatchAsync("fader.back"); await native.DispatchAsync("fader.back");
        Check(nativeObs.Commits == 2 && nativeObs.Program == "a" && nativeObs.Preview == "b" &&
            nativeObs.Writes.Count == 3 && nativeObs.Studio, "reverse native throw and no duplicate take");
        nativeObs.SliderOffscreen = true;
        await Blocked(() => native.DispatchAsync("fader.forward"));
        Check(nativeObs.Writes.Count == 3 && nativeObs.Cursor == 0 && nativeObs.Slider == 0,
            "a hidden native widget never falls back to an invisible WebSocket move");
        nativeObs = new(); native = new(nativeObs.Call, 0.5, nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward");
        nativeObs.Slider = 0.25; // The operator moved the on-screen widget during the throw.
        await Blocked(() => native.DispatchAsync("fader.forward"));
        Check(nativeObs.Slider == 0.25 && nativeObs.Writes.Count == 0 && nativeObs.Commits == 0,
            "unexpected widget position is never overwritten or released");
        nativeObs = new();
        int readbacks = 0;
        native = new((action, data) =>
        {
            if (nativeObs.Commits > 0 && action == "GetSceneList")
            {
                readbacks++;
                return Task.FromResult(new JsonObject { ["currentProgramSceneUuid"] = readbacks < 4 ? "a" : "b",
                    ["currentPreviewSceneUuid"] = readbacks < 17 ? "b" : "a" });
            }
            if (nativeObs.Commits > 0 && action == "GetCurrentSceneTransitionCursor")
                return Task.FromResult(new JsonObject { ["transitionCursor"] = readbacks < 13 ? 0.99 : 1 });
            return nativeObs.Call(action, data);
        }, 0.5, nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward"); await native.DispatchAsync("fader.forward");
        Check(readbacks >= 17 && nativeObs.Commits == 1 && nativeObs.Writes.SequenceEqual(["SetTBarPosition"]),
            "native handle reset, Program, parked cursor and Preview swap can become visible on separate ticks");
        nativeObs = new();
        bool firstReleasedRead = true;
        native = new((action, data) =>
        {
            if (firstReleasedRead && nativeObs.Commits > 0 && action == "GetSceneList")
            {
                nativeObs.Preview = nativeObs.Program; // OBS's automatic scene swap is disabled.
                firstReleasedRead = false;
            }
            return nativeObs.Call(action, data);
        }, 0.5, nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward"); await native.DispatchAsync("fader.forward");
        Check(nativeObs.Program == "b" && nativeObs.Preview == "a" &&
            nativeObs.Writes.SequenceEqual(["SetTBarPosition", "SetCurrentPreviewScene"]),
            "without an automatic swap, the previous Program is cued once for the return throw");
        nativeObs = new();
        int afterRelease = 0;
        native = new((action, data) =>
        {
            if (nativeObs.Commits > 0 && action == "GetSceneList") { nativeObs.Preview = "new operator cue"; afterRelease++; }
            return nativeObs.Call(action, data);
        }, 0.5, nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward"); await Blocked(() => native.DispatchAsync("fader.forward"));
        Check(afterRelease == 1 && nativeObs.Preview == "new operator cue" && nativeObs.Writes.SequenceEqual(["SetTBarPosition"]),
            "an unrelated scene during endpoint confirmation stops immediately without overwriting the cue");
        var obs = new Obs(); var fader = new StudioFader(obs.Call, 0.25);
        await fader.DispatchAsync("fader.back");
        Check(obs.Writes.Count == 0, "turning past a rail from rest must do nothing");
        await fader.DispatchAsync("fader.fineForward"); Check(fader.Position == 0.0625, "fine turn is one quarter step");
        await fader.DispatchAsync("fader.fineBack"); Check(fader.Position == 0 && obs.Program == "a", "fine back to origin cancels");
        obs = new(); fader = new(obs.Call, 0.25);
        await fader.DispatchAsync("fader.forward"); await fader.DispatchAsync("fader.forward");
        await fader.DispatchAsync("fader.back");
        Check(obs.Cursor == 0.25 && fader.Position == 0.25, "partial scrub reverses without taking");
        await fader.DispatchAsync("fader.back");
        Check(obs.Program == "a" && obs.Releases == 1 && obs.Commits == 0 && fader.Position == 0, "return to origin cancels");
        await Task.WhenAll(Enumerable.Range(0, 9).Select(_ => fader.DispatchAsync("fader.forward")));
        Check(obs.Program == "b" && obs.Preview == "a" && obs.Studio && obs.Commits == 1 && obs.Releases == 1, "full sweep commits exactly once");
        await fader.DispatchAsync("take");
        Check(obs.Takes == 0, "stray press after endpoint cannot take twice");
        for (int i = 0; i < 5; i++) await fader.DispatchAsync("fader.back");
        Check(obs.Program == "a" && obs.Preview == "b" && obs.Commits == 2, "opposite sweep returns live without another tap");
        obs = new(); fader = new(obs.Call);
        await fader.DispatchAsync("fader.forward"); await fader.DispatchAsync("fader.cancel");
        Check(obs.Program == "a" && obs.Commits == 0, "explicit cancel");
        await fader.DispatchAsync("fader.forward"); await fader.DispatchAsync("take.cut");
        Check(obs.Program == "b" && obs.Commits == 1 && obs.Takes == 0, "finish partial sweep once");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        Check(obs.Takes == 1 && obs.Program == "b" && obs.Transition == "Fondu", "localized Cut and restore");
        obs = new(){StaleTransitionReads=3}; fader = new(obs.Call);
        await fader.DispatchAsync("take.cut");
        Check(obs.Takes == 1 && obs.TransitionAtTake == "Coupe" && obs.Transition == "Fondu",
            "waits for queued Cut and restore before returning");
        await fader.DispatchAsync("fader.forward");
        Check(fader.Position > 0, "the manual fade works immediately after a delayed Cut");
        int restoreRequests = 0;
        obs = new(); fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu" && ++restoreRequests == 1)
                return Task.FromResult(new JsonObject()); // OBS accepts the request but ignores it during the tail of the Cut.
            return obs.Call(action, data);
        });
        await fader.DispatchAsync("take.cut");
        Check(restoreRequests == 2 && obs.Takes == 1 && obs.Transition == "Fondu",
            "a silently ignored restore is retried without repeating the Take");
        restoreRequests = 0;
        obs = new(); fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu")
            {
                ++restoreRequests;
                obs.Transition = "Stinger"; // Operator chose a third transition while our restore was queued.
                return Task.FromResult(new JsonObject());
            }
            return obs.Call(action, data);
        });
        await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(restoreRequests == 1 && obs.Takes == 1 && obs.Transition == "Stinger",
            "restoration stops without retrying over an operator selection");
        obs = new(){StaleTransitionReads=50}; fader = new(obs.Call);
        await Blocked(() => fader.DispatchAsync("take.cut"));
        for (int i = 0; i < 110; i++) await obs.Call("GetCurrentSceneTransition", null);
        Check(obs.Takes == 0 && obs.Transition == "Fondu" && obs.Writes.Count == 2,
            "unconfirmed Cut is followed by the original selection even when readback still shows Fade");
        obs = new(); fader = new((action, data) =>
        {
            if (action == "GetSceneList" && obs.Transition == "Coupe") obs.Transition = "Stinger";
            return obs.Call(action, data);
        });
        await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(obs.Takes == 0 && obs.Transition == "Stinger" && obs.Writes.Count == 1,
            "an operator transition change before Cut is preserved");
        obs = new(){RejectTrigger=true}; fader = new(obs.Call); await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(obs.Transition == "Fondu" && obs.Program == "a", "failed cut restores selected transition");
        obs = new(){Override="Stinger"}; fader = new(obs.Call);
        await Blocked(() => fader.DispatchAsync("take.cut")); await Blocked(() => fader.DispatchAsync("fader.forward"));
        Check(obs.Writes.Count == 0, "uncontrolled scene override never cuts or starts a sweep");
        obs = new(){Studio=false}; fader = new(obs.Call);
        await Blocked(() => fader.DispatchAsync("fader.forward")); await Blocked(() => fader.DispatchAsync("take"));
        Check(obs.Writes.Count == 0, "off-mode never changes Program or turns Studio on");
        obs = new(){Version="34.0.0"}; fader = new(obs.Call); await Blocked(() => fader.DispatchAsync("fader.forward"));
        await fader.DispatchAsync("take"); Check(obs.Writes.SequenceEqual(["TriggerStudioModeTransition"]), "unknown version uses normal Take only");
        obs = new(){Cursor=0.35}; fader = new(obs.Call); await Blocked(() => fader.DispatchAsync("fader.forward"));
        Check(obs.Writes.Count == 0, "busy OBS transition is left alone");
        foreach (bool abort in new[] { true, false })
        {
            obs = new(); fader = new(obs.Call, 0.5); await fader.DispatchAsync("fader.forward");
            if (abort) { obs.Program = "a"; obs.Origin = null; obs.Cursor = 0; } else obs.Preview = "c";
            int writes = obs.Writes.Count;
            await Blocked(() => fader.DispatchAsync("fader.forward")); await Blocked(() => fader.DispatchAsync("take"));
            Check(obs.Writes.Count == writes && obs.Commits == 0, "external abort/changed target disarms old ticks");
        }
        obs = new(){LoseLeaveReply=true}; fader = new(obs.Call, 0.5); await fader.DispatchAsync("fader.forward");
        await Blocked(() => fader.DispatchAsync("fader.forward")); await Blocked(() => fader.DispatchAsync("take"));
        Check(obs.Studio && obs.Commits == 1 && fader.Position == 0, "uncertain leave always restores Studio and disarms");
        obs = new(){IgnoreModeWrite=true}; fader = new(obs.Call, 0.5); await fader.DispatchAsync("fader.forward");
        await Blocked(() => fader.DispatchAsync("fader.forward"));
        Check(obs.Program == "b" && obs.Cursor > 0 && obs.Commits == 0, "reported destination alone is not proof the manual mix finished");
    }
}
