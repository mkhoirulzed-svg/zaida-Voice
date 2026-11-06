import { verifyFirebaseUser, getOrCreateAccount, getUserVoiceClone } from "../lib/firebase.js";
export async function onRequestGet({ request, env }) {
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  try {
    const privateIds = new Set((env.ZAIDA_PRIVATE_VOICE_IDS || "").split(",").map(id => id.trim()).filter(Boolean));
    let isAdmin = false, userClone = null;
    if (request.headers.get("Authorization")) {
      const auth = await verifyFirebaseUser(request, env);
      if (!auth.error) { isAdmin = (await getOrCreateAccount(auth.user, env)).role === "admin"; userClone = await getUserVoiceClone(auth.user, env); }
    }
    let upstream = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", { headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" } });
    let data = await upstream.json();
    if (!upstream.ok) {
      upstream = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" } });
      data = await upstream.json();
    }
    if (!upstream.ok) return Response.json({ error: data.detail?.message || data.detail || "Gagal mengambil daftar suara ElevenLabs." }, { status: upstream.status });
    const voices = (data.voices || []).filter(v => privateIds.has(v.voice_id) ? isAdmin : (v.category === "premade" || (userClone?.voiceId === v.voice_id && userClone.status === "ready"))).map(v => {
      const labels = v.labels || {}, isPrivate = privateIds.has(v.voice_id);
      const ownedClone = Boolean(userClone && userClone.voiceId === v.voice_id && userClone.status === "ready");
      return { voice_id:v.voice_id, name:v.name, category:isPrivate?"private":(ownedClone?"user_clone":v.category), preview_url:v.preview_url,
        language:labels.language||"", accent:labels.accent||"", gender:labels.gender||"", description:v.description||"", private:isPrivate, ownedClone };
    });
    return Response.json({ voices }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Tidak dapat terhubung ke layanan suara." }, { status: 502 }); }
}
