import {
  verifyFirebaseUser, getOrCreateAccount, reserveCredits, releaseCredits,
  settleReservedCredits, ensureStorageCapacity, getVideoProject, saveVideoProject
} from "../../lib/firebase.js";

const MODEL = "x-ai/grok-imagine-video-1.5-lite";
const REFERENCE_MODEL = "x-ai/grok-imagine-video";
const PROVIDER_USD_PER_SECOND = 0.02; // Published starting price at 480p; actual usage.cost takes precedence.
const DEFAULT_FX = 18000;
const jsonError = (message, status = 400) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
const validId = value => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
const markupFor = env => Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
const fxFor = env => Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || DEFAULT_FX);
function quote(duration, env, useReferences = false) {
  const seconds = Math.max(1, Math.min(15, Math.round(Number(duration) || 8)));
  const providerCostUsd = (useReferences ? 0.05 : PROVIDER_USD_PER_SECOND) * seconds;
  const providerCostIdr = Math.ceil(providerCostUsd * fxFor(env));
  return {
    model: useReferences ? REFERENCE_MODEL : MODEL, resolution: "480p", duration: seconds, currency: "IDR",
    providerCostUsd, providerCostIdr,
    estimatedCredits: Math.max(1, Math.ceil(providerCostIdr * markupFor(env))),
    reserveCredits: Math.max(1, Math.ceil(providerCostIdr * markupFor(env) * (useReferences ? 1.75 : 1.25))),
    usdToIdr: fxFor(env), markup: markupFor(env)
  };
}
async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); } catch { return { error: { message: raw.slice(0, 500) || response.statusText } }; }
}
async function saveJob(user, env, id, title, payload) {
  return saveVideoProject(user, env, { id, title, payload });
}
function openRouterHeaders(env, json = false) {
  return {
    Authorization: "Bearer " + env.OPENROUTER_API_KEY,
    ...(json ? { "Content-Type": "application/json" } : {}),
    "HTTP-Referer": "https://voice.zaidalabs.com",
    "X-Title": "ZAIDA Voice"
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ quote: quote(8, env), referenceQuote: quote(8, env, true), model: MODEL, referenceModel: REFERENCE_MODEL, maxReferenceImages: 2 }, { headers: { "Cache-Control": "no-store" } });
  if (!env.OPENROUTER_API_KEY) return jsonError("OPENROUTER_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  if (!env.VIDEO_MEDIA) return jsonError("R2 VIDEO_MEDIA belum terhubung.", 503);
  let project;
  try { project = await getVideoProject(auth.user, env, id); }
  catch (error) { return jsonError(error.message || "Riwayat video tidak ditemukan.", error.status || 404); }
  const payload = project.payload || {};
  if (payload.kind !== "text-to-video") return jsonError("Jenis proyek tidak sesuai.", 404);
  if (payload.status === "completed") return Response.json({ ok: true, status: "completed", project, assetId: payload.assetId, chargedCredits: payload.chargedCredits, creditsRemaining: payload.creditsRemaining }, { headers: { "Cache-Control": "no-store" } });
  if (["failed", "cancelled", "expired"].includes(payload.status)) return Response.json({ ok: false, status: payload.status, error: payload.error || "Video tidak berhasil dibuat.", project }, { headers: { "Cache-Control": "no-store" } });
  if (!payload.openRouterJobId) return Response.json({ ok: false, status: payload.status || "submitting", project, message: "Permintaan sedang dikirim ke provider. Coba periksa kembali sebentar lagi." }, { headers: { "Cache-Control": "no-store" } });

  let upstream;
  try {
    upstream = await fetch("https://openrouter.ai/api/v1/videos/" + encodeURIComponent(payload.openRouterJobId), { headers: openRouterHeaders(env) });
  } catch {
    return jsonError("Koneksi ke provider terputus saat memeriksa status. Job tetap tersimpan; coba periksa lagi.", 502);
  }
  const job = await readJson(upstream);
  if (!upstream.ok) return jsonError(job.error?.message || job.message || "Gagal memeriksa status video.", upstream.status);
  const status = String(job.status || "pending").toLowerCase();
  if (["pending", "in_progress"].includes(status)) {
    await saveJob(auth.user, env, id, project.title, { ...payload, status, lastCheckedAt: new Date().toISOString() });
    return Response.json({ ok: true, status, projectId: id }, { headers: { "Cache-Control": "no-store" } });
  }
  if (["failed", "cancelled", "expired"].includes(status)) {
    if (!payload.creditsReleased && payload.reservationId) {
      await releaseCredits(auth.user, env, payload.reservationId, "text-to-video-" + status);
    }
    const failedPayload = { ...payload, status, error: String(job.error || "Provider tidak berhasil menghasilkan video. Kredit reservasi dikembalikan."), creditsReleased: true, completedAt: new Date().toISOString() };
    await saveJob(auth.user, env, id, project.title, failedPayload);
    return Response.json({ ok: false, status, error: failedPayload.error, projectId: id }, { headers: { "Cache-Control": "no-store" } });
  }
  if (status !== "completed") return Response.json({ ok: true, status, projectId: id }, { headers: { "Cache-Control": "no-store" } });

  let assetId = payload.assetId || "";
  if (!assetId) {
    // Always download through OpenRouter's authenticated content endpoint.
    // Do not forward our OpenRouter API key to a provider-supplied unsigned URL.
    const downloadUrl = "https://openrouter.ai/api/v1/videos/" + encodeURIComponent(payload.openRouterJobId) + "/content?index=0";
    let videoResponse;
    try { videoResponse = await fetch(downloadUrl, { headers: openRouterHeaders(env) }); }
    catch { return jsonError("Video selesai dibuat, tetapi unduhan terputus. Coba periksa kembali.", 502); }
    if (!videoResponse.ok) return jsonError("Video selesai, tetapi belum dapat diunduh dari provider.", 502);
    const bytes = await videoResponse.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 50 * 1024 * 1024) return jsonError("Ukuran video tidak valid atau melebihi batas 50 MB.", 413);
    try { await ensureStorageCapacity(auth.user, env, bytes.byteLength); }
    catch (error) { return jsonError(error.message || "Kuota Media Library tidak mencukupi.", error.status || 413); }
    assetId = crypto.randomUUID();
    const contentType = (videoResponse.headers.get("Content-Type") || "video/mp4").split(";")[0];
    await env.VIDEO_MEDIA.put(auth.user.uid + "/" + assetId, bytes, {
      httpMetadata: { contentType: contentType.startsWith("video/") ? contentType : "video/mp4", cacheControl: "private, no-store" },
      customMetadata: {
        uid: auth.user.uid, project: "zaida-text-to-video", kind: "video",
        source: "text-to-video", fileName: ("ZAIDA-" + String(project.title || "AI-Video").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "-").slice(0, 55) + ".mp4").slice(0, 120)
      }
    });
    await saveJob(auth.user, env, id, project.title, { ...payload, status: "saving", assetId, fileSize: bytes.byteLength });
  }

  const usageCost = Number(job.usage?.cost);
  const providerCostEstimated = !(Number.isFinite(usageCost) && usageCost > 0);
  const providerCostUsd = providerCostEstimated ? Number(payload.estimatedProviderCostUsd || (PROVIDER_USD_PER_SECOND * Number(payload.duration || 8))) : usageCost;
  const providerCostIdr = Math.ceil(providerCostUsd * fxFor(env));
  const calculatedCharge = Math.max(1, Math.ceil(providerCostIdr * markupFor(env)));
  const reserved = Math.max(1, Number(payload.reservedCredits) || 1);
  const chargedCredits = Math.min(calculatedCharge, reserved);
  let billing;
  try {
    billing = await settleReservedCredits(auth.user, env, payload.reservationId, chargedCredits, "text-to-video:" + (payload.model || MODEL), {
      provider: "openrouter", model: payload.model || MODEL, providerCostIdr, providerCostUsd, providerCostEstimated
    });
  } catch (error) {
    return jsonError("Video sudah tersimpan, tetapi penyelesaian kredit perlu diperiksa admin: " + error.message, 409);
  }
  const finalPayload = {
    ...payload, status: "completed", assetId, fileSize: payload.fileSize || null,
    providerCostUsd, providerCostIdr, providerCostEstimated,
    chargedCredits: billing.charged, creditsRemaining: billing.remaining,
    completedAt: new Date().toISOString()
  };
  await saveJob(auth.user, env, id, project.title, finalPayload);
  return Response.json({ ok: true, status: "completed", projectId: id, assetId, chargedCredits: billing.charged, creditsRemaining: billing.remaining, providerCostIdr, providerCostEstimated }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.OPENROUTER_API_KEY) return jsonError("OPENROUTER_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  if (!env.VIDEO_MEDIA) return jsonError("R2 VIDEO_MEDIA belum terhubung.", 503);
  let body;
  try { body = await request.json(); } catch { return jsonError("Format permintaan tidak valid.", 400); }
  const requestId = validId(body.requestId) ? body.requestId : null;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 2000) : "";
  const duration = Math.max(4, Math.min(15, Math.round(Number(body.duration) || 8)));
  const aspectRatio = ["9:16", "16:9", "1:1"].includes(body.aspectRatio) ? body.aspectRatio : "9:16";
  const referenceImages = Array.isArray(body.referenceImages) ? body.referenceImages : [];
  const referenceSlots = Array.isArray(body.referenceSlots) ? body.referenceSlots : referenceImages.map((_, index) => index + 1);
  if (referenceImages.length > 2) return jsonError("Maksimal 2 foto referensi untuk versi saat ini.", 400);
  if (referenceSlots.length !== referenceImages.length || referenceSlots.some(slot => ![1, 2].includes(Number(slot))) || new Set(referenceSlots).size !== referenceSlots.length) return jsonError("Urutan foto referensi tidak valid.", 400);
  for (const image of referenceImages) {
    if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return jsonError("Format foto referensi tidak valid. Gunakan JPG, PNG, atau WebP.", 400);
    if (image.length > 7 * 1024 * 1024) return jsonError("Ukuran setiap foto referensi maksimal 5 MB.", 413);
  }
  const useReferences = referenceImages.length > 0;
  const selectedModel = useReferences ? REFERENCE_MODEL : MODEL;
  const normalizedPrompt = useReferences
    ? (() => {
        let mapped = prompt;
        const mapping = [];
        referenceSlots.forEach((slot, index) => {
          mapped = mapped.replace(new RegExp("foto\\\\s+referensi\\\\s*" + slot + "(?![0-9])", "gi"), "<IMAGE_" + index + ">");
          mapping.push("<IMAGE_" + index + "> is Foto Referensi " + slot);
        });
        return mapped + "\\n\\nReference mapping: " + mapping.join("; ") + ". Use each image according to the user's instructions and preserve the referenced visual identity where requested.";
      })()
    : prompt;
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (prompt.length < 12) return jsonError("Prompt minimal 12 karakter.", 400);
  try {
    const existing = await getVideoProject(auth.user, env, requestId);
    if (existing?.payload?.kind === "text-to-video") return Response.json({ ok: true, projectId: requestId, status: existing.payload.status, duplicate: true });
  } catch (error) { if (error.status !== 404) return jsonError(error.message, error.status || 500); }

  const pricing = quote(duration, env, useReferences);
  let reservation = null;
  let providerRequestStarted = false;
  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(auth.user, env, pricing.reserveCredits, "text-to-video:openrouter:" + selectedModel, {
      requestId, provider: "openrouter", model: selectedModel
    });
    const title = prompt.replace(/\s+/g, " ").slice(0, 72) || "Text-to-Video";
    const initialPayload = {
      kind: "text-to-video", status: "submitting", prompt, model: selectedModel, referenceCount: referenceImages.length,
      duration, resolution: "480p", aspectRatio, generateAudio: false,
      requestId, reservationId: reservation.reservationId,
      reservedCredits: reservation.reserved, estimatedCredits: pricing.estimatedCredits,
      estimatedProviderCostUsd: pricing.providerCostUsd, estimatedProviderCostIdr: pricing.providerCostIdr,
      createdAt: new Date().toISOString()
    };
    await saveJob(auth.user, env, requestId, title, initialPayload);
    let upstream;
    providerRequestStarted = true;
    try {
      upstream = await fetch("https://openrouter.ai/api/v1/videos", {
        method: "POST", headers: openRouterHeaders(env, true),
        body: JSON.stringify({
          model: selectedModel, prompt: normalizedPrompt, duration, resolution: "480p",
          aspect_ratio: aspectRatio, generate_audio: false,
          ...(useReferences ? { image_urls: referenceImages } : {})
        })
      });
    } catch {
      await saveJob(auth.user, env, requestId, title, { ...initialPayload, status: "submission_unknown", error: "Koneksi terputus saat mengirim permintaan. Reservasi kredit ditahan agar tidak terjadi pengiriman ganda." });
      return jsonError("Koneksi provider terputus saat mengirim permintaan. Cek Riwayat sebelum mencoba ulang agar tidak membuat video ganda.", 502);
    }
    const data = await readJson(upstream);
    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, "text-to-video-submit-failed");
      await saveJob(auth.user, env, requestId, title, { ...initialPayload, status: "failed", creditsReleased: true, error: data.error?.message || data.message || "Provider menolak permintaan video." });
      return jsonError(data.error?.message || data.message || "Provider menolak permintaan video.", upstream.status || 502);
    }
    if (!data.id) {
      await saveJob(auth.user, env, requestId, title, { ...initialPayload, status: "submission_unknown", error: "Provider menerima respons tetapi tidak mengembalikan ID job. Reservasi ditahan untuk pemeriksaan." });
      return jsonError("Provider tidak mengembalikan ID job. Reservasi kredit ditahan untuk pemeriksaan; cek Riwayat sebelum mengirim ulang.", 502);
    }
    const pendingPayload = { ...initialPayload, status: String(data.status || "pending"), openRouterJobId: data.id, pollingUrl: data.polling_url || "", submittedAt: new Date().toISOString() };
    await saveJob(auth.user, env, requestId, title, pendingPayload);
    return Response.json({
      ok: true, projectId: requestId, status: pendingPayload.status,
      model: selectedModel, duration, estimatedCredits: pricing.estimatedCredits, referenceCount: referenceImages.length,
      reservedCredits: reservation.reserved, creditsRemaining: reservation.remaining
    }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (reservation && !providerRequestStarted) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "text-to-video-pre-submit-error"); } catch {}
    }
    return jsonError(error.message || "Gagal memulai generasi video.", error.status || 500);
  }
}
