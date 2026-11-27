// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class StudioFaderSelfTests
{
    // Models OBS 33's difference between its reported Program, the on-screen blend, and Qt's T-bar widget.
    private sealed class Obs
    {
        public string Program = "a", Preview = "b", Transition = "Fondu", Version = "33.0.1";
        public int Duration = 300;
        public int? OverrideDuration;
        public string? Override, Origin;
        public bool Studio = true, LoseLeaveReply, RejectTrigger, IgnoreModeWrite;
        public double Cursor, Slider;
        public bool SliderOffscreen, LoseTriggerReply;
        // The native call (1-based) that the helper refuses, writing nothing; 0 for none.
        public int RefuseCall;
        public ObsError? TriggerRefusal;
        public List<(double From, double To)> NativeCalls = [];
        public int Commits, Releases, Takes, StaleTransitionReads;
        public string? TransitionAtTake;
        // OBS lists transitions in hash order, so the Fade is not first. A Stinger is neither a Cut nor a Fade.
        public string[] Listed = ["Coupe", "Stinger", "Fondu"];
        public static string Kind(string name) => name switch { "Fondu" => "fade_transition", "Stinger" => "obs_stinger_transition", _ => "cut_transition" };
        private readonly Queue<string> queuedTransitions = new();
        private int readsRemaining;
        public List<string> Writes = [];
        public Task NativeMove(double expected, double target)
        {
            NativeCalls.Add((expected, target));
            if (NativeCalls.Count == RefuseCall) throw new NativeRefusal("native T-bar disabled or range changed");
            if (SliderOffscreen) throw new NativeRefusal("Cannot find the OBS T-bar slider.");
            if (Slider != expected) throw new NativeRefusal($"T-bar moved; actual {Slider}, expected {expected}.");
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
                case "GetSceneSceneTransitionOverride":
                    result["transitionName"] = Override;
                    result["transitionDuration"] = OverrideDuration is int own ? JsonValue.Create(own) : null; break;
                case "GetCurrentSceneTransition":
                    if (queuedTransitions.Count > 0 && readsRemaining-- == 0)
                    {
                        Transition = queuedTransitions.Dequeue();
                        readsRemaining = StaleTransitionReads;
                    }
                    result["transitionName"] = Transition; result["transitionUuid"] = Transition + "-id";
                    result["transitionKind"] = Kind(Transition);
                    result["transitionDuration"] = Kind(Transition) == "cut_transition" ? null : JsonValue.Create(Duration); break;
                case "GetSceneTransitionList":
                    result["currentSceneTransitionName"] = Transition;
                    result["transitions"] = new JsonArray(Listed.Select(name => (JsonNode)new JsonObject { ["transitionName"] = name, ["transitionKind"] = Kind(name) }).ToArray());
                    break;
                case "SetCurrentSceneTransition":
                    var requested = (string)data!["transitionName"]!;
                    if (StaleTransitionReads == 0) { Transition = requested; break; }
                    if (queuedTransitions.Count == 0) readsRemaining = StaleTransitionReads;
                    queuedTransitions.Enqueue(requested);
                    break;
                case "SetCurrentProgramScene":
                    if (Studio && Cursor is > 0 and < 1) break;
                    string oldProg = Program;
                    Program = (string)data!["sceneUuid"]!;
                    if (Studio && oldProg != Program) Preview = oldProg;
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
                    if (!Studio && Origin != null) { Commits++; Origin = null; Cursor = 0; Slider = 0; }
                    if (!Studio && LoseLeaveReply) { LoseLeaveReply = false; throw new IOException("Leave acknowledgement lost"); }
                    break;
                case "TriggerStudioModeTransition":
                    if (RejectTrigger) throw new InvalidOperationException("Take failed");
                    if (TriggerRefusal != null) throw TriggerRefusal;
                    TransitionAtTake = Transition;
                    (Preview, Program) = (Program, Preview); Takes++;
                    if (LoseTriggerReply) { LoseTriggerReply = false; throw new IOException("TriggerStudioModeTransition timed out or disconnected"); }
                    break;
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
        catch (Exception e) when (e is InvalidOperationException or IOException or ObsError) { return; }
        throw new Exception("Studio fader test expected the operation to stop.");
    }

    private static string Words(string text) => string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static string FirstDifference(string observed, string onMain)
    {
        string[] seen = Words(observed).Split(' '), was = Words(onMain).Split(' ');
        for (int i = 0; i < Math.Max(seen.Length, was.Length); i++)
            if (i >= seen.Length || i >= was.Length || seen[i] != was[i])
                return $"token {i}: observed '{(i < seen.Length ? seen[i] : "(end)")}', main gave '{(i < was.Length ? was[i] : "(end)")}'";
        return "no difference";
    }

    // BEGIN trigger-travel-trace
    // The game controller's trigger end to end: PadTbar turns trigger samples into T-bar targets, and StudioFader.MoveToAsync moves
    // to each. One token per target sent, in hundredths: target > position held / OBS slider, then o (a throw is open) or i (idle).
    internal static async Task<string> TriggerTravelTraceAsync()
    {
        static double[] Sweep(double from, double to) =>
            Enumerable.Range(0, (int)Math.Round(Math.Abs(to - from) * 1000) + 1)
                .Select(i => Math.Round(from + Math.Sign(to - from) * i / 1000.0, 3)).ToArray();
        var pulls = new (string Name, double[] Samples, bool PadLost)[]
        {
            ("rise-to-just-below-full-then-release", [.. Sweep(0, 0.969), .. Sweep(0.969, 0)], false),
            ("full-pull-and-spring-back", [.. Sweep(0, 1), .. Sweep(1, 0)], false),
            ("coarse-pull", [0, 0.12, 0.31, 0.58, 0.83, 0.955, 0.97, 0], false),
            ("half-pull-then-pad-lost", Sweep(0, 0.5), true),
        };
        var lines = new List<string>();
        foreach (var (name, samples, padLost) in pulls)
        {
            var obs = new Obs();
            var fader = new StudioFader(obs.Call, nativeMove: obs.NativeMove);
            var pad = new PadTbar();
            var tokens = new List<string>();
            async Task Send(double? target)
            {
                if (target is not double t) return;
                await fader.MoveToAsync(t);
                tokens.Add($"{Math.Round(t * 100)}>{Math.Round(fader.Position * 100)}/{Math.Round(obs.Slider * 100)}{(obs.Cursor is > 0 and < 1 ? 'o' : 'i')}");
            }
            foreach (double trigger in samples) await Send(pad.Next(trigger));
            if (padLost) await Send(pad.Lost());
            lines.Add($"{name}: {string.Join(' ', tokens)} | program={obs.Program} commits={obs.Commits} releases={obs.Releases} slider={obs.Slider}");
        }
        return string.Join('\n', lines);
    }
    // END trigger-travel-trace

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
            laggingObs.NativeCalls.SequenceEqual([(0d, 0d), (0d, 0.05)]) && laggingObs.Writes.Count == 0,
            "a nonterminal renderer confirms one native move without waiting for or replaying its target");
        await lagging.DispatchAsync("fader.cancel");
        Check(partialCursorReads == 4 && laggingObs.Program == "a" && laggingObs.Preview == "b" &&
            laggingObs.Cursor == 0 && laggingObs.Slider == 0 && laggingObs.Commits == 0 && laggingObs.Releases == 1 &&
            laggingObs.NativeCalls.SequenceEqual([(0d, 0d), (0d, 0.05), (0.05, 0d), (0d, 0d)]) &&
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
            var uncertainCancel = new StudioFader(UncertainRpc, 0.05, UncertainNative, allowAutoCloseout: false);
            await uncertainCancel.DispatchAsync("fader.forward");
            await Blocked(() => uncertainCancel.DispatchAsync("fader.cancel"));
            await Blocked(() => uncertainCancel.DispatchAsync("fader.forward"));
            await Blocked(() => uncertainCancel.DispatchAsync("take"));
            // Explicitly clearing the latch must not replay an uncertain release.
            await uncertainCancel.DispatchAsync("fader.cancel");
            Check(uncertainCancelObs.NativeCalls.SequenceEqual([(0d, 0d), (0d, 0.05), (0.05, 0d)]) &&
                uncertainCancelObs.Slider == 0 && uncertainCancelObs.Commits == 0 && uncertainCancelObs.Takes == 0 &&
                uncertainCancelObs.Releases == (loseNativeZeroReply ? 0 : 1) &&
                uncertainCancelObs.Writes.SequenceEqual(loseNativeZeroReply ? Array.Empty<string>() : ["SetTBarPosition"]),
                "strict no-fallback mode (macOS host) disarms without replay, fallback or extra take");
        }
        foreach (double lostAt in new[] { 0.3, 0.6 })
        {
            var autoObs = new Obs { Transition = "Coupe" };
            bool killSlider = false;
            var autoFader = new StudioFader(autoObs.Call, 0.05, (from, to) =>
                killSlider ? Task.FromException(new IOException("Native helper closed mid-throw")) : autoObs.NativeMove(from, to));
            await autoFader.MoveToAsync(lostAt);
            killSlider = true;
            await Blocked(() => autoFader.MoveToAsync(lostAt + 0.1));
            string expectedProgram = lostAt >= 0.5 ? "b" : "a";
            string expectedPreview = lostAt >= 0.5 ? "a" : "b";
            Check(autoFader.Position == 0 && autoObs.Cursor == 0 && autoObs.Studio &&
                autoObs.Program == expectedProgram && autoObs.Preview == expectedPreview &&
                autoObs.Transition == "Coupe",
                "Windows Companion auto-closes lost native throw (< 0.5 back to Program, >= 0.5 finish to Preview) and repays lent Fade");
            killSlider = false;
            await autoFader.MoveToAsync(0.25);
            Check(autoFader.Position == 0.25 && autoObs.Cursor == 0.25, "next throw works immediately without manual Cancel");
            await autoFader.MoveToAsync(0);
        }
        // The release went through and only the parking check that follows it failed: the throw already ended on the
        // target rail, so the close-out must keep that result (a take stays taken, a cancel stays cancelled) rather than
        // apply the 0.5 rule to the position before the last write.
        foreach (var (from, to) in new[] { (0.2, 1d), (0.6, 0d) })
        {
            var parkObs = new Obs();
            bool failPark = false;
            var parkFader = new StudioFader(parkObs.Call, 0.05, (a, b) =>
                failPark && a == 0 && b == 0
                    ? Task.FromException(new InvalidOperationException("Synthetic parking check: slider not found"))
                    : parkObs.NativeMove(a, b));
            await parkFader.MoveToAsync(from);
            failPark = true;
            await Blocked(() => parkFader.MoveToAsync(to));
            bool took = to == 1;
            Check(parkObs.Program == (took ? "b" : "a") && parkObs.Preview == (took ? "a" : "b") &&
                parkObs.Commits == (took ? 1 : 0) && parkObs.Releases == 1 && parkObs.Cursor == 0 &&
                parkObs.Writes.SequenceEqual(["SetTBarPosition"]) && parkFader.Position == 0,
                $"a failed parking check after a confirmed release at {to} keeps that result (from {from})");
        }
        await native.DispatchAsync("fader.forward"); await native.DispatchAsync("fader.forward");
        Check(nativeObs.Slider == 0 && nativeObs.Program == "b" && nativeObs.Preview == "a" &&
            nativeObs.Commits == 1 && nativeObs.NativeCalls.TakeLast(2).SequenceEqual([(0.5, 1d), (0d, 0d)]) &&
            nativeObs.Writes.SequenceEqual(["SetTBarPosition", "SetTBarPosition"]),
            "native endpoint commits once in Studio Mode and verifies the widget reset");
        // Clockwise always throws towards Preview, also for the return throw (hand test 2026-11-17); back at rest does nothing.
        await native.DispatchAsync("fader.back"); await Task.Delay(native.SettleMs + 100);
        await native.DispatchAsync("fader.forward"); await native.DispatchAsync("fader.forward");
        Check(nativeObs.Commits == 2 && nativeObs.Program == "a" && nativeObs.Preview == "b" &&
            nativeObs.Writes.Count == 3 && nativeObs.Studio, "return throw is clockwise too, with no duplicate take");
        nativeObs.SliderOffscreen = true; await Task.Delay(native.SettleMs + 100);
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
        Check(obs.Program == "b" && obs.Commits == 1, "counter-clockwise at rest after a take does nothing");
        await Task.Delay(fader.SettleMs + 100);
        for (int i = 0; i < 5; i++) await fader.DispatchAsync("fader.forward");
        Check(obs.Program == "a" && obs.Preview == "b" && obs.Commits == 2, "after a pause the next clockwise sweep returns live without another tap");
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
        // The second 2026-11-09 hardware finding: the restore reads back, then OBS returns to Cut as the cut ends.
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        Check(obs.Transition == "Fondu", "a confirmed restore reads back the original");
        obs.Transition = "Coupe";
        await fader.MoveToAsync(0.5);
        Check(obs.Transition == "Fondu" && fader.Position == 0.5, "OBS returning to Cut after a confirmed restore is put back before the T-bar");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await Task.Delay(500); obs.Transition = "Coupe";
        await fader.DispatchAsync("take");
        Check(obs.Transition == "Fondu" && obs.Takes == 2 && obs.TransitionAtTake == "Fondu", "and before a take, so it fades instead of cutting");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await Task.Delay(500); obs.Transition = "Coupe";
        await fader.DispatchAsync("take.cut");
        Check(obs.Transition == "Fondu" && obs.Takes == 2, "a second cut while OBS went back to Cut still ends on the original");
        obs = new(); fader = new(async (action, data) =>
        {
            var reply = await obs.Call(action, data);
            if (action == "TriggerStudioModeTransition") obs.Transition = "Fondu"; // OBS put the original back by itself
            return reply;
        });
        await fader.DispatchAsync("take.cut");
        obs.Transition = "Coupe";
        await fader.MoveToAsync(0.5);
        Check(obs.Transition == "Fondu" && fader.Position == 0.5, "a cut that found the original already back still watches for Cut");
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
        obs = new(){StaleTransitionReads=50}; fader = new(obs.Call) { SelectPolls = 40 };
        await Blocked(() => fader.DispatchAsync("take.cut"));
        for (int i = 0; i < 2000; i++) await obs.Call("GetCurrentSceneTransition", null);
        Check(obs.Takes == 0 && obs.Transition == "Fondu" && obs.Writes.All(w => w == "SetCurrentSceneTransition"),
            "unconfirmed Cut is followed by the original selection even when readback still shows Fade");
        obs = new(); fader = new((action, data) =>
        {
            if (action == "GetSceneList" && obs.Transition == "Coupe") obs.Transition = "Stinger";
            return obs.Call(action, data);
        });
        await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(obs.Takes == 0 && obs.Transition == "Stinger" && obs.Writes.Count == 1,
            "an operator transition change before Cut is preserved");
        // The 2026-11-09 hardware finding: OBS ignores every restore during a busy Cut, so the cut ends on Cut.
        bool ignoreRestore = true; restoreRequests = 0;
        obs = new(); fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu" && ignoreRestore)
            { restoreRequests++; return Task.FromResult(new JsonObject()); }
            return obs.Call(action, data);
        }) { SelectPolls = 40 };
        await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(obs.Takes == 1 && obs.Transition == "Coupe" && restoreRequests > 1, "an ignored restore leaves Cut selected and says so");
        await Blocked(() => fader.MoveToAsync(0.5));
        Check(obs.Transition == "Coupe" && obs.Takes == 1 && fader.Position == 0, "while OBS still ignores it, the next action stops without moving");
        ignoreRestore = false;
        await fader.MoveToAsync(0.5);
        Check(obs.Transition == "Fondu" && fader.Position == 0.5, "the next action puts Fade back first, then mixes");
        await fader.DispatchAsync("fader.cancel");
        ignoreRestore = true;
        await Task.Delay(500); // clear the 450 ms second-take guard on purpose, not by the restore loop's length
        obs.Preview = "a"; obs.Program = "b"; await Blocked(() => fader.DispatchAsync("take.cut"));
        ignoreRestore = false; await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Fondu" && obs.Takes == 2, "Cancel also puts the owed transition back");
        ignoreRestore = true;
        await Task.Delay(500);
        await Blocked(() => fader.DispatchAsync("take.cut"));
        obs.Transition = "Stinger"; ignoreRestore = false;
        await fader.DispatchAsync("fader.forward");
        Check(obs.Transition == "Fondu" && fader.Position > 0, "an operator's own choice after a failed restore is not repaid over; the T-bar lends a Fade");
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Stinger", "and Cancel puts the operator's choice back, not the cut's original");
        // OBS counts a transition as running about 1 s past its picture and drops every selection until it ends (measured
        // on 33.0.1, 2026-11-09). Here it drops them for busyMs after each take, longer than the old 40-poll wait.
        long tookAt = 0; int fadeRequests = 0; double busyMs = 1500;
        Task<JsonObject> SlowObs(string action, JsonObject? data)
        {
            if (action == "SetCurrentSceneTransition")
            {
                if ((string?)data?["transitionName"] == "Fondu") fadeRequests++;
                if (tookAt != 0 && Stopwatch.GetElapsedTime(tookAt).TotalMilliseconds < busyMs) return Task.FromResult(new JsonObject());
            }
            var reply = obs.Call(action, data);
            if (action == "TriggerStudioModeTransition") tookAt = Stopwatch.GetTimestamp();
            return reply;
        }
        obs = new(); fader = new(SlowObs);
        await fader.DispatchAsync("take.cut");
        Check(obs.Takes == 1 && obs.Transition == "Fondu" && fadeRequests > 1,
            "a put-back OBS drops for the whole Cut lands once the Cut ends, without repeating the cut");
        await fader.DispatchAsync("take");
        Check(obs.Takes == 2 && obs.TransitionAtTake == "Fondu", "and a Take pressed right after fades");
        // Seen live: B about 1.3 s after A, the Fade's picture done but OBS still counting it as running.
        tookAt = 0; busyMs = 800;
        obs = new(); fader = new(SlowObs);
        await fader.DispatchAsync("take");
        await Task.Delay(500); // past the 450 ms second-take guard
        var firstCut = fader.DispatchAsync("take.cut", Stopwatch.GetTimestamp());
        await Task.Delay(100); long againAt = Stopwatch.GetTimestamp(); // B pressed again while nothing seemed to happen
        await firstCut;
        Check(obs.Takes == 2 && obs.TransitionAtTake == "Coupe" && obs.Transition == "Fondu",
            "a cut pressed while OBS still finishes a Fade waits for it, cuts once and puts Fade back");
        await fader.DispatchAsync("take.cut", againAt);
        Check(obs.Takes == 2, "a second cut pressed while the first waited is a double press, though it runs only afterwards");
        await fader.DispatchAsync("take", Stopwatch.GetTimestamp());
        Check(obs.Takes == 3 && obs.TransitionAtTake == "Fondu", "while a take pressed after the cut went out fades");
        tookAt = 0; fadeRequests = 0; busyMs = 1500;
        obs = new(){Transition="Coupe"}; fader = new(SlowObs);
        await fader.DispatchAsync("take.cut"); await fader.MoveToAsync(0.4);
        Check(obs.Takes == 1 && obs.Transition == "Fondu" && fader.Position == 0.4 && fadeRequests > 1,
            "a throw started while the Cut still runs waits for it to end, then mixes with a Fade");
        // An unconfirmed Cut that lands only after the next action has started.
        bool ignoreCut = true;
        obs = new(); fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Coupe" && ignoreCut)
                return Task.FromResult(new JsonObject());
            return obs.Call(action, data);
        }) { SelectPolls = 40 };
        await Blocked(() => fader.DispatchAsync("take.cut"));
        Check(obs.Takes == 0 && obs.Transition == "Fondu", "an unconfirmed Cut never takes");
        await fader.MoveToAsync(0.3); await fader.DispatchAsync("fader.cancel");
        obs.Transition = "Coupe"; // the queued Cut lands late
        await fader.MoveToAsync(0.4);
        Check(obs.Transition == "Fondu" && fader.Position == 0.4, "a Cut that lands after the next action is still put back");
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

        // Absolute moves for the game controller's spring-loaded trigger.
        obs = new(); fader = new(obs.Call);
        await fader.MoveToAsync(0.4);
        Check(fader.Position == 0.4 && obs.Cursor == 0.4, "an absolute move throws to that position");
        await fader.MoveToAsync(0.2);
        Check(fader.Position == 0.2 && obs.Cursor == 0.2, "an absolute move back eases without taking");
        await fader.MoveToAsync(0);
        Check(fader.Position == 0 && obs.Program == "a" && obs.Releases == 1 && obs.Commits == 0, "zero cancels to the original Program");
        await fader.MoveToAsync(0);
        Check(obs.Releases == 1, "zero at rest does nothing");
        await fader.MoveToAsync(0.5); await fader.MoveToAsync(1);
        Check(obs.Program == "b" && obs.Preview == "a" && obs.Commits == 1 && fader.Position == 0, "one takes");
        await fader.MoveToAsync(0.5);
        Check(fader.Position == 0.5 && obs.Cursor == 0.5, "after a take the trigger still pulls from 0 towards 1");
        await fader.MoveToAsync(1);
        Check(obs.Program == "a" && obs.Preview == "b" && obs.Commits == 2, "and takes back to the other scene");
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(1);
        Check(obs.Program == "b" && obs.Commits == 1, "a full pull in one sample takes once");
        await fader.MoveToAsync(1);
        Check(obs.Program == "b" && obs.Commits == 1, "a second full pull from rest right after a take does not take back");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take"); await fader.MoveToAsync(1);
        Check(obs.Program == "b" && obs.Takes == 1 && obs.Commits == 0, "nor right after a Take from another surface");
        obs = new(){Studio=false}; fader = new(obs.Call);
        await Blocked(() => fader.MoveToAsync(0.3));
        Check(obs.Writes.Count == 0, "Studio Mode off: an absolute move changes nothing");
        obs = new(); fader = new(obs.Call, 0.5); await fader.MoveToAsync(0.3);
        obs.Preview = "c";
        await Blocked(() => fader.MoveToAsync(0.4)); await Blocked(() => fader.MoveToAsync(0.5));
        await fader.DispatchAsync("fader.cancel"); await fader.MoveToAsync(0);
        Check(obs.Commits == 0, "a changed Preview disarms absolute moves until an explicit cancel");

        // With any transition but a Fade selected, the T-bar selects a Fade for the sweep and puts the operator's back.
        obs = new(){Transition="Coupe"}; fader = new(obs.Call);
        await fader.MoveToAsync(0.4);
        Check(obs.Transition == "Fondu" && fader.Position == 0.4 && obs.Cursor == 0.4, "with Cut selected the trigger mixes with a Fade");
        await fader.MoveToAsync(0);
        Check(obs.Transition == "Coupe" && obs.Program == "a" && obs.Releases == 1 && obs.Commits == 0, "letting go puts Cut back");
        await fader.MoveToAsync(0.5); await fader.MoveToAsync(1);
        Check(obs.Transition == "Coupe" && obs.Program == "b" && obs.Commits == 1, "a take puts Cut back too");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.MoveToAsync(1);
        Check(obs.Transition == "Coupe" && obs.Program == "b" && obs.Commits == 1, "a full pull in one sample lends, takes and puts back");
        obs = new(){Transition="Stinger"}; fader = new(obs.Call);
        await fader.DispatchAsync("fader.forward");
        Check(obs.Transition == "Fondu" && fader.Position > 0, "the dial lends a Fade over a Stinger");
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Stinger" && obs.Program == "a", "and Cancel puts the Stinger back");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call);
        await fader.DispatchAsync("fader.forward"); await fader.DispatchAsync("take");
        Check(obs.Program == "b" && obs.Commits == 1 && obs.Transition == "Coupe", "a Take during a lent throw takes, then puts Cut back");
        obs = new(){Transition="Coupe", Listed=["Coupe", "Stinger"]}; fader = new(obs.Call);
        await Blocked(() => fader.MoveToAsync(0.4));
        Check(obs.Writes.Count == 0 && obs.Transition == "Coupe", "with no Fade in OBS nothing changes");
        obs = new(){Transition="Coupe", Override="Stinger"}; fader = new(obs.Call);
        await Blocked(() => fader.MoveToAsync(0.4));
        Check(obs.Writes.Count == 0 && obs.Transition == "Coupe", "a Preview override other than the Fade stops it before anything changes");
        obs = new(){Transition="Coupe", Override="Fondu"}; fader = new(obs.Call);
        await fader.MoveToAsync(0.4);
        Check(obs.Transition == "Fondu" && fader.Position == 0.4, "a Preview override naming that Fade is fine");
        // OBS drops a selection while its transition is still active: a Fade that never lands moves nothing.
        obs = new(){Transition="Coupe"}; fader = new((action, data) =>
            action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu" ? Task.FromResult(new JsonObject()) : obs.Call(action, data))
            { SelectPolls = 40 };
        await Blocked(() => fader.MoveToAsync(0.4));
        Check(obs.Transition == "Coupe" && fader.Position == 0 && obs.Cursor == 0 && !obs.Writes.Contains("SetTBarPosition"),
            "a Fade OBS will not select moves nothing and leaves Cut");
        obs.Transition = "Fondu"; // the operator then picks the Fade in OBS
        await fader.DispatchAsync("take");
        Check(obs.TransitionAtTake == "Fondu", "a lend OBS refused owes nothing afterwards: a Fade the operator picks next is theirs");
        obs = new(){Transition="Coupe"}; fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu") obs.Preview = "c"; // cued while the Fade was being selected
            return obs.Call(action, data);
        });
        await Blocked(() => fader.MoveToAsync(0.4));
        Check(obs.Transition == "Coupe" && obs.Cursor == 0, "a Preview cued while the Fade is selected stops the throw and puts Cut back at once");
        obs = new(){Transition="Coupe", StaleTransitionReads=50}; fader = new(obs.Call) { SelectPolls = 40 };
        await Blocked(() => fader.MoveToAsync(0.4));
        for (int i = 0; i < 2000; i++) await obs.Call("GetCurrentSceneTransition", null);
        Check(obs.Transition == "Coupe" && obs.Cursor == 0, "a Fade selection OBS answers late is followed by Cut, so Cut stays");
        int fadeSends = 0;
        obs = new(){Transition="Coupe"}; fader = new((action, data) =>
            action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Fondu" && ++fadeSends == 1 ? Task.FromResult(new JsonObject()) : obs.Call(action, data));
        await fader.MoveToAsync(0.4);
        Check(obs.Transition == "Fondu" && fader.Position == 0.4 && fadeSends > 1, "a Fade selection OBS drops right after a cut is sent again");
        // A restore OBS drops right after the sweep is retried, then reported and owed to the next action.
        bool dropRestore = true; int restores = 0;
        obs = new(){Transition="Coupe"}; fader = new((action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Coupe" && dropRestore)
            { restores++; return Task.FromResult(new JsonObject()); }
            return obs.Call(action, data);
        }) { SelectPolls = 40 };
        await fader.MoveToAsync(0.4);
        await Blocked(() => fader.MoveToAsync(0));
        Check(restores > 1 && obs.Program == "a" && obs.Transition == "Fondu", "a dropped restore is retried, then reported");
        dropRestore = false;
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Coupe", "Cancel puts Cut back once OBS takes it");
        dropRestore = true;
        await fader.MoveToAsync(0.4); await Blocked(() => fader.MoveToAsync(0));
        obs.Transition = "Coupe"; dropRestore = false; // one of the dropped restores lands late after all
        await fader.DispatchAsync("fader.cancel");
        obs.Transition = "Fondu"; // then the operator picks the Fade
        await fader.DispatchAsync("take");
        Check(obs.TransitionAtTake == "Fondu", "once Cut reads back the lent Fade is not owed: a Fade picked later is the operator's");
        // A slow restore after a take must not let a held trigger take straight back.
        obs = new(){Transition="Coupe"}; fader = new(async (action, data) =>
        {
            if (action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Coupe") await Task.Delay(500);
            return await obs.Call(action, data);
        });
        await fader.MoveToAsync(1); await fader.MoveToAsync(1);
        Check(obs.Program == "b" && obs.Commits == 1 && obs.Transition == "Coupe", "the second-take guard counts from after the restore");
        // The native slider is checked before a Fade is lent.
        nativeObs = new(){Transition="Coupe"}; native = new(nativeObs.Call, 0.5, nativeObs.NativeMove);
        await native.DispatchAsync("fader.forward");
        Check(nativeObs.Transition == "Fondu" && nativeObs.NativeCalls.SequenceEqual([(0d, 0d), (0d, 0.5)]), "a usable slider: check, lend, then move");
        nativeObs = new(){Transition="Coupe", SliderOffscreen=true}; native = new(nativeObs.Call, 0.5, nativeObs.NativeMove);
        await Blocked(() => native.DispatchAsync("fader.forward"));
        Check(nativeObs.Transition == "Coupe" && nativeObs.Writes.Count == 0, "an unusable slider stops before the selection changes");
        // With a Fade selected the slider is checked before every sweep too. When the helper answers that it wrote nothing
        // (OBS rebuilt its T-bar after Studio Mode went off and on, say), nothing is latched: the next pull works, no View.
        nativeObs = new() { RefuseCall = 1 }; native = new(nativeObs.Call, 0.5, nativeObs.NativeMove);
        await Blocked(() => native.MoveToAsync(0.4));
        Check(native.Position == 0 && nativeObs.Cursor == 0 && nativeObs.Writes.Count == 0 && nativeObs.NativeCalls.SequenceEqual([(0d, 0d)]),
            "with a Fade selected a refused check before the first move changes nothing in OBS");
        await native.MoveToAsync(0.4);
        Check(native.Position == 0.4 && nativeObs.Slider == 0.4 && nativeObs.Cursor == 0.4, "and the next pull works without a Cancel first");
        nativeObs = new() { Transition = "Coupe", RefuseCall = 2 }; native = new(nativeObs.Call, 0.5, nativeObs.NativeMove);
        await Blocked(() => native.MoveToAsync(0.4));
        Check(native.Position == 0 && nativeObs.Cursor == 0 && nativeObs.Transition == "Coupe" && !nativeObs.Writes.Contains("SetTBarPosition"),
            "a first move the helper refuses writes nothing and puts a lent Fade back at once");
        await native.MoveToAsync(0.4);
        Check(native.Position == 0.4 && nativeObs.Transition == "Fondu" && nativeObs.Cursor == 0.4, "and the next pull lends the Fade again and mixes");
        await native.MoveToAsync(0);
        Check(nativeObs.Transition == "Coupe" && nativeObs.Program == "a", "letting go then puts Cut back as usual");
        // While a sweep runs, a cut's owed transition is never swapped under it.
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await fader.MoveToAsync(0.3);
        obs.Transition = "Coupe"; // OBS went back to Cut in the middle of the mix
        int selections = obs.Writes.Count(w => w == "SetCurrentSceneTransition");
        await Blocked(() => fader.MoveToAsync(0.4));
        Check(obs.Writes.Count(w => w == "SetCurrentSceneTransition") == selections, "a running sweep stops instead of switching the transition under it");
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Fondu", "and Cancel then puts the cut's original back");
        // A lent Fade outlives a failed sweep: it goes back once OBS's T-bar is idle, on Cancel or when the connection ends.
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.MoveToAsync(0.4);
        obs.Preview = "c"; // the operator cued another scene in OBS mid-throw
        await Blocked(() => fader.MoveToAsync(0.5));
        await Blocked(() => fader.DispatchAsync("fader.cancel"));
        Check(obs.Transition == "Fondu" && obs.Cursor > 0, "while OBS's T-bar is part-way the lent Fade cannot go back, and Cancel says so");
        obs.Program = "a"; obs.Origin = null; obs.Cursor = 0; // the operator drags OBS's T-bar back
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Transition == "Coupe", "once OBS is idle Cancel puts Cut back");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.MoveToAsync(0.4);
        obs.Program = "a"; obs.Origin = null; obs.Cursor = 0; // OBS ended the throw by itself
        await Blocked(() => fader.MoveToAsync(0.5));
        await fader.SettleAsync();
        Check(obs.Transition == "Coupe", "a clean stop puts a lent Fade back even with the fader latched");
        // A cut's watch that a lend replaced carries on after the throw.
        obs = new(){Transition="Stinger"}; fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await fader.MoveToAsync(0.4); await fader.MoveToAsync(0);
        Check(obs.Transition == "Stinger", "a throw after a cut lends a Fade over the Stinger and puts it back");
        obs.Transition = "Coupe"; // OBS goes back to Cut within the cut's 30 s
        await Task.Delay(500);
        await fader.DispatchAsync("take");
        Check(obs.TransitionAtTake == "Stinger", "and the cut's watch still puts the Stinger back before the next take");

        // Each connection gets a new fader; the old one's memory crosses the reconnect.
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        obs.Transition = "Coupe"; // OBS went back to Cut, then the connection dropped
        fader = new(obs.Call, resume: fader.Leave());
        Check(await fader.ResumeAsync() == "" && obs.Transition == "Fondu", "a cut's borrowed transition goes back right after a reconnect");
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(0.4);
        fader = new(obs.Call, resume: fader.Leave());
        Check((await fader.ResumeAsync()).Length > 0 && fader.Position == 0 && obs.Program == "a" && obs.Cursor == 0 &&
            obs.Releases == 1 && obs.Commits == 0, "a sweep left part-thrown by a lost connection returns to Program");
        await fader.MoveToAsync(0.3);
        Check(fader.Position == 0.3 && obs.Cursor == 0.3, "and the T-bar throws again on the new connection");
        nativeObs = new(); native = new(nativeObs.Call, 0.4, nativeObs.NativeMove); await native.DispatchAsync("fader.forward");
        native = new(nativeObs.Call, 0.4, nativeObs.NativeMove, native.Leave());
        await native.ResumeAsync();
        Check(native.Position == 0 && nativeObs.Slider == 0 && nativeObs.Program == "a" && nativeObs.Commits == 0 &&
            nativeObs.NativeCalls.SequenceEqual([(0d, 0d), (0d, 0.4), (0.4, 0d), (0d, 0d)]), "below 0.5 the native widget is walked back from where the old connection left it");
        var finishReconnectObs = new Obs();
        var finishReconnect = new StudioFader(finishReconnectObs.Call, 0.5, finishReconnectObs.NativeMove);
        await finishReconnect.DispatchAsync("fader.forward");
        finishReconnect = new(finishReconnectObs.Call, 0.5, finishReconnectObs.NativeMove, finishReconnect.Leave());
        Check((await finishReconnect.ResumeAsync()).Contains("finished Preview") && finishReconnect.Position == 0 &&
            finishReconnectObs.Slider == 0 && finishReconnectObs.Program == "b" && finishReconnectObs.Preview == "a" && finishReconnectObs.Commits == 1,
            "at >= 0.5 reconnect finishes Preview automatically");
        foreach (double reconnectAt in new[] { 0.35, 0.65 })
        {
            var nonFadeObs = new Obs();
            var nonFadeFader = new StudioFader(nonFadeObs.Call, 0.05, nonFadeObs.NativeMove);
            await nonFadeFader.MoveToAsync(reconnectAt);
            var carried = nonFadeFader.Leave();
            nonFadeObs.Transition = "Coupe"; // OBS holds a non-Fade transition on reconnect
            nonFadeFader = new(nonFadeObs.Call, 0.05, nonFadeObs.NativeMove, carried);
            var line = await nonFadeFader.ResumeAsync();
            Check(nonFadeObs.Cursor == 0 && nonFadeObs.Slider == 0 &&
                nonFadeObs.Program == (reconnectAt >= 0.5 ? "b" : "a") &&
                nonFadeObs.Preview == (reconnectAt >= 0.5 ? "a" : "b") &&
                line.Contains(reconnectAt >= 0.5 ? "finished Preview" : "back to Program"),
                "reconnect with a non-Fade transition closes out using the 0.5 rule");
        }
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(0.4);
        var left = fader.Leave();
        obs = new(); fader = new(obs.Call, resume: left); // OBS itself restarted: nothing is part-way any more
        Check(await fader.ResumeAsync() == "" && fader.Position == 0 && obs.Writes.Count == 0, "a carried sweep is dropped quietly when OBS is idle");
        await fader.MoveToAsync(0.3);
        Check(fader.Position == 0.3, "and a new throw starts from rest");
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(0.4);
        obs.Preview = "c"; // the operator cued something else while the connection was down
        fader = new(obs.Call, resume: fader.Leave());
        Check((await fader.ResumeAsync()).Contains("could not") && fader.Position == 0 && obs.Releases == 0, "a carried sweep that is no longer ours is not released on its own");
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Releases == 1 && obs.Cursor == 0, "and one Cancel releases it, as the reconnect line says");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.MoveToAsync(0.4);
        fader = new(obs.Call, resume: fader.Leave());
        Check((await fader.ResumeAsync()).Length > 0 && obs.Program == "a" && obs.Cursor == 0 && obs.Transition == "Coupe",
            "a sweep that lent a Fade returns to Program and puts Cut back after a reconnect");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.MoveToAsync(0.4);
        dropRestore = true;
        fader = new((action, data) => action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Coupe" && dropRestore
            ? Task.FromResult(new JsonObject()) : obs.Call(action, data), resume: fader.Leave()) { SelectPolls = 40 };
        string? resumed = null;
        try { await fader.ResumeAsync(); } catch (InvalidOperationException e) { resumed = e.Message; }
        Check(resumed?.StartsWith("T-bar: back to Program after the reconnect.") == true && obs.Program == "a" && obs.Transition == "Fondu",
            "a restore OBS drops after a reconnect is added to the reconnect line, not put in its place");

        // A T-bar stuck part-way with no memory of it (the companion was restarted): Cancel releases it.
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(0.4);
        fader = new(obs.Call);
        await Blocked(() => fader.MoveToAsync(0.5));
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Cursor == 0 && obs.Program == "a" && obs.Releases == 1 && obs.Commits == 0, "Cancel releases a stalled T-bar back to Program");
        await fader.MoveToAsync(0.3);
        Check(fader.Position == 0.3, "and the T-bar is usable again");
        int moving = 0;
        obs = new(); fader = new((action, data) =>
        {
            if (action == "GetCurrentSceneTransitionCursor") obs.Cursor = 0.35 + 0.1 * moving++;
            return obs.Call(action, data);
        });
        await fader.DispatchAsync("fader.cancel");
        Check(obs.Writes.Count == 0, "a transition OBS is running itself is never released");
        obs = new(){Cursor=0.35}; fader = new((action, data) =>
            action == "SetTBarPosition" ? Task.FromResult(new JsonObject()) : obs.Call(action, data));
        await Blocked(() => fader.DispatchAsync("fader.cancel"));
        Check(obs.Cursor == 0.35, "a T-bar that will not release says so");

        // The game controller's take pushes the T-bar when OBS would play a Fade anyway, end to end in that Fade's Duration.
        obs = new(); fader = new(obs.Call);
        Check(await fader.SlidePlanAsync() is { From: 0, Ms: 300 }, "with Fade selected the controller's take slides over its Duration");
        obs.Duration = 1200;
        Check(await fader.SlidePlanAsync() is { Ms: 1200 } && obs.Writes.Count == 0, "a longer Duration is a slower slide, and planning changes nothing in OBS");
        obs.Transition = "Coupe";
        Check(await fader.SlidePlanAsync() == null, "with Cut selected it is OBS's own take, a cut");
        obs.Transition = "Stinger";
        Check(await fader.SlidePlanAsync() == null, "with a Stinger selected it is OBS's own take");
        obs.Transition = "Fondu"; obs.Override = "Stinger";
        Check(await fader.SlidePlanAsync() == null, "a Preview scene with its own transition is OBS's own take");
        obs.Override = "Fondu"; obs.OverrideDuration = 2000;
        Check(await fader.SlidePlanAsync() is { Ms: 2000 }, "an override with the same Fade slides over the override's own Duration, as OBS's take would");
        obs.Override = null; obs.OverrideDuration = null; obs.Preview = obs.Program;
        Check(await fader.SlidePlanAsync() == null, "nothing to slide to when Preview is Program");
        obs = new(); fader = new(obs.Call); await fader.MoveToAsync(0.4);
        obs.Preview = "c"; await Blocked(() => fader.MoveToAsync(0.5));
        Check(await fader.SlidePlanAsync() == null, "a fader that needs a Cancel first is OBS's own take, which says so");
        await Blocked(() => fader.DispatchAsync("take"));
        obs = new(){Version="32.0.3"}; fader = new(obs.Call);
        Check(await fader.SlidePlanAsync() == null, "an OBS without T-bar support is OBS's own take");
        foreach (string v33 in new[] { "33.0.0", "33.0.1", "33.0.2", "33.1.0", "33.2.4" })
        {
            var obs33 = new Obs { Version = v33 };
            var fader33 = new StudioFader(obs33.Call);
            Check(await fader33.SlidePlanAsync() is { Ms: 300 }, $"OBS {v33} is accepted by Companion T-bar gate");
            await fader33.MoveToAsync(0.35);
            await fader33.MoveToAsync(0);
            Check(fader33.Position == 0 && obs33.Cursor == 0 && obs33.Program == "a", $"OBS {v33}: the trigger pulled back to 0 cancels the throw");
            await fader33.MoveToAsync(0.35);
            await fader33.MoveToAsync(1);
            Check(fader33.Position == 0 && obs33.Cursor == 0 && obs33.Program == "b", $"OBS {v33}: the trigger pulled to 1 takes");
        }
        // The trigger's positions are railed by PadTbar (Rest and Full) before they get here, so an absolute move only clamps.
        foreach (double held in new[] { 0.005, 0.01, 0.02, 0.03, 0.97, 0.98, 0.99 })
        {
            obs = new(); fader = new(obs.Call);
            await fader.MoveToAsync(held);
            Check(fader.Position == held && obs.Cursor is > 0 and < 1 && obs.Releases == 0 && obs.Commits == 0,
                $"an absolute move to {held} opens a throw there; it is not snapped to a rail");
        }
        obs = new(); fader = new(obs.Call, 0.25); await fader.DispatchAsync("fader.forward");
        Check(await fader.SlidePlanAsync() is { From: 0.25, Ms: 300 }, "a take during a throw pushes on from where the T-bar is, at the Duration's speed");
        // A host that writes only on a fresh command (the Mac host) carries a part-thrown T-bar over a reconnect without
        // writing: OBS's T-bar stays where it is, and the next Dial turn, Fade or Cancel acts on it.
        obs = new(); fader = new(obs.Call, 0.25, allowAutoCloseout: false); await fader.DispatchAsync("fader.forward");
        int writesAtDrop = obs.Writes.Count;
        var carriedOn = new StudioFader(obs.Call, 0.25, resume: fader.Leave(), allowAutoCloseout: false);
        string kept = await carriedOn.ResumeWithoutWritingAsync();
        Check(kept.Contains("still part-way") && obs.Writes.Count == writesAtDrop && carriedOn.Position == 0.25 && obs.Cursor is > 0 and < 1,
            "a part-thrown T-bar is kept over a reconnect and nothing is written");
        await carriedOn.DispatchAsync("fader.forward");
        Check(carriedOn.Position == 0.5 && obs.Cursor is > 0 and < 1, "the next Dial turn carries the kept throw on");
        await carriedOn.DispatchAsync("fader.cancel");
        Check(carriedOn.Position == 0 && obs.Cursor == 0 && obs.Program == "a", "Cancel takes a kept throw back to Program");
        obs = new(); fader = new(obs.Call, 0.25, allowAutoCloseout: false); await fader.DispatchAsync("fader.forward");
        var memoryAtDrop = fader.Leave(); obs = new(); writesAtDrop = obs.Writes.Count; // OBS is back with its T-bar at rest
        carriedOn = new StudioFader(obs.Call, 0.25, resume: memoryAtDrop, allowAutoCloseout: false);
        Check(await carriedOn.ResumeWithoutWritingAsync() == "" && carriedOn.Position == 0 && obs.Writes.Count == writesAtDrop,
            "a throw that is over when OBS is back (its T-bar at rest) is forgotten without a write");
        await carriedOn.DispatchAsync("fader.forward");
        Check(carriedOn.Position == 0.25, "and the Dial starts a new throw");
        obs = new(); carriedOn = new StudioFader(obs.Call, allowAutoCloseout: false);
        Check(await carriedOn.ResumeWithoutWritingAsync() == "" && obs.Writes.Count == 0, "with nothing carried, nothing is read into a throw or written");
        // A slider the helper cannot read (OBS minimised or run as administrator) must not swallow the take: no slide is
        // promised, so the controller sends OBS's own take. The read writes nothing and sets no latch.
        obs = new(); int sliderReads = 0;
        fader = new(obs.Call, nativeMove: (from, to) => { sliderReads++; return Task.FromException(new NativeRefusal("Cannot find the main OBS window.")); });
        Check(await fader.SlidePlanAsync() == null && sliderReads == 1 && obs.Writes.Count == 0, "a T-bar slider that cannot be read is OBS's own take, and planning wrote nothing");
        await fader.DispatchAsync("take");
        Check(obs.Program == "b" && obs.Takes == 1, "the ordinary take still goes out when the slider cannot be read");
        obs = new(); fader = new(obs.Call, nativeMove: (_, _) => Task.FromException(new System.ComponentModel.Win32Exception(5)));
        Check(await fader.SlidePlanAsync() == null, "any failure to read the slider, not only a refusal, is OBS's own take");
        // The push itself is the trigger's path: steps, then the end takes.
        obs = new(); fader = new(obs.Call);
        foreach (var step in new[] { 0.01, 0.34, 0.67, 0.99, 1 }) await fader.MoveToAsync(step);
        Check(obs.Program == "b" && obs.Preview == "a" && obs.Commits == 1 && obs.Takes == 0 && fader.Position == 0, "a slide's last step takes once");
        Check(await fader.SlidePlanAsync(Stopwatch.GetTimestamp()) == null, "a take pressed right after the slide ended is a double press");
        obs = new(){Transition="Coupe"}; fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await Task.Delay(500);
        Check(await fader.SlidePlanAsync() == null && obs.Transition == "Coupe", "after a cut with Cut selected the take stays OBS's own");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        await Task.Delay(500); obs.Transition = "Coupe"; // OBS went back to Cut after the cut
        Check(await fader.SlidePlanAsync() is { Ms: 300 } && obs.Transition == "Fondu", "OBS back on Cut after a cut: the Fade goes back first, then the take slides");

        // About 1.5 s after a cut the companion looks again (Program.cs), so a Cut OBS went back to does not wait for the
        // next fader action, which could be a take more than 30 s later.
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        int sentBefore = obs.Writes.Count;
        Check(await fader.RecheckAsync() == "" && obs.Writes.Count == sentBefore, "a re-check that finds the original changes nothing");
        obs.Transition = "Coupe";
        string rechecked = await fader.RecheckAsync();
        Check(obs.Transition == "Fondu" && rechecked.Contains("Coupe") && rechecked.Contains("Fondu"),
            "OBS back on Cut after the cut: the re-check puts Fade back and says so");
        Check(await fader.RecheckAsync() == "", "and says it once");
        obs = new(); fader = new(obs.Call);
        Check(await fader.RecheckAsync() == "" && obs.Writes.Count == 0, "with nothing owed a re-check sends nothing");

        // A host that looks again after every cut (the Windows companion) leaves the put-back to that look: the cut
        // returns as soon as Program is confirmed, so the controls' other input is not held up while OBS still drops
        // selections. The look puts the Fade back without a word; a take before it puts it back first.
        obs = new(); fader = new(obs.Call) { DeferCutReturn = true };
        Check(await fader.DispatchAsync("take.cut") == "" && obs.Program == "b" && obs.Transition == "Coupe",
            "with the put-back left to the re-check, the cut returns with Cut still selected");
        Check(await fader.RecheckAsync() == "" && obs.Transition == "Fondu", "the re-check puts the Fade back and has nothing to report");
        obs.Transition = "Coupe";
        Check((await fader.RecheckAsync()).Contains("Fondu") && obs.Transition == "Fondu", "OBS back on Cut after that put-back is still caught, and said");
        obs = new(); fader = new(obs.Call) { DeferCutReturn = true };
        await fader.DispatchAsync("take.cut"); await Task.Delay(500);
        await fader.DispatchAsync("take");
        Check(obs.Transition == "Fondu" && obs.Program == "a" && obs.Takes == 2, "a take before the re-check puts the Fade back first, so it fades");
        obs = new(); fader = new(obs.Call) { DeferCutReturn = true };
        await fader.DispatchAsync("take.cut"); await fader.SettleAsync();
        Check(obs.Transition == "Fondu", "a connection that ends before the re-check still puts the Fade back");
        obs = new(); fader = new(obs.Call) { DeferCutReturn = true };
        await fader.DispatchAsync("take.cut");
        var afterDrop = new StudioFader(obs.Call, resume: fader.Leave()) { DeferCutReturn = true };
        await afterDrop.ResumeAsync();
        Check(obs.Transition == "Fondu", "a put-back still waiting when the connection drops is made on the next connection");

        // A take or cut that sent nothing says so; a take OBS refused does not count towards a double press.
        obs = new(); fader = new(obs.Call);
        Check(await fader.DispatchAsync("take") == "" && obs.Takes == 1, "a take that went out has nothing to add");
        Check((await fader.DispatchAsync("take", Stopwatch.GetTimestamp())).StartsWith("Preview to Program ignored: a double press") && obs.Takes == 1,
            "a double press says it was ignored");
        await Task.Delay(500); obs.Preview = obs.Program;
        Check((await fader.DispatchAsync("take.cut")).StartsWith("Cut ignored: Preview is the same scene as Program") &&
            obs.Takes == 1 && obs.Transition == "Fondu", "a cut with nothing to take says so and changes nothing");
        obs = new() { TriggerRefusal = new ObsError("TriggerStudioModeTransition", 207, "OBS is not ready") }; fader = new(obs.Call);
        await Blocked(() => fader.DispatchAsync("take"));
        obs.TriggerRefusal = null;
        Check(await fader.DispatchAsync("take", Stopwatch.GetTimestamp()) == "" && obs.Takes == 1, "a take OBS refused sent nothing, so pressing again at once takes");
        obs = new() { LoseTriggerReply = true }; fader = new(obs.Call);
        await Blocked(() => fader.DispatchAsync("take"));
        Check((await fader.DispatchAsync("take", Stopwatch.GetTimestamp())).Contains("double press") && obs.Takes == 1,
            "a take that got no answer may have gone out, so pressing again at once is still a double press");

        // Transition previous / next right after a take or cut: OBS drops a selection while it counts a transition as
        // running, so the choice is sent again until OBS shows it, and the line names what OBS really holds.
        int stingerSends = 0;
        obs = new(); fader = new((action, data) =>
            action == "SetCurrentSceneTransition" && (string?)data?["transitionName"] == "Stinger" && ++stingerSends == 1 ? Task.FromResult(new JsonObject()) : obs.Call(action, data));
        Check(await fader.ChooseTransitionAsync("Fondu", "Stinger") == "Stinger" && obs.Transition == "Stinger" && stingerSends > 1,
            "a choice OBS drops is sent again until OBS shows it");
        obs = new(); fader = new((action, data) => action == "SetCurrentSceneTransition" ? Task.FromResult(new JsonObject()) : obs.Call(action, data)) { SelectPolls = 8 };
        Check(await fader.ChooseTransitionAsync("Fondu", "Stinger") == "Fondu", "a choice OBS never takes reports the transition OBS kept");
        obs = new(); fader = new(obs.Call); await fader.DispatchAsync("take.cut");
        Check(await fader.ChooseTransitionAsync("Fondu", "Coupe") == "Coupe", "Cut can be chosen on purpose right after a cut");
        await Task.Delay(500); await fader.DispatchAsync("take");
        Check(obs.TransitionAtTake == "Coupe" && obs.Transition == "Coupe", "and that choice is the operator's: it is not put back");

        // The game controller's trigger must move the T-bar exactly as it did on main, across its whole travel. The rail zone is
        // written into the contract for step inputs only; the trigger's own rails (PadTbar.Rest and Full) are not applied twice.
        string travel = await TriggerTravelTraceAsync();
        Check(Words(travel) == Words(TriggerTravelOnMain),
            "the trigger path differs from main: " + FirstDifference(travel, TriggerTravelOnMain) + "\nobserved trace:\n" + travel);
    }

    // TriggerTravelTraceAsync as Companion produced it on main (origin/main at 9d164c6), before any rail zone was contracted.
    private const string TriggerTravelOnMain = """
        rise-to-just-below-full-then-release: 1>1/1o 2>2/2o 4>4/4o 5>5/5o 7>7/7o 9>9/9o 10>10/10o 12>12/12o
            13>13/13o 14>14/14o 16>16/16o 17>17/17o 19>19/19o 20>20/20o 22>22/22o 23>23/23o 25>25/25o 26>26/26o
            27>27/27o 28>28/28o 30>30/30o 31>31/31o 32>32/32o 33>33/33o 34>34/34o 36>36/36o 37>37/37o 38>38/38o
            39>39/39o 40>40/40o 42>42/42o 43>43/43o 44>44/44o 45>45/45o 46>46/46o 48>48/48o 49>49/49o 50>50/50o
            51>51/51o 52>52/52o 53>53/53o 54>54/54o 55>55/55o 56>56/56o 58>58/58o 59>59/59o 60>60/60o 61>61/61o
            62>62/62o 63>63/63o 64>64/64o 65>65/65o 66>66/66o 67>67/67o 68>68/68o 70>70/70o 71>71/71o 72>72/72o
            73>73/73o 74>74/74o 75>75/75o 76>76/76o 77>77/77o 78>78/78o 79>79/79o 80>80/80o 81>81/81o 83>83/83o
            84>84/84o 85>85/85o 86>86/86o 87>87/87o 88>88/88o 89>89/89o 90>90/90o 91>91/91o 92>92/92o 93>93/93o
            95>95/95o 96>96/96o 97>97/97o 98>98/98o 99>99/99o 98>98/98o 97>97/97o 96>96/96o 95>95/95o 94>94/94o
            92>92/92o 91>91/91o 90>90/90o 89>89/89o 88>88/88o 87>87/87o 86>86/86o 85>85/85o 84>84/84o 83>83/83o
            82>82/82o 80>80/80o 79>79/79o 78>78/78o 77>77/77o 76>76/76o 75>75/75o 74>74/74o 73>73/73o 72>72/72o
            71>71/71o 70>70/70o 69>69/69o 67>67/67o 66>66/66o 65>65/65o 64>64/64o 63>63/63o 62>62/62o 61>61/61o
            60>60/60o 59>59/59o 58>58/58o 57>57/57o 55>55/55o 54>54/54o 53>53/53o 52>52/52o 51>51/51o 50>50/50o
            49>49/49o 48>48/48o 47>47/47o 45>45/45o 44>44/44o 43>43/43o 42>42/42o 41>41/41o 39>39/39o 38>38/38o
            37>37/37o 36>36/36o 35>35/35o 33>33/33o 32>32/32o 31>31/31o 30>30/30o 29>29/29o 27>27/27o 26>26/26o
            25>25/25o 24>24/24o 22>22/22o 21>21/21o 19>19/19o 18>18/18o 16>16/16o 15>15/15o 13>13/13o 12>12/12o
            10>10/10o 9>9/9o 7>7/7o 6>6/6o 4>4/4o 3>3/3o 1>1/1o 0>0/0i | program=a commits=0 releases=1 slider=0
        full-pull-and-spring-back: 1>1/1o 2>2/2o 4>4/4o 5>5/5o 7>7/7o 9>9/9o 10>10/10o 12>12/12o 13>13/13o
            14>14/14o 16>16/16o 17>17/17o 19>19/19o 20>20/20o 22>22/22o 23>23/23o 25>25/25o 26>26/26o 27>27/27o
            28>28/28o 30>30/30o 31>31/31o 32>32/32o 33>33/33o 34>34/34o 36>36/36o 37>37/37o 38>38/38o 39>39/39o
            40>40/40o 42>42/42o 43>43/43o 44>44/44o 45>45/45o 46>46/46o 48>48/48o 49>49/49o 50>50/50o 51>51/51o
            52>52/52o 53>53/53o 54>54/54o 55>55/55o 56>56/56o 58>58/58o 59>59/59o 60>60/60o 61>61/61o 62>62/62o
            63>63/63o 64>64/64o 65>65/65o 66>66/66o 67>67/67o 68>68/68o 70>70/70o 71>71/71o 72>72/72o 73>73/73o
            74>74/74o 75>75/75o 76>76/76o 77>77/77o 78>78/78o 79>79/79o 80>80/80o 81>81/81o 83>83/83o 84>84/84o
            85>85/85o 86>86/86o 87>87/87o 88>88/88o 89>89/89o 90>90/90o 91>91/91o 92>92/92o 93>93/93o 95>95/95o
            96>96/96o 97>97/97o 98>98/98o 99>99/99o 100>0/0i | program=b commits=1 releases=1 slider=0
        coarse-pull: 10>10/10o 30>30/30o 59>59/59o 85>85/85o 98>98/98o 100>0/0i | program=b commits=1 releases=1
            slider=0
        half-pull-then-pad-lost: 1>1/1o 2>2/2o 4>4/4o 5>5/5o 7>7/7o 9>9/9o 10>10/10o 12>12/12o 13>13/13o
            14>14/14o 16>16/16o 17>17/17o 19>19/19o 20>20/20o 22>22/22o 23>23/23o 25>25/25o 26>26/26o 27>27/27o
            28>28/28o 30>30/30o 31>31/31o 32>32/32o 33>33/33o 34>34/34o 36>36/36o 37>37/37o 38>38/38o 39>39/39o
            40>40/40o 42>42/42o 43>43/43o 44>44/44o 45>45/45o 46>46/46o 48>48/48o 49>49/49o 50>50/50o 0>0/0i |
            program=a commits=0 releases=1 slider=0
        """;
}
