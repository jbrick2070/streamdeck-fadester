// SPDX-License-Identifier: GPL-2.0-or-later
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

/// <summary>Headless grouped-mix provider. It has no hardware/input/AX integration.</summary>
internal static class MacMixHost
{
    static string ApplicationSupport => OperatingSystem.IsMacOS()
        ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Library", "Application Support")
        : Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    static string HostDirectory => Path.Combine(ApplicationSupport, "FadesterTourBox");
    static string DefaultConfig => Path.Combine(HostDirectory, "config.json");
    static string ObsConfig => Path.Combine(OperatingSystem.IsMacOS() ? ApplicationSupport :
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "obs-studio", "plugin_config", "obs-websocket", "config.json");

    static void Help() => Console.WriteLine("""
        FadesterMixHost [--config PATH] [--enable-mix] --mix-only
        FadesterMixHost [--config PATH] --init
        FadesterMixHost --help | --paths | --self-test

        Headless grouped OBS mixer provider for Stream Deck and compatible clients.
        This is not the TourBox Mac app. No hotkeys, Accessibility or T-bar control.
        --mix-only requires config mixEnabled:true or explicit --enable-mix.
        --enable-mix arms this run only; it does not rewrite the configuration.
        --init creates a disabled configuration only if the file is absent.
        --paths prints paths only. --self-test uses a private fake OBS server.
        Authentication: FADESTER_OBS_PASSWORD or the matching local OBS configuration.
        Passwords are never accepted on the command line or written to our config.
        Type quit, press Ctrl+C, or send SIGTERM to stop. EOF is ignored.
        Exit leaves current mixer levels in place; the journal preserves recovery.
        """);

    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            string configPath = DefaultConfig, command = "--help";
            bool enable = false, hasCommand = false;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--config")
                {
                    if (++i >= args.Length || args[i].StartsWith("--")) throw new ArgumentException("--config needs a file path.");
                    configPath = Path.GetFullPath(args[i]);
                }
                else if (args[i] == "--enable-mix") enable = true;
                else if (!hasCommand && args[i] is "--help" or "--paths" or "--init" or "--self-test" or "--mix-only")
                { command = args[i]; hasCommand = true; }
                else throw new ArgumentException("Invalid arguments. Use --help.");
            }
            if (enable && command != "--mix-only") throw new ArgumentException("--enable-mix requires --mix-only.");
            if (command == "--help") { Help(); return 0; }
            if (command == "--paths")
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    os = RuntimeInformation.OSDescription, architecture = RuntimeInformation.ProcessArchitecture.ToString(),
                    commonApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    commonLocalApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    configPath, obsConfigPath = ObsConfig,
                    mixJournalDirectory = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(configPath))!, "mix-state")
                }, BridgeConfig.Options));
                return 0;
            }
            if (command == "--init")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(configPath))!);
                if (!File.Exists(configPath))
                {
                    using var file = new FileStream(configPath, FileMode.CreateNew, FileAccess.Write, FileShare.None);
                    JsonSerializer.Serialize(file, new BridgeConfig(), BridgeConfig.Options);
                }
                Console.WriteLine("Configuration ready (existing files preserved): " + configPath);
                return 0;
            }
            if (command == "--self-test")
            {
                await BridgeSelfTests.RunAsync();
                await ObsTransportChecks.RunAsync();
                Console.WriteLine($"PASS: shared mix/audio tests and authenticated fake-OBS transport on {RuntimeInformation.OSDescription} / {RuntimeInformation.ProcessArchitecture}. No real OBS or input hardware used.");
                return 0;
            }
            var config = BridgeConfig.Load(configPath); // Includes strict loopback host/port validation.
            if (enable) config.MixEnabled = true;
            if (!config.MixEnabled) throw new InvalidOperationException("Grouped mix is disabled. Set mixEnabled:true in your config or explicitly pass --enable-mix.");
            using var stop = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
            using var terminate = !OperatingSystem.IsWindows()
                ? PosixSignalRegistration.Create(PosixSignal.SIGTERM, context => { context.Cancel = true; stop.Cancel(); }) : null;
            await Listen(config, stop);
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("ERROR: " + e.Message);
            return 1;
        }
    }

    static async Task<ObsConnection> Connect(BridgeConfig config, CancellationToken stop)
    {
        string? supplied = Environment.GetEnvironmentVariable("FADESTER_OBS_PASSWORD");
        if (!string.IsNullOrEmpty(supplied)) return await ObsConnection.Connect(config, stop);
        // Keep the shared Windows configuration class unchanged. On macOS its
        // SpecialFolder.ApplicationData can differ from OBS's actual bundle path.
        if (!File.Exists(ObsConfig)) throw new InvalidOperationException("No local OBS authentication config found. Set FADESTER_OBS_PASSWORD for this process.");
        var obs = JsonNode.Parse(await File.ReadAllTextAsync(ObsConfig, stop));
        if ((int?)obs?["server_port"] != config.Port || (bool?)obs?["server_enabled"] != true ||
            (bool?)obs?["auth_required"] != true || obs?["server_password"]?.GetValue<string>() is not { Length: > 0 } password)
            throw new InvalidOperationException("The local OBS authentication config must be enabled, authenticated, and match the chosen port.");
        // The credential is process-local and restored after the handshake. No child
        // process is launched and no credential is serialized or included in logs.
        Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", password);
        try { return await ObsConnection.Connect(config, stop); }
        finally { Environment.SetEnvironmentVariable("FADESTER_OBS_PASSWORD", supplied); }
    }

    static FileStream AcquireLease(int port)
    {
        // Independent of --config: two configurations for the same local endpoint
        // must not become competing gain owners. Keep the lock file in place on exit
        // so a second process cannot lock a newly-created inode while an owner exits.
        string directory = Path.Combine(HostDirectory, "run");
        Directory.CreateDirectory(directory);
        try { return new FileStream(Path.Combine(directory, $"mix-{port}.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None); }
        catch (IOException) { throw new InvalidOperationException("Fadester mix controls are already running for this OBS port in this user session."); }
    }

    static async Task Listen(BridgeConfig config, CancellationTokenSource stop)
    {
        using var lease = AcquireLease(config.Port);
        Console.WriteLine("Fadester mix-only companion: no controller shortcuts registered; no Accessibility or T-bar integration.");
        _ = Task.Run(async () =>
        {
            try
            {
                while (await Console.In.ReadLineAsync() is { } line)
                    if (line.Trim().Equals("quit", StringComparison.OrdinalIgnoreCase)) { stop.Cancel(); break; }
            }
            catch (IOException) { }
        });
        var stopped = Task.Delay(Timeout.Infinite, stop.Token);
        string? lastError = null;
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var obs = await Connect(config, stop.Token);
                var desk = new DeskActions(config, obs.Call, nativeMove: (_, _) =>
                    Task.FromException(new InvalidOperationException("Native T-bar control is unavailable in the mix-only host.")));
                obs.InputLevelChangedById += desk.OnMixInputLevelChanged;
                desk.StartMixMonitor();
                var protocol = new MixProtocolServer(obs, desk, "Fadester Mix Host");
                lastError = null;
                Console.WriteLine($"Connected to OBS at {config.Host}:{config.Port}. Grouped mix provider ready.");
                try { await Task.WhenAny(obs.Disconnected, stopped); }
                finally
                {
                    await protocol.DisposeAsync();
                    await desk.StopMixAsync();
                    obs.InputLevelChangedById -= desk.OnMixInputLevelChanged;
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception e)
            {
                if (e.Message != lastError) { Console.Error.WriteLine("Offline: " + e.Message); lastError = e.Message; }
            }
            if (!stop.IsCancellationRequested)
            {
                try { await Task.Delay(1200, stop.Token); }
                catch (OperationCanceledException) { break; }
            }
        }
        Console.WriteLine("Mix host stopped. Mixer levels left in place; recovery journal retained if needed.");
    }
}
