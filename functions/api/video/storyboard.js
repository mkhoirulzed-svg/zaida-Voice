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

// Potongan narration selalu diambil dari substring naskah sumber.
function splitScriptExactly(script, requestedCount) {
  const words = [...script.matchAll(/\\S+/gu)];
  const count = Math.max(1, Math.min(requestedCount, words.length));
  const boundaries = [0];
  for (let i = 1; i < count; i++) {
    const wordIndex = Math.ceil(words.length * i / count);
    boundaries.push(words[wordIndex].index);
  }
  boundaries.push(script.length);
  return Array.from({ length: count }, (_, i) => script.slice(boundaries[i], boundaries[i + 1]));
}
function fallbackVisual(narration, index) {
  const excerpt = narration.trim().replace(/\\s+/gu, " ").slice(0, 180);
  return {
    title: "Adegan " + (index + 1),
    visual_description: "Visual pendukung untuk inti narasi: " + excerpt,
    visual_prompt: "Create a cinematic, realistic editorial visual illustrating: " + excerpt + ". Clear central subject, composition safe for vertical 9:16 and horizontal 16:9 crop, natural lighting, detailed environment, no text, no logo, no watermark.",
    on_screen_text: "",
    transition: "cut"
  };
}
function parseStoryboard(raw, segments, duration) {
  let parsed = {};
  try {
    const cleaned = String(raw || "").trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {}
  const byNumber = new Map();
  for (const scene of Array.isArray(parsed.scenes) ? parsed.scenes : []) {
    const n = Number(scene.scene_number);
    if (Number.isInteger(n) && n >= 1 && n <= segments.length && !byNumber.has(n)) byNumber.set(n, scene);
  }
  const totalWords = segments.reduce((sum, part) => sum + (part.match(/\\S+/gu) || []).length, 0) || 1;
  const scenes = segments.map((narration, index) => {
    const ai = byNumber.get(index + 1) || {};
    const fallback = fallbackVisual(narration, index);
    const words = (narration.match(/\\S+/gu) || []).length;
    return {
      scene_number: index + 1,
      title: String(ai.title || fallback.title).slice(0, 90),
      narration,
      visual_description: String(ai.visual_description || fallback.visual_description).slice(0, 500),
      visual_prompt: String(ai.visual_prompt || fallback.visual_prompt).slice(0, 1800),
      on_screen_text: String(ai.on_screen_text || "").slice(0, 140),
      estimated_seconds: Math.max(2, Math.round(duration * words / totalWords)),
      transition: String(ai.transition || "cut").slice(0, 40)
    };
  });
  return {
    title: String(parsed.title || "Proyek video baru").slice(0, 120),
    hook: String(parsed.hook || "").slice(0, 300),
    summary: "Storyboard visual dibuat dari naskah sumber. Narasi dipertahankan persis tanpa diringkas atau ditulis ulang.",
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
  const script = typeof body.script === "string" ? body.script : (typeof body.topic === "string" ? body.topic : "");
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (script.trim().length < 20) return jsonError("Naskah video minimal 20 karakter.", 400);
  if (script.length > 30000) return jsonError("Naskah maksimal 30.000 karakter.", 400);

  const words = script.trim().split(/\\s+/u).length;
  const duration = Number.isFinite(Number(body.duration)) && Number(body.duration) > 0
    ? Math.max(15, Math.min(900, Number(body.duration)))
    : Math.max(15, Math.round(words / 2.2));
  const requestedCount = Math.max(3, Math.min(30, Math.round(Number(body.sceneCount) || Math.ceil(duration / 8)));
  const segments = splitScriptExactly(script, requestedCount);
  const sceneCount = segments.length;
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "penonton umum";
  const tone = typeof body.tone === "string" ? body.tone.trim().slice(0, 100) : "edukatif dan menarik";
  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const system = `Kamu adalah sutradara visual profesional. Tugasmu HANYA merancang arahan visual untuk setiap segmen naskah.
Jangan menulis ulang, meringkas, mengoreksi, atau mengubah narasi. Narasi asli akan dipasang oleh server.
Bahasa metadata: ${language}. Buat tepat ${sceneCount} arahan visual bernomor 1 sampai ${sceneCount}; satu adegan untuk setiap segmen dengan nomor yang sama.
Durasi total sekitar ${duration} detik. Audiens: ${audience}. Nuansa: ${tone}.
Gaya Mixed2: variasikan footage/fotografi realistis, ilustrasi, 3D, dan cinematic sesuai isi segmen.
Setiap visual_prompt harus mandiri, rinci, aman untuk crop 9:16 dan 16:9 dengan subjek di tengah, tanpa tulisan, logo, atau watermark. on_screen_text maksimal 8 kata.
Kembalikan HANYA JSON valid:
{"title":"...","hook":"...","closing":"...","scenes":[{"scene_number":1,"title":"...","visual_description":"...","visual_prompt":"...","on_screen_text":"","transition":"cut"}]}
Jangan sertakan narration.`;
  const userContent = "Buat satu arahan visual untuk setiap segmen berikut. Jangan gabungkan atau hilangkan segmen:\\n" +
    JSON.stringify(segments.map((narration, index) => ({ scene_number: index + 1, narration })));
  const primaryModel = env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "openai/gpt-4o-mini";
  const fallbackModel = env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "deepseek/deepseek-v4-flash";
  const maxTokens = Math.min(12000, Math.max(6500, sceneCount * 350));
  let reservation = null, settled = false, providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(
      auth.user, env,
      estimateKiosapiReservation(script.length + system.length + userContent.length, maxTokens, env),
      "video-storyboard:kiosapi",
      { requestId, provider: "kiosapi", model: primaryModel }
    );
    const upstream = await fetch("https://api.kiosapi.id/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + env.KIOSAPI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        models: primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel],
        messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
        temperature: 0.45, max_tokens: maxTokens, stream: false
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

    const storyboard = parseStoryboard(raw, segments, duration);
    return Response.json({
      ...storyboard, durationSeconds: duration, requestedSceneCount: sceneCount,
      format: "9:16+16:9", resolution: "720p", outputFormats: ["9:16", "16:9"], outputResolutions: ["720x1280", "1280x720"], visualStyle: "mixed2",
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
