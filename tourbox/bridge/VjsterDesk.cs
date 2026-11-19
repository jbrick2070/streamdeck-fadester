// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster side of Fadester Companion: the actions that go to the Chrome
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

/**
 * Midi Fadester's APC40 mkII transport (Tempo knob, Nudge, Tap Tempo, Play) reaches VJster as obs-websocket vendor
 * events ("midi-fadester", "vjster_action"). One request goes out at a time, off the OBS session's own loop; steps that
 * arrive meanwhile add up and the next request carries them all, so a fast spin never floods VJster.
 */
internal sealed class VjsterRemote(VjsterDesk desk, Action<string> log)
{
    public const string Vendor = "midi-fadester", EventType = "vjster_action";
    const int MaxQueued = 16;
    readonly object gate = new();
    bool busy;
    /** What the APC40 asked for, in order: an action id, or (null, n) for n speed steps. Steps in a row add up. */
    readonly List<(string? Action, int Steps)> queued = new();
    string lastLine = "";
    long lastLineAt;

    internal int QueuedCount { get { lock (gate) return queued.Count; } }

    public void OnVendorEvent(string vendorName, string eventType, JsonObject data)
    {
        if (vendorName != Vendor || eventType != EventType) return;
        string? action = data["action"] is JsonValue a && a.TryGetValue<string>(out var text) ? text : null;
        long steps = data["steps"] is JsonValue n ? Math.Clamp(n.TryGetValue<long>(out var l) ? l : n.TryGetValue<int>(out var i) ? i : n.TryGetValue<double>(out var f) && double.IsFinite(f) ? (long)Math.Clamp(f, -80, 80) : 0, -80, 80) : 0;
        lock (gate)
        {
            if (action == "vjster.speed.step")
            {
                if (steps == 0) return;
                if (queued.Count > 0 && queued[^1].Action is null)
                    queued[^1] = (null, (int)Math.Clamp(queued[^1].Steps + steps, -80, 80));
                else if (queued.Count < MaxQueued) queued.Add((null, (int)steps));
                else return;
            }
            else if (action is not null && VjsterDesk.Actions.Contains(action))
            {
                if (action == "vjster.speed.reset") queued.RemoveAll(q => q.Action is null); // steps before 1x are overtaken
                if (queued.Count >= MaxQueued) return;
                queued.Add((action, 0));
            }
            else return;
            if (busy) return;
            busy = true;
        }
        _ = Task.Run(Drain);
    }

    /** One Activity line per answer; the same line again within 3 s (a knob turned with no video open) is said once. */
    void Say(string line)
    {
        if (line.Length == 0) return;
        if (line == lastLine && Stopwatch.GetElapsedTime(lastLineAt) < TimeSpan.FromSeconds(3)) return;
        lastLine = line;
        lastLineAt = Stopwatch.GetTimestamp();
        log("APC40: " + line);
    }

    async Task Drain()
    {
        while (true)
        {
            (string? Action, int Steps) next;
            lock (gate)
            {
                if (queued.Count == 0) { busy = false; return; }
                next = queued[0];
                queued.RemoveAt(0);
            }
            string line;
            try { line = next.Action is not null ? await desk.Dispatch(next.Action) : await desk.SpeedBy(next.Steps); }
            catch (Exception e) { line = e.Message; }
            Say(line);
        }
    }
}

