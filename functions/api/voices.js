import { verifyFirebaseUser, getOrCreateAccount, getUserVoiceClone } from "../lib/firebase.js";

function isIndonesianVoice(voice) {
  const labels = voice.labels || {};
  const language = String(labels.language || voice.language || "").toLowerCase();
  return language.includes("indonesian") || language === "id" || language === "id-id";
}

async function fetchSavedVoices(apiKey) {
  const voices = [];
  let pageToken = "";
  // Voice Library voices saved to My Voices are returned by voice_type=saved.
  // Follow pagination so the catalog is not limited to the first page.
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ voice_type: "saved", page_size: "100" });
    if (pageToken) params.set("next_page_token", pageToken);
    const response = await fetch(`https://api.elevenlabs.io/v2/voices?${params}`, {
      headers: { "xi-api-key": apiKey, "Accept": "application/json" }
    });
    if (!response.ok) break;
    const data = await response.json();
    voices.push(...(data.voices || []).filter(isIndonesianVoice));
    if (!data.has_more || !data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return voices;
}

export async function onRequestGet({ request, env }) {
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  try {
    const privateIds = new Set((env.ZAIDA_PRIVATE_VOICE_IDS || "").split(",").map(id => id.trim()).filter(Boolean));
    let isAdmin = false, userClone = null;
    if (request.headers.get("Authorization")) {
      const auth = await verifyFirebaseUser(request, env);
      if (!auth.error) {
        isAdmin = (await getOrCreateAccount(auth.user, env)).role === "admin";
        userClone = await getUserVoiceClone(auth.user, env);
      }
    }

    let upstream = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
    });
    let data = await upstream.json();
    if (!upstream.ok) {
      upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
      });
      data = await upstream.json();
    }
    if (!upstream.ok) return Response.json({ error: data.detail?.message || data.detail || "Gagal mengambil daftar suara ElevenLabs." }, { status: upstream.status });

    const savedVoices = await fetchSavedVoices(env.ELEVENLABS_API_KEY).catch(() => []);
    const combined = new Map();
    for (const voice of [...(data.voices || []), ...savedVoices]) combined.set(voice.voice_id, voice);

    const voices = [...combined.values()]
      .filter(v => privateIds.has(v.voice_id)
        ? isAdmin
        : (v.category === "premade"
          || (savedVoices.some(saved => saved.voice_id === v.voice_id) && isIndonesianVoice(v))
          || (userClone?.voiceId === v.voice_id && userClone.status === "ready")))
      .map(v => {
        const labels = v.labels || {}, isPrivate = privateIds.has(v.voice_id);
        const ownedClone = Boolean(userClone && userClone.voiceId === v.voice_id && userClone.status === "ready");
        const isSavedIndonesian = savedVoices.some(saved => saved.voice_id === v.voice_id);
        return {
          voice_id: v.voice_id,
          name: v.name,
          category: isPrivate ? "private" : (ownedClone ? "user_clone" : (isSavedIndonesian ? "saved_indonesian" : v.category)),
          preview_url: v.preview_url,
          language: labels.language || v.language || "",
          accent: labels.accent || "",
          gender: labels.gender || "",
          description: v.description || "",
          private: isPrivate,
          ownedClone
        };
      });

    return Response.json({ voices }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke layanan suara." }, { status: 502 });
  }
}
