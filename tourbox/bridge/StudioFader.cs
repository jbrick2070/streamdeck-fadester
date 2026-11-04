// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>One relative T-bar for one authenticated OBS connection. Recreate it on reconnect.</summary>
public sealed class StudioFader
{
    private readonly Func<string, JsonObject?, Task<JsonObject>> rpc;
    private readonly Func<double, double, Task>? nativeMove;
    private readonly SemaphoreSlim serial = new(1);
    private readonly double step;
    private sealed record Scenes(string Program, string Preview);
    private sealed record Sweep(Scenes Scenes, string Transition);
    private Sweep? sweep;
    private bool needsReset, supportedVersion;
    private int direction = 1;
    private long takeAt;

    public double Position { get; private set; }

    public StudioFader(Func<string, JsonObject?, Task<JsonObject>> rpc, double step = 0.05,
        Func<double, double, Task>? nativeMove = null)
    {
        if (!double.IsFinite(step) || step <= 0 || step > 1) throw new ArgumentOutOfRangeException(nameof(step));
        this.rpc = rpc;
        this.nativeMove = nativeMove;
        this.step = step;
    }

    public Task CancelAsync() => DispatchAsync("fader.cancel");

    public async Task DispatchAsync(string action)
    {
        await serial.WaitAsync();
        try
        {
            if (action == "fader.cancel")
            {
                if (sweep != null) await CancelSweepAsync();
                needsReset = false;
                return;
            }
            if (needsReset) throw new InvalidOperationException("The previous transition changed or could not be confirmed. Check OBS and cancel/reset the fader before using it again.");
            switch (action)
            {
                case "fader.forward": await MoveAsync(direction * step); break;
                case "fader.back": await MoveAsync(-direction * step); break;
                case "fader.fineForward": await MoveAsync(direction * step / 4); break;
                case "fader.fineBack": await MoveAsync(-direction * step / 4); break;
                case "take": case "take.cut":
                    if (takeAt != 0 && Stopwatch.GetElapsedTime(takeAt).TotalMilliseconds < 450) return;
                    if (sweep != null) await FinishSweepAsync();
                    else await TakeAsync(action == "take.cut");
                    break;
                default: throw new ArgumentException("Unknown Studio fader action: " + action, nameof(action));
            }
        }
        finally { serial.Release(); }
    }

    private static string Field(JsonObject value, string key) =>
        value[key]?.GetValue<string>() is { Length: > 0 } text ? text : throw new InvalidOperationException("OBS did not return " + key);

    private async Task<Scenes> ReadScenesAsync()
    {
        if ((await rpc("GetStudioModeEnabled", null))["studioModeEnabled"]?.GetValue<bool>() != true)
            throw new InvalidOperationException("Enable Studio Mode in OBS before using Preview or the T-bar.");
        var list = await rpc("GetSceneList", null);
        return new Scenes(Field(list, "currentProgramSceneUuid"), Field(list, "currentPreviewSceneUuid"));
    }

    private async Task RequireIdleAsync()
    {
        double cursor = await ReadCursorAsync();
        if (cursor is not (0 or 1))
            throw new InvalidOperationException("OBS already has a transition in progress.");
    }

    private async Task<double> ReadCursorAsync() =>
        (await rpc("GetCurrentSceneTransitionCursor", null))["transitionCursor"]?.GetValue<double>()
        ?? throw new InvalidOperationException("OBS did not report its transition cursor.");

    private async Task<string?> SceneOverrideAsync(string scene) =>
        (await rpc("GetSceneSceneTransitionOverride", new() { ["sceneUuid"] = scene }))["transitionName"]?.GetValue<string>();

    private async Task MoveAsync(double delta)
    {
        double next = Math.Clamp(Math.Round(Position + delta, 12), 0, 1);
        if (next == Position) return; // Repeated ticks towards a parked rail cannot start a second take.
        if (sweep == null)
        {
            if (!supportedVersion)
            {
                string version = Field(await rpc("GetVersion", null), "obsVersion");
                if (version != "33.0.0" && version != "33.0.1")
                    throw new InvalidOperationException("Manual T-bar support is verified for OBS 33.0.0/33.0.1. Use the ordinary Take with this OBS version.");
                supportedVersion = true;
            }
            var scenes = await ReadScenesAsync();
            if (scenes.Program == scenes.Preview) throw new InvalidOperationException("Choose a different Preview scene first.");
            await RequireIdleAsync();
            var transition = await rpc("GetCurrentSceneTransition", null);
            var sceneOverride = await SceneOverrideAsync(scenes.Preview);
            if (Field(transition, "transitionKind") != "fade_transition" ||
                (!string.IsNullOrEmpty(sceneOverride) && sceneOverride != Field(transition, "transitionName")))
                throw new InvalidOperationException("Select Fade with no conflicting Preview scene transition override for a manual mix.");
            sweep = new Sweep(scenes, Field(transition, "transitionUuid"));
        }
        if (next == 0) { await CancelSweepAsync(); return; }
        if (next == 1) { await FinishSweepAsync(); return; }
        await CheckOwnershipAsync();
        bool firstMove = Position == 0;
        await WritePositionAsync(next, false);
        Position = next;
        if (firstMove)
        {
            // A successful RPC only queues TBarChanged on the UI thread. Wait until OBS confirms
            // a blend before accepting further ticks; a stopped cursor after that means ownership was lost.
            for (int i = 0; i < 12; i++)
            {
                if (await ReadCursorAsync() is > 0 and < 1) return;
                await Task.Delay(25);
            }
            Disarm();
            throw new InvalidOperationException("OBS did not start the manual transition.");
        }
    }

