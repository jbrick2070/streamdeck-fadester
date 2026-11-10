// SPDX-License-Identifier: GPL-2.0-or-later
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>A small authenticated OBS-v5 peer on its own ephemeral loopback port.
/// No user configuration, installed OBS, native listener, or physical input is used.</summary>
internal static class ObsTransportChecks
{
    static void Check(bool value, string message)
    {
        if (!value) throw new InvalidOperationException("OBS transport check: " + message);
    }

    static string Hash(string value) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    static async Task<JsonObject> Receive(WebSocket socket, CancellationToken stop)
    {
        using var data = new MemoryStream();
        byte[] buffer = new byte[4096];
        while (true)
        {
            var part = await socket.ReceiveAsync(buffer.AsMemory(), stop);
            Check(part.MessageType == WebSocketMessageType.Text, "expected a text request");
            data.Write(buffer, 0, part.Count);
            Check(data.Length < 65536, "oversize fixture request");
            if (part.EndOfMessage) return JsonNode.Parse(data.ToArray())!.AsObject();
        }
    }

    static async Task Send(WebSocket socket, JsonObject packet, CancellationToken stop, bool fragmented = false)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(packet.ToJsonString());
        int split = fragmented ? bytes.Length / 2 : 0;
        if (split > 0) await socket.SendAsync(bytes.AsMemory(0, split), WebSocketMessageType.Text, false, stop);
        await socket.SendAsync(bytes.AsMemory(split), WebSocketMessageType.Text, true, stop);
    }

    // TcpListener avoids HttpListener's platform-specific URL reservation requirements.
    // Only the fresh local client can know this ephemeral fixture port.
    static async Task<WebSocket> Upgrade(NetworkStream stream, CancellationToken stop)
    {
        using var data = new MemoryStream();
        byte[] one = new byte[1];
        string header;
        do
        {
            if (await stream.ReadAsync(one.AsMemory(), stop) == 0) throw new IOException("Fixture handshake ended early.");
            data.WriteByte(one[0]);
            Check(data.Length <= 8192, "oversize HTTP upgrade");
            header = Encoding.ASCII.GetString(data.GetBuffer(), 0, (int)data.Length);
        } while (!header.EndsWith("\r\n\r\n", StringComparison.Ordinal));
        Check(header.StartsWith("GET / HTTP/1.1\r\n", StringComparison.Ordinal), "unexpected HTTP request");
        var fields = header.Split("\r\n", StringSplitOptions.RemoveEmptyEntries).Skip(1)
            .Select(line => line.Split(':', 2)).ToDictionary(row => row[0], row => row[1].Trim(), StringComparer.OrdinalIgnoreCase);
        Check(fields.TryGetValue("Sec-WebSocket-Protocol", out var protocol) && protocol == "obswebsocket.json", "OBS subprotocol missing");
        Check(fields.TryGetValue("Sec-WebSocket-Key", out var key), "WebSocket key missing");
        string accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
        byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n");
        await stream.WriteAsync(response.AsMemory(), stop);
        return WebSocket.CreateFromStream(stream, isServer: true, subProtocol: "obswebsocket.json", keepAliveInterval: Timeout.InfiniteTimeSpan);
    }

    static JsonObject Request(JsonObject packet)
    {
        Check((int?)packet["op"] == 6 && packet["d"] is JsonObject, "expected an OBS request envelope");
        return packet["d"]!.AsObject();
    }

    static Task Reply(WebSocket socket, JsonObject request, JsonObject data, CancellationToken stop, int code = 100) =>
        Send(socket, new()
        {
            ["op"] = 7,
            ["d"] = new JsonObject
            {
                ["requestId"] = request["requestId"]!.DeepClone(),
                ["requestStatus"] = new JsonObject { ["result"] = code == 100, ["code"] = code, ["comment"] = code == 100 ? "" : "Fixture refused" },
                ["responseData"] = data
            }
        }, stop, fragmented: true);

    public static async Task RunAsync()
    {
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var stop = deadline.Token;
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;
        string password = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        string salt = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        string challenge = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16));
        var inputId = Guid.NewGuid();
        const string inputName = "Portable fixture input";
        double level = -6;
        int writes = 0;
        var server = Task.Run(async () =>
        {
            using var tcp = await listener.AcceptTcpClientAsync(stop);
            using var stream = tcp.GetStream();
            using var socket = await Upgrade(stream, stop);
            await Send(socket, new() { ["op"] = 0, ["d"] = new JsonObject { ["rpcVersion"] = 1,
                ["authentication"] = new JsonObject { ["salt"] = salt, ["challenge"] = challenge } } }, stop);
            var identify = await Receive(socket, stop);
            Check((int?)identify["op"] == 1 && (string?)identify["d"]?["authentication"] == Hash(Hash(password + salt) + challenge), "authentication proof differs");
            Check((int?)identify["d"]?["rpcVersion"] == 1 && (int?)identify["d"]?["eventSubscriptions"] == 25, "RPC version differs, or the traced connection did not subscribe to general, input and transition events");
            await Send(socket, new() { ["op"] = 2, ["d"] = new JsonObject { ["negotiatedRpcVersion"] = 1 } }, stop);

            // Reply to two concurrent requests backwards, exercising request-ID correlation.
            var pair = new[] { Request(await Receive(socket, stop)), Request(await Receive(socket, stop)) };
            Check(pair.Select(p => (string)p["requestType"]!).ToHashSet().SetEquals(["GetVersion", "GetInputMute"]), "concurrent request pair differs");
            foreach (var request in pair.Reverse())
                await Reply(socket, request, (string?)request["requestType"] == "GetVersion"
                    ? new() { ["obsVersion"] = "fixture-33" } : new() { ["inputMuted"] = true }, stop);
            while (true)
            {
                var request = Request(await Receive(socket, stop));
                string op = (string)request["requestType"]!;
                switch (op)
                {
                    case "GetInputVolume":
                        Check((string?)request["requestData"]?["inputName"] == inputName, "unexpected audio source");
                        await Reply(socket, request, new() { ["inputVolumeDb"] = level, ["inputVolumeMul"] = Math.Pow(10, level / 20) }, stop);
                        break;
                    case "SetInputVolume":
                        Check((string?)request["requestData"]?["inputName"] == inputName, "unexpected audio write source");
                        level = (double)request["requestData"]!["inputVolumeDb"]!;
                        writes++;
                        await Send(socket, new() { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "InputVolumeChanged", ["eventIntent"] = 8,
                            ["eventData"] = new JsonObject { ["inputName"] = inputName, ["inputUuid"] = inputId.ToString(), ["inputVolumeDb"] = level, ["inputVolumeMul"] = Math.Pow(10, level / 20) } } }, stop, fragmented: true);
                        await Send(socket, new() { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "CustomEvent", ["eventIntent"] = 1,
                            ["eventData"] = new JsonObject { ["fixture"] = "received" } } }, stop);
                        // The transition trace's events: one well formed, one with a name that is not text, one more well formed.
                        await Send(socket, new() { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "CurrentSceneTransitionChanged", ["eventIntent"] = 16,
                            ["eventData"] = new JsonObject { ["transitionName"] = "Fixture Fade", ["transitionUuid"] = Guid.NewGuid().ToString() } } }, stop);
                        await Send(socket, new() { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "SceneTransitionStarted", ["eventIntent"] = 16,
                            ["eventData"] = new JsonObject { ["transitionName"] = 7 } } }, stop);
                        await Send(socket, new() { ["op"] = 5, ["d"] = new JsonObject { ["eventType"] = "SceneTransitionEnded", ["eventIntent"] = 16,
                            ["eventData"] = new JsonObject { ["transitionName"] = "Fixture Fade" } } }, stop);
                        await Reply(socket, request, new(), stop);
                        break;
                    case "GetReplayBufferStatus":
                        await Reply(socket, request, new(), stop, code: 604);
                        break;
                    case "GetStudioModeEnabled":
                        // Deliberately leave one correlated request unresolved before disconnect.
                        break;
                    case "GetStreamStatus":
                        await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "Fixture complete", stop);
                        return;
                    default: throw new InvalidOperationException("Unexpected fixture request: " + op);
                }
            }
        }, stop);

        string? previous = Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD");
        Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", password);
        try
        {
            var cfg = new BridgeConfig { Host = "127.0.0.1", Port = port, MusicInput = inputName };
            Check(ObsConnection.Subscriptions(false) == 9, "without the transition trace the connection must subscribe to general and input events only");
            using var obs = await ObsConnection.Connect(cfg, stop, transitionEvents: true);
            var version = obs.Call("GetVersion");
            var muted = obs.Call("GetInputMute", new() { ["inputName"] = inputName });
            await Task.WhenAll(version, muted).WaitAsync(stop);
            Check((string?)version.Result["obsVersion"] == "fixture-33" && (bool?)muted.Result["inputMuted"] == true, "out-of-order responses were misrouted");
            var named = new TaskCompletionSource<double>(TaskCreationOptions.RunContinuationsAsynchronously);
            var uuid = new TaskCompletionSource<double>(TaskCreationOptions.RunContinuationsAsynchronously);
            var custom = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            obs.InputVolumeChanged += (name, db) => { if (name == inputName) named.TrySetResult(db); };
            obs.InputLevelChangedById += (id, mul) => { if (id == inputId) uuid.TrySetResult(mul); };
            obs.CustomEvent += data => { if ((string?)data["fixture"] == "received") custom.TrySetResult(); };
            var transitions = new List<string>();
            var traced = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            obs.TransitionEvent += (kind, name) => { lock (transitions) transitions.Add(kind + ":" + name); if (kind == "SceneTransitionEnded") traced.TrySetResult(); };
            // A listener that fails must not cost the connection: the undo below still needs it.
            obs.TransitionEvent += (_, _) => throw new InvalidOperationException("fixture listener");
            var desk = new DeskActions(cfg, obs.Call);
            obs.InputVolumeChanged += desk.OnVolumeChanged;
            await desk.Dispatch("music.down").WaitAsync(stop);
            Check(await named.Task.WaitAsync(stop) == -7 && Math.Abs(await uuid.Task.WaitAsync(stop) - Math.Pow(10, -7d / 20)) < 1e-12, "volume events lost or changed");
            await custom.Task.WaitAsync(stop);
            await traced.Task.WaitAsync(stop);
            lock (transitions) Check(transitions.Take(2).SequenceEqual(["CurrentSceneTransitionChanged:Fixture Fade", "SceneTransitionEnded:Fixture Fade"]),
                "transition events lost or changed, or one without a text name was passed on");
            await desk.Dispatch("undo").WaitAsync(stop);
            Check(level == -6 && writes == 2, "production dispatcher/undo did not complete its round trip");
            try { await obs.Call("GetReplayBufferStatus"); throw new InvalidOperationException("Refused request was accepted."); }
            catch (ObsError e) when (e.Code == 604) { }
            var pending = obs.Call("GetStudioModeEnabled");
            var closing = obs.Call("GetStreamStatus");
            foreach (var request in new[] { pending, closing })
            {
                try { await request.WaitAsync(stop); throw new InvalidOperationException("Disconnected pending request succeeded."); }
                catch (IOException) { }
            }
            await obs.Disconnected.WaitAsync(stop);
            await server.WaitAsync(stop);
        }
        finally
        {
            Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", previous);
            deadline.Cancel();
            listener.Stop();
            try { await server; }
            catch (OperationCanceledException) when (deadline.IsCancellationRequested) { }
        }
    }
}
