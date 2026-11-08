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
let pendingPackageId = new URLSearchParams(location.search).get("buy");
let checkoutStarted = false;
let personaReady = Promise.resolve();
async function refreshAccount(){if(!currentUser)return;try{const data=await api("/api/account",{authRequired:true});accountInfo=data;$("adminNav").hidden=data.role!=="admin";$("creditBalance").hidden=false;$("creditBalance").textContent="Kredit: "+Number(data.credits).toLocaleString("id-ID");$("sidebarCreditBalance").textContent=Number(data.credits).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+data.credits;$("profileEmail").textContent=data.role==="admin"?"Administrator":"Akun terverifikasi";}catch(error){$("creditBalance").hidden=false;$("creditBalance").textContent="Kredit: —";$("sidebarCreditBalance").textContent="Saldo tidak tersedia";toast(error.message);}}
async function authHeaders(){ if(!auth.currentUser) throw new Error("Silakan masuk terlebih dahulu."); return {Authorization:"Bearer "+await auth.currentUser.getIdToken()}; }
function openAuth(mode="login"){authMode=mode;$("authTitle").textContent=mode==="login"?"Selamat datang.":"Buat akun ZAIDA Voice."; $("authDescription").textContent=mode==="login"?"Masuk untuk mulai membuat audio.":"Daftar menggunakan email aktif."; $("authSubmit").textContent=mode==="login"?"Masuk":"Buat akun"; $("authSwitch").textContent=mode==="login"?"Belum punya akun? Daftar":"Sudah punya akun? Masuk"; $("authMessage").textContent="";$("authOverlay").hidden=false;}
function closeAuth(){$("authOverlay").hidden=true;}
const $ = (id) => document.getElementById(id);
const state = { voices: [], audioUrl: null, downloadUrl: null, audioBlob: null, history: [], alignment: null, subtitles: [], currentStep: 1, sourceText: "", voicePage: 0, catalogVoicePage: 0, previewAudio: null };
const SAMPLE = "Halo, selamat datang di ZAIDA Voice.\n\nDi sini, setiap kata bisa memiliki karakter. Sampaikan pesanmu dengan suara yang hangat, jelas, dan penuh percaya diri. Mari mulai berkarya.";
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),3200)}
function setBusy(busy,message="Sedang membuat audio…"){$("generateButton").disabled=busy;$("dockAction").disabled=busy;$("generateButton").textContent=busy?"Sedang membuat audio…":"Buat Audio";$("progressWrap").hidden=!busy;$("progressText").textContent=message}
function id3Synchsafe(size){return new Uint8Array([(size>>21)&127,(size>>14)&127,(size>>7)&127,size&127]);}
function id3TextFrame(id,value){const payload=new Uint8Array([3,...new TextEncoder().encode(String(value||""))]);const frame=new Uint8Array(10+payload.length);frame.set(new TextEncoder().encode(id),0);frame.set(id3Synchsafe(payload.length),4);frame.set(payload,10);return frame;}
function createTaggedMp3(blob,voiceName){const frames=[id3TextFrame("TIT2","Narasi ZAIDA Voice"),id3TextFrame("TPE1",voiceName||"ZAIDA Voice"),id3TextFrame("TALB","ZAIDA Voice")];const length=frames.reduce((sum,x)=>sum+x.length,0),header=new Uint8Array([73,68,51,4,0,0,...id3Synchsafe(length)]);return new Blob([header,...frames,blob],{type:"audio/mpeg"});}
function updateDownloadLink(){if(!state.audioBlob)return;if(state.downloadUrl)URL.revokeObjectURL(state.downloadUrl);const selected=state.voices.find(v=>v.voice_id===$("voiceSelect").value);const blob=$("includeMetadataTags").checked?createTaggedMp3(state.audioBlob,selected?.name):state.audioBlob;state.downloadUrl=URL.createObjectURL(blob);$("downloadButton").href=state.downloadUrl;}
function formatAudioDuration(seconds){const total=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(total/60)+":"+String(total%60).padStart(2,"0");}
function newRequestId(){return crypto.randomUUID();}
async function api(path,options={}){const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.authRequired?await authHeaders():{}),...(options.headers||{})}});let data;try{data=await response.json()}catch{data={error:"Respons server tidak valid."}}if(!response.ok)throw new Error(data.error||"Permintaan gagal ("+response.status+")");return data}
async function startPackageCheckout(packageId){
  if(!currentUser){pendingPackageId=packageId;openAuth();return;}
  if(checkoutStarted)return;
  checkoutStarted=true;
  try{
    const result=await api("/api/payment/create",{method:"POST",authRequired:true,body:JSON.stringify({packageId})});
    if(!result.redirectUrl)throw new Error("Tautan pembayaran tidak diterima.");
    location.assign(result.redirectUrl);
  }catch(error){checkoutStarted=false;toast(error.message);}
}
async function checkReturnedPayment(){
  const params=new URLSearchParams(location.search);
  if(params.get("payment")!=="finish")return;
  const orderId=params.get("order_id");
  if(!orderId||!currentUser)return;
  try{
    let result;
    for(let attempt=0;attempt<4;attempt++){
      result=await api("/api/payment/status?order_id="+encodeURIComponent(orderId),{authRequired:true});
      if(result.status==="paid")break;
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    await refreshAccount();
    toast(result?.status==="paid"?"Pembayaran berhasil! Kredit sudah ditambahkan.":"Pembayaran sedang diverifikasi. Saldo akan diperbarui setelah Midtrans mengonfirmasi.");
  }catch(error){toast("Belum dapat memeriksa pembayaran: "+error.message);}
  history.replaceState({},document.title,location.pathname);
}
async function improveScript(){const text=$("scriptText").value.trim();if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return}if(!text){toast("Tulis topik atau naskah terlebih dahulu.");return}const button=$("improveScript");button.disabled=true;button.textContent="Menyusun…";try{const result=await api("/api/script",{method:"POST",body:JSON.stringify({requestId:newRequestId(),text,task:"polish",language:$("scriptLanguage").value}),authRequired:true});if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;$("sidebarCreditBalance").textContent=Number(result.creditsRemaining).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining)}$("scriptText").value=result.text||text;updateCount();const providerLabel=result.provider==="kiosapi"?"Kiosapi":result.provider==="deepseek-direct"?"DeepSeek langsung":"Provider belum terdeteksi";const modelLabel=result.model?" · "+result.model:"";toast("Naskah berhasil diperbarui.");}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent="Perbaiki naskah"}}
async function addAudioTags(){const text=$("scriptText").value.trim();if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return}if(!text){toast("Tulis naskah terlebih dahulu.");return}const button=$("addAudioTags");button.disabled=true;button.textContent="Menambah tag…";try{const result=await api("/api/script",{method:"POST",body:JSON.stringify({requestId:newRequestId(),text,task:"audio_tags",language:$("scriptLanguage").value}),authRequired:true});if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;$("sidebarCreditBalance").textContent=Number(result.creditsRemaining).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining)}$("scriptText").value=result.text||text;updateCount();toast("Audio Tags ditambahkan. Periksa naskah sebelum membuat suara.");}catch(error){toast(error.message)}finally{button.disabled=false;button.textContent="Tambahkan Tags"}}
function renderHistory(){
  const list=$("historyList");
  if(!state.history.length){list.innerHTML='<div class="empty-output"><b>Belum ada riwayat</b></div>';return;}
  list.innerHTML="";
  state.history.forEach(item=>{
    const row=document.createElement("div");row.className="history-item";
    const icon=document.createElement("span");icon.className="result-icon";icon.innerHTML='<svg viewBox="0 0 24 24"><path d="M4 10v4m4-8v12m4-16v20m4-14v8m4-11v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const info=document.createElement("div"),title=document.createElement("b"),small=document.createElement("small");
    title.textContent=item.title;small.textContent=item.details;info.append(title,small);
    const link=document.createElement("a");link.href=item.url;link.download="zaida-voice.mp3";link.textContent="Unduh";
    row.append(icon,info,link);list.append(row);
  });
}

