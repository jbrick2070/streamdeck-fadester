// SPDX-License-Identifier: GPL-2.0-or-later
// Private-OBS fixture entry point. Compile with the shipping AudioDesk, BridgeConfig and ObsConnection.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Fadester.TourBox;

internal static class LiveAudio
{
    static async Task Main(string[] args)
    {
        int port = int.Parse(args[0]);
        string root = Path.GetFullPath(args[1]), token = args[3], input = token + " silent media";
        using var proc = Process.GetProcessById(int.Parse(args[2]));
        if (!Path.GetFileName(root).StartsWith("fadester-obs-lab-") || port < 10240 ||
            !string.Equals(proc.MainModule?.FileName, Path.Combine(root, "bin", "64bit", "obs64.exe"), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Expected the fixture's private executable and owned port.");
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));
        var cfg = new BridgeConfig { Host = "127.0.0.1", Port = port };
        using var bridge = await ObsConnection.Connect(cfg, timeout.Token);
        using var hand = await ObsConnection.Connect(cfg, timeout.Token);
        // Check both connections before either can make a change.
        foreach (var ws in new[] { bridge, hand }) {
            if ((string?)(await ws.Call("GetVersion"))["obsVersion"] != "33.0.1" ||
                (string?)(await ws.Call("GetSceneCollectionList"))["currentSceneCollectionName"] != token ||
                (await ws.Call("GetInputList"))["inputs"]!.AsArray().Count != 0 ||
                (bool?)(await ws.Call("GetStreamStatus"))["outputActive"] != false ||
                (bool?)(await ws.Call("GetRecordStatus"))["outputActive"] != false)
                throw new InvalidOperationException("Unexpected fixture collection, inputs, version or active output; no writes sent.");
        }
        using var raw = new ClientWebSocket();
        raw.Options.AddSubProtocol("obswebsocket.json");
        await raw.ConnectAsync(new Uri($"ws://127.0.0.1:{port}"), timeout.Token);
        async Task<JsonObject> Packet() {
            byte[] bytes = new byte[8192]; int used = 0; WebSocketReceiveResult frame;
            do {
                frame = await raw.ReceiveAsync(new ArraySegment<byte>(bytes, used, bytes.Length-used), timeout.Token);
                used += frame.Count;
            } while (!frame.EndOfMessage);
            return JsonNode.Parse(bytes.AsSpan(0,used))!.AsObject();
        }
        var auth = (await Packet())["d"]!["authentication"]!;
        static string Hash(string value) => Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
        var identify = new JsonObject { ["op"] = 1, ["d"] = new JsonObject { ["rpcVersion"]=1, ["eventSubscriptions"]=8,
            ["authentication"]=Hash(Hash(cfg.Password() + (string?)auth["salt"]) + (string?)auth["challenge"]) }};
        await raw.SendAsync(Encoding.UTF8.GetBytes(identify.ToJsonString()), WebSocketMessageType.Text, true, timeout.Token);
        if ((int?)(await Packet())["op"] != 2) throw new Exception("Raw event observer could not identify.");

        await hand.Call("CreateInput", new() { ["sceneName"]=token+" Blue", ["inputName"]=input,
            ["inputKind"]="ffmpeg_source", ["inputSettings"]=new JsonObject(), ["sceneItemEnabled"]=false });
        Task SetExternal(double level) => hand.Call("SetInputVolume",new(){["inputName"]=input,["inputVolumeDb"]=level});
        async Task<double> Actual() => (await hand.Call("GetInputVolume",new(){["inputName"]=input}))["inputVolumeDb"]!.GetValue<double>();
        await SetExternal(-3.12345);
        JsonObject change;
        do { change=await Packet(); } while ((string?)change["d"]?["eventType"]!="InputVolumeChanged");
        var data=change["d"]!["eventData"]!.AsObject();
        if ((int?)change["op"]!=5 || (int?)change["d"]?["eventIntent"]!=8 || (string?)data["inputName"]!=input ||
            !Guid.TryParse((string?)data["inputUuid"],out _) || (double?)data["inputVolumeMul"] is not >0) throw new Exception("Unexpected input-volume event payload.");
        double rounding=Math.Abs(data["inputVolumeDb"]!.GetValue<double>()-(-3.12345));
        if(rounding>=0.002)throw new Exception("OBS event exceeds bridge dB tolerance.");
        Console.WriteLine($"OBS {port} event op=5, InputVolumeChanged intent=8, fields {string.Join(", ", data.Select(k=>k.Key))}; observed dB error {rounding:G5}.");

        var seen=new ConcurrentQueue<double>();
        var mid=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var external=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        int writes=0;
        async Task<JsonObject> Tracked(string method,JsonObject? fields) {
            if(method=="SetInputVolume")Interlocked.Increment(ref writes);
            return await bridge.Call(method,fields);
        }
        var mixer = new AudioDesk(Tracked);
        bridge.InputVolumeChanged+=(name,level)=>{
            mixer.OnVolumeChanged(name,level);
            if(name!=input)return;
            seen.Enqueue(level);
            if(level < -4 && level > -16.5)mid.TrySetResult();
            if(Math.Abs(level+30.125)<0.002)external.TrySetResult();
        };
        await mixer.Fade(input,-18,false);
        await mid.Task.WaitAsync(timeout.Token);
        await SetExternal(-30.125);
        await external.Task.WaitAsync(timeout.Token);
        // Observe for longer than a complete real-time ramp; then try the stale restore/undo controls.
        await Task.Delay(700,timeout.Token);
        string restore=await mixer.Fade(input,-18,true),undo=await mixer.Undo();
        double after=await Actual();
        if(Math.Abs(after+30.125)>=0.002 || !restore.StartsWith("No ") || !undo.StartsWith("No ") ||
            writes==0 || seen.Any(level=>Math.Abs(level+18)<0.002))throw new Exception($"Unexpected result: {after} dB, {writes} writes, {restore}, {undo}");
        Console.WriteLine($"PASS: {writes} real ramp writes before interruption; external -30.125 dB held, observed {after:F5} dB; further restore and undo disarmed.");
        await mixer.Stop();
    }
}
