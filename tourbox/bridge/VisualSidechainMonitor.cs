// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>
/// Subscribes to Visual Sidechain's <c>signals_changed</c> and <c>safety_changed</c> vendor events and exposes
/// smoothed band envelopes, locally stepped beat/bar progress, and rate-limited HUD updates (<c>VS-METER: ...</c>
/// at &lt;= 5 Hz, well inside the 10 Hz per-cell rule). Raw <c>kick</c> transients are never read or drawn.
/// </summary>
internal sealed class VisualSidechainMonitor : IDisposable
{
    public const string VendorName = "visual-sidechain";
    public const string HudPrefix = "VS-METER: ";
    public const int MinEmitIntervalMs = 200; // 5 Hz default, strictly inside the 10 Hz cap
    private const double MaxLocalInterpolationSec = 5.0;
    private const double DefaultBpm = 120.0;

    public enum MeterState { Unknown, NotLoaded, Panic, NoAudio, Active }

    public readonly record struct Snapshot(
        MeterState State,
        bool Loaded,
        bool AudioPresent,
        bool Panic,
        double Bpm,
        bool BpmLocked,
        double BeatPhase,
        int BeatIndex,
        double BarPhase,
        long BarIndex,
        double BeatConfidence,
        double SubBass,
        double Bass,
        double Mid,
        double High);

    private readonly Func<string, JsonObject?, Task<JsonObject>> rpc;
    private readonly Action<string>? emit;
    private readonly Func<long> clockMs;
    private readonly object gate = new();
    private readonly Timer? tickTimer;
    private bool disposed;

    private bool loaded;
    private bool notLoaded;
    private bool audioPresent;
    private bool signalPanic;
    private bool safetyPanic;
    private double bpm = DefaultBpm;
    private bool bpmLocked;
    private double beatPhase;
    private int beatIndex;
    private double barPhase;
    private long barIndex;
    private double beatConfidence;
    private double subBass;
    private double bass;
    private double mid;
    private double high;
    private long receivedAtMs;

    private string lastEmitted = "";
    private MeterState lastEmittedState = MeterState.Unknown;
    private long lastEmittedAtMs = long.MinValue / 2;

    public VisualSidechainMonitor(
        Func<string, JsonObject?, Task<JsonObject>> rpc,
        Action<string>? emit = null,
        Func<long>? clockMs = null,
        bool enableBackgroundTick = true)
    {
        this.rpc = rpc;
        this.emit = emit;
        this.clockMs = clockMs ?? (() => Stopwatch.GetTimestamp() * 1000L / Stopwatch.Frequency);
        receivedAtMs = this.clockMs();
        if (emit != null && enableBackgroundTick)
        {
            tickTimer = new Timer(_ => Tick(), null, Timeout.Infinite, Timeout.Infinite);
        }
    }

    public void Attach(ObsConnection obs) => obs.VendorEvent += OnVendorEvent;

    public async Task StartAsync(CancellationToken stop = default)
    {
        try
        {
            var outer = await rpc("CallVendorRequest", new JsonObject
            {
                ["vendorName"] = VendorName,
                ["requestType"] = "get_signals",
                ["requestData"] = new JsonObject()
            }).WaitAsync(stop);
            if (outer["responseData"] is JsonObject data)
            {
                if (data["error"]?.GetValue<string>() is string err && err.Length > 0)
                    MarkNotLoaded();
                else
                    ApplySignals(data, initialRead: true);
            }
            else
            {
                MarkNotLoaded();
            }
        }
        catch (ObsError e) when (e.Code is 600 or 604)
        {
            MarkNotLoaded();
        }
        catch (Exception) when (!stop.IsCancellationRequested)
        {
            // Keep Unknown on transient failure; vendor events can still update live state.
        }
    }

    public void OnVendorEvent(string vendorName, string eventType, JsonObject data)
    {
        if (vendorName != VendorName) return;
        if (eventType == "signals_changed") ApplySignals(data, initialRead: false);
        else if (eventType == "safety_changed") ApplySafety(data);
    }

    public Snapshot Sample() => Sample(clockMs());

    public Snapshot Sample(long nowMs)
    {
        lock (gate)
        {
            return SampleCore(nowMs);
        }
    }

