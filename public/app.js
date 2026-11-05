import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyDqzKq2OXQfYnG-DOSyuzo4xo0GjSb-aP8",
  authDomain: "zaida-voice.firebaseapp.com",
  projectId: "zaida-voice",
  storageBucket: "zaida-voice.firebasestorage.app",
  messagingSenderId: "146292786794",
  appId: "1:146292786794:web:da865938c177b21d5d6c13"
});
const auth = getAuth(firebaseApp);
let authMode = "login";
let currentUser = null;
async function authHeaders(){ if(!auth.currentUser) throw new Error("Silakan masuk terlebih dahulu."); return {Authorization:"Bearer "+await auth.currentUser.getIdToken()}; }
function openAuth(mode="login"){authMode=mode;$("authTitle").textContent=mode==="login"?"Selamat datang.":"Buat akun ZAIDA Voice."; $("authDescription").textContent=mode==="login"?"Masuk untuk mulai membuat audio.":"Daftar menggunakan email aktif."; $("authSubmit").innerHTML=(mode==="login"?"Masuk":"Buat akun")+' <b>→</b>'; $("authSwitch").textContent=mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk"; $("authMessage").textContent="";$("authOverlay").hidden=false;}
function closeAuth(){$("authOverlay").hidden=true;}
const $ = (id) => document.getElementById(id);
const state = { voices: [], audioUrl: null, history: [] };
const SAMPLE = "Halo, selamat datang di ZAIDA Voice.\n\nDi sini, setiap kata bisa memiliki karakter. Sampaikan pesanmu dengan suara yang hangat, jelas, dan penuh percaya diri. Mari mulai berkarya.";
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),3200)}
function setBusy(busy,message="Sedang membuat audio…"){$("generateButton").disabled=busy;$("progressWrap").hidden=!busy;$("progressText").textContent=message}
function updateCount(){$("charCount").textContent=$("scriptText").value.length.toLocaleString("id-ID")+" karakter"}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.authRequired?await authHeaders():{}),...(options.headers||{})}});let data;try{data=await response.json()}catch{data={error:"Respons server tidak valid."}}if(!response.ok)throw new Error(data.error||"Permintaan gagal ("+response.status+")");return data}
async function loadVoices(){const select=$("voiceSelect");try{const data=await api("/api/voices");state.voices=data.voices||[];select.innerHTML="";if(!state.voices.length){select.innerHTML='<option value="">Tidak ada suara tersedia</option>';return}state.voices.forEach((voice)=>{const option=document.createElement("option");option.value=voice.voice_id;option.textContent=voice.name+(voice.category?" · "+voice.category:"");select.append(option)});$("voiceStatus").textContent=state.voices.length+" karakter suara tersedia";}catch(error){select.innerHTML='<option value="">Gagal memuat suara</option>';$("voiceStatus").textContent=error.message+" — periksa konfigurasi API";}}
async function generate(textOverride){const text=(textOverride??$("scriptText").value).trim();const voiceId=$("voiceSelect").value;if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk membuat audio.");return}if(!text){toast("Masukkan naskah terlebih dahulu.");return}if(!voiceId){toast("Pilih karakter suara terlebih dahulu.");return}if(text.length>5000){toast("Maksimal 5.000 karakter per proses.");return}
 setBusy(true);try{const response=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json",...(await authHeaders())},body:JSON.stringify({text,voiceId,voiceSettings:{stability:Number($("stability").value)/100,similarity_boost:Number($("similarity").value)/100,style:Number($("style").value)/100}})});if(!response.ok){let error={};try{error=await response.json()}catch{}throw new Error(error.error||"Gagal membuat audio.")}const blob=await response.blob();if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(blob);$("audioPlayer").src=state.audioUrl;$("downloadButton").href=state.audioUrl;$("resultTitle").textContent="Narasi "+new Date().toLocaleString("id-ID");$("resultDetails").textContent="MP3 · "+text.length+" karakter · ZAIDA Voice";$("emptyOutput").hidden=true;$("audioResult").hidden=false;const item={title:$("resultTitle").textContent,details:$("resultDetails").textContent,url:state.audioUrl,text};state.history.unshift(item);renderHistory();toast("Audio berhasil dibuat!");}catch(error){toast(error.message)}finally{setBusy(false)}}
async function improveScript(){const text=$("scriptText").value.trim();if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return}if(!text){toast("Tulis topik atau naskah terlebih dahulu.");return}const button=$("improveScript");button.disabled=true;button.textContent="✦ Sedang menyusun…";try{const result=await api("/api/script",{method:"POST",body:JSON.stringify({text,task:"polish",language:$("scriptLanguage").value}),authRequired:true});$("scriptText").value=result.text||text;updateCount();toast("Naskah berhasil disempurnakan.");}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent="✦ Bantu tulis dengan AI"}}
function renderHistory(){const list=$("historyList");if(!state.history.length){list.innerHTML='<div class="empty-output"><div class="audio-orbit"><span>◷</span></div><b>Belum ada riwayat</b><p>Audio yang berhasil dibuat akan muncul di sini.</p></div>';return}list.innerHTML="";state.history.forEach((item)=>{const row=document.createElement("div");row.className="history-item";const icon=document.createElement("span");icon.className="result-icon";icon.textContent="♫";const info=document.createElement("div");const title=document.createElement("b");title.textContent=item.title;const small=document.createElement("small");small.textContent=item.details;info.append(title,small);const link=document.createElement("a");link.href=item.url;link.download="zaida-voice.mp3";link.textContent="↓ Unduh";row.append(icon,info,link);list.append(row)})}
function showView(view){document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$(view==="history"?"historyPage":"studioPage").classList.add("active");$("breadcrumbPage").textContent=view==="history"?"Riwayat audio":"Studio Suara";$("sidebar").classList.remove("open")}
$("scriptText").addEventListener("input",updateCount);$("generateButton").addEventListener("click",()=>generate());$("improveScript").addEventListener("click",improveScript);$("clearText").addEventListener("click",()=>{$("scriptText").value="";updateCount()});$("sampleText").addEventListener("click",()=>{$("scriptText").value=$("scriptLanguage").value==="en"?"Hello, welcome to ZAIDA Voice.\n\nHere, every word can have its own character. Share your message with a warm, clear, and confident voice. Let's create something together.":SAMPLE;updateCount();toast("Contoh naskah ditambahkan.")});$("newProject").addEventListener("click",()=>{$("scriptText").value="";updateCount();showView("studio");$("scriptText").focus()});document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$("mobileMenu").addEventListener("click",()=> $("sidebar").classList.toggle("open"));$("settingsButton").addEventListener("click",()=>{$("advancedContent").hidden=false;$("advancedToggle").setAttribute("aria-expanded","true");$("advancedContent").scrollIntoView({behavior:"smooth",block:"center"})});$("advancedToggle").addEventListener("click",()=>{const hidden=$("advancedContent").hidden;$("advancedContent").hidden=!hidden;$("advancedToggle").setAttribute("aria-expanded",String(hidden))});
[["stability","stabilityValue"],["similarity","similarityValue"],["style","styleValue"]].forEach(([id,out])=>$(id).addEventListener("input",()=>$(out).textContent=$(id).value+"%"));
$("previewVoice").addEventListener("click",()=>{const voice=state.voices.find(v=>v.voice_id===$("voiceSelect").value);if(!voice){toast("Pilih suara terlebih dahulu.");return}if(voice.preview_url){const audio=new Audio(voice.preview_url);audio.play().catch(()=>toast("Preview tidak dapat diputar."))}else toast("Preview belum tersedia untuk suara ini.")});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
updateCount();loadVoices();
$("authButton").addEventListener("click",()=>currentUser?signOut(auth):openAuth());
$("authClose").addEventListener("click",closeAuth);
$("authOverlay").addEventListener("click",e=>{if(e.target===$("authOverlay"))closeAuth()});
$("authSwitch").addEventListener("click",()=>openAuth(authMode==="login"?"register":"login"));
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();const email=$("authEmail").value.trim(),password=$("authPassword").value;
  $("authSubmit").disabled=true;$("authMessage").textContent="Memproses…";
  try{
    if(authMode==="register"){const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user);$("authMessage").textContent="Akun dibuat. Silakan verifikasi email sebelum menggunakan layanan.";}
    else {await signInWithEmailAndPassword(auth,email,password);closeAuth();toast("Berhasil masuk.");}
  }catch(error){const messages={"auth/email-already-in-use":"Email sudah terdaftar.","auth/invalid-email":"Format email tidak valid.","auth/weak-password":"Password minimal 6 karakter.","auth/invalid-credential":"Email atau password salah.","auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti."};$("authMessage").textContent=messages[error.code]||error.message;}
  finally{$("authSubmit").disabled=false;}
});
onAuthStateChanged(auth,user=>{
  currentUser=user;
  $("authButton").textContent=user?(user.email||"Akun")+" · Keluar":"Masuk / Daftar";
  $("profileName").textContent=user?(user.displayName||"Pengguna"):"Pengunjung";
  $("profileEmail").textContent=user?(user.emailVerified?"Akun terverifikasi":"Email belum diverifikasi"):"Belum masuk";
  $("profileAvatar").textContent=user?(user.email||"U").slice(0,1).toUpperCase():"Z";
  $("topAvatar").textContent=user?(user.email||"U").slice(0,1).toUpperCase():"Z";
});
