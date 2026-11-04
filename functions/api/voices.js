export async function onRequestGet({ env }) {
  if (!env.ELEVENLABS_API_KEY) return Response.json({ error: "ELEVENLABS_API_KEY belum dikonfigurasi." }, { status: 503 });
  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "Accept": "application/json" }
    });
    const data = await upstream.json();
    if (!upstream.ok) return Response.json({ error: data.detail?.message || data.detail || "Gagal mengambil daftar suara ElevenLabs." }, { status: upstream.status });
    return Response.json({ voices: (data.voices || []).map(v => ({ voice_id: v.voice_id, name: v.name, category: v.category, preview_url: v.preview_url })) }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke layanan suara." }, { status: 502 });
  }
}