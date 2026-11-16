const $ = id => document.getElementById(id);
const studios = {
 edit:{title:"Edit Foto",description:"Pilih jenis perbaikan atau perubahan yang ingin dilakukan.",templates:[["restore","Perbaiki Foto Lama","Pulihkan foto lama dan kurangi kerusakan visual.","↗",true],["enhance","Perjelas Foto","Tingkatkan kejernihan dan detail foto.","✧",true],["background","Ganti Background","Ganti latar foto dengan suasana pilihan.","▧",true],["remove","Hapus Objek","Hilangkan objek yang mengganggu dari foto.","⌫",true],["lighting","Perbaiki Pencahayaan","Atur pencahayaan agar foto terlihat lebih seimbang.","☼",true],["style","Ubah Gaya Foto","Terapkan gaya visual baru pada foto.","◈",true],["free","Edit Bebas","Tulis sendiri perubahan yang kamu inginkan.","✎",true]]},
 product:{title:"Foto Produk",description:"Buat foto produk yang siap digunakan untuk katalog dan promosi.",templates:[["clean","Katalog Putih","Foto produk dengan latar putih bersih.","▣",true],["premium","Studio Premium","Tampilan produk dengan pencahayaan komersial premium.","✦",true],["lifestyle","Lifestyle","Tempatkan produk dalam suasana penggunaan yang natural.","⌂",true],["advert","Iklan Produk","Visual promosi produk dengan komposisi menarik.","▤",true],["medical","Medical Product","Foto profesional khusus alat kesehatan.","✚",true],["marketplace","Marketplace","Foto produk yang rapi untuk katalog toko online.","▦",true]]},
 poster:{title:"Poster & Konten",description:"Pilih format konten yang ingin kamu buat.",templates:[["feed","Instagram Feed","Konten persegi atau portrait untuk feed.","▧",false],["story","Instagram Story","Konten vertikal untuk story dan reels cover.","▤",false],["banner","Banner Promosi","Banner untuk toko, layanan, atau kampanye.","▰",false],["thumbnail","Thumbnail YouTube","Visual thumbnail dengan fokus pada headline.","▶",false],["promo","Poster Promosi","Poster promosi dengan ruang untuk informasi utama.","✦",false]]},
 education:{title:"Ilustrasi & Edukasi",description:"Buat visual penjelasan yang mudah dipahami.",templates:[["medical","Ilustrasi Medis","Visual anatomi dan tindakan untuk edukasi.","✚",false],["nursing","Prosedur Keperawatan","Ilustrasi langkah tindakan keperawatan.","＋",false],["infographic","Infografis","Ringkas informasi menjadi visual terstruktur.","▦",false],["patient","Edukasi Pasien","Materi visual sederhana untuk pasien dan keluarga.","♡",false]]},
 portrait:{title:"Portrait Studio",description:"Pilih gaya potret sesuai kebutuhan.",templates:[["professional","Foto Profesional","Potret formal dengan pencahayaan studio.","◉",true],["profile","Foto Profil","Potret rapi untuk profil digital.","◎",true],["editorial","Editorial","Gaya portrait majalah dan editorial.","✦",true],["outdoor","Outdoor","Potret dengan suasana luar ruangan.","☼",true]]},
 character:{title:"Karakter & Avatar",description:"Bangun karakter visual untuk konten dan brand.",templates:[["mascot","Maskot Brand","Karakter khas untuk identitas brand.","☺",false],["3d","Karakter 3D","Karakter bergaya 3D yang ekspresif.","◇",false],["sticker","Sticker","Sticker karakter dengan gaya pilihan.","✿",false],["avatar","Avatar Edukasi","Karakter untuk konten edukasi dan cerita.","♙",false]]},
 brand:{title:"Logo & Branding",description:"Mulai membangun identitas visual brand.",templates:[["logo","Logo","Konsep logo untuk identitas usaha atau proyek.","◇",false],["icon","Ikon Brand","Ikon sederhana untuk produk dan aplikasi.","✧",false],["identity","Brand Identity","Arah visual dan elemen identitas brand.","▣",false]]},
 free:{title:"Generate Bebas",description:"Mulai dari ide dan biarkan ZAIDA membantu mengubahnya menjadi visual.",templates:[["prompt","Buat dari Ide","Tulis gambaran singkat tentang gambar yang kamu inginkan.","✧",false],["reference","Buat dari Referensi","Gunakan gambar referensi sebagai titik awal.","▧",true]]}
};
let activeStudio=null,activeTemplate=null,referenceUrl="",imageEditQuote=null;
function openCatalog(id){const studio=studios[id];if(!studio)return;activeStudio=id;$("imageStudioGrid").hidden=true;document.querySelector(".image-studio-lower-links").hidden=true;$("imageStudioCatalog").hidden=false;$("imageStudioWorkspace").hidden=true;$("imageStudioCatalogTitle").textContent=studio.title;$("imageStudioCatalogDescription").textContent=studio.description;$("imageStudioCatalogLabel").textContent=studio.templates.length+" template";$("imageTemplateGrid").innerHTML=studio.templates.map(t=>'<button class="image-template-card" type="button" data-image-template="'+t[0]+'"><span class="image-template-art">'+t[3]+'</span><strong>'+t[1]+'</strong><small>'+t[2]+'</small></button>').join("");$("imageStudioCatalog").scrollIntoView({behavior:"smooth",block:"start"});}
function openTemplate(id){const studio=studios[activeStudio],template=studio?.templates.find(t=>t[0]===id);if(!template)return;activeTemplate=template;$("imageStudioGenerate").innerHTML=(activeStudio==="edit"?"Edit Foto":"Buat Desain")+' <b>→</b>';const billingNotice=$("imageEditBillingNotice"),consentWrap=$("imageEditConsentWrap");if(billingNotice)billingNotice.hidden=activeStudio!=="edit";if(consentWrap)consentWrap.hidden=false;if($("imageEditConsent"))$("imageEditConsent").checked=false;loadImageEditQuote(activeStudio==="edit"?"edit":"generate");const ratioControl=$("imageOutputRatioControl");if(ratioControl)ratioControl.hidden=activeStudio==="edit";$("imageStudioCatalog").hidden=true;$("imageStudioWorkspace").hidden=false;$("imageTemplateSelectedLabel").textContent=template[1];$("imageWorkspaceTitle").textContent=template[1];$("imageWorkspaceDescription").textContent=template[2];$("imageReferenceRequired").textContent=template[4]?"Diperlukan":"Opsional";$("imageReferenceInput").required=Boolean(template[4]);$("imageReferenceInput").value="";$("imageReferencePreview").hidden=true;$("imageReferencePreview").replaceChildren();if(referenceUrl)URL.revokeObjectURL(referenceUrl);referenceUrl="";renderTemplateFields();$("imageStudioStatus").textContent="Template siap. Lengkapi detail, unggah referensi bila diperlukan, lalu jalankan proses.";$("imageStudioResult").hidden=true;$("imageStudioEmptyResult").hidden=false;$("imageStudioWorkspace").scrollIntoView({behavior:"smooth",block:"start"});}
function renderTemplateFields(){const studio=activeStudio;let fields=[];if(studio==="product")fields=[["Nama produk","text","Contoh: Pulse Oximeter"],["Informasi produk","textarea","Fitur atau informasi yang harus terlihat"],["Suasana foto","select",["Otomatis","Minimalis","Klinis","Premium","Lifestyle"]]];else if(studio==="poster")fields=[["Judul utama","text","Tuliskan judul poster"],["Teks pendukung","textarea","Informasi yang ingin ditampilkan"],["Warna dominan","select",["Otomatis","Ungu","Biru","Hijau","Hangat","Monokrom"]]];else if(studio==="education")fields=[["Topik edukasi","text","Contoh: Teknik injeksi insulin"],["Poin penting","textarea","Masukkan informasi yang harus dijelaskan"],["Gaya ilustrasi","select",["Ilustrasi medis","Flat illustration","3D edukasi","Infografis"]]];else if(studio==="free")fields=[["Ide gambar","textarea","Jelaskan gambar yang ingin dibuat"]];else if(studio==="edit")fields=activeTemplate?.[0]==="free"?[["Instruksi edit bebas","textarea","Contoh: ganti pakaian menjadi jas hitam, pertahankan wajah dan ekspresi asli"]]:[["Instruksi tambahan (opsional)","textarea","Tambahkan detail perubahan yang kamu inginkan"]];else if(studio==="portrait")fields=[["Gaya potret","select",["Profesional","Formal","Editorial","Outdoor","Kreatif"]]];else if(studio==="character")fields=[["Deskripsi karakter","textarea","Ceritakan karakter yang ingin dibuat"],["Gaya visual","select",["3D","Kartun","Anime","Ilustrasi","Minimalis"]]];else if(studio==="brand")fields=[["Nama brand","text","Nama usaha atau proyek"],["Bidang usaha","text","Contoh: kesehatan, kuliner, teknologi"],["Karakter brand","select",["Modern","Minimalis","Premium","Ramah","Playful"]]];$("imageTemplateFields").innerHTML=fields.map((f,i)=>{const id="imageField"+i;if(f[1]==="select")return '<div class="image-template-field"><label for="'+id+'">'+f[0]+'</label><select id="'+id+'">'+f[2].map(v=>'<option>'+v+'</option>').join("")+'</select></div>';if(f[1]==="textarea")return '<div class="image-template-field"><label for="'+id+'">'+f[0]+'</label><textarea id="'+id+'" rows="3" placeholder="'+f[2]+'"></textarea></div>';return '<div class="image-template-field"><label for="'+id+'">'+f[0]+'</label><input id="'+id+'" type="text" placeholder="'+f[2]+'"></div>';}).join("");}
function backToHome(){$("imageStudioCatalog").hidden=true;$("imageStudioWorkspace").hidden=true;$("imageStudioGrid").hidden=false;document.querySelector(".image-studio-lower-links").hidden=false;activeStudio=null;activeTemplate=null;$("imageStudioPage").scrollIntoView({behavior:"smooth",block:"start"});$("imageStudioResult").hidden=true;$("imageStudioEmptyResult").hidden=false;}
$("imageStudioGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-image-studio]");if(b)openCatalog(b.dataset.imageStudio);});
$("imageTemplateGrid")?.addEventListener("click",e=>{const b=e.target.closest("[data-image-template]");if(b)openTemplate(b.dataset.imageTemplate);});
document.querySelector("[data-image-back]")?.addEventListener("click",backToHome);
document.querySelector("[data-image-back-catalog]")?.addEventListener("click",()=>openCatalog(activeStudio));
document.querySelector("[data-image-open-media]")?.addEventListener("click",()=>{window.location.href="/?view=media";});
document.querySelector("[data-image-open-history]")?.addEventListener("click",()=>{window.location.href="/?view=history";});
$("imageReferenceInput")?.addEventListener("change",e=>{const file=e.target.files?.[0];if(referenceUrl)URL.revokeObjectURL(referenceUrl);referenceUrl="";const preview=$("imageReferencePreview");preview.replaceChildren();if(!file){preview.hidden=true;return;}if(!["image/png","image/jpeg","image/webp"].includes(file.type)){e.target.value="";$("imageStudioStatus").textContent="Gunakan gambar PNG, JPEG, atau WebP.";return;}if(file.size>12*1024*1024){e.target.value="";$("imageStudioStatus").textContent="Ukuran gambar maksimal 12 MB.";return;}referenceUrl=URL.createObjectURL(file);const img=document.createElement("img");img.src=referenceUrl;img.alt="Preview foto referensi";preview.append(img);preview.hidden=false;});


