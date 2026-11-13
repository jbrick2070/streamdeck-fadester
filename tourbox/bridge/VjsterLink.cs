// SPDX-License-Identifier: GPL-2.0-or-later
// The VJster link, hosted by the TourBox companion: the loopback WebSocket and
// optional /obs Browser Source page that the VJster Chrome extension and OBS
// connect to, so TourBox controls can change video speed and quality in Chrome
// or directly inside an OBS Browser Source without needing Midi Fadester. A port
// of the Stream Deck plugin's server (src/vjster/plugin/link-server.ts,
// src/vjster/plugin/obs-page.ts) and protocol v1 (src/vjster/shared/protocol.ts).
//
// Who may connect, decided on the HTTP upgrade before any WebSocket exists:
// - exactly one Host header naming this server (127.0.0.1 or localhost on its
//   port, which defeats DNS rebinding);
// - with a `token` query parameter, the Origin must be http://127.0.0.1:<port>
//   or http://localhost:<port>, the token must match obsToken in constant time,
//   and the connection becomes the `obs` target;
// - without one, the Origin must be chrome-extension://<32 letters a-p>, one of
//   the pinned ids when there are any, and the connection becomes `browser`.
// Anything else gets a plain HTTP 403 and no WebSocket; plain HTTP GET/HEAD
// serves only the registered /obs page assets (with strict Host + CSP), and any
// other plain HTTP request gets 426. One peer per target at a time: a newer
// connection for the same target replaces the older one with close code 4000.
//
// Logs never carry a URL, a title, a token or a message body (docs/vjster R-BEH-5).

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Fadester.TourBox;

/** What the extension reports about the current video (protocol v1 `state`). */
internal sealed record VjsterState(
    double? Rate, bool RateDirect, double[] AvailableRates, string? Quality, string[] AvailableQualities, bool? QualityAuto,
    string? Title, string? Host, bool Playing, bool AdPlaying, string[] Capabilities, bool Pinned, string? InReplyTo);

internal sealed record VjsterError(string Code, string Message, string? InReplyTo);

/** The port cannot be bound: another program holds it (the Stream Deck plugin's VJster, say) or Windows reserves it. */
internal sealed class VjsterPortInUseException(int port, string code) : Exception($"VJster port {port} on 127.0.0.1 is not available ({code})")
{
    public int Port { get; } = port;
}

/** One static file served over plain HTTP on the VJster loopback port (/obs, /obs/player.js). */
internal sealed record VjsterPage(string Type, byte[] Body);

/** One parsed message from a VJster target, or why it was refused. */
internal sealed record VjsterParse(bool Ok, string Code, string Reason, string? InReplyTo, string Type, string Target, VjsterState? State, VjsterError? Error, double T)
{
    public static VjsterParse Fail(string code, string reason, string? inReplyTo = null) => new(false, code, reason, inReplyTo, "", "", null, null, 0);
}

internal sealed class VjsterLink : IAsyncDisposable
{
    public const string LinkHost = "127.0.0.1";
    public const int DefaultPort = 48150;
    public const int ProtocolVersion = 1;
    public const int MaxMessageChars = 16384;
    public const int MaxPayloadBytes = MaxMessageChars * 3;
    public const int CloseReplaced = 4000, CloseIdle = 4001;
    public const string ObsPagePath = "/obs";
    public const string VideoPlaceholder = "VIDEO_ID";
    public const string PageCsp = "default-src 'none'; script-src 'self' https://www.youtube.com https://s.ytimg.com; frame-src https://www.youtube.com; connect-src ws://127.0.0.1:* ws://localhost:*; style-src 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
    public static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan IdleTimeout = TimeSpan.FromSeconds(60);
    public static readonly TimeSpan ReaskMin = TimeSpan.FromSeconds(2);
    public static readonly TimeSpan RefusalLogEvery = TimeSpan.FromSeconds(10);
    public static readonly TimeSpan HandshakeTimeout = TimeSpan.FromSeconds(5);
    const int MaxHeaderBytes = 8192;
    // \z, not $: in .NET, $ also matches before a trailing newline, which the plugin's regexes refuse.
    static readonly Regex ExtensionIdPattern = new(@"^[a-p]{32}\z", RegexOptions.Compiled);
    static readonly Regex ExtensionOrigin = new(@"^chrome-extension://([a-p]{32})\z", RegexOptions.Compiled);
    static readonly Regex TokenPattern = new(@"^[0-9a-f]{32}\z", RegexOptions.Compiled);
    static readonly Regex VideoIdPattern = new(@"^[A-Za-z0-9_-]{11}\z", RegexOptions.Compiled);
    static readonly Regex IdPattern = new(@"^[A-Za-z0-9_-]{1,64}\z", RegexOptions.Compiled);
    static readonly Regex LevelId = new(@"^[a-z0-9]{1,16}\z", RegexOptions.Compiled);
    static readonly Regex HostPattern = new(@"^[A-Za-z0-9.-]{1,253}\z", RegexOptions.Compiled);
    static readonly string[] IntentTypes = ["speed.set", "speed.step", "speed.reset", "quality.set", "quality.step", "quality.reset", "transport.toggle", "state.get", "pin.set"];
    static readonly string[] ErrorCodes = ["too-long", "bad-json", "bad-version", "bad-message", "unknown-type", "unexpected-type", "no-video", "unsupported", "internal"];
    static readonly string[] KnownCapabilities = ["speed", "quality", "transport"];
    const double MaxRate = 16; // the extended range's top (src/vjster/shared/speed.ts)
    const int MaxTitleChars = 300, MaxList = 64;

