// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>Relative gain of public, non-composite OBS audio inputs. It never changes OBS mute, monitor or track settings.</summary>
internal sealed class MixDesk(BridgeConfig cfg, Func<string, JsonObject?, Task<JsonObject>> rpc)
{
    private const int AudioFlag = 2, CompositeFlag = 64;
    private readonly SemaphoreSlim gate = new(1);
    private readonly CancellationTokenSource lifetime = new();
    private MixJournal? state;
    private string collection = "", journalPath = "";
    private HashSet<Guid> inputs = [];
    // WebSocket publishes volume events independently of setter replies. Keep a bounded queue
    // of own writes so a hand move stays latched even when an already-sent write also succeeds.
    private sealed class Events(double level)
    {
        public readonly List<double> Expected = [];
        public double Last = level;
        public bool Manual;
    }
    private readonly Dictionary<Guid, Events> events = [];
    private long inventoryTime, generation;
    private Task? monitor;
    private double gain = 1, target = 1;
    private bool changing, recovering, stopped;
    private string? error;

    internal double Db => ToDb(Volatile.Read(ref gain));
    private static double ToDb(double value) => value <= 0 ? -100 : 20 * Math.Log10(value);
    private static double ToGain(double db) => db <= -100 ? 0 : Math.Pow(10, db / 20);
    private static bool Near(double a, double b) => a == b || Math.Abs(a - b) <= Math.Max(Math.Abs(a), Math.Abs(b)) * 1e-6;
    private static string Display(double scale) => scale == 0 ? "silence" : $"{ToDb(scale):F1} dB";
    internal void OnVolume(Guid id, double actual)
    {
        lock (events)
        {
            if (!events.TryGetValue(id, out var e)) return;
            int own = e.Expected.FindIndex(x => Near(x, actual));
            if (own >= 0) e.Expected.RemoveRange(0, own + 1);
            else if (!Near(e.Last, actual)) e.Manual = true;
            e.Last = actual;
        }
    }
    private bool MayWrite(Guid id, double actual, double? reserve = null)
    {
        lock (events)
        {
            if (!events.TryGetValue(id, out var e)) events[id] = e = new(actual);
            if (e.Manual) return false;
            if (reserve is double wanted) { if (e.Expected.Count == 64) e.Expected.RemoveAt(0); e.Expected.Add(wanted); }
            return true;
        }
    }
    private void RequireEnabled()
    {
        if (!cfg.MixEnabled) throw new InvalidOperationException("All mixer inputs is off. Enable grouped mixer control in setup first.");
        if (stopped) throw new InvalidOperationException("Mixer session is closed.");
    }

    internal void StartMonitor()
    {
        if (cfg.MixEnabled && monitor is null && !stopped) monitor = Watch();
    }

    internal async Task Stop()
    {
        lifetime.Cancel();
        await gate.WaitAsync();
        try { stopped = true; generation++; changing = false; }
        finally { gate.Release(); }
        if (monitor != null) await monitor;
        // Do not unexpectedly raise a live mix on shutdown. Recovery uses the persisted UUID baselines.
    }

    private async Task<string> CurrentCollection()
    {
        var scene = await rpc("GetSceneCollectionList", null);
        return scene["currentSceneCollectionName"]?.GetValue<string>() is { Length: > 0 } name ? name :
            throw new InvalidOperationException("OBS has no current scene collection.");
    }

    private async Task SelectScope()
    {
        var actual = await CurrentCollection();
        if (actual == collection) return;
        var path = MixJournal.Location(cfg.MixStateDirectory, cfg.Port, actual);
        var loaded = MixJournal.Read(path, cfg.Port, actual);
        generation++; changing = false; collection = actual; journalPath = path; state = loaded;
        gain = target = loaded?.Gain ?? 1; recovering = loaded != null;
        inputs.Clear(); lock (events) events.Clear(); inventoryTime = 0; error = null;
    }

    internal async Task<JsonObject> Status()
    {
        await gate.WaitAsync();
        try
        {
            if (cfg.MixEnabled && !stopped) await SelectScope();
            return new()
            {
                ["enabled"] = cfg.MixEnabled,
                ["active"] = state != null,
                ["gain"] = gain,
                ["silent"] = gain == 0,
                ["db"] = gain == 0 ? null : ToDb(gain),
                ["targetDb"] = target == 0 ? null : ToDb(target),
                ["fading"] = changing,
                ["managed"] = state?.Members.Count(p => !p.Value.LeftToOperator) ?? 0,
                ["skipped"] = state?.Members.Count(p => p.Value.LeftToOperator) ?? 0,
                ["recovering"] = recovering,
                ["error"] = error
            };
        }
        finally { gate.Release(); }
    }

