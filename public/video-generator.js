import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { renderVideo } from "/video-renderer.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqzKq2OXQfYnG-DOSyuzo4xo0GjSb-aP8",
  authDomain: "zaida-voice.firebaseapp.com",
  projectId: "zaida-voice",
  storageBucket: "zaida-voice.firebasestorage.app",
  messagingSenderId: "146292786794",
  appId: "1:146292786794:web:da865938c177b21d5d6c13"
};
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const $ = id => document.getElementById(id);
let storyboard = null;
let currentUser = null;
let audioUrl = null;
let outputUrl = null;
const styles = {
  stickman:"Clean minimalist stickman illustration style, expressive line-drawn human characters, clear poses, uncluttered backgrounds, consistent character design, restrained color palette. Not photorealistic.",
  "2d":"Polished 2D flat vector illustration, clean shapes, crisp outlines, balanced colors, simple readable composition, consistent illustrated characters. Not photorealistic or 3D.",
  "3d":"High-quality stylized 3D animated film visuals, expressive characters, soft global illumination, detailed friendly materials, consistent character design.",
  anime:"High-quality Japanese anime illustration, expressive character design, refined line art, cinematic lighting, consistent characters.",
  realistic:"Natural photorealistic photography, believable people and environments, accurate anatomy, realistic textures and natural lighting.",
  cinematic:"Cinematic photorealistic film still, dramatic but natural lighting, thoughtful composition, atmospheric depth, realistic textures and professional color grading.",
  watercolor:"Delicate watercolor painting, visible paper texture, soft pigment washes, graceful brush edges and cohesive illustrated scenes.",
  comic:"Polished graphic novel comic-book illustration, confident ink outlines, dynamic framing, controlled halftone texture and expressive poses."
};
function status(message,error=false){$("vgStatus").textContent=message;$("vgStatus").classList.toggle("error",error)}
function requestId(){return crypto.randomUUID()}
async function api(path,options={}) {
  if(!auth.currentUser) throw new Error("Silakan masuk ke akun ZAIDA Voice terlebih dahulu.");
  const token=await auth.currentUser.getIdToken();
  const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,...(options.headers||{})}});
  let data;try{data=await response.json()}catch{data={error:"Respons server tidak valid."}}
  if(!response.ok)throw new Error(data.error||"Permintaan gagal ("+response.status+").");
  return data;
}
async function refreshAccount(){
  try{const data=await api("/api/account");$("vgCredit").textContent="Kredit: "+Number(data.credits||0).toLocaleString("id-ID");}
  catch(error){$("vgCredit").textContent="Kredit: —";status(error.message,true)}
}
function estimateDuration(text){const words=String(text||"").trim().split(/\s+/).filter(Boolean).length;return Math.max(30,Math.min(600,Math.round(words/130*60)))}
function readAudioDuration(file){if(!file)return Promise.resolve(0);return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),audio=new Audio();audio.onloadedmetadata=()=>{URL.revokeObjectURL(url);resolve(audio.duration||0)};audio.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Durasi audio tidak dapat dibaca."))};audio.src=url})}
function updateWorkflow(step){document.querySelectorAll(".vg-workflow span").forEach((item,index)=>item.classList.toggle("active",index===step))}
function updateRenderButton(){const ready=Boolean(storyboard?.scenes?.length>=2);$("vgRender").disabled=!ready}
function renderScenes(){
  const list=$("vgScenesList");list.replaceChildren();
  $("vgEmpty").hidden=Boolean(storyboard?.scenes?.length);
  const scenes=storyboard?.scenes||[];
  $("vgSceneCount").textContent=scenes.length+" adegan";
  scenes.forEach((scene,index)=>{
    scene.scene_number=scene.scene_number||index+1;
    scene.estimated_seconds=Number(scene.estimated_seconds)||6;
    const card=document.createElement("article");card.className="vg-scene";
    let visual;
    if(scene.uploadedImageDataUrl||scene.generatedImage?.b64){
      visual=document.createElement("img");visual.className="vg-scene-visual";visual.alt="Visual adegan "+(index+1);
      visual.src=scene.uploadedImageDataUrl||("data:"+(scene.generatedImage.mime||"image/png")+";base64,"+scene.generatedImage.b64);
    }else{visual=document.createElement("div");visual.className="vg-scene-visual vg-scene-placeholder";visual.textContent="✧"}
    const content=document.createElement("div");content.className="vg-scene-content";
    const number=document.createElement("small");number.textContent="ADEGAN "+String(index+1).padStart(2,"0");
    const title=document.createElement("b");title.textContent=scene.title||("Adegan "+(index+1));
    const desc=document.createElement("p");desc.textContent=scene.visual_prompt||scene.visual_desc||scene.narration||"Visual adegan";
    const button=document.createElement("button");button.type="button";button.textContent=scene.generatedImage?"Buat ulang visual":"Buat visual AI";
    button.addEventListener("click",()=>generateImage(scene,index,button));
    content.append(number,title,desc,button);card.append(visual,content);list.append(card);
  });
  $("vgGenerateAll").hidden=!scenes.length;
  $("vgGenerateAll").textContent="Buat semua visual yang belum tersedia";
  updateRenderButton();updateWorkflow(1);
}
async function generateImage(scene,index,button){
  if(!currentUser){status("Masuk ke akun ZAIDA Voice terlebih dahulu.",true);return}
  if(scene.generatedImage&&!confirm("Buat ulang visual adegan ini? Kredit akan dipotong kembali."))return;
  button.disabled=true;button.textContent="Membuat visual…";
  try{
    const prompt=styles[$("vgStyle").value]+"\n\nScene direction: "+(scene.visual_prompt||scene.visual_desc||scene.narration||scene.title);
    const result=await api("/api/video/image",{method:"POST",body:JSON.stringify({requestId:requestId(),sceneNumber:index+1,prompt})});
    scene.generatedImage={b64:result.image.b64,mime:result.image.mime,cost:result.creditsCharged};
    if(result.creditsRemaining!==undefined)$("vgCredit").textContent="Kredit: "+Number(result.creditsRemaining).toLocaleString("id-ID");
    renderScenes();status("Visual adegan "+(index+1)+" berhasil dibuat · "+Number(result.creditsCharged||0).toLocaleString("id-ID")+" kredit.");
  }catch(error){status(error.message,true);button.disabled=false;button.textContent="Coba lagi"}
}
async function generateAllImages(){
  const scenes=storyboard?.scenes||[];const pending=scenes.filter(scene=>!scene.generatedImage&&!scene.uploadedImageDataUrl);
  if(!pending.length){status("Semua visual sudah tersedia.");return}
  if(!confirm("ZAIDA akan membuat "+pending.length+" visual AI. Biaya kredit mengikuti tarif yang berlaku. Lanjutkan?"))return;
  $("vgGenerateAll").disabled=true;
  for(let i=0;i<scenes.length;i++){const scene=scenes[i];if(scene.generatedImage||scene.uploadedImageDataUrl)continue;
    const button=$("vgScenesList").children[i]?.querySelector("button");if(button)await generateImage(scene,i,button);
    if(!scene.generatedImage){status("Proses berhenti pada adegan "+(i+1)+". Kamu dapat melanjutkan satu per satu.",true);break}
  }
  $("vgGenerateAll").disabled=false;
}
async function createStoryboard(){
  const topic=$("vgScript").value.trim();if(topic.length<20){status("Masukkan naskah minimal 20 karakter.",true);$("vgScript").focus();return}
  if(!currentUser){status("Silakan masuk ke akun ZAIDA Voice terlebih dahulu.",true);return}
  const button=$("vgCreateStoryboard");button.disabled=true;button.textContent="Menyusun storyboard…";
  try{
    let duration=Number($("vgDuration").value)||estimateDuration(topic);
    const audio=$("vgAudio").files?.[0];
    if($("vgDuration").value==="auto"&&audio){try{duration=Math.round(await readAudioDuration(audio))||duration}catch{}}
    const requested=$("vgScenes").value;
    const sceneCount=requested==="auto"?Math.max(3,Math.min(30,Math.ceil(duration/8))):Number(requested);
    status("Menghubungi KiosAPI untuk menyusun adegan…");
    const result=await api("/api/video/storyboard",{method:"POST",body:JSON.stringify({requestId:requestId(),topic,duration,sceneCount,audience:$("vgAudience").value.trim(),tone:$("vgTone").value,language:"id"})});
    storyboard=result;storyboard.scenes=(storyboard.scenes||[]).map((scene,index)=>({...scene,scene_number:scene.scene_number||index+1,estimated_seconds:Number(scene.estimated_seconds)||Math.max(2,Math.round(duration/(storyboard.scenes.length||1)))}));
    renderScenes();if(result.creditsRemaining!==undefined)$("vgCredit").textContent="Kredit: "+Number(result.creditsRemaining).toLocaleString("id-ID");
    status("Storyboard selesai · "+storyboard.scenes.length+" adegan · "+Number(result.creditsCharged||0).toLocaleString("id-ID")+" kredit.");
  }catch(error){status(error.message,true)}
  finally{button.disabled=false;button.innerHTML="✦ Buat storyboard <span>→</span>"}
}
async function renderFinal(){
  if(!storyboard?.scenes?.length)return;
  const button=$("vgRender"),progress=$("vgProgress"),bar=$("vgProgressBar"),label=$("vgProgressText");
  button.disabled=true;button.textContent="Merender MP4…";progress.hidden=false;bar.style.width="0%";$("vgResult").replaceChildren();
  try{
    const audioFile=$("vgAudio").files?.[0]||null;
    let audioDuration=0;if(audioFile)audioDuration=await readAudioDuration(audioFile);
    const result=await renderVideo({scenes:storyboard.scenes,format:$("vgFormat").value,audioFile,audioDuration,onProgress:info=>{
      if(info.phase==="loading")label.textContent=info.message||"Memuat mesin ekspor…";
      else if(info.phase==="rendering"){const p=Math.round((info.progress||0)*100);bar.style.width=p+"%";label.textContent=info.message||("Merender… "+p+"%")}
      else if(info.phase==="complete"){bar.style.width="100%";label.textContent=info.message||"Selesai"}
    }});
    if(outputUrl)URL.revokeObjectURL(outputUrl);outputUrl=URL.createObjectURL(result.blob);
    const video=document.createElement("video");video.controls=true;video.playsInline=true;video.src=outputUrl;
    const wrap=document.createElement("div");wrap.style.width="100%";wrap.style.textAlign="center";
    const link=document.createElement("a");link.href=outputUrl;link.download=result.filename;link.textContent="Unduh video MP4";
    wrap.append(video,link);$("vgResult").append(wrap);status("Video berhasil dirender. Silakan preview atau unduh MP4.");updateWorkflow(3);
  }catch(error){status(error.message,true);label.textContent=error.message}
  finally{button.disabled=false;button.innerHTML="Render & ekspor MP4 <span>→</span>"}
}
$("vgCreateStoryboard").addEventListener("click",createStoryboard);
$("vgGenerateAll").addEventListener("click",generateAllImages);
$("vgRender").addEventListener("click",renderFinal);
$("vgAudio").addEventListener("change",()=>{const file=$("vgAudio").files?.[0];if(file){if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(file);status("Audio narasi dipilih: "+file.name)}});
onAuthStateChanged(auth,async user=>{
  currentUser=user;$("vgUser").textContent=user?(user.email||"Akun aktif"):"Belum masuk";
  if(user){await refreshAccount();status("Akun terhubung. Siapkan naskah untuk membuat video.");}
  else{status("Kamu belum masuk. Masuk melalui workspace ZAIDA Voice, lalu buka halaman ini kembali.",true);}
});
window.addEventListener("beforeunload",()=>{if(outputUrl)URL.revokeObjectURL(outputUrl);if(audioUrl)URL.revokeObjectURL(audioUrl)});
