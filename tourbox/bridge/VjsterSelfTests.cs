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

    public static async Task RunAsync()
    {
        Gate();
        Parser();
        await Loopback();
        await Layers();
    }

    static void Gate()
    {
        string[] none = [];
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, "", 48150, none).Ok, "extension origin on the right host");
        Check(VjsterLink.ClassifyUpgrade("localhost:48150", 1, Ext, "", 48150, none).Ok, "localhost is this server too");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48151", 1, Ext, "", 48150, none).Reason == "host", "wrong port is a host refusal");
        Check(VjsterLink.ClassifyUpgrade("evil.example:48150", 1, Ext, "", 48150, none).Reason == "host", "another host name (DNS rebinding)");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 2, Ext, "", 48150, none).Reason == "host", "two Host headers");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 0, Ext, "", 48150, none).Reason == "host", "no Host header");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "https://www.youtube.com", "", 48150, none).Reason == "origin", "a web page");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, null, "", 48150, none).Reason == "origin", "no Origin");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, "chrome-extension://ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP", "", 48150, none).Reason == "origin", "upper-case id is not an id");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, "token=0123456789abcdef0123456789abcdef", 48150, none).Reason == "token", "the OBS page token path is not served here");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, Ext, "", 48150, ["abcdefghijklmnopabcdefghijklmnop"]).Ok, "pinned id matches");
        Check(VjsterLink.ClassifyUpgrade("127.0.0.1:48150", 1, OtherExt, "", 48150, ["abcdefghijklmnopabcdefghijklmnop"]).Reason == "extension-id", "pinned id differs");
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

    static async Task<ClientWebSocket> Connect(int port, string origin)
    {
        var ws = new ClientWebSocket();
        ws.Options.SetRequestHeader("Origin", origin);
        using var cts = new CancellationTokenSource(3000);
        await ws.ConnectAsync(new Uri($"ws://127.0.0.1:{port}/"), cts.Token);
        return ws;
    }

    static string StateJson(string inReplyTo, double rate, string title = "Clip", bool playing = true, string quality = "hd1080") =>
        $$"""{"v":1,"id":"e{{Random.Shared.Next()}}","target":"browser","type":"state","inReplyTo":{{(inReplyTo == "" ? "null" : "\"" + inReplyTo + "\"")}},"rate":{{rate.ToString(System.Globalization.CultureInfo.InvariantCulture)}},"rateDirect":false,"availableRates":[0.25,0.5,1,1.25,1.5,2],"quality":"{{quality}}","availableQualities":["hd1080","hd720"],"qualityAuto":false,"title":"{{title}}","host":"www.youtube.com","playing":{{(playing ? "true" : "false")}},"adPlaying":false,"capabilities":["speed","quality","transport"],"pinned":false}""";

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
        Check(await turn == "Video 1.25x · 1080p · playing", "the panel line comes from the reply: " + await turn);
        var fine = desk.Dispatch("vjster.speed.fineDown");
        intent = JsonNode.Parse(await Receive(ext))!.AsObject();
        Check(intent["delta"]!.GetValue<double>() == -0.05, "fine step is 0.05");
        await SendText(ext, StateJson(intent["id"]!.GetValue<string>(), 1.2));
        Check((await fine).StartsWith("Video 1.2x"), "fine reply");
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

    static async Task<string> Raw(int port, string request)
    {
        using var client = new TcpClient();
        await client.ConnectAsync("127.0.0.1", port);
        var stream = client.GetStream();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(request));
        var buffer = new byte[4096];
        using var cts = new CancellationTokenSource(3000);
        int n = await stream.ReadAsync(buffer, cts.Token);
        return Encoding.ASCII.GetString(buffer, 0, n);
    }

    static async Task Layers()
    {
        var cfg = new BridgeConfig { Layer1Scene = "Mix", Layer1Source = "Clip A", Layer2Scene = "Mix", Layer2Source = "Clip B" };
        string blendA = "OBS_BLEND_NORMAL", blendB = "OBS_BLEND_NORMAL";
        var filters = new List<JsonObject>();
        double opacity = 1.0; string? created = null; bool legacy = false; JsonObject? lastSet = null;
        Task<JsonObject> Fake(string op, JsonObject? args)
        {
            JsonObject reply = new();
            string Arg(string k) => args![k]!.GetValue<string>();
            switch (op)
            {
                case "GetSceneItemId": Check(Arg("sceneName") == "Mix", "scene by name"); reply["sceneItemId"] = Arg("sourceName") == "Clip A" ? 7 : 8; break;
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
                default: throw new Exception("Unexpected OBS request in the layer test: " + op);
            }
            return Task.FromResult(reply);
        }
        var desk = new DeskActions(cfg, Fake);
        Check(await desk.Dispatch("layer1.blend.next") == "Layer 1 blend: Additive" && blendA == "OBS_BLEND_ADDITIVE", "blend next");
        Check(await desk.Dispatch("layer2.blend.previous") == "Layer 2 blend: Darken" && blendB == "OBS_BLEND_DARKEN" && blendA == "OBS_BLEND_ADDITIVE", "blend previous wraps, per layer");
        Check(await desk.Dispatch("layer2.blend.reset") == "Layer 2 blend: Normal", "blend reset");
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
        var bare = new DeskActions(new BridgeConfig(), Fake);
        try { await bare.Dispatch("layer1.blend.next"); throw new Exception("VJster self-test: an unassigned layer was driven"); }
        catch (InvalidOperationException e) { Check(e.Message.Contains("layer 1 scene"), "an unassigned layer says what to set"); }
        try { await desk.Dispatch("vjster.speed.up"); throw new Exception("VJster self-test: OBS desk took a VJster action"); }
        catch (InvalidOperationException) { }
        Check(DeskActions.BlendName("OBS_BLEND_SCREEN") == "Screen", "blend names");
    }
}
