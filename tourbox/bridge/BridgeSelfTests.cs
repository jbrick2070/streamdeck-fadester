// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace Fadester.TourBox;

internal static class BridgeSelfTests
{
    // Each tick waits for the production fade loop to finish processing that exact frame.
    // No assertions rely on thread scheduling, JIT speed or sleeping for the expected fade duration.
    private sealed class ManualFade
    {
        private sealed record Frame(double Fraction, TaskCompletionSource Done);
        private readonly Channel<Frame> frames = Channel.CreateUnbounded<Frame>();
        public Task Finished { get; private set; } = Task.CompletedTask;

        public async IAsyncEnumerable<double> Steps([EnumeratorCancellation] CancellationToken stop)
        {
            var finished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            Finished = finished.Task;
            try
            {
                while (true)
                {
                    var frame = await frames.Reader.ReadAsync(stop);
                    try { yield return frame.Fraction; }
                    finally { frame.Done.TrySetResult(); }
                }
            }
            finally { finished.TrySetResult(); }
        }

        public async Task Tick(double fraction)
        {
            var done = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            await frames.Writer.WriteAsync(new(fraction, done));
            await done.Task.WaitAsync(TimeSpan.FromSeconds(4));
        }
    }

    public static async Task RunAsync()
    {
        await MixSelfTests.Run();
        await VisualSidechainMonitor.RunSelfTestsAsync();
        var cfg = new BridgeConfig { MusicInput = "Music", ContentInput = "Clips", MediaInput = "Player", Anchors = ["Two", "", "", ""] };
        var levels = new System.Collections.Concurrent.ConcurrentDictionary<string, double>();
        levels["Music"] = -4; levels["Clips"] = -20;
        string preview = "One", program = "Three";
        bool studio = true;
        var timing = new ManualFade();
        DeskActions? desk = null;
        Action? afterRead = null, beforeSet = null;
        int writes = 0;
        void SetActual(double db) { levels["Music"] = db; desk!.OnVolumeChanged("Music", db); }

        List<string> media = [];
        Task<JsonObject> Fake(string op, JsonObject? args)
        {
            JsonObject reply = new();
            switch (op)
            {
                case "GetInputVolume":
                    reply["inputVolumeDb"] = levels[args!["inputName"]!.GetValue<string>()];
                    var readHook = afterRead; afterRead = null; readHook?.Invoke();
                    break;
                case "SetInputVolume":
                    var hook = beforeSet; beforeSet = null; hook?.Invoke();
                    string name = args!["inputName"]!.GetValue<string>();
                    double value = args["inputVolumeDb"]!.GetValue<double>();
                    levels[name] = value; writes++; desk!.OnVolumeChanged(name, value);
                    break;
                case "GetStudioModeEnabled": reply["studioModeEnabled"] = studio; break;
                case "GetSceneList":
                    reply = new()
                    {
                        ["currentProgramSceneName"] = program,
                        ["currentPreviewSceneName"] = preview,
                        ["scenes"] = new JsonArray(new JsonObject { ["sceneIndex"] = 0, ["sceneName"] = "Three" }, new JsonObject { ["sceneIndex"] = 1, ["sceneName"] = "Two" }, new JsonObject { ["sceneIndex"] = 2, ["sceneName"] = "One" })
                    }; break;
                case "SetCurrentPreviewScene": preview = args!["sceneName"]!.GetValue<string>(); break;
                case "GetMediaInputStatus": reply["mediaState"] = "OBS_MEDIA_STATE_PLAYING"; break;
                case "TriggerMediaInputAction": media.Add(args!["mediaAction"]!.GetValue<string>()); break;
                default: throw new Exception("Unexpected OBS request in offline test: " + op);
            }
            return Task.FromResult(reply);
        }
        desk = new DeskActions(cfg, Fake, timing.Steps);
        static void Check(bool ok, string msg) { if (!ok) throw new Exception("Self-test: " + msg); }
        Check(ActionNames.Of("pad.take") == ActionNames.Of("take") && ActionNames.Of("take.now") == ActionNames.Of("take"),
            "the controller's take ids print as the take, not as internal ids");
        await desk.Dispatch("music.down"); await desk.Dispatch("content.up");
        Check(levels["Music"] == -5 && levels["Clips"] == -19, "independent music/content bindings");
        await desk.Dispatch("music.fineUp"); Check(levels["Music"] == -4.75, "fine detent is quarter normal step");
        await desk.Dispatch("undo"); Check(levels["Music"] == -5, "undo last level");
        await desk.Dispatch("music.up"); await desk.Dispatch("music.up"); await desk.Dispatch("music.fineUp");
        await desk.Dispatch("undo"); Check(levels["Music"] == -5, "undo restores the start of a continuous ride");
        await desk.Dispatch("music.up"); levels["Music"] = -21;
        await desk.Dispatch("undo"); Check(levels["Music"] == -21, "undo never tramples an external fader move");
        SetActual(-5);
        await desk.Dispatch("music.duck"); await desk.Dispatch("music.duck");
        await timing.Tick(0.5);
        Check(levels["Music"] == -8.5, "duck walks through intermediate levels");
        await timing.Tick(1);
        Check(levels["Music"] == -12, "duck reaches its exact ceiling");
        await desk.Dispatch("music.restore"); await timing.Tick(1);
        Check(levels["Music"] == -5, "restore returns to original pre-duck level");

        await desk.Dispatch("music.duck"); await timing.Tick(0.5);
        Task cancelled = timing.Finished;
        await desk.Dispatch("music.up"); await cancelled.WaitAsync(TimeSpan.FromSeconds(4));
        Check(levels["Music"] == -7.5, "hand ride cancels outstanding ramp");

        // A hand adjustment between completed ramp steps must remain untouched.
        await desk.Dispatch("music.duck"); await timing.Tick(0.25);
        SetActual(-30); int before = writes; await timing.Tick(0.5);
        await desk.Dispatch("music.restore"); await desk.Dispatch("undo");
        Check(levels["Music"] == -30 && writes == before, "external edit disarms ramp, restore and undo");

        // An event after OBS takes its read snapshot prevents an otherwise stale next write.
        SetActual(-5); await desk.Dispatch("music.duck"); await timing.Tick(0.25);
        afterRead = () => SetActual(-31); before = writes; await timing.Tick(0.5);
        await desk.Dispatch("music.restore");
        Check(levels["Music"] == -31 && writes == before, "external event arriving during read prevents stale write");

        // A setter already in flight cannot be recalled. It may win once, but never continues to the target.
        SetActual(-5); await desk.Dispatch("music.duck"); await timing.Tick(0.25);
        beforeSet = () => SetActual(-32); before = writes; await timing.Tick(0.5);
        await timing.Finished.WaitAsync(TimeSpan.FromSeconds(4));
        await desk.Dispatch("music.restore"); await desk.Dispatch("undo");
        Check(writes == before + 1 && levels["Music"] == -8.5, "an in-flight overlap stops further writes and disarms stale restore");
        SetActual(-24); await desk.Dispatch("music.duck"); await desk.Dispatch("music.restore");
        Check(levels["Music"] == -24, "duck never raises an already quiet channel");
        // Each connection gets a new desk; the duck crosses the reconnect so Restore still knows where to go back to.
        SetActual(-5); await desk.Dispatch("music.duck"); await timing.Tick(1);
        desk = new DeskActions(cfg, Fake, timing.Steps, resume: desk.Leave());
        await desk.Dispatch("music.restore"); await timing.Tick(1);
        Check(levels["Music"] == -5, "restore after a reconnect returns to the pre-duck level");
        SetActual(-5); await desk.Dispatch("music.duck"); await timing.Tick(1);
        desk = new DeskActions(cfg, Fake, timing.Steps, resume: desk.Leave());
        SetActual(-9); await desk.Dispatch("music.restore");
        Check(levels["Music"] == -9, "a level changed while offline is left alone after a reconnect");
        await desk.Dispatch("preview.previous"); Check(preview == "Three", "wrap to last OBS scene");
        await desk.Dispatch("preview.next"); Check(preview == "One", "wrap to first OBS scene");
        await desk.Dispatch("anchor.1"); Check(preview == "Two" && program == "Three", "anchor cues preview only");
        await desk.Dispatch("preview.sync"); Check(preview == program, "sync preview to program");
        studio = false;
        try { await desk.Dispatch("anchor.1"); throw new Exception("Self-test: anchor changed scene outside Studio Mode"); }
        catch (InvalidOperationException) { }
        await desk.Dispatch("media.play"); Check(media.Single() == "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE", "play toggles a playing source");
        await RunQuantizedTakeTestsAsync();
        await VjsterSelfTests.RunAsync();
    }

