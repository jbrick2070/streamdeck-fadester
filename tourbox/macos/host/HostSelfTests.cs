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
                "GetCurrentSceneTransitionCursor" => new() { ["transitionCursor"] = 0d },
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
        expireOnScenes = false; failNative = true; calls.Clear(); int seen = nativeCalls;
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
        Check(await vjTask == "Video 1.25x · 1080p · playing", "HostSession routes vjster actions through VjsterDesk");
        Check(ingress.SubmitLine("action vjster.speed.up", out _), "stale vjster rotary admitted before clock advance");
        var staleVj = Pop(ingress); time += 181;
        await Refused(() => withVjster.Dispatch(staleVj));

        LogPass();
    }
    static void LogPass() => Console.WriteLine("PASS: host bounded ingress, source timestamps, rotary/button expiry, generation invalidation, deliberate ramp lifetime, real DeskActions pre-write expiry, no native fallback and read-only action/backend guards.");
}
