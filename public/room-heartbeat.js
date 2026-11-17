/* Probe actual socket liveness; a delayed WebView timer is not evidence of a lost connection. */
(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory;else root.createRoomHeartbeat=factory;
})(typeof window==='object'?window:globalThis,function createRoomHeartbeat(options){
 const now=options.now||Date.now,repeat=options.setInterval||setInterval,clear=options.clearInterval||clearInterval;
 const period=15000,timeout=45000;
 let socket=null,timer=null,lastTick=0,pendingSince=null;
 function stop(){if(timer!==null)clear(timer);timer=null;socket=null;pendingSince=null;}
 function tick(){
  if(!socket||socket.readyState!==1)return;
  const time=now();
  // Background schedulers can skip entire intervals. Give queued network events and a fresh
  // probe a chance instead of immediately closing a socket after the WebView wakes up.
  if(time-lastTick>period*2||time<lastTick)pendingSince=null;
  lastTick=time;
  if(pendingSince!==null&&time-pendingSince>=timeout){const stale=socket;stop();options.onStale(stale);return;}
  if(pendingSince===null)pendingSince=time;
  try{socket.send(JSON.stringify({type:'ping'}));}catch(e){const stale=socket;stop();options.onStale(stale);}
 }
 return {start(value){stop();socket=value;lastTick=now();timer=repeat(tick,period);},
  message(value){if(value===socket)pendingSince=null;},stop};
});
