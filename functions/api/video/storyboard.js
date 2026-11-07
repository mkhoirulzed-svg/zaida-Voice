import {
  verifyFirebaseUser, getOrCreateAccount, estimateKiosapiReservation,
  estimateKiosapiCostIdr, calculateKiosapiCharge, reserveCredits,
  releaseCredits, settleReservedCredits
} from "../../lib/firebase.js";

const jsonError = (message, status = 502) => Response.json({ error: message }, { status });
async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 400) || response.statusText } }; }
}
function parseJsonOutput(raw) {
  const cleaned = String(raw || "").trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scenes)) throw new Error("Format storyboard dari AI tidak valid.");
  const scenes = parsed.scenes.slice(0, 8).map((scene, index) => ({
    scene_number: index + 1,
    title: String(scene.title || "Adegan " + (index + 1)).slice(0, 90),
    narration: String(scene.narration || "").slice(0, 1200),
    visual_description: String(scene.visual_description || "").slice(0, 500),
    visual_prompt: String(scene.visual_prompt || "").slice(0, 1200),
    on_screen_text: String(scene.on_screen_text || "").slice(0, 140),
    estimated_seconds: Math.max(2, Math.min(20, Number(scene.estimated_seconds) || 6)),
    transition: String(scene.transition || "cut").slice(0, 40)
  }));
  if (scenes.length < 2 || scenes.some(s => !s.narration || !s.visual_prompt)) throw new Error("Storyboard belum memiliki detail adegan yang cukup.");
  return {
    title: String(parsed.title || "Proyek video baru").slice(0, 120),
    hook: String(parsed.hook || "").slice(0, 300),
    summary: String(parsed.summary || "").slice(0, 600),
    closing: String(parsed.closing || "").slice(0, 300),
    scenes
  };
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.KIOSAPI_API_KEY) return jsonError("KIOSAPI_API_KEY belum dikonfigurasi di Cloudflare.", 503);

  let body;
  try { body = await request.json(); } catch { return jsonError("Format permintaan tidak valid.", 400); }
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (topic.length < 8) return jsonError("Topik video minimal 8 karakter.", 400);

  const duration = [30, 45, 60, 90].includes(Number(body.duration)) ? Number(body.duration) : 45;
  const sceneCount = Math.max(3, Math.min(8, Number(body.sceneCount) || 5));
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "penonton umum";
  const tone = typeof body.tone === "string" ? body.tone.trim().slice(0, 100) : "edukatif dan menarik";
  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const visualStyle = "mixed2";
  const system = `Kamu adalah sutradara kreatif dan penulis storyboard video pendek. Buat storyboard yang bisa langsung dipakai dalam produksi video vertikal. Bahasa keluaran: ${language}.
Ketentuan:
- Format video 9:16 portrait, target kanvas 720x1280.
- Gaya visual wajib mixed2: perpaduan footage/fotografi realistis, ilustrasi, 3D, dan cinematic; pilih jenis visual yang paling mendukung isi tiap adegan dan variasikan secara wajar.
- Durasi total sekitar ${duration} detik dengan tepat ${sceneCount} adegan.
- Target audiens: ${audience}. Nuansa: ${tone}.
- Awali dengan hook kuat dalam 1-3 detik pertama; alur harus jelas, tidak repetitif, dan punya penutup.
- Narasi harus alami untuk dibacakan, faktual, tidak menambah klaim medis/ilmiah yang tidak didukung. Jika topik berisiko, gunakan bahasa hati-hati.
- visual_prompt harus berupa prompt visual mandiri dan rinci, tanpa teks tertulis di gambar, tanpa logo/watermark. Deskripsikan subjek, komposisi vertikal, pencahayaan, mood, dan jenis visual.
- on_screen_text singkat, maksimal 8 kata.
Kembalikan HANYA JSON valid dengan struktur:
{"title":"...","hook":"...","summary":"...","closing":"...","scenes":[{"title":"...","narration":"...","visual_description":"...","visual_prompt":"...","on_screen_text":"...","estimated_seconds":6,"transition":"cut"}]}
Jangan gunakan markdown fence atau penjelasan di luar JSON.`;
  const primaryModel = env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "openai/gpt-4o-mini";
  const fallbackModel = env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "deepseek/deepseek-v4-flash";
  const maxTokens = 2600;
  let reservation = null, settled = false, providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(
      auth.user, env,
      estimateKiosapiReservation(topic.length + system.length, maxTokens, env),
      "video-storyboard:kiosapi",
      { requestId, provider: "kiosapi", model: primaryModel }
    );
    const upstream = await fetch("https://api.kiosapi.id/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.KIOSAPI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        models: primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel],
        messages: [{ role: "system", content: system }, { role: "user", content: "Buat storyboard untuk topik berikut:\\n" + topic }],
        temperature: 0.75, max_tokens: maxTokens, stream: false
      })
    });
    const data = await readJson(upstream);
    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, "kiosapi-storyboard-http-" + upstream.status);
      settled = true;
      return jsonError(data.error?.message || data.message || "Kiosapi gagal membuat storyboard.", upstream.status);
    }

    providerResponded = true;
    const raw = data.choices?.[0]?.message?.content?.trim();
    const modelUsed = upstream.headers.get("X-Kiosapi-Model-Used") || data.model || primaryModel;
    const headerCost = upstream.headers.get("X-Kiosapi-Cost-IDR");
    const reportedCost = data.usage?.cost_idr ?? (headerCost !== null ? Number(headerCost) : null);
    const providerCostIdr = reportedCost !== null && Number.isFinite(Number(reportedCost))
      ? Math.max(0, Number(reportedCost))
      : estimateKiosapiCostIdr(data.usage || {}, modelUsed, env);
    const billing = calculateKiosapiCharge({ ...(data.usage || {}), cost_idr: providerCostIdr }, env);
    const charged = await settleReservedCredits(auth.user, env, reservation.reservationId, billing.credits,
      "video-storyboard:kiosapi:" + modelUsed, {
        provider: "kiosapi", model: modelUsed, providerCostIdr: Math.ceil(providerCostIdr),
        inputTokens: billing.inputTokens, outputTokens: billing.outputTokens, requestId
      });
    settled = true;

    let storyboard;
    try { storyboard = parseJsonOutput(raw); }
    catch (error) {
      return Response.json({ error: error.message + " Provider sudah merespons; biaya pemrosesan tercatat.", creditsCharged: charged.charged, creditsRemaining: charged.remaining }, { status: 502 });
    }
    return Response.json({
      ...storyboard, format: "9:16", resolution: "720x1280", visualStyle,
      provider: "kiosapi", model: modelUsed,
      creditsCharged: charged.charged, creditsRemaining: charged.remaining
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (reservation && !settled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "video-storyboard-error"); } catch {}
    }
    return jsonError(error?.message || "Tidak dapat membuat storyboard.", error?.status || 502);
  }
}
