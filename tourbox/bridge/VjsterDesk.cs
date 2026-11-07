// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster side of the TourBox companion: the actions that go to the Chrome
// extension over the VJster link (docs/vjster/REQUIREMENTS.md section 2) and
// the host that keeps the link up, outside the OBS connection loop, so the
// video can be driven with OBS closed.

using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace Fadester.TourBox;

internal sealed record KeyInput(string Action, int Generation, long Timestamp);

/**
 * Side + Dial and Top + Dial must not move Program if Console sends one detent as the plain Dial. The bridge sees only
 * shortcuts, not which buttons are held, so this is a time window and a partial guard: it cannot catch a stray tick
 * before the first held turn or after a pause, and a deliberate fade in the window loses its first ticks.
 */
internal static class KeyGuards
{
    public static readonly TimeSpan AfterHeldTurn = TimeSpan.FromMilliseconds(400);
    public static bool IsHeldDialTurn(string action) => action is "music.up" or "music.down" or "layer2.opacity.up" or "layer2.opacity.down";
    public static bool IsFaderTick(string action) => action is "fader.back" or "fader.forward" or "fader.fineBack" or "fader.fineForward";
    /** Turn ticks drop sooner when late: a stale one would keep moving something after the hand stops. */
    public static bool IsTurnTick(string action) => IsFaderTick(action) || action is "layer2.opacity.up" or "layer2.opacity.down"
        or "layer1.blend.previous" or "layer1.blend.next" or "layer2.blend.previous" or "layer2.blend.next";
    public static bool IsStrayFaderTick(string action, long lastHeldTurn, long at) => IsFaderTick(action) && lastHeldTurn != 0 && Stopwatch.GetElapsedTime(lastHeldTurn, at) < AfterHeldTurn;
}

internal sealed class VjsterDesk(VjsterLink link)
{
    public static readonly HashSet<string> Actions = new(("vjster.speed.down vjster.speed.up vjster.speed.fineDown vjster.speed.fineUp vjster.speed.reset " +
        "vjster.quality.down vjster.quality.up vjster.quality.reset vjster.playPause vjster.status").Split(' '));
    /** Turn actions: a detent that arrives late is dropped rather than applied (Program.Listen's sweep rule). */
    public static readonly HashSet<string> Ticks = new(["vjster.speed.down", "vjster.speed.up", "vjster.speed.fineDown", "vjster.speed.fineUp", "vjster.quality.down", "vjster.quality.up"]);
    public static readonly TimeSpan ReplyTimeout = TimeSpan.FromMilliseconds(600);
    static readonly Dictionary<string, int> Heights = new() { ["hd2160"] = 2160, ["hd1440"] = 1440, ["hd1080"] = 1080, ["hd720"] = 720, ["large"] = 480, ["medium"] = 360, ["small"] = 240, ["tiny"] = 144 };

    public VjsterLink Link => link;

    public async Task<string> Dispatch(string id)
    {
        if (!Actions.Contains(id)) throw new ArgumentException("Unknown VJster action: " + id);
        if (!link.Running) return $"VJster: the link is not running (port {link.Port} is in use).";
        if (!link.Connected) return $"VJster: no Chrome extension is connected on port {link.Port}. Open YouTube in Chrome with the VJster extension.";
        string type;
        Action<JsonObject>? fill = null;
        switch (id)
        {
            case "vjster.speed.down": type = "speed.step"; fill = Step(-0.25); break;
            case "vjster.speed.up": type = "speed.step"; fill = Step(0.25); break;
            case "vjster.speed.fineDown": type = "speed.step"; fill = Step(-0.05); break;
            case "vjster.speed.fineUp": type = "speed.step"; fill = Step(0.05); break;
            case "vjster.speed.reset": type = "speed.reset"; break;
            case "vjster.quality.down": type = "quality.step"; fill = o => { o["direction"] = -1; o["hold"] = false; }; break;
            case "vjster.quality.up": type = "quality.step"; fill = o => { o["direction"] = 1; o["hold"] = false; }; break;
            case "vjster.quality.reset": type = "quality.reset"; break;
            case "vjster.playPause": type = "transport.toggle"; break;
            default: type = "state.get"; break;
        }
        var reply = await link.Request(type, fill, ReplyTimeout);
        if (reply == null) return "VJster: the extension disconnected.";
        var (state, error) = reply.Value;
        if (error != null) return "VJster: " + error.Message;
        if (state == null) return $"VJster: sent {id["vjster.".Length..]}; no reply from the extension yet.";
        return Describe(state, id == "vjster.status");
    }