    sealed class Peer(TcpClient client, WebSocket socket, string target)
    {
        public readonly TcpClient Client = client;
        public readonly WebSocket Socket = socket;
        public readonly string Target = target;
        public long LastHeard = Stopwatch.GetTimestamp();
        public long LastReask = long.MinValue / 2;
        public bool WarnedMalformed;
        public Task? Loop;
        public readonly SemaphoreSlim SendLock = new(1);
    }

    readonly int port;
    readonly string[] allowed;
    readonly string? obsToken;
    readonly IReadOnlyDictionary<string, VjsterPage> pages;
    readonly Action<string> log;
    readonly object gate = new();
    readonly Dictionary<string, Peer> peers = new(StringComparer.Ordinal);
    readonly Dictionary<string, VjsterState?> states = new(StringComparer.Ordinal);
    readonly ConcurrentDictionary<string, (string Target, TaskCompletionSource<(VjsterState? State, VjsterError? Error)> Tcs)> pending = new();
    readonly string idPrefix = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
    TcpListener? listener;
    CancellationTokenSource? running;
    Task? acceptLoop, pingLoop;
    int nextId = 1, refusalsSinceLog;
    long lastRefusalLog = long.MinValue / 2;

    public event Action<VjsterState>? StateReceived;
    public event Action<VjsterError>? ErrorReceived;
    public event Action<bool>? ConnectionChanged;

    /** The last state reported on an active connection (browser preferred when both are up); null when none is connected. */
    public VjsterState? LastState => GetLastState("browser") ?? GetLastState("obs");

    /**
     * `allowedExtensionIds`: ids that may connect; empty allows any extension. A malformed id is dropped with a
     * warning, and a list of only malformed ids refuses everyone (fail closed), as the plugin does.
     * `obsToken`: 32 lowercase hex digits for the /obs Browser Source target, or null/empty to refuse token connections.
     */
    public VjsterLink(int port, IEnumerable<string>? allowedExtensionIds = null, Action<string>? log = null,
        string? obsToken = null, IReadOnlyDictionary<string, VjsterPage>? pages = null)
    {
        this.port = port;
        this.log = log ?? (_ => { });
        this.pages = pages ?? new Dictionary<string, VjsterPage>(StringComparer.Ordinal);
        var ids = (allowedExtensionIds ?? []).Select(id => id.Trim().ToLowerInvariant()).Where(id => id.Length > 0).ToArray();
        var good = ids.Where(id => ExtensionIdPattern.IsMatch(id)).ToArray();
        if (good.Length < ids.Length) this.log($"VJster: ignored {ids.Length - good.Length} malformed pinned extension id(s)");
        allowed = ids.Length > 0 && good.Length == 0 ? ["-"] : good;
        if (!string.IsNullOrEmpty(obsToken))
        {
            if (TokenPattern.IsMatch(obsToken)) this.obsToken = obsToken;
            else this.log("VJster: ignored a malformed OBS page token; OBS pages cannot connect");
        }
    }

    public static string NewObsToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    public static IReadOnlyDictionary<string, VjsterPage> LoadObsPages(string? dir, Action<string>? log = null)
    {
        if (string.IsNullOrEmpty(dir)) return new Dictionary<string, VjsterPage>(StringComparer.Ordinal);
        try
        {
            var html = new VjsterPage("text/html; charset=utf-8", File.ReadAllBytes(Path.Combine(dir, "player.html")));
            var script = new VjsterPage("text/javascript; charset=utf-8", File.ReadAllBytes(Path.Combine(dir, "player.js")));
            return new Dictionary<string, VjsterPage>(StringComparer.Ordinal)
            {
                [ObsPagePath] = html,
                [$"{ObsPagePath}/"] = html,
                [$"{ObsPagePath}/player.js"] = script
            };
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            log?.Invoke("VJster: the OBS page files are missing; OBS browser sources cannot load /obs");
            return new Dictionary<string, VjsterPage>(StringComparer.Ordinal);
        }
    }

