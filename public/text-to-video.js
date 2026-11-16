import { getApps, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

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
let currentUser = null, quoteData = null, activeProjectId = null, pollTimer = null, previewUrl = null;

async function api(path, options = {}) {
  if (!auth.currentUser) throw new Error("Silakan masuk ke akun ZAIDA Voice terlebih dahulu.");
  const token = await auth.currentUser.getIdToken();
  const response = await fetch(path, { ...options, headers: { ...(options.headers || {}), Authorization: "Bearer " + token, ...(options.body ? { "Content-Type": "application/json" } : {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Permintaan gagal (" + response.status + ").");
  return data;
}
function setStatus(message, error = false) {
  $("textVideoStatus").textContent = message;
  $("textVideoStatus").classList.toggle("error", error);
}
function money(value) { return "Rp" + Math.max(0, Number(value) || 0).toLocaleString("id-ID"); }
function durationValue() { return Number($("textVideoDuration").value) || 8; }
function updateEstimate() {
  if (!quoteData) return;
  const duration = durationValue();
  const estimate = Math.ceil(duration * Number(quoteData.providerCostIdr / Math.max(1, quoteData.duration)) * Number(quoteData.markup || 1.5));
  $("textVideoEstimateCredits").textContent = estimate.toLocaleString("id-ID") + " kredit";
  // Rincian modal provider tidak ditampilkan pada UI pengguna.
}
async function refreshAccount() {
  try {
    const data = await api("/api/account");
    const value = Number(data.credits || 0).toLocaleString("id-ID") + " kredit";
    $("sidebarCreditBalance").textContent = value;
    $("creditBalance").hidden = false;
    $("creditBalance").textContent = "Kredit: " + Number(data.credits || 0).toLocaleString("id-ID");
    $("textVideoBalance").textContent = value;
  } catch (error) { $("textVideoBalance").textContent = "Saldo tidak tersedia"; }
}
async function loadQuote() {
  const data = await api("/api/video/generate");
  quoteData = data.quote;
  updateEstimate();
}
async function loadHistory() {
  if (!currentUser) { $("textVideoHistory").textContent = "Masuk untuk melihat riwayat."; return; }
  try {
    const data = await api("/api/video/projects");
    const projects = (data.projects || []).filter(item => item.payload?.kind === "text-to-video");
    const box = $("textVideoHistory");
    box.replaceChildren();
    if (!projects.length) { box.innerHTML = '<div class="empty-output"><b>Belum ada video</b><small>Video yang berhasil dibuat akan muncul di sini.</small></div>'; return; }
    projects.forEach(project => {
      const row = document.createElement("div"); row.className = "text-video-history-row";
      const icon = document.createElement("span"); icon.className = "text-video-history-icon"; icon.textContent = "▶";
      const info = document.createElement("div"); info.className = "text-video-history-info";
      const title = document.createElement("b"); title.textContent = project.title || "Text-to-Video";
      const small = document.createElement("small");
      const p = project.payload || {};
      small.textContent = (p.status || "pending") + " · " + (p.duration || 0) + " detik · " + new Date(project.updatedAt || project.createdAt).toLocaleString("id-ID");
      info.append(title, small); row.append(icon, info);
      if (p.assetId) {
        const open = document.createElement("button"); open.type = "button"; open.textContent = "Preview";
        open.addEventListener("click", () => loadPreview(p.assetId, project.title)); row.append(open);
      } else if (["pending", "in_progress", "submitting", "saving"].includes(p.status)) {
        const check = document.createElement("button"); check.type = "button"; check.textContent = "Periksa";
        check.addEventListener("click", () => pollProject(project.id)); row.append(check);
      }
      const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Hapus";
      remove.addEventListener("click", async () => {
        if (!confirm("Hapus catatan riwayat Text-to-Video ini? File di Media Library tidak ikut dihapus.")) return;
        remove.disabled = true;
        try { await api("/api/video/projects/" + encodeURIComponent(project.id), { method: "DELETE" }); await loadHistory(); }
        catch (error) { remove.disabled = false; alert(error.message); }
      });
      row.append(remove); box.append(row);
    });
  } catch (error) { $("textVideoHistory").textContent = error.message; }
}
async function loadPreview(assetId, title = "Video ZAIDA") {
  const token = await auth.currentUser.getIdToken();
  const response = await fetch("/api/media/assets/" + encodeURIComponent(assetId), { headers: { Authorization: "Bearer " + token } });
  if (!response.ok) throw new Error("Video tidak dapat dimuat dari Media Library.");
  const blob = await response.blob();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(blob);
  const preview = $("textVideoPreview"); preview.replaceChildren();
  const video = document.createElement("video"); video.controls = true; video.playsInline = true; video.src = previewUrl;
  video.setAttribute("aria-label", title); preview.append(video);
  const actions = $("textVideoPreviewActions"); actions.hidden = false; actions.replaceChildren();
  const download = document.createElement("a"); download.href = previewUrl; download.download = "zaida-text-to-video.mp4"; download.textContent = "Unduh MP4"; actions.append(download);
}
async function pollProject(projectId) {
  if (!currentUser || !projectId) return;
  activeProjectId = projectId;
  clearTimeout(pollTimer);
  $("textVideoProgress").hidden = false;
  $("textVideoProgressLabel").textContent = "Memeriksa proses generasi video…";
  try {
    const data = await api("/api/video/generate?id=" + encodeURIComponent(projectId));
    if (data.status === "completed") {
      $("textVideoProgress").hidden = true;
      $("textVideoGenerate").disabled = false; $("textVideoGenerate").textContent = "✦ Generate Video";
      setStatus("Video berhasil dibuat dan otomatis tersimpan di Media Library serta Riwayat.");
      if (data.creditsRemaining !== undefined) {
        $("sidebarCreditBalance").textContent = Number(data.creditsRemaining).toLocaleString("id-ID") + " kredit";
        $("creditBalance").textContent = "Kredit: " + Number(data.creditsRemaining).toLocaleString("id-ID");
        $("textVideoBalance").textContent = Number(data.creditsRemaining).toLocaleString("id-ID") + " kredit";
      }
      await loadPreview(data.assetId, "Video ZAIDA");
      await loadHistory();
      return;
    }
    if (["failed", "cancelled", "expired"].includes(data.status)) {
      $("textVideoProgress").hidden = true;
      $("textVideoGenerate").disabled = false; $("textVideoGenerate").textContent = "✦ Generate Video";
      setStatus(data.error || "Video gagal dibuat. Reservasi kredit dikembalikan.", true);
      await refreshAccount(); await loadHistory(); return;
    }
    $("textVideoProgressLabel").textContent = data.status === "in_progress" ? "AI sedang membuat video…" : "Menunggu provider…";
    pollTimer = setTimeout(() => pollProject(projectId), 20000);
  } catch (error) {
    $("textVideoProgressLabel").textContent = error.message + " Akan mencoba kembali.";
    pollTimer = setTimeout(() => pollProject(projectId), 30000);
  }
}
async function generate() {
  let accepted = false;
  if (!currentUser) { document.getElementById("authButton")?.click(); setStatus("Masuk terlebih dahulu untuk membuat video.", true); return; }
  const prompt = $("textVideoPrompt").value.trim();
  if (prompt.length < 12) { setStatus("Tulis prompt minimal 12 karakter.", true); $("textVideoPrompt").focus(); return; }
  const button = $("textVideoGenerate"); button.disabled = true; button.textContent = "Mengirim ke AI…";
  setStatus("Mengirim prompt ke OpenRouter…");
  const requestId = crypto.randomUUID();
  try {
    const data = await api("/api/video/generate", { method: "POST", body: JSON.stringify({ requestId, prompt, duration: durationValue(), aspectRatio: $("textVideoAspect").value }) });
    accepted = true;
    activeProjectId = data.projectId;
    $("textVideoGenerate").disabled = true;
    $("textVideoGenerate").textContent = "Video sedang diproses…";
    $("textVideoProgress").hidden = false;
    $("textVideoProgressLabel").textContent = "Permintaan diterima. AI sedang menyiapkan video…";
    setStatus("Job diterima. Jangan kirim ulang; kamu bisa meninggalkan halaman dan melanjutkannya dari Riwayat.");
    await refreshAccount(); await loadHistory(); await pollProject(data.projectId);
  } catch (error) {
    setStatus(error.message, true);
    await refreshAccount();
  } finally { if (!accepted) { button.disabled = false; button.textContent = "✦ Generate Video"; } }
}
$("textVideoGenerate").addEventListener("click", generate);
$("textVideoDuration").addEventListener("change", updateEstimate);
onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    $("textVideoBalance").textContent = "Masuk untuk melihat kredit";
    setStatus("Masuk ke akun ZAIDA Voice untuk mulai membuat video.");
    $("textVideoHistory").innerHTML = '<div class="empty-output"><b>Masuk untuk melihat riwayat</b></div>';
    return;
  }
  try {
    await Promise.all([refreshAccount(), loadQuote(), loadHistory()]);
    const pending = (await api("/api/video/projects")).projects?.find(item => item.payload?.kind === "text-to-video" && ["pending", "in_progress", "submitting", "saving"].includes(item.payload.status));
    if (pending) { $("textVideoGenerate").disabled = true; $("textVideoGenerate").textContent = "Video sedang diproses…"; pollProject(pending.id); }
  } catch (error) { setStatus(error.message, true); }
});
