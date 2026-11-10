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
    /** Every control a map may name, in panel order. */
    public static IEnumerable<string> Names => Buttons.Select(b => b.Name).Concat(Analog);
    /** Holding the shift button picks the second layer: "LB+A" and so on. LB is a shift only when a shifted control is mapped. */
    public const string Shift = "LB", ShiftPrefix = "LB+";
    /** Controller-only actions: the TourBox does not have them, so they are not in DeskActions.Supported. */
    public static readonly HashSet<string> PadOnly = ["vjster.speed.fast", "vjster.speed.slow"];
    public static readonly IReadOnlyDictionary<string, string> Defaults = new Dictionary<string, string>
    {
        ["A"] = "take", ["B"] = "take.cut", ["X"] = "media.next", ["Y"] = "media.play",
        ["LB"] = "layer1.blend.previous", ["RB"] = "layer1.blend.next",
        // Up and down walk OBS's scene list as it is drawn, top to bottom; left and right are a volume slider.
        ["DpadUp"] = "preview.previous", ["DpadDown"] = "preview.next", ["DpadLeft"] = "music.down", ["DpadRight"] = "music.up",
        ["View"] = "fader.cancel", ["Menu"] = "preview.sync", ["LS"] = "vjster.speed.reset", ["RS"] = "vjster.playPause",
        ["LT"] = "music.duck", ["LTRelease"] = "music.restore",
        ["LeftUp"] = "layer2.opacity.up", ["LeftDown"] = "layer2.opacity.down",
        ["LeftLeft"] = "layer2.blend.previous", ["LeftRight"] = "layer2.blend.next",
        ["RightLeft"] = "vjster.speed.down", ["RightRight"] = "vjster.speed.up",
        ["RightUp"] = "vjster.speed.fast", ["RightDown"] = "vjster.speed.slow",
    };

    /**
     * A take that cannot push the T-bar (OBS plays its own transition: Cut or another selected) is all or nothing, so in
     * easy mode it keeps the 0.4 s hold; the pad then sends TakeNow, which the dispatch loop runs as the ordinary take.
     */
    public const int OrdinaryTakeMs = 400;
    public const string TakeNow = "take.now";

    /**
     * Letting go of LT sends its action tagged as a release, so the dispatch loop never drops it as offline or late and a
     * ducked Music always comes back (ReleaseMailbox).
     */
    private const string ReleasePrefix = "release:";
    public static string Release(string action) => ReleasePrefix + action;
    /** True for a tagged release; <paramref name="action"/> is the action itself either way. */
    public static bool IsRelease(string id, out string action)
    {
        bool release = id.StartsWith(ReleasePrefix, StringComparison.Ordinal);
        action = release ? id[ReleasePrefix.Length..] : id;
        return release;
    }

    public static bool Known(string id) => (DeskActions.Supported.Contains(id) || PadOnly.Contains(id)) && id != "bridge.reconnect";

    /** A take, cancel, fader tick or Preview cue: the trigger T-bar must return to rest before it throws again. */
    public static bool StopsThrow(string action) =>
        action is "take" or "take.cut" or "fader.cancel" or "preview.previous" or "preview.next" or "preview.sync" ||
        action.StartsWith("anchor.", StringComparison.Ordinal) || KeyGuards.IsFaderTick(action);

    /**
     * Easy mode: how long a control must be held before this action fires (0: at once). Live actions change the picture or
     * sound on air at once; disruptive ones are hard to undo in the moment.
     */
    public static int HoldMs(string action) => action switch
    {
        "mix.fadeOut" or "mic.mute" => 700,
        // A take that pushes the T-bar moves it only while held (PadTbar.Slide), so a short wait is enough to ignore a
        // bump; one OBS plays by itself waits for OrdinaryTakeMs.
        "take" => 150,
        "take.cut" or "overlay.show" or "overlay.hide" or "media.previous" or "media.next" or "media.restart" or
            "media.play" or "vjster.playPause" or "layer1.blend.previous" or "layer1.blend.next" or "layer2.blend.previous" or
            "layer2.blend.next" => 400,
        _ when KeyGuards.IsFaderTick(action) => 400,
        _ => 0,
    };

    /**
     * A step that makes sense again and again (a volume, opacity, speed or quality step, the next scene or blend mode, a
     * T-bar tick, a transition choice): a held stick repeats it every 200 ms. Anything else (a take, a toggle, a preset, a
     * capture) is sent once per push.
     */
    public static bool Repeats(string action) =>
        action.EndsWith(".up", StringComparison.Ordinal) || action.EndsWith(".down", StringComparison.Ordinal) ||
        action.EndsWith(".fineUp", StringComparison.Ordinal) || action.EndsWith(".fineDown", StringComparison.Ordinal) ||
        KeyGuards.IsFaderTick(action) ||
        action is "preview.previous" or "preview.next" or "layer1.blend.previous" or "layer1.blend.next" or
            "layer2.blend.previous" or "layer2.blend.next" or "transition.previous" or "transition.next" or
            "transition.shorter" or "transition.longer";

    /** The defaults with the operator's changes: a control set to "" is left free. Unknown names are refused with the fix. */
    public static Dictionary<string, string> Build(IReadOnlyDictionary<string, string>? changes)
    {
        var map = new Dictionary<string, string>(Defaults, StringComparer.OrdinalIgnoreCase);
        foreach (var (control, action) in changes ?? new Dictionary<string, string>())
        {
            bool shifted = control.StartsWith(ShiftPrefix, StringComparison.OrdinalIgnoreCase);
            string bare = shifted ? control[ShiftPrefix.Length..] : control;
            if (string.Equals(bare, "RT", StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("The right trigger is the T-bar and cannot be remapped.");
            string? known = Names.FirstOrDefault(n => string.Equals(n, bare, StringComparison.OrdinalIgnoreCase));
            if (known == null || (shifted && known == Shift))
                throw new InvalidDataException($"Unknown game controller control \"{control}\". Use one of: {string.Join(", ", Names)}, or {ShiftPrefix}<control> for the shift layer.");
            string key = shifted ? ShiftPrefix + known : known;
            var id = (action ?? "").Trim();
            if (id.Length == 0) { map.Remove(key); continue; }
            if (!Known(id))
                throw new InvalidDataException($"Unknown action \"{id}\" for the game controller's {key}. Use an action id from presets/map.json.");
            if (known == "LTRelease" && HoldMs(id) > 0)
                throw new InvalidDataException($"{key} fires when the trigger is let go, so it cannot be {id}. Put {id} on a press.");
            map[key] = id;
        }
        // A duck with no restore on the same layer would leave Music down after the trigger is let go.
        foreach (var layer in new[] { "", ShiftPrefix })
            if (map.GetValueOrDefault(layer + "LT") == "music.duck" && !map.ContainsKey(layer + "LTRelease"))
                throw new InvalidDataException($"{layer}LT ducks Music, so {layer}LTRelease must bring it back: set it to music.restore.");
        // With a shift layer LB is the shift and nothing else: a tap on it would otherwise fire only on release, late.
        if (map.Keys.Any(k => k.StartsWith(ShiftPrefix, StringComparison.OrdinalIgnoreCase))) map.Remove(Shift);
        return map;
    }
}

/// <summary>
/// The right trigger as a spring-loaded T-bar. It arms only from rest, takes at full travel and then stays disarmed until the
/// trigger is back at rest, so the spring's return never starts a throw back. A pull released before the end cancels.
/// A held take button can also push it towards the end like a hand on a real T-bar (<see cref="Slide"/>).
/// </summary>
internal sealed class PadTbar
{
    public const double Rest = 0.03, Full = 0.97;
    private enum Phase { Disarmed, Armed, Throwing, Sliding }
    private Phase phase = Phase.Disarmed;
    private double sent, slideFrom;
    private long slideTick, pushedMs, slideNeed;
    private int slideMs;
    private bool slideMoved;

    public bool Throwing => phase == Phase.Throwing;
    public bool Sliding => phase == Phase.Sliding;
    /** A push let go part-way: the T-bar stays at Position until a take, a cancel or a cue. */
    public bool Parked { get; private set; }
    /** Where a push has the T-bar now. */
    public double Position => phase == Phase.Sliding ? slideFrom + (double)pushedMs / slideMs : 0;

    /**
     * Pushes the T-bar from where it is towards the end while the take is held (Next's pushing), at full travel per
     * <paramref name="ms"/>, and takes at the end. Let go and it parks where it is; push again to carry on. The trigger is
     * ignored meanwhile. A cancel, cue, take or refusal ends it like a throw (Disarm), and afterwards the trigger must be
     * back at rest before it throws. Let go of a push from rest before it has gone 5% and it goes back to Program.
     */
    public void Slide(double from, int ms, long nowMs)
    {
        phase = Phase.Sliding; slideFrom = Math.Clamp(from, 0, 0.99); slideMs = Math.Max(1, ms);
        slideNeed = Math.Max(1, (long)Math.Ceiling(Math.Round((1 - slideFrom) * slideMs, 6)));
        slideTick = nowMs; pushedMs = 0; slideMoved = false; sent = 0; Parked = false;
    }

    /** The T-bar position to move to (0 cancels, 1 takes), or null for no change. Pushing: the take is still held. */
    public double? Next(double trigger, long nowMs = 0, bool pushing = true)
    {
        if (phase == Phase.Sliding)
        {
            long elapsed = Math.Max(0, nowMs - slideTick);
            slideTick = nowMs;
            if (pushing) pushedMs += elapsed;
            else if (slideFrom == 0 && Position < 0.05)
            {
                // A push from rest let go almost at once was a slip: nothing stays on air part-mixed.
                bool moved = slideMoved;
                Disarm();
                return moved ? 0 : null;
            }
            if (pushedMs >= slideNeed) { Disarm(); return 1; }
            Parked = !pushing;
            var next = Send(Position);
            if (next != null) slideMoved = true;
            return next;
        }
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
        return Send((trigger - Rest) / (Full - Rest));
    }

    private double? Send(double position)
    {
        // 0 and 1 are reserved for cancel and take, so a throw in progress stays strictly between them.
        double target = Math.Round(Math.Clamp(position, 0.01, 0.99), 2);
        if (Math.Abs(target - sent) < 0.01) return null;
        sent = target;
        return target;
    }

    /** The pad went away: cancel a throw or slide in progress, then wait for rest. */
    public double? Lost() { bool was = phase is Phase.Throwing or Phase.Sliding; Disarm(); return was ? 0 : null; }

    /** A take or cancel came from a button, or OBS refused the throw: ignore the trigger until it is back at rest. */
    public void Disarm() { phase = Phase.Disarmed; sent = 0; Parked = false; }

    /** The last value was not delivered: send the next sample even if the trigger has not moved. */
    public void Resend() => sent = 0;
}

/// <summary>
/// Turns pad samples into action ids and T-bar targets. Pure: the time comes in as milliseconds. In easy mode an action with a
/// hold time (PadControls.HoldMs) fires only once its control has been held that long, at the moment the time is up; a tap
/// fires nothing and leaves a note. The shift layer picks the action, never its hold time.
/// </summary>
internal sealed class PadReader(IReadOnlyDictionary<string, string> map, bool easy = false)
{
    public const double StickThreshold = 0.6, LeftTriggerPress = 0.5, LeftTriggerRelease = 0.2;
    public const long RepeatGuardMs = 150, StickRepeatMs = 200, TapNoteEveryMs = 5000;
    private static readonly string[] Sticks = ["Left", "Right"];
    private readonly bool shiftLayer = map.Keys.Any(k => k.StartsWith(PadControls.ShiftPrefix, StringComparison.OrdinalIgnoreCase));
    private readonly ushort shiftMask = PadControls.Buttons.First(b => b.Name == PadControls.Shift).Mask;
    private PadState last;
    private bool leftHeld, leftBlocked, shiftHeld;
    private string? leftRelease; // the release paired with the press that was accepted, on the layer it was pressed on
    private sealed record Hold(string Action, long Due, string? Release = null);
    private readonly Dictionary<string, Hold> holds = new(StringComparer.Ordinal); // control -> an easy-mode hold in progress
    private readonly Dictionary<string, long> pressedAt = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> nextRepeat = new(StringComparer.Ordinal);
    private readonly Dictionary<string, long> toldTap = new(StringComparer.Ordinal);
    private readonly Dictionary<string, char> stickAxis = new(StringComparer.Ordinal); // 'X' or 'Y' until centred; 'B' blocked
    private string? pushSource; // the control whose take is still held: it pushes the T-bar (PadTbar.Slide) until let go
    private string? takeControl, ordinaryControl; // the last take's control; one waiting to hold out for an ordinary take
    private long now, takeFiredAt, ordinaryDue, toldParked = long.MinValue / 2;
    private bool toldParkedTrigger;

    public PadTbar Tbar { get; } = new();
    /** Lines for the Activity log (a tapped guarded control); the loop prints and clears them. */
    public List<string> Notes { get; } = [];
    /** Whether LT's press was accepted and LT is still held. Read from the dispatch loop's thread (ReleaseMailbox). */
    public bool LeftTriggerHeld => Volatile.Read(ref leftHeld);

    /** OBS refused, or a take, cancel or cue came from elsewhere: no throw, push or ordinary take carries on. */
    public void Disarm() { Tbar.Disarm(); ordinaryControl = null; }

    /**
     * The dispatch loop found that the last take cannot push the T-bar (OBS plays its own transition): in easy mode it is
     * sent as TakeNow only if its control is still held when the full OrdinaryTakeMs hold is up.
     */
    public void HoldForOrdinaryTake()
    {
        if (takeControl == null) return;
        ordinaryControl = takeControl;
        ordinaryDue = takeFiredAt + PadControls.OrdinaryTakeMs - PadControls.HoldMs("take");
    }

    public (List<string> Actions, double? Tbar) Step(PadState s, long nowMs)
    {
        var actions = new List<string>();
        now = nowMs;
        if (!s.Connected)
        {
            // Nothing half-held survives: a hold in progress fires nothing, a ducked Music comes back.
            if (last.Connected && leftHeld && leftRelease != null) Emit(leftRelease, actions, release: true);
            leftHeld = false; leftBlocked = false; leftRelease = null; shiftHeld = false; pushSource = null;
            takeControl = null; ordinaryControl = null;
            holds.Clear(); nextRepeat.Clear(); stickAxis.Clear(); last = PadState.Disconnected;
            return (actions, Tbar.Lost());
        }
        if (!last.Connected)
        {
            // A pad that appears with a button, trigger or stick already held acts on none of them until they are let go.
            last = s;
            shiftHeld = shiftLayer && (s.Buttons & shiftMask) != 0;
            leftBlocked = s.LeftTrigger / 255.0 > LeftTriggerRelease;
            foreach (var stick in Sticks) if (Deflected(s, stick)) stickAxis[stick] = 'B';
            return (actions, Tbar.Next(s.RightTrigger / 255.0, nowMs, pushing: false));
        }
        bool shiftNow = shiftLayer && (s.Buttons & shiftMask) != 0;
        if (shiftNow != shiftHeld)
        {
            // A layer change mid-gesture never finishes it on the other layer: holds end, held controls wait to be let go.
            shiftHeld = shiftNow;
            holds.Clear();
            if (!leftHeld && s.LeftTrigger / 255.0 > LeftTriggerRelease) leftBlocked = true;
            foreach (var stick in Sticks) if (Deflected(s, stick)) { stickAxis[stick] = 'B'; ClearRepeats(stick); }
        }
        ushort pressed = (ushort)(s.Buttons & ~last.Buttons), released = (ushort)(last.Buttons & ~s.Buttons);
        foreach (var (name, mask) in PadControls.Buttons)
        {
            if (shiftLayer && name == PadControls.Shift) continue;
            if ((released & mask) != 0 && holds.Remove(name, out var early)) TapNote(name, early.Action, nowMs);
            if ((pressed & mask) == 0 || !map.TryGetValue(Key(name), out var action)) continue;
            if (pressedAt.TryGetValue(name, out var at) && nowMs - at < RepeatGuardMs) continue;
            pressedAt[name] = nowMs;
            int hold = easy ? PadControls.HoldMs(action) : 0;
            if (hold > 0) holds[name] = new(action, nowMs + hold); else Emit(action, actions, name);
        }
        LeftTrigger(s.LeftTrigger / 255.0, nowMs, actions);
        foreach (var (control, hold) in holds.ToList())
        {
            if (nowMs < hold.Due) continue;
            holds.Remove(control);
            if (control == "LT") { leftHeld = true; leftRelease = hold.Release; }
            Emit(hold.Action, actions, control);
        }
        Stick("Left", s.LeftX / 32767.0, s.LeftY / 32767.0, nowMs, actions);
        Stick("Right", s.RightX / 32767.0, s.RightY / 32767.0, nowMs, actions);
        if (ordinaryControl != null)
        {
            if (!Active(s, ordinaryControl))
            {
                string seconds = (PadControls.OrdinaryTakeMs / 1000.0).ToString("0.0#", System.Globalization.CultureInfo.InvariantCulture);
                Notes.Add($"Game controller: {ActionNames.Control(ordinaryControl)} was let go too soon. OBS plays its own transition here, so a take needs a {seconds} s hold (easy mode).");
                ordinaryControl = null;
            }
            else if (nowMs >= ordinaryDue) { ordinaryControl = null; actions.Add(PadControls.TakeNow); }
        }
        last = s;
        bool pushing = pushSource != null && Active(s, pushSource);
        if (!pushing) pushSource = null; // let go once: a new push needs a new press and its hold
        double trigger = s.RightTrigger / 255.0;
        if (ordinaryControl != null) Tbar.Disarm(); // a take is about to go: the trigger must not start a throw meanwhile
        bool wasParked = Tbar.Parked;
        var next = Tbar.Next(trigger, nowMs, pushing);
        if (Tbar.Parked && !wasParked && nowMs - toldParked >= TapNoteEveryMs)
        {
            toldParked = nowMs; // a stick wobbling round its threshold must not flood the log
            Notes.Add($"Game controller: T-bar left at {Math.Round(Tbar.Position * 100)}%. {ParkedWays()}");
        }
        if (!Tbar.Parked) toldParkedTrigger = false;
        else if (trigger > PadTbar.Rest && !toldParkedTrigger)
        {
            toldParkedTrigger = true;
            Notes.Add("Game controller: the right trigger waits while the T-bar is left part-way. " + ParkedWays());
        }
        return (actions, next);
    }

    private string ParkedWays() =>
        $"Hold {ControlFor("take", "the take")} to carry on, press {ControlFor("take.cut", "a cut")} to finish at once or {ControlFor("fader.cancel", "Cancel")} to go back to Program.";

    private string ControlFor(string action, string otherwise) =>
        map.FirstOrDefault(kv => kv.Value == action && !kv.Key.StartsWith(PadControls.ShiftPrefix, StringComparison.OrdinalIgnoreCase)).Key is { } control
            ? ActionNames.Control(control) : otherwise;

    private string Key(string control) => shiftHeld ? PadControls.ShiftPrefix + control : control;

    /**
     * Control: the button, LT or stick direction that fired the action, for a take that pushes while it is held.
     * Release: letting go of LT, sent tagged (PadControls.Release).
     */
    private void Emit(string action, List<string> actions, string? control = null, bool release = false)
    {
        actions.Add(release ? PadControls.Release(action) : action);
        if (PadControls.StopsThrow(action)) { Tbar.Disarm(); ordinaryControl = null; }
        if (action == "take" && control != null) { pushSource = takeControl = control; takeFiredAt = now; }
    }

    /** Whether a control is still held: a button down, LT past its release point, a stick still pushed that way. */
    private static bool Active(PadState s, string control)
    {
        foreach (var (name, mask) in PadControls.Buttons) if (name == control) return (s.Buttons & mask) != 0;
        if (control == "LT") return s.LeftTrigger / 255.0 > LeftTriggerRelease;
        double value = control switch
        {
            "LeftUp" => s.LeftY, "LeftDown" => -s.LeftY, "LeftRight" => s.LeftX, "LeftLeft" => -s.LeftX,
            "RightUp" => s.RightY, "RightDown" => -s.RightY, "RightRight" => s.RightX, "RightLeft" => -s.RightX,
            _ => 0,
        };
        return value / 32767.0 >= StickThreshold;
    }

    private void TapNote(string control, string action, long nowMs)
    {
        if (toldTap.TryGetValue(control, out var told) && nowMs - told < TapNoteEveryMs) return;
        toldTap[control] = nowMs;
        string seconds = (PadControls.HoldMs(action) / 1000.0).ToString("0.0#", System.Globalization.CultureInfo.InvariantCulture);
        Notes.Add($"Game controller: {ActionNames.Control(control)} was pressed too briefly. Hold it for {seconds} s for {ActionNames.Of(action)} (easy mode).");
    }

    private void LeftTrigger(double lt, long nowMs, List<string> actions)
    {
        if (leftBlocked) { if (lt <= LeftTriggerRelease) leftBlocked = false; return; }
        if (!leftHeld && !holds.ContainsKey("LT") && lt >= LeftTriggerPress)
        {
            string? release = map.GetValueOrDefault(Key("LTRelease"));
            if (!map.TryGetValue(Key("LT"), out var press)) { leftHeld = true; leftRelease = release; return; }
            int hold = easy ? PadControls.HoldMs(press) : 0;
            if (hold > 0) { holds["LT"] = new(press, nowMs + hold, release); return; }
            leftHeld = true; leftRelease = release;
            Emit(press, actions, "LT");
        }
        else if (lt <= LeftTriggerRelease)
        {
            if (holds.Remove("LT", out var early)) TapNote("LT", early.Action, nowMs);
            else if (leftHeld)
            {
                leftHeld = false;
                if (leftRelease != null) Emit(leftRelease, actions, release: true);
                leftRelease = null;
            }
        }
    }

    private static bool Deflected(PadState s, string stick)
    {
        var (x, y) = stick == "Left" ? (s.LeftX / 32767.0, s.LeftY / 32767.0) : (s.RightX / 32767.0, s.RightY / 32767.0);
        return Math.Abs(x) >= StickThreshold || Math.Abs(y) >= StickThreshold;
    }

    private void ClearRepeats(string stick)
    {
        foreach (var d in new[] { "Up", "Down", "Left", "Right" }) nextRepeat.Remove(stick + d);
    }

    /** A stick acts along the axis it was first pushed on, and stays on it until it is back in the centre. */
    private void Stick(string stick, double x, double y, long nowMs, List<string> actions)
    {
        if (Math.Abs(x) < StickThreshold && Math.Abs(y) < StickThreshold) { stickAxis.Remove(stick); ClearRepeats(stick); return; }
        if (stickAxis.TryGetValue(stick, out var axis) && axis == 'B') return;
        if (axis == default) stickAxis[stick] = axis = Math.Abs(x) >= Math.Abs(y) ? 'X' : 'Y';
        if (axis == 'X') { Direction(stick + "Right", x, nowMs, actions); Direction(stick + "Left", -x, nowMs, actions); }
        else { Direction(stick + "Up", y, nowMs, actions); Direction(stick + "Down", -y, nowMs, actions); }
    }

    private void Direction(string direction, double value, long nowMs, List<string> actions)
    {
        if (value < StickThreshold) { nextRepeat.Remove(direction); return; }
        if (!map.TryGetValue(Key(direction), out var action)) return;
        if (nextRepeat.TryGetValue(direction, out var due))
        {
            if (nowMs < due) return;
        }
        else if (easy && PadControls.HoldMs(action) is > 0 and var hold)
        {
            nextRepeat[direction] = nowMs + hold; // a guarded action on a stick: the first step waits like a held button
            return;
        }
        nextRepeat[direction] = PadControls.Repeats(action) ? nowMs + StickRepeatMs : long.MaxValue;
        Emit(action, actions, direction);
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
    private (double From, int Ms)? slide;
    private bool ordinary;

    /** The dispatch loop asks the pad to push the T-bar for a take (PadTbar.Slide). A failure posted after it cancels it. */
    public void Slide(double from, int ms) { lock (gate) slide = (from, ms); }
    public (double From, int Ms)? TakeSlide() { lock (gate) { var s = slide; slide = null; return s; } }
    /** Or, in easy mode, to send the take only after the full hold (PadReader.HoldForOrdinaryTake). A failure cancels it. */
    public void Ordinary() { lock (gate) ordinary = true; }
    public bool TakeOrdinary() { lock (gate) { var o = ordinary; ordinary = false; return o; } }

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
    public void Fail() { lock (gate) { failed = true; target = null; slide = null; ordinary = false; } }
    public bool ConsumeFailure() { lock (gate) { var f = failed; failed = false; return f; } }
}

/// <summary>
/// Letting go of LT (Music back up) on its way from the pad to the dispatch loop. A release is never dropped as offline,
/// late or from an earlier connection: the newest one waits here until the dispatch loop runs it, on this connection or
/// the next. One that has not run by the time LT is held again is dropped, since the trigger is down again.
/// </summary>
internal sealed class ReleaseMailbox
{
    private string? waiting;

    /** The pad let go of LT: keep its action (only the newest). */
    public void Post(string action) => Interlocked.Exchange(ref waiting, action);

    /** The release to run now, once; null when there is none, or when LT is held again. */
    public string? Take(bool leftHeld)
    {
        var action = Interlocked.Exchange(ref waiting, null);
        return leftHeld ? null : action;
    }

    /** A release the dropped connection cut off waits again, unless a newer one is already waiting. */
    public void Return(string action) => Interlocked.CompareExchange(ref waiting, action, null);

    /** Whether a release failed because the connection to OBS dropped, not because OBS refused it: then it runs again. */
    public static bool CutOff(Exception e, bool disconnected) =>
        e is not ObsError && (disconnected || e is IOException or System.Net.WebSockets.WebSocketException);
}

/// <summary>Polls the pad about 60 times a second on its own task and feeds the companion's queue.</summary>
/// <remarks>A release of LT reaches <paramref name="enqueue"/> tagged (PadControls.IsRelease).</remarks>
internal sealed class GamepadLoop(IPadSource source, PadReader reader, TbarMailbox mailbox, Action<string> enqueue, Action postTbar, Action<string> log)
{
    public Task Run(CancellationToken stop) => Task.Run(async () =>
    {
        // The panel reads these three lines for its status line: keep them as they are.
        bool connected = false, told = false;
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
                else if (!told && !connected) log("Game controller not found. Plug it in or turn it on.");
                told = true;
                long now = Environment.TickCount64;
                if (mailbox.ConsumeFailure()) reader.Disarm();
                if (mailbox.TakeSlide() is { } slide) reader.Tbar.Slide(slide.From, slide.Ms, now);
                if (mailbox.TakeOrdinary()) reader.HoldForOrdinaryTake();
                var (actions, tbar) = reader.Step(s, now);
                foreach (var note in reader.Notes) log(note);
                reader.Notes.Clear();
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
