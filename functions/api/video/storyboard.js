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

// Memecah naskah pada batas kalimat/paragraf, sambil mempertahankan teks sumber.
function extractSentenceUnits(script) {
  const units = [];
  const pattern = /[^.!?。！？\n]+[.!?。！？]?|\n+/gu;
  for (const match of script.matchAll(pattern)) {
    if (match[0].trim()) units.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
  }
  if (!units.length) units.push({ start: 0, end: script.length, text: script });
  return units;
}
function fallbackGroups(units, requestedCount, duration) {
  const target = requestedCount || Math.max(3, Math.min(30, Math.ceil(duration / 10)));
  const count = Math.max(1, Math.min(units.length, target));
  const groups = [];
  let cursor = 0;
  const totalWords = units.reduce((sum, unit) => sum + (unit.text.trim().split(/\s+/u).filter(Boolean).length || 0), 0) || 1;
  let accumulated = 0;
  for (let i = 0; i < count; i++) {
    const remainingGroups = count - i;
    const remainingUnits = units.length - cursor;
    const targetWords = (totalWords - accumulated) / remainingGroups;
    let end = cursor;
    let words = 0;
    while (end < units.length && (end === cursor || words < targetWords)) {
      words += units[end].text.trim().split(/\s+/u).filter(Boolean).length;
      end++;
    }
    if (remainingUnits <= remainingGroups) end = cursor + 1;
    groups.push({ start: cursor, end });
    accumulated += words;
    cursor = end;
  }
  if (cursor < units.length) groups[groups.length - 1].end = units.length;
  return groups;
}
function normalizeGroups(rawScenes, units, requestedCount, duration) {
  const candidates = Array.isArray(rawScenes) ? rawScenes : [];
  const groups = [];
  let next = 0;
  for (const scene of candidates) {
    const start = Number(scene.sentence_start) - 1;
    const end = Number(scene.sentence_end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start !== next || end <= start || end > units.length) continue;
    groups.push({ start, end, metadata: scene });
    next = end;
  }
  if (next !== units.length || !groups.length || (requestedCount && groups.length !== Math.min(requestedCount, units.length))) {
    return fallbackGroups(units, requestedCount, duration).map(group => ({ ...group, metadata: {} }));
  }
  return groups;
}
function fallbackVisual(narration, index) {
  const excerpt = narration.trim().replace(/\s+/gu, " ").slice(0, 180);
  return {
    title: "Adegan " + (index + 1),
    visual_description: "Visual pendukung untuk inti narasi: " + excerpt,
    visual_prompt: "Create a cinematic visual illustrating: " + excerpt + ". Clear central subject, composition safe for vertical 9:16 and horizontal 16:9 crop, natural lighting, detailed environment, no text, no logo, no watermark.",
    on_screen_text: "",
    transition: "cut"
  };
}
function parseStoryboard(raw, script, units, duration, requestedCount) {
  let parsed = {};
  try {
    const cleaned = String(raw || "").trim().replace(/^\x60{3}(?:json)?\s*/i, "").replace(/\s*\x60{3}$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {}
  const groups = normalizeGroups(parsed.scenes, units, requestedCount, duration);
  const totalWords = script.trim().split(/\s+/u).filter(Boolean).length || 1;
  const scenes = groups.map((group, index) => {
    const narration = script.slice(units[group.start].start, units[group.end - 1].end);
    const ai = group.metadata || {};
    const fallback = fallbackVisual(narration, index);
    const words = narration.trim().split(/\s+/u).filter(Boolean).length;
    return {
      scene_number: index + 1,
      title: String(ai.title || fallback.title).slice(0, 90),
      narration,
      visual_description: String(ai.visual_description || fallback.visual_description).slice(0, 500),
      visual_prompt: String(ai.visual_prompt || fallback.visual_prompt).slice(0, 1800),
      on_screen_text: String(ai.on_screen_text || "").slice(0, 140),
      estimated_seconds: Math.max(1, Math.round(duration * words / totalWords)),
      transition: String(ai.transition || "cut").slice(0, 40)
    };
  });
  return {
    title: String(parsed.title || "Proyek video baru").slice(0, 120),
    hook: String(parsed.hook || "").slice(0, 300),
    summary: "Storyboard disusun berdasarkan makna kalimat. Narasi diambil langsung dari naskah asli dan dipertahankan tanpa perubahan.",
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

  const units = extractSentenceUnits(script);
  const words = script.trim().split(/\s+/u).filter(Boolean).length;
  const duration = Number.isFinite(Number(body.duration)) && Number(body.duration) > 0
    ? Math.max(15, Math.min(900, Number(body.duration)))
    : Math.max(15, Math.round(words / 2.2));
  const requestedCount = body.sceneCount === null || body.sceneCount === undefined || body.sceneCount === "" || body.sceneCount === "auto"
    ? null
    : Math.max(1, Math.min(30, Math.round(Number(body.sceneCount) || 0)));
  const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 160) : "penonton umum";
  const tone = typeof body.tone === "string" ? body.tone.trim().slice(0, 100) : "edukatif dan menarik";
  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const countInstruction = requestedCount
    ? "Buat tepat " + Math.min(requestedCount, units.length) + " adegan dengan mengelompokkan kalimat yang berurutan."
    : "Tentukan sendiri jumlah adegan yang paling alami (3 sampai 30, atau sebanyak unit kalimat jika naskah sangat pendek). Jangan memakai interval detik tetap. Ganti adegan ketika fokus, aksi, lokasi, atau gagasan visual berubah; kalimat singkat boleh tetap menjadi adegan singkat dan beberapa kalimat yang satu gagasan boleh digabung.";
  const system = `Kamu adalah sutradara visual dan editor storyboard profesional.
Tugasmu mengelompokkan kalimat naskah menjadi adegan yang bermakna, lalu memberi arahan visual untuk tiap adegan.
JANGAN menulis ulang, meringkas, mengoreksi, atau mengubah narasi. Server akan mengambil teks asli berdasarkan indeks kalimat.
${countInstruction}
Durasi audio total sekitar ${duration} detik. Audiens: ${audience}. Nuansa: ${tone}. Bahasa metadata: ${language}.
Kelompokkan hanya kalimat yang berurutan dan jangan melewatkan, mengulang, atau mengubah urutannya. Setiap adegan harus punya sentence_start dan sentence_end (inklusif), menggunakan nomor kalimat dari input.
Atur pergantian adegan berdasarkan makna dan perubahan visual, bukan target 5 detik. Berikan arahan visual yang benar-benar menggambarkan kalimat dalam rentang tersebut.
Gaya visual Mixed2: pilih footage/fotografi realistis, ilustrasi, 3D, atau cinematic sesuai isi segmen.
Setiap visual_prompt harus mandiri, rinci, aman untuk crop 9:16 dan 16:9 dengan subjek di tengah, tanpa tulisan, logo, atau watermark. on_screen_text maksimal 8 kata.
Kembalikan HANYA JSON valid:
{"title":"...","hook":"...","closing":"...","scenes":[{"scene_number":1,"sentence_start":1,"sentence_end":2,"title":"...","visual_description":"...","visual_prompt":"...","on_screen_text":"","transition":"cut"}]}`;
  const userContent = "Susun storyboard dari daftar kalimat berikut. Pertahankan urutan dan cakupan seluruh kalimat:\n" +
    JSON.stringify(units.map((unit, index) => ({ sentence_number: index + 1, text: unit.text })));
  // Default: Gemini Flash Lite (free tier); fallback: GPT-4o mini (low-cost).
  // Migrate legacy Cloudflare vars so retired/outage-prone models are not retried.
  const configuredPrimary = String(env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "").trim();
  const configuredFallback = String(env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "").trim();
  const resolveConfiguredModel = (configured, replacement) => {
    if (!configured) return "";
    // Avoid legacy/retiring OpenAI and currently unreliable DeepSeek model overrides.
    if (configured.startsWith("openai/gpt-4o") || configured === "openai/o4-mini" || configured.startsWith("deepseek/")) return replacement;
    return configured;
  };
  const primaryModel = resolveConfiguredModel(configuredPrimary, "google/gemini-3.1-flash-lite") || "google/gemini-3.1-flash-lite";
  const fallbackModel = resolveConfiguredModel(configuredFallback, "google/gemini-3.5-flash") || "google/gemini-3.5-flash";
  const maxTokens = Math.min(12000, Math.max(6500, units.length * 260));
  let reservation = null, settled = false, providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(
      auth.user, env,
      estimateKiosapiReservation(script.length + system.length + userContent.length, maxTokens, env),
      "video-storyboard:kiosapi",
      { requestId, provider: "kiosapi", model: primaryModel }
    );
    // Coba model utama dan fallback secara berurutan agar kegagalan satu provider/model tidak menggagalkan seluruh storyboard.
    const modelCandidates = [...new Set([primaryModel, fallbackModel])];
    let upstream = null;
    let data = null;
    let lastProviderError = null;
    for (const modelCandidate of modelCandidates) {
      try {
        const candidateResponse = await fetch("https://api.kiosapi.id/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": "Bearer " + env.KIOSAPI_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({
            models: [modelCandidate],
            messages: [{ role: "system", content: system }, { role: "user", content: userContent }],
            temperature: 0.35, max_tokens: maxTokens, stream: false
          })
        });
        const candidateData = await readJson(candidateResponse);
        if (candidateResponse.ok && candidateData.choices?.[0]?.message?.content) {
          upstream = candidateResponse;
          data = candidateData;
          break;
        }
        lastProviderError = {
          status: candidateResponse.status || 502,
          message: candidateData.error?.message || candidateData.message || "Model " + modelCandidate + " tidak merespons."
        };
      } catch (providerError) {
        lastProviderError = { status: 502, message: providerError?.message || "Koneksi ke model gagal." };
      }
    }
    if (!upstream || !data) {
      await releaseCredits(auth.user, env, reservation.reservationId, "kiosapi-storyboard-models-unavailable");
      settled = true;
      return jsonError(
        "Layanan AI storyboard sedang tidak tersedia. Model utama dan cadangan gagal dihubungi. Coba lagi beberapa saat.",
        lastProviderError?.status || 502
      );
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

    const storyboard = parseStoryboard(raw, script, units, duration, requestedCount);
    return Response.json({
      ...storyboard, durationSeconds: duration, requestedSceneCount: storyboard.scenes.length,
      segmentation: "semantic", format: "9:16+16:9", resolution: "720p", outputFormats: ["9:16", "16:9"], outputResolutions: ["720x1280", "1280x720"], visualStyle: "mixed2",
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
