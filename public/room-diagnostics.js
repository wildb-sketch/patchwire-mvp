/* Explicit, local-only troubleshooting report. Never copies identity, SDP, candidates or messages. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory;else root.createRoomDiagnostics=factory;
})(typeof window==='object'?window:globalThis,function createRoomDiagnostics(options){
 const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>['string','number','boolean'].includes(typeof value?.[key])).map(key=>[key,value[key]]));
 const processing=['autoGainControl','echoCancellation','noiseSuppression','sampleRate','channelCount','latency','volume'];
 const counters=['packetsSent','packetsReceived','packetsLost','bytesSent','bytesReceived','jitter','audioLevel','totalAudioEnergy','totalSamplesDuration','concealedSamples','concealmentEvents'];
 async function read(run,fallback){
  let timer;try{return await Promise.race([Promise.resolve().then(run),new Promise(resolve=>{timer=setTimeout(()=>resolve(fallback),2000)})])}
  catch(e){return fallback}finally{clearTimeout(timer)}
 }
 async function collect(){
  const status=await read(()=>options.nativeStatus?.(),{audioBuild:'status-unavailable'})||{};
  const routing=status.routing||{},track=options.track?.();
  const native={...pick(status,['audioBuild','webViewVersion','input','inputVerified','silenced','output','outputMode','speakerphoneOn','audioMode','communicationType','mediaVolume','mediaVolumeMax','callVolume','callVolumeMax']),
   platform:pick(status.platform,['manufacturer','model','android','sdk']),routing:{...pick(routing,['build','wanted','settled','generation','outputMode']),
    events:(Array.isArray(routing.events)?routing.events:[]).slice(-64).map(event=>pick(event,['ms','event','wanted','mode','speakerphoneOn','communicationType','stateUnavailable']))}};
  let settings={},constraints={};try{settings=pick(track?.getSettings?.(),processing);constraints=pick(track?.getConstraints?.(),processing)}catch(e){}
  const peers=await Promise.all(Object.values(options.peers?.()||{}).slice(0,8).map(async peer=>{
   const pc=peer?.pc,result={...pick(pc,['connectionState','iceConnectionState','signalingState']),audio:[]};
   const audio=await read(async()=>{const stats=await pc.getStats();return [...stats.values()].filter(stat=>['inbound-rtp','outbound-rtp','media-source'].includes(stat.type)&&(stat.kind==='audio'||stat.mediaType==='audio')).slice(0,8).map(stat=>({type:stat.type,...pick(stat,counters)}))},null);
   if(audio)result.audio=audio;else result.statsUnavailable=true;
   return result;
  }));
  return {format:'whassabi-audio-1',native,browser:{userAgent:String(options.userAgent?.()||'').slice(0,320)},
   capture:{present:!!track,...pick(track,['readyState','enabled']),...pick(options.intent?.(),['userMuted','speakingRole','roomActive']),settings,constraints},peers};
 }
 async function write(report,area){
  try{await options.copy(report);return true}catch(e){}
  try{area.focus();area.select();area.setSelectionRange(0,report.length);return area.ownerDocument.execCommand('copy')===true}catch(e){return false}
 }
 async function show(isCurrent=()=>true){
  const report=JSON.stringify(await collect(),null,2);
  if(!isCurrent())return report;
  options.present(`<h2>Audio diagnostics</h2><p class="mute s">This local report contains device and audio state. Share it only when troubleshooting.</p><p id="audio-diagnostics-copy-status" role="status">Copying report…</p><textarea id="audio-diagnostics-report" aria-label="Audio diagnostics report" readonly rows="12" spellcheck="false" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px"></textarea><button class="btn w" id="copy-audio-report">Copy report</button><button class="btn g w" id="select-audio-report">Select all</button><button class="btn g w" id="close-audio-report">Close</button>`,box=>{
   const area=box.querySelector('#audio-diagnostics-report'),status=box.querySelector('#audio-diagnostics-copy-status'),button=box.querySelector('#copy-audio-report');area.value=report;
   const copy=async()=>{button.disabled=true;const copied=await write(report,area);status.textContent=copied?'Audio diagnostics copied.':'Automatic copying is unavailable. Long-press inside the report, then choose Select all → Copy.';button.disabled=false};
   button.onclick=copy;
   box.querySelector('#select-audio-report').onclick=()=>{area.focus();area.select();area.setSelectionRange(0,report.length)};
   box.querySelector('#close-audio-report').onclick=options.close;
   copy();
  });
  return report;
 }
 return {collect,show,copy:async()=>{const report=JSON.stringify(await collect(),null,2);await options.copy(report);return report}};
});
