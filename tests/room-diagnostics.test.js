const {test}=require('node:test');
const assert=require('node:assert/strict');
const diagnostics=require('../public/room-diagnostics');

test('audio diagnostics copy only permitted device and media fields, without participant or transport identities',async()=>{
 const secret='private-fixture';let copied;
 const report=diagnostics({
  nativeStatus:async()=>({audioBuild:'test',input:'phone',output:'speaker',token:secret,outputName:secret,
   platform:{model:'Note',sdk:31,serial:secret},routing:{wanted:'speaker',settled:true,address:secret,
    events:Array.from({length:70},(_,ms)=>({ms,event:'route_ready',wanted:'speaker',address:secret}))}}),
  track:()=>({readyState:'live',enabled:true,id:secret,label:secret,
   getSettings:()=>({autoGainControl:true,echoCancellation:true,deviceId:secret,groupId:secret}),
   getConstraints:()=>({autoGainControl:true,deviceId:{exact:secret}})}),
  peers:()=>Object.fromEntries(Array.from({length:10},(_,i)=>[secret+i,{uid:secret,pc:{connectionState:'connected',localDescription:{sdp:secret},
   getStats:async()=>new Map(Array.from({length:12},(_,i)=>[i,{type:'inbound-rtp',kind:'audio',packetsReceived:i,ssrc:secret,trackIdentifier:secret,remoteId:secret}]).concat([['candidate',{type:'local-candidate',address:secret}]]))}}])),
  userAgent:()=> 'test-browser',copy:async value=>{copied=value}
 });
 const result=JSON.parse(await report.copy());
 assert(!copied.includes(secret));assert.equal(result.native.routing.events.length,64);
 assert.equal(result.native.routing.events[0].ms,6);assert.equal(result.peers.length,8);assert.equal(result.peers[0].audio.length,8);
 assert.equal(result.peers[0].audio[0].packetsReceived,0);
 assert.deepEqual(result.capture.settings,{autoGainControl:true,echoCancellation:true});
 assert.deepEqual(result.capture.constraints,{autoGainControl:true});
});

test('unavailable native status or peer stats do not block copying the remaining audio evidence',async()=>{
 let writes=0;
 const report=diagnostics({nativeStatus:async()=>{throw Error('unavailable')},track:()=>null,
  peers:()=>({peer:{pc:{getStats:async()=>{throw Error('closed')}}}}),copy:async()=>{writes++}});
 const result=JSON.parse(await report.copy());
 assert.equal(writes,1);assert.equal(result.native.audioBuild,'status-unavailable');
 assert.equal(result.capture.present,false);assert.equal(result.peers[0].statsUnavailable,true);
});