const scriptAssistantState={messages:[],draft:"",busy:false};
const superChatState={messages:[],draft:"",busy:false};
function assistantProfile(){return {persona:$("writerName").value.trim(),interests:[...document.querySelectorAll("#interestGrid input:checked")].map(x=>x.value),style:$("writerStyle").value,emotion:$("writerEmotion").value,audience:$("writerAudience").value.trim(),length:$("writerLength").value};}
function applyAssistantProfile(p={}){if(p.persona!==undefined)$("writerName").value=p.persona||"";if(Array.isArray(p.interests))document.querySelectorAll("#interestGrid input").forEach(x=>x.checked=p.interests.includes(x.value));if(p.style)$("writerStyle").value=p.style;if(p.emotion)$("writerEmotion").value=p.emotion;if(p.audience!==undefined)$("writerAudience").value=p.audience||"";if(p.length)$("writerLength").value=p.length;syncChoiceChips();if($("settingsWriterLength"))$("settingsWriterLength").value=$("writerLength").value;}
async function loadPersonaProfile(){if(!currentUser)return;const defaults={persona:"",interests:[],style:"santai dan akrab",emotion:"natural dan netral",audience:"",length:"fleksibel sesuai kebutuhan"};applyAssistantProfile(defaults);try{const result=await api("/api/persona",{authRequired:true});applyAssistantProfile(result.profile||defaults);$("personaSaveStatus").textContent="Persona tersimpan di akun ini";}catch(error){$("personaSaveStatus").textContent="Persona belum dapat dimuat";toast("Persona belum dapat dimuat: "+error.message);}}
async function savePersonaProfile(){if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menyimpan Persona Saya.");return;}const button=$("savePersonaButton");button.disabled=true;button.textContent="Menyimpan…";$("personaSaveStatus").textContent="Menyimpan persona…";try{const profile=assistantProfile();await api("/api/persona",{method:"PUT",authRequired:true,body:JSON.stringify({profile})});$("personaSaveStatus").textContent="Tersimpan di akun kamu";toast("Persona berhasil disimpan.");}catch(error){$("personaSaveStatus").textContent="Gagal menyimpan";toast(error.message);}finally{button.disabled=false;button.textContent="Simpan persona";}}
["writerName","writerStyle","writerEmotion","writerAudience","writerLength"].forEach(id=>$(id).addEventListener("input",()=>$("personaSaveStatus").textContent="Ada perubahan yang belum disimpan"));
document.querySelectorAll("#interestGrid input").forEach(x=>x.addEventListener("change",()=>$("personaSaveStatus").textContent="Ada perubahan yang belum disimpan"));
$("savePersonaButton").addEventListener("click",savePersonaProfile);
function addAssistantMessage(role,content){
  const row=document.createElement("div");row.className="assistant-message "+(role==="assistant"?"ai-message":"user-message");
  if(role==="user"){const name=document.createElement("b");name.textContent="Kamu";row.append(name);}
  const p=document.createElement("p");row.append(p);$("assistantMessages").append(row);
  if(role==="assistant"){
    row.classList.add("typing-message");let i=0;const step=content.length>900?3:2;
    const timer=setInterval(()=>{i=Math.min(content.length,i+step);p.textContent=content.slice(0,i);$("assistantMessages").scrollTop=$("assistantMessages").scrollHeight;if(i>=content.length){clearInterval(timer);row.classList.remove("typing-message");}},18);
  }else p.textContent=content;
  $("assistantMessages").scrollTop=$("assistantMessages").scrollHeight;
}
function addAssistantThinking(){
  const row=document.createElement("div");row.className="assistant-message ai-message assistant-thinking";
  const label=document.createElement("span");label.textContent="Sedang berpikir";
  const dots=document.createElement("span");dots.className="assistant-thinking-dots";dots.setAttribute("aria-hidden","true");dots.textContent="•••";
  row.append(label,dots);$("assistantMessages").append(row);$("assistantMessages").scrollTop=$("assistantMessages").scrollHeight;return row;
}
function addAssistantDraft(content){
  const row=document.createElement("div");row.className="assistant-message ai-message assistant-draft";
  const title=document.createElement("b");title.className="assistant-draft-title";title.textContent="Draf Naskah";
  const note=document.createElement("span");note.className="assistant-draft-note";note.textContent="Kamu bisa mengedit naskah ini sebelum digunakan.";
  const editor=document.createElement("textarea");editor.className="assistant-draft-editor";editor.rows=7;editor.value=content;editor.setAttribute("aria-label","Edit hasil naskah dari AI");
  editor.addEventListener("input",()=>{scriptAssistantState.draft=editor.value;$("useAssistantScript").disabled=!editor.value.trim();});
  row.append(title,note,editor);$("assistantMessages").append(row);$("assistantMessages").scrollTop=$("assistantMessages").scrollHeight;
}
async function sendAssistantMessage(){
  const input=$("assistantInput"),message=input.value.trim();
  if(!message||scriptAssistantState.busy)return;
  if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return;}
  await personaReady;
  if(message.length>3000){toast("Pesan maksimal 3.000 karakter.");return;}
  scriptAssistantState.messages.push({role:"user",content:message});addAssistantMessage("user",message);
  input.value="";input.style.height="32px";input.closest(".chat-compose").classList.remove("has-text");
  scriptAssistantState.busy=true;const sendButton=$("sendAssistant");sendButton.disabled=true;sendButton.classList.add("is-loading");sendButton.setAttribute("aria-label","AI sedang berpikir");
  const thinking=addAssistantThinking();
  try{
    const result=await api("/api/assistant",{method:"POST",body:JSON.stringify({requestId:newRequestId(),profile:assistantProfile(),messages:scriptAssistantState.messages.slice(-12),mode:"script-assistant"}),authRequired:true});
    if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;$("sidebarCreditBalance").textContent=Number(result.creditsRemaining).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining);}
    const answer=(result.reply||"").trim();if(!answer)throw new Error("AI tidak mengembalikan jawaban.");
    scriptAssistantState.messages.push({role:"assistant",content:answer});addAssistantMessage("assistant",answer);
    const draft=result.script?.trim();if(draft){scriptAssistantState.draft=draft;$("useAssistantScript").disabled=false;addAssistantDraft(draft);}
    toast("Balasan diterima.");
  }catch(error){scriptAssistantState.messages.pop();addAssistantMessage("assistant","Maaf, terjadi kendala: "+error.message);}
  finally{thinking.remove();scriptAssistantState.busy=false;sendButton.disabled=false;sendButton.classList.remove("is-loading");sendButton.setAttribute("aria-label","Kirim pesan");input.focus();}
}
$("sendAssistant").addEventListener("click",sendAssistantMessage);
$("assistantInput").addEventListener("input",()=>{const el=$("assistantInput");el.style.height="auto";el.style.height=Math.min(el.scrollHeight,150)+"px";el.closest(".chat-compose").classList.toggle("has-text",Boolean(el.value.trim()));});
$("assistantInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendAssistantMessage();}});
$("clearAssistant").addEventListener("click",e=>{e.preventDefault();e.stopPropagation();scriptAssistantState.messages=[];scriptAssistantState.draft="";$("assistantMessages").innerHTML='<div class="assistant-message ai-message"><p>Percakapan baru dimulai. Ceritakan ide konten yang ingin kamu buat.</p></div>';$("useAssistantScript").disabled=true;});
$("useAssistantScript").addEventListener("click",()=>{if(!scriptAssistantState.draft)return;$("scriptText").value=scriptAssistantState.draft;updateCount();showView("studio");setStep(1);toast("Naskah digunakan.");});

function addStandaloneAssistantMessage(role,content){
  const box=$("standaloneAssistantMessages");
  const row=document.createElement("div");row.className="assistant-message "+(role==="assistant"?"ai-message":"user-message");
  if(role==="user"){const name=document.createElement("b");name.textContent="Kamu";row.append(name);}
  const p=document.createElement("p");row.append(p);box.append(row);
  if(role==="assistant"){
    row.classList.add("typing-message");let i=0;const step=content.length>900?3:2;
    const timer=setInterval(()=>{i=Math.min(content.length,i+step);p.textContent=content.slice(0,i);box.scrollTop=box.scrollHeight;if(i>=content.length){clearInterval(timer);row.classList.remove("typing-message");}},18);
  }else p.textContent=content;
  box.scrollTop=box.scrollHeight;
}
function addStandaloneThinking(){
  const row=document.createElement("div");row.className="assistant-message ai-message assistant-thinking";
  const label=document.createElement("span");label.textContent="Sedang berpikir";
  const dots=document.createElement("span");dots.className="assistant-thinking-dots";dots.setAttribute("aria-hidden","true");dots.textContent="•••";
  row.append(label,dots);$("standaloneAssistantMessages").append(row);$("standaloneAssistantMessages").scrollTop=$("standaloneAssistantMessages").scrollHeight;return row;
}
function addStandaloneDraft(content){
  const row=document.createElement("div");row.className="assistant-message ai-message assistant-draft";
  const title=document.createElement("b");title.className="assistant-draft-title";title.textContent="Draf Naskah";
  const note=document.createElement("span");note.className="assistant-draft-note";note.textContent="Kamu bisa mengedit naskah ini sebelum digunakan.";
  const editor=document.createElement("textarea");editor.className="assistant-draft-editor";editor.rows=7;editor.value=content;editor.setAttribute("aria-label","Edit hasil naskah dari AI");
  editor.addEventListener("input",()=>{superChatState.draft=editor.value;$("standaloneUseAssistantScript").disabled=!editor.value.trim();});
  row.append(title,note,editor);$("standaloneAssistantMessages").append(row);$("standaloneAssistantMessages").scrollTop=$("standaloneAssistantMessages").scrollHeight;
}
async function sendStandaloneAssistantMessage(){
  const input=$("standaloneAssistantInput"),message=input.value.trim();
  if(!message||superChatState.busy)return;
  if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menggunakan AI.");return;}
  await personaReady;
  if(message.length>3000){toast("Pesan maksimal 3.000 karakter.");return;}
  superChatState.busy=true;const sendButton=$("standaloneSendAssistant");sendButton.disabled=true;sendButton.classList.add("is-loading");sendButton.setAttribute("aria-label","AI sedang berpikir");
  superChatState.messages.push({role:"user",content:message});addStandaloneAssistantMessage("user",message);
  input.value="";input.style.height="32px";input.closest(".chat-compose").classList.remove("has-text");
  const thinking=addStandaloneThinking();
  try{
    const result=await api("/api/assistant",{method:"POST",body:JSON.stringify({requestId:newRequestId(),profile:assistantProfile(),messages:superChatState.messages.slice(-12),mode:"super-chat"}),authRequired:true});
    if(result.creditsRemaining!==undefined){$("creditBalance").textContent="Kredit: "+result.creditsRemaining;$("sidebarCreditBalance").textContent=Number(result.creditsRemaining).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+result.creditsRemaining;if(accountInfo)accountInfo.credits=Number(result.creditsRemaining);}
    const answer=(result.reply||"").trim();if(!answer)throw new Error("AI tidak mengembalikan jawaban.");
    superChatState.messages.push({role:"assistant",content:answer});addStandaloneAssistantMessage("assistant",answer);
    const draft=result.script?.trim();if(draft){superChatState.draft=draft;$("standaloneUseAssistantScript").disabled=false;addStandaloneDraft(draft);}
    toast("Balasan diterima.");
  }catch(error){
    superChatState.messages.pop();
    addStandaloneAssistantMessage("assistant","Maaf, terjadi kendala: "+error.message);
  }finally{
    thinking.remove();superChatState.busy=false;sendButton.disabled=false;sendButton.classList.remove("is-loading");sendButton.setAttribute("aria-label","Kirim pesan");input.focus();
  }
}
$("standaloneSendAssistant").addEventListener("click",sendStandaloneAssistantMessage);
$("standaloneAssistantInput").addEventListener("input",()=>{const el=$("standaloneAssistantInput");el.style.height="auto";el.style.height=Math.min(el.scrollHeight,150)+"px";el.closest(".chat-compose").classList.toggle("has-text",Boolean(el.value.trim()));});
$("standaloneAssistantInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendStandaloneAssistantMessage();}});
$("clearStandaloneAssistant").addEventListener("click",()=>{$("standaloneAssistantMessages").innerHTML='<div class="assistant-message ai-message"><p>Percakapan baru dimulai. Ceritakan ide konten yang ingin kamu buat.</p></div>';superChatState.messages=[];superChatState.draft="";$("standaloneUseAssistantScript").disabled=true;});
$("standaloneUseAssistantScript").addEventListener("click",()=>{if(!superChatState.draft)return;$("scriptText").value=superChatState.draft;updateCount();showView("studio");setStep(1);toast("Naskah digunakan.");});


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
    $("adminProviders").innerHTML=(data.byProvider||[]).map(p=>'<div class="panel admin-provider"><div class="admin-provider-head"><b>'+escapeHtml(p.provider==="elevenlabs"?"Pembuatan suara":p.provider==="kiosapi"||p.provider==="deepseek"?"Penyusunan naskah":"Layanan AI")+'</b><span>'+Number(p.requests||0)+' proses</span></div><strong>'+formatRupiah(p.providerCostIdr)+'</strong><small>Biaya provider · '+Number(p.creditsCharged||0).toLocaleString("id-ID")+' kredit terpakai</small></div>').join("");
    const transactions=data.transactions||[];
    $("adminTransactionList").innerHTML=transactions.length?transactions.map(t=>'<div class="admin-transaction"><div class="admin-tx-main"><b>'+escapeHtml(t.description||"Pemakaian layanan")+'</b><small>'+escapeHtml(formatAdminDate(t.createdAt))+'</small></div><div class="admin-tx-values"><b>'+Number(t.amount||0).toLocaleString("id-ID")+' kredit</b><small>'+formatRupiah(t.providerCostIdr||0)+'</small></div></div>').join(""):'<div class="empty-output"><b>Belum ada transaksi</b><p>Transaksi pemakaian akan muncul di sini.</p></div>';
    $("adminUpdated").textContent="Diperbarui "+new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
  }catch(error){$("adminTransactionList").innerHTML='<div class="admin-error">'+escapeHtml(error.message)+'</div>';toast("Laporan admin gagal dimuat: "+error.message);}
  finally{button.disabled=false;button.textContent="Perbarui data";}
}
$("refreshAdmin").addEventListener("click",loadAdminDashboard);
$("adminCreditForm").addEventListener("submit",async event=>{
  event.preventDefault();
  if(accountInfo?.role!=="admin"){toast("Akses admin diperlukan.");return;}
  const button=$("adminCreditSubmit");button.disabled=true;button.textContent="Memproses…";
  try{
    const result=await api("/api/admin/usage",{method:"POST",authRequired:true,body:JSON.stringify({email:$("adminCreditEmail").value,credits:Number($("adminCreditAmount").value)})});
    toast("Berhasil! "+result.email+" mendapat "+Number(result.creditsAdded).toLocaleString("id-ID")+" kredit. Saldo: "+Number(result.balance).toLocaleString("id-ID")+".");
    $("adminCreditForm").reset();$("adminCreditAmount").value=10000;await loadAdminDashboard();
  }catch(error){toast("Gagal menambah kredit: "+error.message);}
  finally{button.disabled=false;button.textContent="Tambahkan kredit";}
});

