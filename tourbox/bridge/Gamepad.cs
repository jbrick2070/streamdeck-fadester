// SPDX-License-Identifier: GPL-2.0-or-later
using System.Runtime.InteropServices;

namespace Fadester.TourBox;

/// <summary>
/// A game controller as a Fadester surface (docs/gamepad/DESIGN.md, draft 3). The pad is read through XInput, which keeps
/// working while OBS or any other app is in front; a browser page only gets pad input while it has focus.
/// </summary>
internal readonly record struct PadState(bool Connected, ushort Buttons, byte LeftTrigger, byte RightTrigger,
    short LeftX, short LeftY, short RightX, short RightY)
{
    public static readonly PadState Disconnected = default;
}

internal interface IPadSource { PadState Read(); }

/// <summary>The first connected XInput pad (Xbox and XInput-compatible controllers).</summary>
internal sealed class XInputPadSource : IPadSource
{
    [StructLayout(LayoutKind.Sequential)]
    private struct Gamepad { public ushort Buttons; public byte LeftTrigger, RightTrigger; public short LeftX, LeftY, RightX, RightY; }
    [StructLayout(LayoutKind.Sequential)]
    private struct State { public uint PacketNumber; public Gamepad Pad; }
    [DllImport("xinput1_4.dll")] private static extern uint XInputGetState(uint user, out State state);
    private const uint Success = 0;
    private int slot = -1;
    private long nextScan;

    /** The XInput user index in use, or -1 with no pad. */
    public int Slot => slot;

    public PadState Read()
    {
        if (slot >= 0)
        {
            if (XInputGetState((uint)slot, out var s) == Success) return From(s);
            slot = -1;
        }
        // Polling an empty slot is slow in XInput, so look for a new pad once a second only.
        long now = Environment.TickCount64;
        if (now < nextScan) return PadState.Disconnected;
        nextScan = now + 1000;
        for (uint i = 0; i < 4; i++)
            if (XInputGetState(i, out var s) == Success) { slot = (int)i; return From(s); }
        return PadState.Disconnected;
    }

    private static PadState From(State s) =>
        new(true, s.Pad.Buttons, s.Pad.LeftTrigger, s.Pad.RightTrigger, s.Pad.LeftX, s.Pad.LeftY, s.Pad.RightX, s.Pad.RightY);
}

/// <summary>Control names, the default map, and the checks on an operator's own map.</summary>
internal static class PadControls
{
    public static readonly (string Name, ushort Mask)[] Buttons =
    [
        ("DpadUp", 0x0001), ("DpadDown", 0x0002), ("DpadLeft", 0x0004), ("DpadRight", 0x0008),
        ("Menu", 0x0010), ("View", 0x0020), ("LS", 0x0040), ("RS", 0x0080), ("LB", 0x0100), ("RB", 0x0200),
        ("A", 0x1000), ("B", 0x2000), ("X", 0x4000), ("Y", 0x8000),
    ];
    /** LT acts on press and on release; each stick direction repeats while it is held. RT is always the T-bar. */
    public static readonly string[] Analog = ["LT", "LTRelease", "LeftUp", "LeftDown", "LeftLeft", "LeftRight", "RightUp", "RightDown", "RightLeft", "RightRight"];
    public static readonly IReadOnlyDictionary<string, string> Defaults = new Dictionary<string, string>
    {
        ["A"] = "take", ["B"] = "take.cut", ["X"] = "media.next", ["Y"] = "media.play",
        ["LB"] = "layer1.blend.previous", ["RB"] = "layer1.blend.next",
        ["DpadLeft"] = "preview.previous", ["DpadRight"] = "preview.next", ["DpadUp"] = "music.up", ["DpadDown"] = "music.down",
        ["View"] = "fader.cancel", ["Menu"] = "preview.sync", ["LS"] = "vjster.speed.reset", ["RS"] = "vjster.playPause",
        ["LT"] = "music.duck", ["LTRelease"] = "music.restore",
        ["LeftUp"] = "layer2.opacity.up", ["LeftDown"] = "layer2.opacity.down",
        ["RightLeft"] = "vjster.speed.down", ["RightRight"] = "vjster.speed.up",
    };