    private Snapshot SampleCore(long nowMs)
    {
        bool panic = signalPanic || safetyPanic;
        MeterState state = notLoaded ? MeterState.NotLoaded
            : !loaded ? MeterState.Unknown
            : panic ? MeterState.Panic
            : !audioPresent ? MeterState.NoAudio
            : MeterState.Active;

        bool canAdvance = loaded && !notLoaded && !panic && (audioPresent || bpmLocked) && bpm > 0;
        if (!canAdvance)
        {
            return new Snapshot(state, loaded, audioPresent, panic, bpm, bpmLocked,
                beatPhase, beatIndex, barPhase, barIndex, beatConfidence, subBass, bass, mid, high);
        }

        double dtSec = Math.Clamp((nowMs - receivedAtMs) / 1000.0, 0.0, MaxLocalInterpolationSec);
        double deltaBeats = dtSec * (bpm / 60.0);
        double beatFromIndex = beatIndex + beatPhase;
        double barBeats0 = Math.Abs(barPhase * 4.0 - beatFromIndex) < 0.35 ? barPhase * 4.0 : beatFromIndex;
        double totalBeats = barBeats0 + deltaBeats;
        double wrappedBeats = PositiveMod(totalBeats, 4.0);
        int steppedBeat = Math.Min(3, (int)Math.Floor(wrappedBeats));
        double steppedBeatPhase = Math.Clamp(wrappedBeats - steppedBeat, 0.0, 1.0);
        double steppedBarPhase = Math.Clamp(wrappedBeats / 4.0, 0.0, 1.0);
        long steppedBarIndex = barIndex + Math.Max(0L, (long)Math.Floor(totalBeats / 4.0));

        return new Snapshot(state, true, audioPresent, false, bpm, bpmLocked,
            steppedBeatPhase, steppedBeat, steppedBarPhase, steppedBarIndex,
            beatConfidence, subBass, bass, mid, high);
    }

    private void MarkNotLoaded()
    {
        string? toEmit;
        lock (gate)
        {
            if (loaded) return;
            notLoaded = true;
            SyncTimerLocked(MeterState.NotLoaded);
            toEmit = PrepareEmissionLocked(SampleCore(clockMs()), clockMs(), forceStateTransition: true);
        }
        if (toEmit != null) emit?.Invoke(toEmit);
    }

    private void ApplySafety(JsonObject data)
    {
        long now = clockMs();
        string? toEmit;
        lock (gate)
        {
            loaded = true;
            notLoaded = false;
            safetyPanic = BoolOr(data, "panic", false);
            var sampled = SampleCore(now);
            SyncTimerLocked(sampled.State);
            toEmit = PrepareEmissionLocked(sampled, now, forceStateTransition: true);
        }
        if (toEmit != null) emit?.Invoke(toEmit);
    }

    private void ApplySignals(JsonObject data, bool initialRead)
    {
        long now = clockMs();
        string? toEmit;
        lock (gate)
        {
            loaded = true;
            notLoaded = false;
            // Older Visual Sidechain builds omit audio_present and beat_confidence and report overall level as "level".
            double level = Clamp01(NumOr(data, "level", NumOr(data, "rms", 0.0)));
            audioPresent = BoolOr(data, "audio_present", level > 0.001);
            signalPanic = BoolOr(data, "panic", false);
            bpm = ClampBpm(NumOr(data, "bpm", bpm));
            bpmLocked = BoolOr(data, "bpm_locked", bpmLocked);
            beatPhase = Clamp01(NumOr(data, "beat_phase", 0.0));
            double nextBarPhase = Clamp01(NumOr(data, "bar_phase", beatPhase / 4.0));
            barPhase = nextBarPhase;
            beatIndex = NormalizeBeatIndex(data["beat_index"], nextBarPhase);
            if (data["bar_index"] != null && TryDouble(data["bar_index"], out double rawBar) && rawBar >= 0)
                barIndex = (long)Math.Truncate(rawBar);
            beatConfidence = Clamp01(NumOr(data, "beat_confidence", 0.0));
            // Smoothed band envelopes only — raw kick is intentionally ignored (P1-3).
            subBass = Clamp01(NumOr(data, "sub_bass", 0.0));
            bass = Clamp01(NumOr(data, "bass", 0.0));
            mid = Clamp01(NumOr(data, "mid", 0.0));
            high = Clamp01(NumOr(data, "high", 0.0));
            receivedAtMs = now;

            var sampled = SampleCore(now);
            SyncTimerLocked(sampled.State);
            toEmit = PrepareEmissionLocked(sampled, now, forceStateTransition: true);
        }
        if (toEmit != null) emit?.Invoke(toEmit);
    }

