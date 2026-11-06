export async function onRequestGet({ env }) {
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  try {
    // v2 returns language/accent labels; public beta still exposes premade voices only.
    let upstream = await fetch("https://api.elevenlabs.io/v2/voices?category=premade&page_size=100", {
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
    const blockedIds = new Set((env.ZAIDA_PRIVATE_VOICE_IDS || "").split(",").map(id => id.trim()).filter(Boolean));
    const voices = (data.voices || []).filter(voice => voice.category === "premade" && !blockedIds.has(voice.voice_id)).map(voice => {
      const labels = voice.labels || {};
      return { voice_id: voice.voice_id, name: voice.name, category: voice.category, preview_url: voice.preview_url,
        language: labels.language || "", accent: labels.accent || "", gender: labels.gender || "", description: voice.description || "" };
    });
    return Response.json({ voices }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke layanan suara." }, { status: 502 });
  }
}