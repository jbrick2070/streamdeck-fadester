// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal sealed class DeskActions(BridgeConfig cfg, Func<string, JsonObject?, Task<JsonObject>> rpc,
    Func<CancellationToken, IAsyncEnumerable<double>>? rampSteps = null, Func<double, double, Task>? nativeMove = null,
    DeskActions.Memory? resume = null, bool allowAutoCloseout = true,
    VisualSidechainMonitor? vsMonitor = null, Action<string>? onStatus = null, Func<long>? clockMs = null,
    Func<int, CancellationToken, Task>? delayAsync = null, Action<int, string, string>? onPick = null)
{
    public const double MinQuantizeConfidence = 0.35;
    public const int MaxQuantizeWaitMs = 4000;

    private sealed class ArmedTake(int? durationMs, int waitMs, CancellationTokenSource cts)
    {
        public int? DurationMs { get; } = durationMs;
        public int WaitMs { get; } = waitMs;
        public CancellationTokenSource Cts { get; } = cts;
    }

    private readonly object armGate = new();
    private ArmedTake? armedTake;
    private readonly Func<long> nowMs = clockMs ?? (() => Stopwatch.GetTimestamp() * 1000L / Stopwatch.Frequency);
    private readonly Func<int, CancellationToken, Task> waitDelay = delayAsync ?? Task.Delay;

    /// <summary>What one connection's desk hands to the next: see StudioFader.Memory and AudioDesk.Leave.</summary>
    public sealed record Memory(StudioFader.Memory Fader, AudioDesk.Duck? Duck);
    public Memory Leave() => new(fader.Leave(), audio.Leave());
    public Task<string> ResumeAsync() => fader.ResumeAsync();
    public bool IsTakeArmed { get { lock (armGate) return armedTake != null; } }
    public int ArmedWaitMs { get { lock (armGate) return armedTake?.WaitMs ?? 0; } }
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
    private readonly StudioFader fader = new(rpc, cfg.FaderStep, nativeMove, resume?.Fader, allowAutoCloseout);
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
    public Task StopAudioAsync() { CancelArmedTake(); return Task.WhenAll(audio.Stop(), mix.Stop()); }
    private static string Bound(string? value, string field) => !string.IsNullOrWhiteSpace(value) ? value : throw new InvalidOperationException($"Choose {field} on the Assignments tab first.");
    private Task<JsonObject> Get(string name) => rpc(name, null);
    private static string Str(JsonObject obj, string field) => obj[field]?.GetValue<string>() ?? throw new InvalidDataException($"OBS did not return {field}.");
    public async Task CancelOwnedAsync() { CancelArmedTake(); if (fader.Position > 0) await fader.CancelAsync(); }
    /** Where the companion's own T-bar move has the T-bar (0 at rest). */
    public double TbarPosition => fader.Position;
    public Task SettleAsync() => fader.SettleAsync();
    /** About 1.5 s after a cut: OBS can switch back to Cut as the cut ends (StudioFader.RecheckAsync). */
    public Task<string> RecheckTransitionAsync() => fader.RecheckAsync();

    /** The game controller's trigger T-bar. Only a take or a cancel is worth a log line; a throw in progress is quiet. */
    public async Task<string> TbarTo(double target)
    {
        CancelArmedTake();
        bool moving = fader.Position > 0;
        if (!await fader.MoveToAsync(target)) return "Controller T-bar: ignored a second take right after the last one";
        return target >= 1 ? "Controller T-bar: take" : target <= 0 && moving ? "Controller T-bar: back to Program" : "";
    }

    /** The game controller's take: how to move the T-bar for it, or null for OBS's own take (StudioFader.SlidePlanAsync). */
    public async Task<(double From, int Ms, bool NoTempo)?> SlidePlan(long pressedAt = 0)
    {
        if (IsTakeArmed || cfg.TakeQuantize is "next_beat" or "next_bar") return null;
        int? overrideMs = null;
        bool noTempo = false;
        if (cfg.TakeBeats > 0)
        {
            var plan = PlanQuantizedTake();
            overrideMs = plan.DurationMs;
            noTempo = plan.NoTempo;
        }
        return await fader.SlidePlanAsync(pressedAt, overrideMs) is { } s ? (s.From, s.Ms, noTempo) : null;
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
                {
                    // Kept per action, so two layer actions at once never swap their notes.
                    string picked = await FillLayers(id);
                    try { return await Opacity(id) + picked; }
                    catch (InvalidOperationException e) when (picked.Length > 0) { throw new InvalidOperationException(e.Message + picked, e); }
                }
            case "layer1.blend.previous":
            case "layer1.blend.next":
            case "layer1.blend.reset":
            case "layer2.blend.previous":
            case "layer2.blend.next":
            case "layer2.blend.reset":
                {
                    // Kept per action, so two layer actions at once never swap their notes.
                    string picked = await FillLayers(id);
                    try { return await Blend(id) + picked; }
                    catch (InvalidOperationException e) when (picked.Length > 0) { throw new InvalidOperationException(e.Message + picked, e); }
                }
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
                var input = id.StartsWith("music") ? Bound(cfg.MusicInput, "Music / bed") : Bound(cfg.ContentInput, "Content / guest");
                double step = cfg.VolumeStepDb * (id.Contains(".fine") ? 0.25 : 1);
                return await audio.Ride(input, id.EndsWith("up", StringComparison.OrdinalIgnoreCase) ? step : -step);
            case "music.duck":
            case "music.restore":
                return await audio.Fade(Bound(cfg.MusicInput, "Music / bed"), cfg.DuckDb, id == "music.restore");
            case "undo":
                return await audio.Undo();
            case "fader.back":
            case "fader.forward":
            case "fader.fineBack":
            case "fader.fineForward":
            case "take.cut":
                {
                    CancelArmedTake();
                    // A take or cut that sent nothing says so, so nobody mistakes it for one that went out.
                    string ignored = await fader.DispatchAsync(id, pressedAt);
                    return ignored.Length > 0 ? ignored : $"{ActionNames.Of(id)} · T-bar {fader.Position:P0}";
                }
            case "fader.cancel":
                {
                    if (CancelArmedTake() != null && fader.Position == 0)
                        return $"{ActionNames.Of("take")} · CANCELLED";
                    string ignored = await fader.DispatchAsync(id, pressedAt);
                    return ignored.Length > 0 ? ignored : $"{ActionNames.Of(id)} · T-bar {fader.Position:P0}";
                }
            case "take":
                return await DispatchTakeAsync(pressedAt);
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
                input = Bound(cfg.MicInput, "Microphone"); await rpc("SetInputMute", new() { ["inputName"] = input, ["inputMuted"] = true }); return "Muted " + input;
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
                    var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Fadester Companion");
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

    private readonly record struct QuantizedTakePlan(int? DurationMs, int WaitMs, bool NoTempo);

    private ArmedTake? CancelArmedTake()
    {
        ArmedTake? current;
        lock (armGate)
        {
            current = armedTake;
            armedTake = null;
        }
        if (current != null)
        {
            try { current.Cts.Cancel(); } catch (ObjectDisposedException) { }
        }
        return current;
    }

    private QuantizedTakePlan PlanQuantizedTake()
    {
        if (cfg.TakeBeats == 0 && cfg.TakeQuantize == "now") return new(null, 0, false);
        var snap = vsMonitor?.Sample(nowMs());
        bool usable = snap is
        {
            Loaded: true,
            State: not VisualSidechainMonitor.MeterState.NotLoaded and not VisualSidechainMonitor.MeterState.Unknown,
            AudioPresent: true,
            Bpm: > 0
        } s && (s.BeatConfidence >= MinQuantizeConfidence || s.BpmLocked);

        if (!usable)
        {
            int? fallbackDuration = cfg.TakeBeats > 0 ? Math.Clamp(cfg.TakeFallbackMs, 50, 20000) : null;
            return new(fallbackDuration, 0, true);
        }

        var v = snap!.Value;
        double beatMs = 60000.0 / v.Bpm;
        double barMs = 4.0 * beatMs;
        int maxWaitMs = (int)Math.Round(Math.Min(barMs, MaxQuantizeWaitMs));
        int? durationMs = cfg.TakeBeats > 0 ? Math.Clamp((int)Math.Round(cfg.TakeBeats * beatMs), 50, 20000) : null;
        int waitMs = cfg.TakeQuantize switch
        {
            "next_beat" => Math.Clamp((int)Math.Round((1.0 - Math.Clamp(v.BeatPhase, 0.0, 1.0)) * beatMs), 0, maxWaitMs),
            "next_bar" => Math.Clamp((int)Math.Round((1.0 - Math.Clamp(v.BarPhase, 0.0, 1.0)) * barMs), 0, maxWaitMs),
            _ => 0
        };
        if (waitMs <= 10) waitMs = 0;
        return new(durationMs, waitMs, false);
    }

    private async Task<string> DispatchTakeAsync(long pressedAt)
    {
        var existing = CancelArmedTake();
        if (existing != null)
        {
            string secondIgnored = await fader.DispatchAsync("take", pressedAt, existing.DurationMs);
            return secondIgnored.Length > 0 ? secondIgnored : $"{ActionNames.Of("take")} · T-bar {fader.Position:P0}";
        }

        if (fader.Position > 0 || (cfg.TakeBeats == 0 && cfg.TakeQuantize == "now"))
        {
            string plainIgnored = await fader.DispatchAsync("take", pressedAt);
            return plainIgnored.Length > 0 ? plainIgnored : $"{ActionNames.Of("take")} · T-bar {fader.Position:P0}";
        }

        var plan = PlanQuantizedTake();
        if (plan.NoTempo)
        {
            string fallbackIgnored = await fader.DispatchAsync("take", pressedAt, plan.DurationMs);
            string baseLine = fallbackIgnored.Length > 0 ? fallbackIgnored : $"{ActionNames.Of("take")} · T-bar {fader.Position:P0}";
            return baseLine + " · NO TEMPO";
        }

        if (plan.WaitMs == 0)
        {
            string nowIgnored = await fader.DispatchAsync("take", pressedAt, plan.DurationMs);
            return nowIgnored.Length > 0 ? nowIgnored : $"{ActionNames.Of("take")} · T-bar {fader.Position:P0}";
        }

        if ((await Get("GetStudioModeEnabled"))["studioModeEnabled"]?.GetValue<bool>() != true)
            throw new InvalidOperationException("Enable Studio Mode in OBS before using Preview or the T-bar.");
        var list = await Get("GetSceneList");
        if (Str(list, "currentProgramSceneUuid") == Str(list, "currentPreviewSceneUuid"))
            return "take ignored: Preview is the same scene as Program. Select another Preview scene first.";

        var cts = new CancellationTokenSource();
        var entry = new ArmedTake(plan.DurationMs, plan.WaitMs, cts);
        lock (armGate) armedTake = entry;
        _ = RunArmedTakeAsync(entry);
        return $"{ActionNames.Of("take")} · ARMED";
    }

    private async Task RunArmedTakeAsync(ArmedTake entry)
    {
        try
        {
            await waitDelay(entry.WaitMs, entry.Cts.Token);
            bool shouldFire = false;
            lock (armGate)
            {
                if (ReferenceEquals(armedTake, entry))
                {
                    armedTake = null;
                    shouldFire = true;
                }
            }
            if (!shouldFire) return;
            string ignored = await fader.DispatchAsync("take", 0, entry.DurationMs);
            string line = ignored.Length > 0 ? ignored : $"{ActionNames.Of("take")} · T-bar {fader.Position:P0}";
            onStatus?.Invoke(line);
        }
        catch (OperationCanceledException) { }
        catch (Exception e) { onStatus?.Invoke(ActionNames.Of("take") + ": " + e.Message); }
        finally { entry.Cts.Dispose(); }
    }
    /** The scene item a Layer action drives: scene and source from the panel's Assignments. */
    private (string Scene, string Source, string Label) Layer(string id)
    {
        bool two = id.StartsWith("layer2");
        var scene = Bound(two ? cfg.Layer2Scene : cfg.Layer1Scene, two ? "Layer 2 scene" : "Layer 1 scene");
        var source = Bound(two ? cfg.Layer2Source : cfg.Layer1Source, two ? "Layer 2 source" : "Layer 1 source");
        return (scene, source, two ? "Layer 2" : "Layer 1");
    }
    /**
     * Layers nobody chose fill themselves in from the live scene the first time a layer control is used (hand test
     * 2026-11-17: the controls did nothing until both layers were picked, and a sound file picked by hand showed nothing).
     * Layer 1 is the topmost visible picture, Layer 2 the next one down: enabled, with video, a size above zero (a sound
     * file has none) and the only item of that name in the scene. Only empty layers are filled, in memory; the line
     * returned tells the operator, and onPick tells the panel (PanelLine.PickedLayer: a line of its own, which no video
     * title or other free text can write), which shows the choice on the Assignments tab and saves it.
     */
    private async Task<string> FillLayers(string id)
    {
        bool one = string.IsNullOrWhiteSpace(cfg.Layer1Scene) || string.IsNullOrWhiteSpace(cfg.Layer1Source);
        bool two = string.IsNullOrWhiteSpace(cfg.Layer2Scene) || string.IsNullOrWhiteSpace(cfg.Layer2Source);
        if (!one && !two) return "";
        string scene = Str(await Get("GetCurrentProgramScene"), "currentProgramSceneName");
        var video = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in (await Get("GetInputList"))["inputs"]?.AsArray() ?? [])
            if (row?["inputKindCaps"]?.GetValue<int>() is int caps && (caps & 1) != 0 && (caps & 64) == 0) video.Add(row!["inputName"]!.GetValue<string>());
        var items = (await rpc("GetSceneItemList", new() { ["sceneName"] = scene }))["sceneItems"]!.AsArray().Select(n => n!.AsObject()).ToList();
        var picks = new List<string>();
        foreach (var item in items.OrderByDescending(n => n["sceneItemIndex"]!.GetValue<int>()))
        {
            string name = Str(item, "sourceName");
            bool isScene = Str(item, "sourceType") == "OBS_SOURCE_TYPE_SCENE";
            if (item["sceneItemEnabled"]?.GetValue<bool>() != true || (!isScene && !video.Contains(name))) continue;
            if (items.Count(n => Str(n, "sourceName") == name) != 1) continue;
            var size = (await rpc("GetSceneItemTransform", new() { ["sceneName"] = scene, ["sceneItemId"] = item["sceneItemId"]!.GetValue<int>() }))["sceneItemTransform"];
            if ((size?["sourceWidth"]?.GetValue<double>() ?? 0) <= 0 || (size?["sourceHeight"]?.GetValue<double>() ?? 0) <= 0) continue;
            picks.Add(name);
        }
        // A layer already chosen is never picked again for the other one.
        if (!one) picks.Remove(cfg.Layer1Source);
        if (!two) picks.Remove(cfg.Layer2Source);
        string said = "";
        if (one && string.IsNullOrWhiteSpace(cfg.Layer1Source) && picks.Count > 0)
        {
            cfg.Layer1Scene = scene; cfg.Layer1Source = picks[0]; picks.RemoveAt(0);
            said += $"\nLayer 1 = {scene} › {cfg.Layer1Source} (picked automatically; change it on the Assignments tab)";
            onPick?.Invoke(1, scene, cfg.Layer1Source);
        }
        if (two && string.IsNullOrWhiteSpace(cfg.Layer2Source) && picks.Count > 0)
        {
            cfg.Layer2Scene = scene; cfg.Layer2Source = picks[0];
            said += $"\nLayer 2 = {scene} › {cfg.Layer2Source} (picked automatically; change it on the Assignments tab)";
            onPick?.Invoke(2, scene, cfg.Layer2Source);
        }
        // Only the layer this control drives must exist; a pick for the other one is still said.
        bool forTwo = id.StartsWith("layer2");
        if (forTwo ? string.IsNullOrWhiteSpace(cfg.Layer2Source) : string.IsNullOrWhiteSpace(cfg.Layer1Source))
            throw new InvalidOperationException($"Layer {(forTwo ? 2 : 1)}: {scene} has no {(forTwo && !string.IsNullOrWhiteSpace(cfg.Layer1Source) ? "second " : "")}picture to use. Choose a scene and source on the Assignments tab.{said}");
        return said;
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
     * Opacity prefers an enabled, available Midi Fadester layer_opacity slot whose source and scene match Layer 2,
     * driving it through set_fader_value instead of touching Color Correction (P1-8 single-owner rule). Otherwise it
     * rides the source's Color Correction filter: the first one it has, else a new one named OpacityFilterName at the
     * end of the chain. color_filter_v2 takes 0..1, the legacy color_filter 0..100. `overlay` keeps its other
     * settings. A disabled filter is reported, not switched on (that could change the look someone set up). If a
     * Fadester opacity filter already exists on the source while Midi Fadester owns Layer 2 opacity, nothing on that
     * filter is changed or deleted and the Activity line says that the two stack.
     */
    private async Task<string> Opacity(string id)
    {
        var (scene, source, label, _) = await LayerItem(id);
        JsonObject? ownedSlot = null;
        try
        {
            var outer = await rpc("CallVendorRequest", new()
            {
                ["vendorName"] = "midi-fadester",
                ["requestType"] = "get_state",
                ["requestData"] = new JsonObject()
            });
            if (outer["responseData"] is JsonObject state && state["slots"] is JsonArray slots)
            {
                ownedSlot = slots.OfType<JsonObject>().FirstOrDefault(s =>
                    s["enabled"]?.GetValue<bool>() == true &&
                    s["available"]?.GetValue<bool>() == true &&
                    s["target_mode"]?.GetValue<string>() == "layer_opacity" &&
                    s["source_a"]?.GetValue<string>() == source &&
                    s["scene"]?.GetValue<string>() == scene);
            }
        }
        catch (ObsError e) when (e.Code is 600 or 604)
        {
            // Midi Fadester is not loaded; fall through to Color Correction.
        }

        if (ownedSlot != null)
        {
            string slotId = Str(ownedSlot, "id");
            string slotName = ownedSlot["name"]?.GetValue<string>() is { Length: > 0 } sn ? sn : slotId;
            double slotCurrent = ownedSlot["value"] is JsonValue sv && sv.TryGetValue<double>(out var curVal) ? curVal : 1.0;
            double slotNext = Math.Clamp(Math.Round((slotCurrent + (id.EndsWith(".up") ? cfg.OpacityStep : -cfg.OpacityStep)) * 1000) / 1000, 0, 1);
            var setOuter = await rpc("CallVendorRequest", new()
            {
                ["vendorName"] = "midi-fadester",
                ["requestType"] = "set_fader_value",
                ["requestData"] = new JsonObject { ["slot"] = slotId, ["value"] = slotNext }
            });
            double applied = slotNext;
            if (setOuter["responseData"] is JsonObject setRes)
            {
                if (setRes["ok"]?.GetValue<bool>() == false || setRes["error"] != null)
                {
                    string? comment = setRes["comment"]?.GetValue<string>();
                    throw new InvalidOperationException(!string.IsNullOrEmpty(comment) ? comment : $"{label}: Midi Fadester refused {slotName}.");
                }
                if (setRes["value"] is JsonValue av && av.TryGetValue<double>(out var appVal)) applied = appVal;
            }
            var sourceFilters = (await rpc("GetSourceFilterList", new() { ["sourceName"] = source }))["filters"]!.AsArray().Select(n => n!.AsObject());
            bool hasCompanionFilter = sourceFilters.Any(f => f["filterName"]?.GetValue<string>() == OpacityFilterName);
            return hasCompanionFilter
                ? $"{label} opacity {Math.Round(applied * 100)} % (Midi Fadester {slotName}; {OpacityFilterName} is also on {source}, so the two stack)"
                : $"{label} opacity {Math.Round(applied * 100)} % (Midi Fadester {slotName})";
        }

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
        if (!(await Get("GetStudioModeEnabled"))["studioModeEnabled"]!.GetValue<bool>()) throw new InvalidOperationException("Enable Studio Mode to select Preview; Program was not changed.");
        // An anchor nobody chose is the scene at that place in OBS's list, top first (hand test 2026-11-17: "Choose Preview
        // anchor 1 on the Assignments tab first" told the operator nothing). Nothing is written: the Assignments tab still
        // shows the anchor empty, and choosing a scene there takes over.
        int anchorIndex = id.StartsWith("anchor.") ? id[^1] - '1' : -1;
        string? anchor = anchorIndex >= 0 && !string.IsNullOrWhiteSpace(cfg.Anchors[anchorIndex]) ? cfg.Anchors[anchorIndex] : null;
        // OBS may report the destination as Program during a manual sweep. Cancel before reading either scene.
        await CancelOwnedAsync();
        var list = await Get("GetSceneList");
        var scenes = list["scenes"]!.AsArray().Select(n => n!.AsObject()).OrderByDescending(n => n["sceneIndex"]!.GetValue<int>()).Select(n => Str(n, "sceneName")).ToList();
        string preview = Str(list, "currentPreviewSceneName");
        string target;
        if (anchor != null) target = anchor;
        else if (anchorIndex >= 0)
        {
            if (anchorIndex >= scenes.Count)
                throw new InvalidOperationException($"Preview anchor {anchorIndex + 1}: OBS has only {scenes.Count} scene(s). Choose a scene for it on the Assignments tab.");
            target = scenes[anchorIndex];
        }
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
        var name = Bound(cfg.MediaInput, "Media / Playlister");
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
        var scene = Bound(cfg.OverlayScene, "Overlay scene"); var source = Bound(cfg.OverlaySource, "Overlay source");
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
        string selected = Str(current, "transitionName");
        int i = choices.IndexOf(selected);
        if (i < 0 || choices.Count == 0) throw new InvalidOperationException("Current transition missing from OBS list.");
        var name = choices[(i + (id.EndsWith("next") ? 1 : -1) + choices.Count) % choices.Count];
        // Right after a take or cut OBS drops a selection: it is sent again until OBS shows it, and the line says
        // what OBS really holds.
        string held = await fader.ChooseTransitionAsync(selected, name);
        return held == name ? "Transition: " + name : $"Transition: OBS kept {held}, not {name}. Try again, or choose it in OBS.";
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
        string vsLine = "";
        try
        {
            using var vsProbe = new VisualSidechainMonitor(rpc, enableBackgroundTick: false);
            await vsProbe.StartAsync();
            vsLine = VisualSidechainMonitor.FormatHudPayload(vsProbe.Sample());
        }
        catch (Exception) { }
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
            ["recordActive"] = (await Get("GetRecordStatus"))["outputActive"]?.DeepClone(),
            ["visualSidechain"] = vsLine
        };
    }
}

