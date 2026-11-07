import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseApp = initializeApp({
  apiKey: "AIzaSyDqzKq2OXQfYnG-DOSyuzo4xo0GjSb-a8",
  authDomain: "zaida-voice.firebaseapp.com",
  projectId: "zaida-voice",
  storageBucket: "zaida-voice.firebasestorage.app",
  messagingSenderId: "146292786794",
  appId: "1:146292786794:web:da865938c177b21d5d6c13"
});
const auth = getAuth(firebaseApp);
const $ = id => document.getElementById(id);
let currentUser = null;
let currentStoryboard = null;
let storageKey = null;

function setStatus(message, isError = false) {
  $("videoStatus").textContent = message;
  $("videoStatus").style.color = isError ? "#f0a3a3" : "#c6b8f5";
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
    closing: currentStoryboard.closing, format: currentStoryboard.format,
    resolution: currentStoryboard.resolution, visualStyle: currentStoryboard.visualStyle,
    scenes: currentStoryboard.scenes
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
    const prompt = createField("PROMPT VISUAL (UNTUK FASE GENERATE GAMBAR)", scene.visual_prompt, "scene-prompt", value => { scene.visual_prompt = value; saveDraft(); });
    const screenText = createField("TEKS DI LAYAR", scene.on_screen_text, "", value => { scene.on_screen_text = value; saveDraft(); });
    const meta = document.createElement("div");
    meta.className = "scene-meta";
    const transition = document.createElement("span");
    transition.textContent = "Transisi: " + scene.transition;
    const style = document.createElement("span");
    style.textContent = "Mixed2 visual";
    meta.append(transition, style);
    card.append(head, narration, description, prompt, screenText, meta);
    list.append(card);
  });
  saveDraft();
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
    if (result.creditsRemaining !== undefined) $("videoCreditBalance").textContent = "Sisa kredit: " + Number(result.creditsRemaining).toLocaleString("id-ID");
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
function restoreDraft() {
  if (!storageKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (saved && Array.isArray(saved.scenes) && saved.scenes.length) {
      renderStoryboard(saved);
      setStatus("Draft storyboard lokal dipulihkan. Belum tersimpan ke cloud.");
    }
  } catch {}
}
$("generateStoryboard").addEventListener("click", generateStoryboard);
$("downloadStoryboard").addEventListener("click", downloadJson);
$("copyStoryboard").addEventListener("click", copyStoryboard);
onAuthStateChanged(auth, user => {
  currentUser = user;
  storageKey = user ? "zaida-video-studio-draft-v1-" + user.uid : null;
  if (!user) {
    $("videoUserStatus").textContent = "Belum masuk";
    $("videoCreditBalance").textContent = "Masuk untuk memakai AI";
    setStatus("Masuk melalui ZAIDA Voice untuk membuat storyboard.", true);
    $("generateStoryboard").disabled = true;
  } else {
    $("videoUserStatus").textContent = user.email || "Akun terhubung";
    $("generateStoryboard").disabled = false;
    setStatus("Akun terhubung. Siap membuat storyboard.");
  }
  restoreDraft();
});