internal sealed class VjsterDesk(VjsterLink link, double fastSpeed = 2.0, double slowSpeed = 0.5, string targetChoice = "browser")
{
    readonly string targetChoice = targetChoice is "obs" or "both" ? targetChoice : "browser";
    // vjster.speed.fast and vjster.speed.slow are game-controller presets: not on the TourBox, so not in DeskActions.Supported.
    public static readonly HashSet<string> Actions = new(("vjster.speed.down vjster.speed.up vjster.speed.fineDown vjster.speed.fineUp vjster.speed.reset vjster.speed.fast vjster.speed.slow " +
        "vjster.quality.down vjster.quality.up vjster.quality.reset vjster.playPause vjster.status").Split(' '));
    /** Turn actions: a detent that arrives late is dropped rather than applied (Program.Listen's sweep rule). */
    public static readonly HashSet<string> Ticks = new(["vjster.speed.down", "vjster.speed.up", "vjster.speed.fineDown", "vjster.speed.fineUp", "vjster.quality.down", "vjster.quality.up"]);
    public static readonly TimeSpan ReplyTimeout = TimeSpan.FromMilliseconds(600);
    static readonly Dictionary<string, int> Heights = new() { ["hd2160"] = 2160, ["hd1440"] = 1440, ["hd1080"] = 1080, ["hd720"] = 720, ["large"] = 480, ["medium"] = 360, ["small"] = 240, ["tiny"] = 144 };

    public VjsterLink Link => link;

    public async Task<string> Dispatch(string id)
    {
        if (!Actions.Contains(id)) throw new ArgumentException("Unknown VJster action: " + id);
        // Any other speed change (Tap Tempo, Nudge, the TourBox) makes the speed steps last asked for out of date:
        // the next step starts from the video's reported speed.
        bool speed = id.StartsWith("vjster.speed.", StringComparison.Ordinal);
        if (speed) ForgetAsked();
        try { return await DispatchCore(id); }
        finally { if (speed) ForgetAsked(); }
    }

    void ForgetAsked() { lock (lastAsked) lastAsked.Clear(); }

    async Task<string> DispatchCore(string id)
    {
        if (!link.Running)
        {
            var holder = await VjsterLink.ProbePortHolderAsync(link.Port);
            return holder is not null
                ? $"VJster link is held by {holder.DisplayName}. Close it or turn off VJster there."
                : $"VJster: the link is not running (port {link.Port} is in use).";
        }
        string[] candidates = this.targetChoice switch
        {
            "obs" => ["obs"],
            "both" => ["browser", "obs"],
            _ => ["browser"]
        };
        string[] open = candidates.Where(link.IsConnected).ToArray();
        if (open.Length == 0)
        {
            return this.targetChoice switch
            {
                "obs" => $"VJster: no OBS video page is connected on port {link.Port}. Add an OBS Browser Source with the VJster URL from Setup.",
                "both" => $"VJster: no Chrome extension or OBS video page is connected on port {link.Port}. Open YouTube in Chrome with VJster or load the /obs Browser Source in OBS.",
                _ => $"VJster: no Chrome extension is connected on port {link.Port}. Open YouTube in Chrome with the VJster extension."
            };
        }
        string type;
        Action<JsonObject>? fill = null;
        switch (id)
        {
            case "vjster.speed.down": type = "speed.step"; fill = Step(-0.25); break;
            case "vjster.speed.up": type = "speed.step"; fill = Step(0.25); break;
            case "vjster.speed.fineDown": type = "speed.step"; fill = Step(-0.05); break;
            case "vjster.speed.fineUp": type = "speed.step"; fill = Step(0.05); break;
            case "vjster.speed.reset": type = "speed.reset"; break;
            case "vjster.speed.fast": type = "speed.set"; fill = Rate(fastSpeed); break;
            case "vjster.speed.slow": type = "speed.set"; fill = Rate(slowSpeed); break;
            case "vjster.quality.down": type = "quality.step"; fill = o => { o["direction"] = -1; o["hold"] = false; }; break;
            case "vjster.quality.up": type = "quality.step"; fill = o => { o["direction"] = 1; o["hold"] = false; }; break;
            case "vjster.quality.reset": type = "quality.reset"; break;
            case "vjster.playPause": type = "transport.toggle"; break;
            default: type = "state.get"; break;
        }
        if (open.Length == 1)
            return FormatReply(id, open[0], await link.Request(type, fill, ReplyTimeout, open[0]));
        var replies = await Task.WhenAll(open.Select(t => link.Request(type, fill, ReplyTimeout, t)));
        return $"Chrome: {FormatReply(id, open[0], replies[0])} | OBS: {FormatReply(id, open[1], replies[1])}";
    }

