import {
  verifyFirebaseUser, getOrCreateAccount, reserveCredits,
  releaseCredits, settleReservedCredits, calculateKiosapiCharge
} from "../../lib/firebase.js";

const MODEL = "openai/gpt-image-2.5-flare";
const OPTION = "1024x1536:medium";
const PROVIDER_PRICE_IDR = 500;
const jsonError = (message, status = 502) => Response.json({ error: message }, { status });

async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 400) || response.statusText } }; }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.KIOSAPI_API_KEY) return jsonError("KIOSAPI_API_KEY belum dikonfigurasi di Cloudflare.", 503);

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Format permintaan tidak valid.", 400); }

  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 1800) : "";
  const sceneNumber = Math.max(1, Math.min(8, Number(body.sceneNumber) || 1));
  if (!requestId) return jsonError("ID permintaan tidak valid.", 400);
  if (prompt.length < 20) return jsonError("Prompt gambar terlalu singkat. Periksa arahan visual adegan.", 400);

  const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
  const reserveAmount = Math.ceil(PROVIDER_PRICE_IDR * markup) + 1;
  let reservation = null;
  let settled = false;
  let providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    reservation = await reserveCredits(auth.user, env, reserveAmount, "video-image:kiosapi:" + MODEL, {
      requestId, provider: "kiosapi", model: MODEL
    });

    const upstream = await fetch("https://api.kiosapi.id/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.KIOSAPI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        prompt: prompt + "\n\nKomposisi portrait vertikal untuk video 9:16. Jaga subjek utama dan detail penting di area tengah agar aman saat crop. Jangan tampilkan teks, watermark, atau logo.",
        option: OPTION,
        n: 1
      })
    });

    const data = await readJson(upstream);
    if (!upstream.ok) {
      await releaseCredits(auth.user, env, reservation.reservationId, "kiosapi-image-http-" + upstream.status);
      settled = true;
      return jsonError(data.error?.message || data.message || "Kiosapi gagal membuat gambar.", upstream.status);
    }

    providerResponded = true;
    const image = data.data?.[0];
    const providerCostIdr = Math.max(0, Number(data.kiosapi?.cost_rupiah) || PROVIDER_PRICE_IDR);
    const billing = calculateKiosapiCharge({ cost_idr: providerCostIdr }, env);
    const charge = await settleReservedCredits(
      auth.user, env, reservation.reservationId, billing.credits,
      "video-image:kiosapi:" + MODEL,
      { provider: "kiosapi", model: MODEL, providerCostIdr, requestId }
    );
    settled = true;

    if (!image?.b64_json || typeof image.b64_json !== "string") {
      return jsonError("Provider merespons, tetapi data gambar tidak ditemukan. Biaya provider sudah tercatat.", 502);
    }

    return Response.json({
      image: { b64: image.b64_json, mime: image.mime || "image/png" },
      model: MODEL,
      option: OPTION,
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
