const { test } = require('node:test');
const assert = require('node:assert/strict');
const createRoomAudio = require('../public/room-audio');
const tick = () => new Promise(resolve => setImmediate(resolve));
class FakePeer {
 constructor() { this.signalingState='stable'; this.connectionState='new'; this.iceConnectionState='new'; this.offers=[]; this.candidates=[]; this.rollbacks=0; }
 addTransceiver() { this.sender={track:null,replaceTrack:async track=>{this.sender.track=track;}}; return this.transceiver={sender:this.sender,receiver:{track:{kind:'audio'}}}; }
 getTransceivers() { return [this.transceiver]; }
 setConfiguration(config) { this.config=config; }
 async createOffer(options) { this.offers.push(options); return {type:'offer',sdp:'a=ice-ufrag:local'+this.offers.length+'\r\n'}; }
 async createAnswer() { return {type:'answer',sdp:'a=ice-ufrag:answer\r\n'}; }
 async setLocalDescription(s) { if(s.type==='rollback'){this.rollbacks++;this.signalingState='stable';return;} this.localDescription=s;this.signalingState=s.type==='offer'?'have-local-offer':'stable'; }
 async setRemoteDescription(s) { this.remoteDescription=s;this.signalingState=s.type==='offer'?'have-remote-offer':'stable'; }
 async addIceCandidate(c) { this.candidates.push(c); }
 close() { this.closed=true; }
}
function fixture(self='a',other='b') {
 const sent=[],statuses=[],timers=new Map(),track={enabled:false}; let next=0,ready=true,member=true,refreshes=0;
 const audio=createRoomAudio({selfId:()=>self,isMember:()=>member,getIce:()=>[],refreshIce:async()=>{refreshes++;return [{urls:'turn:configured.example'}];},getTrack:()=>track,signalingReady:()=>ready,
  send:(uid,d)=>{sent.push(d);return ready;},onStatus:(u,s)=>statuses.push(s),PeerConnection:FakePeer,
  setTimeout:(fn,delay)=>{timers.set(++next,{fn,delay});return next;},clearTimeout:id=>timers.delete(id)});
 return {audio,sent,statuses,timers,track,other,setReady:v=>{ready=v;},setMember:v=>{member=v;},get refreshes(){return refreshes;},
  settle:async()=>{for(let i=0;i<4;i++)await tick();},
  fire:async()=>{const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();for(let i=0;i<4;i++)await tick();}};
}
test('initial offer attaches the existing muted track before SDP is created',async()=>{
 const f=fixture();const p=f.audio.connect('b',true);await f.settle();assert.equal(p.pc.sender.track,f.track);assert.equal(f.track.enabled,false);assert.equal(f.sent[0].s.type,'offer');assert(f.sent[0].offerId);
});
test('failed media restarts ICE on the same peer and retains microphone/mute',async()=>{
 const f=fixture(),p=f.audio.connect('b',true);await f.settle();
 p.pc.connectionState='failed';p.pc.onconnectionstatechange();await f.settle();
 assert.equal(f.audio.peers.b,p);assert.equal(p.pc.offers.at(-1).iceRestart,true);assert.equal(p.pc.sender.track,f.track);assert.equal(f.track.enabled,false);assert.equal(f.refreshes,1);
 await f.audio.receive('b',{s:{type:'answer',sdp:'a=ice-ufrag:remote\r\n'},answerTo:f.sent.at(-1).offerId});
 p.pc.connectionState='connected';p.pc.iceConnectionState='completed';p.pc.oniceconnectionstatechange();
 assert.deepEqual(f.statuses,['reconnecting','recovered']);assert.equal(f.timers.size,0);
});
test('polite peer rolls back glare and answers without destroying the sender',async()=>{
 const f=fixture('b','a'),p=f.audio.connect('a',true);await f.settle();
 await f.audio.receive('a',{s:{type:'offer',sdp:'a=ice-ufrag:remote\r\n'},offerId:'remote:1'});
 assert.equal(p.pc.rollbacks,1);assert.equal(f.audio.peers.a,p);assert.equal(p.pc.sender.track,f.track);assert.equal(f.sent.at(-1).answerTo,'remote:1');
});
test('impolite peer keeps its offer during glare, then accepts the matching answer',async()=>{
 const f=fixture(),p=f.audio.connect('b',true);await f.settle();const id=f.sent[0].offerId;
 await f.audio.receive('b',{s:{type:'offer',sdp:'a=ice-ufrag:ignored\r\n'},offerId:'b:1'});
 assert.equal(p.pc.rollbacks,0);assert.equal(p.pc.remoteDescription,undefined);
 await f.audio.receive('b',{s:{type:'answer',sdp:'a=ice-ufrag:accepted\r\n'},answerTo:id});assert.equal(p.pc.signalingState,'stable');
});
test('late answers to an old ICE restart cannot overwrite the current offer',async()=>{
 const f=fixture(),p=f.audio.connect('b',true);await f.settle();const old=f.sent[0].offerId;f.audio.recoverAll();await f.settle();
 await f.audio.receive('b',{s:{type:'answer',sdp:'a=ice-ufrag:stale\r\n'},answerTo:old});assert.equal(p.pc.remoteDescription,undefined);
});
test('ICE arriving before SDP is queued; stale candidates are not applied',async()=>{
 const f=fixture();await f.audio.receive('b',{c:{usernameFragment:'remote'}});const p=f.audio.peers.b;assert.equal(p.pc.candidates.length,0);
 await f.audio.receive('b',{s:{type:'offer',sdp:'a=ice-ufrag:remote\r\n'}});assert.equal(p.pc.candidates.length,1);
 await f.audio.receive('b',{c:{usernameFragment:'stale'}});assert.equal(p.pc.candidates.length,1);
});
test('offline signaling does not consume ICE retries and resume restarts media',async()=>{
 const f=fixture(),p=f.audio.connect('b');f.setReady(false);f.audio.recoverAll();await f.settle();assert.equal(p.attempts,0);assert.equal(p.pc.offers.length,0);
 f.setReady(true);await f.fire();assert.equal(p.attempts,1);assert.equal(p.pc.offers[0].iceRestart,true);
});
test('retry watchdog is bounded, manual retry works, and Leave cancels recovery',async()=>{
 const f=fixture(),p=f.audio.connect('b');f.audio.recoverAll();await f.settle();
 await f.fire();await f.fire();await f.fire();assert.equal(p.attempts,3);assert.equal(f.statuses.at(-1),'failed');assert.equal(f.timers.size,0);
 f.audio.retry('b');await f.settle();assert.equal(p.attempts,1);f.audio.remove('b');assert(p.pc.closed);assert.equal(f.timers.size,0);assert.equal(f.track.enabled,false);
});
test('a renegotiation offer reuses an already connected RTCPeerConnection',async()=>{
 const f=fixture(),p=f.audio.connect('b');p.pc.remoteDescription={type:'answer',sdp:'a=ice-ufrag:old\r\n'};
 await f.audio.receive('b',{s:{type:'offer',sdp:'a=ice-ufrag:new\r\n'},offerId:'b:next'});
 assert.equal(f.audio.peers.b,p);assert.equal(p.pc.closed,undefined);assert.equal(p.pc.sender.track,f.track);
});
test('signaling from a nonmember cannot create a peer or restart timers',async()=>{
 const f=fixture();f.setMember(false);await f.audio.receive('b',{s:{type:'offer',sdp:''}});assert.equal(Object.keys(f.audio.peers).length,0);assert.equal(f.timers.size,0);
});

