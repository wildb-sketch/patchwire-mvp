const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
// No relay is used in these loopback fixtures: literal host candidates avoid depending on CI multicast/mDNS.
let browser;
before(async()=>{ browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-features=WebRtcHideLocalIpsWithMdns','--autoplay-policy=no-user-gesture-required']}); });
after(async()=>{ await browser?.close(); });
async function setup(t) {
 const page=await browser.newPage();t.after(()=>page.close());
 // A real loopback origin avoids opaque about:blank WebRTC network restrictions.
 await page.route('http://127.0.0.1:17963/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>RTC fixture</title>'}));
 await page.goto('http://127.0.0.1:17963/');
 await page.addScriptTag({path:path.join(__dirname,'../public/room-audio.js')});
 await page.evaluate(async()=>{
  const contexts=[],tracks={},audio={},errors=[],statuses=[],trace=[];
  for(const id of ['a','b']){const ac=new AudioContext(),osc=ac.createOscillator(),out=ac.createMediaStreamDestination();osc.frequency.value=id==='a'?440:660;osc.connect(out);osc.start();await ac.resume();contexts.push(ac);tracks[id]=out.stream.getAudioTracks()[0];}
  const state=window.rtc={audio,tracks,errors,statuses,ready:true,contexts,trace};
  state.make=id=>createRoomAudio({selfId:()=>id,isMember:()=>true,getIce:()=>[],getTrack:()=>tracks[id],signalingReady:()=>state.ready,
   send:(uid,data)=>{if(!state.ready)return false;if(data.s)trace.push({id,to:uid,type:data.s.type,offerId:data.offerId,answerTo:data.answerTo});else if(data.c)trace.push({id,type:'candidate',ufrag:data.c.usernameFragment});queueMicrotask(()=>audio[uid].receive(id,JSON.parse(JSON.stringify(data))));return true},
   onStatus:(uid,status)=>statuses.push({id,uid,status}),onError:(uid,e)=>errors.push({id,uid,message:e.message})});
  audio.a=state.make('a');audio.b=state.make('b');
  audio.a.connect('b',true);audio.b.connect('a',true); // Deliberate initial offer collision.
  state.initial=[audio.a.peers.b.pc,audio.b.peers.a.pc];
  state.inbound=async()=>Promise.all([audio.a.peers.b.pc,audio.b.peers.a.pc].map(async pc=>{let bytes=0;for(const s of (await pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='audio')bytes+=s.bytesReceived||0;return bytes}));
 });
 await stable(page);await page.waitForFunction(async()=>{const values=await rtc.inbound();return values.every(n=>n>100)});
 return page;
}
async function stable(page) {
 try { await page.waitForFunction(()=>Object.values(rtc.audio).every(a=>Object.values(a.peers).every(p=>p.pc.connectionState==='connected'&&p.pc.signalingState==='stable')),{},{timeout:20000}); }
 catch(error){console.error('RTC recovery diagnostics',JSON.stringify(await page.evaluate(()=>({errors:rtc.errors,trace:rtc.trace,states:Object.values(rtc.audio).flatMap(a=>Object.values(a.peers).map(p=>({state:p.pc.connectionState,ice:p.pc.iceConnectionState,signaling:p.pc.signalingState,attempts:p.attempts,queued:p.candidates.length,gathering:p.pc.iceGatheringState,media:p.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.direction,current:t.currentDirection,stopped:t.stopped})),local:p.pc.localDescription?.sdp.match(/^(?:m=|a=ice-ufrag:|a=inactive|a=sendrecv|a=recvonly|a=sendonly).*$/gm),remote:p.pc.remoteDescription?.sdp.match(/^(?:m=|a=ice-ufrag:|a=inactive|a=sendrecv|a=recvonly|a=sendonly).*$/gm),mdns:!!p.pc.localDescription?.sdp.includes('.local')})))}))));throw error;}
}
test('real WebRTC survives simultaneous initial offers and simultaneous ICE restarts', {timeout:30000}, async t=>{
 const page=await setup(t);
 const before=await page.evaluate(async()=>{rtc.beforeUfrag=rtc.initial[0].localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1];const bytes=await rtc.inbound();rtc.audio.a.recoverAll();rtc.audio.b.recoverAll();return bytes});
 await page.waitForFunction(()=>rtc.initial[0].localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1]!==rtc.beforeUfrag);await stable(page);
 await page.waitForFunction(async before=>(await rtc.inbound()).every((n,i)=>n>before[i]+100),before);
 const result=await page.evaluate(()=>({same:[rtc.audio.a.peers.b.pc===rtc.initial[0],rtc.audio.b.peers.a.pc===rtc.initial[1]],tracks:[rtc.initial[0].getSenders()[0].track===rtc.tracks.a,rtc.initial[1].getSenders()[0].track===rtc.tracks.b],errors:rtc.errors}));
 assert.equal(await page.evaluate(()=>Object.values(rtc.audio).every(a=>Object.values(a.peers).every(p=>!p.recovering&&!p.timer))),true);
 assert.deepEqual(result.same,[true,true]);assert.deepEqual(result.tracks,[true,true]);assert.deepEqual(result.errors,[]);
});
test('real ICE recovery preserves a muted microphone without reopening capture', {timeout:30000}, async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{rtc.tracks.a.enabled=false;rtc.beforeUfrag=rtc.initial[0].localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1];rtc.audio.a.recoverAll();rtc.audio.b.recoverAll();});
 await page.waitForFunction(()=>rtc.initial[0].localDescription.sdp.match(/a=ice-ufrag:(.+)/)[1]!==rtc.beforeUfrag);await stable(page);
 assert.equal(await page.evaluate(()=>rtc.initial[0].getSenders()[0].track===rtc.tracks.a&&!rtc.tracks.a.enabled),true);
});
test('real peers recover after a signaling outage while retaining media objects', {timeout:30000}, async t=>{
 const page=await setup(t);
 await page.evaluate(()=>{rtc.ready=false;rtc.audio.a.recoverAll();rtc.audio.b.recoverAll();});
 assert.equal(await page.evaluate(()=>rtc.audio.a.peers.b.attempts+rtc.audio.b.peers.a.attempts),0);
 const before=await page.evaluate(async()=>{const bytes=await rtc.inbound();rtc.ready=true;rtc.audio.a.recoverAll();rtc.audio.b.recoverAll();return bytes});
 await stable(page);await page.waitForFunction(async before=>(await rtc.inbound()).every((n,i)=>n>before[i]+100),before);
 assert.deepEqual(await page.evaluate(()=>rtc.errors),[]);
});
test('a reopened peer renegotiates against the surviving peer without replacing its sender', {timeout:30000}, async t=>{
 const page=await setup(t);
 const before=await page.evaluate(async()=>{const bytes=await rtc.inbound();rtc.audio.a.remove('b');rtc.audio.a=rtc.make('a');rtc.audio.a.connect('b',true);return bytes[1]});
 await stable(page);
 await page.waitForFunction(async before=>{const bytes=await rtc.inbound();return bytes[0]>100&&bytes[1]>before+100},before);
 assert.equal(await page.evaluate(()=>rtc.audio.b.peers.a.pc===rtc.initial[1]&&rtc.initial[1].getSenders()[0].track===rtc.tracks.b),true);
 assert.deepEqual(await page.evaluate(()=>rtc.errors),[]);
});
