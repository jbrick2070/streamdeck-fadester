// Packaged --mix-only smoke test. No real OBS, TourBox, foreground app or keyboard input is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {WebSocketServer}=require('ws'),{spawn}=require('node:child_process');
const exe=process.argv[2];if(!exe)throw Error('Pass the packaged FadesterTourBoxBridge.exe');
const ns='io.github.jbrick2070.fadester.mix.v1', pwd=crypto.randomUUID(), salt='lab',challenge='fixture',
  hash=x=>crypto.createHash('sha256').update(x).digest('base64'), delay=ms=>new Promise(r=>setTimeout(r,ms));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fadester-mix-test-')), config=path.join(tmp,'lab.json'),input=crypto.randomUUID();
let proc,server,ws,level=0.25,writes=0,log='', replies=[],vendorReceipts=[],error;
async function wait(test){for(let i=0;i<150;i++){if(error)throw error;if(test())return;await delay(40)}throw Error('Fixture timed out: '+log)}
(async()=>{
 server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise((r,j)=>{server.once('listening',r);server.once('error',j)});
 server.on('connection',s=>{
  ws=s;const send=(op,d)=>s.send(JSON.stringify({op,d}));send(0,{rpcVersion:1,authentication:{salt,challenge}});
  s.on('message',raw=>{try {
    const {op,d}=JSON.parse(raw);
    if(op===1){assert.equal(d.authentication,hash(hash(pwd+salt)+challenge));assert.equal(d.eventSubscriptions&9,9);send(2,{negotiatedRpcVersion:1});return}
    assert.equal(op,6);let data={};const a=d.requestData;
    switch(d.requestType){
    case 'BroadcastCustomEvent':replies.push(a.eventData);send(5,{eventType:'CustomEvent',eventData:a.eventData});break;
    case 'CallVendorRequest':assert.equal(a.vendorName,'midi-fadester');assert.equal(a.requestType,'mix_reply');vendorReceipts.push(a.requestData);break;
    case 'GetSceneCollectionList':data={currentSceneCollectionName:'lab'};break;
    case 'GetInputList':data={inputs:[{inputUuid:input,inputKindCaps:2}]};break;
    case 'GetInputVolume':assert.equal(a.inputUuid,input);data={inputVolumeMul:level};break;
    case 'SetInputVolume':assert.equal(a.inputUuid,input);level=a.inputVolumeMul;writes++;break;
    default:throw Error('Unexpected RPC: '+d.requestType);
    }
    send(7,{requestId:d.requestId,requestStatus:{result:true,code:100},responseData:data});
  }catch(e){error=e}});
 });
 fs.writeFileSync(config, JSON.stringify({host:'127.0.0.1',port:server.address().port,mixEnabled:true,mixFadeMs:0}));
 const launch=()=>spawn(exe,['--mix-only','--config',config],{windowsHide:true,env:{...process.env,FADESTER_OBS_PASSWORD:pwd},stdio:['pipe','pipe','pipe']});
 proc=launch();proc.stdout.on('data',s=>log+=s);proc.stderr.on('data',s=>log+=s);await wait(()=>log.includes('Connected to OBS'));
 assert.match(log,/no controller shortcuts/i);
 const p2=launch();let err2='';p2.stderr.on('data',s=>err2+=s);await wait(()=>p2.exitCode!==null);assert.notEqual(p2.exitCode,0);assert.match(err2,/already running/i);
 function put(op,fields={}){const e={namespace:ns,id:crypto.randomUUID(),sentAtMs:Date.now(),op,...fields};ws.send(JSON.stringify({op:5,d:{eventType:'CustomEvent',eventData:e}}));return e}
 async function answer(e){await wait(()=>replies.some(r=>r.id===e.id));return replies.find(r=>r.id===e.id)}
 assert.equal((await answer(put('mix.status'))).enabled,true);assert.equal(writes,0);
 const stale=put('mix.down',{sentAtMs:Date.now()-20000});const invalid=await answer(put('mix.down',{steps:-1}));assert.equal(invalid.ok,false);
 const e=put('mix.down',{steps:2});const done=await answer(e);assert(done.ok);assert(Math.abs(done.db+6)<1e-6);assert.equal(writes,1);
 put('mix.down',e);const restored=await answer(put('mix.restore',{client:'midi-fadester'}));assert(restored.ok);assert.equal(level,0.25);
 await wait(()=>vendorReceipts.length===1);assert.deepEqual(vendorReceipts[0],restored);
 assert.equal(writes,2);assert.equal(replies.filter(r=>r.id===e.id).length,1);assert(!replies.some(r=>r.id===stale.id));
 proc.stdin.write('quit\n');await wait(()=>proc.exitCode!==null);assert.equal(proc.exitCode,0);console.log('PASS: packaged mix-only startup, single authority, authentication, status, stale and duplicate rejection, coalesced steps and independent restore.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{if(proc&&proc.exitCode===null)proc.kill();if(ws)ws.terminate();server?.close();fs.rmSync(tmp,{recursive:true,force:true})});