test('a successful restart clears its watchdog even if the browser stayed connected',async()=>{
 const f=fixture(),p=f.audio.connect('b');p.pc.connectionState='connected';p.pc.iceConnectionState='completed';
 f.audio.recoverAll();await f.settle();await f.audio.receive('b',{s:{type:'answer',sdp:'a=ice-ufrag:current\r\n'},answerTo:f.sent.at(-1).offerId});
 assert.equal(p.recovering,false);assert.equal(f.timers.size,0);assert.equal(p.attempts,0);
});
test('new ICE candidates arriving before restart SDP survive the previous ICE generation',async()=>{
 const f=fixture(),p=f.audio.connect('b');p.pc.remoteDescription={type:'answer',sdp:'a=ice-ufrag:old\r\n'};
 await f.audio.receive('b',{c:{usernameFragment:'next'}});assert.equal(p.candidates.length,1);
 await f.audio.receive('b',{s:{type:'offer',sdp:'a=ice-ufrag:next\r\n'}});assert.equal(p.pc.candidates.at(-1).usernameFragment,'next');
});

test('a dropped initial offer automatically starts a fresh ICE negotiation',async()=>{
 const f=fixture(),p=f.audio.connect('b',true);await f.settle();const first=f.sent[0].offerId;
 await f.fire();assert.equal(p.pc.offers.at(-1).iceRestart,true);assert.notEqual(f.sent.at(-1).offerId,first);assert.equal(p.pc.sender.track,f.track);
});
test('rollback may reuse ICE credentials: buffered candidates for the accepted answer are retained',async()=>{
 const f=fixture(),p=f.audio.connect('b',true);await f.settle();const id=f.sent[0].offerId;
 await f.audio.receive('b',{s:{type:'offer',sdp:'a=ice-ufrag:reused\r\n'},offerId:'b:old'});
 await f.audio.receive('b',{c:{usernameFragment:'reused'}});
 await f.audio.receive('b',{s:{type:'answer',sdp:'a=ice-ufrag:reused\r\n'},answerTo:id});
 assert.equal(p.pc.candidates.length,1);assert.equal(p.ignoreOffer,false);
});

test('leaving during asynchronous SDP setup cannot send an old room offer',async()=>{
 const f=fixture(),p=f.audio.connect('b');let finish,started=false;
 const original=p.pc.setLocalDescription.bind(p.pc);
 p.pc.setLocalDescription=async s=>{await original(s);started=true;await new Promise(resolve=>{finish=resolve})};
 f.audio.recoverAll();while(!started)await tick();f.audio.remove('b');finish();await f.settle();
 assert.equal(f.sent.length,0);assert.equal(f.timers.size,0);
});