    static string FormatReply(string id, string target, (VjsterState? State, VjsterError? Error)? reply)
    {
        string peer = target == "obs" ? "OBS video page" : "extension";
        if (reply == null) return $"VJster: the {peer} disconnected.";
        var (state, error) = reply.Value;
        if (error != null) return "VJster: " + error.Message;
        if (state == null) return $"VJster: sent {id["vjster.".Length..]}; no reply from the {peer} yet.";
        return Describe(state, id == "vjster.status", target);
    }

    static Action<JsonObject> Rate(double rate) => o => { o["rate"] = rate; o["direct"] = false; o["hold"] = false; };

    /**
     * The speed a run of steps last asked each target for, so steps that follow faster than the replies still add up,
     * and which video it was for (a step on another video starts from that video's own speed).
     */
    readonly Dictionary<string, (double Rate, long At, string? Video)> lastAsked = new();
    public const double StepRate = 0.05, MinRemoteRate = 0.25, MaxRemoteRate = 4.0;

    static string? VideoOf(VjsterState? s) => s == null ? null : (s.Host ?? "") + "\n" + (s.Title ?? "");

    /**
     * The speeds a step may ask a target for: 0.25x to 4x, narrowed to the lowest and highest speed the video reports
     * (the OBS page's video tops out at 2x), so a run of steps never asks past what the video can play and a step back
     * down moves the video at once.
     */
    internal static (double Min, double Max) StepRange(VjsterState? s)
    {
        var usable = s?.AvailableRates.Where(r => double.IsFinite(r) && r > 0).ToArray() ?? [];
        if (usable.Length == 0) return (MinRemoteRate, MaxRemoteRate);
        double lo = Math.Max(MinRemoteRate, usable.Min()), hi = Math.Min(MaxRemoteRate, usable.Max());
        return hi < lo ? (MinRemoteRate, MaxRemoteRate) : (lo, hi);
    }

    /**
     * Moves the video speed by steps of 0.05x (negative: slower) with one speed.set per target: Midi Fadester's APC40
     * Tempo knob and Nudge buttons (VjsterRemote). The base is the speed last asked for within 1.5 s on the same video,
     * else the video's reported speed, else 1x. The base stays the speed asked for, not the one the video answers:
     * the OBS page's YouTube embed rounds to its own rates (1.05x plays as 1x), so steps must add up until they reach
     * the next one. A step never moves the speed against its direction: from 3x on a video that tops out at 2x, a step
     * up stays at 3x.
     */
    public async Task<string> SpeedBy(int steps)
    {
        if (steps == 0) return "";
        if (!link.Running) return await Dispatch("vjster.status");
        string[] candidates = this.targetChoice switch { "obs" => ["obs"], "both" => ["browser", "obs"], _ => ["browser"] };
        string[] open = candidates.Where(link.IsConnected).ToArray();
        if (open.Length == 0) return await Dispatch("vjster.status");
        var replies = new List<string>();
        foreach (var target in open)
        {
            double rate;
            lock (lastAsked)
            {
                var known = link.GetLastState(target);
                string? video = VideoOf(known);
                double baseRate = lastAsked.TryGetValue(target, out var asked) && asked.Video == video &&
                                  Stopwatch.GetElapsedTime(asked.At) < TimeSpan.FromSeconds(1.5)
                    ? asked.Rate : known?.Rate ?? 1.0;
                var (lo, hi) = StepRange(known);
                double from = Math.Clamp(baseRate, MinRemoteRate, MaxRemoteRate);
                if (steps > 0) hi = Math.Max(hi, from);
                else lo = Math.Min(lo, from);
                rate = Math.Clamp(Math.Round((baseRate + steps * StepRate) * 100) / 100, lo, hi);
                lastAsked[target] = (rate, Stopwatch.GetTimestamp(), video);
            }
            replies.Add(FormatReply("vjster.speed.step", target, await link.Request("speed.set", Rate(rate), ReplyTimeout, target)));
        }
        return open.Length == 1 ? replies[0] : $"Chrome: {replies[0]} | OBS: {replies[1]}";
    }