    private static async Task RunQuantizedTakeTestsAsync()
    {
        static void Check(bool ok, string msg) { if (!ok) throw new Exception("Quantized take self-test: " + msg); }

        long nowMs = 10_000;
        string programUuid = "uuid-one", previewUuid = "uuid-two";
        int transitionDuration = 300;
        var durationsUsedOnTake = new List<int>();
        int takesTriggered = 0;
        bool vsLoaded = true;

        Task<JsonObject> FakeObs(string op, JsonObject? args)
        {
            var reply = new JsonObject();
            switch (op)
            {
                case "GetVersion":
                    reply["obsVersion"] = "33.0.1";
                    break;
                case "GetStudioModeEnabled":
                    reply["studioModeEnabled"] = true;
                    break;
                case "GetSceneList":
                    reply["currentProgramSceneUuid"] = programUuid;
                    reply["currentPreviewSceneUuid"] = previewUuid;
                    reply["currentProgramSceneName"] = programUuid == "uuid-one" ? "One" : "Two";
                    reply["currentPreviewSceneName"] = previewUuid == "uuid-one" ? "One" : "Two";
                    break;
                case "GetCurrentProgramScene":
                    reply["sceneUuid"] = programUuid;
                    break;
                case "GetCurrentSceneTransitionCursor":
                    reply["transitionCursor"] = 0.0;
                    break;
                case "GetCurrentSceneTransition":
                    reply["transitionName"] = "Fade";
                    reply["transitionKind"] = "fade_transition";
                    reply["transitionFixed"] = false;
                    reply["transitionDuration"] = transitionDuration;
                    break;
                case "GetSceneSceneTransitionOverride":
                    reply["transitionName"] = null;
                    reply["transitionDuration"] = null;
                    break;
                case "SetCurrentSceneTransitionDuration":
                    transitionDuration = args!["transitionDuration"]!.GetValue<int>();
                    break;
                case "TriggerStudioModeTransition":
                    takesTriggered++;
                    durationsUsedOnTake.Add(transitionDuration);
                    (programUuid, previewUuid) = (previewUuid, programUuid);
                    break;
                case "CallVendorRequest":
                    if (!vsLoaded) throw new ObsError("CallVendorRequest", 600, "No vendor");
                    reply["responseData"] = new JsonObject
                    {
                        ["api_version"] = 1,
                        ["version"] = "0.5.0",
                        ["audio_present"] = true,
                        ["bpm"] = 120.0,
                        ["bpm_locked"] = true,
                        ["beat_phase"] = 0.5,
                        ["beat_index"] = 1,
                        ["bar_phase"] = 0.25,
                        ["bar_index"] = 4,
                        ["beat_confidence"] = 0.9,
                        ["panic"] = false
                    };
                    break;
                default:
                    throw new Exception("Unexpected OBS request in quantized take self-test: " + op);
            }
            return Task.FromResult(reply);
        }

        // 1. Saved config defaults: immediate take using OBS's own 300 ms duration, no NO TEMPO.
        var plainCfg = new BridgeConfig();
        var plainDesk = new DeskActions(plainCfg, FakeObs, clockMs: () => nowMs);
        string plainLine = await plainDesk.Dispatch("take");
        Check(takesTriggered == 1 && durationsUsedOnTake[^1] == 300 && !plainLine.Contains("NO TEMPO"),
            "default take uses OBS duration without NO TEMPO");

        // 2. 120 BPM locked, 4 beats, start now -> 2000 ms fade and restores 300 ms afterwards.
        using var vs = new VisualSidechainMonitor(FakeObs, clockMs: () => nowMs, enableBackgroundTick: false);
        await vs.StartAsync();
        var statusLines = new List<string>();
        TaskCompletionSource<bool>? pendingDelay = null;
        int recordedDelayMs = 0;
        Task FakeDelay(int ms, CancellationToken ct)
        {
            recordedDelayMs = ms;
            var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            ct.Register(() => tcs.TrySetCanceled(ct));
            pendingDelay = tcs;
            return tcs.Task;
        }

        var quantCfg = new BridgeConfig { TakeBeats = 4, TakeQuantize = "now", TakeFallbackMs = 650 };
        var quantDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, onStatus: statusLines.Add, clockMs: () => nowMs, delayAsync: FakeDelay);

