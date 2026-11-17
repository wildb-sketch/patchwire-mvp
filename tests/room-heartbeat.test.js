const {test}=require('node:test');
const assert=require('node:assert/strict');
const heartbeat=require('../public/room-heartbeat');
function setup(){let time=0,tick,stale=0;const messages=[],socket={readyState:1,send:s=>messages.push(JSON.parse(s))};const h=heartbeat({now:()=>time,setInterval:fn=>{tick=fn;return 1;},clearInterval(){},onStale:s=>{assert.equal(s,socket);stale++;}});h.start(socket);return{h,socket,messages,get stale(){return stale;},advance:ms=>{time+=ms;tick();}};}
test('two minutes of background timer suspension starts a fresh probe instead of disconnecting',()=>{
 const f=setup();f.advance(15000);f.advance(120000);assert.equal(f.stale,0);assert.equal(f.messages.length,2);f.h.message(f.socket);f.advance(15000);assert.equal(f.stale,0);
});
test('responsive socket remains alive even when only room/chat traffic arrives',()=>{
 const f=setup();for(let i=0;i<20;i++){f.advance(15000);f.h.message(f.socket);}assert.equal(f.stale,0);
});
test('a genuinely unanswered socket times out after a fresh uninterrupted probe window',()=>{
 const f=setup();for(let i=0;i<4;i++)f.advance(15000);assert.equal(f.stale,1);
});
test('events from a replaced socket cannot acknowledge the current connection',()=>{
 const f=setup();f.advance(15000);f.h.message({readyState:1});for(let i=0;i<3;i++)f.advance(15000);assert.equal(f.stale,1);
});
test('stopping heartbeat on intentional Leave cancels stale callbacks',()=>{
 const f=setup();f.advance(15000);f.h.stop();f.advance(120000);assert.equal(f.stale,0);
});
