import { getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { renderVideo } from "/video-renderer.js";

const firebaseApp = getApp();
const auth = getAuth(firebaseApp);
const $ = id => document.getElementById(id);
let currentUser = null;
let currentStoryboard = null;
let storageKey = null;
let renderedVideoUrls = [];
let generatedNarrationBlob = null;
let generatedSubtitleText = "";
let videoVoicesLoadedFor = null;
let videoDraftRestoredFor = null;

function setStatus(message, isError = false) {
  $("videoStatus").textContent = message;
  $("videoStatus").style.color = isError ? "#f0a3a3" : "#c6b8f5";
}
function syncCredits(credits) {
  if (credits === undefined || credits === null) return;
  const value = Number(credits).toLocaleString("id-ID");
  $("creditBalance").hidden = false;
  $("creditBalance").textContent = "Kredit: " + value;
  $("sidebarCreditBalance").textContent = value + " kredit";
  $("dockCredits").textContent = "Kredit: " + value;
}
function requestId() { return crypto.randomUUID(); }
async function api(path, options = {}) {
  if (!auth.currentUser) throw new Error("Silakan masuk ke akun ZAIDA Voice terlebih dahulu.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({ error: "Respons server tidak valid." }));
  if (!response.ok) throw new Error(data.error || "Permintaan gagal (" + response.status + ").");
  return data;
}
function buildPayload() {
  return {
    title: currentStoryboard.title, hook: currentStoryboard.hook, summary: currentStoryboard.summary,
    closing: currentStoryboard.closing, format: currentStoryboard.format, outputFormats: currentStoryboard.outputFormats || ["9:16", "16:9"],
    resolution: currentStoryboard.resolution, outputResolutions: currentStoryboard.outputResolutions || ["720x1280", "1280x720"], visualStyle: currentStoryboard.visualStyle,
    scenes: currentStoryboard.scenes.map(({ generatedImage, imageBusy, ...scene }) => scene)
  };
}
function saveDraft() {
  if (!currentStoryboard || !storageKey) return;
  try { localStorage.setItem(storageKey, JSON.stringify(buildPayload())); } catch {}
}
function createField(labelText, value, className, onInput) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.textContent = labelText;
  const area = document.createElement("textarea");
  area.value = value || "";
  if (className) area.className = className;
  area.addEventListener("input", () => onInput(area.value));
  wrap.append(label, area);
  return wrap;
}
function renderGeneratedImage(scene, previewArea) {
  previewArea.replaceChildren();
  if (!scene.generatedImage) return;
  const figure = document.createElement("figure");
  figure.className = "scene-image-preview";
  const image = document.createElement("img");
  image.alt = "Hasil gambar adegan " + scene.scene_number;
  image.src = "data:" + scene.generatedImage.mime + ";base64," + scene.generatedImage.b64;
  const caption = document.createElement("figcaption");
  caption.textContent = "Gambar siap · " + Number(scene.generatedImage.cost).toLocaleString("id-ID") + " kredit";
  const download = document.createElement("a");
  download.href = image.src;
  download.download = "zaida-adegan-" + scene.scene_number + ".png";
  download.textContent = "Unduh gambar";
  figure.append(image, caption, download);
  previewArea.append(figure);
}
async function generateSceneImage(scene, button, imageArea) {
  if (!auth.currentUser) { setStatus("Masuk ke akun ZAIDA Voice untuk membuat gambar.", true); return; }
  if (scene.imageBusy) return;
  if (scene.generatedImage && !confirm("Buat ulang gambar adegan ini? Gambar baru akan dikenakan biaya lagi.")) return;
  scene.imageBusy = true;
  button.disabled = true;
  button.textContent = "Membuat gambar…";
  setStatus("Mengirim prompt adegan " + scene.scene_number + " ke Kiosapi. Proses dapat memerlukan beberapa puluh detik…");
  try {
    const result = await api("/api/video/image", {
      method: "POST",
      body: JSON.stringify({ requestId: requestId(), sceneNumber: scene.scene_number, prompt: scene.visual_prompt })
    });
    scene.generatedImage = {
      b64: result.image.b64,
      mime: result.image.mime,
      cost: result.creditsCharged
    };
    renderGeneratedImage(scene, imageArea);
    updateRenderAvailability();
    syncCredits(result.creditsRemaining);
    setStatus("Gambar adegan " + scene.scene_number + " berhasil dibuat · biaya provider Rp" +
      Number(result.providerCostIdr).toLocaleString("id-ID") + " · " +
      Number(result.creditsCharged).toLocaleString("id-ID") + " kredit ZAIDA.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    scene.imageBusy = false;
    button.disabled = false;
    button.textContent = scene.generatedImage ? "Buat ulang gambar" : "Buat gambar adegan";
  }
}
function updateRenderAvailability() {
  const button = $("renderDualVideo");
  if (!button) return;
  const scenes = currentStoryboard?.scenes || [];
  const ready = scenes.length >= 2 && scenes.every(scene => Boolean(scene.generatedImage?.b64));
  button.disabled = !ready || !auth.currentUser;
  const selected = document.querySelector('input[name="videoOutputFormat"]:checked')?.value || "9:16";
  const summary = $("videoRenderSummary");
  if (summary) summary.textContent = scenes.length ? (scenes.filter(scene => scene.generatedImage?.b64).length + " dari " + scenes.length + " gambar adegan siap · " + (ready ? "Siap render format " + selected + "." : "Lengkapi semua gambar adegan.")) : "Belum siap render · Buat storyboard dan seluruh gambar adegan terlebih dahulu.";
  if (!button.disabled) button.innerHTML = "<span>▶</span> Render video " + (selected === "9:16" ? "vertikal (9:16)" : "horizontal (16:9)") + " <b>→</b>";
}
function renderStoryboard(data) {
  currentStoryboard = data;
  $("storyboardEmpty").hidden = true;
  $("storyboardResult").hidden = false;
  $("storyboardTitle").textContent = data.title;
  $("storyboardSummary").textContent = data.summary;
  $("storyboardHook").textContent = data.hook;
  $("sceneCountLabel").textContent = data.scenes.length + " adegan";
  const list = $("sceneList");
  list.replaceChildren();
  data.scenes.forEach((scene, index) => {
    const card = document.createElement("article");
    card.className = "scene-card";
    const head = document.createElement("div");
    head.className = "scene-card-head";
    const left = document.createElement("div");
    const number = document.createElement("span");
    number.className = "scene-number";
    number.textContent = "ADEGAN " + String(index + 1).padStart(2, "0");
    const title = document.createElement("b");
    title.textContent = scene.title;
    left.append(number, title);
    const duration = document.createElement("span");
    duration.className = "scene-duration";
    duration.textContent = scene.estimated_seconds + " detik";
    head.append(left, duration);
    const narration = createField("NARASI", scene.narration, "scene-narration", value => { scene.narration = value; saveDraft(); });
    const description = createField("ARAHAN VISUAL", scene.visual_description, "", value => { scene.visual_description = value; saveDraft(); });
    const prompt = createField("PROMPT VISUAL", scene.visual_prompt, "scene-prompt", value => { scene.visual_prompt = value; saveDraft(); });
    const screenText = createField("TEKS DI LAYAR", scene.on_screen_text, "", value => { scene.on_screen_text = value; saveDraft(); });
    const imageArea = document.createElement("div");
    imageArea.className = "scene-image-area";
    const imageNote = document.createElement("small");
    imageNote.className = "scene-image-note";
    imageNote.textContent = "GPT Image 2.5 Flare · portrait · Rp500/gambar";
    const previewArea = document.createElement("div");
    previewArea.className = "scene-image-preview-area";
    const imageButton = document.createElement("button");
    imageButton.type = "button";
    imageButton.className = "secondary-button scene-image-button";
    imageButton.textContent = scene.generatedImage ? "Buat ulang gambar" : "Buat gambar adegan";
    imageButton.addEventListener("click", () => generateSceneImage(scene, imageButton, previewArea));
    renderGeneratedImage(scene, previewArea);
    imageArea.append(imageNote, previewArea, imageButton);
    const meta = document.createElement("div");
    meta.className = "scene-meta";
    const transition = document.createElement("span");
    transition.textContent = "Transisi: " + scene.transition;
    const style = document.createElement("span");
    style.textContent = "Mixed2 visual";
    meta.append(transition, style);
    card.append(head, narration, description, prompt, screenText, imageArea, meta);
    list.append(card);
  });
  saveDraft();
  updateRenderAvailability();
}
async function generateStoryboard() {
  const topic = $("videoTopic").value.trim();
  if (topic.length < 8) { setStatus("Masukkan ide video minimal 8 karakter.", true); $("videoTopic").focus(); return; }
  const button = $("generateStoryboard");
  button.disabled = true;
  button.innerHTML = "<span>✧</span> Menyusun storyboard…";
  setStatus("Menghubungi Kiosapi dan menyusun adegan…");
  try {
    const result = await api("/api/video/storyboard", {
      method: "POST",
      body: JSON.stringify({
        requestId: requestId(), topic,
        duration: Number($("videoDuration").value),
        sceneCount: Number($("videoSceneCount").value),
        audience: $("videoAudience").value.trim(),
        tone: $("videoTone").value,
        language: "id"
      })
    });
    renderStoryboard(result);
    if (result.creditsRemaining !== undefined) {
      syncCredits(result.creditsRemaining);
      $("sidebarCreditBalance").textContent = Number(result.creditsRemaining).toLocaleString("id-ID") + " kredit";
    }
    setStatus("Storyboard berhasil dibuat · " + (result.model || "Kiosapi") + " · biaya " + (result.creditsCharged ?? "—") + " kredit.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>✧</span> Buat storyboard <b>→</b>";
  }
}
function downloadJson() {
  if (!currentStoryboard) return;
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "zaida-storyboard.json"; link.click();
  URL.revokeObjectURL(url);
}
async function copyStoryboard() {
  if (!currentStoryboard) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(buildPayload(), null, 2));
    setStatus("Storyboard berhasil disalin.");
  } catch { setStatus("Browser tidak mengizinkan penyalinan otomatis.", true); }
}
function videoSrtTime(seconds) {
  const ms=Math.max(0,Math.round((Number(seconds)||0)*1000));
  const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),r=ms%1000;
  return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":")+","+String(r).padStart(3,"0");
}
function makeVideoSrt(text, alignment) {
  const chars=Array.from(text), starts=alignment?.character_start_times_seconds||[], ends=alignment?.character_end_times_seconds||[];
  const aligned=starts.length===chars.length&&ends.length===chars.length;
  const matches=[...text.matchAll(/[^.!?。！？\\n]+[.!?。！？]?/gu)];
  const cues=[];
  for(const match of matches){
    const raw=match[0], leading=raw.match(/^\\s*/)?.[0].length||0, value=raw.trim();
    if(!value)continue;
    const startIndex=Array.from(text.slice(0,match.index+leading)).length;
    const endIndex=startIndex+Array.from(value).length-1;
    const start=aligned?Number(starts[startIndex]||0):cues.length*3;
    const end=aligned?Number(ends[endIndex]||start+2):start+3;
    cues.push((cues.length+1)+"\\n"+videoSrtTime(start)+" --> "+videoSrtTime(Math.max(start+.8,end))+"\\n"+value);
  }
  return cues.join("\\n\\n")+"\\n";
}
async function loadVideoVoices() {
  const select=$("videoVoiceSelect");
  try {
    const headers=auth.currentUser?{Authorization:"Bearer "+await auth.currentUser.getIdToken()}:{};
    const response=await fetch("/api/voices",{headers});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||"Gagal memuat katalog suara.");
    select.replaceChildren();
    (data.voices||[]).forEach(voice=>{
      const option=document.createElement("option");
      option.value=voice.voice_id; option.textContent=voice.name+(voice.gender?" · "+voice.gender:"");
      select.append(option);
    });
    if(!data.voices?.length)throw new Error("Belum ada suara yang tersedia.");
    $("generateVideoNarration").disabled=!auth.currentUser;
  } catch(error) {
    select.replaceChildren(new Option("Katalog suara tidak tersedia",""));
    $("videoNarrationStatus").textContent=error.message;
  }
}
async function generateVideoNarration() {
  if(!auth.currentUser){setStatus("Masuk ke akun ZAIDA Voice terlebih dahulu.",true);return;}
  if(!currentStoryboard?.scenes?.length){setStatus("Buat storyboard terlebih dahulu.",true);return;}
  const voiceId=$("videoVoiceSelect").value;
  if(!voiceId){setStatus("Pilih karakter suara terlebih dahulu.",true);return;}
  const text=currentStoryboard.scenes.map(scene=>scene.narration.trim()).filter(Boolean).join("\\n\\n");
  if(!text||text.length>5000){setStatus("Gabungan narasi harus berisi 1–5.000 karakter.",true);return;}
  const button=$("generateVideoNarration");
  button.disabled=true;button.textContent="Membuat narasi…";
  $("videoNarrationStatus").textContent="Mengirim narasi ke ElevenLabs. Biaya 3 kredit per karakter.";
  try {
    const response=await fetch("/api/tts?timestamps=1",{
      method:"POST",
      headers:{"Content-Type":"application/json",Authorization:"Bearer "+await auth.currentUser.getIdToken()},
      body:JSON.stringify({
        requestId:requestId(),text,voiceId,
        voiceSettings:{
          stability:Number($("videoVoiceStability").value)/100,
          similarity_boost:Number($("videoVoiceSimilarity").value)/100,
          style:0
        }
      })
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||"Gagal membuat audio narasi.");
    const binary=atob(data.audioBase64||"");
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    generatedNarrationBlob=new Blob([bytes],{type:"audio/mpeg"});
    generatedSubtitleText=makeVideoSrt(text,data.alignment);
    const audioUrl=URL.createObjectURL(generatedNarrationBlob);
    const player=$("videoNarrationPreview");
    if(player.dataset.objectUrl)URL.revokeObjectURL(player.dataset.objectUrl);
    player.dataset.objectUrl=audioUrl;player.src=audioUrl;player.hidden=false;
    $("videoNarrationAudio").value="";
    const remainingCredits = response.headers.get("X-Credits-Remaining");
    if (remainingCredits !== null) syncCredits(remainingCredits);
    $("videoNarrationStatus").textContent="Narasi selesai · "+text.length.toLocaleString("id-ID")+" karakter · "+(Number(response.headers.get("X-Credits-Remaining"))>=0?"sisa kredit "+response.headers.get("X-Credits-Remaining"):"kredit diperbarui");
    const link=$("videoSubtitleDownload");
    if(generatedSubtitleText.trim()){
      link.href=URL.createObjectURL(new Blob([generatedSubtitleText],{type:"text/plain;charset=utf-8"}));
      link.hidden=false;
    } else {link.hidden=true;}
    setStatus("Audio narasi dan subtitle berhasil dibuat.");
  } catch(error) {
    $("videoNarrationStatus").textContent=error.message;
    setStatus(error.message,true);
  } finally {
    button.disabled=false;button.textContent="Buat ulang audio narasi";
  }
}
async function startDualRender() {
  if (!currentStoryboard) return;
  const button = $("renderDualVideo");
  const progress = $("videoRenderProgress");
  const progressBar = $("videoRenderProgressBar");
  const progressText = $("videoRenderProgressText");
  const downloads = $("videoRenderDownloads");
  const audioFile = $("videoNarrationAudio").files?.[0] || generatedNarrationBlob || null;
  const selectedFormat = document.querySelector('input[name="videoOutputFormat"]:checked')?.value || "9:16";
  renderedVideoUrls.forEach(url => URL.revokeObjectURL(url));
  renderedVideoUrls = [];
  downloads.replaceChildren();
  downloads.hidden = true;
  progress.hidden = false;
  button.disabled = true;
  button.textContent = "Menyiapkan mesin render…";
  progressBar.style.width = "0%";
  progressText.textContent = "Memuat FFmpeg.wasm untuk pertama kali…";
  setStatus("Render video berjalan di perangkat ini. Jangan tutup halaman.");
  try {
    const result = await renderVideo({
      scenes: currentStoryboard.scenes,
      format: selectedFormat,
      audioFile,
      subtitleText: $("videoIncludeSubtitles").checked ? generatedSubtitleText : "",
      onProgress: info => {
        if (info.phase === "loading") progressText.textContent = info.message || "Memuat mesin render…";
        else if (info.phase === "rendering") {
          const percent = Math.round((info.progress || 0) * 100);
          progressBar.style.width = percent + "%";
          progressText.textContent = info.message || ("Merender " + (info.format || "video") + "… " + percent + "%");
        } else if (info.phase === "complete") {
          progressBar.style.width = "100%";
          progressText.textContent = info.message;
        }
      }
    });
    const url = URL.createObjectURL(result.blob);
    renderedVideoUrls.push(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.filename;
    link.className = "render-download-link";
    link.textContent = "Unduh video " + result.format + " · " + (result.blob.size / (1024 * 1024)).toFixed(1) + " MB";
    downloads.append(link);
    downloads.hidden = false;
    setStatus("Berhasil! Video format " + result.format + " selesai dibuat.");
  } catch (error) {
    progressText.textContent = error.message || "Render gagal.";
    setStatus("Render gagal: " + (error.message || "Kesalahan tidak diketahui."), true);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>▶</span> Render video " + (selectedFormat === "9:16" ? "vertikal (9:16)" : "horizontal (16:9)") + " <b>→</b>";
    updateRenderAvailability();
  }
}
function restoreDraft() {
  if (!storageKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && Array.isArray(saved.scenes) && saved.scenes.length) {
      renderStoryboard(saved);
      setStatus("Draft storyboard lokal dipulihkan. Gambar yang belum diunduh perlu dibuat kembali setelah halaman dimuat ulang.");
    }
  } catch {}
}
$("generateStoryboard").addEventListener("click", generateStoryboard);
$("downloadStoryboard").addEventListener("click", downloadJson);
$("copyStoryboard").addEventListener("click", copyStoryboard);
$("renderDualVideo").addEventListener("click", startDualRender);
document.querySelectorAll('input[name="videoOutputFormat"]').forEach(input => input.addEventListener("change", updateRenderAvailability));
$("generateVideoNarration").addEventListener("click", generateVideoNarration);
// Pakai Firebase Auth dan sesi yang sama dengan dashboard utama.
async function refreshVideoAccount() {
  if (!auth.currentUser) return;
  try {
    const token = await auth.currentUser.getIdToken();
    const response = await fetch("/api/account", { headers: { Authorization: "Bearer " + token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Saldo tidak dapat dimuat.");
    syncCredits(data.credits);
  } catch (error) {
    setStatus("Akun terhubung, tetapi saldo belum dapat diperbarui: " + error.message, true);
  }
}
function activateVideoStudio() {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  currentUser = auth.currentUser;
  refreshVideoAccount();
  updateRenderAvailability();
  if (videoVoicesLoadedFor !== currentUser.uid) {
    videoVoicesLoadedFor = currentUser.uid;
    loadVideoVoices();
  }
  if (videoDraftRestoredFor !== currentUser.uid) {
    videoDraftRestoredFor = currentUser.uid;
    restoreDraft();
  }
}
onAuthStateChanged(auth, user => {
  currentUser = user && user.emailVerified ? user : null;
  storageKey = currentUser ? "zaida-video-studio-draft-v1-" + currentUser.uid : null;
  const allowed = Boolean(currentUser);
  $("generateStoryboard").disabled = !allowed;
  $("generateVideoNarration").disabled = !allowed;
  if (!allowed) {
    videoVoicesLoadedFor = null;
    videoDraftRestoredFor = null;
    updateRenderAvailability();
    if (user && !user.emailVerified) setStatus("Verifikasi email akun ZAIDA Voice terlebih dahulu untuk menggunakan fitur AI.", true);
    return;
  }
  if (document.body.classList.contains("video-studio-page")) activateVideoStudio();
  else updateRenderAvailability();
});
window.addEventListener("zaida:video-page-open", activateVideoStudio);