    static Action<JsonObject> Step(double delta) => o => { o["delta"] = delta; o["direct"] = false; o["hold"] = false; };

    /** The longest title a panel line shows; a longer one ends in "…". */
    internal const int LineTitleChars = 60;

    /**
     * One line for the panel: which video, on which site (when not YouTube), and what it is doing now. Every line names
     * the video, so the operator can tell which tab VJster follows (hand test 2026-11-17, FIX-6); withTitle is kept for
     * the callers and the tests, and only a status read without a title says nothing more.
     */
    public static string Describe(VjsterState s, bool withTitle, string target = "browser")
    {
        if (s.Rate == null && s.Title == null) return target == "obs" ? "VJster: no video is loaded in the OBS page." : "VJster: no video is playing in Chrome.";
        var parts = new List<string> { "Video " + Rate(s.Rate) };
        if (s.Capabilities.Contains("quality")) parts.Add(s.QualityAuto == true ? $"Auto ({Quality(s.Quality)})" : Quality(s.Quality));
        parts.Add(s.Playing ? "playing" : "paused");
        if (s.AdPlaying) parts.Add("ad playing");
        if (s.Pinned) parts.Add("pinned tab");
        var named = new List<string>();
        if (!string.IsNullOrWhiteSpace(s.Title)) named.Add(ShortTitle(s.Title));
        if (!string.IsNullOrWhiteSpace(s.Host) && !IsYouTube(s.Host)) named.Add(s.Host.Trim());
        parts.InsertRange(0, named);
        return string.Join(" · ", parts);
    }

    static string ShortTitle(string title)
    {
        var t = string.Join(" ", title.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        return t.Length <= LineTitleChars ? t : t[..(LineTitleChars - 1)].TrimEnd() + "…";
    }

    static bool IsYouTube(string host)
    {
        var h = host.Trim().ToLowerInvariant();
        return h == "youtube.com" || h.EndsWith(".youtube.com", StringComparison.Ordinal);
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
        bool serveObs = cfg.VjsterObsToken.Length == 32;
        var pages = serveObs ? VjsterLink.LoadObsPages(FindObsPageDirectory(), log) : null;
        Link = new VjsterLink(cfg.VjsterPort, cfg.VjsterExtensionId.Length == 0 ? null : [cfg.VjsterExtensionId], log,
            serveObs ? cfg.VjsterObsToken : null, pages);
        Desk = new VjsterDesk(Link, cfg.GamepadFastSpeed, cfg.GamepadSlowSpeed, cfg.VjsterTarget);
        // Spontaneous reports (a new video, play, pause): without the title, which only a status press shows (R-BEH-5).
        Link.StateReceived += s => { if (s.InReplyTo == null) log(VjsterDesk.Describe(s, false)); };
    }

    static string? FindObsPageDirectory()
    {
        static bool HasPage(string dir) => File.Exists(Path.Combine(dir, "player.html")) && File.Exists(Path.Combine(dir, "player.js"));
        foreach (var local in new[] { Path.Combine(AppContext.BaseDirectory, "vjster", "obs"), Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "vjster", "obs")) })
            if (HasPage(local)) return local;
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
        {
            foreach (var rel in new[] { Path.Combine("io.github.jbrick2070.fadester-for-obs.sdPlugin", "bin", "vjster", "obs"), Path.Combine("com.jbrick2070.vjster.sdPlugin", "bin", "obs") })
            {
                var candidate = Path.Combine(dir.FullName, rel);
                if (HasPage(candidate)) return candidate;
            }
        }
        return null;
    }

    public Task StartBinding(CancellationToken stop) => Bind(stop);

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