    public void Tick()
    {
        long now = clockMs();
        string? toEmit;
        lock (gate)
        {
            if (disposed) return;
            var sampled = SampleCore(now);
            SyncTimerLocked(sampled.State);
            toEmit = PrepareEmissionLocked(sampled, now, forceStateTransition: false);
        }
        if (toEmit != null) emit?.Invoke(toEmit);
    }

    public static string FormatHudPayload(Snapshot s) => s.State switch
    {
        MeterState.NotLoaded => HudPrefix + "not_loaded",
        MeterState.Panic => HudPrefix + "panic",
        MeterState.NoAudio => HudPrefix + "no_audio",
        MeterState.Active => string.Create(CultureInfo.InvariantCulture,
            $"{HudPrefix}active {(int)Math.Round(s.Bpm)} {(s.BpmLocked ? 1 : 0)} {s.BeatIndex + 1} {Pct(s.SubBass)} {Pct(s.Bass)} {Pct(s.Mid)} {Pct(s.High)}"),
        _ => ""
    };

    private string? PrepareEmissionLocked(Snapshot sampled, long nowMs, bool forceStateTransition)
    {
        if (emit == null || sampled.State == MeterState.Unknown) return null;
        string payload = FormatHudPayload(sampled);
        if (payload.Length == 0 || payload == lastEmitted) return null;
        bool stateChanged = sampled.State != lastEmittedState;
        if (!(forceStateTransition && stateChanged) && nowMs - lastEmittedAtMs < MinEmitIntervalMs)
            return null;
        lastEmitted = payload;
        lastEmittedState = sampled.State;
        lastEmittedAtMs = nowMs;
        return payload;
    }

    private void SyncTimerLocked(MeterState state)
    {
        if (tickTimer == null || disposed) return;
        if (state == MeterState.Active)
            tickTimer.Change(MinEmitIntervalMs, MinEmitIntervalMs);
        else
            tickTimer.Change(Timeout.Infinite, Timeout.Infinite);
    }

    private static int Pct(double v) => Math.Clamp((int)Math.Round(Clamp01(v) * 100.0), 0, 100);
    private static double Clamp01(double v) => double.IsFinite(v) ? Math.Clamp(v, 0.0, 1.0) : 0.0;
    private static double ClampBpm(double v) => double.IsFinite(v) ? Math.Clamp(v, 30.0, 300.0) : DefaultBpm;
    private static double PositiveMod(double v, double period) { double m = v % period; return m < 0 ? m + period : m; }

    private static int NormalizeBeatIndex(JsonNode? node, double barPhase)
    {
        if (TryDouble(node, out double raw))
            return (int)PositiveMod(Math.Truncate(raw), 4.0);
        return Math.Min(3, (int)Math.Floor(Clamp01(barPhase) * 4.0));
    }

    private static bool BoolOr(JsonObject obj, string key, bool fallback) =>
        obj[key] is JsonValue v && v.TryGetValue<bool>(out bool b) ? b : fallback;

    private static double NumOr(JsonObject obj, string key, double fallback) =>
        TryDouble(obj[key], out double d) ? d : fallback;

    private static bool TryDouble(JsonNode? node, out double value)
    {
        if (node is JsonValue v)
        {
            if (v.TryGetValue<double>(out value) && double.IsFinite(value)) return true;
            if (v.TryGetValue<int>(out int i)) { value = i; return true; }
            if (v.TryGetValue<long>(out long l)) { value = l; return true; }
        }
        value = 0;
        return false;
    }

    public void Dispose()
    {
        lock (gate)
        {
            if (disposed) return;
            disposed = true;
            tickTimer?.Change(Timeout.Infinite, Timeout.Infinite);
        }
        tickTimer?.Dispose();
    }

