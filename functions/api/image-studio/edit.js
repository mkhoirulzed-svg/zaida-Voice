import {
  verifyFirebaseUser, getOrCreateAccount, reserveCredits, ensureStorageCapacity, getStorageUsage,
  releaseCredits, settleReservedCredits, calculateKiosapiCharge
} from "../../lib/firebase.js";

const EDIT_MODEL = "google/nano-banana-2";
const OPENROUTER_EDIT_MODEL = "bytedance-seed/seedream-5-0-flash";
const jsonError = (message, status = 502) => Response.json({ error: message }, {
  status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 400) || response.statusText } }; }
}

const TEMPLATE_INSTRUCTIONS = {
  restore: "Restore and repair this old photograph. Remove scratches, dust, fading and damage while preserving the original person's identity, facial features, age, expression, clothing and composition.",
  enhance: "Improve this photograph's clarity, sharpness, lighting, color balance and fine details. Preserve the subject's exact identity, face, proportions and all meaningful details. Avoid artificial skin or over-processing.",
  background: "Replace only the background with a clean, professional studio background. Preserve the subject exactly, including face, hair, pose, clothing, body proportions and edges. Blend lighting and shadows naturally.",
  remove: "Remove the unwanted distracting object described by the user. Reconstruct the hidden background naturally. Keep all other parts of the photograph unchanged.",
  lighting: "Correct exposure, shadows, highlights and white balance for natural, professional photographic lighting. Preserve identity, facial details, colors and composition.",
  style: "Apply the requested photographic style while preserving the original person's identity, face, pose and key details. Do not add text, watermark or unrelated objects."
};