    private async Task CheckOwnershipAsync()
    {
        var own = sweep ?? throw new InvalidOperationException("No manual sweep.");
        try
        {
            var current = await ReadScenesAsync();
            // OBS 33 announces the destination as Program as soon as its manual transition starts.
            bool programMatches = current.Program == own.Scenes.Program || (Position > 0 && current.Program == own.Scenes.Preview);
            if (!programMatches || current.Preview != own.Scenes.Preview ||
                Field(await rpc("GetCurrentSceneTransition", null), "transitionUuid") != own.Transition ||
                (Position > 0 && await ReadCursorAsync() is not (> 0 and < 1)))
                throw new InvalidOperationException("Program, Preview or transition changed. Fader stopped without taking the new target.");
        }
        catch { Disarm(); throw; }
    }

    private void Disarm() { sweep = null; Position = 0; needsReset = true; }
    private async Task WritePositionAsync(double value, bool release)
    {
        try
        {
            // Setting the actual Qt slider drives OBS's TBarChanged signal and moves the visible handle.
            if (nativeMove != null) await nativeMove(Position, value);
            if (nativeMove == null || release)
                await rpc("SetTBarPosition", new() { ["position"] = value, ["release"] = release });
            // OBS-WebSocket has no release-only request. At a rail its release resets the real
            // slider to zero. Equal arguments ask the native adapter to verify without moving it.
            if (nativeMove != null && release) await nativeMove(0, 0);
        }
        catch { Disarm(); throw; } // An unanswered write might have reached OBS; never replay it.
    }

    private async Task CancelSweepAsync()
    {
        var original = sweep!.Scenes;
        await CheckOwnershipAsync();
        await WritePositionAsync(0, true); // On OBS 33 this is a deliberate return to the original Program.
        sweep = null; Position = 0;
        if (nativeMove != null) await ConfirmNativeReleaseAsync(original, completed: false);
        else await ConfirmProgramAsync(original.Program, parked: true);
    }

    private async Task ConfirmNativeReleaseAsync(Scenes original, bool completed)
    {
        var expected = completed ? new Scenes(original.Preview, original.Program) : original;
        var started = Stopwatch.GetTimestamp();
        long parkedSince = 0;
        bool cuedPrevious = false;
        Scenes observed;
        double cursor;
        try
        {
            do
            {
                observed = await ReadScenesAsync();
                if ((observed.Program != original.Program && observed.Program != original.Preview) ||
                    (observed.Preview != original.Program && observed.Preview != original.Preview))
                    throw new InvalidOperationException($"Scene changed during T-bar release: Program {observed.Program}, Preview {observed.Preview}.");
                cursor = await ReadCursorAsync();
                if (observed.Program == expected.Program && cursor is 0 or 1)
                {
                    if (observed.Preview == expected.Preview) return;
                    // OBS may publish its Preview swap after the cursor parks. If automatic
                    // scene swapping is off, retain our previous Program for the return throw.
                    if (parkedSince == 0) parkedSince = Stopwatch.GetTimestamp();
                    if (completed && !cuedPrevious && Stopwatch.GetElapsedTime(parkedSince).TotalMilliseconds >= 600)
                    {
                        await rpc("SetCurrentPreviewScene", new() { ["sceneUuid"] = expected.Preview });
                        cuedPrevious = true;
                        started = Stopwatch.GetTimestamp();
                    }
                }
                else parkedSince = 0;
                await Task.Delay(35);
            } while (Stopwatch.GetElapsedTime(started).TotalSeconds < 2.5);
            throw new InvalidOperationException($"T-bar release expected Program {expected.Program}, Preview {expected.Preview} and an idle cursor. " +
                $"OBS reported Program {observed.Program}, Preview {observed.Preview}, cursor {cursor}.");
        }
        catch { Disarm(); throw; }
    }

