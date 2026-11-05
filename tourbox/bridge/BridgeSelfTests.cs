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
        await desk.Dispatch("preview.previous"); Check(preview == "Three", "wrap to last OBS scene");
        await desk.Dispatch("preview.next"); Check(preview == "One", "wrap to first OBS scene");
        await desk.Dispatch("anchor.1"); Check(preview == "Two" && program == "Three", "anchor cues preview only");
        await desk.Dispatch("preview.sync"); Check(preview == program, "sync preview to program");
        studio = false;
        try { await desk.Dispatch("anchor.1"); throw new Exception("Self-test: anchor changed scene outside Studio Mode"); }
        catch (InvalidOperationException) { }
        await desk.Dispatch("media.play"); Check(media.Single() == "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE", "play toggles a playing source");
    }
}
