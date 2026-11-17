// Manual live check: creates one diagnostic account, never joins a real room, and logs out afterward.
const {spawn}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const {chromium}=require('playwright');
const base='https://patchwire.whassabi.workers.dev';
function request(path,method='GET',body,token){
 return new Promise((resolve,reject)=>{
  const args=['-sS','--max-time','25','-X',method,'-w','\n%{http_code}','-H','Content-Type: application/json'];
  if(token)args.push('-H','Authorization: Bearer '+token);
  if(body)args.push('--data-binary','@-');
  args.push(base+path);
  const proc=spawn('curl',args,{stdio:['pipe','pipe','pipe']});let stdout='';
  proc.stdout.on('data',c=>stdout+=c);proc.stderr.resume();proc.once('error',()=>reject(Error('HTTP transport unavailable')));
  proc.once('close',code=>{if(code)return reject(Error('HTTP transport failed: '+code));const i=stdout.lastIndexOf('\n'),status=Number(stdout.slice(i+1));let data;try{data=JSON.parse(stdout.slice(0,i))}catch{data=null}resolve({status,data});});
  proc.stdin.end(body?JSON.stringify(body):'');
 });
}
async function trial(browser,servers,label){
 const page=await browser.newPage();
 try{
  await page.route('http://127.0.0.1:17964/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Private relay diagnostic</title>'}));
  await page.goto('http://127.0.0.1:17964/');
  await page.addScriptTag({path:require('node:path').join(__dirname,'../public/room-audio.js')});
  await page.evaluate(async servers=>{
   const pcs=[],tracks=[],contexts=[],errors=[],candidates=[];
   const state=window.check={pcs,tracks,contexts,errors,candidates,audio:{}};
   class RelayPeer extends RTCPeerConnection{
    setConfiguration(config){super.setConfiguration({...config,iceTransportPolicy:'relay'});}
    constructor(config){super({...config,iceTransportPolicy:'relay'});pcs.push(this);this.addEventListener('icecandidateerror',e=>errors.push({code:e.errorCode}));this.addEventListener('icecandidate',e=>{if(e.candidate)candidates.push({type:e.candidate.type,protocol:e.candidate.protocol,relayProtocol:e.candidate.relayProtocol})});}
   }
   for(const [i,id] of ['a','b'].entries()){
    const context=new AudioContext(),osc=context.createOscillator(),out=context.createMediaStreamDestination();osc.frequency.value=440+i*220;osc.connect(out);osc.start();await context.resume();contexts.push(context);tracks.push(out.stream.getAudioTracks()[0]);
    state.audio[id]=createRoomAudio({selfId:()=>id,isMember:()=>true,getIce:()=>servers,refreshIce:async()=>servers,getTrack:()=>tracks[i],signalingReady:()=>true,PeerConnection:RelayPeer,
     send:(uid,data)=>{queueMicrotask(()=>state.audio[uid].receive(id,JSON.parse(JSON.stringify(data))));return true;},onError:()=>errors.push({negotiation:true}),
     onTrack:(uid,event)=>{const stream=new MediaStream([event.track]);const node=context.createMediaStreamSource(stream);const analyser=context.createAnalyser();node.connect(analyser);const gain=context.createGain();gain.gain.value=0;analyser.connect(gain);gain.connect(context.destination);state['analyser'+id]=analyser;}
    });
   }
   state.audio.a.connect('b',true);state.audio.b.connect('a',true);
   state.stats=async()=>Promise.all(pcs.map(async (pc,index)=>{
    const stats=await pc.getStats();let pair,inbound={bytes:0,packets:0};
    for(const s of stats.values()){
     if(s.type==='transport'&&s.selectedCandidatePairId)pair=stats.get(s.selectedCandidatePairId);
     if(s.type==='inbound-rtp'&&s.kind==='audio'){inbound.bytes+=s.bytesReceived||0;inbound.packets+=s.packetsReceived||0;}
    }
    const candidate=pair&&stats.get(pair.localCandidateId);
    return {connected:pc.connectionState==='connected',policy:pc.getConfiguration().iceTransportPolicy,candidateType:candidate?.candidateType,relayProtocol:candidate?.relayProtocol,...inbound};
   }));
  },servers);
  try{
   async function poll(predicate,timeout){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){const stats=await page.evaluate(()=>check.stats());if(predicate(stats))return stats;await new Promise(resolve=>setTimeout(resolve,250));}
    throw Error('No confirmed relayed media before timeout');
   }
   const before=await poll(s=>s.length===2&&s.every(v=>v.connected&&v.policy==='relay'&&v.candidateType==='relay'&&v.packets>20),35000);
   const peers=await poll(s=>s.length===2&&s.every((v,i)=>v.connected&&v.policy==='relay'&&v.candidateType==='relay'&&v.bytes>before[i].bytes+500&&v.packets>before[i].packets+5),10000);
   return {label,passed:true,peers};
  }catch{
   return {label,passed:false,peers:await page.evaluate(()=>check.stats()),candidateTypes:await page.evaluate(()=>[...new Set(check.candidates.map(c=>c.type))]),errors:await page.evaluate(()=>check.errors.slice(0,12))};
  }
 }finally{await page.close();}
}
(async()=>{
 let token,browser;
 try{
  const suffix=randomBytes(5).toString('hex');
  const signup=await request('/api/signup','POST',{email:'relay-check-'+suffix+'@example.invalid',nick:'RelayCheck'+suffix,password:randomBytes(24).toString('base64url')});
  if(signup.status!==200||!signup.data?.token)throw Error('Diagnostic sign-in failed: '+signup.status);
  token=signup.data.token;
  let ice;
  for(let attempt=0;attempt<3;attempt++){
   ice=await request('/api/ice','GET',undefined,token);
   if(ice.status!==503||ice.data?.code||attempt===2)break;
   console.log(JSON.stringify({waiting:'Cloudflare backend rollout',retry:attempt+1}));
   for(let pause=0;pause<3;pause++)await new Promise(resolve=>setTimeout(resolve,50000));
  }
  const servers=ice.data;
  if(ice.status!==200||!Array.isArray(servers))throw Error('Temporary credential generation failed: HTTP '+ice.status+' '+(/^TURN_[A-Z_]+$/.test(ice.data?.code||'')?ice.data.code:'')+(Number.isInteger(ice.data?.upstreamStatus)?' upstream '+ice.data.upstreamStatus:''));
  const relay=servers.filter(s=>(Array.isArray(s.urls)?s.urls:[s.urls]).some(u=>/^turns?:/.test(u)));
  if(!relay.length)throw Error('Temporary credential response has no TURN servers');
  console.log(JSON.stringify({credentialGeneration:'passed',relayEntries:relay.length,credentialValues:'not displayed'}));
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const normal=await trial(browser,servers,'relay-only RTP');console.log(JSON.stringify(normal));
  const tls=servers.map(s=>({...s,urls:(Array.isArray(s.urls)?s.urls:[s.urls]).filter(u=>/^turns:.*:443(?:\?|$)/.test(u))})).filter(s=>s.urls.length);
  if(!tls.length)throw Error('TLS port 443 relay route is missing');
  const fallback=await trial(browser,tls,'TLS-443-relay-only RTP');console.log(JSON.stringify(fallback));
  if(!normal.passed||!fallback.passed)throw Error('Relayed media verification did not pass');
 }catch(e){console.log(JSON.stringify({failed:true,message:/^(Diagnostic sign-in failed|HTTP transport|Temporary credential generation failed|Temporary credential response|Relayed media verification|TLS port 443 relay route)/.test(e.message)?e.message:'Browser relay diagnostic failed'}));process.exitCode=1;}
 finally{await browser?.close();if(token)await request('/api/logout','POST',{},token).catch(()=>{});}
})();
