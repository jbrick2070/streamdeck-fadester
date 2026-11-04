// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>Serializes individual mixer updates, leaving the input loop free between steps of a fade.</summary>
internal sealed class AudioDesk(Func<string, JsonObject?, Task<JsonObject>> rpc, Func<CancellationToken, IAsyncEnumerable<double>>? steps = null)
{
    private sealed record Edit(string Source, double Start, double Last, long At, bool Ride, long Id);
    private sealed record Duck(string Source, double Start, double Last);
    private sealed class Ramp(string source, double start, double target, bool restore)
    {
        public string Source { get; } = source;
        public double Target { get; } = target;
        public bool Restore { get; } = restore;
        public CancellationTokenSource Stop { get; } = new();
        private readonly List<double> unacknowledged = [];
        private double lastEvent = start;
        private bool external;

        // OBS reports completed input writes on the receive loop, independently of RPC replies.
        // An operator event stays latched even if an already-in-flight bridge write arrives after it.
        public void Observe(double level)
        {
            lock (unacknowledged)
            {
                int index = unacknowledged.FindIndex(value => Near(value, level));
                if (index >= 0) unacknowledged.RemoveRange(0, index + 1);
                else if (!Near(lastEvent, level)) external = true;
                lastEvent = level;
            }
        }
        public bool ReserveWrite(double next)
        {
            lock (unacknowledged)
            {
                if (external) return false;
                unacknowledged.Add(next);
                return true;
            }
        }
        public bool ExternallyAdjusted { get { lock (unacknowledged) return external; } }
    }
    private readonly SemaphoreSlim gate = new(1);
    private volatile Ramp? active;
    private Duck? duck;
    private Edit? undo;
    private long nextId;
    private const int BurstMs = 450, RampMs = 450;
    public void OnVolumeChanged(string source, double level)
    {
        var reading = active;
        if (reading?.Source == source) reading.Observe(level);
    }
    // OBS converts dB to single-precision amplitude and back. Ignore that round trip, not a mixer detent.
    private static bool Near(double a, double b) => Math.Abs(a - b) < 0.002;
    public async Task<double> Read(string source) => Math.Clamp(
        (await rpc("GetInputVolume", new() { ["inputName"] = source }))["inputVolumeDb"]!.GetValue<double>(), -100, 26);
    private Task Write(string source, double db) => rpc("SetInputVolume", new() { ["inputName"] = source, ["inputVolumeDb"] = db });

    private void Interrupt(string source)
    {
        if (active?.Source != source) return;
        active.Stop.Cancel();
        active = null;
    }

    public async Task Stop()
    {
        await gate.WaitAsync();
        try { if (active != null) Interrupt(active.Source); }
        finally { gate.Release(); }
    }

    public async Task<string> Ride(string source, double delta)
    {
        await gate.WaitAsync();
        try
        {
            Interrupt(source);
            if (duck?.Source == source) duck = null;
            double now = await Read(source), next = Math.Clamp(now + delta, -100, 26);
            if (!Near(now, next))
            {
                long stamp = Stopwatch.GetTimestamp();
                double start = undo is { Ride: true } prior && prior.Source == source && Near(prior.Last, now) &&
                    Stopwatch.GetElapsedTime(prior.At, stamp).TotalMilliseconds <= BurstMs ? prior.Start : now;
                await Write(source, next);
                undo = new(source, start, next, stamp, true, ++nextId);
            }
            return $"{source} {next:F2} dB";
        }
        finally { gate.Release(); }
    }

    public async Task<string> Undo()
    {
        await gate.WaitAsync();
        try
        {
            if (undo is not { } edit) return "No level change to undo.";
            Interrupt(edit.Source);
            double now = await Read(edit.Source);
            if (duck?.Source == edit.Source) duck = null;
            if (!Near(now, edit.Last)) { undo = null; return $"Undo skipped: {edit.Source} was adjusted elsewhere."; }
            await Write(edit.Source, edit.Start);
            undo = null;
            return $"Undid {edit.Source} ride: {edit.Start:F2} dB";
        }
        finally { gate.Release(); }
    }

    public async Task<string> Fade(string source, double ceiling, bool restore)
    {
        await gate.WaitAsync();
        try
        {
            if (active?.Source == source && active.Restore == restore) return $"Already fading {source}.";
            Interrupt(source);
            double now = await Read(source);
            if (duck is not null && (!Near(duck.Last, now) || duck.Source != source)) duck = null;
            if (restore && duck is null) return "No unchanged pre-duck level to restore.";
            double target = restore ? duck!.Start : Math.Min(ceiling, now);
            if (Near(target, now))
            {
                if (restore) duck = null;
                return $"{source} already at {target:F2} dB.";
            }
            duck ??= new(source, now, now);
            var ramp = new Ramp(source, now, target, restore);
            active = ramp;
            long id = ++nextId;
            undo = new(source, now, now, Stopwatch.GetTimestamp(), false, id);
            _ = RunRamp(ramp, now, id);
            return $"{(restore ? "Restoring" : "Ducking")} {source} to {target:F2} dB over {RampMs} ms.";
        }
        finally { gate.Release(); }
    }

    private static async IAsyncEnumerable<double> TimedSteps([EnumeratorCancellation] CancellationToken token)
    {
        long began = Stopwatch.GetTimestamp();
        double fraction;
        do
        {
            await Task.Delay(30, token);
            fraction = Math.Min(1, Stopwatch.GetElapsedTime(began).TotalMilliseconds / RampMs);
            yield return fraction;
        } while (fraction < 1);
    }

    private async Task RunRamp(Ramp ramp, double start, long id)
    {
        double previous = start;
        var token = ramp.Stop.Token;
        void Disarm()
        {
            if (undo?.Id == id) undo = null;
            duck = null;
            Console.WriteLine($"Fade stopped: {ramp.Source} was adjusted elsewhere.");
        }
        try
        {
            await foreach (double fraction in (steps ?? TimedSteps)(token))
            {
                await gate.WaitAsync(token);
                try
                {
                    if (active != ramp) return;
                    double actual = await Read(ramp.Source);
                    double level = fraction >= 1 ? ramp.Target : start + (ramp.Target - start) * fraction;
                    if (!Near(previous, actual) || !ramp.ReserveWrite(level))
                    {
                        Disarm();
                        return;
                    }
                    await Write(ramp.Source, level);
                    if (ramp.ExternallyAdjusted) { Disarm(); return; }
                    previous = level;
                    if (duck != null) duck = duck with { Last = level };
                    if (undo?.Id == id) undo = undo with { Last = level };
                    if (fraction >= 1)
                    {
                        if (ramp.Restore) duck = null;
                        Console.WriteLine($"{ramp.Source} reached {level:F2} dB.");
                        return;
                    }
                }
                finally { gate.Release(); }
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        catch (Exception e) { Console.WriteLine("Fade stopped: " + e.Message); }
        finally
        {
            await gate.WaitAsync();
            try { if (active == ramp) active = null; ramp.Stop.Dispose(); }
            finally { gate.Release(); }
        }
    }
}
