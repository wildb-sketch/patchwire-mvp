/* Explicit, local-only troubleshooting report. Never copies identity, SDP, candidates or messages. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory;else root.createRoomDiagnostics=factory;
})(typeof window==='object'?window:globalThis,function createRoomDiagnostics(options){
 const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>['string','number','boolean'].includes(typeof value?.[key])).map(key=>[key,value[key]]));
 const processing=['autoGainControl','echoCancellation','noiseSuppression','sampleRate','channelCount','latency','volume'];
 const counters=['packetsSent','packetsReceived','packetsLost','bytesSent','bytesReceived','jitter','audioLevel','totalAudioEnergy','totalSamplesDuration','concealedSamples','concealmentEvents'];
 async function collect(){
  let status={};try{status=await options.nativeStatus?.()||{}}catch(e){status={audioBuild:'status-unavailable'}}
  const routing=status.routing||{},track=options.track?.();
  const native={...pick(status,['audioBuild','webViewVersion','input','inputVerified','silenced','output','outputMode','speakerphoneOn','audioMode','communicationType']),
   platform:pick(status.platform,['manufacturer','model','android','sdk']),routing:{...pick(routing,['build','wanted','settled','generation','outputMode']),
    events:(Array.isArray(routing.events)?routing.events:[]).slice(-64).map(event=>pick(event,['ms','event','wanted','mode','speakerphoneOn','communicationType','stateUnavailable']))}};
  let settings={},constraints={};try{settings=pick(track?.getSettings?.(),processing);constraints=pick(track?.getConstraints?.(),processing)}catch(e){}
  const peers=await Promise.all(Object.values(options.peers?.()||{}).slice(0,8).map(async peer=>{
   const pc=peer.pc,result={...pick(pc,['connectionState','iceConnectionState','signalingState']),audio:[]};
   try{const stats=await pc.getStats();result.audio=[...stats.values()].filter(stat=>['inbound-rtp','outbound-rtp','media-source'].includes(stat.type)&&(stat.kind==='audio'||stat.mediaType==='audio')).slice(0,8).map(stat=>({type:stat.type,...pick(stat,counters)}))}catch(e){result.statsUnavailable=true}
   return result;
  }));
  return {format:'whassabi-audio-1',native,browser:{userAgent:String(options.userAgent?.()||'').slice(0,320)},
   capture:{present:!!track,...pick(track,['readyState','enabled']),settings,constraints},peers};
 }
 return {collect,copy:async()=>{const report=JSON.stringify(await collect(),null,2);await options.copy(report);return report}};
});
