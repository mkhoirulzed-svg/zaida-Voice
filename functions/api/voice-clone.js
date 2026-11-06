import { verifyFirebaseUser, getOrCreateAccount, getUserVoiceClone, createUserVoiceClone, updateUserVoiceClone, deleteUserVoiceCloneRecord, reserveCredits, releaseCredits, settleReservedCredits } from "../lib/firebase.js";

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  const cost = Number(env.ZAIDA_VOICE_CLONE_CREDITS);
  if (!Number.isSafeInteger(cost) || cost < 1) return Response.json({ error: "Biaya clone belum dikonfigurasi. ZAIDA_VOICE_CLONE_CREDITS harus diatur di Cloudflare." }, { status: 503 });

  let form;
  try { form = await request.formData(); } catch { return Response.json({ error: "Form upload tidak valid." }, { status: 400 }); }
  const name = String(form.get("name") || "").trim().slice(0, 40);
  const requestId = String(form.get("requestId") || "");
  const file = form.get("audio");
  const consent = form.get("consent") === "true";
  if (!name) return Response.json({ error: "Nama suara wajib diisi." }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return Response.json({ error: "ID permintaan tidak valid." }, { status: 400 });
  if (!consent) return Response.json({ error: "Persetujuan penggunaan dan cloning suara wajib diberikan." }, { status: 400 });
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Pilih file rekaman suara." }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "Ukuran rekaman maksimal 25 MB." }, { status: 413 });
  const allowed = ["audio/mpeg","audio/mp3","audio/wav","audio/x-wav","audio/mp4","audio/m4a","audio/webm","audio/ogg"];
  if (file.type && !allowed.includes(file.type.toLowerCase())) return Response.json({ error: "Format audio harus MP3, WAV, M4A, OGG, atau WebM." }, { status: 415 });

  let reservation = null, recordCreated = false, upstreamVoiceId = "";
  try {
    await getOrCreateAccount(auth.user, env);
    const existing = await getUserVoiceClone(auth.user, env);
    if (existing) return Response.json({ error: "Akun ini sudah memiliki clone suara. Hapus clone lama sebelum membuat yang baru.", voice: { name: existing.name, status: existing.status } }, { status: 409 });

    reservation = await reserveCredits(auth.user, env, cost, "voice-clone:elevenlabs:instant", { requestId, provider: "elevenlabs", model: "instant-voice-cloning" });
    try {
      await createUserVoiceClone(auth.user, env, { name, status: "creating" });
      recordCreated = true;
    } catch (error) {
      if (error.status === 409) {
        await releaseCredits(auth.user, env, reservation.reservationId, "voice-clone-already-exists");
        return Response.json({ error: "Akun ini sudah memiliki clone suara." }, { status: 409 });
      }
      throw error;
    }

    const upstreamForm = new FormData();
    upstreamForm.append("name", name);
    upstreamForm.append("description", "Private user voice clone created in ZAIDA Voice.");
    upstreamForm.append("labels", JSON.stringify({ language: "id", use_case: "personal_voice_clone" }));
    upstreamForm.append("files", file, file.name || "voice-sample");
    const upstream = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }, body: upstreamForm
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok || !result.voice_id) {
      const message = result.detail?.message || result.detail || result.message || "ElevenLabs gagal membuat clone suara.";
      throw Object.assign(new Error(String(message)), { status: upstream.status || 502 });
    }
    upstreamVoiceId = result.voice_id;
    const status = result.requires_verification ? "verification_required" : "ready";
    await updateUserVoiceClone(auth.user, env, { voiceId: upstreamVoiceId, name, status });
    const charged = await settleReservedCredits(auth.user, env, reservation.reservationId, cost, "Pembuatan clone suara: " + name, {
      provider: "elevenlabs", model: "instant-voice-cloning", providerCostIdr: 0, providerCostUsd: 0
    });
    return Response.json({
      voice: { voiceId: upstreamVoiceId, name, status },
      creditsCharged: cost, creditsRemaining: charged.remaining,
      message: status === "ready" ? "Clone suara berhasil dibuat." : "Clone dibuat dan memerlukan verifikasi ElevenLabs sebelum dapat digunakan."
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (upstreamVoiceId) {
      try { await fetch("https://api.elevenlabs.io/v1/voices/" + encodeURIComponent(upstreamVoiceId), { method: "DELETE", headers: { "xi-api-key": env.ELEVENLABS_API_KEY } }); } catch {}
    }
    if (recordCreated) {
      try { await deleteUserVoiceCloneRecord(auth.user, env); } catch {}
    }
    if (reservation) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "voice-clone-failed"); } catch {}
    }
    return Response.json({ error: error.message || "Gagal membuat clone suara." }, { status: error.status || 502 });
  }
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try {
    const voice = await getUserVoiceClone(auth.user, env);
    return Response.json({ voice: voice ? { voiceId: voice.voiceId, name: voice.name, status: voice.status, createdAt: voice.createdAt } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error.message || "Gagal memuat clone suara." }, { status: error.status || 502 }); }
}

export async function onRequestDelete({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  try {
    const voice = await getUserVoiceClone(auth.user, env);
    if (!voice) return Response.json({ error: "Clone suara tidak ditemukan." }, { status: 404 });
    if (voice.voiceId) {
      const upstream = await fetch("https://api.elevenlabs.io/v1/voices/" + encodeURIComponent(voice.voiceId), {
        method: "DELETE", headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
      });
      if (!upstream.ok && upstream.status !== 404) {
        const data = await upstream.json().catch(() => ({}));
        return Response.json({ error: data.detail?.message || data.detail || "ElevenLabs gagal menghapus clone." }, { status: upstream.status });
      }
    }
    await deleteUserVoiceCloneRecord(auth.user, env);
    return Response.json({ ok: true, message: "Clone suara berhasil dihapus." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error.message || "Gagal menghapus clone suara." }, { status: error.status || 502 }); }
}