    internal static async Task RunSelfTestsAsync()
    {
        static void Check(bool ok, string msg) { if (!ok) throw new InvalidOperationException("VisualSidechainMonitor self-test: " + msg); }

        long nowMs = 1000;
        var emitted = new List<string>();

        // 1. Missing Visual Sidechain (code 600) reports NOT LOADED immediately.
        using (var missing = new VisualSidechainMonitor(
            (_, _) => Task.FromException<JsonObject>(new ObsError("CallVendorRequest", 600, "vendor missing")),
            emitted.Add, () => nowMs, enableBackgroundTick: false))
        {
            await missing.StartAsync();
            Check(missing.Sample(nowMs).State == MeterState.NotLoaded, "600 did not set NotLoaded");
            Check(emitted.SequenceEqual(["VS-METER: not_loaded"]), "missing vendor did not emit not_loaded");
        }

        // 2. Active signals, raw kick ignored, local beat stepping, rate cap <= 5 Hz, NO AUDIO and PANIC transitions.
        emitted.Clear();
        using var monitor = new VisualSidechainMonitor(
            (_, _) => Task.FromResult(new JsonObject
            {
                ["responseData"] = new JsonObject
                {
                    ["audio_present"] = true,
                    ["panic"] = false,
                    ["bpm"] = 120.0,
                    ["bpm_locked"] = true,
                    ["beat_phase"] = 0.0,
                    ["beat_index"] = 0,
                    ["bar_phase"] = 0.0,
                    ["bar_index"] = 4,
                    ["beat_confidence"] = 0.9,
                    ["kick"] = 1.0,
                    ["sub_bass"] = 0.8,
                    ["bass"] = 0.6,
                    ["mid"] = 0.4,
                    ["high"] = 0.2
                }
            }),
            emitted.Add, () => nowMs, enableBackgroundTick: false);

        await monitor.StartAsync();
        Check(emitted.Last() == "VS-METER: active 120 1 1 80 60 40 20", "initial active HUD payload mismatch");

        // Changing only raw kick at +250 ms produces no emission because raw kick is ignored and beat 1 has not stepped yet.
        nowMs = 1250;
        monitor.OnVendorEvent(VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["panic"] = false, ["bpm"] = 120.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.5, ["beat_index"] = 0, ["bar_phase"] = 0.125, ["bar_index"] = 4,
            ["kick"] = 0.0, ["sub_bass"] = 0.8, ["bass"] = 0.6, ["mid"] = 0.4, ["high"] = 0.2
        });
        Check(emitted.Count == 1, "raw kick change caused a meter redraw");

        // Rapid band bursts within < 200 ms are throttled inside the 5 Hz (<= 10 Hz) cap.
        for (int i = 1; i <= 10; i++)
        {
            nowMs = 1250 + i * 20; // 1270..1450 ms
            monitor.OnVendorEvent(VendorName, "signals_changed", new JsonObject
            {
                ["audio_present"] = true, ["panic"] = false, ["bpm"] = 120.0, ["bpm_locked"] = true,
                ["beat_phase"] = 0.5, ["beat_index"] = 0, ["bar_phase"] = 0.125, ["bar_index"] = 4,
                ["sub_bass"] = 0.1 * (i % 5), ["bass"] = 0.5, ["mid"] = 0.3, ["high"] = 0.1
            });
        }
        Check(emitted.Count <= 3, "rapid signal events exceeded 5 Hz emission cap");

        // Local beat interpolation without new events: 120 BPM = 500 ms/beat -> +500 ms advances beat_index by 1.
        nowMs = 1450;
        monitor.OnVendorEvent(VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = true, ["panic"] = false, ["bpm"] = 120.0, ["bpm_locked"] = true,
            ["beat_phase"] = 0.0, ["beat_index"] = 0, ["bar_phase"] = 0.0, ["bar_index"] = 5,
            ["sub_bass"] = 0.5, ["bass"] = 0.5, ["mid"] = 0.5, ["high"] = 0.5
        });
        Check(monitor.Sample(1450).BeatIndex == 0, "beat 0 mismatch");
        Check(monitor.Sample(1955).BeatIndex == 1, "local beat interpolation did not step to beat 2");
        Check(monitor.Sample(2455).BeatIndex == 2, "local beat interpolation did not step to beat 3");
        Check(monitor.Sample(2955).BeatIndex == 3, "local beat interpolation did not step to beat 4");
        Check(monitor.Sample(3455).BeatIndex == 0 && monitor.Sample(3455).BarIndex == 6, "local bar wrap mismatch");

        // NO AUDIO state transition emits immediately even within 50 ms.
        nowMs = 1500;
        monitor.OnVendorEvent(VendorName, "signals_changed", new JsonObject
        {
            ["audio_present"] = false, ["panic"] = false, ["bpm"] = 120.0, ["bpm_locked"] = false
        });
        Check(emitted.Last() == "VS-METER: no_audio", "NO AUDIO transition did not emit immediately");

        // safety_changed { panic: true } transitions immediately to PANIC.
        nowMs = 1520;
        monitor.OnVendorEvent(VendorName, "safety_changed", new JsonObject { ["panic"] = true });
        Check(monitor.Sample(nowMs).State == MeterState.Panic && emitted.Last() == "VS-METER: panic", "PANIC transition failed");
    }
}
