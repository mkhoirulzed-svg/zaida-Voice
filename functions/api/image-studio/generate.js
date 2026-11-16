import {
  verifyFirebaseUser, getOrCreateAccount, reserveCredits, ensureStorageCapacity, getStorageUsage,
  releaseCredits, settleReservedCredits, calculateKiosapiCharge
} from "../../lib/firebase.js";

const KIOSAPI_GENERATE_MODEL = "openai/gpt-image-2.5-flare";
const KIOSAPI_EDIT_MODEL = "google/nano-banana-2";
const OPENROUTER_MODEL = "bytedance-seed/seedream-5-0-flash";
const jsonError = (message, status = 502) => Response.json({ error: message }, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});
async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 400) || response.statusText } }; }
}
const TEMPLATE_IDS = {
  product: ["clean","premium","lifestyle","advert","medical","marketplace"],
  poster: ["feed","story","banner","thumbnail","promo"],
  education: ["medical","nursing","infographic","patient"],
  portrait: ["professional","profile","editorial","outdoor"],
  character: ["mascot","3d","sticker","avatar"],
  brand: ["logo","icon","identity"],
  free: ["prompt","reference"]
};
const REQUIRES_REFERENCE = {
  product: ["clean","premium","lifestyle","advert","medical","marketplace"],
  portrait: ["professional","profile","editorial","outdoor"],
  free: ["reference"]
};
const STUDIO_LABELS = {
  product: "professional product photography",
  poster: "professional promotional graphic design",
  education: "clear educational illustration",
  portrait: "professional portrait photography",
  character: "distinctive brand character illustration",
  brand: "professional brand identity design",
  free: "high-quality creative image"
};
function decodeImageData(value) {
  const match = typeof value === "string" && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return { mime: match[1].toLowerCase(), bytes };
}
function buildPrompt(body, studio, templateId) {
  const fields = body.fields && typeof body.fields === "object" && !Array.isArray(body.fields) ? body.fields : {};
  const lines = Object.entries(fields).slice(0, 12)
    .map(([label, value]) => String(label).slice(0, 80) + ": " + String(value ?? "").trim().slice(0, 600))
    .filter(line => !line.endsWith(": "));
  const userPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1800) : "";
  const template = String(body.templateLabel || templateId).slice(0, 100);
  const ratio = ["1:1","4:5","9:16","16:9"].includes(body.aspectRatio) ? body.aspectRatio : "1:1";
  const formatGuide = studio === "poster"
    ? "Create a finished, polished graphic layout. Include the exact headline and supporting copy supplied by the user, with correct spelling and legible typography. Do not invent extra claims, prices, contact details or logos."
    : studio === "brand"
      ? "Create a clean, professional identity asset. Avoid mockup presentation unless requested. Keep the design uncluttered and usable."
      : studio === "product"
        ? "Keep the product faithful to the reference image when supplied: preserve its shape, proportions, colors, controls, packaging and brand markings. Do not invent product features."
        : "Create a coherent, polished composition with clear subject hierarchy and professional visual quality.";
  return [
    "Create one original image for ZAIDA Image Studio.",
    "Studio category: " + STUDIO_LABELS[studio] + ".",
    "Selected template: " + template + ".",
    "Canvas aspect ratio: " + ratio + ".",
    formatGuide,
    lines.length ? "TEMPLATE CONTENT (follow accurately):\n" + lines.join("\n") : "",
    userPrompt ? "ADDITIONAL USER DIRECTION (highest priority): " + userPrompt : "",
    "Use the supplied reference image as a visual reference when present. Do not add watermarks. Return a single finished image."
  ].filter(Boolean).join("\n\n");
}
export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  if (!useOpenRouter && !env.KIOSAPI_API_KEY) return jsonError("OPENROUTER_API_KEY atau KIOSAPI_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  if (!env.VIDEO_MEDIA) return jsonError("R2 VIDEO_MEDIA belum terhubung. Tidak ada kredit yang dipotong.", 503);
  let body;
  try { body = await request.json(); } catch { return jsonError("Format permintaan tidak valid.", 400); }
  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  const studio = String(body.studio || "");
  const templateId = String(body.templateId || "");
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (!TEMPLATE_IDS[studio]?.includes(templateId)) return jsonError("Template generate tidak dikenal untuk kategori ini.", 400);
  const reference = body.referenceImage ? decodeImageData(body.referenceImage) : null;
  if (body.referenceImage && !reference) return jsonError("Foto referensi harus berupa PNG, JPEG, atau WebP.", 400);
  if (reference && (reference.bytes.byteLength > 2 * 1024 * 1024 || body.referenceImage.length > 2_900_000)) return jsonError("Ukuran foto referensi setelah kompresi maksimal 2 MB.", 413);
  if (REQUIRES_REFERENCE[studio]?.includes(templateId) && !reference) return jsonError("Template ini memerlukan foto referensi. Silakan unggah gambar terlebih dahulu.", 400);
  const prompt = buildPrompt(body, studio, templateId);
  if (prompt.length < 20) return jsonError("Isi template atau instruksi gambar belum cukup.", 400);
  const aspectRatio = ["1:1","4:5","9:16","16:9"].includes(body.aspectRatio) ? body.aspectRatio : "1:1";
  const model = useOpenRouter
    ? (env.ZAIDA_IMAGE_STUDIO_OPENROUTER_MODEL || OPENROUTER_MODEL)
    : (reference ? (env.ZAIDA_IMAGE_STUDIO_KIOSAPI_EDIT_MODEL || KIOSAPI_EDIT_MODEL) : (env.ZAIDA_IMAGE_STUDIO_KIOSAPI_GENERATE_MODEL || KIOSAPI_GENERATE_MODEL));
  const providerPriceIdr = Math.max(1, Number(reference ? env.ZAIDA_IMAGE_STUDIO_EDIT_PRICE_IDR : env.ZAIDA_IMAGE_STUDIO_GENERATE_PRICE_IDR) || (reference ? 2500 : 500));
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  const reserveCeilingIdr = Math.max(providerPriceIdr, Number(reference ? env.ZAIDA_IMAGE_STUDIO_EDIT_MAX_COST_IDR : env.ZAIDA_IMAGE_STUDIO_GENERATE_MAX_COST_IDR) || (reference ? 5000 : 2500));
  const reserveAmount = Math.ceil(reserveCeilingIdr * markup) + 1;
  let reservation = null, settled = false, providerResponded = false;
  try {
    const storage = await getStorageUsage(auth.user, env);
    if (storage.remainingBytes < 10 * 1024 * 1024) return jsonError("Penyimpanan hampir penuh. Sisakan minimal 10 MB sebelum membuat gambar.", 413);
  } catch (error) { return jsonError(error.message || "Tidak dapat memeriksa kuota penyimpanan.", 503); }
  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(auth.user, env, reserveAmount, "image-studio-generate:" + (useOpenRouter ? "openrouter:" : "kiosapi:") + model, {
      requestId, provider: useOpenRouter ? "openrouter" : "kiosapi", model
    });
    const imageRequest = useOpenRouter
      ? { model, prompt, aspect_ratio: aspectRatio, n: 1, ...(reference ? { input_references: [{ type: "image_url", image_url: { url: body.referenceImage } }] } : {}) }
      : (reference
        ? { model, prompt, aspect_ratio: aspectRatio, images: [body.referenceImage], n: 1 }
        : { model, prompt, aspect_ratio: aspectRatio, option: "1024x1024:medium", n: 1 });
    let providerUsed = useOpenRouter ? "openrouter" : "kiosapi";
    let modelUsed = model;
    const callProvider = async (provider, modelName, payload) => {
      const isOpen = provider === "openrouter";
      return fetch(isOpen ? "https://openrouter.ai/api/v1/images" : "https://api.kiosapi.id/v1/images/" + (reference ? "edits" : "generations"), {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + (isOpen ? env.OPENROUTER_API_KEY : env.KIOSAPI_API_KEY),
          "Content-Type": "application/json",
          ...(isOpen ? { "HTTP-Referer": "https://voice.zaidalabs.com", "X-Title": "ZAIDA Image Studio" } : {})
        },
        body: JSON.stringify(payload)
      });
    };
    let upstream = await callProvider(providerUsed, modelUsed, imageRequest);
    let data = await readJson(upstream);
    if (!upstream.ok && useOpenRouter && env.KIOSAPI_API_KEY) {
      providerUsed = "kiosapi";
      modelUsed = reference
        ? (env.ZAIDA_IMAGE_STUDIO_KIOSAPI_EDIT_MODEL || KIOSAPI_EDIT_MODEL)
        : (env.ZAIDA_IMAGE_STUDIO_KIOSAPI_GENERATE_MODEL || KIOSAPI_GENERATE_MODEL);
      const fallbackPayload = reference
        ? { model: modelUsed, prompt, aspect_ratio: aspectRatio, images: [body.referenceImage], n: 1 }
        : { model: modelUsed, prompt, aspect_ratio: aspectRatio, option: "1024x1024:medium", n: 1 };
      upstream = await callProvider(providerUsed, modelUsed, fallbackPayload);
      data = await readJson(upstream);
    }
    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, providerUsed + "-image-generate-http-" + upstream.status);
      settled = true;
      return jsonError(data.error?.message || data.message || "Provider gagal membuat desain.", upstream.status);
    }
    providerResponded = true;
    const image = data.data?.[0];
    const openRouterCostUsd = Number(data.usage?.cost);
    const kiosapiCostIdr = Number(data.kiosapi?.cost_rupiah ?? upstream.headers.get("X-Kiosapi-Cost-IDR"));
    const hasOpenRouterCost = providerUsed === "openrouter" && Number.isFinite(openRouterCostUsd) && openRouterCostUsd > 0;
    const hasKiosapiCost = providerUsed === "kiosapi" && Number.isFinite(kiosapiCostIdr) && kiosapiCostIdr > 0;
    const providerCostIdr = hasOpenRouterCost
      ? Math.ceil(openRouterCostUsd * Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || 18000))
      : hasKiosapiCost ? Math.ceil(kiosapiCostIdr) : providerPriceIdr;
    const providerCostUsd = hasOpenRouterCost ? openRouterCostUsd : 0;
    const billing = calculateKiosapiCharge({ cost_idr: providerCostIdr }, env);
    if (!image?.b64_json || typeof image.b64_json !== "string") {
      await settleReservedCredits(auth.user, env, reservation.reservationId, billing.credits,
        "image-studio-generate:" + providerUsed + ":" + modelUsed, {
          provider: providerUsed, model: modelUsed, providerCostIdr, providerCostUsd,
          providerCostEstimated: !(hasOpenRouterCost || hasKiosapiCost), requestId,
          imageMode: reference ? "template-reference-edit" : "template-text-to-image", studio, templateId
        });
      settled = true;
      return jsonError("Provider merespons tetapi tidak mengembalikan data gambar yang dapat disimpan. Biaya provider sudah tercatat.", 502);
    }
    const mime = String(image.media_type || image.mime || "image/png").toLowerCase();
    if (!["image/png","image/jpeg","image/webp"].includes(mime)) return jsonError("Format gambar hasil tidak didukung.", 502);
    const binary = Uint8Array.from(atob(image.b64_json), ch => ch.charCodeAt(0));
    if (!binary.byteLength || binary.byteLength > 15 * 1024 * 1024) return jsonError("Ukuran hasil gambar tidak valid.", 502);
    const storageKey = auth.user.uid + "/" + requestId;
    await ensureStorageCapacity(auth.user, env, binary.byteLength, storageKey);
    await env.VIDEO_MEDIA.put(storageKey, binary, {
      httpMetadata: { contentType: mime, cacheControl: "private, no-store" },
      customMetadata: { uid: auth.user.uid, project: "zaida-image-studio", kind: "image", source: "image-studio-template", studio, templateId, fileName: "ZAIDA-" + studio + "-" + requestId.slice(0,8) }
    });
    const charge = await settleReservedCredits(auth.user, env, reservation.reservationId, billing.credits,
      "image-studio-generate:" + providerUsed + ":" + modelUsed, {
        provider: providerUsed, model: modelUsed, providerCostIdr, providerCostUsd,
        providerCostEstimated: !(hasOpenRouterCost || hasKiosapiCost), requestId,
        imageMode: reference ? "template-reference-edit" : "template-text-to-image", studio, templateId
      });
    settled = true;
    return Response.json({
      ok: true, image: { b64: image.b64_json, mime, assetId: requestId },
      model: modelUsed, provider: providerUsed, providerCostIdr,
      creditsCharged: charge.charged, creditsRemaining: charge.remaining
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (reservation && !settled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "image-studio-generate-error"); } catch {}
    }
    return jsonError(error?.message || "Tidak dapat membuat desain.", error?.status || 502);
  }
}
