// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal sealed class DeskActions(BridgeConfig cfg, Func<string, JsonObject?, Task<JsonObject>> rpc,
    Func<CancellationToken, IAsyncEnumerable<double>>? rampSteps = null, Func<double, double, Task>? nativeMove = null,
    DeskActions.Memory? resume = null)
{
    /// <summary>What one connection's desk hands to the next: see StudioFader.Memory and AudioDesk.Leave.</summary>
    public sealed record Memory(StudioFader.Memory Fader, AudioDesk.Duck? Duck);
    public Memory Leave() => new(fader.Leave(), audio.Leave());
    public Task<string> ResumeAsync() => fader.ResumeAsync();
    public static readonly HashSet<string> Supported = new(("music.down music.up music.fineDown music.fineUp content.down content.up music.duck music.restore undo " +
        "fader.back fader.forward fader.fineBack fader.fineForward fader.cancel fader.status take take.cut preview.previous preview.next preview.sync preview.status anchor.1 anchor.2 anchor.3 anchor.4 " +
        "media.previous media.next media.play media.restart overlay.show overlay.hide mic.mute transition.previous transition.next " +
        "transition.shorter transition.longer capture.screenshot recording.chapter replay.save recording.status bridge.reconnect soundcheck " +
        "mix.up mix.down mix.fadeOut mix.restore mix.status " +
        "layer2.opacity.down layer2.opacity.up layer1.blend.previous layer1.blend.next layer1.blend.reset layer2.blend.previous layer2.blend.next layer2.blend.reset " +
        "vjster.speed.down vjster.speed.up vjster.speed.fineDown vjster.speed.fineUp vjster.speed.reset vjster.quality.down vjster.quality.up vjster.quality.reset vjster.playPause vjster.status").Split(' '));
    /** OBS scene-item blend modes in the order the Layer rotaries cycle them (obs-websocket SetSceneItemBlendMode). */
    public static readonly string[] BlendModes = ["OBS_BLEND_NORMAL", "OBS_BLEND_ADDITIVE", "OBS_BLEND_SUBTRACT", "OBS_BLEND_SCREEN", "OBS_BLEND_MULTIPLY", "OBS_BLEND_LIGHTEN", "OBS_BLEND_DARKEN"];
    public const string OpacityFilterName = "Fadester opacity";
    private readonly StudioFader fader = new(rpc, cfg.FaderStep, nativeMove, resume?.Fader);
    private readonly AudioDesk audio = new(rpc, rampSteps, resume?.Duck);
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
    public Task SettleAsync() => fader.SettleAsync();

    /** The game controller's trigger T-bar. Only a take or a cancel is worth a log line; a throw in progress is quiet. */
    public async Task<string> TbarTo(double target)
    {
        bool moving = fader.Position > 0;
        if (!await fader.MoveToAsync(target)) return "Controller T-bar: ignored a second take right after the last one";
        return target >= 1 ? "Controller T-bar: take" : target <= 0 && moving ? "Controller T-bar: back to Program" : "";
    }

    /// <param name="pressedAt">When the control was pressed (a Stopwatch timestamp), if known; see StudioFader.DispatchAsync.</param>
    public async Task<string> Dispatch(string id, long pressedAt = 0)
    {
        if (!Supported.Contains(id)) throw new ArgumentException("Unknown action: " + id);
        if (id.StartsWith("vjster.")) throw new InvalidOperationException("VJster actions go to the Chrome extension, not to OBS; they run on the VJster desk.");
        switch (id)
        {
            case "layer2.opacity.down":
            case "layer2.opacity.up":
                return await Opacity(id);
            case "layer1.blend.previous":
            case "layer1.blend.next":
            case "layer1.blend.reset":
            case "layer2.blend.previous":
            case "layer2.blend.next":
            case "layer2.blend.reset":
                return await Blend(id);
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
                await fader.DispatchAsync(id, pressedAt); return $"{id} · T-bar {fader.Position:P0}";
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
    /** The scene item a Layer action drives: scene and source from the panel's Assignments. */
    private (string Scene, string Source, string Label) Layer(string id)
    {
        bool two = id.StartsWith("layer2");
        var scene = Bound(two ? cfg.Layer2Scene : cfg.Layer1Scene, two ? "layer 2 scene" : "layer 1 scene");
        var source = Bound(two ? cfg.Layer2Source : cfg.Layer1Source, two ? "layer 2 source" : "layer 1 source");
        return (scene, source, two ? "Layer 2" : "Layer 1");
    }
    /** The one scene item a layer names. None or several is an error, so a layer never acts on the wrong copy or on a source that left the scene. */
    private async Task<(string Scene, string Source, string Label, int Item)> LayerItem(string id)
    {
        var (scene, source, label) = Layer(id);
        var rows = (await rpc("GetSceneItemList", new() { ["sceneName"] = scene }))["sceneItems"]!.AsArray()
            .Where(n => n?["sourceName"]?.GetValue<string>() == source).ToArray();
        if (rows.Length != 1) throw new InvalidOperationException($"{label}: expected exactly one {source} in {scene}; found {rows.Length}.");
        return (scene, source, label, rows[0]!["sceneItemId"]!.GetValue<int>());
    }
    private async Task<string> Blend(string id)
    {
        var (scene, _, label, item) = await LayerItem(id);
        var current = Str(await rpc("GetSceneItemBlendMode", new() { ["sceneName"] = scene, ["sceneItemId"] = item }), "sceneItemBlendMode");
        int i = Array.IndexOf(BlendModes, current);
        string next = id.EndsWith(".reset") ? BlendModes[0] : BlendModes[(Math.Max(i, 0) + (id.EndsWith(".next") ? 1 : -1) + BlendModes.Length) % BlendModes.Length];
        await rpc("SetSceneItemBlendMode", new() { ["sceneName"] = scene, ["sceneItemId"] = item, ["sceneItemBlendMode"] = next });
        return $"{label} blend: {BlendName(next)}";
    }
    public static string BlendName(string mode) => mode.StartsWith("OBS_BLEND_") ? char.ToUpperInvariant(mode[10]) + mode[11..].ToLowerInvariant() : mode;
    /**
     * Opacity rides the source's Color Correction filter: the first one it has, else a new one named OpacityFilterName
     * at the end of the chain. color_filter_v2 takes 0..1, the legacy color_filter 0..100. `overlay` keeps its other
     * settings. A disabled filter is reported, not switched on (that could change the look someone set up). The filter
     * belongs to the source, so it also applies wherever else that source appears, Program included.
     */
    private async Task<string> Opacity(string id)
    {
        var (_, source, label, _) = await LayerItem(id);
        var filters = (await rpc("GetSourceFilterList", new() { ["sourceName"] = source }))["filters"]!.AsArray().Select(n => n!.AsObject());
        var color = filters.FirstOrDefault(f => f["filterKind"]?.GetValue<string>() is "color_filter_v2" or "color_filter");
        string name, kind;
        if (color == null)
        {
            name = OpacityFilterName; kind = "color_filter_v2";
            await rpc("CreateSourceFilter", new() { ["sourceName"] = source, ["filterName"] = name, ["filterKind"] = kind, ["filterSettings"] = new JsonObject { ["opacity"] = 1.0 } });
        }
        else
        {
            name = Str(color, "filterName"); kind = Str(color, "filterKind");
            if (color["filterEnabled"]?.GetValue<bool>() == false) throw new InvalidOperationException($"{label}: the filter {name} is disabled in OBS; enable it to ride its opacity.");
        }
        double scale = kind == "color_filter" ? 100 : 1;
        var settings = (await rpc("GetSourceFilter", new() { ["sourceName"] = source, ["filterName"] = name }))["filterSettings"] as JsonObject;
        double current = settings?["opacity"] is JsonValue v && v.TryGetValue<double>(out var d) ? d / scale : 1.0; // OBS omits a setting at its default
        double next = Math.Clamp(Math.Round((current + (id.EndsWith(".up") ? cfg.OpacityStep : -cfg.OpacityStep)) * 1000) / 1000, 0, 1);
        JsonNode value = scale == 100 ? JsonValue.Create((int)Math.Round(next * 100)) : JsonValue.Create(next);
        await rpc("SetSourceFilterSettings", new() { ["sourceName"] = source, ["filterName"] = name, ["filterSettings"] = new JsonObject { ["opacity"] = value }, ["overlay"] = true });
        return $"{label} opacity {Math.Round(next * 100)} %";
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
