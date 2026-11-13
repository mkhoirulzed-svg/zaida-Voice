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
let previewVideoUrl = null;
let previewCaptionCues = [];
let generatedNarrationBlob = null;
let generatedSubtitleText = "";
let videoVoicesLoadedFor = null;
let videoDraftRestoredFor = null;

const VIDEO_VISUAL_STYLES={
  stickman:{label:"Stickman",prompt:"Use a clean minimalist stickman illustration style: simple expressive line-drawn human characters, clear poses, uncluttered backgrounds, consistent character design, restrained color palette. Not photorealistic."},
  "2d":{label:"Ilustrasi 2D",prompt:"Use polished 2D flat vector illustration, clean shapes, crisp outlines, balanced colors, simple readable composition, consistent illustrated characters. Not photorealistic or 3D."},
  "3d":{label:"Animasi 3D",prompt:"Use high-quality stylized 3D animated film visuals, appealing dimensional characters, soft global illumination, detailed but friendly materials, expressive poses, consistent character design."},
  anime:{label:"Anime",prompt:"Use high-quality Japanese anime illustration style, expressive character design, refined line art, cinematic anime lighting, rich but controlled colors, consistent characters."},
  realistic:{label:"Realistis",prompt:"Use natural photorealistic photography, believable real-world people and environments, accurate anatomy, realistic textures, natural lighting, documentary photography quality."},
  cinematic:{label:"Cinematic",prompt:"Use cinematic photorealistic film stills, dramatic but natural lighting, thoughtful camera composition, atmospheric depth, realistic textures, professional color grading."},
  watercolor:{label:"Watercolor",prompt:"Use delicate watercolor painting, visible paper texture, soft pigment washes, graceful brush edges, gentle layered colors, cohesive illustrated scenes."},
  comic:{label:"Komik",prompt:"Use polished graphic novel comic-book illustration, confident ink outlines, dynamic framing, controlled halftone texture, expressive poses, coherent panel-like composition."}
};
function updateVisualStyleDescription(){
  const style=VIDEO_VISUAL_STYLES[$("videoVisualStyle").value]||VIDEO_VISUAL_STYLES.cinematic;
  const box=$("visualStyleDescription");
  box.querySelector("b").textContent=style.label;
  box.querySelector("small").textContent=style.prompt;
}
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
  const selectedStyle=VIDEO_VISUAL_STYLES[$("videoVisualStyle").value]||VIDEO_VISUAL_STYLES.cinematic;
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
      body: JSON.stringify({ requestId: requestId(), sceneNumber: scene.scene_number, prompt: selectedStyle.prompt + "\\n\\nScene direction: " + scene.visual_prompt })
    });
    scene.generatedImage = {
      b64: result.image.b64,
      mime: result.image.mime,
      cost: result.creditsCharged
    };
    renderGeneratedImage(scene, imageArea);
    updateStoryboardImageStrip();
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
  const ready = scenes.length >= 2 && Boolean(auth.currentUser);
  button.disabled = !ready;
  const selected = document.querySelector('input[name="videoOutputFormat"]:checked')?.value || "9:16";
  const summary = $("videoRenderSummary");
  if (summary) summary.textContent = scenes.length ? (scenes.length + " adegan siap · gambar AI opsional · " + (ready ? "Siap render format " + selected + "." : "Masuk untuk mulai render.")) : "Belum siap render · Buat storyboard terlebih dahulu.";
  if (!button.disabled) button.innerHTML = "<span>▶</span> Buat Preview Video <b>→</b>";
}
function renderStoryboard(data) {
  currentStoryboard = data;
  $("storyboardEmpty").hidden = true;
  $("storyboardResult").hidden = false;
  $("storyboardQuickTitle").textContent = data.title;
  $("storyboardQuickMeta").textContent = data.scenes.length + " adegan · gambar dibuat otomatis";
  $("storyboardEditor").hidden = true;
  $("toggleStoryboardEditor").setAttribute("aria-expanded", "false");
  $("toggleStoryboardEditor").textContent = "✎ Edit storyboard, teks & gambar";
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
  updateStoryboardImageStrip();
  updateRenderAvailability();
}
async function generateStoryboard() {
  const topic = $("videoTopic").value.trim();
  if (topic.length < 20) { setStatus("Masukkan naskah minimal 20 karakter agar storyboard dapat disusun.", true); $("videoTopic").focus(); return; }
  const durationMinutes = Number($("videoDuration").value);
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0.5 || durationMinutes > 10) { setStatus("Durasi harus antara 0,5 sampai 10 menit.", true); $("videoDuration").focus(); return; }
  const requestedScenes = $("videoSceneCount").value;
  const sceneCount = requestedScenes === "auto" ? Math.max(3, Math.min(30, Math.ceil(durationMinutes * 60 / 8))) : Number(requestedScenes);
  const button = $("generateStoryboard");
  button.disabled = true;
  button.innerHTML = "<span>✧</span> Menyusun storyboard…";
  setStatus("Menghubungi Kiosapi dan menyusun adegan…");
  try {
    const result = await api("/api/video/storyboard", {
      method: "POST",
      body: JSON.stringify({
        requestId: requestId(), topic,
        duration: Math.round(durationMinutes * 60),
        sceneCount,
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
    await generateAllSceneImages();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
    button.innerHTML = "<span>✧</span> Buat storyboard <b>→</b>";
  }
}
async function generateAllSceneImages() {
  const scenes = currentStoryboard?.scenes || [];
  const pending = scenes.filter(scene => !scene.generatedImage);
  if (!pending.length) return;
  const estimate = pending.length * 500;
  const approved = confirm(
    "Storyboard selesai dengan " + scenes.length + " adegan.\n\n" +
    "ZAIDA akan membuat otomatis " + pending.length + " gambar yang belum tersedia.\n" +
    "Estimasi biaya provider: Rp" + estimate.toLocaleString("id-ID") + ".\n" +
    "Kredit ZAIDA dipotong sesuai tarif akun dan ditampilkan setelah tiap gambar selesai.\n\n" +
    "Lanjutkan membuat semua gambar?"
  );
  if (!approved) {
    setStatus("Storyboard siap. Gambar dapat dibuat satu per satu dari menu Edit Storyboard.");
    return;
  }
  const cards = $("sceneList").querySelectorAll(".scene-card");
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.generatedImage) continue;
    const card = cards[i];
    const button = card?.querySelector(".scene-image-button");
    const preview = card?.querySelector(".scene-image-preview-area");
    if (!button || !preview) continue;
    await generateSceneImage(scene, button, preview);
    if (!scene.generatedImage) {
      setStatus("Pembuatan gambar berhenti pada adegan " + scene.scene_number + ". Kamu bisa melanjutkan dari Edit Storyboard.", true);
      break;
    }
  }
  $("storyboardQuickMeta").textContent = scenes.filter(scene => scene.generatedImage).length + "/" + scenes.length + " gambar selesai";
}
function getCaptionStyle() {
  return {
    preset: $("captionPreset").value,
    font: $("captionFont").value,
    fontSize: Number($("captionFontSize").value),
    textColor: $("captionTextColor").value,
    outlineColor: $("captionOutlineColor").value,
    outlineWidth: Number($("captionOutlineWidth").value),
    background: $("captionBackground").value,
    backgroundOpacity: Number($("captionBackgroundOpacity").value) / 100,
    position: $("captionPosition").value
  };
}
function updateCaptionPreview() {
  const style = getCaptionStyle();
  const preview = $("captionPreviewText");
  const stage = $("captionPreviewStage");
  $("captionFontSizeValue").textContent = style.fontSize + " px";
  preview.style.fontFamily = style.font + ", sans-serif";
  preview.style.fontSize = Math.max(12, style.fontSize * 0.62) + "px";
  preview.style.color = style.preset === "karaoke" ? "#ffe45e" : style.textColor;
  preview.style.textShadow = style.outlineWidth ? "0 1px " + style.outlineWidth + "px " + style.outlineColor + ", 1px 0 " + style.outlineWidth + "px " + style.outlineColor + ", -1px 0 " + style.outlineWidth + "px " + style.outlineColor : "none";
  preview.style.background = style.background === "none" ? "transparent" : (style.background === "solid" ? "rgba(0,0,0,1)" : "rgba(0,0,0," + style.backgroundOpacity + ")");
  preview.style.padding = style.background === "none" ? "4px 0" : "10px 16px";
  stage.dataset.position = style.position;
}
function applyCaptionPreset() {
  const preset=$("captionPreset").value;
  const values={
    classic:{captionBackground:"none",captionTextColor:"#ffffff",captionOutlineColor:"#000000",captionOutlineWidth:4,captionFont:"Arial",captionFontSize:30},
    capcut:{captionBackground:"soft",captionTextColor:"#ffffff",captionOutlineColor:"#000000",captionOutlineWidth:2,captionFont:"Arial",captionFontSize:28},
    cinematic:{captionBackground:"none",captionTextColor:"#ffffff",captionOutlineColor:"#000000",captionOutlineWidth:1,captionFont:"Georgia",captionFontSize:30},
    karaoke:{captionBackground:"none",captionTextColor:"#ffe45e",captionOutlineColor:"#000000",captionOutlineWidth:3,captionFont:"Arial",captionFontSize:30}
  }[preset];
  Object.entries(values).forEach(([id,value])=>$(id).value=value);
  updateCaptionPreview();
}
function updateStoryboardImageStrip() {
  const strip=$("storyboardImageStrip");
  if(!strip||!currentStoryboard)return;
  strip.replaceChildren();
  currentStoryboard.scenes.forEach((scene,index)=>{
    const item=document.createElement("button");
    item.type="button";
    item.className="storyboard-image-thumb "+(scene.generatedImage?"is-ready":"is-pending");
    item.title="Edit adegan "+(index+1);
    if(scene.generatedImage){const img=document.createElement("img");img.alt="Gambar adegan "+(index+1);img.src="data:"+scene.generatedImage.mime+";base64,"+scene.generatedImage.b64;item.append(img);}
    else {const placeholder=document.createElement("span");placeholder.textContent="✧";item.append(placeholder);}
    const label=document.createElement("small");label.textContent=String(index+1).padStart(2,"0");item.append(label);
    item.addEventListener("click",()=>{
      $("storyboardEditor").hidden=false;
      $("toggleStoryboardEditor").setAttribute("aria-expanded","true");
      $("toggleStoryboardEditor").textContent="Tutup editor storyboard";
      $("sceneList").children[index]?.scrollIntoView({behavior:"smooth",block:"center"});
    });
    strip.append(item);
  });
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
async function getAudioDurationSeconds(file) {
  if (!file) return null;
  const url = URL.createObjectURL(file);
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  try {
    return await new Promise(resolve => {
      const finish = value => {
        audio.removeAttribute("src");
        audio.load();
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(value) && value > 0 ? value : null);
      };
      audio.onloadedmetadata = () => finish(audio.duration);
      audio.onerror = () => finish(null);
      audio.src = url;
    });
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}
function videoSrtTime(seconds) {
  const ms=Math.max(0,Math.round((Number(seconds)||0)*1000));
  const h=Math.floor(ms/3600000),m=Math.floor(ms%3600000/60000),s=Math.floor(ms%60000/1000),r=ms%1000;
  return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":")+","+String(r).padStart(3,"0");
}
function makeVideoSrt(text, alignment) {
  const chars = Array.from(text);
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const aligned = starts.length === chars.length && ends.length === chars.length;
  const matches = [...text.matchAll(/[^.!?。！？\n]+[.!?。！？]?/gu)];
  const cues = [];

  for (const match of matches) {
    const raw = match[0];
    const leading = raw.match(/^\s*/)?.[0].length || 0;
    const value = raw.trim();
    if (!value) continue;

    const startIndex = Array.from(text.slice(0, match.index + leading)).length;
    const endIndex = startIndex + Array.from(value).length - 1;
    const start = aligned ? Number(starts[startIndex] || 0) : cues.length * 3;
    const end = aligned ? Number(ends[endIndex] || start + 2) : start + 3;

    cues.push(
      (cues.length + 1) + "\n" +
      videoSrtTime(start) + " --> " +
      videoSrtTime(Math.max(start + 0.8, end)) + "\n" +
      value
    );
  }

  return cues.join("\n\n") + "\n";
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
  const text=currentStoryboard.scenes.map(scene=>scene.narration.trim()).filter(Boolean).join("\n\n");
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
function parsePreviewSrt(srt) {
  return String(srt || "").replace(/\\r/g, "").trim().split(/\\n\\s*\\n/).map(block => {
    const lines=block.split("\\n"), time=lines.find(line=>line.includes("-->"));
    if(!time)return null;
    const m=time.match(/(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})\\s*-->\\s*(\\d{2}):(\\d{2}):(\\d{2})[,.](\\d{3})/);
    if(!m)return null;
    const sec=(h,mi,s,ms)=>Number(h)*3600+Number(mi)*60+Number(s)+Number(ms)/1000;
    return {start:sec(...m.slice(1,5)),end:sec(...m.slice(5,9)),text:lines.slice(lines.indexOf(time)+1).join(" ").replace(/<[^>]+>/g,"").trim()};
  }).filter(c=>c&&c.text&&c.end>c.start);
}
function syncCaptionPreview() {
  const video=$("videoPreviewPlayer"), text=$("captionPreviewText");
  if(!video || video.hidden) return;
  const cue=previewCaptionCues.find(item=>video.currentTime>=item.start&&video.currentTime<=item.end);
  text.textContent=$("videoIncludeSubtitles").checked && cue ? cue.text : "";
  text.hidden=!text.textContent;
}
async function startDualRender(isExport = false) {
  if (!currentStoryboard) return;
  if (isExport && !previewVideoUrl) { setStatus("Buat preview video terlebih dahulu.", true); return; }
  const button = isExport ? $("exportFinalVideo") : $("renderDualVideo");
  const progress = $("videoRenderProgress");
  const progressBar = $("videoRenderProgressBar");
  const progressText = $("videoRenderProgressText");
  const downloads = $("videoRenderDownloads");
  const audioFile = $("videoNarrationAudio").files?.[0] || generatedNarrationBlob || null;
  const selectedFormat = document.querySelector('input[name="videoOutputFormat"]:checked')?.value || "9:16";
  const selectedSubtitleText = generatedSubtitleText;
  const burnCaptions = $("videoIncludeSubtitles").checked;
  if (isExport) {
    renderedVideoUrls.forEach(url => URL.revokeObjectURL(url));
    renderedVideoUrls = previewVideoUrl ? [previewVideoUrl] : [];
    downloads.replaceChildren();
    downloads.hidden = true;
  }
  progress.hidden = false;
  button.disabled = true;
  button.textContent = isExport ? "Mengekspor video final…" : "Membuat preview…";
  progressBar.style.width = "0%";
  progressText.textContent = "Memuat mesin ekspor MP4…";
  setStatus(isExport ? "Mengekspor video final dengan pengaturan caption…" : "Membuat video preview tanpa menanam caption permanen…");
  try {
    const audioDuration = await getAudioDurationSeconds(audioFile);
    const result = await renderVideo({
      scenes: currentStoryboard.scenes,
      format: selectedFormat,
      audioFile,
      audioDuration,
      subtitleText: isExport ? selectedSubtitleText : "",
      burnCaptions: isExport ? burnCaptions : false,
      captionStyle: getCaptionStyle(),
      onProgress: info => {
        if (info.phase === "loading") progressText.textContent = info.message || "Memuat mesin render…";
        else if (info.phase === "rendering") {
          const percent = Math.round((info.progress || 0) * 100);
          progressBar.style.width = percent + "%";
          progressText.textContent = info.message || ("Merender " + (info.format || "video") + "… " + percent + "%");
        } else if (info.phase === "log") progressText.textContent = info.message || "Menjalankan proses ekspor…";
        else if (info.phase === "complete") { progressBar.style.width = "100%"; progressText.textContent = info.message; }
      }
    });
    const url = URL.createObjectURL(result.blob);
    if (!isExport) {
      if (previewVideoUrl) URL.revokeObjectURL(previewVideoUrl);
      previewVideoUrl = url;
      const player=$("videoPreviewPlayer");
      player.src=url;
      player.hidden=false;
      player.controls=true;
      $("captionPreviewEmpty").hidden=true;
      $("captionPreviewText").hidden=true;
      $("captionPreviewPlay").hidden=true;
      player.currentTime=0;
      previewCaptionCues=parsePreviewSrt(generatedSubtitleText);
      $("exportFinalVideo").hidden=false;
      $("exportFinalVideo").disabled=false;
      $("exportFinalVideo").textContent="Export Video Final";
      player.onloadedmetadata=()=>syncCaptionPreview();
      player.ontimeupdate=syncCaptionPreview;
      player.onseeked=syncCaptionPreview;
      player.onplay=syncCaptionPreview;
      downloads.hidden=true;
      setStatus("Preview video siap. Putar video, atur caption, lalu tekan Export Video Final.");
    } else {
      renderedVideoUrls.push(url);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.className = "render-download-link";
      link.textContent = "Unduh video " + result.format + " · " + (result.blob.size / (1024 * 1024)).toFixed(1) + " MB";
      downloads.append(link);
      if (selectedSubtitleText.trim() && !burnCaptions) {
        const srtUrl = URL.createObjectURL(new Blob([selectedSubtitleText], { type: "application/x-subrip;charset=utf-8" }));
        renderedVideoUrls.push(srtUrl);
        const srtLink = document.createElement("a");
        srtLink.href = srtUrl;
        srtLink.download = "zaida-video-subtitle.srt";
        srtLink.className = "render-download-link";
        srtLink.textContent = "Unduh subtitle SRT";
        downloads.append(srtLink);
      }
      downloads.hidden=false;
      setStatus("Video final berhasil diekspor. Periksa hasilnya sebelum diunduh.");
    }
  } catch (error) {
    let detail = "";
    if (typeof error === "string") detail = error;
    else if (error && typeof error === "object") {
      const parts = [];
      if (error.name) parts.push(String(error.name));
      if (error.message) parts.push(String(error.message));
      if (error.stack) parts.push(String(error.stack).split("\\n").slice(0, 3).join(" | "));
      detail = parts.join(" · ");
    }
    progressText.textContent = "Render gagal: " + (detail || "Terjadi kesalahan.");
    setStatus("Render gagal: " + (detail || "Terjadi kesalahan."), true);
    console.error("[ZAIDA Video Studio] Render gagal:", error);
  } finally {
    button.disabled = false;
    if (isExport) button.textContent="Export Video Final";
    else button.innerHTML="<span>▶</span> Buat Preview Video <b>→</b>";
    progress.hidden = true;
    updateRenderAvailability();
  }
}
function restoreDraft() {
  if (!storageKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && Array.isArray(saved.scenes) && saved.scenes.length) {
      renderStoryboard(saved);
      setStatus("Draft storyboard lokal dipulihkan. Video bisa dirender tanpa membuat gambar AI.");
    }
  } catch {}
}

