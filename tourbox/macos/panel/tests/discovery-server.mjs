// SPDX-License-Identifier: GPL-2.0-or-later
// Fake loopback server only. It never reads the real OBS configuration or launches OBS.
import {createHash, randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const require = createRequire(process.env.FADESTER_TEST_MODULE_ROOT ? `${process.env.FADESTER_TEST_MODULE_ROOT}/package.json` : import.meta.url);
const {WebSocketServer} = require('ws');
const binary = process.argv[2];
assert(binary, 'Pass the newly compiled panel executable');
const password=randomUUID(), salt='synthetic-salt', challenge='synthetic-challenge';
const secret=createHash('sha256').update(password+salt).digest('base64');
const proof=createHash('sha256').update(secret+challenge).digest('base64');
const server=new WebSocketServer({host:'127.0.0.1',port:0});
await once(server,'listening');
const calls=[];
server.on('connection', socket=>{
  socket.send(JSON.stringify({op:0,d:{rpcVersion:1,authentication:{salt,challenge}}}));
  socket.on('message',(raw,isBinary)=>{
    assert.equal(isBinary,false,'OBS JSON requests must use text frames');
    const message=JSON.parse(raw);
    if(message.op===1) { assert.equal(message.d.authentication,proof); assert.equal(message.d.eventSubscriptions,0);socket.send(JSON.stringify({op:2,d:{negotiatedRpcVersion:1}}));return; }
    assert.equal(message.op,6);const {requestType,requestId,requestData={}}=message.d; calls.push(requestType);
    let responseData={}, code=100, result=true;
    switch(requestType){
      case 'GetSceneList': responseData={currentProgramSceneName:'Opening',currentPreviewSceneName:'Guest',scenes:[{sceneName:'Guest',sceneIndex:0},{sceneName:'Opening',sceneIndex:1}]};break;
      case 'GetStudioModeEnabled':responseData={studioModeEnabled:true};break;
      case 'GetInputList':responseData={inputs:[{inputName:'Music • 音楽',inputKind:'ffmpeg_source'},{inputName:'Color',inputKind:'color_source_v3'},{inputName:'Clips',inputKind:'vlc_source'}]};break;
      case 'GetSceneItemList':responseData={sceneItems:requestData.sceneName==='Guest'?[{sourceName:'Lower third'}]:[]};break;
      case 'GetInputVolume':if(requestData.inputName==='Music • 音楽')responseData={inputVolumeDb:-12};else{code=605;result=false;}break;
      case 'GetMediaInputStatus':responseData={mediaState:requestData.inputName==='Clips'?'OBS_MEDIA_STATE_PAUSED':'OBS_MEDIA_STATE_NONE'};break;
      // The one vendor read: Visual Sidechain's meter, as the Windows catalog reads it.
      case 'CallVendorRequest':assert.equal(requestData.vendorName,'visual-sidechain');assert.equal(requestData.requestType,'get_signals');responseData={vendorName:'visual-sidechain',requestType:'get_signals',responseData:{bpm:128,bpm_locked:true,beat_index:2,audio_present:true,sub_bass:1,bass:0.5,mid:0,high:0.25}};break;
      default:throw Error('Discovery attempted a request outside its read-only vocabulary: '+requestType);
    }
    // Keep the music input generic for this fixture: only Clips is a media role.
    if(requestType==='GetInputList') responseData.inputs[0].inputKind='wasapi_input_capture';
    socket.send(JSON.stringify({op:7,d:{requestType,requestId,requestStatus:{result,code},responseData}}));
  });
});
const child=spawn(binary,['--self-test-discovery',String(server.address().port)],{env:{...process.env,FADESTER_TEST_PASSWORD:password},stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
const timer=setTimeout(()=>child.kill('SIGKILL'),15000);
try{
  const [code]=await once(child,'exit'); assert.equal(code,0,output);
  assert.equal(calls.length,12);assert(calls.every(name=>name.startsWith('Get')||name==='CallVendorRequest'));
  process.stdout.write(output);console.log('PASS: 12 authenticated discovery requests, all read-only (11 Get requests and Visual Sidechain get_signals); no installed OBS accessed.');
}finally{clearTimeout(timer);for(const socket of server.clients)socket.terminate();server.close();}