// Shared ZAIDA Voice sidebar controls for the standalone Image Studio page.
const sidebar = $("sidebar");
const backdrop = $("sidebarBackdrop");
function setSidebarOpen(open) {
  sidebar?.classList.toggle("open", open);
  document.body.classList.toggle("sidebar-open", open);
  if (backdrop) backdrop.hidden = !open;
}
$("mobileMenu")?.addEventListener("click", () => setSidebarOpen(true));
$("sidebarClose")?.addEventListener("click", () => setSidebarOpen(false));
backdrop?.addEventListener("click", () => setSidebarOpen(false));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") setSidebarOpen(false);
});


// Use the same Firebase project and persistent login session as the main ZAIDA app.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
const firebaseConfig = {
  apiKey: "AIzaSyDqzKq2OXQfYnG-DOSyuzo4xo0GjSb-aP8",
  authDomain: "zaida-voice.firebaseapp.com",
  projectId: "zaida-voice",
  storageBucket: "zaida-voice.firebasestorage.app",
  messagingSenderId: "146292786794",
  appId: "1:146292786794:web:da865938c177b21d5d6c13"
};
const firebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const imageAuth = getAuth(firebaseApp);
let imageAuthMode = "login";
let imageCurrentUser = null;
function showImageAuth(mode = "login") {
  imageAuthMode = mode;
  $("imageAuthTitle").textContent = mode === "login" ? "Selamat datang." : "Buat akun ZAIDA Voice.";
  $("imageAuthDescription").textContent = mode === "login" ? "Masuk untuk menggunakan Image Studio." : "Daftar menggunakan email aktif.";
  $("imageAuthSubmit").innerHTML = mode === "login" ? 'Masuk <b>→</b>' : 'Buat akun <b>→</b>';
  $("imageAuthSwitch").textContent = mode === "login" ? "Belum punya akun? Daftar" : "Sudah punya akun? Masuk";
  $("imageAuthMessage").textContent = "";
  $("imageAuthOverlay").hidden = false;
}
function closeImageAuth() { $("imageAuthOverlay").hidden = true; }
$("imageAuthButton")?.addEventListener("click", () => imageCurrentUser ? signOut(imageAuth) : showImageAuth());
$("imageAuthClose")?.addEventListener("click", closeImageAuth);
$("imageAuthOverlay")?.addEventListener("click", e => { if (e.target === $("imageAuthOverlay")) closeImageAuth(); });
$("imageAuthSwitch")?.addEventListener("click", () => showImageAuth(imageAuthMode === "login" ? "register" : "login"));
$("imageAuthForm")?.addEventListener("submit", async e => {
  e.preventDefault();
  const email = $("imageAuthEmail").value.trim();
  const password = $("imageAuthPassword").value;
  const button = $("imageAuthSubmit");
  button.disabled = true;
  $("imageAuthMessage").textContent = "Memproses…";
  try {
    if (imageAuthMode === "login") await signInWithEmailAndPassword(imageAuth, email, password);
    else {
      const credential = await createUserWithEmailAndPassword(imageAuth, email, password);
      await sendEmailVerification(credential.user);
      $("imageAuthMessage").textContent = "Akun dibuat. Silakan verifikasi email sebelum menggunakan fitur AI.";
    }
    closeImageAuth();
  } catch (error) {
    const messages = {"auth/invalid-credential":"Email atau password salah.","auth/email-already-in-use":"Email sudah terdaftar.","auth/invalid-email":"Format email tidak valid.","auth/weak-password":"Password minimal 6 karakter.","auth/too-many-requests":"Terlalu banyak percobaan. Coba lagi nanti."};
    $("imageAuthMessage").textContent = messages[error.code] || error.message;
  } finally { button.disabled = false; }
});
$("imageGoogleAuth")?.addEventListener("click", async () => {
  const button = $("imageGoogleAuth");
  button.disabled = true;
  $("imageAuthMessage").textContent = "Menghubungkan ke Google…";
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({prompt:"select_account"});
    await signInWithPopup(imageAuth, provider);
    closeImageAuth();
  } catch (error) { $("imageAuthMessage").textContent = error.message; }
  finally { button.disabled = false; }
});
$("imageAuthResend")?.addEventListener("click", async () => {
  try {
    if (!imageAuth.currentUser) throw new Error("Masuk kembali menggunakan email dan password.");
    await sendEmailVerification(imageAuth.currentUser);
    $("imageAuthMessage").textContent = "Email verifikasi telah dikirim ulang.";
  } catch (error) { $("imageAuthMessage").textContent = error.message; }
});