const videoAssistantMessages=[];
let videoAssistantBusy=false;
function addVideoAssistantMessage(role, content){
  const row=document.createElement("p");
  row.className=role==="assistant"?"video-assistant-reply":"video-assistant-user";
  row.textContent=(role==="assistant"?"ZAIDA: ":"Kamu: ")+content;
  $("videoAssistantMessages").append(row);
  $("videoAssistantMessages").scrollTop=$("videoAssistantMessages").scrollHeight;
}
async function sendVideoAssistantMessage(){
  const input=$("videoAssistantInput"), message=input.value.trim();
  if(!message||videoAssistantBusy)return;
  if(!auth.currentUser){setStatus("Masuk terlebih dahulu untuk menggunakan Asisten AI.",true);return;}
  if(message.length>3000)return;
  videoAssistantMessages.push({role:"user",content:message});
  addVideoAssistantMessage("user",message); input.value="";
  videoAssistantBusy=true; $("videoAssistantSend").disabled=true; $("videoAssistantSend").textContent="…";
  try{
    const result=await api("/api/assistant",{method:"POST",body:JSON.stringify({requestId:requestId(),profile:{style:"santai dan akrab",emotion:"natural dan netral",audience:$("videoAudience").value.trim(),length:"sesuai durasi video"},messages:videoAssistantMessages.slice(-12),mode:"script-assistant"})});
    const reply=(result.reply||"").trim();
    if(!reply)throw new Error("AI tidak mengembalikan jawaban.");
    videoAssistantMessages.push({role:"assistant",content:reply});addVideoAssistantMessage("assistant",reply);
    if(result.script?.trim()){ $("videoAssistantDraft").value=result.script.trim(); $("videoAssistantResult").hidden=false; }
    if(result.creditsRemaining!==undefined)syncCredits(result.creditsRemaining);
  }catch(error){videoAssistantMessages.pop();addVideoAssistantMessage("assistant","Maaf, ada kendala: "+error.message);}
  finally{videoAssistantBusy=false;$("videoAssistantSend").disabled=false;$("videoAssistantSend").textContent="Kirim";}
}
$("videoAssistantSend").addEventListener("click",sendVideoAssistantMessage);
$("videoAssistantInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendVideoAssistantMessage();}});
$("videoAssistantUse").addEventListener("click",()=>{const draft=$("videoAssistantDraft").value.trim();if(!draft)return;$("videoTopic").value=draft;setStatus("Naskah dari Asisten AI sudah dimasukkan. Kamu bisa mengeditnya sebelum membuat storyboard.");$("videoTopic").focus();});

$("toggleStoryboardEditor").addEventListener("click",()=>{
  const editor=$("storyboardEditor");editor.hidden=!editor.hidden;
  $("toggleStoryboardEditor").setAttribute("aria-expanded",String(!editor.hidden));
  $("toggleStoryboardEditor").textContent=editor.hidden?"✎ Edit storyboard, teks & gambar":"Tutup editor storyboard";
});
["captionFont","captionBackground","captionPosition"].forEach(id=>$(id).addEventListener("change",updateCaptionPreview));
["captionFontSize","captionTextColor","captionOutlineColor","captionOutlineWidth","captionBackgroundOpacity"].forEach(id=>$(id).addEventListener("input",updateCaptionPreview));
$("captionPreset").addEventListener("change",applyCaptionPreset);
applyCaptionPreset();
$("videoVisualStyle").addEventListener("change",updateVisualStyleDescription);
updateVisualStyleDescription();
$("generateStoryboard").addEventListener("click", generateStoryboard);
$("downloadStoryboard").addEventListener("click", downloadJson);
$("copyStoryboard").addEventListener("click", copyStoryboard);
$("renderDualVideo").addEventListener("click", () => startDualRender(false));
$("exportFinalVideo").addEventListener("click", () => startDualRender(true));
$("videoIncludeSubtitles").addEventListener("change", syncCaptionPreview);
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
