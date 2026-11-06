import { verifyFirebaseUser, getOrCreateAccount, getUserVoiceClone, calculateTtsCharge, reserveCredits, releaseCredits, settleReservedCredits } from "../lib/firebase.js";
export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi di Cloudflare." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const withTimestamps = new URL(request.url).searchParams.get("timestamps") === "1";
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId) return Response.json({ error: "ID permintaan tidak valid. Silakan coba lagi." }, { status: 400 });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
  if (!text || !voiceId) return Response.json({ error: "Teks dan karakter suara wajib diisi." }, { status: 400 });
  if (text.length > 5000) return Response.json({ error: "Maksimal 5.000 karakter per proses." }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId)) return Response.json({ error: "ID suara tidak valid." }, { status: 400 });

  const privateIds = new Set((env.ZAIDA_PRIVATE_VOICE_IDS || "").split(",").map(id => id.trim()).filter(Boolean));
  const isPrivateVoice = privateIds.has(voiceId);

  const s = body.voiceSettings || {};
  const clamp = (v, fallback) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : fallback;

  try {
    const account = await getOrCreateAccount(auth.user, env);
    const billing = calculateTtsCharge(text, env);
    if (account.credits < billing.credits) return Response.json({error:"Kredit tidak mencukupi. Saldo kamu "+account.credits+" kredit; kebutuhan audio ini "+billing.credits+" kredit."},{status:402});
    if (isPrivateVoice && account.role !== "admin") return Response.json({ error: "Suara Zed Clone bersifat pribadi dan hanya tersedia untuk pemilik akun." }, { status: 403 });
    const catalogResponse = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
    });
    const catalog = await catalogResponse.json();
    if (!catalogResponse.ok) return Response.json({ error: "Tidak dapat memverifikasi karakter suara." }, { status: 502 });
    const selected = (catalog.voices || []).find(v => v.voice_id === voiceId);
    const userClone = isPrivateVoice ? null : await getUserVoiceClone(auth.user, env);
    const isOwnedClone = Boolean(userClone && userClone.voiceId === voiceId && userClone.status === "ready");
    if (!selected || (isPrivateVoice ? account.role !== "admin" : (selected.category !== "premade" && !isOwnedClone))) {
      return Response.json({ error: "Karakter suara tidak tersedia untuk akun ini." }, { status: 403 });
    }

    const modelId = env.ZAIDA_TTS_MODEL || "eleven_v4";
    const reservation = await reserveCredits(auth.user, env, billing.credits, "text-to-speech:elevenlabs:" + billing.characters + " characters", { requestId, provider: "elevenlabs", model: modelId });
    const upstreamUrl = "https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) + (withTimestamps ? "/with-timestamps" : "?output_format=mp3_44100_128");
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": withTimestamps ? "application/json" : "audio/mpeg" },
      body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: clamp(s.stability, .5), similarity_boost: clamp(s.similarity_boost, .75), ...(modelId.startsWith("eleven_v4") ? {} : { style: clamp(s.style, 0), use_speaker_boost: true }) } })
    });
    if (!upstream.ok) {
      let message = "ElevenLabs gagal membuat audio.";
      try { const e = await upstream.json(); message = e.detail?.message || e.detail || e.message || message; } catch {}
      await releaseCredits(auth.user, env, reservation.reservationId, "elevenlabs-http-" + upstream.status);
      return Response.json({ error: String(message) }, { status: upstream.status });
    }
    try {
      const timestampPayload = withTimestamps ? await upstream.json() : null;
      if (withTimestamps && !timestampPayload?.audio_base64) {
        await releaseCredits(auth.user, env, reservation.reservationId, "elevenlabs-timestamps-missing-audio");
        return Response.json({ error: "Respons audio bertimestamp tidak valid." }, { status: 502 });
      }
      // Current public API list rates: v4/v3/v2 Multilingual $0.08/1K;
      // Turbo/Flash families $0.04/1K. Allow an explicit account-specific override.
      const listRate = /turbo|flash/i.test(modelId) ? 0.04 : 0.08;
      const customRate = Number(env.ZAIDA_TTS_USD_PER_1000_CHARS);
      const providerCostUsd = (billing.characters / 1000) * (customRate > 0 ? customRate : listRate);
      const charged = await settleReservedCredits(auth.user, env, reservation.reservationId, billing.credits, "text-to-speech:elevenlabs:" + billing.characters + " characters", { provider: "elevenlabs", model: modelId, providerCostIdr: Math.ceil(providerCostUsd * (Number(env.ZAIDA_USD_TO_IDR) || 18000)), providerCostUsd, characters: billing.characters, requestId });
      if (withTimestamps) {
        return Response.json({ audioBase64: timestampPayload.audio_base64, alignment: timestampPayload.alignment || timestampPayload.normalized_alignment || null }, {
          headers: { "Cache-Control": "no-store", "X-Credits-Remaining": String(charged.remaining), "Access-Control-Expose-Headers": "X-Credits-Remaining" }
        });
      }
      return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Content-Disposition": 'attachment; filename="zaida-voice.mp3"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Credits-Remaining": String(charged.remaining), "Access-Control-Expose-Headers": "X-Credits-Remaining" } });
    } catch (creditError) {
      return Response.json({ error: creditError.message || "Tidak dapat memproses kredit." }, { status: creditError.status || 503 });
    }
  } catch (error) {
    return Response.json({ error: error?.message || "Koneksi ke ElevenLabs gagal. Coba lagi." }, { status: error?.status || 502 });
  }
}