/// <summary>
/// The lines the panel acts on, as opposed to the lines it only shows. Activity text also carries video titles and
/// other text from outside (a peer's error message, an OBS name), so the panel must not find its orders in it: a
/// picked layer is one line of its own that starts with <see cref="PickedMarker"/>, and every line of free text goes
/// through <see cref="Free"/>, which never lets it start with that marker.
/// </summary>
internal static class PanelLine
{
    public const string PickedMarker = "LAYER-PICKED ";

    /** The line for a layer the desk picked by itself (DeskActions.FillLayers): the marker and one JSON object, on one line. */
    public static string PickedLayer(int layer, string scene, string source) =>
        PickedMarker + new JsonObject { ["layer"] = layer, ["scene"] = scene, ["source"] = source }.ToJsonString();

    /**
     * Free text as it may be printed: a line of it that would start with the marker (after any white space or control
     * characters, which a reader may trim) is set back behind "> ". CR and LF both start a new line for the panel.
     */
    public static string Free(string? text)
    {
        if (string.IsNullOrEmpty(text) || !text.Contains("LAYER-PICKED", StringComparison.Ordinal)) return text ?? "";
        var result = new System.Text.StringBuilder(text.Length + 8);
        int at = 0;
        while (at <= text.Length)
        {
            int end = text.IndexOfAny(['\r', '\n'], at);
            if (end < 0) end = text.Length;
            int first = at;
            while (first < end && Skipped(text[first])) first++;
            if (string.CompareOrdinal(text, first, "LAYER-PICKED", 0, "LAYER-PICKED".Length) == 0) result.Append("> ");
            result.Append(text, at, end - at);
            if (end < text.Length) result.Append(text[end]);
            at = end + 1;
        }
        return result.ToString();
    }