async function loadImageEditQuote(mode = "edit") {
  imageEditQuote = null;
  const textNode = $("imageEditQuoteText");
  if (textNode) textNode.textContent = "Memuat estimasi kredit…";
  const user = imageAuth.currentUser;
  if (!user || !user.emailVerified) {
    if (textNode) textNode.textContent = "Masuk dengan akun terverifikasi untuk melihat estimasi.";
    return null;
  }
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/image-studio/quote?mode=" + encodeURIComponent(mode), { headers: { Authorization: "Bearer " + token }, cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Estimasi biaya tidak tersedia.");
    imageEditQuote = data;
    const fmt = n => Number(n || 0).toLocaleString("id-ID");
    if (textNode) textNode.textContent = "Estimasi sekitar " + fmt(data.estimatedCredits) + " kredit per proses. Sebelum proses, sistem dapat menahan sementara hingga " + fmt(data.maxTemporaryReserve) + " kredit; sisa reservasi dikembalikan setelah biaya aktual dihitung. Estimasi dapat berubah mengikuti provider.";
    return data;
  } catch (error) {
    if (textNode) textNode.textContent = error.message || "Estimasi kredit tidak dapat dimuat. Coba muat ulang.";
    return null;
  }
}
async function getImageDimensions(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dimensions;
}

