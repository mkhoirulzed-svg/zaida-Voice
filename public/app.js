import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendEmailVerification, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

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
let accountInfo = null;
async function refreshAccount(){if(!currentUser)return;try{const data=await api("/api/account",{authRequired:true});accountInfo=data;$("adminNav").hidden=data.role!=="admin";$("creditBalance").textContent="Kredit: "+data.credits;$("profileEmail").textContent=(data.role==="admin"?"ADMIN · ":"")+"Saldo "+data.credits+" kredit";}catch(error){$("creditBalance").textContent="Kredit: —";toast(error.message);}}
async function authHeaders(){ if(!auth.currentUser) throw new Error("Silakan masuk terlebih dahulu."); return {Authorization:"Bearer "+await auth.currentUser.getIdToken()}; }
function openAuth(mode="login"){authMode=mode;$("authTitle").textContent=mode==="login"?"Selamat datang.":"Buat akun ZAIDA Voice."; $("authDescription").textContent=mode==="login"?"Masuk untuk mulai membuat audio.":"Daftar menggunakan email aktif."; $("authSubmit").innerHTML=(mode==="login"?"Masuk":"Buat akun")+' <b>→</b>'; $("authSwitch").textContent=mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk"; $("authMessage").textContent="";$("authOverlay").hidden=false;}
function closeAuth(){if(currentUser){$("authOverlay").hidden=true;document.body.classList.remove("auth-required");}}
const $ = (id) => document.getElementById(id);
const state = { voices: [], audioUrl: null, history: [] };
const SAMPLE = "Halo, selamat datang di ZAIDA Voice.\n\nDi sini, setiap kata bisa memiliki karakter. Sampaikan pesanmu dengan suara yang hangat, jelas, dan penuh percaya diri. Mari mulai berkarya.";
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),3200)}
function setBusy(busy,message="Sedang membuat audio…"){$("generateButton").disabled=busy;$("progressWrap").hidden=!busy;$("progressText").textContent=message}
function updateCount(){$("charCount").textContent=$("scriptText").value.length.toLocaleString("id-ID")+" karakter"}
function newRequestId(){return crypto.randomUUID();}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.authRequired?await authHeaders():{}),...(options.headers||{})}});let data;try{data=await response.json()}catch{data={error:"Respons server tidak valid."}}if(!response.ok)throw new Error(data.error||"Permintaan gagal ("+response.status+")");return data}
async function loadVoices(){const select=$("voiceSelect");try{const data=await api("/api/voices");state.voices=data.voices||[];select.innerHTML="";if(!state.voices.length){select.innerHTML='<option value="">Tidak ada suara tersedia</option>';return}state.voices.forEach((voice)=>{const option=document.createElement("option");option.value=voice.voice_id;option.textContent=voice.name+(voice.category?" · "+voice.category:"");select.append(option)});$("voiceStatus").textContent=state.voices.length+" karakter suara tersedia";}catch(error){select.innerHTML='<option value="">Gagal memuat suara</option>';$("voiceStatus").textContent=error.message+" — periksa konfigurasi API";}}
async function generate(textOverride){const text=(textOverride??$("scriptText").value).trim();const voiceId=$("voiceSelect").value;if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk membuat audio.");return}if(!text){toast("Masukkan naskah terlebih dahulu.");return}if(!voiceId){toast("Pilih karakter suara terlebih dahulu.");return}if(text.length>5000){toast("Maksimal 5.000 karakter per proses.");return}
 setBusy(true);try{const response=await fetch("/api/tts",{method:"POST",headers:{"Content-Type":"application/json",...(await authHeaders())},body:JSON.stringify({requestId:newRequestId(),text,voiceId,voiceSettings:{stability:Number($("stability").value)/100,similarity_boost:Number($("similarity").value)/100,style:Number($("style").value)/100}})});if(!response.ok){let error={};try{error=await response.json()}catch{}throw new Error(error.error||"Gagal membuat audio.")}const remaining=response.headers.get("X-Credits-Remaining");if(remaining!==null){$("creditBalance").textContent="Kredit: "+remaining;if(accountInfo)accountInfo.credits=Number(remaining)}const blob=await response.blob();if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(blob);$("audioPlayer").src=state.audioUrl;$("downloadButton").href=state.audioUrl;$("resultTitle").textContent="Narasi "+new Date().toLocaleString("id-ID");$("resultDetails").textContent="MP3 · "+text.length+" karakter · ZAIDA Voice";$("emptyOutput").hidden=true;$("audioResult").hidden=false;const item={title:$("resultTitle").textContent,details:$("resultDetails").textContent,url:state.audioUrl,text};state.history.unshift(item);renderHistory();toast("Audio berhasil dibuat!");}catch(error){toast(error.message)}finally{setBusy(false)}}