    public static string? VideoIdFrom(string? input)
    {
        var text = (input ?? "").Trim();
        if (text.Length == 0) return null;
        if (VideoIdPattern.IsMatch(text)) return text != "videoseries" ? text : null;
        string withScheme = text.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || text.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? text : "https://" + text;
        if (!Uri.TryCreate(withScheme, UriKind.Absolute, out var uri)) return null;
        string host = uri.Host.ToLowerInvariant();
        bool youtube = host == "youtube.com" || host.EndsWith(".youtube.com", StringComparison.Ordinal)
            || host == "youtube-nocookie.com" || host.EndsWith(".youtube-nocookie.com", StringComparison.Ordinal);
        string? candidate = null;
        if (host == "youtu.be")
        {
            var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
            candidate = segments.Length > 0 ? segments[0] : null;
        }
        else if (youtube)
        {
            if (TryGetQuery(uri.Query.TrimStart('?'), "v", out var v)) candidate = v;
            else
            {
                var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
                if (segments.Length >= 2 && segments[0] is "shorts" or "embed" or "live" or "v") candidate = segments[1];
            }
        }
        return candidate != null && VideoIdPattern.IsMatch(candidate) && candidate != "videoseries" ? candidate : null;
    }

    public static string ObsPageAddress(int port, string token, string? videoInput = null)
    {
        if (!TokenPattern.IsMatch(token)) throw new ArgumentException("Invalid OBS page token.", nameof(token));
        string v = VideoIdFrom(videoInput) ?? VideoPlaceholder;
        return $"http://{LinkHost}:{port}{ObsPagePath}?v={v}#token={token}";
    }

    static string PeerLabel(string target) => target == "obs" ? "the OBS video page" : "the Chrome extension";

    public int Port => port;
    public bool Running => listener != null;
    /** The port actually bound (differs from the option only when it was 0, in tests). */
    public int BoundPort => listener == null ? port : ((IPEndPoint)listener.LocalEndpoint).Port;
    public bool Connected => IsConnected("browser") || IsConnected("obs");

    public bool IsConnected(string target)
    {
        lock (gate) return peers.TryGetValue(target, out var p) && p.Socket.State == WebSocketState.Open;
    }

    public VjsterState? GetLastState(string target)
    {
        lock (gate) return states.TryGetValue(target, out var s) ? s : null;
    }

    /** Bind 127.0.0.1 and start accepting. Throws VjsterPortInUseException when the port is taken or reserved. */
    public Task StartAsync()
    {
        lock (gate)
        {
            if (listener != null) return Task.CompletedTask;
            var l = new TcpListener(IPAddress.Loopback, port) { ExclusiveAddressUse = true };
            try { l.Start(); }
            catch (SocketException e) when (e.SocketErrorCode is SocketError.AddressAlreadyInUse or SocketError.AccessDenied)
            {
                throw new VjsterPortInUseException(port, e.SocketErrorCode.ToString());
            }
            listener = l;
            running = new CancellationTokenSource();
            acceptLoop = AcceptLoop(l, running.Token);
            pingLoop = PingLoop(running.Token);
            log($"VJster link listening on {LinkHost}:{BoundPort}");
            return Task.CompletedTask;
        }
    }

    /** Close every connection, free the port. Safe to call twice. */
    public async Task StopAsync()
    {
        TcpListener? l; CancellationTokenSource? r; Task? a, p; Peer[] gone;
        lock (gate)
        {
            l = listener; r = running; a = acceptLoop; p = pingLoop; gone = peers.Values.ToArray();
            listener = null; running = null; acceptLoop = null; pingLoop = null;
            peers.Clear(); states.Clear();
        }
        if (l == null) return;
        // Stop taking connections first, so none arrives while the current ones close. The receive loop runs without
        // this token, so cancelling it does not abort a peer's socket.
        r!.Cancel();
        l.Stop();
        if (gone.Length > 0)
        {
            foreach (var peer in gone) await Drop(peer, (WebSocketCloseStatus)1001, "server stopping", announce: false);
            Raise(ConnectionChanged, false);
        }
        foreach (var t in new[] { a, p }) { try { if (t != null) await t; } catch (OperationCanceledException) { } catch (ObjectDisposedException) { } }
        foreach (var key in pending.Keys) if (pending.TryRemove(key, out var entry)) entry.Tcs.TrySetResult((null, new VjsterError("internal", "the link stopped", null)));
        r.Dispose();
        log("VJster link stopped");
    }

    public ValueTask DisposeAsync() => new(StopAsync());

    // ---- the upgrade gate ----

    /** Why an upgrade is refused, or ok (browser-only overload kept for existing self-tests). */
    public static (bool Ok, string Reason) ClassifyUpgrade(string? host, int hostHeaders, string? origin, string query, int port, IReadOnlyList<string> allowed)
    {
        var (ok, reason, _) = ClassifyUpgrade(host, hostHeaders, origin, query, port, allowed, null);
        return (ok, reason);
    }

