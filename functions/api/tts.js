import { verifyFirebaseUser, getOrCreateAccount, calculateTtsCharge, billUsage } from "../lib/firebase.js";
export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi di Cloudflare." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const voiceId = typeof body.voiceId === "string" ? body.voiceId : "";
  if (!text || !voiceId) return Response.json({ error: "Teks dan karakter suara wajib diisi." }, { status: 400 });
  if (text.length > 5000) return Response.json({ error: "Maksimal 5.000 karakter per proses." }, { status: 400 });
  if (!/^[a-zA-Z0-9_-]{5,100}$/.test(voiceId)) return Response.json({ error: "ID suara tidak valid." }, { status: 400 });

  const privateIds = new Set((env.ZAIDA_PRIVATE_VOICE_IDS || "").split(",").map(id => id.trim()).filter(Boolean));
  if (privateIds.has(voiceId)) return Response.json({ error: "Suara ini bersifat privat." }, { status: 403 });

  const s = body.voiceSettings || {};
  const clamp = (v, fallback) => Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : fallback;

  try {
    const account = await getOrCreateAccount(auth.user, env);
    const billing = calculateTtsCharge(text, env);
    if (account.credits < billing.credits) return Response.json({error:"Kredit tidak mencukupi. Saldo kamu "+account.credits+" kredit; kebutuhan audio ini "+billing.credits+" kredit."},{status:402});
    // Public beta only permits built-in premade voices, never cloned voices.
    const catalogResponse = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
    });
    const catalog = await catalogResponse.json();
    if (!catalogResponse.ok) return Response.json({ error: "Tidak dapat memverifikasi karakter suara." }, { status: 502 });
    const selected = (catalog.voices || []).find(v => v.voice_id === voiceId);
    if (!selected || selected.category !== "premade") {
      return Response.json({ error: "Suara clone/pribadi tidak tersedia untuk pengguna umum." }, { status: 403 });
    }

    const upstream = await fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(voiceId) + "?output_format=mp3_44100_128", {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Content-Type": "application/json", "Accept": "audio/mpeg" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", voice_settings: { stability: clamp(s.stability, .5), similarity_boost: clamp(s.similarity_boost, .75), style: clamp(s.style, 0), use_speaker_boost: true } })
    });
    if (!upstream.ok) {
      let message = "ElevenLabs gagal membuat audio.";
      try { const e = await upstream.json(); message = e.detail?.message || e.detail || e.message || message; } catch {}
      return Response.json({ error: String(message) }, { status: upstream.status });
    }
    try {
      const charged = await billUsage(auth.user, env, billing.credits, "text-to-speech:elevenlabs:"+billing.characters+" characters");
      const remaining = charged.remaining;
      return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Content-Disposition": 'attachment; filename="zaida-voice.mp3"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Credits-Remaining": String(remaining), "Access-Control-Expose-Headers": "X-Credits-Remaining" } });
    } catch (creditError) {
      return Response.json({ error: creditError.message || "Tidak dapat memproses kredit." }, { status: creditError.status || 503 });
    }
  } catch {
    return Response.json({ error: "Koneksi ke ElevenLabs gagal. Coba lagi." }, { status: 502 });
  }
}
