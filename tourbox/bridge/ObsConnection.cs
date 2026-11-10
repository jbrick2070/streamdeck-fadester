// SPDX-License-Identifier: GPL-2.0-or-later
using System.Buffers;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal sealed class ObsError(string request, int code, string comment) : Exception($"{request}: {comment} ({code})")
{
    public int Code { get; } = code;
}

/// <summary>
/// One of the four ways OBS can refuse a connection that the user fixes in OBS. The message ends with its code in
/// brackets, for example "(obs-no-answer)": the panel shows its own translated text for that code.
/// </summary>
internal sealed class ObsSetupException(string code, string message) : InvalidOperationException($"{message} ({code})")
{
    public string Code { get; } = code;
    public static ObsSetupException NotAnswering(int port) => new("obs-no-answer",
        $"OBS is not answering on port {port}. Start OBS. In OBS, open Tools → WebSocket Server Settings and turn on Enable WebSocket server.");
    public static ObsSetupException NoPassword() => new("obs-no-password",
        "OBS has no WebSocket password saved on this PC. In OBS, open Tools → WebSocket Server Settings, turn on Enable WebSocket server and Enable Authentication, and click OK. Or type the password in the panel's Setup tab (or set FADESTER_OBS_PASSWORD).");
    public static ObsSetupException AuthenticationOff() => new("obs-auth-off",
        "Authentication is off in OBS. In OBS, open Tools → WebSocket Server Settings and turn on Enable Authentication.");
    public static ObsSetupException PasswordRejected() => new("obs-bad-password",
        "OBS did not accept the password. In OBS, open Tools → WebSocket Server Settings and click Show Connect Info to see the password.");
}

