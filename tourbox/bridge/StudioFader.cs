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
    // A sweep that had to select a Fade (Lent) owes the operator's transition the same way, but its watch starts only
    // when the sweep ends (At is 0 until then) and stops once the transition is back: a Fade picked later is theirs.
    // A cut's watch that the lend replaced (Resume) carries on after it.
    internal sealed record Owed(string Borrowed, string Original, long At, bool Lent = false, Owed? Resume = null);
    private Owed? owed;
    private const double OwedForMs = 30_000;
    // OBS drops every selection while a transition runs, and it counts one as running well after the picture is done
    // (measured on 33.0.1 with audio buffering at its 960 ms maximum: a Cut about 1.0 s, a 300 ms Fade about 1.3 s), when
    // its T-bar cursor already reads idle. Any selection can follow a transition (a cut pressed just after a take, its
    // put-back, a Fade lent right after a cut), so each keeps being sent for well past that: 120 polls 25 ms apart, 3 s or
    // more. The self-tests shorten SelectPolls where they run the whole wait on purpose.
    internal int SelectPolls { get; init; } = 120;
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
                        sweep = null; Position = 0; needsReset = false; // the failed cancel's Disarm set it
                        said = "T-bar: could not go back to Program after the reconnect. " + e.Message + " Check OBS, then press Cancel.";
                    }
                }
            }
            try { await RepayAsync(); }
            catch (InvalidOperationException e) when (said.Length > 0) { throw new InvalidOperationException(said + " " + e.Message, e); }
            return said;
        }
        finally { serial.Release(); }
    }

    public Task CancelAsync() => DispatchAsync("fader.cancel");

    /// <summary>
    /// Run when a connection ends while OBS is still there: puts back a transition still owed (a lent Fade a failed
    /// sweep left behind, or a cut's), latch or not, so the debt does not end with this fader.
    /// </summary>
    public async Task SettleAsync()
    {
        await serial.WaitAsync();
        try { await RepayAsync(); }
        finally { serial.Release(); }
    }

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

    /// <param name="pressedAt">When the control was pressed (a Stopwatch timestamp), if known. A take or cut pressed while an
    /// earlier one still waited for OBS is then caught as a double press, though it runs only afterwards.</param>
    public async Task DispatchAsync(string action, long pressedAt = 0)
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
                    // A second take within 450 ms of the last is a double press, and so is one pressed before the last
                    // went out (a cut can wait about 1 s for OBS). Measured from the press when it is known.
                    if (takeAt != 0 && Stopwatch.GetElapsedTime(takeAt, pressedAt != 0 ? pressedAt : Stopwatch.GetTimestamp()).TotalMilliseconds < 450) return;
                    if (sweep != null) await FinishAndReturnAsync();
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

    private static string OverrideRefusal(string sceneOverride, string fade) =>
        $"The Preview scene has its own transition, {sceneOverride}. Set its transition override to {fade} or none for a manual mix.";

    /// <summary>
    /// The T-bar mixes with a Fade. With anything else selected (the Cut a cut left behind, a Stinger) the first Fade
    /// in OBS's list is selected for this sweep, and the operator's transition is owed back from the moment the sweep
    /// ends. OBS is left untouched when the sweep cannot start.
    /// </summary>
    /// <returns>The selected Fade as OBS reads it back.</returns>
    private async Task<JsonObject> LendFadeAsync(Scenes scenes, string original, string? sceneOverride)
    {
        var list = await rpc("GetSceneTransitionList", null);
        string fade = list["transitions"]?.AsArray().OfType<JsonObject>()
            .Where(tr => (string?)tr["transitionKind"] == "fade_transition").Select(tr => Field(tr, "transitionName")).FirstOrDefault()
            ?? throw new InvalidOperationException($"OBS has {original} selected and no Fade transition for the T-bar to mix with. Add a Fade in OBS's Scene Transitions.");
        if (!string.IsNullOrEmpty(sceneOverride) && sceneOverride != fade)
            throw new InvalidOperationException(OverrideRefusal(sceneOverride, fade));
        // A slider that cannot move would only fail at the first write: find out before the selection changes.
        if (nativeMove != null) await nativeMove(0, 0);
        var watch = owed is { Lent: false } cut && cut.Original == original ? cut : null; // a cut's watch resumes afterwards
        owed = new(fade, original, 0, Lent: true, Resume: watch); // owed before the request: an unanswered selection may still land
        bool confirmed = false;
        try
        {
            // Right after a take or cut OBS drops selections for about a second: re-send until it takes it.
            await SelectTransitionAsync(original, fade);
            confirmed = true;
            // Selecting takes a moment: nothing else may change meanwhile.
            if (await ReadScenesAsync() != scenes) throw new InvalidOperationException("Program or Preview changed before the T-bar moved.");
            await RequireIdleAsync();
            var transition = await rpc("GetCurrentSceneTransition", null);
            if (Field(transition, "transitionName") != fade || Field(transition, "transitionKind") != "fade_transition")
                throw new InvalidOperationException("The selected OBS transition changed before the T-bar moved.");
            return transition;
        }
        catch
        {
            // Put the operator's transition back at once. What OBS will not take yet stays owed for the next action.
            try { await ReturnAsync(fade, original, confirmed, lent: true, failurePrefix: "", resume: watch); }
            catch (Exception) { } // the first failure is the one to report
            throw;
        }
    }

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
                transition = await LendFadeAsync(scenes, Field(transition, "transitionName"), sceneOverride);
            else if (!string.IsNullOrEmpty(sceneOverride) && sceneOverride != Field(transition, "transitionName"))
                throw new InvalidOperationException(OverrideRefusal(sceneOverride, Field(transition, "transitionName")));
            sweep = new Sweep(scenes, Field(transition, "transitionUuid"));
        }
        if (next == 0) { await CancelSweepAsync(); await RepayAsync(); return; }
        if (next == 1) { await FinishAndReturnAsync(); return; }
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

    /// <summary>Takes with the sweep, then puts back a transition the sweep borrowed.</summary>
    private async Task FinishAndReturnAsync()
    {
        await FinishSweepAsync();
        try { await RepayAsync(); }
        catch (InvalidOperationException e) { throw new InvalidOperationException("Preview taken, but " + e.Message, e); }
        finally { takeAt = Stopwatch.GetTimestamp(); } // a restore can take a while: a held trigger must not take straight back
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

    private async Task SelectTransitionAsync(string from, string to)
    {
        await rpc("SetCurrentSceneTransition", new() { ["transitionName"] = to });
        // The OBS frontend queues the selection on its UI thread. The RPC can return first.
        for (int attempt = 0; attempt < SelectPolls; attempt++)
        {
            var selected = await ReadTransitionNameAsync();
            if (selected == to) return;
            if (selected != from) throw new InvalidOperationException("The selected OBS transition changed to " + selected + ".");
            // OBS also silently ignores SetTransition while it counts a transition as running, which outlasts the
            // picture (the tail of a Cut or a Fade). A selection is safe to send again, a Take never.
            if (attempt > 0 && attempt % 4 == 0)
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
            // Say whether the cut was sent, so nobody presses it again to "retry".
            if (requestedCut) await ReturnAsync(replacement!, previous!, confirmedCut, lent: false, triggered ? "Cut sent, but " : "No cut sent: ");
        }
    }

    /// <summary>
    /// Puts back what a Cut or a sweep borrowed and records the debt: OBS may drop the write while its transition is
    /// still active, or switch back afterwards, and the next action checks again.
    /// </summary>
    private async Task ReturnAsync(string borrowed, string original, bool confirmed, bool lent, string failurePrefix, Owed? resume = null)
    {
        owed = new(borrowed, original, Stopwatch.GetTimestamp(), lent, resume);
        var selected = await ReadTransitionNameAsync();
        // An unconfirmed selection may still be queued behind the stale read. Queue the
        // original after it, but leave a third-party selection alone.
        if (selected == borrowed || (!confirmed && selected == original))
        {
            try { await SelectTransitionAsync(borrowed, original); }
            catch (InvalidOperationException e)
            {
                if (await ReadTransitionNameAsync() != borrowed) { owed = null; throw; }
                throw new InvalidOperationException(failurePrefix +
                    $"OBS stayed on {borrowed}. {original} goes back with your next take, cut, T-bar move or Cancel within 30 s; after that, choose it in OBS.", e);
            }
            finally
            {
                // The watch starts when our restore attempt ends, not before its retries.
                if (owed != null) owed = owed with { At = Stopwatch.GetTimestamp() };
            }
            // Even a confirmed read-back of a cut's original stays owed: OBS can still return to Cut. A lent Fade is
            // settled, and the cut watch it replaced, if any, carries on.
            if (lent) owed = resume;
        }
        // Already back on the original: after a cut still watch for OBS returning to Cut. A third transition is the operator's.
        else if (selected == original) owed = lent ? resume : owed! with { At = Stopwatch.GetTimestamp() };
        else owed = null;
    }

    /// <summary>Puts back the transition a recent Cut, or a finished sweep, borrowed if OBS is still on it.</summary>
    private async Task RepayAsync()
    {
        // A running sweep still uses what it borrowed: never swap the transition under a mix.
        if (sweep != null || owed is not var (borrowed, original, at, lent, resume)) return;
        if (at == 0)
        {
            // The sweep is over, but OBS drops every selection while its T-bar still sits part-way: the watch starts
            // only once OBS is idle, so the debt cannot lapse before it could be paid.
            if (await ReadCursorAsync() is not (0 or 1))
                throw new InvalidOperationException($"The T-bar in OBS is still part-way. Drag it to either end in OBS, then press Cancel to put {original} back.");
            owed = new(borrowed, original, at = Stopwatch.GetTimestamp(), lent, resume);
        }
        // After half a minute a borrowed selection is more likely the operator's own choice than our leftover.
        if (Stopwatch.GetElapsedTime(at).TotalMilliseconds > OwedForMs) { owed = null; return; }
        var selected = await ReadTransitionNameAsync();
        // Still on the original: after a cut keep watching, since OBS (or a late, unconfirmed Cut) may switch to Cut
        // afterwards. A Fade the T-bar lent is simply back.
        if (selected == original) { if (lent) owed = resume; return; }
        if (selected == borrowed)
        {
            try { await SelectTransitionAsync(borrowed, original); }
            catch (InvalidOperationException e)
            {
                // The operator chose another transition meanwhile: theirs stands.
                if (await ReadTransitionNameAsync() == borrowed)
                    throw new InvalidOperationException($"OBS is still on {borrowed}. Choose {original} in OBS, or press Cancel to try again.", e);
            }
        }
        owed = lent ? resume : null;
    }
}