async function improveScript(){const text=$("scriptText").value.trim();if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return}if(!text){toast("Tulis topik atau naskah terlebih dahulu.");return}const button=$("improveScript");button.disabled=true;button.textContent="✦ Sedang menyusun…";try{const result=await api("/api/script",{method:"POST",body:JSON.stringify({requestId:newRequestId(),text,task:"polish",language:$("scriptLanguage").value}),authRequired:true});if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining)}$("scriptText").value=result.text||text;updateCount();toast("Naskah berhasil disempurnakan.");}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent="✦ Bantu tulis dengan AI"}}
function renderHistory(){const list=$("historyList");if(!state.history.length){list.innerHTML='<div class="empty-output"><div class="audio-orbit"><span>◷</span></div><b>Belum ada riwayat</b><p>Audio yang berhasil dibuat akan muncul di sini.</p></div>';return}list.innerHTML="";state.history.forEach((item)=>{const row=document.createElement("div");row.className="history-item";const icon=document.createElement("span");icon.className="result-icon";icon.textContent="♫";const info=document.createElement("div");const title=document.createElement("b");title.textContent=item.title;const small=document.createElement("small");small.textContent=item.details;info.append(title,small);const link=document.createElement("a");link.href=item.url;link.download="zaida-voice.mp3";link.textContent="↓ Unduh";row.append(icon,info,link);list.append(row)})}

