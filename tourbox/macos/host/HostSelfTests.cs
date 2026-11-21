// SPDX-License-Identifier: GPL-2.0-or-later
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class HostSelfTests
{
    static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException("Host check: " + message);
    }
    static async Task Refused(Func<Task> action)
    {
        try { await action(); }
        catch (Exception error) when (error is InvalidOperationException or IOException) { return; }
        throw new InvalidOperationException("Host check: expected guarded refusal.");
    }
    static HostCommand Pop(CommandIngress ingress)
    {
        Check(ingress.Commands.Reader.TryRead(out var command), "expected queued command");
        return command!;
    }
    internal static async Task Run()
    {
        MacDevelopmentHost.CheckControlFrames();
        await MacDevelopmentHost.CheckGuardedOutput();
        long time = 1000, unix = 100000;
        var ingress = new CommandIngress(() => time, () => unix);
        Check(!ingress.SubmitLine("action take", out _), "offline input rejected");
        int first = ingress.Activate();
        Check(ingress.SubmitLine("action fader.forward", out _), "manual input admitted");
        var original = Pop(ingress);
        time += 180; Check(ingress.Fresh(original), "rotary boundary retained");
        time++; Check(!ingress.Fresh(original), "old rotary discarded");
        Check(!ingress.SubmitEvent("music.up", first, unix - 181, out _), "source callback age retained");
        Check(!ingress.SubmitEvent("take", first, unix + 101, out _), "future callback refused");
        Check(ingress.SubmitEvent("music.up", first, unix - 150, out _), "recent callback accepted");
        var partlyAged = Pop(ingress); time += 31;
        Check(!ingress.Fresh(partlyAged), "source and local queue ages accumulate");
        foreach (string action in new[] { "content.down", "preview.next", "media.previous", "transition.longer", "mix.down", "fader.fineBack" })
            Check(CommandIngress.Lifetime(action) == 180, "all relative rotary families expire promptly");
        Check(CommandIngress.Lifetime("take") == 1500, "button deadline");
        foreach (string bad in new[] { "action StartStream", "action take extra", " action take", "event -1 100000 take", "event 1 NaN take", "action take\t", new string('a', 257) })
            Check(!ingress.SubmitLine(bad, out _), "malformed/unknown input rejected");
        ingress.Disarm();
        Check(!ingress.Current(original), "disarm invalidates queued work");
        int second = ingress.Activate();
        Check(second > first && !ingress.SubmitEvent("take", first, unix, out _), "reconnect rejects old generation");
        ingress.Disarm(first);
        Check(ingress.Generation == second, "late old helper exit cannot disarm replacement connection");
        Check(ingress.SubmitLine($"event {second} {unix} preview.status", out _), "physical helper protocol");
        _ = Pop(ingress);
        Check(MacShortcutInput.TryParseEvent($"event {second} {unix - 150} fader.forward", DeskActions.Supported, out var nativeEvent), "real native transport event parser");
        Check(ingress.SubmitEvent(nativeEvent!.Action, nativeEvent.Generation, nativeEvent.UnixMs, out _), "native event bridge");
        var nativeCommand = Pop(ingress); time += 31;
        Check(!ingress.Fresh(nativeCommand), "native callback timestamp is never refreshed by host integration");
        Check(!MacShortcutInput.TryParseEvent($"event {second} {unix} StartStream", DeskActions.Supported, out _), "unsupported input cannot reach host");
        for (int i = 0; i < 64; i++) Check(ingress.SubmitLine("action preview.status", out _), "bounded capacity");
        Check(!ingress.SubmitLine("action take", out _), "overflow rejected instead of buffered elsewhere");
        while (ingress.Commands.Reader.TryRead(out _)) { }

        Check(ingress.SubmitLine("action music.duck", out _), "ramp input");
        var permit = new DispatchPermit(ingress, Pop(ingress));
        permit.Check(write: true); time += 2000;
        permit.Check(write: true); // An accepted timed fade is not a new old input.
        ingress.Disarm();
        await Refused(() => { permit.Check(write: true); return Task.CompletedTask; });

        // Exercise the real DeskActions + StudioFader path, not a copied fader.
        time = 1000; unix = 100000; int generation = ingress.Activate();
        // Writes and reads are counted apart: before every sweep the fader reads the slider once (an equal-value call).
        var calls = new List<string>(); int nativeCalls = 0, nativeWrites = 0;
        bool expireOnScenes = true, failNative = false, changeGeneration = false;
        Task<JsonObject> Rpc(string method, JsonObject? args)
        {
            calls.Add(method);
            if (method == "GetSceneList" && expireOnScenes) time += 181;
            if (method == "GetSceneList" && changeGeneration) ingress.Disarm();
            return Task.FromResult<JsonObject>(method switch
            {
                "GetVersion" => new() { ["obsVersion"] = "33.0.1" },
                "GetStudioModeEnabled" => new() { ["studioModeEnabled"] = true },
                "GetSceneList" => new() { ["currentProgramSceneUuid"] = "a", ["currentPreviewSceneUuid"] = "b", ["currentProgramSceneName"] = "Fixture A", ["currentPreviewSceneName"] = "Fixture B" },
                "GetCurrentSceneTransitionCursor" => new() { ["transitionCursor"] = nativeWrites > 0 ? 0.05d : 0d },
                "GetCurrentSceneTransition" => new() { ["transitionKind"] = "fade_transition", ["transitionName"] = "Fade", ["transitionUuid"] = "fade" },
                "GetSceneSceneTransitionOverride" => new() { ["transitionName"] = "" },
                _ => throw new InvalidOperationException("Unexpected fixture RPC: " + method)
            });
        }
        Task Native(double from, double to)
        {
            nativeCalls++;
            if (from != to) nativeWrites++;
            return failNative ? Task.FromException(new IOException("Synthetic native refusal")) : Task.CompletedTask;
        }
        var config = new BridgeConfig();
        var session = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None);
        Check(ingress.SubmitLine("action fader.forward", out _), "fader admitted before slow preflight");
        await Refused(() => session.Dispatch(Pop(ingress)));
        Check(nativeWrites == 0 && calls.All(c => c.StartsWith("Get", StringComparison.Ordinal)), "late first native write blocked after OBS reads");
        expireOnScenes = false;
        Check(ingress.SubmitLine("action fader.forward", out _), "next fader tick admitted after pre-write expiry");
        Check((await session.Dispatch(Pop(ingress))).Contains("T-bar"), "pre-write expiry does not latch StudioFader needsReset");
        Check(nativeWrites == 1, "fresh tick after pre-write expiry moves native T-bar");
        nativeWrites = 0; failNative = true; calls.Clear(); int seen = nativeCalls;
        session = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None);
        Check(ingress.SubmitLine("action fader.forward", out _), "native refusal fixture admitted");
        await Refused(() => session.Dispatch(Pop(ingress)));
        Check(nativeCalls == seen + 1 && nativeWrites == 0 && calls.All(c => c.StartsWith("Get", StringComparison.Ordinal)), "native failure has no WebSocket-only fading fallback");
        failNative = false; changeGeneration = true; calls.Clear(); seen = nativeCalls;
        session = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None);
        Check(ingress.SubmitLine("action fader.forward", out _), "generation fixture admitted");
        await Refused(() => session.Dispatch(Pop(ingress)));
        Check(nativeCalls == seen && !calls.Contains("GetCurrentSceneTransition"), "disconnect/generation change during preflight halts dispatch");
        generation = ingress.Activate(); calls.Clear();
        session = new HostSession(config, ingress, generation, Rpc, Native, () => false, CancellationToken.None);
        Check(ingress.SubmitLine("action fader.forward", out _), "input failure fixture admitted");
        await Refused(() => session.Dispatch(Pop(ingress)));
        Check(calls.Count == 0 && nativeCalls == seen, "failed input helper prevents subsequent OBS/native access");

        changeGeneration = false; calls.Clear(); config.MicInput = "Synthetic Mic";
        var readOnly = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None, readOnly: true, nativeRead: () => Task.FromResult(51));
        Check(ingress.SubmitLine("action host.native.status", out _), "host native readback input admitted");
        Check(await readOnly.Dispatch(Pop(ingress)) == "Native slider: 51 / 1023" && nativeCalls == seen, "native readback is independent of local fader position and does not move");
        Check(ingress.SubmitLine("action preview.status", out _), "read-only status input admitted");
        Check((await readOnly.Dispatch(Pop(ingress))).Contains("Fixture A"), "read-only status uses production getter");
        int reads = calls.Count;
        Check(ingress.SubmitLine("action take", out _), "forbidden read-only input reaches policy guard");
        await Refused(() => readOnly.Dispatch(Pop(ingress)));
        Check(calls.Count == reads, "read-only whitelist blocks action before OBS access");
        // Even an internal call bypassing Dispatch's whitelist cannot write.
        await Refused(() => readOnly.Desk.Dispatch("mic.mute"));
        await Refused(() => readOnly.Desk.Dispatch("fader.forward"));
        Check(nativeCalls == seen && nativeWrites == 0 && calls.All(c => c.StartsWith("Get", StringComparison.Ordinal)), "read-only backend refuses OBS and native writes independently");
        Check(ingress.SubmitLine("action vjster.status", out _), "read-only vjster.status admitted");
        Check(await readOnly.Dispatch(Pop(ingress)) == "VJster: disabled in read-only mode.", "read-only vjster.status reports disabled");
        Check(ingress.SubmitLine("action vjster.speed.up", out _), "read-only vjster.speed.up reaches guard");
        await Refused(() => readOnly.Dispatch(Pop(ingress)));

        // What a session leaves for the next one of the same run (a reconnect): the duck, an owed transition and a
        // part-thrown T-bar, and the next session's desk starts from it without sending anything.
        int callsBefore = calls.Count, nativeBefore = nativeCalls;
        var duck = new AudioDesk.Duck("Synthetic Music", -3, -18);
        var owedCut = new StudioFader.Owed("Cut", "Fade", System.Diagnostics.Stopwatch.GetTimestamp());
        var left = new DeskActions.Memory(new StudioFader.Memory
        {
            Owed = owedCut, Sweep = new StudioFader.Sweep(new StudioFader.Scenes("Fixture A", "Fixture B"), "fade-uuid"), Position = 0.4, Direction = -1, TakeAt = 7
        }, duck);
        var kept = MacDevelopmentHost.Carry(left);
        Check(kept.Duck == duck && kept.Fader.Owed == owedCut && kept.Fader.Sweep is not null && kept.Fader.Position == 0.4 &&
              kept.Fader.Direction == -1 && kept.Fader.TakeAt == 7, "a session leaves its duck, its owed transition and a part-thrown T-bar");
        var resumed = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None, resume: kept);
        var again = resumed.Desk.Leave();
        Check(again.Duck == duck && again.Fader.Owed == owedCut && again.Fader.Sweep is not null && resumed.Desk.TbarPosition == 0.4,
            "the next session's desk starts with the duck, the owed transition and the part-thrown T-bar");
        Check(new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None).Desk.Leave() is { Duck: null, Fader.Owed: null },
            "a first session starts with nothing carried");
        Check(calls.Count == callsBefore && nativeCalls == nativeBefore, "carrying memory into a session sends nothing to OBS or the native T-bar");

        await CheckTbarGate();

        var noVjster = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None);
        Check(ingress.SubmitLine("action vjster.speed.up", out _), "disabled vjster action admitted");
        await Refused(() => noVjster.Dispatch(Pop(ingress)));

        await using var vjLink = new VjsterLink(0, null, _ => { });
        await vjLink.StartAsync();
        using var fakeExt = new System.Net.WebSockets.ClientWebSocket();
        fakeExt.Options.SetRequestHeader("Origin", "chrome-extension://abcdefghijklmnopabcdefghijklmnop");
        await fakeExt.ConnectAsync(new Uri($"ws://127.0.0.1:{vjLink.BoundPort}/"), CancellationToken.None);
        var buf = new byte[4096];
        var initMsg = await fakeExt.ReceiveAsync(buf, CancellationToken.None);
        var initObj = JsonNode.Parse(System.Text.Encoding.UTF8.GetString(buf, 0, initMsg.Count))!.AsObject();
        Check(initObj["type"]!.GetValue<string>() == "state.get", "host vjster link requests initial state");
        var withVjster = new HostSession(config, ingress, generation, Rpc, Native, () => true, CancellationToken.None, vjster: new VjsterDesk(vjLink, targetChoice: "both"));
        Check(ingress.SubmitLine("action vjster.speed.up", out _), "live vjster rotary admitted");
        var vjTask = withVjster.Dispatch(Pop(ingress));
        var stepMsg = await fakeExt.ReceiveAsync(buf, CancellationToken.None);
        var stepObj = JsonNode.Parse(System.Text.Encoding.UTF8.GetString(buf, 0, stepMsg.Count))!.AsObject();
        string replyJson = $$"""{"v":1,"id":"r1","target":"browser","type":"state","inReplyTo":"{{stepObj["id"]!.GetValue<string>()}}","rate":1.25,"rateDirect":false,"availableRates":[1,1.25],"quality":"hd1080","availableQualities":["hd1080"],"qualityAuto":false,"title":"Test","host":"www.youtube.com","playing":true,"adPlaying":false,"capabilities":["speed","quality","transport"],"pinned":false}""";
        await fakeExt.SendAsync(System.Text.Encoding.UTF8.GetBytes(replyJson), System.Net.WebSockets.WebSocketMessageType.Text, true, CancellationToken.None);
        Check(await vjTask == "Test · Video 1.25x · 1080p · playing", "HostSession routes vjster actions through VjsterDesk (the line names the video)");
        Check(ingress.SubmitLine("action vjster.speed.up", out _), "stale vjster rotary admitted before clock advance");
        var staleVj = Pop(ingress); time += 181;
        await Refused(() => withVjster.Dispatch(staleVj));

        LogPass();
    }
    /// <summary>
    /// A T-bar that cannot be read at a session's start holds up the T-bar only (F-02): the move is a refusal that wrote
    /// nothing, the next look is at most every two seconds, and the first read that succeeds lets the T-bar go.
    /// </summary>
    static async Task CheckTbarGate()
    {
        long clock = 0; int reads = 0, moves = 0, at = 0; Exception? failure = new InvalidOperationException("Accessibility denied; grant the responsible app");
        var said = new List<string>();
        Task<int> Read() { reads++; return failure is null ? Task.FromResult(at) : Task.FromException<int>(failure); }
        Task Move(double from, double to) { moves++; return Task.CompletedTask; }
        int carriedTick = 0;
        var gate = new MacDevelopmentHost.TbarGate(Read, Move, () => carriedTick, said.Add, () => clock);
        Check(await gate.LookAsync() == "Accessibility denied; grant the responsible app" && gate.Blocked is not null, "an unreadable T-bar is remembered with its reason");
        clock = 500;
        try { await gate.MoveAsync(0, 0.05); throw new InvalidOperationException("Host check: blocked T-bar moved."); }
        catch (NativeRefusal refusal) { Check(refusal.Message.Contains("Accessibility denied") && reads == 1 && moves == 0, "a blocked T-bar refuses without writing or looking again at once"); }
        clock = 2600;
        try { await gate.MoveAsync(0, 0.05); throw new InvalidOperationException("Host check: blocked T-bar moved."); }
        catch (NativeRefusal) { Check(reads == 2 && moves == 0, "after two seconds a move looks again, and still refuses while the T-bar cannot be read"); }
        failure = null; clock = 5000;
        await gate.MoveAsync(0, 0.05);
        Check(reads == 3 && moves == 1 && gate.Blocked is null && said.Count == 1 && said[0].StartsWith("T-BAR:", StringComparison.Ordinal), "the first read that succeeds lets the T-bar go, and says so once");
        await gate.MoveAsync(0.05, 0.1);
        Check(reads == 3 && moves == 2 && said.Count == 1, "an open T-bar moves without another look");
        // Not parked: someone's own part-way T-bar blocks; the last session's own part-thrown sweep does not.
        at = 400; gate = new MacDevelopmentHost.TbarGate(Read, Move, () => carriedTick, said.Add, () => clock);
        Check(await gate.LookAsync() == MacDevelopmentHost.TbarGate.NotParked, "a T-bar part-way that is not ours waits");
        carriedTick = 400;
        Check(await gate.LookAsync() is null, "a T-bar where the last session's own sweep left it is taken over");
        // The fader treats the gate's refusal as "nothing written": no latch, and the next move works once the T-bar is back.
        var obsCalls = new List<string>(); double cursor = 0; bool studio = true;
        Task<JsonObject> Rpc(string request, JsonObject? args)
        {
            obsCalls.Add(request);
            return Task.FromResult(request switch
            {
                "GetVersion" => new JsonObject { ["obsVersion"] = "33.0.1" },
                "GetStudioModeEnabled" => new JsonObject { ["studioModeEnabled"] = studio },
                "GetSceneList" => new JsonObject { ["currentProgramSceneUuid"] = "a", ["currentPreviewSceneUuid"] = "b" },
                "GetCurrentSceneTransitionCursor" => new JsonObject { ["transitionCursor"] = cursor },
                "GetCurrentSceneTransition" => new JsonObject { ["transitionKind"] = "fade_transition", ["transitionName"] = "Fade", ["transitionUuid"] = "fade", ["transitionDuration"] = 300 },
                "GetSceneSceneTransitionOverride" => new JsonObject(),
                _ => new JsonObject()
            });
        }
        failure = new InvalidOperationException("expected exactly one native OBS T-bar"); at = 0; carriedTick = 0; clock = 10_000;
        gate = new MacDevelopmentHost.TbarGate(Read, Move, () => carriedTick, said.Add, () => clock);
        await gate.LookAsync();
        var fader = new StudioFader(Rpc, 0.25, gate.MoveAsync, allowAutoCloseout: false);
        try { await fader.DispatchAsync("fader.forward"); throw new InvalidOperationException("Host check: blocked T-bar started a throw."); }
        catch (NativeRefusal) { }
        Check(fader.Position == 0 && !obsCalls.Any(call => call.StartsWith("Set", StringComparison.Ordinal) || call.StartsWith("Trigger", StringComparison.Ordinal)),
            "a blocked T-bar starts no throw and writes nothing to OBS");
        await fader.DispatchAsync("fader.cancel"); // no latch was set: Cancel has nothing to clear and does not throw
    }
    static void LogPass() => Console.WriteLine("PASS: host bounded ingress, source timestamps, rotary/button expiry, generation invalidation, deliberate ramp lifetime, real DeskActions pre-write expiry, no native fallback and read-only action/backend guards.");
}
