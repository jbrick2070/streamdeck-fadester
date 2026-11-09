// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>
/// One relative T-bar for one authenticated OBS connection. Recreate it on reconnect, handing the old one's
/// <see cref="Leave"/> to the new one and running <see cref="ResumeAsync"/> once.
/// </summary>
public sealed class StudioFader
{
    private readonly Func<string, JsonObject?, Task<JsonObject>> rpc;
    private readonly Func<double, double, Task>? nativeMove;
    private readonly SemaphoreSlim serial = new(1);
    private readonly double step;
    internal sealed record Scenes(string Program, string Preview);
    internal sealed record Sweep(Scenes Scenes, string Transition);
    private Sweep? sweep;
    private bool needsReset, supportedVersion;
    // After every Cut the original selection stays owed for a while: OBS may ignore the restore, or apply it and then
    // switch back to Cut once the cut finishes (seen on hardware on 2026-11-09 after a confirmed read-back).
    internal sealed record Owed(string Cut, string Original, long At);
    private Owed? owed;
    private const double OwedForMs = 30_000;
    private int direction = 1;
    private long takeAt;

    public double Position { get; private set; }

    /// <summary>
    /// What a fader leaves for the next connection's fader: a part-thrown sweep, the transition a Cut still owes, and
    /// the dial's direction. The "check OBS" latch and the verified OBS version are not carried: the new connection
    /// reads OBS afresh.
    /// </summary>
    public sealed class Memory
    {
        internal Owed? Owed;
        internal Sweep? Sweep;
        internal double Position;
        internal int Direction = 1;
        internal long TakeAt;
    }

    public Memory Leave() => new() { Owed = owed, Sweep = sweep, Position = Position, Direction = direction, TakeAt = takeAt };

    public StudioFader(Func<string, JsonObject?, Task<JsonObject>> rpc, double step = 0.05,
        Func<double, double, Task>? nativeMove = null, Memory? resume = null)
    {
        if (!double.IsFinite(step) || step <= 0 || step > 1) throw new ArgumentOutOfRangeException(nameof(step));
        this.rpc = rpc;
        this.nativeMove = nativeMove;
        this.step = step;
        if (resume == null) return;
        owed = resume.Owed; sweep = resume.Sweep; direction = resume.Direction; takeAt = resume.TakeAt;
        Position = sweep != null ? resume.Position : 0;
    }

    /// <summary>
    /// Run once on a new connection, before any action: a sweep the last connection left part-thrown goes back to
    /// Program (its trigger or dial is no longer holding it), and a transition a Cut still owes goes back at once.
    /// </summary>
    /// <returns>A line for the log, or an empty string when there was nothing to say.</returns>
    public async Task<string> ResumeAsync()
    {
        await serial.WaitAsync();
        try
        {
            string said = "";
            if (sweep != null)
            {
                double cursor = await ReadCursorAsync();
                bool still = cursor is not (0 or 1);
                if (still)
                {
                    // A cursor that moves is a transition OBS runs itself (someone clicked Transition meanwhile): not ours.
                    await Task.Delay(150);
                    still = await ReadCursorAsync() == cursor;
                }
                if (!still) { sweep = null; Position = 0; } // OBS restarted, ended it itself, or runs its own
                else
                {
                    try { await CancelSweepAsync(); said = "T-bar: back to Program after the reconnect."; }
                    catch (InvalidOperationException e)
                    {
                        // Not ours any more, or OBS would not confirm: nothing is replayed on its own. No latch is set,
                        // so one Cancel press is enough to release a T-bar that still sits part-way.
                        sweep = null; Position = 0;
                        said = "T-bar: could not go back to Program after the reconnect. " + e.Message + " Check OBS, then press Cancel.";
                    }
                }
            }
            await RepayAsync();
            return said;
        }
        finally { serial.Release(); }
    }

    public Task CancelAsync() => DispatchAsync("fader.cancel");

    /// <summary>
    /// Moves to an absolute position for a spring-loaded control (the game controller's trigger): 0 cancels, 1 takes, and
    /// anything between is a throw from the current Program towards Preview. Unlike the dial, the turn direction never
    /// swaps after a take: a trigger always pulls from 0 towards 1.
    /// </summary>
    /// <returns>False when the move was ignored as a second take right after a take.</returns>
    public async Task<bool> MoveToAsync(double target)
    {
        if (!double.IsFinite(target)) throw new ArgumentOutOfRangeException(nameof(target));
        target = Math.Clamp(target, 0, 1);
        await serial.WaitAsync();
        try
        {
            if (needsReset) throw new InvalidOperationException("The previous transition changed or could not be confirmed. Check OBS and cancel/reset the fader before using it again.");
            await RepayAsync();
            // Like a second Take press: a full pull from rest right after a take must not take straight back.
            if (target == 1 && sweep == null && takeAt != 0 && Stopwatch.GetElapsedTime(takeAt).TotalMilliseconds < 450) return false;
            await MoveAsync(target - Position);
            return true;
        }
        finally { serial.Release(); }
    }