function closeSidebar(){
  $("sidebar").classList.remove("open");$("sidebarBackdrop").hidden=true;document.body.classList.remove("sidebar-open");
}
function renderStandaloneConversation(){
  const box=$("standaloneAssistantMessages");box.innerHTML="";
  if(!superChatState.messages.length){
    box.innerHTML='<div class="assistant-message ai-message"><p>Halo! Aku ZAIDA AI. Ada yang ingin kamu diskusikan atau tanyakan?</p></div>';
  }else{
    superChatState.messages.forEach(item=>addStandaloneAssistantMessage(item.role,item.content));
  }
  if(superChatState.draft)addStandaloneDraft(superChatState.draft);
  $("standaloneUseAssistantScript").disabled=!superChatState.draft;
  box.scrollTop=box.scrollHeight;
}
function showView(requestedView){
  let view=requestedView;
  if(view==="subtitle"){
    if(!state.audioUrl){toast("Buat suara sebelum menyiapkan subtitle.");view="studio";setStep(2);}
    else{view="studio";setStep(3);$("includeSubtitle").checked=true;$("subtitlePreviewToggle").hidden=false;$("subtitleOptions").hidden=false;$("subtitlePreviewToggle").textContent="Tutup Preview";$("subtitlePreviewToggle").setAttribute("aria-expanded","true");renderSubtitles();}
  }
  const pageId={studio:"studioPage",voices:"voicesPage",history:"historyPage",admin:"adminPage",assistant:"assistantPage",persona:"personaPage",video:"videoStudioPage"}[view]||"studioPage";
  document.body.classList.toggle("in-studio",view==="studio");
  document.body.classList.toggle("video-studio-page",view==="video");
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  $(pageId).classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.view===requestedView));
  $("breadcrumbPage").textContent=({studio:"Voice Studio",voices:"Voices",history:"Riwayat",subtitle:"Subtitle",assistant:"AI Super Chat",persona:"Persona Saya",admin:"Dashboard admin",video:"Auto Video Studio"})[requestedView]||"Voice Studio";
  if(view==="admin")loadAdminDashboard();
  if(view==="assistant")renderStandaloneConversation();
  if(view==="video")window.dispatchEvent(new Event("zaida:video-page-open"));
  if(view==="persona"&&!currentUser){openAuth();toast("Persona Saya hanya tersedia untuk pengguna yang sudah masuk.");showView("studio");return;}
  closeSidebar();
}
$("scriptText").addEventListener("input",updateCount);$("editScriptFromVoice").addEventListener("click",()=>{setStep(1);$("scriptText").focus();});$("generateButton").addEventListener("click",()=>generate());$("improveScript").addEventListener("click",improveScript);$("addAudioTags").addEventListener("click",addAudioTags);$("clearText").addEventListener("click",()=>{$("scriptText").value="";updateCount()});$("newProject").addEventListener("click",()=>{$("scriptText").value="";state.audioUrl=null;state.audioBlob=null;if(state.downloadUrl)URL.revokeObjectURL(state.downloadUrl);state.downloadUrl=null;state.alignment=null;state.subtitles=[];state.sourceText="";$("includeSubtitle").checked=false;$("includeMetadataTags").checked=false;$("subtitleOptions").hidden=true;$("subtitlePreviewToggle").hidden=true;$("subtitlePreviewToggle").textContent="Preview Subtitle";$("subtitlePreviewToggle").setAttribute("aria-expanded","false");$("audioPlayer").pause();$("audioPlayer").removeAttribute("src");$("resultAudio").pause();$("resultAudio").removeAttribute("src");$("downloadButton").removeAttribute("href");$("resultTitle").textContent="Audio belum dibuat";$("resultDetails").textContent="MP3";$("dockTrack").textContent="Belum ada audio";renderSubtitles();updateCount();showView("studio");setStep(1);$("scriptText").focus()});document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));$("openVoicesCatalog").addEventListener("click",e=>{e.preventDefault();showView("voices");});$("studioVoicePreview").addEventListener("click",()=>{const voice=state.voices.find(v=>v.voice_id===$("voiceSelect").value);if(!voice||!voice.preview_url){toast("Pratinjau tidak tersedia untuk suara ini.");return;}stopVoicePreview();const audio=new Audio(voice.preview_url);state.previewAudio=audio;audio.addEventListener("ended",()=>{if(state.previewAudio===audio)state.previewAudio=null;$("studioVoicePreview").textContent="▶";},{once:true});$("studioVoicePreview").textContent="…";audio.play().catch(()=>{if(state.previewAudio===audio)state.previewAudio=null;$("studioVoicePreview").textContent="▶";toast("Pratinjau tidak dapat diputar.");});});$("voiceSelect").addEventListener("change",()=>{$("studioVoicePreview").textContent="▶";updateDownloadLink();});$("mobileMenu").addEventListener("click",()=>{const open=!$("sidebar").classList.contains("open");$("sidebar").classList.toggle("open",open);$("sidebarBackdrop").hidden=!open;document.body.classList.toggle("sidebar-open",open);});$("sidebarClose").addEventListener("click",closeSidebar);$("sidebarBackdrop").addEventListener("click",closeSidebar);$("settingsButton").addEventListener("click",()=>showView("persona"));
async function loadStudioSettings(){
  if(!currentUser)return;
  try{
    const result=await api("/api/settings",{authRequired:true});
    const s=result.settings||{};
    $("includeSubtitle").checked=s.includeSubtitle===true;
    $("includeMetadataTags").checked=s.includeMetadataTags===true;
    if(s.writerLength)$("writerLength").value=s.writerLength;
    $("settingsWriterLength").value=$("writerLength").value;
    $("writerLength").dispatchEvent(new Event("input",{bubbles:true}));
    updateDownloadLink();
    $("studioSettingsSaveStatus").textContent="";
  }catch(error){$("studioSettingsSaveStatus").textContent="Pengaturan belum dapat dimuat";}
}
async function saveStudioSettings(){
  if(!currentUser){openAuth();toast("Masuk terlebih dahulu untuk menyimpan pengaturan.");return;}
  const button=$("saveStudioSettings");
  button.disabled=true;button.textContent="Menyimpan…";
  $("studioSettingsSaveStatus").textContent="Menyimpan ke akun…";
  const settings={
    includeSubtitle:$("includeSubtitle").checked,
    includeMetadataTags:$("includeMetadataTags").checked,
    writerLength:$("settingsWriterLength").value
  };
  try{
    const result=await api("/api/settings",{method:"PUT",authRequired:true,body:JSON.stringify({settings})});
    $("includeSubtitle").checked=result.settings.includeSubtitle;
    $("includeMetadataTags").checked=result.settings.includeMetadataTags;
    $("writerLength").value=result.settings.writerLength;
    $("settingsWriterLength").value=result.settings.writerLength;
    $("writerLength").dispatchEvent(new Event("input",{bubbles:true}));
    updateDownloadLink();
    $("studioSettingsSaveStatus").textContent="Tersimpan di akun kamu";
    toast("Pengaturan berhasil disimpan.");
  }catch(error){
    $("studioSettingsSaveStatus").textContent="Gagal menyimpan";
    toast(error.message);
  }finally{button.disabled=false;button.textContent="Simpan";}
}
function closeStudioSettings(){$("studioSettingsOverlay").hidden=true;}
$("openStudioSettings").addEventListener("click",()=>{$("settingsWriterLength").value=$("writerLength").value;$("studioSettingsOverlay").hidden=false;if(currentUser)loadStudioSettings();else $("studioSettingsSaveStatus").textContent="Masuk untuk menyimpan pengaturan ke akun";});
$("saveStudioSettings").addEventListener("click",saveStudioSettings);
$("closeStudioSettings").addEventListener("click",closeStudioSettings);
$("studioSettingsOverlay").addEventListener("click",e=>{if(e.target===$("studioSettingsOverlay"))closeStudioSettings();});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("studioSettingsOverlay").hidden)closeStudioSettings();});
$("settingsWriterLength").addEventListener("change",()=>{$("writerLength").value=$("settingsWriterLength").value;$("writerLength").dispatchEvent(new Event("input",{bubbles:true}));});
$("includeMetadataTags").addEventListener("change",updateDownloadLink);
$("addAudioTags").addEventListener("click",()=>closeStudioSettings());
[["stability","stabilityValue"],["similarity","similarityValue"],["style","styleValue"]].forEach(([id,out])=>$(id).addEventListener("input",()=>$(out).textContent=$(id).value+"%"));
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
const initialPage=new URLSearchParams(location.search).get("view");if(initialPage==="video")showView("video");