    /** The defaults with the operator's changes: a control set to "" is left free. Unknown names are refused with the fix. */
    public static Dictionary<string, string> Build(IReadOnlyDictionary<string, string>? changes)
    {
        var map = new Dictionary<string, string>(Defaults, StringComparer.OrdinalIgnoreCase);
        foreach (var (control, action) in changes ?? new Dictionary<string, string>())
        {
            if (string.Equals(control, "RT", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The right trigger is the T-bar and cannot be remapped.");
            string? known = Buttons.Select(b => b.Name).Concat(Analog).FirstOrDefault(n => string.Equals(n, control, StringComparison.OrdinalIgnoreCase));
            if (known == null)
                throw new InvalidDataException($"Unknown game controller control \"{control}\". Use one of: {string.Join(", ", Buttons.Select(b => b.Name).Concat(Analog))}.");
            var id = (action ?? "").Trim();
            if (id.Length == 0) { map.Remove(known); continue; }
            if (!DeskActions.Supported.Contains(id) || id == "bridge.reconnect")
                throw new InvalidDataException($"Unknown action \"{id}\" for the game controller's {known}. Use an action id from presets/map.json.");
            map[known] = id;
        }
        return map;
    }
}

/// <summary>
/// The right trigger as a spring-loaded T-bar. It arms only from rest, takes at full travel and then stays disarmed until the
/// trigger is back at rest, so the spring's return never starts a throw back. A pull released before the end cancels.
/// </summary>
internal sealed class PadTbar
{
    public const double Rest = 0.03, Full = 0.97;
    private enum Phase { Disarmed, Armed, Throwing }
    private Phase phase = Phase.Disarmed;
    private double sent;

    public bool Throwing => phase == Phase.Throwing;

    /** The T-bar position to move to (0 cancels, 1 takes), or null for no change. */
    public double? Next(double trigger)
    {
        if (phase == Phase.Disarmed)
        {
            if (trigger <= Rest) phase = Phase.Armed;
            return null;
        }
        if (phase == Phase.Armed)
        {
            if (trigger <= Rest) return null;
            phase = Phase.Throwing;
        }
        if (trigger >= Full) { phase = Phase.Disarmed; sent = 0; return 1; }
        if (trigger <= Rest) { phase = Phase.Armed; sent = 0; return 0; }
        // 0 and 1 are reserved for cancel and take, so a throw in progress stays strictly between them.
        double target = Math.Round(Math.Clamp((trigger - Rest) / (Full - Rest), 0.01, 0.99), 2);
        if (Math.Abs(target - sent) < 0.01) return null;
        sent = target;
        return target;
    }

    /** The pad went away: cancel a throw in progress, then wait for rest. */
    public double? Lost() { bool was = phase == Phase.Throwing; Disarm(); return was ? 0 : null; }

    /** A take or cancel came from a button, or OBS refused the throw: ignore the trigger until it is back at rest. */
    public void Disarm() { phase = Phase.Disarmed; sent = 0; }

    /** The last value was not delivered: send the next sample even if the trigger has not moved. */
    public void Resend() => sent = 0;
}

/// <summary>Turns pad samples into action ids and T-bar targets. Pure: the time comes in as milliseconds.</summary>
internal sealed class PadReader(IReadOnlyDictionary<string, string> map)
{
    public const double StickThreshold = 0.6, LeftTriggerPress = 0.5, LeftTriggerRelease = 0.2;
    public const long RepeatGuardMs = 150, StickRepeatMs = 200;
    private PadState last;
    private bool leftHeld, leftBlocked;
    private readonly Dictionary<string, long> pressedAt = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> nextRepeat = new(StringComparer.Ordinal);

    public PadTbar Tbar { get; } = new();

    public (List<string> Actions, double? Tbar) Step(PadState s, long nowMs)
    {
        var actions = new List<string>();
        if (!s.Connected)
        {
            if (last.Connected && leftHeld && map.TryGetValue("LTRelease", out var restore)) actions.Add(restore);
            leftHeld = false; leftBlocked = false; nextRepeat.Clear(); last = PadState.Disconnected;
            return (actions, Tbar.Lost());
        }
        if (!last.Connected)
        {
            // A pad that appears with a button, trigger or stick already held acts on none of them until they are let go.
            last = s;
            leftBlocked = s.LeftTrigger / 255.0 > LeftTriggerRelease;
            foreach (var (direction, value) in Directions(s)) if (value >= StickThreshold) nextRepeat[direction] = long.MaxValue;
            return (actions, Tbar.Next(s.RightTrigger / 255.0));
        }
        ushort pressed = (ushort)(s.Buttons & ~last.Buttons);
        foreach (var (name, mask) in PadControls.Buttons)
        {
            if ((pressed & mask) == 0 || !map.TryGetValue(name, out var action)) continue;
            if (pressedAt.TryGetValue(name, out var at) && nowMs - at < RepeatGuardMs) continue;
            pressedAt[name] = nowMs;
            actions.Add(action);
            if (action is "take" or "take.cut" or "fader.cancel" or "preview.previous" or "preview.next" or "preview.sync" || action.StartsWith("anchor.")) Tbar.Disarm();
        }
        double lt = s.LeftTrigger / 255.0;
        if (leftBlocked) { if (lt <= LeftTriggerRelease) leftBlocked = false; }
        else if (!leftHeld && lt >= LeftTriggerPress) { leftHeld = true; if (map.TryGetValue("LT", out var press)) actions.Add(press); }
        else if (leftHeld && lt <= LeftTriggerRelease) { leftHeld = false; if (map.TryGetValue("LTRelease", out var release)) actions.Add(release); }
        foreach (var (direction, value) in Directions(s)) Stick(direction, value, nowMs, actions);
        last = s;
        return (actions, Tbar.Next(s.RightTrigger / 255.0));
    }

    private static IEnumerable<(string, double)> Directions(PadState s)
    {
        yield return ("LeftUp", s.LeftY / 32767.0); yield return ("LeftDown", -s.LeftY / 32767.0);
        yield return ("LeftRight", s.LeftX / 32767.0); yield return ("LeftLeft", -s.LeftX / 32767.0);
        yield return ("RightUp", s.RightY / 32767.0); yield return ("RightDown", -s.RightY / 32767.0);
        yield return ("RightRight", s.RightX / 32767.0); yield return ("RightLeft", -s.RightX / 32767.0);
    }

    private void Stick(string direction, double value, long nowMs, List<string> actions)
    {
        if (value < StickThreshold) { nextRepeat.Remove(direction); return; }
        if (nextRepeat.TryGetValue(direction, out var due) && nowMs < due) return;
        nextRepeat[direction] = nowMs + StickRepeatMs;
        if (map.TryGetValue(direction, out var action)) actions.Add(action);
    }
}

/// <summary>
/// Hands the newest T-bar target from the pad thread to the dispatch loop, one queue entry at a time. A pending cancel or
/// take is never replaced by a mid-throw value: the next sample posts again once it has been handled.
/// </summary>
internal sealed class TbarMailbox
{
    private readonly object gate = new();
    private double? target;
    private bool pending, failed;

    /** True when the caller must queue a marker for the dispatch loop. Dropped: the value was not kept, so send it again. */
    public bool Post(double value) => Post(value, out _);

    public bool Post(double value, out bool dropped)
    {
        lock (gate)
        {
            // A failure the pad has not read yet means it is about to disarm: nothing it computed before that may go out.
            dropped = false;
            if (failed) return false;
            dropped = pending && target is 0 or 1 && value is > 0 and < 1;
            if (dropped) return false;
            target = value;
            if (pending) return false;
            pending = true;
            return true;
        }
    }

    public double? Take() { lock (gate) { pending = false; var t = target; target = null; return t; } }
    public void Fail() { lock (gate) { failed = true; target = null; } }
    public bool ConsumeFailure() { lock (gate) { var f = failed; failed = false; return f; } }
}

/// <summary>Polls the pad about 60 times a second on its own task and feeds the companion's queue.</summary>
internal sealed class GamepadLoop(IPadSource source, PadReader reader, TbarMailbox mailbox, Action<string> enqueue, Action postTbar, Action<string> log)
{
    public Task Run(CancellationToken stop) => Task.Run(async () =>
    {
        bool connected = false;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                PadState s;
                try { s = source.Read(); }
                catch (Exception e) when (e is DllNotFoundException or EntryPointNotFoundException)
                {
                    log("Game controller: XInput is not available on this PC, so the controller is off.");
                    return;
                }
                if (s.Connected != connected)
                {
                    connected = s.Connected;
                    log(connected ? "Game controller connected." : "Game controller disconnected.");
                }
                if (mailbox.ConsumeFailure()) reader.Tbar.Disarm();
                var (actions, tbar) = reader.Step(s, Environment.TickCount64);
                foreach (var action in actions) enqueue(action);
                if (tbar is double value)
                {
                    if (mailbox.Post(value, out bool dropped)) postTbar();
                    else if (dropped) reader.Tbar.Resend();
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log("Game controller: " + e.Message); // one bad sample must not stop the controller for the rest of the show
            }
            try { await Task.Delay(8, stop); } catch (OperationCanceledException) { return; }
        }
    }, stop);
}
