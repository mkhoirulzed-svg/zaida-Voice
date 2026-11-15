import {
  verifyFirebaseUser, getOrCreateAccount, reserveCredits, ensureStorageCapacity,
  releaseCredits, settleReservedCredits, calculateKiosapiCharge
} from "../../lib/firebase.js";

const GENERATION_MODEL = "openai/gpt-image-2.5-flare";
const GENERATION_OPTION = "1024x1536:medium";
const EDIT_MODEL = "google/nano-banana-2";
const EDIT_OPTION = "standard";
const GENERATION_PRICE_IDR = 500;
const EDIT_PRICE_IDR = 2500;
const OPENROUTER_IMAGE_MODEL = "bytedance-seed/seedream-5-0-flash";
const OPENROUTER_IMAGE_PRICE_IDR = 324;
const jsonError = (message, status = 502) => Response.json({ error: message }, { status });

async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 400) || response.statusText } }; }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  if (!useOpenRouter && !env.KIOSAPI_API_KEY) return jsonError("OPENROUTER_API_KEY atau KIOSAPI_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  if (!env.VIDEO_MEDIA) return jsonError("R2 VIDEO_MEDIA belum terhubung. Tidak ada kredit yang dipotong.", 503);

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Format permintaan tidak valid.", 400); }

  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1800) : "";
  const sceneNumber = Math.max(1, Math.min(30, Number(body.sceneNumber) || 1));
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter(value => typeof value === "string" && /^data:image\/(?:png|jpe?g|webp);base64,/i.test(value)).slice(0, 4)
    : [];
  if (Array.isArray(body.referenceImages) && referenceImages.length !== body.referenceImages.length) return jsonError("Gambar referensi harus berupa data URL PNG, JPEG, atau WebP.", 400);
  if (referenceImages.some(value => value.length > 3_300_000)) return jsonError("Ukuran gambar referensi terlalu besar. Coba gambar yang lebih kecil.", 413);
  const useEdits = referenceImages.length > 0;
  const model = useOpenRouter ? (useEdits ? (env.ZAIDA_OPENROUTER_IMAGE_EDIT_MODEL || OPENROUTER_IMAGE_MODEL) : (env.ZAIDA_OPENROUTER_IMAGE_MODEL || OPENROUTER_IMAGE_MODEL)) : (useEdits ? EDIT_MODEL : GENERATION_MODEL);
  const option = useEdits ? EDIT_OPTION : GENERATION_OPTION;
  const providerPriceIdr = useEdits ? EDIT_PRICE_IDR : GENERATION_PRICE_IDR;
  const aspectRatio = body.format === "16:9" ? "16:9" : "9:16";
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (prompt.length < 20) return jsonError("Prompt gambar terlalu singkat. Periksa arahan visual adegan.", 400);

  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  const maxFallbackPriceIdr = useEdits ? EDIT_PRICE_IDR : GENERATION_PRICE_IDR;
  const reserveAmount = Math.ceil((useOpenRouter ? Math.max(OPENROUTER_IMAGE_PRICE_IDR, maxFallbackPriceIdr) : providerPriceIdr) * markup) + 1;
  let reservation = null;
  let settled = false;
  let providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(auth.user, env, reserveAmount, "video-image:" + (useOpenRouter ? "openrouter:" : "kiosapi:") + model, {
      requestId, provider: useOpenRouter ? "openrouter" : "kiosapi", model
    });

    const visualSafetyRules = "\n\nVISUAL CASTING, MODESTY AND PROFESSIONAL MEDICAL EDUCATION RULES: When the user does not specify a gender and the scene does not medically or contextually require a particular gender, prefer an adult male person as the default subject. Use a male healthcare professional or male patient where appropriate. Do not change a clearly specified person, gender, or medically necessary subject in the user request. If a woman is explicitly requested or is necessary for the educational context, portray her respectfully wearing a neat hijab that fully covers her hair, neck and chest, with loose, modest, non-transparent clothing. Depict all people respectfully and modestly. Do not depict nudity, exposed breasts, cleavage, genitalia, underwear, sensual poses, or unnecessary exposed skin. For medical procedures, expose only the specific treatment site that must be visible for accurate education; keep all other body areas covered with a clean medical drape or clothing. Prefer professional medical illustrations or tasteful 3D educational visuals over photorealistic exposed bodies. Keep the image clinical, respectful, non-sexual, and suitable for a broad audience. These rules apply to every scene, including reference-image edits; do not reproduce revealing or immodest elements from references unless the user specifically requests a relevant, safe medical depiction.";
    const basePrompt = prompt + visualSafetyRules + (useEdits
      ? "\n\nUse the supplied reference images as visual identity references. Preserve the exact real-world product design, shape, colors, packaging and visible brand identity. Integrate the product naturally into the scene as an object being used or displayed in context, not as a pasted banner, floating card, collage panel or separate inset. Reproduce the supplied brand logo faithfully if visible; do not invent, redesign or misspell it. Keep the scene composition natural, coherent and suitable for a professional product advertisement."
      : "\n\nDo not add text, watermark, or unrelated logos.");
    const imageRequest = useOpenRouter
      ? {
          model,
          prompt: basePrompt + (aspectRatio === "9:16" ? "\n\nPortrait vertical composition for 9:16 video. Keep the main subject centered and safe for crop." : "\n\nLandscape composition for 16:9 video. Keep the main subject centered and safe for crop."),
          aspect_ratio: aspectRatio,
          resolution: "1K",
          n: 1,
          ...(useEdits ? { input_references: referenceImages.map(url => ({ type: "image_url", image_url: { url } })) } : {})
        }
      : (useEdits
        ? { model, prompt: basePrompt, images: referenceImages, aspect_ratio: aspectRatio }
        : { model, prompt: basePrompt + "\n\nPortrait vertical composition for 9:16 video. Keep the main subject and important details centered and safe for crop.", option, n: 1 });
    let providerUsed = useOpenRouter ? "openrouter" : "kiosapi";
    let modelUsed = model;
    let upstream = await fetch(useOpenRouter ? "https://openrouter.ai/api/v1/images" : "https://api.kiosapi.id/v1/images/" + (useEdits ? "edits" : "generations"), {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + (useOpenRouter ? env.OPENROUTER_API_KEY : env.KIOSAPI_API_KEY),
        "Content-Type": "application/json",
        ...(useOpenRouter ? { "HTTP-Referer": "https://voice.zaidalabs.com", "X-Title": "ZAIDA Voice" } : {})
      },
      body: JSON.stringify(imageRequest)
    });

    let data = await readJson(upstream);
    if (!upstream.ok && useOpenRouter && env.KIOSAPI_API_KEY) {
      // OpenRouter fallback: use the existing KiosAPI image generation/edit route.
      providerUsed = "kiosapi";
      modelUsed = useEdits ? EDIT_MODEL : GENERATION_MODEL;
      const fallbackRequest = useEdits
        ? { model: modelUsed, prompt: basePrompt, images: referenceImages, aspect_ratio: aspectRatio }
        : { model: modelUsed, prompt: basePrompt + "\n\nPortrait vertical composition for 9:16 video. Keep the main subject and important details centered and safe for crop.", option: GENERATION_OPTION, n: 1 };
      upstream = await fetch("https://api.kiosapi.id/v1/images/" + (useEdits ? "edits" : "generations"), {
        method: "POST",
        headers: { "Authorization": "Bearer " + env.KIOSAPI_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify(fallbackRequest)
      });
      data = await readJson(upstream);
    }
    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, providerUsed + "-image-http-" + upstream.status);
      settled = true;
      return jsonError(data.error?.message || data.message || "Provider gagal membuat gambar.", upstream.status);
    }

    providerResponded = true;
    const image = data.data?.[0];
    const openRouterCostUsd = Number(data.usage?.cost);
    const kiosapiCostIdr = Number(data.kiosapi?.cost_rupiah);
    const hasOpenRouterActualCost = providerUsed === "openrouter" && Number.isFinite(openRouterCostUsd) && openRouterCostUsd > 0;
    const hasKiosapiActualCost = providerUsed === "kiosapi" && Number.isFinite(kiosapiCostIdr) && kiosapiCostIdr > 0;
    const providerCostUsd = hasOpenRouterActualCost ? openRouterCostUsd : 0;
    const providerCostEstimated = !(hasOpenRouterActualCost || hasKiosapiActualCost);
    const providerCostIdr = hasOpenRouterActualCost
      ? Math.ceil(openRouterCostUsd * Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || 18000))
      : hasKiosapiActualCost
        ? Math.ceil(kiosapiCostIdr)
        : (providerUsed === "openrouter" ? OPENROUTER_IMAGE_PRICE_IDR : (useEdits ? EDIT_PRICE_IDR : GENERATION_PRICE_IDR));
    const billing = calculateKiosapiCharge({ cost_idr: providerCostIdr }, env);
    const charge = await settleReservedCredits(
      auth.user, env, reservation.reservationId, billing.credits,
      "video-image:" + providerUsed + ":" + modelUsed,
      { provider: providerUsed, model: modelUsed, providerCostIdr, providerCostUsd, providerCostEstimated, requestId, imageMode: useEdits ? "reference-edit" : "text-to-image" }
    );
    settled = true;

    if (!image?.b64_json || typeof image.b64_json !== "string") {
      return jsonError("Provider merespons, tetapi data gambar tidak ditemukan. Biaya provider sudah tercatat.", 502);
    }
    if (!env.VIDEO_MEDIA) return jsonError("Penyimpanan media R2 belum terhubung. Kredit provider sudah tercatat; hubungi admin sebelum mengulang generasi.", 503);
    const assetId = requestId;
    const mime = image.media_type || image.mime || "image/png";
    const binary = Uint8Array.from(atob(image.b64_json), ch => ch.charCodeAt(0));
    const storageKey = auth.user.uid + "/" + assetId;
    try { await ensureStorageCapacity(auth.user, env, binary.byteLength, storageKey); } catch (storageError) { return jsonError(storageError.message, storageError.status || 500); }\n    await env.VIDEO_MEDIA.put(storageKey, binary, { httpMetadata: { contentType: mime, cacheControl: "private, no-store" }, customMetadata: { uid: auth.user.uid, project: "zaida-video-studio" } });

    return Response.json({
      image: { b64: image.b64_json, mime, assetId },
      model: modelUsed,
      option: providerUsed === "kiosapi" ? (useEdits ? EDIT_OPTION : GENERATION_OPTION) : option,
      imageMode: useEdits ? "reference-edit" : "text-to-image",
      providerCostIdr,
      creditsCharged: charge.charged,
      creditsRemaining: charge.remaining,
      sceneNumber
    }, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (reservation && !settled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "video-image-error"); } catch {}
    }
    return jsonError(error?.message || "Tidak dapat membuat gambar adegan.", error?.status || 502);
  }
}