    /** Why an upgrade is refused, or which target it is (matching link-server.ts classifyUpgrade). */
    public static (bool Ok, string Reason, string Target) ClassifyUpgrade(string? host, int hostHeaders, string? origin, string query, int port, IReadOnlyList<string> allowed, string? obsToken)
    {
        if (hostHeaders != 1 || (host != $"{LinkHost}:{port}" && host != $"localhost:{port}")) return (false, "host", "");
        if (TryGetQuery(query, "token", out var token))
        {
            if (obsToken == null) return (false, "token", "");
            if (origin != $"http://{LinkHost}:{port}" && origin != $"http://localhost:{port}") return (false, "origin", "");
            if (!TokenPattern.IsMatch(token) || !TokenPattern.IsMatch(obsToken)) return (false, "token", "");
            bool same = CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes(obsToken));
            return same ? (true, "", "obs") : (false, "token", "");
        }
        var match = ExtensionOrigin.Match(origin ?? "");
        if (!match.Success) return (false, "origin", "");
        if (allowed.Count > 0 && !allowed.Contains(match.Groups[1].Value)) return (false, "extension-id", "");
        return (true, "", "browser");
    }

    static bool TryGetQuery(string query, string name, out string value)
    {
        foreach (var part in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            try
            {
                if (Uri.UnescapeDataString(kv[0].Replace('+', ' ')) == name)
                {
                    value = kv.Length == 2 ? Uri.UnescapeDataString(kv[1].Replace('+', ' ')) : "";
                    return true;
                }
            }
            catch (UriFormatException) { }
        }
        value = "";
        return false;
    }

    async Task AcceptLoop(TcpListener l, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient client;
            try { client = await l.AcceptTcpClientAsync(stop); }
            catch (OperationCanceledException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (SocketException e)
            {
                if (stop.IsCancellationRequested) return;
                log($"VJster link accept error ({e.SocketErrorCode})");
                try { await Task.Delay(250, stop); } catch (OperationCanceledException) { return; } // a persistent error must not spin
                continue;
            }
            _ = Handshake(client, stop);
        }
    }

    async Task Handshake(TcpClient client, CancellationToken stop)
    {
        try
        {
            client.NoDelay = true;
            var stream = client.GetStream();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(HandshakeTimeout);
            var head = await ReadHead(stream, timeout.Token);
            if (head == null) { client.Dispose(); return; }
            var (requestLine, headers) = head.Value;
            var parts = requestLine.Split(' ');
            if (parts.Length != 3 || !parts[2].StartsWith("HTTP/1.", StringComparison.Ordinal)) { await Reply(stream, "400 Bad Request", "bad request"); client.Dispose(); return; }
            string method = parts[0], target = parts[1];
            string path = target.Split(['?', '#'], 2)[0];
            string query = target.Contains('?') ? target[(target.IndexOf('?') + 1)..].Split('#')[0] : "";
            headers.TryGetValue("host", out var hosts);
            bool upgrade = headers.TryGetValue("upgrade", out var up) && up.Count == 1 && up[0].Equals("websocket", StringComparison.OrdinalIgnoreCase)
                && headers.TryGetValue("sec-websocket-key", out var keys) && keys.Count == 1
                && headers.TryGetValue("sec-websocket-version", out var versions) && versions.Count == 1 && versions[0].Trim() == "13";
            if (!upgrade)
            {
                if ((method == "GET" || method == "HEAD") && pages.TryGetValue(path, out var page))
                {
                    int bound = BoundPort;
                    if (hosts?.Count != 1 || (hosts[0] != $"{LinkHost}:{bound}" && hosts[0] != $"localhost:{bound}"))
                    {
                        await Reply(stream, "403 Forbidden", "forbidden");
                        client.Dispose();
                        NoteRefusal("host");
                        return;
                    }
                    var headBytes = Encoding.ASCII.GetBytes(
                        $"HTTP/1.1 200 OK\r\nContent-Type: {page.Type}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: strict-origin\r\nContent-Security-Policy: {PageCsp}\r\nConnection: close\r\nContent-Length: {page.Body.Length}\r\n\r\n");
                    await stream.WriteAsync(headBytes, timeout.Token);
                    if (method == "GET" && page.Body.Length > 0) await stream.WriteAsync(page.Body, timeout.Token);
                    client.Dispose();
                    return;
                }
                await Reply(stream, "426 Upgrade Required", "upgrade required");
                client.Dispose();
                return;
            }
            if (method != "GET")
            {
                await Reply(stream, "426 Upgrade Required", "upgrade required");
                client.Dispose();
                return;
            }
            headers.TryGetValue("origin", out var origins);
            var verdict = ClassifyUpgrade(hosts?.FirstOrDefault(), hosts?.Count ?? 0, origins?.Count == 1 ? origins[0] : null, query, BoundPort, allowed, obsToken);
            if (!verdict.Ok)
            {
                await Reply(stream, "403 Forbidden", "");
                client.Dispose();
                NoteRefusal(verdict.Reason);
                return;
            }
            var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(headers["sec-websocket-key"][0].Trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            var response = Encoding.ASCII.GetBytes($"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n");
            await stream.WriteAsync(response, timeout.Token);
            var socket = WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, keepAliveInterval: TimeSpan.Zero);
            Accept(new Peer(client, socket, verdict.Target), stop);
        }
        catch (Exception e) when (e is IOException or SocketException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
        {
            client.Dispose();
        }
    }

    /** The request line and headers (lower-case names, every value), read byte by byte so nothing after the head is consumed. */
    static async Task<(string, Dictionary<string, List<string>>)?> ReadHead(NetworkStream stream, CancellationToken token)
    {
        var bytes = new List<byte>(1024);
        var one = new byte[1];
        while (bytes.Count < MaxHeaderBytes)
        {
            int n = await stream.ReadAsync(one, token);
            if (n == 0) return null;
            bytes.Add(one[0]);
            int c = bytes.Count;
            if (c >= 4 && bytes[c - 4] == '\r' && bytes[c - 3] == '\n' && bytes[c - 2] == '\r' && bytes[c - 1] == '\n') break;
        }
        if (bytes.Count >= MaxHeaderBytes) return null;
        var lines = Encoding.ASCII.GetString(bytes.ToArray()).Split("\r\n", StringSplitOptions.None);
        var headers = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var line in lines.Skip(1))
        {
            if (line.Length == 0) continue;
            int colon = line.IndexOf(':');
            if (colon <= 0) return null;
            var name = line[..colon].Trim().ToLowerInvariant();
            if (!headers.TryGetValue(name, out var list)) headers[name] = list = [];
            list.Add(line[(colon + 1)..].Trim());
        }
        return (lines[0], headers);
    }

    static Task Reply(NetworkStream stream, string status, string body)
    {
        var text = $"HTTP/1.1 {status}\r\nContent-Type: text/plain\r\nConnection: close\r\nContent-Length: {Encoding.ASCII.GetByteCount(body)}\r\n\r\n{body}";
        return stream.WriteAsync(Encoding.ASCII.GetBytes(text)).AsTask();
    }

    /** Anyone on this machine can knock; log a refusal at most once every 10 s, with a count. */
    void NoteRefusal(string reason)
    {
        int more;
        lock (gate)
        {
            refusalsSinceLog++;
            if (Stopwatch.GetElapsedTime(lastRefusalLog) < RefusalLogEvery) return;
            more = refusalsSinceLog - 1;
            refusalsSinceLog = 0;
            lastRefusalLog = Stopwatch.GetTimestamp();
        }
        log($"VJster link refused a connection ({reason}){(more > 0 ? $" (and {more} more since the last note)" : "")}");
    }

    // ---- the connection ----

    void Accept(Peer p, CancellationToken stop)
    {
        Peer? previous = null; bool stopping;
        lock (gate)
        {
            // Under the lock StopAsync takes: a handshake that finishes as the link stops never becomes a peer.
            stopping = stop.IsCancellationRequested || listener == null;
            if (!stopping)
            {
                peers.TryGetValue(p.Target, out previous);
                peers[p.Target] = p;
                states[p.Target] = null;
            }
        }
        if (stopping) { _ = Drop(p, (WebSocketCloseStatus)1001, "server stopping", announce: false); return; }
        if (previous != null) _ = Drop(previous, (WebSocketCloseStatus)CloseReplaced, "replaced by a newer connection", announce: false);
        log($"VJster: {PeerLabel(p.Target)} connected");
        Raise(ConnectionChanged, true);
        p.Loop = ReceiveLoop(p);
        Send("state.get", null, p.Target); // ask for the current state at once
    }

    /** Send a close frame, give the peer up to two seconds to answer it (its receive loop ends then), and free the socket. */
    async Task Drop(Peer p, WebSocketCloseStatus status, string reason, bool announce)
    {
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            if (p.Socket.State is WebSocketState.Open or WebSocketState.CloseReceived) await p.Socket.CloseOutputAsync(status, reason, timeout.Token);
            if (p.Loop != null) await Task.WhenAny(p.Loop, Task.Delay(2000));
        }
        catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException or ObjectDisposedException or InvalidOperationException) { }
        finally { p.Socket.Dispose(); p.Client.Dispose(); }
        if (announce) Disconnected(p, reason);
    }

    void Disconnected(Peer p, string why)
    {
        bool anyOpen;
        lock (gate)
        {
            if (!peers.TryGetValue(p.Target, out var current) || current != p) return;
            peers.Remove(p.Target);
            states.Remove(p.Target);
            anyOpen = peers.Values.Any(x => x.Socket.State == WebSocketState.Open);
        }
        foreach (var pair in pending)
        {
            if (pair.Value.Target == p.Target && pending.TryRemove(pair.Key, out var entry))
                entry.Tcs.TrySetResult((null, new VjsterError("internal", $"{PeerLabel(p.Target)} disconnected", null)));
        }
        log($"VJster: {PeerLabel(p.Target)} disconnected ({why})");
        Raise(ConnectionChanged, anyOpen);
    }

    /** A listener that throws must not drop the connection; the plugin logs a fixed line too (R-BEH-5). */
    void Raise<T>(Action<T>? handlers, T value)
    {
        if (handlers == null) return;
        foreach (var h in handlers.GetInvocationList())
        {
            try { ((Action<T>)h)(value); }
            catch (Exception) { log("VJster: a link listener threw"); }
        }
    }

    /** No cancellation token on the receive: cancelling it would abort the socket. The loop ends with a close frame or a dropped socket. */
    async Task ReceiveLoop(Peer p)
    {
        var buffer = new byte[8192];
        var message = new MemoryStream();
        string why = "closed";
        try
        {
            while (p.Socket.State is WebSocketState.Open or WebSocketState.CloseSent)
            {
                var r = await p.Socket.ReceiveAsync(buffer, CancellationToken.None);
                if (r.MessageType == WebSocketMessageType.Close)
                {
                    // The peer closed first (its worker stops, say): answer its close so Chrome/OBS sees a clean 1000, not 1006.
                    if (p.Socket.State == WebSocketState.CloseReceived)
                    {
                        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                        try { await p.Socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", timeout.Token); }
                        catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException or ObjectDisposedException) { }
                    }
                    break;
                }
                if (p.Socket.State == WebSocketState.CloseSent) continue; // after our close frame, only the peer's close matters
                message.Write(buffer, 0, r.Count);
                if (message.Length > MaxPayloadBytes)
                {
                    why = "message too big";
                    // Not Drop: it waits for this very loop to end. Send the close and leave; finally frees the socket.
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    try { await p.Socket.CloseOutputAsync(WebSocketCloseStatus.MessageTooBig, "message too big", timeout.Token); }
                    catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException or ObjectDisposedException or InvalidOperationException) { }
                    break;
                }
                if (!r.EndOfMessage) continue;
                string? text = r.MessageType == WebSocketMessageType.Text ? Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length) : null;
                message.SetLength(0);
                HandleMessage(p, text);
            }
        }
        catch (Exception e) when (e is WebSocketException or IOException or OperationCanceledException or ObjectDisposedException or InvalidOperationException)
        {
            why = "connection lost";
        }
        finally
        {
            p.Socket.Dispose(); p.Client.Dispose();
            Disconnected(p, why);
        }
    }

    void HandleMessage(Peer p, string? text)
    {
        Peer? current;
        lock (gate) peers.TryGetValue(p.Target, out current);
        if (current != p) return; // a replaced connection no longer speaks for its target
        p.LastHeard = Stopwatch.GetTimestamp();
        var result = ParseReport(text);
        if (!result.Ok || result.Target != p.Target)
        {
            // Only targets answer with `error`; this side drops the message, says so once per connection without its
            // content, and asks again, at most once every ReaskMin so a bad reporter cannot start a loop.
            if (!p.WarnedMalformed)
            {
                p.WarnedMalformed = true;
                log($"VJster: dropped a message from {PeerLabel(p.Target)} ({(result.Ok ? "wrong target" : text == null ? "binary frame" : result.Code)})");
            }
            if (Stopwatch.GetElapsedTime(p.LastReask) >= ReaskMin) { p.LastReask = Stopwatch.GetTimestamp(); Send("state.get", null, p.Target); }
            return;
        }
        switch (result.Type)
        {
            case "state":
                lock (gate) { if (peers.TryGetValue(p.Target, out var c) && c == p) states[p.Target] = result.State; }
                if (result.State!.InReplyTo != null && pending.TryGetValue(result.State.InReplyTo, out var sEntry) && sEntry.Target == p.Target
                    && pending.TryRemove(result.State.InReplyTo, out var removed))
                    removed.Tcs.TrySetResult((result.State, null));
                Raise(StateReceived, result.State);
                return;
            case "error":
                if (result.Error!.InReplyTo != null && pending.TryGetValue(result.Error.InReplyTo, out var eEntry) && eEntry.Target == p.Target
                    && pending.TryRemove(result.Error.InReplyTo, out var eremoved))
                    eremoved.Tcs.TrySetResult((null, result.Error));
                Raise(ErrorReceived, result.Error);
                return;
            case "ping":
                Send("pong", o => o["t"] = result.T, p.Target);
                return;
            default:
                return; // pong
        }
    }

    async Task PingLoop(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(PingInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(stop))
            {
                Peer[] snapshot;
                lock (gate) snapshot = peers.Values.ToArray();
                foreach (var p in snapshot)
                {
                    var silent = Stopwatch.GetElapsedTime(p.LastHeard);
                    if (silent > IdleTimeout)
                    {
                        log($"VJster: {PeerLabel(p.Target)} was silent for {(int)silent.TotalSeconds} s; closing");
                        await Drop(p, (WebSocketCloseStatus)CloseIdle, "no answer to pings", announce: true);
                        continue;
                    }
                    Send("ping", o => o["t"] = Math.Round(Stopwatch.GetElapsedTime(0).TotalMilliseconds), p.Target);
                }
            }
        }
        catch (OperationCanceledException) { }
    }

    // ---- sending ----

    /** Send an intent (or keepalive) to a target; returns its id, or null when that target is not connected. */
    public string? Send(string type, Action<JsonObject>? fill, string target = "browser")
    {
        Peer? p;
        lock (gate) peers.TryGetValue(target, out p);
        if (p == null || p.Socket.State != WebSocketState.Open) return null;
        string id = $"t{idPrefix}-{Interlocked.Increment(ref nextId)}";
        var message = new JsonObject { ["v"] = ProtocolVersion, ["id"] = id, ["target"] = target, ["type"] = type };
        fill?.Invoke(message);
        var bytes = Encoding.UTF8.GetBytes(message.ToJsonString());
        _ = Deliver(p, bytes);
        return id;
    }

    async Task Deliver(Peer p, byte[] bytes)
    {
        await p.SendLock.WaitAsync();
        try
        {
            if (p.Socket.State == WebSocketState.Open) await p.Socket.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
        }
        catch (Exception e) when (e is WebSocketException or IOException or ObjectDisposedException or InvalidOperationException)
        {
            await Drop(p, WebSocketCloseStatus.InternalServerError, "send failed", announce: true);
        }
        finally { p.SendLock.Release(); }
    }

    /** Send an intent and wait for the report that answers it (`inReplyTo`), or for `timeout`. Null when not connected. */
    public async Task<(VjsterState? State, VjsterError? Error)?> Request(string type, Action<JsonObject>? fill, TimeSpan timeout, string target = "browser")
    {
        var tcs = new TaskCompletionSource<(VjsterState?, VjsterError?)>(TaskCreationOptions.RunContinuationsAsynchronously);
        string? id = Send(type, o => { fill?.Invoke(o); pending[o["id"]!.GetValue<string>()] = (target, tcs); }, target);
        if (id == null) return null;
        try { return await tcs.Task.WaitAsync(timeout); }
        catch (TimeoutException) { pending.TryRemove(id, out _); return (null, null); }
    }

    // ---- the protocol: validating what the extension sends (reports and keepalives) ----

    public static VjsterParse ParseReport(string? text)
    {
        if (text == null) return VjsterParse.Fail("bad-message", "a message must be text");
        if (text.Length > MaxMessageChars) return VjsterParse.Fail("too-long", $"messages are limited to {MaxMessageChars} characters");
        JsonNode? node;
        try { node = JsonNode.Parse(text); }
        catch (Exception e) when (e is JsonException or ArgumentException) { return VjsterParse.Fail("bad-json", "the message is not valid JSON"); }
        if (node is not JsonObject data) return VjsterParse.Fail("bad-message", "a message must be a JSON object");
        // A JsonObject reads its properties on first use, and a repeated property name throws only then.
        try { return ReadReport(data); }
        catch (ArgumentException) { return VjsterParse.Fail("bad-json", "the message is not valid JSON"); }
    }

    static VjsterParse ReadReport(JsonObject data)
    {
        string? id = Str(data, "id") is { } rawId && IdPattern.IsMatch(rawId) ? rawId : null;
        if (!(data["v"] is JsonValue v && v.TryGetValue<int>(out var version) && version == ProtocolVersion)) return VjsterParse.Fail("bad-version", $"this side speaks protocol version {ProtocolVersion}", id);
        var type = Str(data, "type");
        if (type == null) return VjsterParse.Fail("bad-message", "type must be text", id);
        bool isIntent = IntentTypes.Contains(type), isReport = type is "state" or "error", isKeepalive = type is "ping" or "pong";
        if (!isIntent && !isReport && !isKeepalive) return VjsterParse.Fail("unknown-type", "unknown message type", id);
        if (isIntent) return VjsterParse.Fail("unexpected-type", "this side does not accept that message type", id);
        if (id == null) return VjsterParse.Fail("bad-message", "id must be 1 to 64 letters, digits, hyphens or underscores");
        var target = Str(data, "target");
        if (target is not ("browser" or "obs")) return VjsterParse.Fail("bad-message", "target must be one of browser, obs", id);
        try
        {
            if (type == "state") return new(true, "", "", id, type, target, ReadState(data), null, 0);
            if (type == "error")
            {
                var code = Str(data, "code");
                if (code == null || !ErrorCodes.Contains(code)) throw new Invalid("code must be a known error code");
                var message = Str(data, "message");
                if (message == null || message.Length > MaxTitleChars) throw new Invalid($"message must be text of at most {MaxTitleChars} characters");
                return new(true, "", "", id, type, target, null, new VjsterError(code, message, OptionalId(data, "inReplyTo")), 0);
            }
            return new(true, "", "", id, type, target, null, null, Num(data, "t"));
        }
        catch (Invalid e) { return VjsterParse.Fail("bad-message", e.Message, id); }
        catch (Exception e) when (e is InvalidOperationException or FormatException or InvalidCastException) { return VjsterParse.Fail("internal", "the message could not be read", id); }
    }

    sealed class Invalid(string reason) : Exception(reason);

    static string? Str(JsonObject o, string key) => o[key] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    static double Num(JsonObject o, string key)
    {
        if (o[key] is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d)) return d;
        throw new Invalid($"{key} must be a finite number");
    }

    static bool Bool(JsonObject o, string key, bool? fallback = null)
    {
        if (o[key] is JsonValue v && v.TryGetValue<bool>(out var b)) return b;
        if (o[key] == null && !o.ContainsKey(key) && fallback.HasValue) return fallback.Value;
        throw new Invalid($"{key} must be true or false");
    }

    static double RateValue(JsonNode? n, string what)
    {
        if (n is JsonValue v && v.TryGetValue<double>(out var d) && double.IsFinite(d) && d > 0 && d <= MaxRate) return d;
        throw new Invalid($"{what} must be a number above 0 and at most {MaxRate}");
    }

    static string? OptionalId(JsonObject o, string key)
    {
        if (!o.ContainsKey(key) || o[key] == null) return null;
        var s = Str(o, key);
        if (s == null || !IdPattern.IsMatch(s)) throw new Invalid($"{key} must be a message id");
        return s;
    }

    static JsonArray List(JsonObject o, string key)
    {
        if (o[key] is JsonArray a && a.Count <= MaxList) return a;
        throw new Invalid($"{key} must be a list of at most {MaxList} items");
    }

    static string? NullableText(JsonObject o, string key, int max, Regex? pattern = null)
    {
        if (!o.ContainsKey(key)) throw new Invalid($"{key} must be text or null");
        if (o[key] == null) return null;
        var s = Str(o, key);
        if (s == null || s.Length > max || (pattern != null && !pattern.IsMatch(s))) throw new Invalid($"{key} must be {(pattern != null ? "a host name" : $"text of at most {max} characters")} or null");
        return s;
    }

    static VjsterState ReadState(JsonObject o)
    {
        var caps = new List<string>();
        foreach (var c in List(o, "capabilities"))
        {
            // Unknown capabilities from a newer peer are ignored, like unknown fields.
            if (c is JsonValue cv && cv.TryGetValue<string>(out var s) && KnownCapabilities.Contains(s) && !caps.Contains(s)) caps.Add(s);
        }
        bool? qualityAuto;
        if (!o.ContainsKey("qualityAuto")) throw new Invalid("qualityAuto must be true, false or null");
        if (o["qualityAuto"] == null) qualityAuto = null;
        else if (o["qualityAuto"] is JsonValue qv && qv.TryGetValue<bool>(out var qb)) qualityAuto = qb;
        else throw new Invalid("qualityAuto must be true, false or null");
        string? quality;
        if (!o.ContainsKey("quality")) throw new Invalid("quality must be a level id or null");
        if (o["quality"] == null) quality = null;
        else { quality = Str(o, "quality"); if (quality == null || !LevelId.IsMatch(quality)) throw new Invalid("quality must be a level id or null"); }
        double? rate;
        if (!o.ContainsKey("rate")) throw new Invalid("rate must be a number or null");
        rate = o["rate"] == null ? null : RateValue(o["rate"], "rate");
        var rates = List(o, "availableRates").Select(n => RateValue(n, "availableRates item")).ToArray();
        var levels = List(o, "availableQualities").Select(n =>
        {
            if (n is JsonValue lv && lv.TryGetValue<string>(out var l) && LevelId.IsMatch(l)) return l;
            throw new Invalid("availableQualities items must be level ids");
        }).ToArray();
        return new VjsterState(rate, Bool(o, "rateDirect", false), rates, quality, levels, qualityAuto,
            NullableText(o, "title", MaxTitleChars), NullableText(o, "host", 253, HostPattern), Bool(o, "playing"), Bool(o, "adPlaying"),
            caps.ToArray(), Bool(o, "pinned", false), OptionalId(o, "inReplyTo"));
    }
}