async function imageFileToDataUrl(file) {
  if (!file || !["image/png","image/jpeg","image/webp"].includes(file.type)) throw new Error("Gunakan foto PNG, JPEG, atau WebP.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Ukuran foto maksimal 12 MB.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("Foto tidak dapat diproses di perangkat ini.");
  if (blob.size > 2 * 1024 * 1024) throw new Error("Foto terlalu besar setelah kompresi. Pilih foto lain.");
  return await new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Gagal membaca foto."));
    reader.readAsDataURL(blob);
  });
}
$("imageStudioGenerate")?.addEventListener("click", async () => {
  if (!imageCurrentUser || !imageAuth.currentUser || !imageAuth.currentUser.emailVerified) {
    $("imageStudioStatus").textContent = "Masuk dengan akun terverifikasi untuk menggunakan AI.";
    showImageAuth("login");
    return;
  }
  const file = $("imageReferenceInput").files?.[0];
  const isEdit = activeStudio === "edit";
  const requiresReference = Boolean(activeTemplate?.[4]);
  if ((isEdit || requiresReference) && !file) {
    $("imageStudioStatus").textContent = "Silakan unggah foto referensi terlebih dahulu.";
    $("imageReferenceInput").focus();
    return;
  }
  if (file && (!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size > 12 * 1024 * 1024)) {
    $("imageStudioStatus").textContent = "Gunakan foto PNG, JPEG, atau WebP maksimal 12 MB.";
    $("imageReferenceInput").focus();
    return;
  }
  if (!$("imageEditConsent")?.checked) {
    $("imageStudioStatus").textContent = "Centang persetujuan penggunaan foto sebelum melanjutkan.";
    $("imageEditConsent")?.focus();
    return;
  }
  const quote = imageEditQuote || await loadImageEditQuote(isEdit ? "edit" : "generate");
  if (!quote) { $("imageStudioStatus").textContent = "Estimasi kredit belum tersedia. Coba lagi sebelum memproses."; return; }
  if (Number(quote.availableCredits) < Number(quote.maxTemporaryReserve)) {
    $("imageStudioStatus").textContent = "Saldo belum cukup untuk reservasi maksimal " + Number(quote.maxTemporaryReserve).toLocaleString("id-ID") + " kredit.";
    return;
  }
  const button = $("imageStudioGenerate");
  button.disabled = true;
  button.textContent = isEdit ? "Menyiapkan foto…" : "Menyiapkan desain…";
  $("imageStudioStatus").textContent = "Memeriksa sesi akun dan menyiapkan gambar…";
  try {
    const referenceImage = file ? await imageFileToDataUrl(file) : null;
    const token = await imageAuth.currentUser.getIdToken(true);
    const requestId = crypto.randomUUID();
    let endpoint, payload;
    if (isEdit) {
      endpoint = "/api/image-studio/edit";
      const sourceDimensions = await getImageDimensions(file);
      payload = {
        requestId, templateId: activeTemplate?.[0] || "free",
        prompt: $("imageField0")?.value?.trim() || "",
        referenceImage, sourceDimensions
      };
    } else {
      endpoint = "/api/image-studio/generate";
      const fieldNodes = [...$("imageTemplateFields").querySelectorAll(".image-template-field")];
      const fields = {};
      fieldNodes.forEach((node, index) => {
        const label = node.querySelector("label")?.textContent?.trim() || ("Informasi " + (index + 1));
        const control = node.querySelector("input, textarea, select");
        if (control?.value?.trim()) fields[label] = control.value.trim();
      });
      const prompt = activeStudio === "free" ? (fields["Ide gambar"] || "") : "";
      if (activeStudio === "free" && prompt.length < 8) throw new Error("Tuliskan ide gambar minimal 8 karakter.");
      payload = {
        requestId, studio: activeStudio, templateId: activeTemplate?.[0],
        templateLabel: activeTemplate?.[1], fields, prompt, referenceImage,
        requiresReference, aspectRatio: $("imageOutputRatio")?.value || "1:1"
      };
    }
    button.textContent = isEdit ? "Sedang mengedit…" : "Sedang membuat desain…";
    $("imageStudioStatus").textContent = "Mengirim permintaan ke mesin AI. Jangan tutup halaman.";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Proses gambar gagal (" + response.status + ").");
    if (!result.image?.b64 || !result.image?.mime || !result.image?.assetId) throw new Error("Server tidak mengembalikan hasil gambar yang lengkap.");
    const dataUrl = "data:" + result.image.mime + ";base64," + result.image.b64;
    $("imageStudioResultImage").src = dataUrl;
    $("imageStudioDownload").href = dataUrl;
    $("imageStudioDownload").download = "zaida-" + (activeStudio || "edit") + "-" + result.image.assetId.slice(0,8) + (result.image.mime === "image/jpeg" ? ".jpg" : result.image.mime === "image/webp" ? ".webp" : ".png");
    $("imageStudioResultMeta").textContent = (result.provider || "AI") + " · " + Number(result.creditsCharged || 0).toLocaleString("id-ID") + " kredit";
    $("imageStudioEmptyResult").hidden = true;
    $("imageStudioResult").hidden = false;
    const credits = Number(result.creditsRemaining);
    if (Number.isFinite(credits)) {
      const formatted = credits.toLocaleString("id-ID");
      $("imageCreditBalance").textContent = "Kredit: " + formatted;
      $("sidebarCreditBalance").textContent = formatted + " kredit";
    }
    $("imageStudioStatus").textContent = isEdit
      ? "Foto berhasil diedit dan disimpan ke Media Library."
      : "Desain berhasil dibuat dan disimpan ke Media Library.";
  } catch (error) {
    $("imageStudioStatus").textContent = error.message || "Tidak dapat memproses gambar.";
  } finally {
    button.disabled = false;
    button.innerHTML = (isEdit ? "Edit Foto" : "Buat Desain") + ' <b>→</b>';
  }
});

