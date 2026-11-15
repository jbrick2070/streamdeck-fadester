// SPDX-License-Identifier: GPL-2.0-or-later
using System.Reflection;
using System.Text.Json.Nodes;
using System.Threading.Channels;

namespace Fadester.TourBox;

// One worker per authenticated OBS session. The socket reader never blocks on a reply to its own RPC.
internal sealed class MixProtocolServer : IAsyncDisposable
{
    internal const string Scope = "io.github.jbrick2070.fadester.mix.v1";
    internal static readonly string DefaultProviderId = Guid.NewGuid().ToString("D");
    internal static readonly string DefaultProviderVersion = ResolveVersion();
    readonly ObsConnection obs;
    readonly DeskActions desk;
    readonly string providerId;
    readonly string providerName;
    readonly string providerVersion;
    readonly Channel<JsonObject> queue = Channel.CreateBounded<JsonObject>(new BoundedChannelOptions(96) { SingleReader = true });
    readonly Dictionary<Guid,long> seen = new();
    readonly Task worker;
    volatile bool closed;
    public MixProtocolServer(ObsConnection obs, DeskActions desk, string providerName = "Fadester Companion", string? providerId = null, string? providerVersion = null)
    {
        this.obs = obs; this.desk = desk;
        this.providerName = string.IsNullOrWhiteSpace(providerName) ? "Fadester Companion" : providerName.Trim();
        this.providerId = string.IsNullOrWhiteSpace(providerId) ? DefaultProviderId : providerId.Trim();
        this.providerVersion = string.IsNullOrWhiteSpace(providerVersion) ? DefaultProviderVersion : providerVersion.Trim();
        worker = Run(); obs.CustomEvent += Receive;
    }
    static string ResolveVersion()
    {
        var assembly = typeof(MixProtocolServer).Assembly;
        var info = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        if (!string.IsNullOrWhiteSpace(info))
        {
            string clean = info.Split('+')[0].Trim();
            if (clean.Length > 0) return clean;
        }
        return assembly.GetName().Version?.ToString(3) ?? "1.0.0";
    }
    static bool Read<T>(JsonObject data, string key, out T value)
    {
        if (data[key] is JsonValue field && field.TryGetValue<T>(out var v) && v != null) { value = v; return true; }
        value = default!; return false;
    }
    internal static bool Envelope(JsonObject e, long now, out Guid id, out string op)
    {
        id = default; op = "";
        return Read<string>(e,"namespace",out var ns) && ns == Scope && Read(e,"op",out op) &&
            op is ("mix.status" or "mix.set" or "mix.up" or "mix.down" or "mix.fadeOut" or "mix.restore") &&
            Read<string>(e,"id",out var key) && Guid.TryParse(key,out id) && id != Guid.Empty &&
            Read<long>(e,"sentAtMs",out var timestamp) && timestamp >= now-10000 && timestamp <= now+1500;
    }
    internal static async Task<JsonObject> BuildReplyAsync(JsonObject e, string op, DeskActions desk, string providerId, string providerName, string providerVersion)
    {
        JsonObject reply = new()
        {
            ["namespace"]=Scope, ["id"]=e["id"]!.DeepClone(), ["op"]="reply",
            ["enabled"]=desk.MixEnabled, ["ok"]=false, ["db"]=null,
            ["provider"]=new JsonObject { ["id"]=providerId, ["name"]=providerName, ["version"]=providerVersion }
        };
        try
        {
            string message;
            if (op != "mix.status" && !desk.MixEnabled) message="All mixer inputs is off. Enable it in Fadester setup.";
            else {
                switch(op) {
                case "mix.set":
                    if(!Read<double>(e,"db",out var db) || !double.IsFinite(db) || db is < -100 or > 0 || !Read<int>(e,"durationMs",out int ms) || ms is < 0 or > 10000)
                        throw new ArgumentException("Set requires a level from −100 to 0 dB and a duration of 0–10000 ms.");
                    message=await desk.SetMixAsync(db,ms); break;
                case "mix.up": case "mix.down":
                    int steps=1;
                    if(e.ContainsKey("steps") && (!Read(e,"steps",out steps) || steps is < 1 or > 32)) throw new ArgumentException("Use 1–32 steps.");
                    message=await desk.StepMixAsync(op=="mix.up"?steps:-steps); break;
                case "mix.status": message=desk.MixEnabled?"All mixer inputs is enabled.":"All mixer inputs is off."; break;
                default: message=await desk.Dispatch(op); break;
                }
                reply["ok"]=true;
            }
            reply["message"]=message;
            var status=await desk.MixStatusAsync();
            foreach(var k in new[]{"active","db","silent","gain","fading","targetDb","managed","skipped","recovering"}) reply[k]=status[k]?.DeepClone();
            if(status["error"] is not null) {
                reply["ok"]=false; reply["message"]="Group fade paused. Check Activity before continuing.";
            }
        }
        catch(ArgumentException x) { reply["ok"]=false; reply["message"]=x.Message; }
        catch(Exception x) { Console.Error.WriteLine("Mix: "+x.Message); reply["ok"]=false; reply["message"]="Could not apply the mix command. Check the companion Activity log."; }
        return reply;
    }
    void Receive(JsonObject e)
    {
        if (!closed && Envelope(e,DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),out _,out _)) queue.Writer.TryWrite(e);
    }
    async Task Run()
    {
        await foreach(var e in queue.Reader.ReadAllAsync())
        {
            if(closed || obs.Disconnected.IsCompleted) return;
            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            if(!Envelope(e,now,out var id,out var op)) continue;
            foreach(var key in seen.Where(k => k.Value < now).Select(k => k.Key).ToArray()) seen.Remove(key);
            if(seen.Count >= 4096 || !seen.TryAdd(id,now+12000)) continue;
            var reply = await BuildReplyAsync(e, op, desk, providerId, providerName, providerVersion);
            if(closed || obs.Disconnected.IsCompleted) return;
            try {
                await obs.Call("BroadcastCustomEvent",new() { ["eventData"]=reply });
                // In-process obs-websocket plugins do not receive BroadcastCustomEvent
                // in the native event callback. The MIDI bridge has a pinned receipt endpoint.
                if (Read<string>(e,"client",out var client) && client=="midi-fadester")
                    await obs.Call("CallVendorRequest",new() { ["vendorName"]="midi-fadester", ["requestType"]="mix_reply", ["requestData"]=reply.DeepClone() });
            }
            catch(IOException) { return; }
            catch(ObsError x) { Console.Error.WriteLine("Mix response: "+x.Message); }
        }
    }
    public async ValueTask DisposeAsync() { closed=true; obs.CustomEvent-=Receive; queue.Writer.TryComplete(); await worker; }
}
