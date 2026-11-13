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

// Membagi teks berdasarkan jumlah kata. Setiap potongan adalah substring asli,
// sehingga penggabungan seluruh narration selalu sama persis dengan naskah sumber.
function splitScriptExactly(script, requestedCount) {
  const words = [...script.matchAll(/\\S+/gu)];
  const count = Math.max(1, Math.min(30, requestedCount));
  const boundaries = [0];
  for (let i = 1; i < count; i++) {
    const wordIndex = Math.min(words.length - 1, Math.ceil(words.length * i / count));
    boundaries.push(words[wordIndex].index);
  }
  boundaries.push(script.length);
  const chunks = [];
  for (let i = 0; i < count; i++) {
    const part = script.slice(boundaries[i], boundaries[i + 1]);
    if (part.trim()) chunks.push(part);
  }
  return chunks;
}
function fallbackVisual(segment, index) {
  const excerpt = segment.trim().replace(/\\s+/gu, " ").slice(0, 180);
  return {
    scene_number: index + 1,
    title: "Adegan " + (index + 1),
    visual_description: "Visual pendukung yang menggambarkan inti narasi: " + excerpt,
    visual_prompt: "Create a cinematic, realistic editorial visual illustrating this narration: " + excerpt + ". Clear central subject, strong composition safe for vertical 9:16 crop, natural lighting, detailed environment, no text, no logo, no watermark.",
    on_screen_text: "",
    transition: "cut"
  };
}
function parseStoryboard(raw, segments, duration) {
  const cleaned = String(raw || "").trim().replace(/^\x60{3}(?:json)?\\s*/i, "").replace(/\\s*\x60{3}$/i, "");
  const parsed = JSON.parse(cleaned);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.scenes)) throw new Error("Format storyboard dari AI tidak valid.");
  const byNumber = new Map();
  for (const scene of parsed.scenes) {
    const n = Number(scene.scene_number);
    if (Number.isInteger(n) && n >= 1 && n <= segments.length && !byNumber.has(n)) byNumber.set(n, scene);
  }
  const totalWords = segments.reduce((sum, part) => sum + (part.match(/\\S+/gu) || []).length, 0) || 1;
  const scenes = segments.map((narration, index) => {
    const ai = byNumber.get(index + 1) || {};
    const fallback = fallbackVisual(narration, index);
    const words = (narration.match(/\\S+/gu) || []).length;
    const seconds = Math.max(2, Math.round(duration * words / totalWords));
    return {
      scene_number: index + 1,
      title: String(ai.title || fallback.title).slice(0, 90),
      narration,
      visual_description: String(ai.visual_description || fallback.visual_description).slice(0, 500),
      visual_prompt: String(ai.visual_prompt || fallback.visual_prompt).slice(0, 1800),
      on_screen_text: String(ai.on_screen_text || "").slice(0, 140),
      estimated_seconds: seconds,
      transition: String(ai.transition || "cut").slice(0, 40)
    };
  });
  if (scenes.some(scene => !scene.narration.trim() || !scene.visual_prompt)) throw new Error("Sebagian adegan belum memiliki detail visual.");
  return {
    title: String(parsed.title || "Proyek video baru").slice(0, 120),
    hook: String(parsed.hook || "").slice(0, 300),
    summary: "Storyboard visual untuk naskah asli. Narasi setiap adegan dipertahankan tanpa parafrasa.",
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
  const script = typeof body.script === "string" ? body.script : "";
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (script.trim().length < 20) return jsonError("Naskah minimal 20 karakter.", 400);
  if (script.length > 30000) return jsonError("Naskah maksimal 30.000 karakter.", 400);

  const words = script.trim().split(/\\s+/u).length;
  const duration = body.duration === "auto" || !Number.isFinite(Number(body.duration))
    ? Math.max(15, Math.round(words / 2.2))
    : Math.max(15, Math.min(900, Number(body.duration)));
  const sceneCount = body.sceneCount === "auto" || !Number.isFinite(Number(body.sceneCount))
    ? Math.max(4, Math.min(30, Math.ceil(words / 32)))
    : Math.max(2, Math.min(30, Math.round(Number(body.sceneCount))));
  const segments = splitScriptExactly(script, sceneCount);
  const actualCount = segments.length;
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "penonton umum";
  const tone = typeof body.tone === "string" ? body.tone.trim().slice(0, 100) : "edukatif dan menarik";
  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const system = `Kamu adalah sutradara visual profesional. Tugasmu HANYA merancang visual untuk potongan naskah yang sudah disediakan. JANGAN menulis ulang, meringkas, memperbaiki, mengoreksi, atau mengubah narasi. Narasi asli akan dipasang oleh server secara persis.
Bahasa metadata: ${language}.
Buat tepat ${actualCount} item visual, satu untuk setiap segmen, dengan scene_number berurutan 1 sampai ${actualCount}. Jangan gabungkan, jangan hilangkan, jangan tambah adegan.
Durasi target keseluruhan: sekitar ${duration} detik. Audiens: ${audience}. Nuansa visual: ${tone}.
Format visual Mixed2: variasikan fotografi/footage realistis, ilustrasi, 3D, dan cinematic sesuai isi tiap segmen.
Setiap visual_prompt harus mandiri, rinci, aman untuk crop 9:16 dan 16:9 dengan subjek di tengah, tanpa tulisan, logo, atau watermark. on_screen_text maksimal 8 kata.
Kembalikan HANYA JSON valid:
{"title":"...","hook":"...","closing":"...","scenes":[{"scene_number":1,"title":"...","visual_description":"...","visual_prompt":"...","on_screen_text":"","transition":"cut"}]}
Jangan sertakan properti narration karena narasi akan ditambahkan server.`;
  const userContent = "Buat arahan visual untuk segmen naskah berikut. Setiap segmen harus mendapat satu adegan dengan nomor yang sama. Jangan mengubah teksnya:\\n" +
    JSON.stringify(segments.map((text, index) => ({ scene_number: index + 1, narration: text })));
  const primaryModel = env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "openai/gpt-4o-mini";
  const fallbackModel = env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "deepseek/deepseek-v4-flash";
  const maxTokens = Math.min(12000, Math.max(6500, actualCount * 350));
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
      return jsonError(data.error?.message || data.message || "Kiosapi gagal membuat arahan visual.", upstream.status);
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
    try { storyboard = parseStoryboard(raw, segments, duration); }
    catch (error) {
      return Response.json({ error: error.message + " Provider sudah merespons; biaya pemrosesan tercatat.", creditsCharged: charged.charged, creditsRemaining: charged.remaining }, { status: 502 });
    }
    return Response.json({
      ...storyboard, durationSeconds: duration, requestedSceneCount: actualCount,
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
