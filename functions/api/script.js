async function verifyFirebaseUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return { error: Response.json({ error: "Silakan masuk untuk menggunakan fitur ini." }, { status: 401 }) };
  const apiKey = env.FIREBASE_WEB_API_KEY;
  if (!apiKey) return { error: Response.json({ error: "FIREBASE_WEB_API_KEY belum dikonfigurasi di Cloudflare." }, { status: 503 }) };
  try {
    const response = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + encodeURIComponent(apiKey), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] })
    });
    const data = await response.json();
    const user = data.users?.[0];
    if (!response.ok || !user || user.emailVerified !== true) {
      return { error: Response.json({ error: "Sesi tidak valid atau email belum diverifikasi. Silakan masuk kembali setelah verifikasi." }, { status: 401 }) };
    }
    return { user: { uid: user.localId, email: user.email } };
  } catch {
    return { error: Response.json({ error: "Gagal memverifikasi sesi pengguna." }, { status: 502 }) };
  }
}
export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);\n  if (auth.error) return auth.error;
  if (!env.DEEPSEEK_API_KEY) return Response.json({ error: "DEEPSEEK_API_KEY belum dikonfigurasi di Cloudflare." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 5000) return Response.json({ error: "Masukkan teks maksimal 5.000 karakter." }, { status: 400 });
  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const system = language === "English"
    ? "You are a professional editor for spoken-audio scripts in English. Improve flow, grammar, punctuation, and how naturally the text sounds when read aloud. Preserve the user's meaning, facts, names, and numbers. Do not add new claims. Use natural, conversational phrasing. Return only the revised script, with no introduction or explanation."
    : "Kamu adalah editor naskah profesional untuk narasi audio berbahasa Indonesia. Perbaiki alur, ejaan, tanda baca, dan keterdengaran saat dibacakan. Pertahankan maksud, fakta, nama, dan angka dari pengguna. Jangan menambahkan klaim baru. Gunakan kalimat natural, tidak kaku. Kembalikan hanya naskah hasil revisi tanpa pembuka atau penjelasan.";
  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.DEEPSEEK_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: system }, { role: "user", content: text }], temperature: .7, max_tokens: 2500, stream: false })
    });
    const data = await upstream.json();
    if (!upstream.ok) return Response.json({ error: data.error?.message || "DeepSeek gagal memproses naskah." }, { status: upstream.status });
    const output = data.choices?.[0]?.message?.content?.trim();
    if (!output) return Response.json({ error: "DeepSeek tidak mengembalikan naskah." }, { status: 502 });
    return Response.json({ text: output });
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke DeepSeek." }, { status: 502 });
  }
}