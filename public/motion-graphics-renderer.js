import {drawMotionFrame} from "/motion-graphics-engine.js?v=20261118-svg-ecg-test";
const VERSION="1.61.6";let libraryPromise;
export async function renderMotionVideo({scenes,audioFile=null,format="9:16",onProgress=()=>{}}){
 if(!Array.isArray(scenes)||scenes.length<2)throw new Error("Storyboard minimal 2 adegan diperlukan.");
 if(!["9:16","16:9"].includes(format))throw new Error("Format video tidak valid.");
 if(typeof VideoEncoder==="undefined"||typeof VideoFrame==="undefined")throw new Error("Browser belum mendukung WebCodecs. Gunakan Chrome versi terbaru.");
 onProgress({phase:"loading",message:"Memuat mesin ekspor MP4…"});
 if(!libraryPromise)libraryPromise=import("https://esm.sh/mediabunny@"+VERSION);
 const mb=await libraryPromise,portrait=format==="9:16",width=portrait?720:1280,height=portrait?1280:720,fps=30;
 const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const ctx=canvas.getContext("2d",{alpha:false});
 if(!ctx)throw new Error("Browser tidak dapat membuat kanvas video.");
 let audioContext=null,audioBuffer=null,output=null,videoSource=null,audioSource=null;
 try{
  if(audioFile){audioContext=new(window.AudioContext||window.webkitAudioContext)();audioBuffer=await audioContext.decodeAudioData(await audioFile.arrayBuffer())}
  const base=scenes.map(s=>Math.max(1,Math.min(60,Number(s.estimated_seconds)||5))),sum=base.reduce((a,b)=>a+b,0);
  const total=audioBuffer?.duration||sum,durations=base.map(v=>v/sum*total);
  output=new mb.Output({format:new mb.Mp4OutputFormat({fastStart:"in-memory"}),target:new mb.BufferTarget()});
  videoSource=new mb.CanvasSource(canvas,{codec:"avc",quality:new mb.Quality("high")});output.addVideoTrack(videoSource,{frameRate:fps});
  if(audioBuffer){audioSource=new mb.AudioBufferSource({codec:"aac",quality:new mb.Quality("high")});output.addAudioTrack(audioSource)}
  await output.start();if(audioSource)await audioSource.add(audioBuffer);
  const totalFrames=Math.ceil(total*fps);let current=0,start=0;
  for(let frame=0;frame<totalFrames;frame++){
   const time=frame/fps;while(current<scenes.length-1&&time>=start+durations[current]){start+=durations[current];current++}
   const local=time-start,progress=Math.min(1,local/durations[current]);
   drawMotionFrame(ctx,scenes[current],width,height,local,progress,current);
   await videoSource.add(time,Math.min(1/fps,total-time));
   if(frame%30===0||frame===totalFrames-1)onProgress({phase:"rendering",progress:(frame+1)/totalFrames,message:"Merender animasi… "+Math.round((frame+1)/totalFrames*100)+"%"});
  }
  videoSource.close();if(audioSource)audioSource.close();await output.finalize();
  const buffer=output.target.buffer;if(!buffer)throw new Error("File MP4 tidak berhasil dibuat.");
  return{blob:new Blob([buffer],{type:"video/mp4"}),filename:portrait?"zaida-motion-vertical.mp4":"zaida-motion-horizontal.mp4",duration:total};
 }finally{try{videoSource?.close()}catch{}try{audioSource?.close()}catch{}if(audioContext)try{await audioContext.close()}catch{}}
}