    static Action<JsonObject> Step(double delta) => o => { o["delta"] = delta; o["direct"] = false; o["hold"] = false; };

    /** One line for the panel: what the video is doing now. The title only on a status read. */
    public static string Describe(VjsterState s, bool withTitle)
    {
        if (s.Rate == null && s.Title == null) return "VJster: no video is playing in Chrome.";
        var parts = new List<string> { "Video " + Rate(s.Rate) };
        if (s.Capabilities.Contains("quality")) parts.Add(s.QualityAuto == true ? $"Auto ({Quality(s.Quality)})" : Quality(s.Quality));
        parts.Add(s.Playing ? "playing" : "paused");
        if (s.AdPlaying) parts.Add("ad playing");
        if (s.Pinned) parts.Add("pinned tab");
        if (withTitle && !string.IsNullOrWhiteSpace(s.Title)) parts.Insert(0, s.Title.Trim());
        return string.Join(" · ", parts);
    }

    static string Rate(double? rate) => rate == null ? "—" : rate.Value.ToString("0.##", CultureInfo.InvariantCulture) + "x";
    static string Quality(string? level) => level == null ? "—" : level == "unknown" ? "…" : Heights.TryGetValue(level, out var h) ? h + "p" : level;
}

/** Keeps the VJster link bound (retrying a taken port every 30 s) and runs the VJster actions the hotkeys queue. */
internal sealed class VjsterHost : IAsyncDisposable
{
    public static readonly TimeSpan PortRetry = TimeSpan.FromSeconds(30);
    readonly Action<string> log;
    public VjsterLink Link { get; }
    public VjsterDesk Desk { get; }

    public VjsterHost(BridgeConfig cfg, Action<string> log)
    {
        this.log = log;
        Link = new VjsterLink(cfg.VjsterPort, cfg.VjsterExtensionId.Length == 0 ? null : [cfg.VjsterExtensionId], log);
        Desk = new VjsterDesk(Link);
        // The extension's own reports (a new video, play, pause): without the title, which only a status press shows (R-BEH-5).
        Link.StateReceived += s => { if (s.InReplyTo == null) log(VjsterDesk.Describe(s, false)); };
    }

    public async Task Run(ChannelReader<KeyInput> input, CancellationToken stop)
    {
        var binder = Bind(stop);
        try
        {
            await foreach (var ev in input.ReadAllAsync(stop))
            {
                if (Stopwatch.GetElapsedTime(ev.Timestamp) > TimeSpan.FromMilliseconds(VjsterDesk.Ticks.Contains(ev.Action) ? 180 : 1500)) { log("Discarded stale input: " + ev.Action); continue; }
                try { log(await Desk.Dispatch(ev.Action)); }
                catch (Exception e) { log("Action " + ev.Action + ": " + e.Message); }
            }
        }
        catch (OperationCanceledException) { }
        await binder;
    }

    async Task Bind(CancellationToken stop)
    {
        string? last = null;
        void Once(string message) { if (message != last) { last = message; log(message); } }
        while (!stop.IsCancellationRequested)
        {
            try { await Link.StartAsync(); return; }
            catch (VjsterPortInUseException e)
            {
                Once($"VJster port {e.Port} is in use, probably by the VJster actions in your Stream Deck or OpenDeck software. Remove them from the deck, or choose another port here and on the extension's options page. Trying again every 30 s.");
            }
            catch (System.Net.Sockets.SocketException e)
            {
                Once($"The VJster port could not be opened ({e.SocketErrorCode}). Trying again every 30 s.");
            }
            try { await Task.Delay(PortRetry, stop); } catch (OperationCanceledException) { return; }
        }
    }

    public ValueTask DisposeAsync() => Link.DisposeAsync();
}