function decodeImageData(value) {
  const match = typeof value === "string" && value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return { mime: match[1].toLowerCase(), bytes, base64: match[2] };
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
  const templateId = String(body.templateId || "free").slice(0, 24);
  const reference = decodeImageData(body.referenceImage);
  const userPrompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1200) : "";
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (!reference) return jsonError("Unggah foto PNG, JPEG, atau WebP yang valid.", 400);
  if (reference.bytes.byteLength > 2 * 1024 * 1024) return jsonError("Ukuran foto setelah kompresi maksimal 2 MB.", 413);
  if (userPrompt.length > 1200) return jsonError("Instruksi terlalu panjang.", 400);
  if (!TEMPLATE_INSTRUCTIONS[templateId] && templateId !== "free") return jsonError("Template edit tidak dikenal.", 400);
  if (templateId === "free" && userPrompt.length < 8) return jsonError("Tulis instruksi edit terlebih dahulu.", 400);

  const baseInstruction = TEMPLATE_INSTRUCTIONS[templateId] || "Edit the supplied photograph according to the user's instructions. Preserve the original person's identity, face, body proportions and all details not explicitly requested to change.";
  const prompt = [
    baseInstruction,
    userPrompt ? "USER INSTRUCTIONS: " + userPrompt : "",
    "Important: treat the uploaded image as the source photograph. This is an image-edit task, not text-to-image. Preserve identity and all unrequested details. Do not add text, logos or watermarks. Return one edited image."
  ].filter(Boolean).join("\n\n");

  let storage;
  try {
    storage = await getStorageUsage(auth.user, env);
    if (storage.remainingBytes < 10 * 1024 * 1024) return jsonError("Penyimpanan hampir penuh. Sisakan minimal 10 MB sebelum membuat gambar.", 413);
  } catch (error) { return jsonError(error.message || "Tidak dapat memeriksa kuota penyimpanan.", 503); }

  const model = useOpenRouter ? (env.ZAIDA_IMAGE_STUDIO_EDIT_MODEL || OPENROUTER_EDIT_MODEL) : (env.ZAIDA_IMAGE_STUDIO_KIOSAPI_EDIT_MODEL || EDIT_MODEL);
  const providerPriceIdr = Math.max(1, Number(env.ZAIDA_IMAGE_STUDIO_EDIT_PRICE_IDR) || 2500);
  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  const reserveCeilingIdr = Math.max(providerPriceIdr, Number(env.ZAIDA_IMAGE_STUDIO_EDIT_MAX_COST_IDR) || 5000);\n  const reserveAmount = Math.ceil(reserveCeilingIdr * markup) + 1;
  let reservation = null, settled = false, providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(auth.user, env, reserveAmount, "image-studio-edit:" + (useOpenRouter ? "openrouter:" : "kiosapi:") + model, {
      requestId, provider: useOpenRouter ? "openrouter" : "kiosapi", model
    });

    const imageRequest = useOpenRouter
      ? { model, prompt, aspect_ratio: "1:1", resolution: "1K", n: 1, input_references: [{ type: "image_url", image_url: { url: body.referenceImage } }] }
      : { model, prompt, images: [body.referenceImage], n: 1 };

    let providerUsed = useOpenRouter ? "openrouter" : "kiosapi";\n    let modelUsed = model;
    let upstream = await fetch(useOpenRouter ? "https://openrouter.ai/api/v1/images" : "https://api.kiosapi.id/v1/images/edits", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + (useOpenRouter ? env.OPENROUTER_API_KEY : env.KIOSAPI_API_KEY),
        "Content-Type": "application/json",
        ...(useOpenRouter ? { "HTTP-Referer": "https://voice.zaidalabs.com", "X-Title": "ZAIDA Image Studio" } : {})
      },
      body: JSON.stringify(imageRequest)
    });
    let data = await readJson(upstream);

    if (!upstream.ok && useOpenRouter && env.KIOSAPI_API_KEY) {
      providerUsed = "kiosapi";
      upstream = await fetch("https://api.kiosapi.id/v1/images/edits", {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.KIOSAPI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelUsed, prompt, images: [reference.base64], n: 1 })
      });
      data = await readJson(upstream);
    }

    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, providerUsed + "-image-edit-http-" + upstream.status);
      settled = true;
      return jsonError(data.error?.message || data.message || "Provider gagal mengedit foto.", upstream.status);
    }

    providerResponded = true;
    const image = data.data?.[0];
    const openRouterCostUsd = Number(data.usage?.cost);
    const kiosapiCostIdr = Number(data.kiosapi?.cost_rupiah ?? upstream.headers.get("X-Kiosapi-Cost-IDR"));
    const hasOpenRouterActualCost = providerUsed === "openrouter" && Number.isFinite(openRouterCostUsd) && openRouterCostUsd > 0;
    const hasKiosapiActualCost = providerUsed === "kiosapi" && Number.isFinite(kiosapiCostIdr) && kiosapiCostIdr > 0;
    const providerCostIdr = hasOpenRouterActualCost
      ? Math.ceil(openRouterCostUsd * Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || 18000))
      : hasKiosapiActualCost ? Math.ceil(kiosapiCostIdr) : providerPriceIdr;
    const providerCostUsd = hasOpenRouterActualCost ? openRouterCostUsd : 0;
    const billing = calculateKiosapiCharge({ cost_idr: providerCostIdr }, env);
    const charge = await settleReservedCredits(auth.user, env, reservation.reservationId, billing.credits,
      "image-studio-edit:" + providerUsed + ":" + modelUsed, {
        provider: providerUsed, model: modelUsed, providerCostIdr, providerCostUsd,
        providerCostEstimated: !(hasOpenRouterActualCost || hasKiosapiActualCost),
        requestId, imageMode: "image-edit"
      });
    settled = true;

    if (!image?.b64_json || typeof image.b64_json !== "string") {
      return jsonError("Provider merespons tetapi tidak mengembalikan data gambar yang dapat disimpan. Biaya provider sudah tercatat.", 502);
    }

    const mime = String(image.media_type || image.mime || "image/png").toLowerCase();
    if (!["image/png", "image/jpeg", "image/webp"].includes(mime)) return jsonError("Provider mengembalikan format gambar yang tidak didukung.", 502);
    const binary = Uint8Array.from(atob(image.b64_json), ch => ch.charCodeAt(0));
    if (!binary.byteLength || binary.byteLength > 15 * 1024 * 1024) return jsonError("Ukuran hasil gambar tidak valid.", 502);
    const assetId = requestId;
    const storageKey = auth.user.uid + "/" + assetId;
    await ensureStorageCapacity(auth.user, env, binary.byteLength, storageKey);
    await env.VIDEO_MEDIA.put(storageKey, binary, {
      httpMetadata: { contentType: mime, cacheControl: "private, no-store" },
      customMetadata: { uid: auth.user.uid, project: "zaida-image-studio", kind: "image", source: "image-studio-edit", fileName: "ZAIDA-Edit-" + assetId.slice(0, 8) }
    });

    return Response.json({
      ok: true,
      image: { b64: image.b64_json, mime, assetId },
      model: modelUsed, provider: providerUsed, providerCostIdr,
      creditsCharged: charge.charged, creditsRemaining: charge.remaining
    }, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (reservation && !settled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "image-studio-edit-error"); } catch {}
    }
    return jsonError(error?.message || "Tidak dapat mengedit foto.", error?.status || 502);
  }
}