internal sealed class ObsConnection : IDisposable
{
    private readonly ClientWebSocket socket = new();
    private readonly SemaphoreSlim send = new(1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonObject>> pending = new();
    private readonly CancellationTokenSource lifetime = new();
    private readonly TaskCompletionSource disconnected = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task Disconnected => disconnected.Task;
    public event Action<string, double>? InputVolumeChanged;
    public event Action<Guid, double>? InputLevelChangedById;
    public event Action<JsonObject>? CustomEvent;
    /// <summary>(event type, transition name) for CurrentSceneTransitionChanged, SceneTransitionStarted and
    /// SceneTransitionEnded. Raised only on a connection opened with transitionEvents; a diagnostic, not a control.</summary>
    public event Action<string, string>? TransitionEvent;

    // General (1) and Inputs (8); Transitions (16) only for the transition trace.
    internal static int Subscriptions(bool transitionEvents) => transitionEvents ? 25 : 9;

    public static async Task<ObsConnection> Connect(BridgeConfig cfg, CancellationToken stop, bool transitionEvents = false)
    {
        var client = new ObsConnection();
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromSeconds(6));
            string password = cfg.Password();
            var endpoint = new UriBuilder("ws", cfg.Host, cfg.Port).Uri;
            client.socket.Options.AddSubProtocol("obswebsocket.json");
            await client.socket.ConnectAsync(endpoint, timeout.Token);
            var hello = await client.Receive(timeout.Token);
            if (hello["op"]?.GetValue<int>() != 0 || hello["d"]?["authentication"] is not JsonObject auth)
                throw ObsSetupException.AuthenticationOff();
            static string Hash(string s) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(s)));
            string signature = Hash(Hash(password + auth["salt"]!.GetValue<string>()) + auth["challenge"]!.GetValue<string>());
            await client.Send(new() { ["op"] = 1, ["d"] = new JsonObject { ["rpcVersion"] = 1, ["eventSubscriptions"] = Subscriptions(transitionEvents), ["authentication"] = signature } }, timeout.Token);
            if ((await client.Receive(timeout.Token))["op"]?.GetValue<int>() != 2) throw new IOException("OBS rejected identification.");
            _ = client.Listen();
            return client;
        }
        // Nothing listens on the port (OBS closed, or its server off), or OBS did not answer in 6 s.
        catch (WebSocketException) { client.Dispose(); throw ObsSetupException.NotAnswering(cfg.Port); }
        catch (OperationCanceledException) when (!stop.IsCancellationRequested) { client.Dispose(); throw ObsSetupException.NotAnswering(cfg.Port); }
        catch { client.Dispose(); throw; }
    }

    private async Task<JsonObject> Receive(CancellationToken token)
    {
        var buffer = new ArrayBufferWriter<byte>();
        while (true)
        {
            var message = await socket.ReceiveAsync(buffer.GetMemory(8192), token);
            if (message.MessageType == WebSocketMessageType.Close) throw socket.CloseStatus == (WebSocketCloseStatus)4009 ? ObsSetupException.PasswordRejected() : new IOException("OBS disconnected.");
            if (message.MessageType != WebSocketMessageType.Text || buffer.WrittenCount + message.Count > 16 * 1024 * 1024) throw new InvalidDataException("Invalid OBS packet.");
            buffer.Advance(message.Count);
            if (message.EndOfMessage) return JsonNode.Parse(buffer.WrittenSpan)?.AsObject() ?? throw new InvalidDataException("Empty OBS packet.");
        }
    }

    private async Task Send(JsonObject packet, CancellationToken token)
    {
        await send.WaitAsync(token);
        try { await socket.SendAsync(Encoding.UTF8.GetBytes(packet.ToJsonString()), WebSocketMessageType.Text, true, token); }
        finally { send.Release(); }
    }

    private async Task Listen()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                var packet = await Receive(lifetime.Token);
                if (packet["op"]?.GetValue<int>() == 5 && (string?)packet["d"]?["eventType"] == "CustomEvent" &&
                    packet["d"]?["eventData"] is JsonObject custom)
                {
                    CustomEvent?.Invoke(custom);
                    continue;
                }
                if (packet["op"]?.GetValue<int>() == 5 && packet["d"]?["eventType"]?.GetValue<string>() == "InputVolumeChanged" &&
                    packet["d"]?["eventData"] is JsonObject change && change["inputName"]?.GetValue<string>() is string source &&
                    change["inputVolumeDb"]?.GetValue<double>() is double level)
                {
                    InputVolumeChanged?.Invoke(source, Math.Clamp(level, -100, 26));
                    if (Guid.TryParse(change["inputUuid"]?.GetValue<string>(), out var id) &&
                        change["inputVolumeMul"]?.GetValue<double>() is double mul && double.IsFinite(mul))
                        InputLevelChangedById?.Invoke(id, mul);
                    continue;
                }
                if (packet["op"]?.GetValue<int>() == 5 && packet["d"]?["eventType"] is JsonValue type && type.TryGetValue<string>(out var kind) &&
                    kind is "CurrentSceneTransitionChanged" or "SceneTransitionStarted" or "SceneTransitionEnded")
                {
                    // A listener that only watches must never cost the connection, so its failure stops here.
                    if (packet["d"]?["eventData"]?["transitionName"] is JsonValue named && named.TryGetValue<string>(out var transition))
                        try { TransitionEvent?.Invoke(kind, transition); } catch (Exception) { }
                    continue;
                }
                if (packet["op"]?.GetValue<int>() != 7 || packet["d"] is not JsonObject reply) continue;
                if (pending.TryRemove(reply["requestId"]!.GetValue<string>(), out var wait)) wait.TrySetResult(reply);
            }
        }
        catch (Exception) { /* Outstanding requests fail below. No write is replayed on reconnect. */ }
        finally { Close(); }
    }

    public async Task<JsonObject> Call(string request, JsonObject? args = null)
    {
        if (Disconnected.IsCompleted) throw new IOException("OBS is disconnected.");
        string id = Guid.NewGuid().ToString("N");
        var wait = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        pending[id] = wait;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            timeout.CancelAfter(TimeSpan.FromSeconds(5));
            await Send(new() { ["op"] = 6, ["d"] = new JsonObject { ["requestType"] = request, ["requestId"] = id, ["requestData"] = args?.DeepClone() ?? new JsonObject() } }, timeout.Token);
            var reply = await wait.Task.WaitAsync(timeout.Token);
            var status = reply["requestStatus"]!.AsObject();
            if (!status["result"]!.GetValue<bool>()) throw new ObsError(request, status["code"]!.GetValue<int>(), status["comment"]?.GetValue<string>() ?? "request refused");
            return reply["responseData"] as JsonObject ?? new JsonObject();
        }
        catch (OperationCanceledException) { Close(); throw new IOException($"{request} timed out or disconnected; command was not retried."); }
        finally { pending.TryRemove(id, out _); }
    }

    private void Close()
    {
        if (!disconnected.TrySetResult()) return;
        lifetime.Cancel();
        socket.Abort();
        foreach (var item in pending.Values) item.TrySetException(new IOException("OBS disconnected."));
    }

    public void Dispose() { Close(); socket.Dispose(); }
}
