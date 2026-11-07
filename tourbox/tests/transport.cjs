// End-to-end Windows smoke: native listener + authenticated WebSocket + live action state.
// Needs Node and the root repo's dev dependency ws. Never sends an input to the user's desktop or OBS.
const assert=require('node:assert/strict'), fs=require('node:fs'), os=require('node:os'), path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{WebSocketServer}=require('ws');
const executable=process.argv[2]; if(!executable)throw Error('usage: node transport.cjs /path/to/FadesterTourBoxBridge.exe');
const repo=path.resolve(__dirname,'..'), mapFile=path.join(repo,'presets','map.json');
const bindings=new Map(); for(const bank of Object.values(JSON.parse(fs.readFileSync(mapFile)).presets))for(const row of [...bank.bindings,...(bank.menuBindings||[])])if(row.hotkey)bindings.set(row.hotkey,row.action);
const ids=new Map([...bindings.values()].map((v,i)=>[v,i+1]));
const state={studio:true,preview:'Rehearsal',program:'Camera',music:-6,mute:false}, calls=[];
const ports=[], children=[]; const password=crypto.randomBytes(27).toString('hex'), salt='fixture-salt', challenge='fixture-challenge';
const hash=s=>crypto.createHash('sha256').update(s).digest('base64'), auth=hash(hash(password+salt)+challenge);
const delay=ms=>new Promise(r=>setTimeout(r,ms)); async function until(fn,msg){for(let i=0;i<180;i++){if(fn())return;await delay(50)}throw Error(msg)}
function rpc(type,a){
  calls.push(type);
  switch(type){
    case 'GetVersion':return {obsVersion:'33.0.1',obsWebSocketVersion:'5.6.3'};
    case 'GetStudioModeEnabled':return {studioModeEnabled:state.studio};
    case 'GetSceneList':return {currentProgramSceneName:state.program,currentPreviewSceneName:state.preview,scenes:[{sceneIndex:0,sceneName:'Rehearsal'},{sceneIndex:1,sceneName:'Camera'}]};
    case 'GetCurrentProgramScene':return {currentProgramSceneName:state.program,sceneName:state.program};
    case 'GetCurrentPreviewScene':return {currentPreviewSceneName:state.preview,sceneName:state.preview};
    case 'GetInputVolume':assert.equal(a.inputName,'Music');return {inputVolumeDb:state.music};
    case 'SetInputVolume':assert.equal(a.inputName,'Music');state.music=a.inputVolumeDb;return {};
    case 'SetCurrentPreviewScene':assert(state.studio);state.preview=a.sceneName;return {};
    case 'SetInputMute':assert.equal(a.inputName,'Mic');state.mute=a.inputMuted;return {};
    default:throw Error('Unexpected test request '+type);
  }
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'tourbox-protocol-')); let proc,server,protocolError;
(async()=>{
 server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise((r,j)=>{server.once('listening',r);server.once('error',j)});
 let authCount=0;server.on('connection',ws=>{
  const send=(op,d)=>ws.send(JSON.stringify({op,d})); send(0,{obsWebSocketVersion:'5.6.3',rpcVersion:1,authentication:{salt,challenge}});
  ws.on('message',data=>{const {op,d}=JSON.parse(data);
    if(op===1){if(d.authentication!==auth){ws.close(4009,'Authentication failed');return;}++authCount;send(2,{negotiatedRpcVersion:1});return;}
    if(op!==6){protocolError=Error('Invalid op '+op);return;}
    try{send(7,{requestType:d.requestType,requestId:d.requestId,requestStatus:{result:true,code:100},responseData:rpc(d.requestType,d.requestData||{})})}
    catch(e){protocolError=e;send(7,{requestType:d.requestType,requestId:d.requestId,requestStatus:{result:false,code:500,comment:e.message}})}
  });
 });
 const config=path.join(temp,'isolated.json');fs.writeFileSync(config,JSON.stringify({host:'127.0.0.1',port:server.address().port,musicInput:'Music',micInput:'Mic',anchors:['Camera','','','']}));
 proc=spawn(executable,['--listen','--config',config,'--map',mapFile],{windowsHide:true,env:{...process.env,FADESTER_OBS_PASSWORD:password},stdio:['pipe','pipe','pipe']});let log='',exited=false;
 proc.stdout.on('data',s=>log+=s);proc.stderr.on('data',s=>log+=s); proc.on('exit',()=>exited=true);
 await until(()=>log.includes('Connected to OBS')||exited,'bridge did not connect: '+log);assert(!exited,log); assert.equal(authCount,1);
 async function post(action,done){
  assert(ids.has(action),action);
  await new Promise((r,j)=>{const p=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'message-to-bridge.ps1'),'-BridgePid',String(proc.pid),'-Ids',String(ids.get(action))],{windowsHide:true});let err='';p.stderr.on('data',s=>err+=s);p.on('error',j);p.on('exit',c=>c===0?r():j(Error(err||'post failed')))});
  await until(()=>done()||protocolError||exited,'no action: '+action+' '+log);if(protocolError)throw protocolError;assert(!exited,log);
 }
 await post('music.fineUp',()=>state.music===-5.75);
 await post('music.down',()=>state.music===-6.75);
 await post('music.duck',()=>state.music===-12);
 await post('music.restore',()=>state.music===-6.75);
 await post('anchor.1',()=>state.preview==='Camera');
 assert.equal(state.program,'Camera');
 await post('mic.mute',()=>state.mute);
 state.studio=false;const mutations=calls.filter(x=>x==='SetCurrentPreviewScene').length;
 await post('preview.next',()=>/enable studio|requires studio|studio mode.*(off|required)|turn on studio/i.test(log));
 assert.equal(calls.filter(x=>x==='SetCurrentPreviewScene').length,mutations);assert(!calls.includes('SetCurrentProgramScene'));
 proc.stdin.write('quit\n');await until(()=>exited,'bridge did not release its hotkeys');assert.equal(proc.exitCode,0,log);
 assert(!log.includes(password));console.log('PASS: packaged Windows hotkey listener, authenticated OBS protocol, fine and coarse volume, duck/restore, mute, scene cue, Studio-off guard, clean shutdown.');
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{if(proc&&!proc.exitCode&&proc.exitCode!==0)proc.kill();if(server){for(const ws of server.clients)ws.terminate(); server.close();} fs.rmSync(temp,{recursive:true,force:true})});