onAuthStateChanged(imageAuth, async user => {
  imageCurrentUser = user && user.emailVerified ? user : null;
  const allowed = Boolean(imageCurrentUser);
  const display = allowed ? (user.displayName || user.email || "U").slice(0,1).toUpperCase() : "Z";
  $("imageAuthButton").textContent = allowed ? (user.email || "Akun") + " · Keluar" : "Masuk / Daftar";
  $("imageProfileName").textContent = allowed ? (user.displayName || "Pengguna") : "Pengunjung";
  $("imageProfileEmail").textContent = allowed ? "Akun terverifikasi" : (user ? "Email belum diverifikasi" : "Belum masuk");
  $("imageProfileAvatar").textContent = display;
  $("imageTopAvatar").textContent = display;
  $("imageAuthResend").hidden = !(user && !user.emailVerified);
  if (!allowed) {
    $("sidebarCreditBalance").textContent = "Masuk untuk melihat saldo";
    $("imageCreditBalance").textContent = "Kredit: —";
    return;
  }
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/account", {headers:{Authorization:"Bearer "+token}});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Saldo tidak dapat dimuat.");
    const formattedCredits = Number(data.credits).toLocaleString("id-ID");
    $("sidebarCreditBalance").textContent = formattedCredits + " kredit";
    $("imageCreditBalance").textContent = "Kredit: " + formattedCredits;
  } catch (error) {
    $("sidebarCreditBalance").textContent = "Saldo tidak tersedia";
    $("imageCreditBalance").textContent = "Kredit: —";
    console.warn("Image Studio account refresh:", error);
  }
});