    /// <summary>
    /// A writer for everything a process prints as free text. Whatever way the text arrives (a string, single
    /// characters, a character array, with or without its line end), it is collected into whole lines, and each line
    /// goes through <see cref="Free"/> before it is handed on: no sequence of writes can start a line with the marker.
    /// Text without a line end waits for it, or for Flush. Flush hands an unfinished line on as it is, set back behind
    /// "> " if it could still grow into the marker, and what is written next continues that line: it is never looked
    /// at as a line start. Every call runs under the writer's own lock.
    /// </summary>
    internal sealed class Guard(Action<string> emit, System.Text.Encoding? encoding = null) : TextWriter
    {
        private readonly object sync = new();
        private readonly System.Text.StringBuilder line = new();
        /// <summary>Flush handed on the start of the line now being written: the next text sent continues it.</summary>
        private bool cut;
        public override System.Text.Encoding Encoding => encoding ?? System.Text.Encoding.UTF8;

        public override void Write(char value)
        {
            lock (sync)
            {
                line.Append(value);
                if (value == '\n') Send();
            }
        }
        public override void Write(char[] buffer, int index, int count) => Write(new string(buffer, index, count));
        public override void Write(string? value)
        {
            if (string.IsNullOrEmpty(value)) return;
            lock (sync)
            {
                int last = value.LastIndexOf('\n');
                if (last < 0) { line.Append(value); return; }
                line.Append(value.AsSpan(0, last + 1));
                Send();
                if (last + 1 < value.Length) line.Append(value.AsSpan(last + 1));
            }
        }
        // One hand-over per line, so a line is never split by another thread's.
        public override void WriteLine(string? value)
        {
            lock (sync)
            {
                line.Append(value).Append(CoreNewLine);
                Send();
            }
        }
        public override void Flush()
        {
            lock (sync)
            {
                if (line.Length == 0) return;
                string text = Take();
                // The buffer holds no LF (a line is sent at its LF), but a CR starts a line for a reader too. Only
                // the part after the last CR is unfinished.
                int from = text.LastIndexOf('\r') + 1;
                string head = text[..from], tail = text[from..];
                string sent = cut ? Continued(head) : Free(head);
                if (tail.Length > 0 && (from > 0 || !cut))
                {
                    // The tail starts a line. A whole marker is set back by Free; so is a start that could still
                    // grow into one (past anything a reader trims): later text cannot undo it.
                    int first = 0;
                    while (first < tail.Length && Skipped(tail[first])) first++;
                    string start = tail[first..];
                    bool mayGrow = start.Length < "LAYER-PICKED".Length && "LAYER-PICKED".StartsWith(start, StringComparison.Ordinal);
                    tail = mayGrow ? "> " + tail : Free(tail);
                }
                emit(sent + tail);
                // What is written next continues the tail; after a CR (or nothing) it starts a line of its own.
                cut = tail.Length > 0;
            }
        }

        private string Take()
        {
            string text = line.ToString();
            line.Clear();
            return text;
        }

        /// <summary>Text whose first line continues one already handed on: guarded from its second line.</summary>
        private static string Continued(string text) => text.Length == 0 ? "" : Free("x" + text)[1..];

        private void Send()
        {
            string text = Take();
            bool continues = cut;
            cut = false;
            emit(continues ? Continued(text) : Free(text));
        }
    }

    private static bool Skipped(char c) =>
        char.IsWhiteSpace(c) || char.IsControl(c) || char.GetUnicodeCategory(c) == System.Globalization.UnicodeCategory.Format;

    /// <summary>
    /// A helper process's own stderr, line by line, onto this process's stderr, which is guarded where a panel reads
    /// it. Left to inherit the handle, the helper would write to the panel directly, past the guard.
    /// </summary>
    internal static void ForwardErrors(System.Diagnostics.Process helper)
    {
        helper.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is { Length: > 0 } text) { try { Console.Error.WriteLine(text); } catch (Exception x) when (x is IOException or ObjectDisposedException) { } }
        };
        helper.BeginErrorReadLine();
    }
}