    internal async Task<string> Describe()
    {
        var s = await Status();
        if (!cfg.MixEnabled) return "All mixer inputs: off.";
        return $"All mixer inputs: {Display(s["gain"]!.GetValue<double>())}; {s["managed"]} managed, {s["skipped"]} left to operator." +
            (s["recovering"]!.GetValue<bool>() ? " Saved mix: choose Restore to recover original levels." : "") +
            (s["error"] is { } e ? " " + e.GetValue<string>() : "");
    }

    internal async Task<string> Set(double db, int ms)
    {
        if (!double.IsFinite(db) || db is < -100 or > 0 || ms is < 0 or > 10000) throw new ArgumentOutOfRangeException(nameof(db), "Group level is −100 to 0 dB and duration is 0–10000 ms.");
        await gate.WaitAsync();
        try { RequireEnabled(); await SelectScope(); return await Begin(ToGain(db), ms); }
        finally { gate.Release(); }
    }

    internal async Task<string> Step(int steps)
    {
        if (steps is < -32 or > 32) throw new ArgumentOutOfRangeException(nameof(steps));
        await gate.WaitAsync();
        try
        {
            RequireEnabled(); await SelectScope();
            if (steps == 0) return $"All mixer inputs: {Display(gain)}.";
            double db = gain == 0 && steps > 0 ? -60 : ToDb(gain);
            return await Begin(ToGain(Math.Clamp(db + steps * cfg.MixStepDb, -100, 0)), 0);
        }
        finally { gate.Release(); }
    }

    private async Task<string> Begin(double next, int ms)
    {
        long mine = ++generation;
        changing = false; error = null; recovering = false; target = next;
        if (state is null && next == 1) return "All mixer inputs: unity (0 dB); no input levels changed.";
        try
        {
            state ??= new MixJournal { Collection = collection, Port = cfg.Port };
            await Discover();
            if (ms == 0 || gain == next)
            {
                int skipped = await Apply(next, next == 1);
                return $"All mixer inputs: {Display(next)}." + (skipped > 0 ? $" Left {skipped} externally adjusted input(s) unchanged." : "");
            }
            double from = gain;
            // Capture baselines and reconcile any pending transaction before acknowledging the fade.
            await Apply(from, false);
            changing = true;
            _ = Fade(mine, from, next, ms);
            return $"All mixer inputs: fading to {Display(next)} over {ms} ms.";
        }
        catch (Exception e) { Pause(e); throw; }
    }

    private void Pause(Exception e)
    {
        generation++; changing = false; recovering = state != null; error = e.Message;
        // Always reconcile against the durable intent on the next explicit command.
        if (journalPath.Length != 0 && File.Exists(journalPath))
        {
            state = MixJournal.Read(journalPath, cfg.Port, collection);
            gain = state?.Gain ?? 1;
        }
        target = gain;
    }

    private async Task Discover()
    {
        var reply = await rpc("GetInputList", null);
        var rows = reply["inputs"]?.AsArray() ?? throw new InvalidDataException("OBS did not return its inputs.");
        var visible = new HashSet<Guid>();
        foreach (var row in rows)
        {
            int caps = row?["inputKindCaps"]?.GetValue<int>() ?? throw new InvalidOperationException("OBS did not provide input capabilities. No unverified inputs will be adjusted.");
            if ((caps & AudioFlag) == 0 || (caps & CompositeFlag) != 0) continue;
            if (Guid.TryParse(row!["inputUuid"]?.GetValue<string>(), out var uuid) && uuid != Guid.Empty) visible.Add(uuid);
        }
        inputs = visible; inventoryTime = Stopwatch.GetTimestamp();
    }

    private async Task<(Guid Id, double? Volume)> Read(Guid id)
    {
        try
        {
            var response = await rpc("GetInputVolume", new() { ["inputUuid"] = id.ToString() });
            double level = response["inputVolumeMul"]!.GetValue<double>();
            if (!double.IsFinite(level) || level is < 0 or > 20) throw new InvalidDataException("OBS supplied an unsupported mixer level.");
            return (id, level);
        }
        catch (ObsError e) when (e.Code is 600 or 604) { return (id, null); } // Item removed or no longer audio-capable.
    }