    private async Task ConfirmProgramAsync(string target, bool parked = false)
    {
        for (int i = 0; i < 12; i++)
        {
            if (Field(await rpc("GetCurrentProgramScene", null), "sceneUuid") == target &&
                (!parked || await ReadCursorAsync() is 0 or 1)) return;
            await Task.Delay(25);
        }
        Disarm();
        throw new InvalidOperationException("OBS did not confirm the expected Program scene and transition state.");
    }

    private async Task FinishSweepAsync()
    {
        var original = sweep!.Scenes;
        await CheckOwnershipAsync();
        await WritePositionAsync(1, release: nativeMove != null);
        try
        {
            if (nativeMove == null)
            {
                // The WebSocket-only driver leaves the Qt slider at zero, so a release would cancel.
                try { await rpc("SetStudioModeEnabled", new() { ["studioModeEnabled"] = false }); }
                finally { await RestoreStudioAsync(); }
                await ConfirmProgramAsync(original.Preview, parked: true);
                var current = await ReadScenesAsync();
                if (current.Program != original.Preview) throw new InvalidOperationException("Program changed after the take.");
                if (current.Preview == original.Preview)
                    await rpc("SetCurrentPreviewScene", new() { ["sceneUuid"] = original.Program });
            }
            else await ConfirmNativeReleaseAsync(original, completed: true);
            direction = -direction;
            takeAt = Stopwatch.GetTimestamp();
            sweep = null; Position = 0;
        }
        catch { Disarm(); throw; }
    }

    private async Task RestoreStudioAsync()
    {
        try { await rpc("SetStudioModeEnabled", new() { ["studioModeEnabled"] = true }); }
        catch
        {
            // The acknowledgement or the write may have failed; re-enabling is idempotent.
            await rpc("SetStudioModeEnabled", new() { ["studioModeEnabled"] = true });
        }
    }

    private async Task<string> ReadTransitionNameAsync() =>
        Field(await rpc("GetCurrentSceneTransition", null), "transitionName");

    private async Task SelectTransitionAsync(string from, string to, bool restoring = false)
    {
        await rpc("SetCurrentSceneTransition", new() { ["transitionName"] = to });
        // The OBS frontend queues the selection on its UI thread. The RPC can return first.
        for (int attempt = 0; attempt < 40; attempt++)
        {
            var selected = await ReadTransitionNameAsync();
            if (selected == to) return;
            if (selected != from) throw new InvalidOperationException("The selected OBS transition changed to " + selected + ".");
            // OBS also silently ignores SetTransition while a Cut is still active. Program
            // can change before that ends. Retry only our restoration, never the Take.
            if (restoring && attempt > 0 && attempt % 4 == 0)
                await rpc("SetCurrentSceneTransition", new() { ["transitionName"] = to });
            await Task.Delay(25);
        }
        throw new InvalidOperationException("OBS did not confirm the transition " + to + ".");
    }

    private async Task TakeAsync(bool cut)
    {
        var scenes = await ReadScenesAsync();
        if (scenes.Program == scenes.Preview) return;
        await RequireIdleAsync();
        string? previous = null, replacement = null;
        bool requestedCut = false, confirmedCut = false;
        try
        {
            if (cut)
            {
                var list = await rpc("GetSceneTransitionList", null);
                previous = Field(list, "currentSceneTransitionName");
                replacement = list["transitions"]?.AsArray().OfType<JsonObject>()
                    .Where(tr => (string?)tr["transitionKind"] == "cut_transition").Select(tr => Field(tr, "transitionName")).FirstOrDefault()
                    ?? throw new InvalidOperationException("OBS has no Cut transition.");
                var sceneOverride = await SceneOverrideAsync(scenes.Preview);
                if (!string.IsNullOrEmpty(sceneOverride) && sceneOverride != replacement)
                    throw new InvalidOperationException("A scene override would prevent a true Cut.");
                if (previous != replacement)
                {
                    requestedCut = true;
                    await SelectTransitionAsync(previous, replacement);
                    confirmedCut = true;
                }
            }
            if (await ReadScenesAsync() != scenes) throw new InvalidOperationException("Program or Preview changed before Take.");
            await RequireIdleAsync();
            if (cut && await ReadTransitionNameAsync() != replacement)
                throw new InvalidOperationException("The selected OBS transition changed before Cut.");
            takeAt = Stopwatch.GetTimestamp();
            await rpc("TriggerStudioModeTransition", null);
            await ConfirmProgramAsync(scenes.Preview);
        }
        finally
        {
            if (requestedCut)
            {
                var selected = await ReadTransitionNameAsync();
                // An unconfirmed Cut may still be queued behind the stale read. Queue our
                // original selection after it, but leave a third-party selection alone.
                if (selected == replacement || (!confirmedCut && selected == previous))
                    await SelectTransitionAsync(replacement!, previous!, restoring: true);
            }
        }
    }
}
