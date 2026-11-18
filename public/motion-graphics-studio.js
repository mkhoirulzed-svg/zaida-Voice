import { auth, authReady, signInWithGoogle } from "/auth-core.js?v=20261118-shared-auth";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {drawMotionFrame,inferMotionType,prepareMotionAssets} from "/motion-graphics-engine.js?v=20261118-svg-ecg-test";
import {renderMotionVideo} from "/motion-graphics-renderer.js";
const $=id=>document.getElementById(id);
let user=null,authMode="login",scenes=[],audioFile=null,audioDuration=0,selected=0,playing=false,raf=0,playStart=0,playOffset=0,downloadUrl=null;
const canvas=$("motionCanvas"),ctx=canvas.getContext("2d");
function status(message,error=false){$("motionStatus").textContent=message;$("motionStatus").classList.toggle("error",error)}
function exportStatus(message,error=false){$("exportStatus").textContent=message;$("exportStatus").classList.toggle("error",error)}
function toast(message){const el=$("motionToast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2600)}

function showAuth(mode="login"){authMode=mode;$("motionAuthTitle").textContent=mode==="login"?"Selamat datang.":"Buat akun ZAIDA Voice.";$("motionAuthDescription").textContent=mode==="login"?"Masuk untuk menggunakan Motion Graphics Studio.":"Daftar menggunakan email aktif."; $("motionAuthSubmit").innerHTML=mode==="login"?'Masuk <b>→</b>':'Buat akun <b>→</b>';$("motionAuthSwitch").textContent=mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk";$("motionAuthMessage").textContent="";$("motionAuthResend").hidden=true;$("motionAuthOverlay").hidden=false;}
function closeAuth(){$("motionAuthOverlay").hidden=true;}
$("motionAuthButton").addEventListener("click",()=>user?signOut(auth):showAuth());
$("motionAuthClose").addEventListener("click",closeAuth);
$("motionAuthOverlay").addEventListener("click",e=>{if(e.target===$("motionAuthOverlay"))closeAuth()});
$("motionAuthSwitch").addEventListener("click",()=>showAuth(authMode==="login"?"register":"login"));
$("motionAuthForm").addEventListener("submit",async e=>{e.preventDefault();const email=$("motionAuthEmail").value.trim(),password=$("motionAuthPassword").value,button=$("motionAuthSubmit");button.disabled=true;$("motionAuthMessage").textContent="Memproses…";try{if(authMode==="login"){const credential=await signInWithEmailAndPassword(auth,email,password);if(!credential.user.emailVerified){$("motionAuthMessage").textContent="Email belum diverifikasi. Periksa kotak masuk atau kirim ulang email verifikasi."; $("motionAuthResend").hidden=false;return;}}else{const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user);$("motionAuthMessage").textContent="Akun berhasil dibuat. Silakan verifikasi email, lalu masuk kembali."; $("motionAuthResend").hidden=false;return;}closeAuth();}catch(error){const messages={"auth/invalid-credential":"Email atau password salah.","auth/email-already-in-use":"Email sudah terdaftar.","auth/invalid-email":"Format email tidak valid.","auth/weak-password":"Password minimal 6 karakter.","auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti."};$("motionAuthMessage").textContent=messages[error.code]||error.message;}finally{button.disabled=false;}});
$("motionGoogleAuth").addEventListener("click",async()=>{const button=$("motionGoogleAuth");button.disabled=true;$("motionAuthMessage").textContent="Menghubungkan ke Google…";try{await signInWithGoogle();closeAuth();}catch(error){$("motionAuthMessage").textContent=error.message;}finally{button.disabled=false;}});
$("motionAuthResend").addEventListener("click",async()=>{try{if(!auth.currentUser)throw new Error("Masuk kembali menggunakan email dan password untuk mengirim verifikasi.");await sendEmailVerification(auth.currentUser);$("motionAuthMessage").textContent="Email verifikasi telah dikirim ulang.";}catch(error){$("motionAuthMessage").textContent=error.message;}});

function fmt(seconds){const n=Math.max(0,Math.floor(seconds||0));return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}
function totalDuration(){return audioDuration||scenes.reduce((sum,s)=>sum+(Number(s.estimated_seconds)||5),0)}
function durations(){const base=scenes.map(s=>Math.max(1,Number(s.estimated_seconds)||5)),sum=base.reduce((a,b)=>a+b,0),total=totalDuration();return base.map(v=>v/sum*total)}
function currentAt(time){const ds=durations();let start=0;for(let i=0;i<ds.length;i++){if(time<start+ds[i]||i===ds.length-1)return{index:i,start,duration:ds[i]};start+=ds[i]}return{index:0,start:0,duration:ds[0]||1}}
function stopPreview(){playing=false;cancelAnimationFrame(raf);$("playPreview").textContent="▶"}
function paint(index=selected,elapsed=0,progress=0){if(!scenes.length)return;const scene=scenes[index];drawMotionFrame(ctx,scene,canvas.width,canvas.height,elapsed,progress,index);$("previewSceneLabel").textContent=(index+1)+". "+scene.title}
function tick(now){if(!playing||!scenes.length)return;const t=playOffset+(now-playStart)/1000,total=totalDuration(),time=Math.min(t,total),pos=currentAt(time);const changed=selected!==pos.index;selected=pos.index;paint(pos.index,time-pos.start,(time-pos.start)/pos.duration);if(changed)renderSceneList();$("previewTime").textContent=fmt(time)+" / "+fmt(total);$("previewProgress").style.width=(time/total*100)+"%";if(time>=total){stopPreview();playOffset=0;return}raf=requestAnimationFrame(tick)}
function renderSceneList(){const list=$("motionSceneList");list.innerHTML="";scenes.forEach((scene,i)=>{const card=document.createElement("div");card.className="motion-scene-card"+(i===selected?" active":"");const num=document.createElement("div");num.className="motion-scene-num";num.textContent=String(i+1).padStart(2,"0");const copy=document.createElement("div");copy.className="motion-scene-copy";const title=document.createElement("b");title.textContent=scene.title||"Adegan "+(i+1);const desc=document.createElement("span");desc.textContent=(scene.narration||scene.visual_description||"").slice(0,110);copy.append(title,desc);copy.setAttribute("role","button");copy.setAttribute("tabindex","0");const activateScene=()=>{stopPreview();selected=i;playOffset=durations().slice(0,i).reduce((a,b)=>a+b,0);paint(i,0,0);$("previewTime").textContent=fmt(playOffset)+" / "+fmt(totalDuration());renderSceneList()};copy.addEventListener("click",activateScene);copy.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activateScene()}});const select=document.createElement("select");select.setAttribute("aria-label","Jenis visual adegan "+(i+1));[["auto","Otomatis"],["stickman","Stickman"],["ecg","EKG SVG · Uji coba"],["heart","Jantung"],["lungs","Paru-paru"],["brain","Otak"],["blood","Aliran darah"],["chart","Grafik"],["motion","Motion graphic"]].forEach(([value,label])=>{const opt=document.createElement("option");opt.value=value;opt.textContent=label;select.append(opt)});select.value=scene.motionType||"auto";select.addEventListener("change",e=>{e.stopPropagation();scene.motionType=e.target.value==="auto"?"":e.target.value;paint(i,0,0)});card.append(num,copy,select);list.append(card)});$("sceneCount").textContent=scenes.length+" ADEGAN";$("sceneEmpty").hidden=scenes.length>0;$("stageEmpty").hidden=scenes.length>0;$("exportMotion").disabled=scenes.length<2}
function setupScenes(data){prepareMotionAssets().then(()=>{if(scenes.length)paint(selected,0,0)}).catch(()=>{});scenes=(data.scenes||[]).map((s,i)=>({...s,motionType:"",_autoType:inferMotionType(s),estimated_seconds:Number(s.estimated_seconds)||5}));selected=0;playOffset=0;renderSceneList();if(scenes.length){paint(0,0,0);$("previewTime").textContent="00:00 / "+fmt(totalDuration());$("previewProgress").style.width="0%";exportStatus("Siap dirender. Animasi dibuat secara lokal di browser.")}else exportStatus("Storyboard belum memiliki adegan.")}
async function makeStoryboard(){const script=$("motionScript").value.trim();if(script.length<20){status("Naskah minimal 20 karakter.",true);return}if(!user){status("Silakan masuk ke akun ZAIDA Voice terlebih dahulu.",true);return}const button=$("generateStoryboard");button.disabled=true;button.textContent="Menyusun storyboard…";status("AI Director sedang menyusun adegan. Mohon tunggu.");try{const words=script.split(/\s+/).filter(Boolean).length;const duration=audioDuration||Math.max(15,Math.round(words/2.2));const rawCount=$("motionScenes").value;const result=await api("/api/video/storyboard",{method:"POST",body:JSON.stringify({requestId:crypto.randomUUID(),topic:script,duration,sceneCount:rawCount==="auto"?null:Number(rawCount),visualStyle:"mixed",audience:$("motionAudience").value,tone:$("motionTone").value,language:"id"})});setupScenes(result);status("Storyboard selesai · "+(result.model||"AI")+" · biaya "+Number(result.creditsCharged||0).toLocaleString("id-ID")+" kredit.");if(result.creditsRemaining!==undefined)$("creditBalance").textContent=Number(result.creditsRemaining).toLocaleString("id-ID")+" kredit";exportStatus("Storyboard siap. Pilih visual setiap adegan, lalu render MP4.");toast("Storyboard berhasil dibuat.")}catch(error){status(error.message||"Gagal membuat storyboard.",true)}finally{button.disabled=!user;button.innerHTML="<span>✦</span> Buat storyboard AI <b>→</b>"}}
async function api(path,options={}){if(!auth.currentUser)throw new Error("Silakan masuk ke akun ZAIDA Voice.");const token=await auth.currentUser.getIdToken();const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",Authorization:"Bearer "+token,...(options.headers||{})}});const data=await response.json().catch(()=>({error:"Respons server tidak valid."}));if(!response.ok)throw new Error(data.error||"Permintaan gagal ("+response.status+").");return data}
async function addAudio(file){if(!file)return;if(!file.type.startsWith("audio/")){toast("Pilih file audio yang valid.");return}audioFile=file;try{const ac=new(window.AudioContext||window.webkitAudioContext)();const buffer=await ac.decodeAudioData(await file.arrayBuffer());audioDuration=buffer.duration;await ac.close();$("motionAudioPlayer").src=URL.createObjectURL(file);$("audioName").textContent=file.name+" · "+fmt(audioDuration);$("audioPreviewWrap").hidden=false;$("removeAudio").hidden=false;toast("Audio berhasil dimuat.")}catch(error){audioFile=null;audioDuration=0;toast("Audio tidak dapat dibaca browser.")}}
async function exportVideo(){if(scenes.length<2)return;const button=$("exportMotion");button.disabled=true;$("downloadMotion").hidden=true;exportStatus("Menyiapkan mesin render…");try{const result=await renderMotionVideo({scenes,audioFile,format:$("motionFormat").value,onProgress:p=>exportStatus(p.message||"Merender…")});if(downloadUrl)URL.revokeObjectURL(downloadUrl);downloadUrl=URL.createObjectURL(result.blob);$("downloadMotion").href=downloadUrl;$("downloadMotion").download=result.filename;$("downloadMotion").hidden=false;exportStatus("Render selesai · "+fmt(result.duration)+" · "+(result.blob.size/1024/1024).toFixed(1)+" MB.");toast("Video MP4 berhasil dibuat.")}catch(error){exportStatus(error.message||"Render gagal.",true)}finally{button.disabled=scenes.length<2}}
function resizeCanvas(){const portrait=$("motionFormat").value==="9:16";canvas.width=portrait?720:1280;canvas.height=portrait?1280:720;if(scenes.length)paint(selected,0,0);$("exportResolution").textContent=portrait?"720 × 1280":"1280 × 720"}
$("generateStoryboard").addEventListener("click",makeStoryboard);
$("motionAudio").addEventListener("change",e=>addAudio(e.target.files?.[0]));
$("removeAudio").addEventListener("click",()=>{audioFile=null;audioDuration=0;$("motionAudio").value="";$("audioPreviewWrap").hidden=true;$("removeAudio").hidden=true;$("motionAudioPlayer").removeAttribute("src");$("audioName").textContent="";toast("Audio dilepas.")});
$("motionFormat").addEventListener("change",resizeCanvas);
$("playPreview").addEventListener("click",()=>{if(!scenes.length)return;if(playing){const pos=currentAt(playOffset+(performance.now()-playStart)/1000);playOffset+= (performance.now()-playStart)/1000;stopPreview();return}if(playOffset>=totalDuration())playOffset=0;playing=true;playStart=performance.now();$("playPreview").textContent="Ⅱ";raf=requestAnimationFrame(tick)});
$("previousScene").addEventListener("click",()=>{if(!scenes.length)return;stopPreview();selected=Math.max(0,selected-1);playOffset=durations().slice(0,selected).reduce((a,b)=>a+b,0);paint(selected,0,0);renderSceneList()});
$("nextScene").addEventListener("click",()=>{if(!scenes.length)return;stopPreview();selected=Math.min(scenes.length-1,selected+1);playOffset=durations().slice(0,selected).reduce((a,b)=>a+b,0);paint(selected,0,0);renderSceneList()});
$("exportMotion").addEventListener("click",exportVideo);
function setSidebarOpen(open){$("sidebar").classList.toggle("open",open);$("motionSidebarBackdrop").hidden=!open;document.body.classList.toggle("sidebar-open",open)}
$("mobileMenu").addEventListener("click",()=>setSidebarOpen(!$("sidebar").classList.contains("open")));
$("sidebarClose").addEventListener("click",()=>setSidebarOpen(false));
$("motionSidebarBackdrop").addEventListener("click",()=>setSidebarOpen(false));
document.querySelectorAll("#sidebar .nav-item, #sidebar .brand").forEach(link=>link.addEventListener("click",()=>setSidebarOpen(false)));
authReady.then(()=>onAuthStateChanged(auth,async current=>{
  user=current&&current.emailVerified?current:null;
  const allowed=Boolean(user);
  const display=allowed?(current.displayName||current.email||"U").slice(0,1).toUpperCase():"Z";
  $("motionAuthButton").textContent=allowed?(current.email||"Akun")+" · Keluar":"Masuk / Daftar";
  $("motionProfileName").textContent=allowed?(current.displayName||"Pengguna"):"Pengunjung";
  $("motionProfileEmail").textContent=allowed?"Akun terverifikasi":(current?"Email belum diverifikasi":"Belum masuk");
  $("motionProfileAvatar").textContent=display;
  $("motionTopAvatar").textContent=display;
  $("motionAuthResend").hidden=!(current&&!current.emailVerified);
  $("generateStoryboard").disabled=!allowed;
  if(!allowed){
    status(current?"Email belum diverifikasi. Klik Masuk/Daftar untuk mengirim ulang verifikasi.":"Silakan masuk ke akun ZAIDA Voice untuk menggunakan AI Director.");
    $("creditBalance").textContent=current?"Verifikasi email":"Belum masuk";
    return;
  }
  status("Akun terhubung. Siap membuat storyboard.");
  try{
    const token=await current.getIdToken();
    const response=await fetch("/api/account",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Saldo tidak dapat dimuat.");
    $("creditBalance").textContent=Number(data.credits).toLocaleString("id-ID")+" kredit";
  }catch(error){
    $("creditBalance").textContent="Saldo tidak tersedia";
    status(error.message,true);
    console.warn("Motion Graphics account refresh:",error);
  }
}));
resizeCanvas();