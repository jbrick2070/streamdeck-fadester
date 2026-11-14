// SPDX-License-Identifier: GPL-2.0-or-later
using System.Collections.Concurrent;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal static class MixSelfTests
{
    private sealed class Source(string name, int caps, double level)
    {
        internal readonly Guid Id = Guid.NewGuid();
        internal string Name = name;
        internal readonly int Caps = caps;
        internal double Level = level;
    }

    internal static async Task Run()
    {
        var directory = Directory.CreateTempSubdirectory("fadester-mix-proof-").FullName;
        var cfg = new BridgeConfig { MixEnabled = true, MixStepDb = 3, MixFadeMs = 100, MixStateDirectory = directory };
        var a = new Source("Music", 2, 0.75);
        var b = new Source("Guest", 3, 1.2);
        var zero = new Source("Silent", 2, 0);
        var video = new Source("Visual", 1, 1);
        var composite = new Source("Nested", 2 | 64, 1);
        var all = new ConcurrentDictionary<Guid, Source>(new[] { a, b, zero, video, composite }.ToDictionary(x => x.Id));
        int reads = 0, writes = 0; bool failAfterSet = false; string collection = "Disposable";
        var appeared = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var late = new Source("New capture", 2, 0.32);
        MixDesk? desk = null;
        Task<JsonObject> Rpc(string request, JsonObject? arg)
        {
            JsonObject result = new();
            switch (request)
            {
                case "GetSceneCollectionList": result["currentSceneCollectionName"] = collection; break;
                case "GetInputList":
                    result["inputs"] = new JsonArray(all.Values.Select(x => (JsonNode)new JsonObject
                    {
                        ["inputUuid"] = x.Id.ToString(),
                        ["inputName"] = x.Name,
                        ["inputKindCaps"] = x.Caps
                    }).ToArray()); break;
                case "GetInputVolume":
                case "SetInputVolume":
                    {
                        var src = all[Guid.Parse(arg!["inputUuid"]!.GetValue<string>())];
                        Check(src.Caps != 1 && (src.Caps & 64) == 0 && !arg.ContainsKey("inputName"), "video/composite exclusion and UUID addressing");
                        if (request == "GetInputVolume") { reads++; result["inputVolumeMul"] = src.Level; }
                        else
                        {
                            src.Level = arg["inputVolumeMul"]!.GetValue<double>(); writes++; desk?.OnVolume(src.Id, src.Level);
                            if (src == late && src.Level == 0) appeared.TrySetResult();
                            if (failAfterSet) { failAfterSet = false; throw new IOException("simulated lost setter reply"); }
                        }
                        break;
                    }
                default: throw new Exception("Unexpected OBS request (mute/track/monitor must not change): " + request);
            }
            return Task.FromResult(result);
        }
        static void Check(bool ok, string test) { if (!ok) throw new Exception("Grouped mix self-test: " + test); }
        try
        {
            var disabled = new MixDesk(new BridgeConfig { MixStateDirectory = directory }, Rpc);
            Check(!(await disabled.Status())["enabled"]!.GetValue<bool>(), "disabled status");
            try { await disabled.Set(-6, 0); throw new Exception("disabled gain accepted"); } catch (InvalidOperationException) { }
            Check(writes == 0 && reads == 0, "disabled feature sends no OBS volume calls");
            desk = new MixDesk(cfg, Rpc);
            await desk.Step(-2);
            double mul = Math.Pow(10, -6.0 / 20);
            Check(Math.Abs(a.Level - .75 * mul) < 1e-9 && Math.Abs(b.Level - 1.2 * mul) < 1e-9 && zero.Level == 0, "relative ratios, boosted values and existing silence");
            a.Name = "Renamed Music"; await desk.Set(-100, 0);
            Check(a.Level == 0 && b.Level == 0 && composite.Level == 1 && video.Level == 1, "exact silence with composites untouched");
            desk.StartMonitor(); all[late.Id] = late;
            await appeared.Task.WaitAsync(TimeSpan.FromSeconds(4));
            // A human keeps ownership even if their change returns to the bridge's expected value before its next poll.
            b.Level = 0.23; desk.OnVolume(b.Id, b.Level); b.Level = 0; desk.OnVolume(b.Id, b.Level);
            await desk.Set(0, 0);
            Check(a.Level == .75 && late.Level == .32 && b.Level == 0, "restore originals across rename/addition; skip manually changed source");
            Check(!Directory.EnumerateFiles(directory, "*.json").Any(), "finished journal cleared");
            await desk.Stop();

            desk = new MixDesk(cfg, Rpc); failAfterSet = true;
            try { await desk.Set(-12, 0); throw new Exception("loss not detected"); } catch (IOException) { }
            await desk.Stop(); desk = new MixDesk(cfg, Rpc);
            Check((await desk.Status())["recovering"]!.GetValue<bool>(), "lost setter reply is recoverable after restart");
            await desk.Set(0, 0);
            Check(a.Level == .75 && late.Level == .32 && b.Level == 0, "reconcile pending transactions and preserve original levels");

            // A scene-collection switch cannot apply an old session's levels to a new collection.
            await desk.Set(-6, 0); int before = writes; collection = "Different";
            Check(!(await desk.Status())["active"]!.GetValue<bool>() && writes == before, "collection boundary");
            collection = "Disposable"; await desk.Set(0, 100);
            for (int i = 0; i < 100 && (await desk.Status())["fading"]!.GetValue<bool>(); i++) await Task.Delay(15);
            Check(a.Level == .75 && late.Level == .32 && !(await desk.Status())["active"]!.GetValue<bool>(), "timed restore");

            var deskActions = new DeskActions(cfg, Rpc);
            long nowMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var statusEnvelope = new JsonObject
            {
                ["namespace"] = MixProtocolServer.Scope,
                ["id"] = Guid.NewGuid().ToString("D"),
                ["op"] = "mix.status",
                ["sentAtMs"] = nowMs
            };
            Check(MixProtocolServer.Envelope(statusEnvelope, nowMs, out _, out var parsedOp) && parsedOp == "mix.status", "status envelope validation");
            var statusReply = await MixProtocolServer.BuildReplyAsync(statusEnvelope, parsedOp, deskActions, MixProtocolServer.DefaultProviderId, "Fadester Companion", MixProtocolServer.DefaultProviderVersion);
            var provider = statusReply["provider"]?.AsObject();
            Check(provider is not null && Guid.TryParse((string?)provider["id"], out var parsedPid) && parsedPid != Guid.Empty &&
                (string?)provider["name"] == "Fadester Companion" && !string.IsNullOrWhiteSpace((string?)provider["version"]),
                "reply provider identity { id, name, version }");
            var errEnvelope = new JsonObject
            {
                ["namespace"] = MixProtocolServer.Scope,
                ["id"] = Guid.NewGuid().ToString("D"),
                ["op"] = "mix.down",
                ["sentAtMs"] = nowMs,
                ["steps"] = -1
            };
            var errReply = await MixProtocolServer.BuildReplyAsync(errEnvelope, "mix.down", deskActions, MixProtocolServer.DefaultProviderId, "Fadester Companion", MixProtocolServer.DefaultProviderVersion);
            Check((bool?)errReply["ok"] == false && (string?)errReply["provider"]?["id"] == (string?)provider!["id"],
                "error replies preserve the same provider.id");
            await deskActions.StopMixAsync();
        }
        finally { if (desk != null) await desk.Stop(); Directory.Delete(directory, recursive: true); }
    }
}
