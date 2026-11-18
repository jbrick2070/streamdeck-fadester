// SPDX-License-Identifier: GPL-2.0-or-later
using System.Runtime.InteropServices;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class MacDevelopmentHost
{
    static string Support => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Application Support");
    static string HostDirectory => Path.Combine(Support, "FadesterTourBox");
    static string ObsConfig => BridgeConfig.ObsWebsocketConfigPath(isMacOS: true);
    static string? secret;
    static string? obsTokenSecret;
    static void Log(string message)
    {
        string? first = secret, second = obsTokenSecret;
        if ((first?.Length ?? 0) < (second?.Length ?? 0)) (first, second) = (second, first);
        if (!string.IsNullOrEmpty(first)) message = message.Replace(first, "[redacted]", StringComparison.Ordinal);
        if (!string.IsNullOrEmpty(second)) message = message.Replace(second, "[redacted]", StringComparison.Ordinal);
        Console.WriteLine(message.Replace('\r', ' ').Replace('\n', ' '));
    }
    /// <summary>Ready: armed with OBS. VideoReady: armed without OBS, video controls only (FIX-8).</summary>
    enum Control { Ready, VideoReady, Disarmed, Stopped }
    static void WriteControl(Control kind, int generation = 0)
    {
        // Protocol frames contain only fixed literals and our generation counter.
        // Redacting human text must not corrupt them when a password is "1", etc.
        string frame = kind switch
        {
            Control.Ready when generation > 0 => "READY " + generation.ToString(CultureInfo.InvariantCulture),
            Control.VideoReady when generation > 0 => "VIDEO-READY " + generation.ToString(CultureInfo.InvariantCulture),
            Control.Disarmed when generation > 0 => "DISARMED " + generation.ToString(CultureInfo.InvariantCulture),
            Control.Stopped when generation == 0 => "STOPPED",
            _ => throw new InvalidOperationException("Invalid host control frame.")
        };
        Console.WriteLine(frame);
    }
    internal static void CheckControlFrames()
    {
        string? previousSecret = secret, previousToken = obsTokenSecret; TextWriter previousOutput = Console.Out;
        using var output = new StringWriter(CultureInfo.InvariantCulture);
        try
        {
            Console.SetOut(output); secret = "1"; obsTokenSecret = "0123456789abcdef0123456789abcdef";
            WriteControl(Control.Ready, 1); WriteControl(Control.VideoReady, 2); WriteControl(Control.Disarmed, 1);
            Log("Synthetic secret 1 and 0123456789abcdef0123456789abcdef"); secret = "STOPPED"; WriteControl(Control.Stopped);
        }
        finally { secret = previousSecret; obsTokenSecret = previousToken; Console.SetOut(previousOutput); }
        string[] lines = output.ToString().Split(Environment.NewLine, StringSplitOptions.RemoveEmptyEntries);
        if (!lines.SequenceEqual(new[] { "READY 1", "VIDEO-READY 2", "DISARMED 1", "Synthetic secret [redacted] and [redacted]", "STOPPED" }))
            throw new InvalidOperationException("Host control frames or human-text secret redaction failed.");
    }
    static void Help() => Console.WriteLine("""
        FadesterMacHost --run --config PATH --native-app APP [--enable-mix]
                        [--input-app APP --map PATH] [--read-only | --no-mix-provider]
        FadesterMacHost --run --config PATH --mix-only [--enable-mix]
        FadesterMacHost --help | --self-test | --self-test-stdio

        Fadester Companion's Mac command-line host, started by Fadester Companion.app.
        No-argument startup shows help. --self-test uses only synthetic state/fake OBS.
        --self-test-stdio exercises the real stdin parser and ingress only; accepted
        commands are echoed, never dispatched. It connects to no service or helper.
        --run requires macOS, an existing config, authenticated loopback OBS, and a
        separately built native helper with manually granted Accessibility permission.
        It never prompts for permission, changes OBS settings, or falls back to invisible fading.
        Grouped mixing requires config mixEnabled:true or --enable-mix for this run.
        Authentication: FADESTER_OBS_PASSWORD, otherwise matching local OBS config.
        Password arguments are unsupported. No configuration is created or rewritten.
        --input-app with --map explicitly enables the separate exclusive shortcut
        helper after OBS/native validation. Without both, only stdin input is used.
        --read-only permits preview.status, fader.status, recording.status and
        host.native.status (the actual native slider readback).
        It disables the mix server/monitor and rejects OBS writes, native moves,
        --enable-mix and --input-app. Native startup inspection is still read-only.
        --no-mix-provider disables grouped mixing and its event server for a
        controlled action rehearsal; individual explicit actions remain available.
        --mix-only serves only Stream Deck, OpenDeck and MIDI (the grouped mix provider),
        like the Windows companion's --mix-only: no shortcut helper, native T-bar,
        Accessibility or VJster. It needs config mixEnabled:true or --enable-mix.
        Stdin actions are refused in this mode; quit still stops it.
        While connected, Visual Sidechain meter lines (VS-METER: ...) are printed for the panel.

        After READY <generation>, stdin accepts:
          action preview.status
          action fader.forward
          event <generation> <Unix milliseconds at physical input> <canonical action>
          action bridge.reconnect
          quit
        Relative rotary actions expire after 180 ms; other actions after 1500 ms.
        Input is dropped while offline, on old generations, or when the queue is full.
        Reconnect is explicit. Failed/uncertain actions are never replayed.
        EOF, quit, Ctrl+C and SIGTERM stop without a cleanup T-bar or volume reset.
        """);

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            if (args.Length == 0 || args is ["--help"]) { Help(); return 0; }
            if (args is ["--self-test-stdio"]) return await CheckStdio();
            if (args is ["--self-test"])
            {
                await HostSelfTests.Run();
                await BridgeSelfTests.RunAsync();
                await StudioFaderSelfTests.RunAsync();
                await ObsTransportChecks.RunAsync();
                Log($"PASS: host ingress, generation, mutation guards, shared audio/mix/fader and authenticated fake OBS transport on {RuntimeInformation.OSDescription} / {RuntimeInformation.ProcessArchitecture} / {RuntimeInformation.FrameworkDescription}. No real OBS, AX, shortcuts or hardware used.");
                return 0;
            }
            string? configPath = null, nativeApp = null, inputApp = null, mapPath = null;
            bool run = false, enableMix = false, readOnly = false, noMixProvider = false, mixOnly = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--run" && !run) run = true;
                else if (args[i] == "--mix-only" && !mixOnly) mixOnly = true;
                else if (args[i] == "--enable-mix" && !enableMix) enableMix = true;
                else if (args[i] == "--read-only" && !readOnly) readOnly = true;
                else if (args[i] == "--no-mix-provider" && !noMixProvider) noMixProvider = true;
                else if (args[i] is "--config" or "--native-app" or "--input-app" or "--map")
                {
                    string option = args[i];
                    if (++i == args.Length || args[i].StartsWith("--", StringComparison.Ordinal)) throw new ArgumentException("Missing option path; use --help.");
                    if (option == "--config" && configPath is null) configPath = Path.GetFullPath(args[i]);
                    else if (option == "--native-app" && nativeApp is null) nativeApp = Path.GetFullPath(args[i]);
                    else if (option == "--input-app" && inputApp is null) inputApp = Path.GetFullPath(args[i]);
                    else if (option == "--map" && mapPath is null) mapPath = Path.GetFullPath(args[i]);
                    else throw new ArgumentException("Duplicate option; use --help.");
                }
                else throw new ArgumentException("Invalid arguments; use --help.");
            }
            if (mixOnly && (readOnly || noMixProvider || inputApp is not null || mapPath is not null))
                throw new ArgumentException("--mix-only cannot be combined with --read-only, --no-mix-provider, --input-app or --map.");
            if (!run || configPath is null || (nativeApp is null && !mixOnly)) throw new ArgumentException("--run requires --config PATH and --native-app APP (or --mix-only).");
            if ((inputApp is null) != (mapPath is null)) throw new ArgumentException("--input-app and --map must be supplied together.");
            if (readOnly && (enableMix || inputApp is not null)) throw new ArgumentException("--read-only cannot enable mixing or register shortcuts.");
            if (noMixProvider && enableMix) throw new ArgumentException("--no-mix-provider cannot enable grouped mixing.");
            if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException("Live host sessions require macOS. --self-test remains portable.");
            if (!File.Exists(configPath)) throw new FileNotFoundException("Create a development configuration explicitly before running the host.");
            if (!mixOnly && !File.Exists(Path.Combine(nativeApp!, "Contents", "MacOS", "FadesterNativeSlider"))) throw new FileNotFoundException("The separately built native slider app is missing.");
            if (inputApp is not null && (!File.Exists(Path.Combine(inputApp, "Contents", "MacOS", "FadesterMacShortcuts")) || !File.Exists(mapPath)))
                throw new FileNotFoundException("The separate shortcut app or canonical map is missing.");
            var config = BridgeConfig.Load(configPath);
            if (enableMix) config.MixEnabled = true;
            if (readOnly || noMixProvider) config.MixEnabled = false;
            if (mixOnly && !config.MixEnabled) throw new ArgumentException("Enable All OBS mixer inputs in Setup first.");
            obsTokenSecret = config.VjsterObsToken.Length > 0 ? config.VjsterObsToken : null;
            if (!readOnly && !mixOnly) config.CheckPorts();
            using var stop = new CancellationTokenSource();
            var ingress = new CommandIngress();
            int stopping = 0;
            void Stop()
            {
                if (Interlocked.Exchange(ref stopping, 1) == 0) { ingress.Disarm(); stop.Cancel(); }
            }
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; Stop(); };
            using var signal = PosixSignalRegistration.Create(PosixSignal.SIGTERM, c => { c.Cancel = true; Stop(); });
            using var lease = AcquireLease(config.Port);
            // Console's synchronized TextReader may block before returning an async
            // task. Keep stdin on its own worker so startup can authenticate first.
            _ = Task.Run(() => ReadInput(ingress, Stop, stop.Token, () =>
            {
                // The panel's Save while the controls run (hand test 2026-11-17): the settings read at each action change at once.
                try { config.ApplyLive(BridgeConfig.Load(configPath)); Log("SETTINGS-RELOADED"); }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException or System.Text.Json.JsonException)
                { Log("Settings not reloaded: " + e.Message); }
            }));
            await using var vjster = !readOnly && !mixOnly && config.VjsterEnabled ? new VjsterHost(config, Log) : null;
            Task vjsterBinder = vjster?.StartBinding(stop.Token) ?? Task.CompletedTask;
            try
            {
                if (mixOnly) await RunMixOnlySession(config, ingress, stop.Token);
                else if (readOnly || vjster is null) do
                {
                    if (!await RunSession(config, await Connect(config, stop.Token), nativeApp!, inputApp, mapPath, ingress, stop.Token, readOnly, noMixProvider, vjster?.Desk)) break;
                } while (!stop.IsCancellationRequested);
                else await RunWithOrWithoutObs(config, nativeApp!, inputApp, mapPath, ingress, stop.Token, noMixProvider, vjster.Desk);
            }
            finally
            {
                Stop();
                try { await vjsterBinder; } catch (OperationCanceledException) { }
                if (vjster is not null) await vjster.DisposeAsync();
            }
            WriteControl(Control.Stopped);
            Log("No automatic T-bar reset, take or level restore was sent.");
            return 0;
        }
        catch (OperationCanceledException) { WriteControl(Control.Stopped); Log("Input disarmed."); return 0; }
        catch (JsonException) { Log("ERROR: invalid JSON configuration; no configuration values were printed."); return 1; }
        catch (Exception error) { Log("ERROR: " + error.Message); return 1; }
    }
    static async Task<int> CheckStdio()
    {
        // Exercise the SAME reader and ingress as a live session, without creating
        // a config, lease, OBS connection, native adapter or shortcut listener.
        var ingress = new CommandIngress();
        int generation = ingress.Activate();
        Task reader = Task.Run(() => ReadInput(ingress, ingress.Disarm, CancellationToken.None));
        Log("PIPE_READY " + generation);
        while (true)
        {
            if (ingress.Commands.Reader.TryRead(out var command))
            {
                Log($"PIPE {command.Generation} {command.Action}");
                continue;
            }
            if (reader.IsCompleted) break;
            await Task.WhenAny(reader, ingress.Commands.Reader.WaitToReadAsync().AsTask());
        }
        await reader;
        Log("PIPE_STOPPED");
        return 0;
    }
    static async Task ReadInput(CommandIngress ingress, Action stop, CancellationToken token, Action? reload = null)
    {
        try
        {
            // Bounded lines prevent a broken input helper from allocating an unbounded command.
            // One character avoids TextReader implementations waiting to fill a
            // larger requested buffer while the pipe is kept open between events.
            char[] buffer = new char[1]; var line = new StringBuilder(); bool overflow = false;
            while (true)
            {
                int count = await Console.In.ReadAsync(buffer.AsMemory(), token);
                if (count == 0) break;
                for (int i = 0; i < count; i++)
                {
                    char c = buffer[i];
                    if (c == '\n')
                    {
                        string value = line.ToString().TrimEnd('\r');
                        line.Clear();
                        if (!overflow && value == "quit") { stop(); return; }
                        if (!overflow && value == "reload" && reload is not null) { reload(); overflow = false; continue; }
                        if (overflow) Log("DROPPED: command exceeds 256 characters.");
                        else if (!ingress.SubmitLine(value, out string reason)) Log("DROPPED: " + reason);
                        overflow = false;
                    }
                    else if (line.Length < 256) line.Append(c);
                    else overflow = true;
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException) { Log("Input transport closed."); }
        finally { stop(); }
    }
    static FileStream AcquireLease(int port)
    {
        string directory = Path.Combine(HostDirectory, "run"); Directory.CreateDirectory(directory);
        // Same lease as the existing Mac mix-only provider; do not create competing owners.
        try { return new FileStream(Path.Combine(directory, $"mix-{port}.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new InvalidOperationException("Another Fadester host already owns this OBS port for the current user."); }
    }
    static async Task<ObsConnection> Connect(BridgeConfig config, CancellationToken stop)
    {
        string? supplied = Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD");
        // Vendor events carry Visual Sidechain's meter (as the Windows bridge's --listen).
        if (!string.IsNullOrEmpty(supplied)) { secret = supplied; return await ObsConnection.Connect(config, stop, vendorEvents: true); }
        if (!File.Exists(ObsConfig)) throw new InvalidOperationException("No local OBS authentication config found; set FADESTER_OBS_PASSWORD for this process.");
        string password = BridgeConfig.SavedPassword(await File.ReadAllTextAsync(ObsConfig, stop), config.Port, requireEnabledAndAuth: true);
        secret = password;
        // No child process is launched during this temporary process-local credential scope.
        Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", password);
        try { return await ObsConnection.Connect(config, stop, vendorEvents: true); }
        finally { Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", supplied); }
    }
    /** The Visual Sidechain meter lines (VS-METER: ...) the panel shows in Setup and in its feedback window, as on Windows. Never in read-only. */
    static async Task<VisualSidechainMonitor?> StartMeter(ObsConnection obs, bool readOnly, CancellationToken stop)
    {
        if (readOnly) return null;
        var meter = new VisualSidechainMonitor(obs.Call, Log);
        meter.Attach(obs);
        await meter.StartAsync(stop);
        return meter;
    }
    /** --mix-only: the grouped mix provider for Stream Deck, OpenDeck and MIDI, with no shortcuts, native T-bar or VJster (the Windows bridge's --mix-only). */
    static async Task RunMixOnlySession(BridgeConfig config, CommandIngress ingress, CancellationToken stop)
    {
        ingress.Disarm();
        using var obs = await Connect(config, stop);
        int generation = ingress.Activate();
        _ = obs.Disconnected.ContinueWith(_ => ingress.Disarm(generation), TaskScheduler.Default);
        var desk = new DeskActions(config, obs.Call, nativeMove: (_, _) =>
            Task.FromException(new InvalidOperationException("Native T-bar control is unavailable in mix-only mode.")), allowAutoCloseout: false);
        obs.InputLevelChangedById += desk.OnMixInputLevelChanged;
        desk.StartMixMonitor();
        var protocol = new MixProtocolServer(obs, desk, providerId: BridgeConfig.ResolveProviderId(config.MixStateDirectory));
        using var meter = await StartMeter(obs, false, stop);
        try
        {
            WriteControl(Control.Ready, generation);
            Log("The controls are on for Stream Deck, OpenDeck and MIDI only: no TourBox shortcuts, native T-bar or VJster.");
            while (!stop.IsCancellationRequested && !obs.Disconnected.IsCompleted)
            {
                var available = ingress.Commands.Reader.WaitToReadAsync(stop).AsTask();
                if (await Task.WhenAny(available, obs.Disconnected) != available) break;
                if (!await available) break;
                while (ingress.Commands.Reader.TryRead(out var command)) Log("DROPPED: " + command.Action + " (mix-only mode takes no controller input).");
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally
        {
            ingress.Disarm();
            WriteControl(Control.Disarmed, generation);
            await protocol.DisposeAsync();
            await desk.StopMixAsync();
            obs.InputLevelChangedById -= desk.OnMixInputLevelChanged;
        }
        if (obs.Disconnected.IsCompleted) Log("OFFLINE: OBS disconnected. Restart explicitly; queued actions will not be replayed.");
    }
    /// <summary>
    /// VJster on (FIX-8, hand test 2026-11-17): Chrome's videos need no OBS. While OBS cannot be reached the host stays up
    /// in an offline session (shortcuts armed, VJster actions served, OBS actions refused) and looks for OBS every few
    /// seconds; a lost OBS drops back to it instead of ending the host. Failures that are not about reaching OBS (the
    /// native T-bar not parked, the shortcut helper gone) still end the host, as before.
    /// </summary>
    static async Task RunWithOrWithoutObs(BridgeConfig config, string nativeApp, string? inputApp, string? mapPath, CommandIngress ingress, CancellationToken stop, bool noMixProvider, VjsterDesk vjster)
    {
        string? told = null;
        // OBS's port open but the sign-in failing (wrong password, authentication off): wait longer each time, up to a minute.
        var wait = OfflineFirstWait;
        while (!stop.IsCancellationRequested)
        {
            ObsConnection obs;
            try { obs = await Connect(config, stop); }
            // Any failure to reach OBS, timeouts included; only the host stopping ends the loop.
            catch (Exception error) when (!stop.IsCancellationRequested)
            {
                if (error.Message != told) { told = error.Message; Log("OFFLINE: OBS is not connected (" + error.Message + "). Video controls work; OBS controls wait for OBS."); }
                if (!await RunOfflineSession(config, inputApp, mapPath, ingress, stop, wait, vjster)) return;
                wait = TimeSpan.FromTicks(Math.Min(wait.Ticks * 2, OfflineLongestWait.Ticks));
                continue;
            }
            told = null;
            try { await RunSession(config, obs, nativeApp, inputApp, mapPath, ingress, stop, readOnly: false, noMixProvider, vjster); wait = OfflineFirstWait; }
            // OBS lost, or a session that could not start (its T-bar not parked, the native helper failing): keep Chrome's
            // videos going and try OBS again after a growing pause. Only a stopped shortcut helper ends the host, as before.
            catch (Exception error) when (!stop.IsCancellationRequested && error is not ShortcutInputStopped)
            {
                Log("OFFLINE: " + error.Message + " Video controls keep working; OBS controls are tried again shortly.");
                if (!await RunOfflineSession(config, inputApp, mapPath, ingress, stop, wait, vjster)) return;
                wait = TimeSpan.FromTicks(Math.Min(wait.Ticks * 2, OfflineLongestWait.Ticks));
            }
        }
    }
    static readonly TimeSpan OfflineFirstWait = TimeSpan.FromSeconds(5), OfflineLongestWait = TimeSpan.FromSeconds(60);
    /// <summary>
    /// The host without OBS: the same shortcuts and HostSession, whose OBS calls are refused, so VJster's actions behave
    /// exactly as with OBS. Returns true to look for OBS again (OBS's port opened after at least minWait, or Reconnect),
    /// false when the host is stopping.
    /// </summary>
    static async Task<bool> RunOfflineSession(BridgeConfig config, string? inputApp, string? mapPath, CommandIngress ingress, CancellationToken stop, TimeSpan minWait, VjsterDesk vjster)
    {
        ingress.Disarm();
        using var shortcuts = inputApp is null ? null : new MacShortcutInput(inputApp, mapPath!, input =>
        {
            if (!ingress.SubmitEvent(input.Action, input.Generation, input.UnixMs, out string reason)) Log("DROPPED: " + reason);
        });
        if (shortcuts is not null)
        {
            shortcuts.Start(stop);
            await shortcuts.Ready.WaitAsync(TimeSpan.FromSeconds(5), stop);
        }
        int generation = ingress.Activate();
        if (shortcuts is not null) _ = shortcuts.Done.ContinueWith(_ => ingress.Disarm(generation), TaskScheduler.Default);
        var session = new HostSession(config, ingress, generation,
            (_, _) => throw new InvalidOperationException("OBS is not connected."),
            (_, _) => throw new InvalidOperationException("OBS is not connected."),
            () => shortcuts is null || !shortcuts.Done.IsCompleted, stop, readOnly: false, nativeRead: null, vjster);
        var since = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            if (shortcuts is not null) await shortcuts.ArmAsync(generation);
            WriteControl(Control.VideoReady, generation);
            Log("Host armed without OBS: video controls work" + (shortcuts is null ? "." : ", exclusive Mac shortcuts enabled.") + " OBS controls start when OBS answers.");
            Task<bool>? available = null;
            // Both waits outlive a loop turn, so steady input (a Knob turned nonstop) cannot starve the look for OBS.
            Task? tick = null;
            while (!stop.IsCancellationRequested)
            {
                available ??= ingress.Commands.Reader.WaitToReadAsync(stop).AsTask();
                tick ??= Task.Delay(1000, stop);
                Task completed = shortcuts is null ? await Task.WhenAny(available, tick) : await Task.WhenAny(available, tick, shortcuts.Done);
                if (shortcuts is not null && shortcuts.Done.IsCompleted)
                {
                    await shortcuts.Done;
                    throw new ShortcutInputStopped();
                }
                if (completed == tick)
                {
                    tick = null;
                    if (since.Elapsed >= minWait && await ObsListening(config.Port, stop)) return true;
                    continue;
                }
                bool more = await available; available = null;
                if (!more || !ingress.Commands.Reader.TryRead(out var command)) continue;
                if (!ingress.Current(command) || !ingress.Fresh(command)) { Log("DROPPED: expired input or old connection generation."); continue; }
                if (command.Action == "bridge.reconnect") return true;
                try { Log("RESULT " + command.Action + ": " + await session.Dispatch(command)); }
                catch (Exception error) when (!stop.IsCancellationRequested) { Log("REFUSED " + command.Action + ": " + error.Message); }
            }
            return false;
        }
        finally
        {
            ingress.Disarm();
            WriteControl(Control.Disarmed, generation);
            if (shortcuts is not null)
            {
                try { if (!shortcuts.Done.IsCompleted && !stop.IsCancellationRequested) await shortcuts.DisarmAsync(); }
                catch (Exception error) { Log("Input disarm: " + error.Message); }
                finally { shortcuts.Dispose(); }
                try { await shortcuts.Done.WaitAsync(TimeSpan.FromSeconds(2)); }
                catch (Exception error) { Log("Input closed: " + error.Message); }
            }
        }
    }
    /// <summary>Whether something accepts connections on OBS's WebSocket port on this Mac; the sign-in is Connect's job.</summary>
    static async Task<bool> ObsListening(int port, CancellationToken stop)
    {
        using var client = new System.Net.Sockets.TcpClient();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(1));
        try { await client.ConnectAsync(System.Net.IPAddress.Loopback, port, timeout.Token); return true; }
        catch (Exception error) when (error is System.Net.Sockets.SocketException or OperationCanceledException && !stop.IsCancellationRequested) { return false; }
    }
    static async Task<bool> RunSession(BridgeConfig config, ObsConnection connection, string nativeApp, string? inputApp, string? mapPath, CommandIngress ingress, CancellationToken stop, bool readOnly, bool noMixProvider, VjsterDesk? vjster = null)
    {
        ingress.Disarm();
        using var obs = connection;
        using var native = new MacNativeTBar(config.Port, nativeApp);
        // This is a read-only warmup. Never force an operator-owned handle to zero.
        if (await native.ReadAsync() != 0) throw new InvalidOperationException("OBS's native T-bar is not parked at zero; check OBS before starting this host.");
        await obs.Call("GetVersion"); // The same authenticated socket must survive native PID binding.
        stop.ThrowIfCancellationRequested();
        if (obs.Disconnected.IsCompleted) throw new IOException("OBS disconnected during native validation.");
        using var shortcuts = inputApp is null ? null : new MacShortcutInput(inputApp, mapPath!, input =>
        {
            if (!ingress.SubmitEvent(input.Action, input.Generation, input.UnixMs, out string reason)) Log("DROPPED: " + reason);
        });
        if (shortcuts is not null)
        {
            shortcuts.Start(stop);
            await shortcuts.Ready.WaitAsync(TimeSpan.FromSeconds(5), stop);
        }
        int generation = ingress.Activate();
        // A late completion from an earlier helper must never disarm a new session.
        _ = obs.Disconnected.ContinueWith(_ => ingress.Disarm(generation), TaskScheduler.Default);
        if (shortcuts is not null) _ = shortcuts.Done.ContinueWith(_ => ingress.Disarm(generation), TaskScheduler.Default);
        var session = new HostSession(config, ingress, generation, obs.Call, native.MoveAsync,
            () => !obs.Disconnected.IsCompleted && (shortcuts is null || !shortcuts.Done.IsCompleted), stop, readOnly, native.ReadAsync, vjster);
        var desk = session.Desk;
        obs.InputVolumeChanged += desk.OnVolumeChanged; obs.InputLevelChangedById += desk.OnMixInputLevelChanged;
        using var meter = await StartMeter(obs, readOnly, stop);
        MixProtocolServer? protocol = null;
        bool reconnect = false;
        try
        {
            if (shortcuts is not null) await shortcuts.ArmAsync(generation);
            if (obs.Disconnected.IsCompleted || ingress.Generation != generation) throw new IOException("Connection closed before input could be armed.");
            if (!readOnly && !noMixProvider)
            {
                desk.StartMixMonitor();
                protocol = new MixProtocolServer(obs, desk, providerId: BridgeConfig.ResolveProviderId(config.MixStateDirectory));
            }
            WriteControl(Control.Ready, generation);
            Log(readOnly ? "Read-only host ready; no OBS writes, native moves, mix provider or shortcut registration."
                : "Host armed; native T-bar available, grouped mix " + (config.MixEnabled ? "enabled." : "disabled.") +
                  (shortcuts is null ? " Stdin input only." : " Exclusive Mac shortcuts enabled."));
            long lastHeldTurn = 0;
            while (!stop.IsCancellationRequested && !obs.Disconnected.IsCompleted)
            {
                var available = ingress.Commands.Reader.WaitToReadAsync(stop).AsTask();
                Task completed = shortcuts is null ? await Task.WhenAny(available, obs.Disconnected)
                    : await Task.WhenAny(available, obs.Disconnected, shortcuts.Done);
                if (shortcuts is not null && shortcuts.Done.IsCompleted)
                {
                    await shortcuts.Done;
                    throw new ShortcutInputStopped();
                }
                if (completed != available) break;
                if (!await available || !ingress.Commands.Reader.TryRead(out var command)) continue;
                if (!ingress.Current(command) || !ingress.Fresh(command)) { Log("DROPPED: expired input or old connection generation."); continue; }
                long nowStamp = System.Diagnostics.Stopwatch.GetTimestamp();
                if (KeyGuards.IsStrayFaderTick(command.Action, lastHeldTurn, nowStamp)) { Log("DROPPED: stray T-bar tick right after a held Dial turn."); continue; }
                if (KeyGuards.IsHeldDialTurn(command.Action)) lastHeldTurn = nowStamp;
                if (!readOnly && command.Action == "bridge.reconnect") { reconnect = true; break; }
                try { Log("RESULT " + command.Action + ": " + await session.Dispatch(command)); }
                catch (Exception error) when (!stop.IsCancellationRequested) { Log("REFUSED " + command.Action + ": " + error.Message); }
            }
        }
        finally
        {
            ingress.Disarm();
            WriteControl(Control.Disarmed, generation);
            if (shortcuts is not null)
            {
                try { if (!shortcuts.Done.IsCompleted && !stop.IsCancellationRequested) await shortcuts.DisarmAsync(); }
                catch (Exception error) { Log("Input disarm: " + error.Message); }
                finally { shortcuts.Dispose(); }
                try { await shortcuts.Done.WaitAsync(TimeSpan.FromSeconds(2)); }
                catch (Exception error) { Log("Input closed: " + error.Message); }
            }
            if (protocol is not null) await protocol.DisposeAsync();
            await desk.StopAudioAsync();
            obs.InputVolumeChanged -= desk.OnVolumeChanged; obs.InputLevelChangedById -= desk.OnMixInputLevelChanged;
            // Do not invoke CancelOwnedAsync: exit must not unexpectedly change the picture.
        }
        if (obs.Disconnected.IsCompleted && !reconnect) Log(vjster is null ? "OFFLINE: OBS disconnected. Restart explicitly; queued actions will not be replayed."
            : "OFFLINE: OBS disconnected. Video controls keep working; OBS controls come back when OBS does. Queued OBS actions are not replayed.");
        return reconnect;
    }
}

/// <summary>The exclusive shortcut helper ended (Accessibility withdrawn, the helper gone): the host stops, with or without OBS.</summary>
internal sealed class ShortcutInputStopped : IOException
{
    internal ShortcutInputStopped() : base("Shortcut input stopped; host disarmed without fallback.") { }
}
