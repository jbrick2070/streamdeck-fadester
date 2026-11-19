// SPDX-License-Identifier: GPL-2.0-or-later
// Offline checks for the VJster link and the Layer actions: the upgrade gate
// and the protocol parser case by case, a real loopback connection with a
// stand-in extension (ClientWebSocket), and the blend and opacity actions
// against a fake OBS. No Chrome, no TourBox, no OBS.

using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class VjsterSelfTests
{
    const string Ext = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
    const string OtherExt = "chrome-extension://ppppppppppppppppaaaaaaaaaaaaaaaa";
    static void Check(bool ok, string msg) { if (!ok) throw new Exception("VJster self-test: " + msg); }

    /** Every panel line names the video, and the site when it is not YouTube (FIX-6). */
    static void Lines()
    {
        VjsterState S(string? title, string? host, bool playing = true) =>
            new(1, false, [1], "hd720", ["hd720"], true, title, host, playing, false, ["quality"], false, null);
        Check(VjsterDesk.Describe(S("YouTube 60fps Tester", "www.youtube.com"), false) == "YouTube 60fps Tester · Video 1x · Auto (720p) · playing", "title on an automatic line");
        Check(VjsterDesk.Describe(S("Clip", "m.youtube.com", false), false) == "Clip · Video 1x · Auto (720p) · paused", "no host for YouTube");
        Check(VjsterDesk.Describe(S("News", "www.example.com"), false) == "News · www.example.com · Video 1x · Auto (720p) · playing", "the site when it is not YouTube");
        Check(VjsterDesk.Describe(S(null, "www.youtube.com"), false) == "Video 1x · Auto (720p) · playing", "no title, no name");
        var longLine = VjsterDesk.Describe(S(new string('A', 80) + "  tail", "www.youtube.com"), false);
        Check(longLine.StartsWith(new string('A', VjsterDesk.LineTitleChars - 1) + "… · Video 1x", StringComparison.Ordinal), "a long title is shortened: " + longLine);
        Check(VjsterDesk.Describe(S("  two\n  lines  ", "www.youtube.com"), false).StartsWith("two lines · ", StringComparison.Ordinal), "whitespace in a title is folded");
    }

    public static async Task RunAsync()
    {
        Gate();
        Lines();
        Parser();
        Ports();
        Guards();
        await Loopback();
        await ObsPageLoopback();
        await StopRace();
        await Oversize();
        await GuidedSetupAsync();
        await Layers();
    }

    static void Gate()
    {
        string[] none = [];
        const string tok = "0123456789abcdef0123456789abcdef";
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, "", 48150, none).Ok, "extension origin on the right host");
        Check(VjsterLink.ClassifyUpgrade("localhost:48150", 1, Ext, "", 48150, none).Ok, "localhost is this server too");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48151", 1, Ext, "", 48150, none).Reason == "host", "wrong port is a host refusal");
        Check(VjsterLink.ClassifyUpgrade("evil.example:48150", 1, Ext, "", 48150, none).Reason == "host", "another host name (DNS rebinding)");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 2, Ext, "", 48150, none).Reason == "host", "two Host headers");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 0, Ext, "", 48150, none).Reason == "host", "no Host header");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "https://www.youtube.com", "", 48150, none).Reason == "origin", "a web page");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, null, "", 48150, none).Reason == "origin", "no Origin");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP", "", 48150, none).Reason == "origin", "upper-case id is not an id");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, $"token={tok}", 48150, none).Reason == "token", "without obsToken, token query is refused");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "http://127.0.0.1:48150", $"token={tok}", 48150, none, tok) == (true, "", "obs"), "obs page token on 127.0.0.1");
        Check(VjsterLink.ClassifyUpgrade("localhost:48150", 1, "http://localhost:48150", $"token={tok}", 48150, none, tok) == (true, "", "obs"), "obs page token on localhost");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "http://127.0.0.1:48150", "token=ffffffffffffffffffffffffffffffff", 48150, none, tok).Reason == "token", "wrong obs page token");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, $"token={tok}", 48150, none, tok).Reason == "origin", "extension origin cannot use obs page token");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, "", 48150, ["abcdefghijklmnopabcdefghijklmnop"]).Ok, "pinned id matches");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, OtherExt, "", 48150, ["abcdefghijklmnopabcdefghijklmnop"]).Reason == "extension-id", "pinned id differs");
        Check(VjsterLink.VideoIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5") == "dQw4w9WgXcQ", "watch url id");
        Check(VjsterLink.VideoIdFrom("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ", "short url id");
        Check(VjsterLink.VideoIdFrom("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ", "shorts url id");
        Check(VjsterLink.VideoIdFrom("https://www.youtube.com/embed/videoseries?list=PL123") == null, "playlist videoseries is not a video id");
        Check(VjsterLink.ObsPageAddress(48150, tok, "dQw4w9WgXcQ") == $"http://127.0.0.1:48150/obs?v=dQw4w9WgXcQ#token={tok}", "obs page address with video id");
        Check(VjsterLink.ObsPageAddress(48150, tok, "") == $"http://127.0.0.1:48150/obs?v=VIDEO_ID#token={tok}", "obs page address placeholder");
    }

    static void Ports()
    {
        static string Fails(Action run) { try { run(); return ""; } catch (Exception e) { return e.Message; } }
        var dir = Path.Combine(Path.GetTempPath(), "fadester-ports-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            var path = Path.Combine(dir, "config.json");
            File.WriteAllText(path, """{"port":48150,"vjsterPort":48150}""");
            Check(Fails(() => BridgeConfig.Load(path).CheckPorts()).Contains("cannot both be 48150"), "the OBS port on the VJster port is refused");
            Check(BridgeConfig.Load(path).Port == 48150, "a catalog read does not care about the VJster port");
            File.WriteAllText(path, """{"port":48150,"vjsterPort":48150,"vjsterEnabled":false}""");
            Check(Fails(() => BridgeConfig.Load(path).CheckPorts()) == "", "with VJster off, the port is free");
            File.WriteAllText(path, """{"vjsterObsToken":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"}""");
            Check(Fails(() => BridgeConfig.Load(path)).Contains("32 lowercase hex digits"), "invalid obs token is refused");
            File.WriteAllText(path, """{"vjsterTarget":"tv"}""");
            Check(Fails(() => BridgeConfig.Load(path)).Contains("browser, obs, or both"), "invalid vjsterTarget is refused");
            File.WriteAllText(path, """{"vjsterObsToken":"0123456789ABCDEF0123456789abcdef","vjsterTarget":"OBS"}""");
            var loaded = BridgeConfig.Load(path);
            Check(loaded.VjsterObsToken == "0123456789abcdef0123456789abcdef" && loaded.VjsterTarget == "obs", "obs token and target normalize cleanly");
            const string obs = """{"server_port":4455,"server_password":"pw"}""";
            Check(BridgeConfig.SavedPassword(obs, 4455) == "pw", "the saved password on the matching port");
            Check(Fails(() => BridgeConfig.SavedPassword(obs, 48150)).Contains("uses port 4455"), "a wrong port says so instead of asking for a password");
            Check(Fails(() => BridgeConfig.SavedPassword("""{"server_password":"pw"}""", 4455)).Contains("(obs-no-password)"), "no port in OBS's settings asks for the password");
            Check(Fails(() => BridgeConfig.SavedPassword("""{"server_port":"4455","server_password":7}""", 4455)).Contains("(obs-no-password)"), "odd types ask for the password");
            Check(Fails(() => BridgeConfig.SavedPassword("{half", 4455)).Contains("(obs-no-password)"), "a half-written file asks for the password");
            Check(Fails(() => BridgeConfig.SavedPassword("[1]", 4455)).Contains("(obs-no-password)"), "a file that is not an object asks for the password");
            Check(Fails(() => BridgeConfig.SavedPassword(null, 4455)).Contains("(obs-no-password)"), "no OBS settings asks for the password");
            Check(Fails(() => BridgeConfig.SavedPassword("""{"server_port":4455,"server_password":""}""", 4455)).Contains("(obs-no-password)"), "an empty saved password asks for it");
        }
        finally { Directory.Delete(dir, true); }
    }

    static void Guards()
    {
        long t = System.Diagnostics.Stopwatch.GetTimestamp();
        long ms(int n) => t + n * System.Diagnostics.Stopwatch.Frequency / 1000;
        Check(KeyGuards.IsStrayFaderTick("fader.back", t, ms(100)), "a T-bar tick just after a Music turn is stray");
        Check(!KeyGuards.IsStrayFaderTick("fader.back", t, ms(600)), "a T-bar tick well after a Music turn is real");
        Check(!KeyGuards.IsStrayFaderTick("fader.back", 0, ms(100)), "with no Music turn yet, the T-bar works");
        Check(!KeyGuards.IsStrayFaderTick("take", t, ms(100)), "only ticks are filtered, never a Take");
        Check(KeyGuards.IsHeldDialTurn("music.up") && KeyGuards.IsHeldDialTurn("layer2.opacity.down") && !KeyGuards.IsHeldDialTurn("mix.up"), "held Dial turns");
        Check(KeyGuards.IsTurnTick("layer2.opacity.up") && KeyGuards.IsTurnTick("layer1.blend.next") && KeyGuards.IsTurnTick("fader.forward") && !KeyGuards.IsTurnTick("take.cut"), "turn ticks");
    }

    static void Parser()
    {
        const string state = """{"v":1,"id":"e1","target":"browser","type":"state","inReplyTo":"t1","rate":1.25,"rateDirect":false,"availableRates":[0.25,1,2],"quality":"hd1080","availableQualities":["hd1080","hd720"],"qualityAuto":true,"title":"Clip","host":"www.youtube.com","playing":true,"adPlaying":false,"capabilities":["speed","quality","transport","future"],"pinned":false}""";
        var s = VjsterLink.ParseReport(state);
        Check(s.Ok && s.Type == "state" && s.State!.Rate == 1.25 && s.State.Quality == "hd1080" && s.State.QualityAuto == true && s.State.InReplyTo == "t1" && s.State.Capabilities.Length == 3, "a full state report parses; unknown capabilities are dropped");
        Check(VjsterLink.ParseReport(state.Replace("\"rate\":1.25", "\"rate\":null")).State!.Rate == null, "rate may be null");
        Check(VjsterLink.ParseReport(state.Replace("\"rate\":1.25", "\"rate\":99")).Code == "bad-message", "a rate above the range is refused");
        Check(VjsterLink.ParseReport(state.Replace("\"title\":\"Clip\"", "\"title\":\"" + new string('x', 301) + "\"")).Code == "bad-message", "a long title is refused");
        Check(VjsterLink.ParseReport(state.Replace(",\"pinned\":false", "")).State!.Pinned == false, "pinned defaults to false");
        Check(VjsterLink.ParseReport(state.Replace(",\"qualityAuto\":true", "")).Code == "bad-message", "qualityAuto is required");
        var ping = VjsterLink.ParseReport("""{"v":1,"id":"p1","target":"browser","type":"ping","t":42}""");
        Check(ping.Ok && ping.Type == "ping" && ping.T == 42, "ping");
        var err = VjsterLink.ParseReport("""{"v":1,"id":"e2","target":"browser","type":"error","code":"no-video","message":"no video","inReplyTo":"t9"}""");
        Check(err.Ok && err.Error!.Code == "no-video" && err.Error.InReplyTo == "t9", "error");
        Check(VjsterLink.ParseReport("""{"v":1,"id":"e3","target":"browser","type":"error","code":"made-up","message":"x"}""").Code == "bad-message", "unknown error code");
        Check(VjsterLink.ParseReport(null).Code == "bad-message", "binary");
        Check(VjsterLink.ParseReport(new string('{', 20000)).Code == "too-long", "too long");
        Check(VjsterLink.ParseReport("{nope").Code == "bad-json", "bad json");
        // .NET reads a JSON object's properties on first use, and a repeated name throws only then: still bad JSON, never a dropped link.
        Check(VjsterLink.ParseReport("""{"v":1,"v":1,"id":"a","target":"browser","type":"ping","t":1}""").Code == "bad-json", "a repeated property name");
        Check(VjsterLink.ParseReport("[1]").Code == "bad-message", "not an object");
        Check(VjsterLink.ParseReport("""{"v":2,"id":"a","target":"browser","type":"ping","t":1}""").Code == "bad-version", "wrong version");
        Check(VjsterLink.ParseReport("""{"v":1,"id":"a","target":"browser","type":"speed.step","delta":0.25}""").Code == "unexpected-type", "an intent is not accepted from the extension");
        Check(VjsterLink.ParseReport("""{"v":1,"id":"a","target":"browser","type":"dance"}""").Code == "unknown-type", "unknown type");
        Check(VjsterLink.ParseReport("""{"v":1,"target":"browser","type":"ping","t":1}""").Code == "bad-message", "missing id");
        Check(VjsterLink.ParseReport("""{"v":1,"id":"a","target":"tv","type":"ping","t":1}""").Code == "bad-message", "unknown target");
        Check(VjsterLink.ParseReport("""{"v":1,"id":"a","target":"browser","type":"ping","t":"soon"}""").Code == "bad-message", "ping without a number");
    }

    static async Task<string> Receive(ClientWebSocket ws, int ms = 3000)
    {
        var buffer = new byte[65536];
        using var cts = new CancellationTokenSource(ms);
        var r = await ws.ReceiveAsync(buffer, cts.Token);
        if (r.MessageType == WebSocketMessageType.Close) return "CLOSE " + (int?)ws.CloseStatus;
        return Encoding.UTF8.GetString(buffer, 0, r.Count);
    }

    static Task SendText(ClientWebSocket ws, string text) => ws.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None);

    static async Task<ClientWebSocket> Connect(int port, string origin, string query = "")
    {
        var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Origin", origin);
        using var cts = new CancellationTokenSource(3000);
        await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/{query}"), cts.Token);
        return ws;
    }

    static string StateJson(string inReplyTo, double rate, string title = "Clip", bool playing = true, string quality = "hd1080", string target = "browser", string rates = "0.25,0.5,1,1.25,1.5,2") =>
        $$"""{"v":1,"id":"e{{Random.Shared.Next()}}","target":"{{target}}","type":"state","inReplyTo":{{(inReplyTo == "" ? "null" : "\"" + inReplyTo + "\"")}},"rate":{{rate.ToString(System.Globalization.CultureInfo.InvariantCulture)}},"rateDirect":false,"availableRates":[{{rates}}],"quality":"{{quality}}","availableQualities":["hd1080","hd720"],"qualityAuto":false,"title":"{{title}}","host":"www.youtube.com","playing":{{(playing ? "true" : "false")}},"adPlaying":false,"capabilities":["speed","quality","transport"],"pinned":false}""";

    static async Task Loopback()
    {
        var lines = new List<string>();
        await using var link = new VjsterLink(0, null, l => { lock (lines) lines.Add(l); });
        var desk = new VjsterDesk(link);
        int connections = 0;
        link.ConnectionChanged += up => { if (up) Interlocked.Increment(ref connections); };
        Check((await desk.Dispatch("vjster.speed.up")).Contains("not running"), "before start: not running");
        await link.StartAsync();
        int port = link.BoundPort;
        Check(port > 0 && link.Running, "bound an ephemeral port");
        Check((await desk.Dispatch("vjster.speed.up")).Contains("no Chrome extension is connected"), "no extension yet");

        // Plain HTTP and a wrong Host get the plugin's answers, before any WebSocket exists.
        Check((await Raw(port, $"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n")).StartsWith("HTTP/1.1 426"), "plain GET is 426");
        Check((await Raw(port, $"GET / HTTP/1.1\r\nHost: evil.example:{port}\r\nOrigin: {Ext}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")).StartsWith("HTTP/1.1 403"), "wrong host is 403");
        Check((await Raw(port, $"GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nHost: 127.0.0.1:{port}\r\nOrigin: {Ext}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")).StartsWith("HTTP/1.1 403"), "two Host headers is 403");
        try { await Connect(port, "https://www.youtube.com"); throw new Exception("VJster self-test: a web page origin was accepted"); }
        catch (WebSocketException) { }

        // The extension connects: it is asked for its state at once, and its answer becomes LastState.
        using var ext = await Connect(port, Ext);
        var first = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(first["type"]!.GetValue<string>() == "state.get" && first["target"]!.GetValue<string>() == "browser" && first["v"]!.GetValue<int>() == 1, "state.get on connect");
        await SendText(ext, StateJson(first["id"]!.GetValue<string>(), 1));
        for (int i = 0; i < 50 && link.LastState == null; i++) await Task.Delay(20);
        Check(link.LastState?.Rate == 1 && link.Connected && connections == 1, "the first state is kept");

        // A TourBox detent becomes one intent; the reply the extension sends for it becomes the panel line.
        var turn = desk.Dispatch("vjster.speed.up");
        var intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "speed.step" && intent["delta"]!.GetValue<double>() == 0.25 && intent["hold"]!.GetValue<bool>() == false, "speed.step +0.25");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.25));
        Check(await turn == "Clip · Video 1.25x · 1080p · playing", "the panel line comes from the reply and names the video: " + await turn);
        var fine = desk.Dispatch("vjster.speed.fineDown");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["delta"]!.GetValue<double>() == -0.05, "fine step is 0.05");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.2));
        Check((await fine).StartsWith("Clip · Video 1.2x"), "fine reply");
        var fast = desk.Dispatch("vjster.speed.fast");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "speed.set" && intent["rate"]!.GetValue<double>() == 2.0 && intent["direct"]!.GetValue<bool>() == false, "the controller's fast preset sets 2x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 2));
        Check((await fast).StartsWith("Clip · Video 2x"), "fast preset reply");
        var slow = desk.Dispatch("vjster.speed.slow");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "speed.set" && intent["rate"]!.GetValue<double>() == 0.5, "the slow preset sets 0.5x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 0.5));
        Check((await slow).StartsWith("Clip · Video 0.5x"), "slow preset reply");

        // Midi Fadester's APC40 Tempo knob: steps of 0.05x as one speed.set from the speed last asked for, kept within
        // 0.25x..4x and the video's own speeds, so steps that come faster than the replies still add up.
        var by = desk.SpeedBy(3);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "speed.set" && Math.Abs(intent["rate"]!.GetValue<double>() - 0.65) < 1e-9, "3 steps from 0.5x ask for 0.65x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 0.65));
        Check((await by).StartsWith("Clip · Video 0.65x"), "step reply");
        by = desk.SpeedBy(-20);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 0.25) < 1e-9, "steps stop at 0.25x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 0.25));
        await by;
        by = desk.SpeedBy(80);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 2.0) < 1e-9, "steps stop at the video's top speed (2x here)");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 2));
        await by;
        by = desk.SpeedBy(-1);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 1.95) < 1e-9, "one step back down from the top moves the video at once");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.95, rates: "0.25,1,2,4"));
        await by;
        by = desk.SpeedBy(80);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 4.0) < 1e-9, "a video that plays 4x lets steps reach 4x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 3, rates: "0.25,1,2,4"));
        await by;
        by = desk.SpeedBy(-1);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 2.95) < 1e-9, "the next step starts from the speed the video took (3x), not the one asked for");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 2.95, rates: "0.25,1,2,4"));
        await by;
        // Another video comes up (its own state, not a reply): the next step starts from that video's speed.
        await SendText(ext, StateJson("", 1.5, title: "Other"));
        for (int i = 0; i < 100 && link.GetLastState("browser")?.Title != "Other"; i++) await Task.Delay(10);
        by = desk.SpeedBy(1);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 1.55) < 1e-9, "a step on another video starts from its speed: " + intent["rate"]);
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.55));
        await by;
        // Tap Tempo (or any other speed change) in between: the next step starts from the video's speed, not the last step.
        var reset = desk.Dispatch("vjster.speed.reset");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1));
        await reset;
        by = desk.SpeedBy(1);
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(intent["rate"]!.GetValue<double>() - 1.05) < 1e-9, "a step after a reset starts from 1x");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.05));
        await by;
        var remoteLines = new List<string>();
        var remote = new VjsterRemote(desk, l => { lock (remoteLines) remoteLines.Add(l); });
        remote.OnVendorEvent("other-vendor", VjsterRemote.EventType, new JsonObject { ["action"] = "vjster.speed.reset" });
        remote.OnVendorEvent(VjsterRemote.Vendor, VjsterRemote.EventType, new JsonObject { ["action"] = "not.an.action" });
        remote.OnVendorEvent(VjsterRemote.Vendor, VjsterRemote.EventType, new JsonObject { ["action"] = "vjster.speed.reset" });
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "speed.reset", "the APC40's Tap Tempo resets the speed (other vendors and unknown actions ignored)");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1));
        for (int i = 0; i < 50; i++) { lock (remoteLines) if (remoteLines.Count > 0) break; await Task.Delay(20); }
        lock (remoteLines) Check(remoteLines.Count == 1 && remoteLines[0].StartsWith("APC40: Clip · Video 1x"), "the APC40 line says where it came from");
        // While one request waits for its reply, what the APC40 asks for queues in order: steps in a row add up, Tap
        // Tempo drops the steps queued before it, and at most 16 wait.
        JsonObject Step(int n) => new() { ["action"] = "vjster.speed.step", ["steps"] = n };
        JsonObject Act(string id) => new() { ["action"] = id };
        void Send(JsonObject d) => remote.OnVendorEvent(VjsterRemote.Vendor, VjsterRemote.EventType, d);
        async Task<JsonObject> Answer(double rate)
        {
            var got = JsonNode.Parse(await Receive(ext))!.AsObject();
            await SendText(ext, StateJson(got["id"]!.GetValue<string>(), rate));
            return got;
        }
        Send(Step(2));
        var held = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(Math.Abs(held["rate"]!.GetValue<double>() - 1.10) < 1e-9, "the first step run asks for 1.10x");
        Send(Step(3)); Send(Step(1)); Send(Act("vjster.playPause")); Send(Step(-1));
        Check(remote.QueuedCount == 3, "steps in a row are one entry: " + remote.QueuedCount);
        await SendText(ext, StateJson(held["id"]!.GetValue<string>(), 1.10));
        var next = await Answer(1.30);
        Check(next["type"]!.GetValue<string>() == "speed.set" && Math.Abs(next["rate"]!.GetValue<double>() - 1.30) < 1e-9, "the queued +4 steps follow as 1.30x");
        Check((await Answer(1.30))["type"]!.GetValue<string>() == "transport.toggle", "then play/pause, in order");
        Check(Math.Abs((await Answer(1.25))["rate"]!.GetValue<double>() - 1.25) < 1e-9, "then the last step");
        Send(Act("vjster.playPause"));
        held = JsonNode.Parse(await Receive(ext))!.AsObject();
        Send(Step(5)); Send(Act("vjster.speed.reset"));
        Check(remote.QueuedCount == 1, "Tap Tempo drops the steps queued before it");
        for (int i = 0; i < 20; i++) Send(Act("vjster.playPause"));
        Check(remote.QueuedCount == 16, "at most 16 wait: " + remote.QueuedCount);
        await SendText(ext, StateJson(held["id"]!.GetValue<string>(), 1.25));
        Check((await Answer(1))["type"]!.GetValue<string>() == "speed.reset", "the reset follows");
        for (int i = 0; i < 15; i++) await Answer(1);
        for (int i = 0; i < 50 && remote.QueuedCount > 0; i++) await Task.Delay(20);
        var status = desk.Dispatch("vjster.status");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "state.get", "status asks for state");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.2, "Big Buck Bunny", playing: false));
        Check(await status == "Big Buck Bunny · Video 1.2x · 1080p · paused", "status reads the title: " + await status);
        var quality = desk.Dispatch("vjster.quality.down");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "quality.step" && intent["direction"]!.GetValue<int>() == -1, "quality.step down");
        await SendText(ext, $$"""{"v":1,"id":"x1","target":"browser","type":"error","code":"unsupported","message":"no quality control","inReplyTo":"{{intent["id"]!.GetValue<string>()}}"}""");
        Check(await quality == "VJster: no quality control", "an error reply is shown");
        var toggle = desk.Dispatch("vjster.playPause");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["type"]!.GetValue<string>() == "transport.toggle", "play/pause");
        Check((await toggle).Contains("no reply"), "an unanswered intent times out into a plain line");

        // Keepalive and malformed messages, as the plugin handles them.
        await SendText(ext, """{"v":1,"id":"p7","target":"browser","type":"ping","t":77}""");
        var pong = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(pong["type"]!.GetValue<string>() == "pong" && pong["t"]!.GetValue<double>() == 77, "ping is answered with its t");
        await SendText(ext, "garbage");
        var reask = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(reask["type"]!.GetValue<string>() == "state.get", "a malformed message is answered with state.get");
        await SendText(ext, "garbage again"); // within two seconds: no second state.get, so the next message on ext is the close below
        string[] logged; lock (lines) logged = lines.ToArray();
        Check(logged.Count(l => l.Contains("dropped a message")) == 1, "one warning per connection, without the content");
        Check(!logged.Any(l => l.Contains("garbage") || l.Contains("Bunny")), "logs never carry message bodies or titles");

        // A second extension takes over; the first is closed with 4000.
        using var second = await Connect(port, Ext);
        Check((await Receive(ext)).StartsWith("CLOSE 4000"), "the first connection is replaced with close 4000");
        var again = JsonNode.Parse(await Receive(second))!.AsObject();
        Check(again["type"]!.GetValue<string>() == "state.get" && link.Connected && link.LastState == null, "the newcomer is asked for state; the old state is gone");
        await SendText(second, StateJson(again["id"]!.GetValue<string>(), 2));
        for (int i = 0; i < 50 && link.LastState == null; i++) await Task.Delay(20);
        Check(link.LastState?.Rate == 2, "the newcomer's state is kept");

        // Pinned to one id: another extension is refused, the pinned one accepted.
        await using var pinned = new VjsterLink(0, ["abcdefghijklmnopabcdefghijklmnop"], _ => { });
        await pinned.StartAsync();
        try { await Connect(pinned.BoundPort, OtherExt); throw new Exception("VJster self-test: an unpinned extension was accepted"); }
        catch (WebSocketException) { }
        using var ok = await Connect(pinned.BoundPort, Ext);
        Check((await Receive(ok)).Contains("state.get"), "the pinned extension connects");
        await pinned.StopAsync();
        Check((await Receive(ok)).StartsWith("CLOSE 1001"), "stopping closes the extension with 1001");

        // The port stays exclusive: a second link on the same port fails with the typed error.
        var clash = new VjsterLink(port, null, _ => { });
        try { await clash.StartAsync(); throw new Exception("VJster self-test: two links bound one port"); }
        catch (VjsterPortInUseException e) { Check(e.Port == port, "the error names the port"); }
        await link.StopAsync();
        Check(!link.Running && !link.Connected, "stopped");
        await clash.StartAsync();
        Check(clash.Running, "the port is free again after a stop");
        await clash.StopAsync();
    }

    static async Task ObsPageLoopback()
    {
        var dir = Path.Combine(Path.GetTempPath(), "fadester-obs-page-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            File.WriteAllText(Path.Combine(dir, "player.html"), "<!doctype html><title>VJster OBS</title>");
            File.WriteAllText(Path.Combine(dir, "player.js"), "// script");
            string tok = VjsterLink.NewObsToken();
            var pages = VjsterLink.LoadObsPages(dir);
            await using var link = new VjsterLink(0, null, _ => { }, tok, pages);
            await link.StartAsync();
            int port = link.BoundPort;

            string htmlResp = await Raw(port, $"GET /obs?v=dQw4w9WgXcQ HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
            Check(htmlResp.StartsWith("HTTP/1.1 200 OK") && htmlResp.Contains("Content-Security-Policy: " + VjsterLink.PageCsp) && htmlResp.Contains("<title>VJster OBS</title>"), "/obs serves player.html with CSP");
            string headResp = await Raw(port, $"HEAD /obs/player.js HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n");
            Check(headResp.StartsWith("HTTP/1.1 200 OK") && headResp.Contains("text/javascript") && !headResp.Contains("// script"), "HEAD /obs/player.js omits body");
            Check((await Raw(port, $"GET /obs HTTP/1.1\r\nHost: evil.example:{port}\r\n\r\n")).StartsWith("HTTP/1.1 403"), "/obs refuses foreign Host header");

            var obsOnlyDesk = new VjsterDesk(link, targetChoice: "obs");
            var bothDesk = new VjsterDesk(link, targetChoice: "both");
            Check((await obsOnlyDesk.Dispatch("vjster.speed.up")).Contains("no OBS video page is connected"), "obs-only offline message");
            Check((await bothDesk.Dispatch("vjster.speed.up")).Contains("no Chrome extension or OBS video page is connected"), "both offline message");

            using var browser = await Connect(port, Ext);
            using var obs = await Connect(port, $"http://127.0.0.1:{port}", $"?token={tok}");
            var bInit = JsonNode.Parse(await Receive(browser))!.AsObject();
            var oInit = JsonNode.Parse(await Receive(obs))!.AsObject();
            Check(bInit["target"]!.GetValue<string>() == "browser" && oInit["target"]!.GetValue<string>() == "obs", "browser and obs coexist on separate slots");
            Check(link.IsConnected("browser") && link.IsConnected("obs"), "both targets open");
            await SendText(browser, StateJson(bInit["id"]!.GetValue<string>(), 1, target: "browser"));
            await SendText(obs, StateJson(oInit["id"]!.GetValue<string>(), 1, target: "obs"));

            // Dispatch to obs only leaves browser untouched.
            var obsStep = obsOnlyDesk.Dispatch("vjster.speed.up");
            var oIntent = JsonNode.Parse(await Receive(obs))!.AsObject();
            Check(oIntent["type"]!.GetValue<string>() == "speed.step" && oIntent["target"]!.GetValue<string>() == "obs", "obs-only desk targets obs");
            await SendText(obs, StateJson(oIntent["id"]!.GetValue<string>(), 1.25, target: "obs"));
            Check(await obsStep == "Clip · Video 1.25x · 1080p · playing", "obs-only reply");

            // Dispatch to both sends to both simultaneously.
            var bothStep = bothDesk.Dispatch("vjster.speed.down");
            var bIntent = JsonNode.Parse(await Receive(browser))!.AsObject();
            oIntent = JsonNode.Parse(await Receive(obs))!.AsObject();
            await SendText(browser, StateJson(bIntent["id"]!.GetValue<string>(), 0.75, target: "browser"));
            await SendText(obs, StateJson(oIntent["id"]!.GetValue<string>(), 1.0, target: "obs"));
            Check(await bothStep == "Chrome: Clip · Video 0.75x · 1080p · playing | OBS: Clip · Video 1x · 1080p · playing", "both targets reply");
        }
        finally { Directory.Delete(dir, true); }
    }

    /** A connection that arrives while the link stops is never kept as the peer of a stopped link. */
    static async Task StopRace()
    {
        // A fixed port, as in use (48150 by default). On port 0 a stopping link would check the late handshake's Host
        // against port 0 and refuse it anyway, which hides the race.
        var probe = new TcpListener(System.Net.IPAddress.Loopback, 0);
        probe.Start();
        int port = ((System.Net.IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        await using var link = new VjsterLink(port, null, _ => { });
        await link.StartAsync();
        using var first = await Connect(port, Ext);
        await Receive(first); // the state.get; from here on `first` never reads, so it never answers the close and the stop waits
        var stopping = link.StopAsync();
        await Task.Delay(200);
        ClientWebSocket? late = null;
        try { late = await Connect(port, Ext); } catch (WebSocketException) { }
        await stopping;
        Check(!link.Connected, "a connection that arrives while the link stops is not kept");
        if (late != null)
        {
            Check((await Receive(late)).StartsWith("CLOSE 1001"), "a connection that arrives while the link stops is closed with 1001");
            late.Dispose();
        }
    }

    /** An oversized message is closed with 1009, and the disconnect is announced at once, not after the receive loop waits on itself. */
    static async Task Oversize()
    {
        await using var link = new VjsterLink(0, null, _ => { });
        var down = new TaskCompletionSource();
        link.ConnectionChanged += up => { if (!up) down.TrySetResult(); };
        await link.StartAsync();
        using var ext = await Connect(link.BoundPort, Ext);
        await Receive(ext); // the state.get
        await SendText(ext, new string('x', VjsterLink.MaxPayloadBytes + 1));
        Check((await Receive(ext)).StartsWith("CLOSE 1009"), "an oversized message is closed with 1009");
        Check(await Task.WhenAny(down.Task, Task.Delay(1500)) == down.Task, "the disconnect is announced at once, not after a two-second wait");
    }

    static async Task<string> Raw(int port, string request)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", port);
        var stream = client.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(request));
        try { client.Client.Shutdown(SocketShutdown.Send); }
        catch (SocketException) { }
        var buffer = new byte[4096];
        using var ms = new MemoryStream();
        using var cts = new CancellationTokenSource(3000);
        while (true)
        {
            int n = await stream.ReadAsync(buffer, cts.Token);
            if (n == 0) break;
            ms.Write(buffer, 0, n);
        }
        return Encoding.UTF8.GetString(ms.ToArray());
    }

    static async Task GuidedSetupAsync()
    {
        static string Fails(Action run) { try { run(); return ""; } catch (Exception e) { return e.Message; } }

        // 1. Shared obs-websocket config path + strict/standard SavedPassword checks across Windows and macOS:
        string winPath = BridgeConfig.ObsWebsocketConfigPath(isMacOS: false, appData: Path.Combine("C:", "Users", "Alice", "AppData", "Roaming"));
        Check(winPath.EndsWith(Path.Combine("Roaming", "obs-studio", "plugin_config", "obs-websocket", "config.json"), StringComparison.Ordinal),
            "Windows obs-websocket config path under Roaming");
        string macPath = BridgeConfig.ObsWebsocketConfigPath(isMacOS: true, userProfile: "/Users/carol");
        Check(macPath.Replace('\\', '/').EndsWith("/Users/carol/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json", StringComparison.Ordinal),
            "macOS obs-websocket config path under Library/Application Support");

        const string strictGood = """{"server_port":4455,"server_enabled":true,"auth_required":true,"server_password":"secret-pw"}""";
        Check(BridgeConfig.SavedPassword(strictGood, 4455, requireEnabledAndAuth: true) == "secret-pw", "strict SavedPassword accepts enabled + auth_required");
        Check(Fails(() => BridgeConfig.SavedPassword("""{"server_port":4455,"server_enabled":false,"auth_required":true,"server_password":"secret-pw"}""", 4455, requireEnabledAndAuth: true)).Contains("enabled, authenticated"),
            "strict SavedPassword rejects disabled server");
        Check(Fails(() => BridgeConfig.SavedPassword("""{"server_port":4455,"server_enabled":true,"auth_required":false,"server_password":"secret-pw"}""", 4455, requireEnabledAndAuth: true)).Contains("enabled, authenticated"),
            "strict SavedPassword rejects disabled auth");

        // 2. VjsterLink GET /whoami + HEAD /whoami + ProbePortHolderAsync:
        string secretToken = VjsterLink.NewObsToken();
        const string pinnedId = "abcdefghijklmnopabcdefghijklmnop";
        await using var link = new VjsterLink(0, [pinnedId], _ => { }, secretToken);
        await link.StartAsync();
        int port = link.BoundPort;

        string whoamiIp = await Raw(port, $"GET /whoami HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
        Check(whoamiIp.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "GET /whoami 200 on 127.0.0.1");
        Check(!whoamiIp.Contains("Access-Control-Allow-", StringComparison.OrdinalIgnoreCase), "/whoami carries no CORS headers");
        Check(!whoamiIp.Contains(secretToken, StringComparison.Ordinal) && !whoamiIp.Contains(pinnedId, StringComparison.Ordinal), "/whoami never leaks tokens or pinned ids");
        string bodyText = whoamiIp.Split("\r\n\r\n", 2)[1];
        var bodyObj = JsonNode.Parse(bodyText)!.AsObject();
        var keys = bodyObj.Select(kv => kv.Key).OrderBy(k => k, StringComparer.Ordinal).ToArray();
        Check(keys.SequenceEqual(new[] { "port", "product", "version" }), "/whoami returns only product, version, port");
        Check(bodyObj["product"]!.GetValue<string>() == "Fadester Companion" && bodyObj["port"]!.GetValue<int>() == port, "/whoami identifies Fadester Companion and port");

        string whoamiLocal = await Raw(port, $"GET /whoami HTTP/1.1\r\nHost: localhost:{port}\r\n\r\n");
        Check(whoamiLocal.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal), "GET /whoami 200 on localhost");

        string whoamiHead = await Raw(port, $"HEAD /whoami HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n");
        Check(whoamiHead.StartsWith("HTTP/1.1 200 OK\r\n", StringComparison.Ordinal) && whoamiHead.Split("\r\n\r\n", 2)[1].Length == 0, "HEAD /whoami omits body");

        Check((await Raw(port, $"GET /whoami HTTP/1.1\r\nHost: evil.example:{port}\r\n\r\n")).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "/whoami refuses foreign Host");
        Check((await Raw(port, $"GET /whoami HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nHost: evil.example\r\n\r\n")).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "/whoami refuses two Host headers");
        Check((await Raw(port, "GET /whoami HTTP/1.1\r\n\r\n")).StartsWith("HTTP/1.1 403", StringComparison.Ordinal), "/whoami refuses missing Host");

        var holder = await VjsterLink.ProbePortHolderAsync(port);
        Check(holder is not null && holder.Product == "Fadester Companion" && holder.Port == port && holder.DisplayName.StartsWith("Fadester Companion", StringComparison.Ordinal),
            "ProbePortHolderAsync names Fadester Companion");

        await link.StopAsync();
        Check(await VjsterLink.ProbePortHolderAsync(port) is null, "ProbePortHolderAsync returns null when port is free");

        var silent = new TcpListener(System.Net.IPAddress.Loopback, 0);
        silent.Start();
        int silentPort = ((System.Net.IPEndPoint)silent.LocalEndpoint).Port;
        var acceptOne = Task.Run(async () =>
        {
            try { using var c = await silent.AcceptTcpClientAsync(); c.Close(); }
            catch (ObjectDisposedException) { }
            catch (SocketException) { }
        });
        try
        {
            Check(await VjsterLink.ProbePortHolderAsync(silentPort, timeoutMs: 400) is null, "ProbePortHolderAsync returns null for non-VJster holder");
            await acceptOne;
        }
        finally { silent.Stop(); }
    }

    static async Task Layers()
    {
        var cfg = new BridgeConfig { Layer1Scene = "Mix", Layer1Source = "Clip A", Layer2Scene = "Mix", Layer2Source = "Clip B" };
        string blendA = "OBS_BLEND_NORMAL", blendB = "OBS_BLEND_NORMAL";
        var filters = new List<JsonObject>();
        double opacity = 1.0; string? created = null; bool legacy = false; JsonObject? lastSet = null;
        var items = new[] { ("Clip A", 7), ("Clip B", 8) };
        Task<JsonObject> Fake(string op, JsonObject? args)
        {
            JsonObject reply = new();
            string Arg(string k) => args![k]!.GetValue<string>();
            switch (op)
            {
                case "GetSceneItemList":
                    Check(Arg("sceneName") == "Mix", "scene by name");
                    reply["sceneItems"] = new JsonArray(items.Select(i => (JsonNode)new JsonObject { ["sourceName"] = i.Item1, ["sceneItemId"] = i.Item2 }).ToArray());
                    break;
                case "GetSceneItemBlendMode": reply["sceneItemBlendMode"] = args!["sceneItemId"]!.GetValue<int>() == 7 ? blendA : blendB; break;
                case "SetSceneItemBlendMode": if (args!["sceneItemId"]!.GetValue<int>() == 7) blendA = Arg("sceneItemBlendMode"); else blendB = Arg("sceneItemBlendMode"); break;
                case "GetSourceFilterList": Check(Arg("sourceName") == "Clip B", "opacity rides layer 2"); reply["filters"] = new JsonArray(filters.Select(f => (JsonNode)f.DeepClone()).ToArray()); break;
                case "CreateSourceFilter":
                    created = Arg("filterName");
                    filters.Add(new JsonObject { ["filterName"] = created, ["filterKind"] = Arg("filterKind"), ["filterEnabled"] = true }); break;
                case "GetSourceFilter":
                    reply["filterSettings"] = new JsonObject();
                    if (opacity != 1.0) reply["filterSettings"]!["opacity"] = legacy ? (int)Math.Round(opacity * 100) : opacity; // OBS omits a default
                    break;
                case "SetSourceFilterSettings":
                    lastSet = args;
                    var raw = Convert.ToDouble(args!["filterSettings"]!["opacity"]!.GetValue<object>(), System.Globalization.CultureInfo.InvariantCulture);
                    opacity = legacy ? raw / 100 : raw; break;
                case "CallVendorRequest":
                    throw new ObsError("CallVendorRequest", 600, "No vendor");
                default: throw new Exception("Unexpected OBS request in the layer test: " + op);
            }
            return Task.FromResult(reply);
        }
        var desk = new DeskActions(cfg, Fake);
        Check(await desk.Dispatch("layer1.blend.next") == "Layer 1 blend: Additive" && blendA == "OBS_BLEND_ADDITIVE", "blend next");
        Check(await desk.Dispatch("layer2.blend.previous") == "Layer 2 blend: Darken" && blendB == "OBS_BLEND_DARKEN" && blendA == "OBS_BLEND_ADDITIVE", "blend previous wraps, per layer");
        Check(await desk.Dispatch("layer2.blend.reset") == "Layer 2 blend: Normal", "blend reset");
        async Task<string> Refused(string action) { try { await desk.Dispatch(action); return ""; } catch (InvalidOperationException e) { return e.Message; } }
        var all = items;
        items = [("Clip A", 7)];
        Check((await Refused("layer2.opacity.up")).Contains("found 0"), "opacity refuses a source that left the layer's scene");
        items = [("Clip A", 7), ("Clip A", 9), ("Clip B", 8)];
        Check((await Refused("layer1.blend.next")).Contains("found 2"), "blend refuses two copies of the source");
        items = all;
        Check(await desk.Dispatch("layer2.opacity.down") == "Layer 2 opacity 95 %" && created == DeskActions.OpacityFilterName && opacity == 0.95, "a missing Color Correction filter is created, then stepped");
        Check(lastSet!["overlay"]!.GetValue<bool>() && lastSet["filterName"]!.GetValue<string>() == DeskActions.OpacityFilterName, "settings are overlaid on the filter");
        for (int i = 0; i < 30; i++) await desk.Dispatch("layer2.opacity.down");
        Check(opacity == 0 && await desk.Dispatch("layer2.opacity.down") == "Layer 2 opacity 0 %", "clamped at 0");
        Check(await desk.Dispatch("layer2.opacity.up") == "Layer 2 opacity 5 %", "up again");
        filters[0]["filterEnabled"] = false;
        try { await desk.Dispatch("layer2.opacity.up"); throw new Exception("VJster self-test: a disabled filter was driven"); }
        catch (InvalidOperationException e) { Check(e.Message.Contains("disabled"), "a disabled filter is reported, not enabled"); }
        filters[0]["filterEnabled"] = true; filters[0]["filterKind"] = "color_filter"; legacy = true; opacity = 0.5;
        Check(await desk.Dispatch("layer2.opacity.up") == "Layer 2 opacity 55 %" && Convert.ToInt32(lastSet!["filterSettings"]!["opacity"]!.GetValue<object>()) == 55, "the legacy filter takes 0..100");
        // Unassigned layers fill themselves in from the live scene (hand test 2026-11-17): top visible picture first,
        // skipping a sound file (no size), a hidden item and an audio-only input.
        var scene = new[] { ("Backdrop", 1, 1, true, 1920.0), ("Beat", 2, 2, true, 0.0), ("Hidden", 3, 3, false, 640.0), ("Mic", 4, 4, true, 0.0),
                            ("Title", 5, 5, true, 1280.0), ("Motion", 6, 6, true, 1920.0) };
        string bareBlend = "OBS_BLEND_NORMAL"; int bareItem = 0;
        Task<JsonObject> BareFake(string op, JsonObject? args)
        {
            JsonObject reply = new();
            switch (op)
            {
                case "GetCurrentProgramScene": reply["currentProgramSceneName"] = "Live"; break;
                case "GetInputList":
                    reply["inputs"] = new JsonArray(scene.Select(i => (JsonNode)new JsonObject { ["inputName"] = i.Item1, ["inputKindCaps"] = i.Item1 == "Mic" ? 2 : 3 }).ToArray()); break;
                case "GetSceneItemList":
                    reply["sceneItems"] = new JsonArray(scene.Select(i => (JsonNode)new JsonObject { ["sourceName"] = i.Item1, ["sceneItemId"] = i.Item2, ["sceneItemIndex"] = i.Item3,
                        ["sceneItemEnabled"] = i.Item4, ["sourceType"] = "OBS_SOURCE_TYPE_INPUT" }).ToArray()); break;
                case "GetSceneItemTransform":
                    double w = scene.First(i => i.Item2 == args!["sceneItemId"]!.GetValue<int>()).Item5;
                    reply["sceneItemTransform"] = new JsonObject { ["sourceWidth"] = w, ["sourceHeight"] = w > 0 ? 720.0 : 0.0 }; break;
                case "GetSceneItemBlendMode": reply["sceneItemBlendMode"] = bareBlend; break;
                case "SetSceneItemBlendMode": bareBlend = args!["sceneItemBlendMode"]!.GetValue<string>(); bareItem = args["sceneItemId"]!.GetValue<int>(); break;
                default: throw new Exception("Unexpected OBS request in the layer pick test: " + op);
            }
            return Task.FromResult(reply);
        }
        var picked = new BridgeConfig();
        var bare = new DeskActions(picked, BareFake);
        string first = await bare.Dispatch("layer1.blend.next");
        Check(first.StartsWith("Layer 1 blend: Additive") && bareItem == 6 &&
              first.Contains("Layer 1 = Live › Motion (picked automatically") && first.Contains("Layer 2 = Live › Title (picked automatically") &&
              picked.Layer1Source == "Motion" && picked.Layer2Source == "Title" && picked.Layer2Scene == "Live", "unassigned layers are picked from the live scene, top picture first");
        Check(!(await bare.Dispatch("layer1.blend.next")).Contains("picked automatically"), "a picked layer is said once");
        var chosen = new BridgeConfig { Layer1Scene = "Live", Layer1Source = "Backdrop" };
        var half = new DeskActions(chosen, BareFake);
        string second = await half.Dispatch("layer1.blend.next");
        Check(chosen.Layer1Source == "Backdrop" && chosen.Layer2Source == "Motion" && !second.Contains("Layer 1 ="), "a chosen layer is kept; only the empty one is picked");
        scene = [("Beat", 2, 2, true, 0.0)];
        try { await new DeskActions(new BridgeConfig(), BareFake).Dispatch("layer1.blend.next"); throw new Exception("VJster self-test: a layer was picked from a scene with no picture"); }
        catch (InvalidOperationException e) { Check(e.Message.Contains("has no picture"), "a scene with no picture says what to set and where"); }
        scene = [("Motion", 6, 6, true, 1920.0), ("Title", 5, 5, true, 1280.0)];
        var topChosen = new BridgeConfig { Layer1Scene = "Live", Layer1Source = "Motion" };
        await new DeskActions(topChosen, BareFake).Dispatch("layer1.blend.next");
        Check(topChosen.Layer2Source == "Title", "with Layer 1 chosen as the top picture, Layer 2 is the next one down");
        try { await desk.Dispatch("vjster.speed.up"); throw new Exception("VJster self-test: OBS desk took a VJster action"); }
        catch (InvalidOperationException) { }
        Check(DeskActions.BlendName("OBS_BLEND_SCREEN") == "Screen", "blend names");
    }
}