const assistantState={messages:[],draft:"",busy:false};
function assistantProfile(){return {persona:$("writerName").value.trim(),interests:[...document.querySelectorAll("#interestGrid input:checked")].map(x=>x.value),style:$("writerStyle").value,emotion:$("writerEmotion").value,audience:$("writerAudience").value.trim(),length:$("writerLength").value};}
function restoreAssistantProfile(){try{const p=JSON.parse(localStorage.getItem("zaidaVoiceAssistantProfile")||"{}");if(p.persona)$("writerName").value=p.persona;if(Array.isArray(p.interests))document.querySelectorAll("#interestGrid input").forEach(x=>x.checked=p.interests.includes(x.value));if(p.style)$("writerStyle").value=p.style;if(p.emotion)$("writerEmotion").value=p.emotion;if(p.audience)$("writerAudience").value=p.audience;if(p.length)$("writerLength").value=p.length;}catch{}}
function saveAssistantProfile(){try{localStorage.setItem("zaidaVoiceAssistantProfile",JSON.stringify(assistantProfile()));}catch{}}
restoreAssistantProfile();["writerName","writerStyle","writerEmotion","writerAudience","writerLength"].forEach(id=>$(id).addEventListener("change",saveAssistantProfile));document.querySelectorAll("#interestGrid input").forEach(x=>x.addEventListener("change",saveAssistantProfile));
function addAssistantMessage(role,content){const row=document.createElement("div");row.className="assistant-message "+(role==="assistant"?"ai-message":"user-message");const name=document.createElement("b");name.textContent=role==="assistant"?"ZAIDA Assistant":"Kamu";const p=document.createElement("p");p.textContent=content;row.append(name,p);$("assistantMessages").append(row);$("assistantMessages").scrollTop=$("assistantMessages").scrollHeight;}
async function sendAssistantMessage(){const input=$("assistantInput"),message=input.value.trim();if(!message||assistantState.busy)return;if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return;}if(message.length>3000){toast("Pesan maksimal 3.000 karakter.");return;}assistantState.messages.push({role:"user",content:message});addAssistantMessage("user",message);input.value="";assistantState.busy=true;$("sendAssistant").disabled=true;$("sendAssistant").textContent="Sedang berpikir…";try{const result=await api("/api/assistant",{method:"POST",body:JSON.stringify({requestId:newRequestId(),profile:assistantProfile(),messages:assistantState.messages.slice(-12)}),authRequired:true});if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining)}const answer=(result.reply||"").trim();if(!answer)throw new Error("AI tidak mengembalikan jawaban.");assistantState.messages.push({role:"assistant",content:answer});addAssistantMessage("assistant",answer);const draft=result.script?.trim();if(draft){assistantState.draft=draft;$("useAssistantScript").disabled=false;}}catch(error){assistantState.messages.pop();addAssistantMessage("assistant","Maaf, terjadi kendala: "+error.message);}finally{assistantState.busy=false;$("sendAssistant").disabled=false;$("sendAssistant").innerHTML="<span>✦</span> Kirim pesan <b>→</b>";input.focus();}}
$("sendAssistant").addEventListener("click",sendAssistantMessage);$("assistantInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAssistantMessage();}});
$("clearAssistant").addEventListener("click",()=>{assistantState.messages=[];assistantState.draft="";$("assistantMessages").innerHTML='<div class="assistant-message ai-message"><b>ZAIDA Assistant</b><p>Percakapan baru dimulai. Ceritakan ide konten yang ingin kamu buat.</p></div>';$("useAssistantScript").disabled=true;});
$("useAssistantScript").addEventListener("click",()=>{if(!assistantState.draft)return;$("scriptText").value=assistantState.draft;updateCount();showView("studio");toast("Naskah dikirim ke Voice Studio.");});


function formatRupiah(value){return "Rp"+Math.round(Number(value)||0).toLocaleString("id-ID");}
function escapeHtml(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function formatAdminDate(value){if(!value)return "Waktu tidak tersedia";const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"});}
async function loadAdminDashboard(){
  if(accountInfo?.role!=="admin"){toast("Akses dashboard admin tidak tersedia.");return;}
  const button=$("refreshAdmin");button.disabled=true;button.textContent="Memuat…";
  $("adminTransactionList").innerHTML='<div class="admin-loading">Mengambil data transaksi…</div>';
  try{
    const data=await api("/api/admin/usage",{authRequired:true});
    $("adminMetrics").innerHTML=[
      ["KREDIT TERPAKAI",Number(data.creditsCharged||0).toLocaleString("id-ID")+" kredit","Dari "+(data.count||0)+" transaksi terakhir"],
      ["ESTIMASI BIAYA PROVIDER",formatRupiah(data.providerCostIdr),"≈ $"+Number(data.providerCostUsd||0).toFixed(5)+" USD"],
      ["TRANSAKSI TERCATAT",Number(data.count||0).toLocaleString("id-ID"),"Maksimal 100 data terbaru"]
    ].map(x=>'<div class="admin-metric"><small>'+x[0]+'</small><b>'+x[1]+'</b><span>'+x[2]+'</span></div>').join("");
    $("adminProviders").innerHTML=(data.byProvider||[]).map(p=>'<div class="panel admin-provider"><div class="admin-provider-head"><b>'+escapeHtml(p.provider==="deepseek"?"DeepSeek AI":p.provider==="elevenlabs"?"ElevenLabs TTS":p.provider)+'</b><span>'+Number(p.requests||0)+' proses</span></div><strong>'+formatRupiah(p.providerCostIdr)+'</strong><small>Biaya provider · '+Number(p.creditsCharged||0).toLocaleString("id-ID")+' kredit terpakai</small></div>').join("");
    const transactions=data.transactions||[];
    $("adminTransactionList").innerHTML=transactions.length?transactions.map(t=>'<div class="admin-transaction"><div class="admin-tx-main"><b>'+escapeHtml(t.description||"Pemakaian layanan")+'</b><small>'+escapeHtml(t.provider||"unknown")+' · '+escapeHtml(t.model||"")+' · '+escapeHtml(formatAdminDate(t.createdAt))+'</small></div><div class="admin-tx-values"><b>'+Number(t.amount||0).toLocaleString("id-ID")+' kredit</b><small>'+formatRupiah(t.providerCostIdr||0)+'</small></div></div>').join(""):'<div class="empty-output"><b>Belum ada transaksi</b><p>Transaksi pemakaian akan muncul di sini.</p></div>';
    $("adminUpdated").textContent="Diperbarui "+new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
  }catch(error){$("adminTransactionList").innerHTML='<div class="admin-error">'+escapeHtml(error.message)+'</div>';toast("Laporan admin gagal dimuat: "+error.message);}
  finally{button.disabled=false;button.textContent="↻ Perbarui data";}
}
$("refreshAdmin").addEventListener("click",loadAdminDashboard);

function showView(view){document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===view));$(view==="history"?"historyPage":view==="writer"?"writerPage":view==="admin"?"adminPage":"studioPage").classList.add("active");$("breadcrumbPage").textContent=view==="history"?"Riwayat audio":view==="writer"?"AI Script Assistant":view==="admin"?"Dashboard Admin":"Studio Suara";if(view==="admin")loadAdminDashboard();$("sidebar").classList.remove("open")}
$("scriptText").addEventListener("input",updateCount);$("generateButton").addEventListener("click",()=>generate());$("improveScript").addEventListener("click",improveScript);$("clearText").addEventListener("click",()=>{$("scriptText").value="";updateCount()});$("sampleText").addEventListener("click",()=>{$("scriptText").value=$("scriptLanguage").value==="en"?"Hello, welcome to ZAIDA Voice.\n\nHere, every word can have its own character. Share your message with a warm, clear, and confident voice. Let's create something together.":SAMPLE;updateCount();toast("Contoh naskah ditambahkan.")});$("newProject").addEventListener("click",()=>{$("scriptText").value="";updateCount();showView("studio");$("scriptText").focus()});document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$("mobileMenu").addEventListener("click",()=> $("sidebar").classList.toggle("open"));$("settingsButton").addEventListener("click",()=>{$("advancedContent").hidden=false;$("advancedToggle").setAttribute("aria-expanded","true");$("advancedContent").scrollIntoView({behavior:"smooth",block:"center"})});$("advancedToggle").addEventListener("click",()=>{const hidden=$("advancedContent").hidden;$("advancedContent").hidden=!hidden;$("advancedToggle").setAttribute("aria-expanded",String(hidden))});
[["stability","stabilityValue"],["similarity","similarityValue"],["style","styleValue"]].forEach(([id,out])=>$(id).addEventListener("input",()=>$(out).textContent=$(id).value+"%"));
$("previewVoice").addEventListener("click",()=>{const voice=state.voices.find(v=>v.voice_id===$("voiceSelect").value);if(!voice){toast("Pilih suara terlebih dahulu.");return}if(voice.preview_url){const audio=new Audio(voice.preview_url);audio.play().catch(()=>toast("Preview tidak dapat diputar."))}else toast("Preview belum tersedia untuk suara ini.")});
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
updateCount();loadVoices();
$("authButton").addEventListener("click",()=>currentUser?signOut(auth):openAuth());
$("googleAuthButton").addEventListener("click",async()=>{const button=$("googleAuthButton");button.disabled=true;$("authMessage").textContent="Menghubungkan ke Google…";try{const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});await signInWithPopup(auth,provider);closeAuth();toast("Berhasil masuk dengan Google.");}catch(error){const messages={"auth/popup-closed-by-user":"Jendela login ditutup sebelum selesai.","auth/popup-blocked":"Popup diblokir browser. Izinkan popup lalu coba lagi.","auth/account-exists-with-different-credential":"Email ini sudah terdaftar dengan metode login lain."};$("authMessage").textContent=messages[error.code]||error.message;}finally{button.disabled=false;}});
$("resendVerification").addEventListener("click",async()=>{try{if(!auth.currentUser)throw new Error("Masuk kembali menggunakan email dan password.");await sendEmailVerification(auth.currentUser);$("authMessage").textContent="Email verifikasi telah dikirim ulang.";}catch(error){$("authMessage").textContent=error.message;}});
$("authClose").addEventListener("click",closeAuth);
$("authOverlay").addEventListener("click",e=>{if(e.target===$("authOverlay"))closeAuth()});
$("authSwitch").addEventListener("click",()=>openAuth(authMode==="login"?"register":"login"));
$("authForm").addEventListener("submit",async e=>{
  e.preventDefault();const email=$("authEmail").value.trim(),password=$("authPassword").value;
  $("authSubmit").disabled=true;$("authMessage").textContent="Memproses…";
  try{
    if(authMode==="register"){const credential=await createUserWithEmailAndPassword(auth,email,password);await sendEmailVerification(credential.user);await signOut(auth);$("authMessage").textContent="Akun dibuat. Buka email verifikasi, lalu masuk kembali.";}
    else {await signInWithEmailAndPassword(auth,email,password);closeAuth();toast("Berhasil masuk.");}
  }catch(error){const messages={"auth/email-already-in-use":"Email sudah terdaftar.","auth/invalid-email":"Format email tidak valid.","auth/weak-password":"Password minimal 6 karakter.","auth/invalid-credential":"Email atau password salah.","auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti."};$("authMessage").textContent=messages[error.code]||error.message;}
  finally{$("authSubmit").disabled=false;}
});
onAuthStateChanged(auth,user=>{
  currentUser=user&&user.emailVerified?user:null;
  const allowed=Boolean(currentUser);
  document.body.classList.toggle("auth-required",!allowed);
  $("authOverlay").hidden=allowed;
  $("authButton").textContent=allowed?(user.email||"Akun")+" · Keluar":"Masuk / Daftar";
  $("profileName").textContent=allowed?(user.displayName||"Pengguna"):"Pengunjung";
  $("profileEmail").textContent=allowed?"Akun terverifikasi":(user?"Email belum diverifikasi":"Belum masuk");
  $("profileAvatar").textContent=allowed?(user.displayName||user.email||"U").slice(0,1).toUpperCase():"Z";
  $("topAvatar").textContent=allowed?(user.displayName||user.email||"U").slice(0,1).toUpperCase():"Z";
  $("resendVerification").hidden=!(user&&!user.emailVerified);
  if(allowed){refreshAccount();}else{$("creditBalance").textContent="Kredit: —";accountInfo=null;$("adminNav").hidden=true;}
  if(user&&!user.emailVerified){$("authMessage").textContent="Verifikasi email terlebih dahulu. Setelah itu, masuk kembali untuk membuka ZAIDA Voice.";$("authOverlay").hidden=false;}
});