    private async Task<int> Apply(double next, bool finish)
    {
        if (await CurrentCollection() != collection) throw new InvalidOperationException("Scene collection changed; the former mix is saved for recovery.");
        var s = state ?? throw new InvalidOperationException("Mixer state unavailable.");
        var readings = await Task.WhenAll(inputs.Where(id => !s.Members.TryGetValue(id, out var m) || !m.LeftToOperator).Select(Read));
        var writes = new List<(Guid Id, MixMember Member, double Value)>();
        bool dirty = s.Gain != next;
        foreach (var (id, value) in readings)
        {
            if (value is not double actual) continue;
            if (!s.Members.TryGetValue(id, out var m))
            {
                if (finish) continue; // Never restore an input we did not manage.
                m = new() { Original = actual, Applied = actual }; s.Members[id] = m; dirty = true;
            }
            if (!MayWrite(id, actual) || (!Near(actual, m.Applied) && !(m.Pending is double pending && Near(actual, pending))))
            {
                m.LeftToOperator = true; m.Pending = null; dirty = true; continue;
            }
            if (m.Pending.HasValue) { m.Applied = actual; m.Pending = null; dirty = true; }
            double wanted = m.Original * next;
            if (!Near(actual, wanted)) { m.Pending = wanted; writes.Add((id, m, wanted)); }
        }
        if (writes.Count > 0)
        {
            s.Save(journalPath); // Both previous and proposed levels can be reconciled after interruption.
            if (await CurrentCollection() != collection) throw new InvalidOperationException("Scene collection changed before the mixer write.");
            await Task.WhenAll(writes.Select(async w =>
            {
                if (!MayWrite(w.Id, w.Member.Applied, w.Value)) { w.Member.LeftToOperator = true; w.Member.Pending = null; return; }
                try
                {
                    await rpc("SetInputVolume", new() { ["inputUuid"] = w.Id.ToString(), ["inputVolumeMul"] = w.Value });
                    w.Member.Applied = w.Value;
                    if (!MayWrite(w.Id, w.Value)) w.Member.LeftToOperator = true;
                }
                catch (ObsError e) when (e.Code == 600) { } // Removed between discovery and write.
                w.Member.Pending = null;
            }));
            dirty = true;
        }
        gain = s.Gain = next;
        int skipped = s.Members.Count(p => p.Value.LeftToOperator);
        if (finish) { if (File.Exists(journalPath)) File.Delete(journalPath); state = null; recovering = false; lock (events) events.Clear(); }
        else if (dirty || !File.Exists(journalPath)) s.Save(journalPath);
        return skipped;
    }

    private async Task Fade(long mine, double from, double to, int ms)
    {
        long began = Stopwatch.GetTimestamp();
        try
        {
            while (true)
            {
                await Task.Delay(35, lifetime.Token);
                await gate.WaitAsync(lifetime.Token);
                try
                {
                    if (mine != generation || stopped) return;
                    double fraction = Math.Min(1, Stopwatch.GetElapsedTime(began).TotalMilliseconds / ms);
                    if (fraction == 1 || Stopwatch.GetElapsedTime(inventoryTime).TotalMilliseconds >= 700) await Discover();
                    await Apply(fraction == 1 ? to : from + (to - from) * fraction, fraction == 1 && to == 1);
                    if (fraction == 1) { changing = false; Console.WriteLine($"All mixer inputs reached {Display(to)}."); return; }
                }
                catch (Exception e) { Pause(e); Console.WriteLine("Mixer fade stopped: " + e.Message); return; }
                finally { gate.Release(); }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }

    private async Task Watch()
    {
        try
        {
            while (true)
            {
                await Task.Delay(750, lifetime.Token);
                await gate.WaitAsync(lifetime.Token);
                try
                {
                    if (stopped || changing || recovering || state is null) continue;
                    await SelectScope();
                    if (state is null || recovering) continue;
                    await Discover(); await Apply(gain, false);
                }
                catch (Exception e) { Pause(e); Console.WriteLine("Grouped mixer paused: " + e.Message); }
                finally { gate.Release(); }
            }
        }
        catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
    }
}
