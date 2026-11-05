// SPDX-License-Identifier: GPL-2.0-or-later
// Real CustomEvent producer, independent OBS observer, and the shipping provider in a disposable OBS.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Fadester.TourBox;

internal static class LiveMix
{
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static void Tone(string file, int hz) {
        using var wav = new BinaryWriter(File.Create(file));
        const int rate = 48000, samples = rate * 45, size = samples * 2;
        void Text(string s) => wav.Write(Encoding.ASCII.GetBytes(s));
        Text("RIFF");wav.Write(size+36);Text("WAVE");Text("fmt ");wav.Write(16);wav.Write((short)1);wav.Write((short)1);
        wav.Write(rate);wav.Write(rate*2);wav.Write((short)2);wav.Write((short)16);Text("data");wav.Write(size);
        for(int i=0;i<samples;i++) wav.Write((short)Math.Round(Math.Sin(i*2*Math.PI*hz/rate)*4096));
    }
    static async Task Main(string[] args) {
        int port=int.Parse(args[0]);string root=Path.GetFullPath(args[1]),token=args[3];
        using var process=Process.GetProcessById(int.Parse(args[2]));
        Check(Path.GetFileName(root).StartsWith("fadester-obs-lab-") && port>=10240 &&
            string.Equals(process.MainModule?.FileName,Path.Combine(root,"bin","64bit","obs64.exe"),StringComparison.OrdinalIgnoreCase),"Unexpected fixture.");
        using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(65));
        var cfg=new BridgeConfig{Host="127.0.0.1",Port=port,MixEnabled=true,MixStepDb=3,MixFadeMs=300,MixStateDirectory=Path.Combine(root,"private-mix-state")};
        using var ws=await ObsConnection.Connect(cfg,timeout.Token);
        using var producer=await ObsConnection.Connect(cfg,timeout.Token);
        using var observer=await ObsConnection.Connect(cfg,timeout.Token);
        foreach(var connection in new[]{ws,producer,observer}){
            Check((string?)(await connection.Call("GetVersion"))["obsVersion"]=="33.0.1" &&
                (string?)(await connection.Call("GetSceneCollectionList"))["currentSceneCollectionName"]==token &&
                (await connection.Call("GetInputList"))["inputs"]!.AsArray().Count==0 &&
                (bool?)(await connection.Call("GetStreamStatus"))["outputActive"]==false &&
                (bool?)(await connection.Call("GetRecordStatus"))["outputActive"]==false,"Unexpected OBS, preexisting inputs or running outputs.");
        }
        string scene=token+" Blue";
        await observer.Call("SetStudioModeEnabled",new(){["studioModeEnabled"]=false});
        await observer.Call("SetCurrentProgramScene",new(){["sceneName"]=scene});
        string privateRecords=Path.Combine(root,"recordings");
        string directory=(await observer.Call("GetRecordDirectory"))["recordDirectory"]!.GetValue<string>();
        Check(string.Equals(Path.GetFullPath(directory).TrimEnd(Path.DirectorySeparatorChar),privateRecords,StringComparison.OrdinalIgnoreCase),"Refusing to record outside private fixture directory.");
        async Task<string> Source(string label,int hz,bool play=true){
            string file=Path.Combine(root,label+".wav");Tone(file,hz);
            var r=await observer.Call("CreateInput",new(){["sceneName"]=scene,["inputName"]=token+" "+label,["inputKind"]="ffmpeg_source",["sceneItemEnabled"]=play,
                ["inputSettings"]=new JsonObject{["is_local_file"]=true,["local_file"]=file,["looping"]=true,["restart_on_activate"]=true}});
            string uuid=(string)r["inputUuid"]!;
            Check((string?)(await observer.Call("GetInputAudioMonitorType",new(){["inputUuid"]=uuid}))["monitorType"]=="OBS_MONITORING_TYPE_NONE","Private test sources must not be locally monitored.");
            return uuid;
        }
        Task<JsonObject> Level(string id,double value)=>observer.Call("SetInputVolume",new(){["inputUuid"]=id,["inputVolumeMul"]=value});
        async Task<double> Read(string id)=>(await observer.Call("GetInputVolume",new(){["inputUuid"]=id}))["inputVolumeMul"]!.GetValue<double>();
        async Task Until(Func<Task<bool>> condition,string why){for(int n=0;n<80;n++){if(await condition())return;await Task.Delay(40);}throw new Exception(why);}
        string a=await Source("low",440),b=await Source("high",880),spare=await Source("muted",1320,false);
        await Level(a,0.75);await Level(b,0.5);await Level(spare,0.33);
        foreach (var src in new[]{a,b}) {
            await observer.Call("SetInputMute",new(){["inputUuid"]=src,["inputMuted"]=false});
            await observer.Call("TriggerMediaInputAction",new(){["inputUuid"]=src,["mediaAction"]="OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"});
            for (int i=0;i<30;i++){
                if((string?)(await observer.Call("GetMediaInputStatus",new(){["inputUuid"]=src}))["mediaState"]=="OBS_MEDIA_STATE_PLAYING")break;
                await Task.Delay(100);
            }
            var media=await observer.Call("GetMediaInputStatus",new(){["inputUuid"]=src});
            var routed=await observer.Call("GetInputAudioTracks",new(){["inputUuid"]=src});
            var active=await observer.Call("GetSourceActive",new(){["sourceUuid"]=src});
            Console.WriteLine($"Tone {src}: media {media["mediaState"]}, track1 {routed["inputAudioTracks"]?["1"]}, active {active["videoActive"]}.");
        }
        await observer.Call("SetInputMute",new(){["inputUuid"]=spare,["inputMuted"]=true});
        var tracks=new JsonObject();for(int n=1;n<=6;n++)tracks[n.ToString()]=n==2;
        await observer.Call("SetInputAudioTracks",new(){["inputUuid"]=spare,["inputAudioTracks"]=tracks});
        var video=await observer.Call("CreateInput",new(){["sceneName"]=scene,["inputName"]=token+" visual",["inputKind"]="color_source_v3",["inputSettings"]=new JsonObject(),["sceneItemEnabled"]=false});
        var desk=new DeskActions(cfg,ws.Call);ws.InputLevelChangedById+=desk.OnMixInputLevelChanged;desk.StartMixMonitor();
        await using var server=new MixProtocolServer(ws,desk);
        var pending=new ConcurrentDictionary<string,TaskCompletionSource<JsonObject>>();
        producer.CustomEvent+=msg=>{if((string?)msg["op"]=="reply" && msg["id"]?.GetValue<string>() is string id && pending.TryGetValue(id,out var t))t.TrySetResult(msg);};
        async Task<JsonObject> Send(string op,JsonObject? extra=null) {
            var req=extra??new();string id=Guid.NewGuid().ToString();req["op"]=op;req["id"]=id;req["namespace"]=MixProtocolServer.Scope;req["sentAtMs"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var completion=new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);pending[id]=completion;
            try{await producer.Call("BroadcastCustomEvent",new(){["eventData"]=req});var reply=await completion.Task.WaitAsync(TimeSpan.FromSeconds(6));
                Check((bool?)reply["ok"]==true,"Mix provider refused "+op+": "+reply["message"]);return reply;}
            finally{pending.TryRemove(id,out _);}
        }
        var samples=new Dictionary<string,string>();bool recording=false;
        async Task Marker(string label){
            // The source gain is held constant before, during and after this independent file.
            // Keeping separate recordings avoids interpreting video-clock marker offsets as audio samples.
            await Task.Delay(1300);
            await observer.Call("StartRecord");recording=true;
            for(int i=0;i<110;i++){
                if((await observer.Call("GetRecordStatus"))["outputDuration"]!.GetValue<long>()>=3300)break;
                await Task.Delay(50);
            }
            var result=await observer.Call("StopRecord"); recording=false;
            string file=(string)result["outputPath"]!;
            Check(Path.GetDirectoryName(Path.GetFullPath(file))==privateRecords && !samples.Values.Contains(file),"Unexpected/reused private output file.");
            samples[label]=file;
            await Until(async()=>!(await observer.Call("GetRecordStatus"))["outputActive"]!.GetValue<bool>(),"Private output did not stop");
        }
        try {
            var initial=await Send("mix.status");Check((bool?)initial["enabled"]==true,"Mix provider not enabled.");
            await Marker("baseline");
            var half=await Send("mix.set",new(){["db"]=-6.020599913279624,["durationMs"]=0});
            Check((int?)half["managed"]==3 && Math.Abs(await Read(a)-.375)<1e-5 && Math.Abs(await Read(b)-.25)<1e-5,"Two-tone half gain or source membership differs.");
            await Marker("half");
            await Send("mix.fadeOut");await Until(async()=>await Read(a)==0 && await Read(b)==0,"Fade did not reach true silence.");await Marker("silent");
            string late=await Source("late",1760,false);
            await Until(async()=>await Read(late)==0,"Newly added source missed full silence.");
            await observer.Call("SetInputName",new(){["inputUuid"]=a,["newInputName"]=token+" renamed"});
            await Level(spare,.19); // explicit mixer-owner edit, including a muted track-2-only source
            await Send("mix.restore");await Until(async()=>Math.Abs(await Read(a)-.75)<1e-5&&Math.Abs(await Read(b)-.5)<1e-5,"Recovered UUID levels differ.");
            Check(Math.Abs(await Read(late)-1)<1e-5 && Math.Abs(await Read(spare)-.19)<1e-5,"Late/external source restoration incorrect.");
            Check((bool?)(await observer.Call("GetInputMute",new(){["inputUuid"]=spare}))["inputMuted"]==true &&
                JsonNode.DeepEquals((await observer.Call("GetInputAudioTracks",new(){["inputUuid"]=spare}))["inputAudioTracks"],tracks),"Mute or track routing changed.");
            await Marker("restored");
            File.WriteAllText(Path.Combine(root,"mix-markers.json"),JsonSerializer.Serialize(samples));
            Console.WriteLine("PASS: independent authenticated CustomEvent replies; two 2:3 starting levels both halved, genuine zero, new input joined silence, renamed input restored by UUID. Muted track-2 source retained operator edit and routing.");
            if (Environment.GetEnvironmentVariable("FADESTER_FIXTURE_TEST_MIDI")=="1") {
                async Task<JsonObject> Vendor(string method, JsonObject? data = null) {
                    var answer = (await observer.Call("CallVendorRequest",new(){["vendorName"]="midi-fadester",["requestType"]=method,["requestData"]=data??new JsonObject()}))["responseData"]!.AsObject();
                    Check(!answer.ContainsKey("error"),"Private MIDI vendor refused "+method+": "+answer["comment"]);
                    return answer;
                }
                async Task<string> MasterDisplay() => (string)(await Vendor("get_state"))["slots"]!.AsArray()
                    .Single(x=>(string?)x!["id"]=="master")!["display_value"]!;
                var current = await Vendor("get_state");
                Check((bool?)current["device"]?["connected"]==false,"Refusing to assign controls with a real MIDI device open.");
                await Vendor("set_slot",new(){["slot"]="master",["enabled"]=true,["target_mode"]="mix_master"});
                var sent = new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
                void ObserveMidi(JsonObject e){
                    if((string?)e["client"]=="midi-fadester" && (string?)e["op"]=="mix.set" && (string?)e["namespace"]==MixProtocolServer.Scope)
                        sent.TrySetResult(e.DeepClone().AsObject());
                }
                producer.CustomEvent+=ObserveMidi;
                try {
                    await Vendor("set_fader_value",new(){["slot"]="master",["value"]=0.5});
                    var request=await sent.Task.WaitAsync(TimeSpan.FromSeconds(4));
                    await Until(async()=> (await MasterDisplay()).StartsWith("Confirmed",StringComparison.Ordinal),"MIDI master did not confirm its real vendor receipt; last state: "+await MasterDisplay());
                    Check(Math.Abs(await Read(a)-.75*.125)<1e-5 && Math.Abs(await Read(b)-.5*.125)<1e-5,"MIDI gain did not reach both sources.");
                    string level=await MasterDisplay();
                    var repeated=await Vendor("mix_reply",new(){["namespace"]=MixProtocolServer.Scope,["id"]=request["id"]!.DeepClone(),["op"]="reply",["ok"]=true,["enabled"]=true,["db"]=-18.0618});
                    Check((bool?)repeated["accepted"]==false,"MIDI accepted an already-consumed receipt.");
                    await Vendor("set_fader_value",new(){["slot"]="master",["value"]=1.0});
                    await Until(async()=>Math.Abs(await Read(a)-.75)<1e-5 && (await MasterDisplay()).StartsWith("Confirmed"),"MIDI unity restore did not confirm.");
                    cfg.MixEnabled=false;
                    await Vendor("set_fader_value",new(){["slot"]="master",["value"]=0.75});
                    await Until(async()=>(await MasterDisplay()).StartsWith("Declined"),"Unarmed request did not report Declined.");
                    Check(Math.Abs(await Read(a)-.75)<1e-5 && Math.Abs(await Read(b)-.5)<1e-5,"Disarmed MIDI control changed volume.");
                    Console.WriteLine($"PASS: real MIDI vendor at virtual fader 0.5: {level}; two inputs ×0.125, duplicate rejected, unity restored, disabled request declined. Physical MIDI device closed.");
                } finally { producer.CustomEvent-=ObserveMidi; cfg.MixEnabled=true; }
            }
        } finally { if(recording)await observer.Call("StopRecord");await desk.StopMixAsync(); }
    }
}