    public async Task DispatchAsync(string action)
    {
        await serial.WaitAsync();
        try
        {
            if (action == "fader.cancel")
            {
                if (sweep != null) await CancelSweepAsync();
                // With the latch set, this press only clears it: an unconfirmed write is never replayed for the operator.
                else if (!needsReset) await ReleaseStalledAsync();
                needsReset = false;
                await RepayAsync();
                return;
            }
            if (needsReset) throw new InvalidOperationException("The previous transition changed or could not be confirmed. Check OBS and cancel/reset the fader before using it again.");
            await RepayAsync();
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
            throw new InvalidOperationException("OBS already has a transition in progress. If the T-bar is stuck part-way, press Cancel.");
    }

    /// <summary>
    /// Cancel with no sweep of our own: a T-bar that sits part-way and does not move was left by an earlier run or a
    /// lost connection, and nothing else here could ever clear it. A transition OBS is running itself moves, and is
    /// left alone. The release returns to the Program the throw started from; it cannot take.
    /// </summary>
    private async Task ReleaseStalledAsync()
    {
        double cursor = await ReadCursorAsync();
        if (cursor is 0 or 1) return;
        await Task.Delay(150);
        if (await ReadCursorAsync() != cursor) return;
        await rpc("SetTBarPosition", new() { ["position"] = 0d, ["release"] = true });
        for (int i = 0; i < 12; i++)
        {
            if (await ReadCursorAsync() is 0 or 1) return;
            await Task.Delay(25);
        }
        // OBS only releases at a rail: its own slider is still part-way, and only a hand can move that one safely.
        throw new InvalidOperationException("The T-bar in OBS is part-way and did not release. Drag it to either end in OBS.");
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
            if (Field(transition, "transitionKind") != "fade_transition")
                throw new InvalidOperationException($"OBS has the {transition["transitionName"]?.GetValue<string>() ?? "current"} transition selected. Select Fade in OBS for a manual mix.");
            if (!string.IsNullOrEmpty(sceneOverride) && sceneOverride != Field(transition, "transitionName"))
                throw new InvalidOperationException($"The Preview scene has its own transition, {sceneOverride}. Set its transition override to {Field(transition, "transitionName")} or none for a manual mix.");
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
        bool requestedCut = false, confirmedCut = false, triggered = false;
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
            triggered = true;
            await ConfirmProgramAsync(scenes.Preview);
        }
        finally
        {
            if (requestedCut)
            {
                owed = new(replacement!, previous!, Stopwatch.GetTimestamp());
                var selected = await ReadTransitionNameAsync();
                // An unconfirmed Cut may still be queued behind the stale read. Queue our
                // original selection after it, but leave a third-party selection alone.
                if (selected == replacement || (!confirmedCut && selected == previous))
                {
                    try { await SelectTransitionAsync(replacement!, previous!, restoring: true); }
                    catch (InvalidOperationException e)
                    {
                        if (await ReadTransitionNameAsync() != replacement) { owed = null; throw; }
                        // Say whether the cut was sent, so nobody presses it again to "retry".
                        throw new InvalidOperationException((triggered ? "Cut sent, but " : "No cut sent: ") +
                            $"OBS stayed on {replacement}. {previous} goes back before your next action, or choose it in OBS.", e);
                    }
                    finally
                    {
                        // The watch starts when our restore attempt ends, not before its retries.
                        if (owed != null) owed = owed with { At = Stopwatch.GetTimestamp() };
                    }
                    // Even a confirmed read-back stays owed: OBS can still return to Cut. The next action checks.
                }
                // Already back on the original: still watch for OBS returning to Cut. A third transition is the operator's.
                else if (selected == previous) owed = owed! with { At = Stopwatch.GetTimestamp() };
                else owed = null;
            }
        }
    }

    /// <summary>Puts back the transition a recent Cut borrowed if OBS is on the Cut again.</summary>
    private async Task RepayAsync()
    {
        if (owed is not var (cut, original, at)) return;
        // After half a minute a Cut selection is more likely the operator's own choice than our leftover.
        if (Stopwatch.GetElapsedTime(at).TotalMilliseconds > OwedForMs) { owed = null; return; }
        var selected = await ReadTransitionNameAsync();
        // Still on the original: keep watching, since OBS (or a late, unconfirmed Cut) may switch to Cut afterwards.
        if (selected == original) return;
        if (selected == cut)
        {
            try { await SelectTransitionAsync(cut, original, restoring: true); }
            catch (InvalidOperationException e)
            {
                // The operator chose another transition meanwhile: theirs stands.
                if (await ReadTransitionNameAsync() == cut)
                    throw new InvalidOperationException($"OBS is still on {cut} after the last cut. Choose {original} in OBS, or press Cancel to try again.", e);
            }
        }
        owed = null;
    }
}
