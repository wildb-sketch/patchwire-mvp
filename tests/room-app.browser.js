const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net');
test('both complete app designs retain microphone, mute, chat and room across network recovery', {timeout:45000}, async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'whassabi-app-'));
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 const base=`http://127.0.0.1:${port}`;
 const server=spawn(process.execPath,[path.join(__dirname,'../server.js')],{env:{...process.env,PORT:String(port),DATA_FILE:path.join(dir,'data.json')},stdio:['ignore','pipe','pipe']});
 let browser;
 t.after(async()=>{await browser?.close();server.kill();await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));fs.rmSync(dir,{recursive:true,force:true})});
 await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject)});
 browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-features=WebRtcHideLocalIpsWithMdns','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const errors=[],pages=[];
 for(const [nick,route] of [['host','/neon'],['guest','/']]){
  const r=await fetch(base+'/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nick,email:nick+'@example.test',password:'test-voice-password'})});const account=await r.json();assert(account.token);
  const context=await browser.newContext();await context.grantPermissions(['microphone'],{origin:base});
  await context.addInitScript(token=>localStorage.setItem('pw_tok',token),account.token);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+route);
  await page.waitForFunction(()=>typeof ws!=='undefined'&&ws?.readyState===1&&S.me);pages.push(page);
 }
 const [host,guest]=pages;
 await host.evaluate(()=>wsSend({type:'room:create',title:'Network recovery test'}));await host.waitForFunction(()=>S.room&&R.mic);
 const roomId=await host.evaluate(()=>S.room.id);
 await guest.evaluate(id=>wsSend({type:'room:join',id}),roomId);await guest.waitForFunction(()=>S.room);
 await guest.evaluate(()=>wsSend({type:'room:hand',on:true}));
 const guestId=await guest.evaluate(()=>S.me.id);
 await host.waitForFunction(id=>S.room.members.some(m=>m.uid===id&&m.hand),guestId);
 await host.evaluate(id=>wsSend({type:'room:role',uid:id,role:'speaker'}),guestId);await guest.waitForFunction(()=>R.mic);
 await guest.waitForFunction(()=>Object.values(R.peers).some(p=>p.pc.connectionState==='connected'));
 const before=await guest.evaluate(()=>({track:R.mic.id,room:S.room.id,leaveToken:S.roomLeaveToken}));
 await guest.evaluate(()=>{setMute(true);networkChanged()});
 await guest.waitForFunction(old=>S.roomLeaveToken!==old&&Object.values(R.peers).some(p=>p.pc.connectionState==='connected'&&p.pc.signalingState==='stable'),before.leaveToken);
 assert.deepEqual(await guest.evaluate(()=>({track:R.mic.id,room:S.room.id,muted:S.muted,enabled:R.mic.enabled})),{track:before.track,room:before.room,muted:true,enabled:false});
 await guest.evaluate(()=>wsSend({type:'room:chat',t:'chat survived handover'}));
 await host.waitForFunction(()=>S.chat.some(m=>m.t==='chat survived handover'));
 await guest.evaluate(()=>setMute(false));await guest.waitForFunction(()=>R.mic.enabled&&!S.muted);
 // Simulate native headset confirmations with real Chromium captures and established RTP senders.
 // This exercises replacement media, not an actual Bluetooth radio or Android audio driver.
 const hostId=await host.evaluate(()=>S.me.id),original=await guest.evaluate(id=>{
  window.routePeer=R.peers[id].pc;window.routeSender=window.routePeer.getTransceivers().find(t=>t.sender.track?.kind==='audio').sender;
  window.nativeRoute={managed:true,generation:0,route:'speaker'};
  window.Capacitor={getPlatform:()=>'android',addListener:(plugin,event,fn)=>{if(plugin==='RoomPlugin'&&event==='roomAction')window.routeAction=fn;return Promise.resolve()},nativePromise:async(plugin,method)=>method==='prepareAudioRoute'?window.nativeRoute:{notificationsEnabled:true,enabled:true}};
  return{room:S.room.id,leaveToken:S.roomLeaveToken};
 },hostId);
 await guest.evaluate(()=>roomCall('prepareBluetooth'));
 // Start a fresh capture while Android still reports a pending route. Confirm it from
 // inside getUserMedia to exercise the capture/routing dependency with real media.
 const bootstrap=await guest.evaluate(async()=>{
  releaseMicrophone();window.nativeRoute={managed:true,generation:0,route:'system'};
  const capture=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);let count=0;
  navigator.mediaDevices.getUserMedia=async constraints=>{
   const stream=await capture(constraints);
   if(++count===1){window.nativeRoute={managed:true,generation:1,route:'speaker'};window.routeAction({action:'audioRouteChanged',ready:true,generation:1,route:'speaker'})}
   return stream;
  };
  try{await syncMic();return {count,route:R.micRoute,live:R.mic?.readyState,muted:S.muted}}
  finally{navigator.mediaDevices.getUserMedia=capture}
 });
 assert.deepEqual(bootstrap,{count:2,route:1,live:'live',muted:false});
 const packets=()=>host.evaluate(async id=>{const pc=R.peers[id]?.pc;if(!pc)return 0;return [...(await pc.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&(s.kind==='audio'||s.mediaType==='audio')).reduce((n,s)=>n+(s.packetsReceived||0),0)},guestId);
 for(const [generation,route,muted] of [[2,'bluetooth',false],[3,'wired',true],[4,'speaker',false]]){
  const previous=await guest.evaluate(()=>R.mic.id),count=await packets();
  await guest.evaluate(({generation,route,muted})=>{setMute(muted);window.nativeRoute={managed:true,generation,route};window.routeAction({action:'audioRouteChanged',ready:false,generation,route});window.routeAction({action:'audioRouteChanged',ready:true,generation,route})},{generation,route,muted});
  await guest.waitForFunction(({previous,generation})=>R.mic&&R.mic.id!==previous&&R.micRoute===generation,{previous,generation});
  const state=await guest.evaluate(id=>({room:S.room.id,leaveToken:S.roomLeaveToken,muted:S.muted,enabled:R.mic.enabled,samePeer:R.peers[id].pc===window.routePeer,sameSender:window.routeSender===window.routePeer.getTransceivers().find(t=>t.sender.track?.kind==='audio').sender}),hostId);
  assert.deepEqual(state,{...original,muted,enabled:!muted,samePeer:true,sameSender:true});
  if(muted){await guest.evaluate(()=>window.routeAction({action:'mute',muted:false}));await guest.waitForFunction(()=>R.mic.enabled&&!S.muted)}
  const deadline=Date.now()+10000;while(await packets()<=count+3&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert(await packets()>count+3,'Fresh RTP must arrive after each microphone route replacement');
 }
 await guest.evaluate(()=>{window.reportedOutput='bluetooth';const original=Capacitor.nativePromise;Capacitor.nativePromise=async(plugin,method,...args)=>method==='getAudioStatus'?{input:'phone',inputVerified:true,output:window.reportedOutput}:original(plugin,method,...args)});
 await guest.evaluate(()=>micSheet());
 assert.match(await guest.locator('#audio-status').textContent(),/Active microphone: Phone microphone/);
 assert.match(await guest.locator('#audio-status').textContent(),/Output: Bluetooth headset/);
 await guest.evaluate(()=>closeModal());
 for(const [output,label] of [['earpiece','Phone call earpiece'],['speaker','Phone loudspeaker']]){
  await guest.evaluate(output=>{window.reportedOutput=output;return micSheet()},output);
  assert((await guest.locator('#audio-status').textContent()).includes('Output: '+label));await guest.evaluate(()=>closeModal());
 }
 assert.deepEqual(errors,[]);
});
