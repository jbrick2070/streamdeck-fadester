// SPDX-License-Identifier: GPL-2.0-or-later
// Compiled by live-obs.py together with the shipping StudioFader and WebSocket client.
using System.Diagnostics;
using System.Text.Json.Nodes;
using Fadester.TourBox;

internal static class LiveObs
{
    static async Task Main(string[] args)
    {
        if (args.Length != 4) throw new ArgumentException("Needs private fixture port, directory, owned PID and scene token.");
        var port = int.Parse(args[0]);
        var root = Path.GetFullPath(args[1]);
        var proc = Process.GetProcessById(int.Parse(args[2]));
        var name = args[3];
        if (!Directory.Exists(root) || !Path.GetFileName(root).StartsWith("fadester-obs-lab-") ||
            !string.Equals(proc.MainModule?.FileName, Path.Combine(root, "bin", "64bit", "obs64.exe"), StringComparison.OrdinalIgnoreCase) ||
            port < 10240 || string.IsNullOrEmpty(Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD")))
            throw new InvalidOperationException("Not the expected isolated OBS process.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(1));
        using var ws = await ObsConnection.Connect(new BridgeConfig { Host = "127.0.0.1", Port = port }, timeout.Token);
        var version = (string?)(await ws.Call("GetVersion"))["obsVersion"];
        var collection = (string?)(await ws.Call("GetSceneCollectionList"))["currentSceneCollectionName"];
        var scenes = await ws.Call("GetSceneList");
        var blue = $"{name} Blue";
        var amber = $"{name} Amber";
        if (version != "33.0.1" || collection != name || scenes["scenes"]!.AsArray().Count != 2 ||
            !new HashSet<string?> { blue, amber }.SetEquals(scenes["scenes"]!.AsArray().Select(s => (string?)s!["sceneName"])) ||
            (await ws.Call("GetInputList"))["inputs"]!.AsArray().Count != 0 ||
            (bool?)(await ws.Call("GetStreamStatus"))["outputActive"] != false ||
            (bool?)(await ws.Call("GetRecordStatus"))["outputActive"] != false)
            throw new InvalidOperationException("Unexpected OBS version, outputs, inputs or scene collection. No writes sent.");
        Console.WriteLine($"Verified OBS {version}: isolated PID, port, collection, and two empty scenes; all outputs idle.");
        foreach (var (scene, label, color) in new[] { (blue, "Blue", 0xFFFF0000L), (amber, "Amber", 0xFF0099FFL) })
            await ws.Call("CreateInput", new() {
                ["sceneName"] = scene, ["inputName"] = name + " " + label + " Solid", ["inputKind"] = "color_source_v3",
                ["inputSettings"] = new JsonObject { ["color"] = color, ["width"] = 640, ["height"] = 360 }, ["sceneItemEnabled"] = true
            });
        await ws.Call("SetStudioModeEnabled", new() { ["studioModeEnabled"] = true });
        await ws.Call("SetCurrentSceneTransition", new() { ["transitionName"] = "Fade" });
        // Studio Mode's initial UI setup can queue a Preview reset. Let it finish before
        // asserting the synthetic test setup; never start a hardware sweep against identical scenes.
        async Task CueFixture(string target)
        {
            for (int i = 0; i < 15; i++)
            {
                await ws.Call("SetCurrentPreviewScene", new() { ["sceneName"] = target });
                await Task.Delay(100);
                if ((string?)(await ws.Call("GetSceneList"))["currentPreviewSceneName"] == target) return;
            }
            throw new InvalidOperationException("OBS did not cue the disposable scene.");
        }
        await CueFixture(amber);
        using var native = new NativeTBar(port);
        async Task Sample(string stage, string? program, string? preview, double? mixed = null)
        {
            var pair = await ws.Call("GetSceneList");
            var pgm = (string?)pair["currentProgramSceneName"];
            var prv = (string?)pair["currentPreviewSceneName"];
            if ((bool?)(await ws.Call("GetStudioModeEnabled"))["studioModeEnabled"] != true)
                throw new InvalidOperationException($"{stage}: Studio Mode was not restored.");
            async Task<double> Cursor() => (double)(await ws.Call("GetCurrentSceneTransitionCursor"))["transitionCursor"]!;
            var cur = await Cursor();
            // OBS eases its rendered cursor toward the slider position over several video frames.
            if (mixed is double wanted)
                for (int n = 0; n < 36 && Math.Abs(cur - wanted) > 0.012; n++) { await Task.Delay(35); cur = await Cursor(); }
            int handle = await native.ReadAsync();
            Console.WriteLine($"{stage}: Program={pgm?.Replace(name + " ", "")}, Preview={prv?.Replace(name + " ", "")}, cursor={cur:F4}, visible handle={handle}/1023");
            if (Math.Abs(handle - (mixed ?? 0) * 1023) > 1) throw new InvalidOperationException($"{stage}: OBS's native handle did not track the dial.");
            if ((program != null && pgm != program) || (preview != null && prv != preview) ||
                (mixed is double pos ? Math.Abs(cur - pos) > 0.04 : cur is not (0 or 1)))
                throw new InvalidOperationException($"{stage}: OBS readback differs from expectation.");
            if (program != null)
            {
                var shot = await ws.Call("GetSourceScreenshot", new() {
                    ["sourceName"] = pgm, ["imageFormat"] = "png", ["imageWidth"] = 32, ["imageHeight"] = 18
                });
                var encoded = (string)shot["imageData"]!;
                File.WriteAllBytes(Path.Combine(root, stage + ".png"), Convert.FromBase64String(encoded[(encoded.IndexOf(',') + 1)..]));
            }
        }
        await Sample("initial", blue, amber);
        // Exercise the default twenty hardware ticks per throw against the native control.
        var fader = new StudioFader(ws.Call, 0.05, nativeMove: native.MoveAsync);
        async Task Burst(string action, int ticks)
        {
            var watch = Stopwatch.StartNew();
            await Task.WhenAll(Enumerable.Range(0, ticks).Select(_ => fader.DispatchAsync(action)));
            Console.WriteLine($"{ticks} queued {action} completed in {watch.ElapsedMilliseconds} ms.");
        }
        await Burst("fader.forward", 10);
        await Task.Delay(100);
        await Sample("half", null, amber, 0.5);
        await fader.CancelAsync();
        await Task.Delay(100);
        await Sample("cancelled", blue, amber);
        await Burst("fader.forward", 20);
        await Task.Delay(200);
        await Sample("forward", amber, blue);
        await Burst("fader.back", 20);
        await Task.Delay(200);
        await Sample("return", blue, amber);
        // After the endpoint debounce, perform the sequence that failed on the physical controller:
        // a one-button Cut while Fade is selected, followed immediately by another manual mix.
        await Task.Delay(500);
        await fader.DispatchAsync("take.cut");
        var afterCut = await ws.Call("GetCurrentSceneTransition");
        if ((string?)afterCut["transitionName"] != "Fade")
            throw new InvalidOperationException("Cut did not return the OBS selector to Fade.");
        await Sample("cut", amber, null);
        await CueFixture(blue);
        await Burst("fader.forward", 10);
        await Sample("post-cut-mix", null, blue, 0.5);
        await fader.CancelAsync();
        Console.WriteLine("PASS: cancel, full rail, return rail, Cut restoring Fade, and the next manual mix; no hotkeys registered.");
    }
}