function renderVoiceScriptPreview(){
  const preview=$("voiceScriptPreview");
  preview.innerHTML="";
  const source=$("scriptText").value;
  $("voiceScriptCharCount").textContent=source.length.toLocaleString("id-ID")+" karakter";
  if(!source.trim()){
    const empty=document.createElement("p");empty.className="script-preview-empty";empty.textContent="Naskah masih kosong.";preview.append(empty);return;
  }
  source.split(/\n/).forEach(line=>{
    const row=document.createElement("p");
    if(!line.trim()){row.className="script-preview-spacer";row.setAttribute("aria-hidden","true");row.textContent=" ";preview.append(row);return;}
    const pattern=/\[([^\]\n]+)\]/g;let cursor=0,match;
    while((match=pattern.exec(line))){
      if(match.index>cursor)row.append(document.createTextNode(line.slice(cursor,match.index)));
      const tag=document.createElement("span");tag.className="script-audio-tag";tag.textContent=match[1].trim();row.append(tag);
      cursor=pattern.lastIndex;
    }
    if(cursor<line.length)row.append(document.createTextNode(line.slice(cursor)));
    preview.append(row);
  });
}
function updateCount(){
  const length=$("scriptText").value.length;
  $("charCount").textContent=length.toLocaleString("id-ID")+" karakter";
  $("workflowCount").textContent=length.toLocaleString("id-ID")+" karakter";
}
async function loadVoices(){
  const select=$("voiceSelect");
  try{
    const data=await api("/api/voices",{authRequired:Boolean(currentUser)});state.voices=data.voices||[];select.innerHTML="";
    const indonesianCount=state.voices.filter(isIndonesianVoice).length;
    const privateCount=state.voices.filter(v=>v.private).length;
    $("voiceStatus").textContent=state.voices.length+" suara";
    $("voiceLibraryNote").textContent=(indonesianCount?indonesianCount+" suara berlabel Bahasa Indonesia diprioritaskan.":"Belum ada suara bawaan berlabel Bahasa Indonesia di katalog. Suara multilingual tetap bisa membaca bahasa Indonesia, tetapi aksennya bisa bervariasi.")+(privateCount?" Zed Clone pribadi tersedia untuk akun pemilik.":"");
    $("catalogVoiceCount").textContent=state.voices.length+" suara tersedia";
    $("catalogVoiceNote").textContent=(indonesianCount?indonesianCount+" suara berlabel Bahasa Indonesia. ":"")+"Daftar ini mengikuti suara yang tersedia di akun ZAIDA Voice."+(privateCount?" Termasuk "+privateCount+" suara clone pribadi.":"");
    state.voices.sort((a,b)=>Number(isIndonesianVoice(b))-Number(isIndonesianVoice(a)));
    state.voices.forEach(v=>{const o=document.createElement("option");o.value=v.voice_id;o.textContent=v.name;select.append(o);});
    if(!state.voices.length)select.innerHTML='<option value="">Tidak ada suara tersedia</option>';
    if(state.voices.length&&!state.voices.some(v=>v.voice_id===select.value))select.value=state.voices[0].voice_id;
    renderVoiceCards();renderCatalogVoices();
  }catch(error){
    select.innerHTML='<option value="">Gagal memuat suara</option>';$("voiceStatus").textContent="Suara tidak dapat dimuat";$("voiceCards").textContent=error.message;$("voiceLibraryNote").textContent=error.message;
    $("catalogVoiceCount").textContent="Katalog tidak tersedia";$("catalogVoiceNote").textContent=error.message;$("catalogVoiceCards").textContent=error.message;
  }
}
function isIndonesianVoice(v){return /indonesian|bahasa indonesia|^ind$/i.test(String(v.language||""));}
function stopVoicePreview(){
  if(state.previewAudio){state.previewAudio.pause();state.previewAudio.currentTime=0;state.previewAudio=null;}
}
function makeVoiceCard(v){
  const card=document.createElement("article");card.className="voice-card"+(v.voice_id===$("voiceSelect").value?" selected":"");
  const choose=document.createElement("button");choose.type="button";choose.className="voice-select-card";
  choose.setAttribute("aria-label","Pilih suara "+v.name);
  choose.innerHTML='<span class="voice-card-icon"><svg viewBox="0 0 24 24"><path d="M4 10v4m4-8v12m4-16v20m4-14v8m4-11v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>';
  const name=document.createElement("b");name.textContent=v.name;
  const labels=[v.language||"Multilingual",v.accent].filter(Boolean).join(" · ");
  const kind=document.createElement("small");kind.textContent=v.private?"Zed Clone · Privat":isIndonesianVoice(v)?"Bahasa Indonesia"+(v.accent?" · "+v.accent:""):labels;
  choose.append(name,kind);choose.addEventListener("click",()=>{stopVoicePreview();$("voiceSelect").value=v.voice_id;$("voiceSelect").dispatchEvent(new Event("change"));});
  const preview=document.createElement("button");preview.type="button";preview.className="voice-preview";preview.textContent="Pratinjau";
  preview.disabled=!v.preview_url;
  preview.title=v.preview_url?"Putar contoh suara":"Pratinjau tidak tersedia";
  preview.addEventListener("click",()=>{if(!v.preview_url){toast("Pratinjau tidak tersedia.");return;}stopVoicePreview();const audio=new Audio(v.preview_url);state.previewAudio=audio;audio.addEventListener("ended",()=>{if(state.previewAudio===audio)state.previewAudio=null;},{once:true});audio.play().catch(()=>{if(state.previewAudio===audio)state.previewAudio=null;toast("Pratinjau tidak dapat diputar.");});});
  card.append(choose,preview);return card;
}
function renderVoiceCollection({wrapId,searchId,genderId,paginationId,pageKey}){
  const wrap=$(wrapId);if(!wrap)return;
  wrap.innerHTML="";
  const query=$(searchId).value.trim().toLowerCase(),genderFilter=$(genderId).value;
  const filtered=state.voices.filter(v=>{
    const gender=String(v.gender||"").toLowerCase();
    const matchesGender=genderFilter==="all"||(genderFilter==="female"?gender==="female"||gender==="woman":gender==="male"||gender==="man");
    const searchable=[v.name,v.language,v.accent,v.private?"zed clone":"",isIndonesianVoice(v)?"bahasa indonesia":""].filter(Boolean).join(" ").toLowerCase();
    return (!query||searchable.includes(query))&&matchesGender;
  });
  const pageSize=12,totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  state[pageKey]=Math.min(state[pageKey],totalPages-1);
  const pageItems=filtered.slice(state[pageKey]*pageSize,(state[pageKey]+1)*pageSize);
  if(!filtered.length){wrap.innerHTML='<div class="empty-output"><b>Suara tidak ditemukan</b><p>Coba kata pencarian atau ubah filter gender.</p></div>';$(paginationId).innerHTML="";return;}
  pageItems.forEach(v=>wrap.append(makeVoiceCard(v)));
  const pager=$(paginationId);pager.innerHTML="";
  const info=document.createElement("span");info.textContent=filtered.length>12?("Halaman "+(state[pageKey]+1)+" dari "+totalPages+" · "+filtered.length+" suara"):(filtered.length+" suara");
  pager.append(info);
  if(totalPages>1){
    const prev=document.createElement("button");prev.type="button";prev.className="secondary-button";prev.textContent="Sebelumnya";prev.disabled=state[pageKey]===0;
    const next=document.createElement("button");next.type="button";next.className="secondary-button";next.textContent="Berikutnya";next.disabled=state[pageKey]>=totalPages-1;
    prev.addEventListener("click",()=>{stopVoicePreview();state[pageKey]--;renderVoiceCollection({wrapId,searchId,genderId,paginationId,pageKey});});
    next.addEventListener("click",()=>{stopVoicePreview();state[pageKey]++;renderVoiceCollection({wrapId,searchId,genderId,paginationId,pageKey});});
    pager.append(prev,next);
  }
}
function renderVoiceCards(){
  renderVoiceCollection({wrapId:"voiceCards",searchId:"voiceSearch",genderId:"voiceGenderFilter",paginationId:"voicePagination",pageKey:"voicePage"});
}
function renderCatalogVoices(){
  renderVoiceCollection({wrapId:"catalogVoiceCards",searchId:"catalogVoiceSearch",genderId:"catalogVoiceGenderFilter",paginationId:"catalogVoicePagination",pageKey:"catalogVoicePage"});
  const selected=state.voices.find(v=>v.voice_id===$("voiceSelect").value);
  $("catalogVoiceSelection").textContent=selected?"Terpilih: "+selected.name:"Belum memilih suara";
}function setStep(step){
  state.currentStep=2;
  renderVoiceScriptPreview();
  $("workflowTitle").textContent="Voice Studio";
  $("dockAction").textContent="Buat Audio";
}
function wrapSubtitle(text,max=42){
  let rest=Array.from(String(text).trim()),lines=[];
  while(rest.length&&lines.length<2){
    if(rest.length<=max){lines.push(rest.join(""));break;}
    let cut=max;for(let i=max-1;i>0;i--){if(rest[i]===" "){cut=i;break;}}
    if(cut===max&&rest[max]!==" ")cut=max;
    lines.push(rest.slice(0,cut).join("").trim());rest=rest.slice(cut);while(rest[0]===" ")rest.shift();
  }
  return lines.join("\n");
}
function buildSubtitles(text,alignment,duration){
  const chars=Array.from(text),starts=alignment?.character_start_times_seconds||[],ends=alignment?.character_end_times_seconds||[];
  const aligned=starts.length===chars.length&&ends.length===chars.length;
  const total=Number.isFinite(duration)&&duration>0?duration:Math.max(1,chars.length/12);
  const matches=[...text.matchAll(/[^.!?。！？\n]+[.!?。！？]?/gu)],cues=[];
  for(const match of matches){
    const raw=match[0],leading=raw.match(/^\s*/)?.[0].length||0,part=raw.trim();if(!part)continue;
    const base=Array.from(text.slice(0,match.index+leading)).length,words=[...part.matchAll(/\S+/g)];
    let group=[],length=0;
    const flush=()=>{
      if(!group.length)return;
      const from=group[0].index,to=group[group.length-1].index+group[group.length-1][0].length;
      const value=part.slice(from,to),first=base+Array.from(part.slice(0,from)).length,last=first+Array.from(value).length-1;
      const start=aligned?Number(starts[first]||0):(first/chars.length)*total;
      const end=aligned?Number(ends[last]||start+1):((last+1)/chars.length)*total;
      cues.push({start:Math.max(0,start),end:Math.min(total,Math.max(start+1,end)),text:wrapSubtitle(value)});
      group=[];length=0;
    };
    for(const word of words){
      const token=Array.from(word[0]),size=token.length;
      if(size>84){
        flush();
        for(let offset=0;offset<size;offset+=84){
          const before=token.slice(0,offset).join(""),piece=token.slice(offset,offset+84).join("");
          const first=base+Array.from(part.slice(0,word.index+before.length)).length;
          const last=first+Array.from(piece).length-1;
          const start=aligned?Number(starts[first]||0):(first/chars.length)*total;
          const end=aligned?Number(ends[last]||start+1):((last+1)/chars.length)*total;
          cues.push({start:Math.max(0,start),end:Math.min(total,Math.max(start+1,end)),text:wrapSubtitle(piece)});
        }
        continue;
      }
      if(group.length&&length+1+size>84)flush();
      group.push(word);length+=size+(group.length>1?1:0);
    }
    flush();
  }
  if(!cues.length&&text.trim())cues.push({start:0,end:total,text:wrapSubtitle(text.trim())});
  return cues;
}
function srtTime(seconds){
  const ms=Math.max(0,Math.round((Number(seconds)||0)*1000)),h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),r=ms%1000;
  return String(h).padStart(2,"0")+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0")+","+String(r).padStart(3,"0");
}
function parseSrtTime(value){const m=String(value).trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);return m?Number(m[1])*3600+Number(m[2])*60+Number(m[3])+Number(m[4])/1000:null;}
function renderSubtitles(){
  const list=$("subtitleList");list.innerHTML="";
  if(!state.subtitles.length){list.innerHTML='<div class="empty-output"><b>Subtitle belum tersedia</b></div>';return;}
  state.subtitles.forEach((cue,i)=>{
    const row=document.createElement("article");row.className="subtitle-row";
    row.innerHTML='<div class="subtitle-number">'+(i+1)+'</div><div class="subtitle-fields"><label>Mulai<input data-field="start" data-index="'+i+'" value="'+srtTime(cue.start)+'"></label><label>Selesai<input data-field="end" data-index="'+i+'" value="'+srtTime(cue.end)+'"></label><label class="subtitle-copy">Teks<textarea data-field="text" data-index="'+i+'" rows="2" maxlength="84">'+escapeHtml(cue.text)+'</textarea></label></div>';
    list.append(row);
  });
  const status=$("subtitleStatus");if(status)status.textContent=state.subtitles.length+" baris";
}
function downloadSubtitle(){
  if(!state.subtitles.length){toast("Subtitle belum tersedia.");return;}
  const entries=state.subtitles.map(cue=>({
    start:typeof cue.start==="string"?parseSrtTime(cue.start):cue.start,
    end:typeof cue.end==="string"?parseSrtTime(cue.end):cue.end,
    text:cue.text
  }));
  if(entries.some(c=>c.start===null||c.end===null||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.end<=c.start)){
    toast("Periksa waktu subtitle.");return;
  }
  const output=entries.map((cue,i)=>(i+1)+"\n"+srtTime(cue.start)+" --> "+srtTime(cue.end)+"\n"+cue.text).join("\n\n")+"\n";
  const url=URL.createObjectURL(new Blob([output],{type:"text/plain;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="zaida-voice.srt";a.click();URL.revokeObjectURL(url);
}
async function generate(){
  const text=$("scriptText").value.trim(),voiceId=$("voiceSelect").value;
  if(!currentUser){openAuth();toast("Masuk untuk membuat suara.");return;}
  if(!text){toast("Masukkan naskah terlebih dahulu.");setStep(1);return;}
  if(!voiceId){toast("Pilih suara terlebih dahulu.");setStep(2);return;}
  if(text.length>5000){toast("Maksimal 5.000 karakter.");return;}
  setBusy(true);
  try{
    const payload={requestId:newRequestId(),text,voiceId,voiceSettings:{stability:Number($("stability").value)/100,similarity_boost:Number($("similarity").value)/100,style:Number($("style").value)/100}};
    const headers={"Content-Type":"application/json",...(await authHeaders())};
    let response=await fetch("/api/tts?timestamps=1",{method:"POST",headers,body:JSON.stringify(payload)});
    let audioBlob=null,alignment=null;
    if(response.ok){
      const result=await response.json();
      const binary=atob(result.audioBase64||""),bytes=new Uint8Array(binary.length);
      for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
      audioBlob=new Blob([bytes],{type:"audio/mpeg"});alignment=result.alignment||null;
    }else if([404,405,422].includes(response.status)){
      // Timestamp endpoint unavailable: use the existing TTS endpoint once,
      // then estimate subtitle timing from the returned audio duration.
      response=await fetch("/api/tts",{method:"POST",headers,body:JSON.stringify({...payload,requestId:newRequestId()})});
      if(!response.ok){let error={};try{error=await response.json();}catch{}throw new Error(error.error||"Gagal membuat audio.");}
      audioBlob=await response.blob();
    }else{
      let error={};try{error=await response.json();}catch{}throw new Error(error.error||"Gagal membuat audio.");
    }
    const remaining=response.headers.get("X-Credits-Remaining");
    if(remaining!==null){$("creditBalance").textContent="Kredit: "+remaining;$("sidebarCreditBalance").textContent=Number(remaining).toLocaleString("id-ID")+" kredit";$("dockCredits").textContent="Kredit: "+remaining;if(accountInfo)accountInfo.credits=Number(remaining);}
    if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);
    state.audioBlob=audioBlob;
    state.audioUrl=URL.createObjectURL(audioBlob);$("audioPlayer").src=state.audioUrl;$("resultAudio").src=state.audioUrl;updateDownloadLink();
    state.alignment=alignment;state.sourceText=text;
    $("resultTitle").textContent="Narasi "+new Date().toLocaleString("id-ID");$("dockTrack").textContent=$("resultTitle").textContent;
    const duration=await new Promise(resolve=>{const p=$("audioPlayer");if(p.readyState>=1&&Number.isFinite(p.duration)){resolve(p.duration);return;}const done=()=>resolve(Number.isFinite(p.duration)?p.duration:Math.max(1,text.length/12));p.addEventListener("loadedmetadata",done,{once:true});p.addEventListener("error",done,{once:true});});
    state.subtitles=buildSubtitles(text,state.alignment,duration);
    
    $("resultDetails").textContent="MP3 · "+formatAudioDuration(duration)+" · "+text.length+" karakter";
    $("subtitlePreviewToggle").hidden=!$("includeSubtitle").checked;$("subtitleOptions").hidden=true;$("subtitlePreviewToggle").textContent="Preview Subtitle";$("subtitlePreviewToggle").setAttribute("aria-expanded","false");renderSubtitles();
    state.history.unshift({title:$("resultTitle").textContent,details:$("resultDetails").textContent,url:state.audioUrl,text});renderHistory();setStep(3);toast("Suara berhasil dibuat.");
  }catch(error){toast(error.message);}finally{setBusy(false);}
}
$("continueToVoice").addEventListener("click",()=>{if(!$("scriptText").value.trim()){toast("Masukkan naskah terlebih dahulu.");return;}setStep(2);});

$("resultAudio").addEventListener("play",()=>{if(!$("audioPlayer").paused)$("audioPlayer").pause();});
$("audioPlayer").addEventListener("play",()=>{if(!$("resultAudio").paused)$("resultAudio").pause();});
document.querySelectorAll(".stepper-item").forEach(b=>b.addEventListener("click",()=>{const n=Number(b.dataset.step);if(n===1||n<=state.currentStep||n===2&&$("scriptText").value.trim()||n===3&&state.audioUrl)setStep(n);else toast("Selesaikan langkah sebelumnya terlebih dahulu.");}));
$("voiceSelect").addEventListener("change",()=>{stopVoicePreview();state.voicePage=0;renderVoiceCards();renderCatalogVoices();});$("voiceSearch").addEventListener("input",()=>{state.voicePage=0;renderVoiceCards();});$("voiceGenderFilter").addEventListener("change",()=>{stopVoicePreview();state.voicePage=0;renderVoiceCards();});$("catalogVoiceSearch").addEventListener("input",()=>{state.catalogVoicePage=0;renderCatalogVoices();});$("catalogVoiceGenderFilter").addEventListener("change",()=>{stopVoicePreview();state.catalogVoicePage=0;renderCatalogVoices();});
$("subtitleList").addEventListener("input",e=>{const field=e.target.dataset.field,i=Number(e.target.dataset.index);if(!field||!state.subtitles[i])return;if(field==="text")state.subtitles[i].text=e.target.value;else state.subtitles[i][field]=e.target.value;});
$("includeSubtitle").addEventListener("change",()=>{if(state.audioUrl){$("subtitlePreviewToggle").hidden=!$("includeSubtitle").checked;if(!$("includeSubtitle").checked){$("subtitleOptions").hidden=true;$("subtitlePreviewToggle").textContent="Preview Subtitle";$("subtitlePreviewToggle").setAttribute("aria-expanded","false");}else renderSubtitles();}});
$("subtitlePreviewToggle").addEventListener("click",()=>{const opening=$("subtitleOptions").hidden;$("subtitleOptions").hidden=!opening;$("subtitlePreviewToggle").textContent=opening?"Tutup Preview":"Preview Subtitle";$("subtitlePreviewToggle").setAttribute("aria-expanded",String(opening));if(opening)renderSubtitles();});
$("downloadSrt").addEventListener("click",downloadSubtitle);
$("regenerateSrt").addEventListener("click",()=>{state.subtitles=buildSubtitles(state.sourceText,state.alignment,$("audioPlayer").duration||Math.max(1,state.sourceText.length/12));renderSubtitles();toast("Subtitle dibuat ulang.");});
$("dockAction").addEventListener("click",()=>generate());
$("restartProject").addEventListener("click",()=>{$("newProject").click();});

function syncChoiceChips(){
  document.querySelectorAll(".choice-chip").forEach(button=>{
    const select=$(button.dataset.select);
    button.classList.toggle("active",Boolean(select&&select.value===button.dataset.value));
  });
}
document.querySelectorAll(".choice-chip").forEach(button=>button.addEventListener("click",()=>{
  const select=$(button.dataset.select);if(!select)return;
  select.value=button.dataset.value;select.dispatchEvent(new Event("change",{bubbles:true}));syncChoiceChips();$("personaSaveStatus").textContent="Ada perubahan yang belum disimpan";
}));
syncChoiceChips();
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
  // Public-first: the studio shell remains accessible to visitors.
  $("authOverlay").hidden=true;
  $("authButton").textContent=allowed?(user.email||"Akun")+" · Keluar":"Masuk / Daftar";
  $("profileName").textContent=allowed?(user.displayName||"Pengguna"):"Pengunjung";
  $("profileEmail").textContent=allowed?"Akun terverifikasi":(user?"Email belum diverifikasi":"Belum masuk");
  $("profileAvatar").textContent=allowed?(user.displayName||user.email||"U").slice(0,1).toUpperCase():"Z";
  $("topAvatar").textContent=allowed?(user.displayName||user.email||"U").slice(0,1).toUpperCase():"Z";
  $("resendVerification").hidden=!(user&&!user.emailVerified);
  if(allowed){$("personaNav").hidden=false;personaReady=refreshAccount().then(async()=>{await loadPersonaProfile();await loadStudioSettings();});loadVoices();if(pendingPackageId){const packageId=pendingPackageId;pendingPackageId=null;startPackageCheckout(packageId);}else{checkReturnedPayment();}}else{loadVoices();if(pendingPackageId)openAuth();$("personaNav").hidden=true;personaReady=Promise.resolve();$("creditBalance").hidden=true;$("creditBalance").textContent="Kredit: —";$("sidebarCreditBalance").textContent="Masuk untuk melihat saldo";$("dockCredits").textContent="Kredit: —";accountInfo=null;$("adminNav").hidden=true;applyAssistantProfile({persona:"",interests:[],style:"santai dan akrab",emotion:"natural dan netral",audience:"",length:"fleksibel sesuai kebutuhan"});}
  if(user&&!user.emailVerified){
    $("authMessage").textContent="Email belum diverifikasi. Verifikasi email sebelum masuk untuk menggunakan fitur berbayar.";
  }
});
