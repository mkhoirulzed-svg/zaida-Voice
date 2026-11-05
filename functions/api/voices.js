export async function onRequestGet({ env }) {
  if (!env.ELEVENLABS_API_KEY) {
    return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  }

  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "Accept": "application/json"
      }
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return Response.json(
        { error: data.detail?.message || data.detail || "Gagal mengambil daftar suara ElevenLabs." },
        { status: upstream.status }
      );
    }

    // Public beta only exposes ElevenLabs' built-in premade voices.
    // Cloned voices (including ZAIDA Labs' private clones) are never listed.
    const blockedIds = new Set(
      (env.ZAIDA_PRIVATE_VOICE_IDS || "")
        .split(",")
        .map(id => id.trim())
        .filter(Boolean)
    );

    const voices = (data.voices || [])
      .filter(voice => voice.category === "premade" && !blockedIds.has(voice.voice_id))
      .map(voice => ({
        voice_id: voice.voice_id,
        name: voice.name,
        category: voice.category,
        preview_url: voice.preview_url
      }));

    return Response.json(
      { voices },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke layanan suara." }, { status: 502 });
  }
}
