// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace Fadester.TourBox;

internal static class Program
{
    static string DefaultMap()
    {
        var packaged = Path.Combine(AppContext.BaseDirectory, "presets", "map.json");
        if (File.Exists(packaged)) return packaged;
        foreach (var root in new[] { Environment.CurrentDirectory, AppContext.BaseDirectory })
            for (var dir = new DirectoryInfo(root); dir != null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "tourbox", "presets", "map.json");
                if (File.Exists(candidate)) return candidate;
            }
        return packaged;
    }
    internal static async Task<int> Main(string[] argv)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        try
        {
            var args = argv.ToList();
            string Option(string key, string fallback)
            {
                int i = args.IndexOf(key); if (i < 0) return fallback;
                if (i + 1 >= args.Count || args[i + 1].StartsWith("--")) throw new ArgumentException(key + " needs a path.");
                string v = args[i + 1]; args.RemoveRange(i, 2); return Path.GetFullPath(v);
            }
            string configPath = Option("--config", BridgeConfig.DefaultPath), map = Option("--map", DefaultMap());
            string command = args.FirstOrDefault() ?? "--listen";
            if ((command == "--dispatch" && args.Count != 2) || (command != "--dispatch" && args.Count > 1)) throw new ArgumentException("Invalid arguments. See --help.");
            if (command == "--help") { Console.WriteLine("FadesterTourBoxBridge [--config PATH] [--map PATH] [--init | --catalog | --check | --self-test | --dispatch ACTION | --listen | --mix-only]\nMix-only serves other controllers without registering shortcuts. Type quit or press Ctrl+C to stop."); return 0; }
            if (command == "--init")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
                if (!File.Exists(configPath)) { using var f = new FileStream(configPath, FileMode.CreateNew); JsonSerializer.Serialize(f, new BridgeConfig(), BridgeConfig.Options); }
                Console.WriteLine("Configuration: " + configPath); return 0;
            }
            if (command == "--self-test")
            {
                var bindings = Binding.Load(map); await BridgeSelfTests.RunAsync(); await StudioFaderSelfTests.RunAsync(); GamepadSelfTests.Run();
                // The packaged panel reads the controller map from here; a source checkout without it skips the check.
                var padFile = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(map))!, "gamepad.json");
                if (File.Exists(padFile)) GamepadSelfTests.CheckPresetFile(padFile);
                Console.WriteLine($"PASS: dispatcher, Studio T-bar, game controller and {bindings.Count} mapped shortcuts. No live OBS commands sent."); return 0;
            }
            var config = BridgeConfig.Load(configPath);
            using var stop = new CancellationTokenSource();
            Console.CancelKeyPress += (_, eventArgs) => { eventArgs.Cancel = true; stop.Cancel(); };
            if (command is "--listen" or "--mix-only")
            {
                if (command == "--mix-only" && !config.MixEnabled) throw new ArgumentException("Enable All OBS mixer inputs in Setup first.");
                if (command == "--listen") config.CheckPorts();
                await Listen(config, command == "--listen" ? Binding.Load(map) : [], stop); return 0;
            }
            if (command is not ("--catalog" or "--check" or "--dispatch")) throw new ArgumentException("Unknown option " + command + ". See --help.");
            using var obs = await ObsConnection.Connect(config, stop.Token);
            using var native = new NativeTBar(config.Port);
            var desk = new DeskActions(config, obs.Call, nativeMove: native.MoveAsync);
            if (command == "--catalog") Console.WriteLine((await desk.Catalog()).ToJsonString());
            else if (command == "--check") Console.WriteLine($"OBS {(await obs.Call("GetVersion"))["obsVersion"]} connected. {Binding.Load(map).Count} global shortcuts validated.");
            else
            {
                if (args[1].StartsWith("mix.") || args[1].StartsWith("vjster.") || (args[1].StartsWith("fader.") && args[1] != "fader.status") || args[1] is "music.duck" or "music.restore" or "undo" or "bridge.reconnect")
                    throw new ArgumentException("This action needs the running bridge's session state. Use --listen.");
                Console.WriteLine(await desk.Dispatch(args[1]));
            }
            return 0;
        }
        catch (Exception e) { Console.Error.WriteLine("ERROR: " + e.Message); return 1; }
    }

    private static async Task Listen(BridgeConfig cfg, List<Binding> bindings, CancellationTokenSource stop)
    {
        // One gain authority per local OBS endpoint, including other Windows login sessions.
        // Retain the handle without thread ownership: awaiting OBS can resume on another thread.
        using var single = new Mutex(false, @"Global\FadesterMixBridge-" + cfg.Port, out bool first);
        if (!first) throw new InvalidOperationException("Fadester controls are already running for this OBS port. Use the existing panel.");
        var input = Channel.CreateBounded<KeyInput>(new BoundedChannelOptions(128) { SingleReader = true, FullMode = BoundedChannelFullMode.Wait });
        // VJster actions go to the Chrome extension, never to OBS, so they are queued whether or not OBS is connected.
        var vjInput = Channel.CreateBounded<KeyInput>(new BoundedChannelOptions(64) { SingleReader = true, FullMode = BoundedChannelFullMode.DropOldest });
        int current = 0, generation = 0;
        VjsterHost? vjster = cfg.VjsterEnabled && bindings.Count > 0 ? new VjsterHost(cfg, Console.WriteLine) : null;
        void Enqueue(string action)
        {
            if (action.StartsWith("vjster."))
            {
                if (vjster == null) Console.WriteLine("VJster is off: ignored " + action);
                else if (!vjInput.Writer.TryWrite(new(action, 1, Stopwatch.GetTimestamp()))) Console.WriteLine("VJster queue closed: ignored " + action);
                return;
            }
            int g = Volatile.Read(ref current);
            if (g == 0) { Console.WriteLine("Offline: ignored " + action); return; }
            if (!input.Writer.TryWrite(new(action, g, Stopwatch.GetTimestamp()))) Console.WriteLine("Input queue full: ignored " + action);
        }
        var keys = new Hotkeys(bindings, Enqueue);
        keys.Start(stop.Token);
        // The game controller: buttons go through the same queue as the shortcuts; the trigger T-bar posts its newest
        // position to a mailbox and queues one marker, so the dispatch loop always moves to where the trigger is now.
        var tbarMail = new TbarMailbox();
        void PostTbar()
        {
            int g = Volatile.Read(ref current);
            if (g == 0 || !input.Writer.TryWrite(new("pad.tbar", g, Stopwatch.GetTimestamp()))) { tbarMail.Take(); tbarMail.Fail(); }
        }
        // A held stick repeats every 200 ms: say once that its target is missing, not five times a second.
        bool toldVjsterOff = false, toldPadOffline = false;
        void PadEnqueue(string action)
        {
            if (action.StartsWith("vjster.") && vjster == null)
            {
                if (!toldVjsterOff) { toldVjsterOff = true; Console.WriteLine("VJster is off: the controller's video actions do nothing."); }
                return;
            }
            if (!action.StartsWith("vjster."))
            {
                // A held stick repeats, so say it once for each stretch without OBS.
                if (Volatile.Read(ref current) == 0)
                {
                    if (!toldPadOffline) { toldPadOffline = true; Console.WriteLine("Not connected to OBS: the controller's OBS actions do nothing until it is back."); }
                    return;
                }
                toldPadOffline = false;
            }
            Enqueue(action);
        }
        bool padOn = cfg.GamepadEnabled && bindings.Count > 0;
        var padMap = padOn ? PadControls.Build(cfg.GamepadMap) : null;
        if (padMap != null)
        {
            Console.WriteLine(cfg.GamepadEasy
                ? "Game controller: easy mode on. Hold a button 0.4 s for take, cut and other live actions (0.7 s for fade out and mic mute); the right trigger takes as usual."
                : "Game controller: easy mode off. Every button acts on press.");
            if (padMap.Keys.Any(k => k.StartsWith(PadControls.ShiftPrefix, StringComparison.OrdinalIgnoreCase)))
                Console.WriteLine("Game controller: LB is the shift button and does nothing on its own.");
        }
        Task padTask = padMap != null
            ? new GamepadLoop(new XInputPadSource(), new PadReader(padMap, cfg.GamepadEasy), tbarMail, PadEnqueue, PostTbar, Console.WriteLine).Run(stop.Token)
            : Task.CompletedTask;
        // The panel and the tests can type "dispatch <action>" on stdin; it runs exactly as the hotkey would.
        void Command(string line)
        {
            line = line.Trim();
            if (line.Equals("quit", StringComparison.OrdinalIgnoreCase)) { stop.Cancel(); return; }
            if (line.StartsWith("dispatch ", StringComparison.OrdinalIgnoreCase))
            {
                var action = line["dispatch ".Length..].Trim();
                if (DeskActions.Supported.Contains(action)) Enqueue(action); else Console.WriteLine("Unknown action: " + action);
            }
        }
        Task vjTask = vjster?.Run(vjInput.Reader, stop.Token) ?? Task.CompletedTask;
        try
        {
            await keys.Ready;
            Console.WriteLine(bindings.Count > 0 ? $"Listening for {bindings.Count} TourBox shortcuts. Type quit to stop." : "Mix-only companion: no controller shortcuts registered. Type quit to stop.");
            // Started by the panel, stdin ending means the panel is gone: nothing else could stop this process, and it would
            // keep the shortcuts and block the next start. A launch from a script with no input is not a panel going away.
            bool panelOwned = Environment.GetEnvironmentVariable("FADESTER_PANEL") == "1";
            if (Console.IsInputRedirected) _ = Task.Run(async () => { try { while (!stop.IsCancellationRequested && await Console.In.ReadLineAsync() is { } line) Command(line); if (panelOwned && !stop.IsCancellationRequested) { Console.WriteLine("The control panel closed: stopping."); stop.Cancel(); } } catch (IOException) { } });
            else _ = Task.Run(() => { try { while (!stop.IsCancellationRequested && Console.ReadLine() is { } line) Command(line); } catch (IOException) { } });
            string? lastError = null;
            // A duck, a cut's owed transition and a part-thrown T-bar outlive a dropped connection.
            DeskActions.Memory? memory = null;
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    using var obs = await ObsConnection.Connect(cfg, stop.Token); lastError = null;
                    using var native = new NativeTBar(cfg.Port);
                    var desk = new DeskActions(cfg, obs.Call, nativeMove: native.MoveAsync, resume: memory); int mine = ++generation;
                    obs.InputVolumeChanged += desk.OnVolumeChanged;
                    obs.InputLevelChangedById += desk.OnMixInputLevelChanged;
                    desk.StartMixMonitor();
                    var protocol = new MixProtocolServer(obs,desk);
                    Console.WriteLine($"Connected to OBS at {cfg.Host}:{cfg.Port}.");
                    // Before any input is accepted: finish what the last connection left behind.
                    try { var said = await desk.ResumeAsync(); if (said.Length > 0) Console.WriteLine(said); }
                    catch (Exception e) when (!stop.IsCancellationRequested) { Console.WriteLine("After reconnecting: " + e.Message); }
                    finally { memory = desk.Leave(); } // what could not be finished now is tried again on the next connection
                    Volatile.Write(ref current, mine);
                    tbarMail.Fail(); // a trigger held across a reconnect must return to rest before it can throw on the new connection
                    try
                    {
                        using var wait = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                        long lastHeldTurn = 0;
                        while (!stop.IsCancellationRequested && !obs.Disconnected.IsCompleted)
                        {
                            var readable = input.Reader.WaitToReadAsync(wait.Token).AsTask();
                            var completed = await Task.WhenAny(readable, obs.Disconnected, keys.Done);
                            if (completed == keys.Done) { await keys.Done; stop.Cancel(); break; }
                            if (completed != readable) { wait.Cancel(); break; }
                            if (!await readable) break;
                            if (!input.Reader.TryRead(out var ev)) continue;
                            if (ev.Action == "pad.tbar")
                            {
                                // Never stale: it carries no value of its own and reads the trigger's newest position.
                                var target = tbarMail.Take();
                                if (ev.Generation != mine || target is not double t || stop.IsCancellationRequested) continue;
                                try { var said = await desk.TbarTo(t); if (said.Length > 0) Console.WriteLine(said); }
                                catch (Exception e)
                                {
                                    tbarMail.Fail(); Console.WriteLine("Controller T-bar: " + e.Message);
                                    // The pad is disarmed, so its spring return will not cancel: leave nothing half thrown.
                                    try { await desk.CancelOwnedAsync(); } catch (Exception c) { Console.WriteLine("Could not cancel T-bar: " + c.Message); }
                                }
                                continue;
                            }
                            if (ev.Generation != mine) continue;
                            if (stop.IsCancellationRequested) break;
                            if (Stopwatch.GetElapsedTime(ev.Timestamp) > TimeSpan.FromMilliseconds(KeyGuards.IsTurnTick(ev.Action) ? 180 : 1500)) { Console.WriteLine("Discarded stale input: " + ev.Action); continue; }
                            if (KeyGuards.IsStrayFaderTick(ev.Action, lastHeldTurn, ev.Timestamp)) { Console.WriteLine("Ignored a T-bar tick right after a held Dial turn: was the button still held?"); continue; }
                            if (KeyGuards.IsHeldDialTurn(ev.Action)) lastHeldTurn = ev.Timestamp;
                            if (ev.Action == "bridge.reconnect") { Console.WriteLine("Reconnecting."); break; }
                            try { Console.WriteLine(await desk.Dispatch(ev.Action)); }
                            catch (Exception e) { Console.WriteLine("Action " + ev.Action + ": " + e.Message); }
                            // A take, cancel or dial move from any surface owns the T-bar now: a trigger held meanwhile
                            // must return to rest before it throws, or it would throw back towards the scene just taken.
                            // A Preview or anchor cue cancels a manual sweep first (DeskActions.Cue), so it disarms too.
                            if (PadControls.StopsThrow(ev.Action)) tbarMail.Fail();
                        }
                    }
                    finally
                    {
                        Volatile.Write(ref current, 0);
                        tbarMail.Fail();
                        // Each step on its own: a failure in one must not skip the T-bar cancel or lose the memory.
                        try { await protocol.DisposeAsync(); } catch (Exception e) { Console.WriteLine("Closing the mixer link: " + e.Message); }
                        try { await desk.StopAudioAsync(); } catch (Exception e) { Console.WriteLine("Stopping fades: " + e.Message); }
                        if (!obs.Disconnected.IsCompleted) { try { await desk.CancelOwnedAsync(); } catch (Exception e) { Console.WriteLine("Could not cancel T-bar: " + e.Message); } }
                        memory = desk.Leave();
                    }
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                catch (Exception e) { if (e.Message != lastError) { Console.WriteLine("Offline: " + e.Message); lastError = e.Message; } }
                if (!stop.IsCancellationRequested) { try { await Task.Delay(1200, stop.Token); } catch (OperationCanceledException) { break; } }
            }
        }
        finally
        {
            stop.Cancel(); try { await keys.Done; } catch (Exception) { /* already reported through keys.Ready or the dispatch loop */ }
            try { await padTask; } catch (Exception e) when (e is not OperationCanceledException) { Console.WriteLine("Game controller stopped: " + e.Message); } catch (OperationCanceledException) { }
            vjInput.Writer.TryComplete();
            try { await vjTask; } catch (OperationCanceledException) { }
            if (vjster != null) await vjster.DisposeAsync();
        }
        Console.WriteLine("Bridge stopped.");
    }
}
