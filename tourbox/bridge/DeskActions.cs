// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal sealed class DeskActions(BridgeConfig cfg, Func<string, JsonObject?, Task<JsonObject>> rpc,
    Func<CancellationToken, IAsyncEnumerable<double>>? rampSteps = null, Func<double, double, Task>? nativeMove = null)
{
    public static readonly HashSet<string> Supported = new(("music.down music.up music.fineDown music.fineUp content.down content.up music.duck music.restore undo " +
        "fader.back fader.forward fader.fineBack fader.fineForward fader.cancel fader.status take take.cut preview.previous preview.next preview.sync preview.status anchor.1 anchor.2 anchor.3 anchor.4 " +
        "media.previous media.next media.play media.restart overlay.show overlay.hide mic.mute transition.previous transition.next " +
        "transition.shorter transition.longer capture.screenshot recording.chapter replay.save recording.status bridge.reconnect soundcheck " +
        "mix.up mix.down mix.fadeOut mix.restore mix.status").Split(' '));
    private readonly StudioFader fader = new(rpc, cfg.FaderStep, nativeMove);
    private readonly AudioDesk audio = new(rpc, rampSteps);
    private readonly MixDesk mix = new(cfg, rpc);
    public bool MixEnabled => cfg.MixEnabled;
    public double MixDb => mix.Db;
    public Task<JsonObject> MixStatusAsync() => mix.Status();
    public Task<string> SetMixAsync(double db, int durationMs) => mix.Set(db, durationMs);
    public Task<string> StepMixAsync(int signedSteps) => mix.Step(signedSteps);
    public void StartMixMonitor() => mix.StartMonitor();
    public void OnMixInputLevelChanged(Guid id, double level) => mix.OnVolume(id, level);
    public Task StopMixAsync() => mix.Stop();
    public void OnVolumeChanged(string source, double level) => audio.OnVolumeChanged(source, level);
    public Task StopAudioAsync() => Task.WhenAll(audio.Stop(), mix.Stop());
    private static string Bound(string? value, string field) => !string.IsNullOrWhiteSpace(value) ? value : throw new InvalidOperationException($"Set {field} in the control panel first.");
    private Task<JsonObject> Get(string name) => rpc(name, null);
    private static string Str(JsonObject obj, string field) => obj[field]?.GetValue<string>() ?? throw new InvalidDataException($"OBS did not return {field}.");
    public async Task CancelOwnedAsync() { if (fader.Position > 0) await fader.CancelAsync(); }

    public async Task<string> Dispatch(string id)
    {
        if (!Supported.Contains(id)) throw new ArgumentException("Unknown action: " + id);
        switch (id)
        {
            case "mix.up": return await StepMixAsync(1);
            case "mix.down": return await StepMixAsync(-1);
            case "mix.fadeOut": return await SetMixAsync(-100, cfg.MixFadeMs);
            case "mix.restore": return await SetMixAsync(0, cfg.MixFadeMs);
            case "mix.status": return await mix.Describe();
            case "music.up":
            case "music.down":
            case "music.fineDown":
            case "music.fineUp":
            case "content.up":
            case "content.down":
                var input = id.StartsWith("music") ? Bound(cfg.MusicInput, "music input") : Bound(cfg.ContentInput, "content input");
                double step = cfg.VolumeStepDb * (id.Contains(".fine") ? 0.25 : 1);
                return await audio.Ride(input, id.EndsWith("up", StringComparison.OrdinalIgnoreCase) ? step : -step);
            case "music.duck":
            case "music.restore":
                return await audio.Fade(Bound(cfg.MusicInput, "music input"), cfg.DuckDb, id == "music.restore");
            case "undo":
                return await audio.Undo();
            case "fader.back":
            case "fader.forward":
            case "fader.fineBack":
            case "fader.fineForward":
            case "fader.cancel":
            case "take":
            case "take.cut":
                await fader.DispatchAsync(id); return $"{id} · T-bar {fader.Position:P0}";
            case "fader.status":
                {
                    bool enabled = (await Get("GetStudioModeEnabled"))["studioModeEnabled"]!.GetValue<bool>();
                    return enabled && fader.Position > 0 ? $"Studio Mode · Bridge T-bar {fader.Position:P0}" : $"Studio Mode {(enabled ? "on" : "off")} · No bridge-owned manual fade";
                }
            case "preview.status":
                {
                    var state = await Get("GetSceneList");
                    return $"Program: {Str(state, "currentProgramSceneName")} | Preview: {state["currentPreviewSceneName"]?.GetValue<string>() ?? "(Studio Mode off)"}";
                }
            case "preview.previous":
            case "preview.next":
            case "preview.sync":
            case "anchor.1":
            case "anchor.2":
            case "anchor.3":
            case "anchor.4":
                return await Cue(id);
            case "media.previous":
            case "media.next":
            case "media.play":
            case "media.restart":
                return await Media(id);
            case "mic.mute":
                input = Bound(cfg.MicInput, "microphone input"); await rpc("SetInputMute", new() { ["inputName"] = input, ["inputMuted"] = true }); return "Muted " + input;
            case "overlay.show":
            case "overlay.hide":
                return await Overlay(id.EndsWith(".show"));
            case "transition.previous":
            case "transition.next":
            case "transition.shorter":
            case "transition.longer":
                return await Transition(id);
            case "replay.save":
                if (!(await Get("GetReplayBufferStatus"))["outputActive"]!.GetValue<bool>()) return "Replay buffer is stopped.";
                await Get("SaveReplayBuffer"); return "Requested replay save.";
            case "recording.chapter":
                if (!(await Get("GetRecordStatus"))["outputActive"]!.GetValue<bool>()) return "Recording is stopped.";
                await Get("CreateRecordChapter"); return "Added recording chapter.";
            case "recording.status":
                {
                    var r = await Get("GetRecordStatus"); return r["outputActive"]!.GetValue<bool>() ? $"Recording {r["outputTimecode"]}" : "Recording is stopped.";
                }
            case "capture.screenshot":
                {
                    var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Fadester TourBox");
                    Directory.CreateDirectory(folder);
                    var file = Path.Combine(folder, $"Program-{DateTime.Now:yyyyMMdd-HHmmss-fff}-{Guid.NewGuid().ToString("N")[..6]}.png");
                    var scene = Str(await Get("GetCurrentProgramScene"), "currentProgramSceneName");
                    await rpc("SaveSourceScreenshot", new() { ["sourceName"] = scene, ["imageFormat"] = "png", ["imageFilePath"] = file });
                    return "Saved " + file;
                }
            case "soundcheck":
                {
                    var meters = new List<string>();
                    foreach (var source in new[] { cfg.MusicInput, cfg.ContentInput, cfg.MicInput }.Where(s => !string.IsNullOrWhiteSpace(s)).Distinct())
                    {
                        var level = await audio.Read(source);
                        bool muted = (await rpc("GetInputMute", new() { ["inputName"] = source }))["inputMuted"]!.GetValue<bool>();
                        meters.Add($"{source}: {level:F1} dB{(muted ? " muted" : "")}");
                    }
                    return meters.Count > 0 ? string.Join(" | ", meters) : "No audio inputs configured.";
                }
            default: throw new InvalidOperationException("Reconnect is handled by the connection manager.");
        }
    }
    private async Task<string> Cue(string id)
    {
        if (!(await Get("GetStudioModeEnabled"))["studioModeEnabled"]!.GetValue<bool>()) throw new InvalidOperationException("Enable Studio Mode to cue Preview; Program was not changed.");
        string? anchor = id.StartsWith("anchor.") ? Bound(cfg.Anchors[id[^1] - '1'], "anchor " + id[^1]) : null;
        // OBS may report the destination as Program during a manual sweep. Cancel before reading either scene.
        await CancelOwnedAsync();
        var list = await Get("GetSceneList");
        var scenes = list["scenes"]!.AsArray().Select(n => n!.AsObject()).OrderByDescending(n => n["sceneIndex"]!.GetValue<int>()).Select(n => Str(n, "sceneName")).ToList();
        string preview = Str(list, "currentPreviewSceneName");
        string target;
        if (anchor != null) target = anchor;
        else if (id == "preview.sync") target = Str(list, "currentProgramSceneName");
        else
        {
            int index = scenes.IndexOf(preview);
            if (index < 0 || scenes.Count == 0) throw new InvalidOperationException("Current Preview is missing from the OBS scene list.");
            target = scenes[(index + (id == "preview.next" ? 1 : -1) + scenes.Count) % scenes.Count];
        }
        if (!scenes.Contains(target)) throw new InvalidOperationException("Configured scene is missing: " + target);
        if (target != preview) await rpc("SetCurrentPreviewScene", new() { ["sceneName"] = target });
        return "Preview: " + target;
    }
    private async Task<string> Media(string id)
    {
        var name = Bound(cfg.MediaInput, "media input");
        var command = id.Split('.')[1].ToUpperInvariant();
        if (command == "PLAY")
        {
            var state = Str(await rpc("GetMediaInputStatus", new() { ["inputName"] = name }), "mediaState");
            if (state == "OBS_MEDIA_STATE_PLAYING") command = "PAUSE";
        }
        await rpc("TriggerMediaInputAction", new() { ["inputName"] = name, ["mediaAction"] = "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_" + command });
        return name + ": " + command.ToLowerInvariant();
    }
    private async Task<string> Overlay(bool visible)
    {
        var scene = Bound(cfg.OverlayScene, "overlay scene"); var source = Bound(cfg.OverlaySource, "overlay source");
        var rows = (await rpc("GetSceneItemList", new() { ["sceneName"] = scene }))["sceneItems"]!.AsArray()
            .Where(n => n?["sourceName"]?.GetValue<string>() == source).ToArray();
        if (rows.Length != 1) throw new InvalidOperationException($"Expected exactly one {source} in {scene}; found {rows.Length}.");
        await rpc("SetSceneItemEnabled", new() { ["sceneName"] = scene, ["sceneItemId"] = rows[0]!["sceneItemId"]!.GetValue<int>(), ["sceneItemEnabled"] = visible });
        return $"{source} {(visible ? "shown" : "hidden")} in {scene}";
    }
    private async Task<string> Transition(string id)
    {
        if (fader.Position > 0) throw new InvalidOperationException("Finish or cancel the T-bar before changing the transition.");
        var current = await Get("GetCurrentSceneTransition");
        if (id is "transition.shorter" or "transition.longer")
        {
            if (current["transitionFixed"]?.GetValue<bool>() == true) throw new InvalidOperationException("Current transition has a fixed duration.");
            int duration = Math.Clamp(current["transitionDuration"]!.GetValue<int>() + (id.EndsWith("longer") ? cfg.TransitionStepMs : -cfg.TransitionStepMs), 50, 20000);
            await rpc("SetCurrentSceneTransitionDuration", new() { ["transitionDuration"] = duration }); return $"Transition: {duration} ms";
        }
        var choices = (await Get("GetSceneTransitionList"))["transitions"]!.AsArray().Select(n => n!["transitionName"]!.GetValue<string>()).ToList();
        int i = choices.IndexOf(Str(current, "transitionName"));
        if (i < 0 || choices.Count == 0) throw new InvalidOperationException("Current transition missing from OBS list.");
        var name = choices[(i + (id.EndsWith("next") ? 1 : -1) + choices.Count) % choices.Count];
        await rpc("SetCurrentSceneTransition", new() { ["transitionName"] = name }); return "Transition: " + name;
    }

    public async Task<JsonObject> Catalog()
    {
        var studio = await Get("GetStudioModeEnabled"); var list = await Get("GetSceneList");
        var sources = (await Get("GetInputList"))["inputs"]!.AsArray();
        var audio = new JsonArray(); var media = new JsonArray(); var sceneItems = new JsonObject(); var scenes = new JsonArray();
        foreach (var entry in sources)
        {
            var source = entry!["inputName"]!.GetValue<string>();
            try { await rpc("GetInputVolume", new() { ["inputName"] = source }); audio.Add(source); } catch (ObsError e) when (e.Code is 600 or 602 or 604 or 605 or 606) { }
            try
            {
                // OBS 33 also returns success with NONE for text, color, image and other non-media sources.
                var status = await rpc("GetMediaInputStatus", new() { ["inputName"] = source });
                var kind = entry["inputKind"]?.GetValue<string>();
                if ((status["mediaState"]?.GetValue<string>() is string state && state != "OBS_MEDIA_STATE_NONE") ||
                    kind is "ffmpeg_source" or "vlc_source" or "obs_playlister_source") media.Add(source);
            }
            catch (ObsError e) when (e.Code is 600 or 602 or 604 or 605 or 606) { }
        }
        foreach (var row in list["scenes"]!.AsArray().OrderByDescending(n => n!["sceneIndex"]!.GetValue<int>()))
        {
            var name = row!["sceneName"]!.GetValue<string>(); scenes.Add(name);
            var items = (await rpc("GetSceneItemList", new() { ["sceneName"] = name }))["sceneItems"]!.AsArray();
            sceneItems[name] = new JsonArray(items.Select(n => JsonValue.Create(n!["sourceName"]!.GetValue<string>())).ToArray());
        }
        var transitions = (await Get("GetSceneTransitionList"))["transitions"]!.AsArray();
        return new()
        {
            ["studioMode"] = studio["studioModeEnabled"]?.DeepClone(),
            ["program"] = list["currentProgramSceneName"]?.DeepClone(),
            ["preview"] = list["currentPreviewSceneName"]?.DeepClone(),
            ["scenes"] = scenes,
            ["audioInputs"] = audio,
            ["mediaInputs"] = media,
            ["sceneItems"] = sceneItems,
            ["transitions"] = new JsonArray(transitions.Select(n => JsonValue.Create(n!["transitionName"]!.GetValue<string>())).ToArray()),
            ["streamActive"] = (await Get("GetStreamStatus"))["outputActive"]?.DeepClone(),
            ["recordActive"] = (await Get("GetRecordStatus"))["outputActive"]?.DeepClone()
        };
    }
}