        // Signal events alone never trigger a take.
        vs.OnVendorEvent(VisualSidechainMonitor.VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["bpm"] = 120.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.0, ["beat_index"] = 0, ["bar_phase"] = 0.0, ["bar_index"] = 5, ["beat_confidence"] = 0.95
        });
        Check(takesTriggered == 1, "audio signal events never originate a Program change");

        string beatLine = await quantDesk.Dispatch("take");
        Check(takesTriggered == 2 && durationsUsedOnTake[^1] == 2000 && transitionDuration == 300 && !beatLine.Contains("NO TEMPO"),
            "4-beat take at 120 BPM runs at 2000 ms and restores 300 ms");

        // 3. Fallback branches: audio_present=false, low confidence when unlocked, and missing VS -> immediate fallback + NO TEMPO.
        vs.OnVendorEvent(VisualSidechainMonitor.VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = false, ["bpm"] = 120.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.2, ["beat_index"] = 0, ["bar_phase"] = 0.05, ["bar_index"] = 5, ["beat_confidence"] = 0.9
        });
        quantCfg.TakeQuantize = "next_bar";
        var noAudioDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, clockMs: () => nowMs, delayAsync: FakeDelay);
        string noAudioLine = await noAudioDesk.Dispatch("take");
        Check(takesTriggered == 3 && durationsUsedOnTake[^1] == 650 && transitionDuration == 300 && noAudioLine.EndsWith(" · NO TEMPO", StringComparison.Ordinal),
            "audio_present=false fires immediately with fallback ms and shows NO TEMPO");

        vs.OnVendorEvent(VisualSidechainMonitor.VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["bpm"] = 120.0, ["bpm_locked"] = false,
            ["beat_phase"] = 0.2, ["beat_index"] = 0, ["bar_phase"] = 0.25, ["bar_index"] = 5, ["beat_confidence"] = 0.15
        });
        var lowConfDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, clockMs: () => nowMs, delayAsync: FakeDelay);
        string lowConfLine = await lowConfDesk.Dispatch("take");
        Check(takesTriggered == 4 && durationsUsedOnTake[^1] == 650 && lowConfLine.EndsWith(" · NO TEMPO", StringComparison.Ordinal),
            "low confidence with unlocked tempo fires immediately with fallback ms and shows NO TEMPO");

        vsLoaded = false;
        using var vsMissing = new VisualSidechainMonitor(FakeObs, clockMs: () => nowMs, enableBackgroundTick: false);
        await vsMissing.StartAsync();
        var missingDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vsMissing, clockMs: () => nowMs, delayAsync: FakeDelay);
        string missingLine = await missingDesk.Dispatch("take");
        Check(takesTriggered == 5 && durationsUsedOnTake[^1] == 650 && missingLine.EndsWith(" · NO TEMPO", StringComparison.Ordinal),
            "missing Visual Sidechain fires immediately with fallback ms and shows NO TEMPO");
        vsLoaded = true;

        // 4. Low confidence WITH bpm_locked=true still quantizes cleanly.
        vs.OnVendorEvent(VisualSidechainMonitor.VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["bpm"] = 120.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.0, ["beat_index"] = 1, ["bar_phase"] = 0.25, ["bar_index"] = 6, ["beat_confidence"] = 0.10
        });
        var armedDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, onStatus: statusLines.Add, clockMs: () => nowMs, delayAsync: FakeDelay);
        string armedLine = await armedDesk.Dispatch("take");
        Check(armedLine.EndsWith(" · ARMED", StringComparison.Ordinal) && armedDesk.IsTakeArmed && recordedDelayMs == 1500 && takesTriggered == 5,
            "next_bar at 120 BPM bar_phase=0.25 arms for 1500 ms");
        pendingDelay!.SetResult(true);
        for (int i = 0; i < 40 && takesTriggered < 6; i++) await Task.Delay(5);
        Check(takesTriggered == 6 && durationsUsedOnTake[^1] == 2000 && !armedDesk.IsTakeArmed && statusLines.Count == 1,
            "armed take fires at bar boundary with 2000 ms duration");

        // 5. Second press while ARMED fires immediately.
        var secondPressDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, clockMs: () => nowMs, delayAsync: FakeDelay);
        await secondPressDesk.Dispatch("take");
        Check(secondPressDesk.IsTakeArmed && takesTriggered == 6, "armed before second press");
        string firedNow = await secondPressDesk.Dispatch("take");
        Check(!secondPressDesk.IsTakeArmed && takesTriggered == 7 && durationsUsedOnTake[^1] == 2000 && !firedNow.Contains("ARMED"),
            "second press while ARMED fires immediately");

        // 6. fader.cancel while ARMED cancels visibly without firing.
        var cancelDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, clockMs: () => nowMs, delayAsync: FakeDelay);
        await cancelDesk.Dispatch("take");
        string cancelled = await cancelDesk.Dispatch("fader.cancel");
        Check(!cancelDesk.IsTakeArmed && takesTriggered == 7 && cancelled.EndsWith(" · CANCELLED", StringComparison.Ordinal),
            "fader.cancel while ARMED cancels visibly without firing");

        // 7. 4 s cap: at 60 BPM (1 bar = 4000 ms, bar_phase = 0.0), wait is capped at <= 4000 ms.
        vs.OnVendorEvent(VisualSidechainMonitor.VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["bpm"] = 60.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.0, ["beat_index"] = 0, ["bar_phase"] = 0.0, ["bar_index"] = 7, ["beat_confidence"] = 0.95
        });
        var capDesk = new DeskActions(quantCfg, FakeObs, vsMonitor: vs, clockMs: () => nowMs, delayAsync: FakeDelay);
        await capDesk.Dispatch("take");
        Check(capDesk.IsTakeArmed && recordedDelayMs == 4000, "next_bar wait at 60 BPM is capped at 4000 ms");
        await capDesk.Dispatch("fader.cancel");
    }
}
