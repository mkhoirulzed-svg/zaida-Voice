import { verifyFirebaseUser, getOrCreateAccount, calculateDeepSeekCharge, billUsage } from "../lib/firebase.js";

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
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
      body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "system", content: system }, { role: "user", content: text }], temperature: .7, max_tokens: 2500, stream: false })
    });
    const data = await upstream.json();
    if (!upstream.ok) return Response.json({ error: data.error?.message || "DeepSeek gagal memproses naskah." }, { status: upstream.status });
    const output = data.choices?.[0]?.message?.content?.trim();
    if (!output) return Response.json({ error: "DeepSeek tidak mengembalikan naskah." }, { status: 502 });
    const account = await getOrCreateAccount(auth.user, env);
    const billing = calculateDeepSeekCharge(data.usage || {}, env);
    if (account.credits < billing.credits) return Response.json({error:"Kredit tidak mencukupi untuk menyempurnakan naskah. Saldo kamu "+account.credits+" kredit; kebutuhan proses ini "+billing.credits+" kredit."},{status:402});
    const charged = await billUsage(auth.user, env, billing.credits, "ai-script-edit:deepseek-flash:"+billing.inputTokens+" input/"+billing.outputTokens+" output tokens");
    return Response.json({ text: output, creditsCharged: charged.charged, creditsRemaining: charged.remaining, usage: {inputTokens:billing.inputTokens,outputTokens:billing.outputTokens} });
  } catch {
    return Response.json({ error: "Tidak dapat terhubung ke DeepSeek." }, { status: 502 });
  }
}