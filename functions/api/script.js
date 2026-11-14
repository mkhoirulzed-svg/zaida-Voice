import {
  verifyFirebaseUser,
  getOrCreateAccount,
  calculateDeepSeekCharge,
  calculateKiosapiCharge,
  estimateKiosapiReservation,
  estimateKiosapiCostIdr,
  estimateDeepSeekReservation,
  reserveCredits,
  releaseCredits,
  settleReservedCredits
} from "../lib/firebase.js";

const jsonError = (message, status = 502) => Response.json({ error: message }, { status });

async function readJson(response) {
  const raw = await response.text();
  try { return JSON.parse(raw); }
  catch { return { error: { message: raw.slice(0, 500) || response.statusText } }; }
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;

  const hasOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  const hasKiosapi = Boolean(env.KIOSAPI_API_KEY);
  const hasPrimaryAI = hasOpenRouter || hasKiosapi;
  const hasDirectDeepSeek = Boolean(env.DEEPSEEK_API_KEY);
  if (!hasPrimaryAI && !hasDirectDeepSeek) {
    return jsonError("KIOSAPI_API_KEY atau DEEPSEEK_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Format permintaan tidak valid.", 400); }

  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId) return jsonError("ID permintaan tidak valid. Silakan coba lagi.", 400);

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 5000) return jsonError("Masukkan teks maksimal 5.000 karakter.", 400);

  const language = body.language === "en" ? "English" : "Bahasa Indonesia";
  const task = body.task === "audio_tags" ? "audio_tags" : "polish";
  const system = task === "audio_tags"
    ? "You add sparse ElevenLabs v4 audio tags to a spoken script. Preserve the original words, order, punctuation, facts, names and numbers exactly. Only insert relevant square-bracket delivery cues where helpful: [curious], [crying], [mischievously], [whispers], [shouts], [laughs], [clears throat], [sighs]. Never invent spoken words or add explanations. Avoid excessive tags. Return only the tagged script."
    : language === "English"
    ? "You are a professional editor for spoken-audio scripts in English. Improve flow, grammar, punctuation, and how naturally the text sounds when read aloud. Preserve the user's meaning, facts, names, and numbers. Do not add new claims. Use natural, conversational phrasing. Return only the revised script, with no introduction or explanation."
    : "Kamu adalah editor naskah profesional untuk narasi audio berbahasa Indonesia. Perbaiki alur, ejaan, tanda baca, dan keterdengaran saat dibacakan. Pertahankan maksud, fakta, nama, dan angka dari pengguna. Jangan menambahkan klaim baru. Gunakan kalimat natural, tidak kaku. Kembalikan hanya naskah hasil revisi tanpa pembuka atau penjelasan.";

  const primaryModel = env.ZAIDA_OPENROUTER_TEXT_MODEL || env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "google/gemini-3.1-flash-lite";
  const fallbackModel = env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "deepseek/deepseek-v4.1-flash";
  const directDeepSeekModel = env.ZAIDA_DIRECT_DEEPSEEK_MODEL || "deepseek-chat";
  const maxOutputTokens = 1500;
  let reservation = null;
  let reservationSettled = false;
  let providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    const reserveAmount = hasPrimaryAI
      ? estimateKiosapiReservation(text.length + system.length, maxOutputTokens, env)
      : estimateDeepSeekReservation(text.length + system.length, maxOutputTokens, env);

    reservation = await reserveCredits(auth.user, env, reserveAmount, task === "audio_tags" ? "ai-script-audio-tags" : "ai-script-edit", {
      requestId,
      provider: hasOpenRouter ? "openrouter" : (hasKiosapi ? "kiosapi" : "deepseek"),
      model: hasPrimaryAI ? primaryModel : directDeepSeekModel
    });

    let lastError = null;

    // Kiosapi is the primary gateway. Its models array enables an in-request
    // provider fallback to DeepSeek; only the model that answers is billed.
    if (hasPrimaryAI) {
      try {
        const upstream = await fetch(hasOpenRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.kiosapi.id/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + (hasOpenRouter ? env.OPENROUTER_API_KEY : env.KIOSAPI_API_KEY),
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            ...(hasOpenRouter ? { model: primaryModel } : { models: primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel] }),
            messages: [
              { role: "system", content: system },
              { role: "user", content: text }
            ],
            temperature: 0.7,
            max_tokens: maxOutputTokens,
            stream: false
          })
        });

        const data = await readJson(upstream);
        if (upstream.ok) {
          // A successful provider response may already be billable. Never call
          // another provider if settlement fails after this point.
          providerResponded = true;
          const output = data.choices?.[0]?.message?.content?.trim();
          if (output) {
            const modelUsed = (hasOpenRouter ? data.model : upstream.headers.get("X-Kiosapi-Model-Used")) || data.model || primaryModel;
            const headerCost = upstream.headers.get("X-Kiosapi-Cost-IDR");
            const usdToIdr = Math.max(1, Number(env.ZAIDA_USD_TO_IDR) || 18000);
            const reportedCost = hasOpenRouter
              ? (Number.isFinite(Number(data.usage?.cost)) ? Number(data.usage.cost) * usdToIdr : null)
              : (data.usage?.cost_idr ?? (headerCost !== null ? Number(headerCost) : null));
            const providerCostIdr = reportedCost !== null && Number.isFinite(Number(reportedCost))
              ? Math.max(0, Number(reportedCost))
              : (hasOpenRouter
                ? (((Number(data.usage?.prompt_tokens) || 0) * 4500) + ((Number(data.usage?.completion_tokens) || 0) * 27000)) / 1000000
                : estimateKiosapiCostIdr(data.usage || {}, modelUsed, env));
            const billing = calculateKiosapiCharge({ ...(data.usage || {}), cost_idr: providerCostIdr }, env);
            const charged = await settleReservedCredits(
              auth.user,
              env,
              reservation.reservationId,
              billing.credits,
              "ai-script-edit:" + (hasOpenRouter ? "openrouter:" : "kiosapi:") + modelUsed,
              {
                provider: hasOpenRouter ? "openrouter" : "kiosapi",
                model: modelUsed,
                providerCostIdr: Math.ceil(providerCostIdr),
                inputTokens: billing.inputTokens,
                outputTokens: billing.outputTokens,
                requestId
              }
            );
            reservationSettled = true;
            return Response.json({
              text: output,
              creditsCharged: charged.charged,
              creditsRemaining: charged.remaining,
              usage: { inputTokens: billing.inputTokens, outputTokens: billing.outputTokens },
              provider: hasOpenRouter ? "openrouter" : "kiosapi",
              model: modelUsed,
              providerCostIdr: providerCostIdr
            });
          }
          throw new Error("Kiosapi tidak mengembalikan naskah.");
        } else {
          lastError = new Error(data.error?.message || data.message || "Kiosapi gagal memproses naskah (HTTP " + upstream.status + ").");
          lastError.status = upstream.status;
        }
      } catch (error) {
        if (providerResponded) throw error;
        lastError = error;
      }
    }

    // Optional emergency fallback through DeepSeek's own API key. This also
    // covers Kiosapi gateway/key/balance errors, not only model-provider errors.
    if (hasDirectDeepSeek && !providerResponded) {
      try {
        const upstream = await fetch("https://api.deepseek.com/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.DEEPSEEK_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: directDeepSeekModel,
            messages: [
              { role: "system", content: system },
              { role: "user", content: text }
            ],
            temperature: 0.7,
            max_tokens: maxOutputTokens,
            stream: false
          })
        });
        const data = await readJson(upstream);
        if (!upstream.ok) {
          throw new Error(data.error?.message || "DeepSeek gagal memproses naskah (HTTP " + upstream.status + ").");
        }
        providerResponded = true;
        const output = data.choices?.[0]?.message?.content?.trim();
        if (!output) throw new Error("DeepSeek tidak mengembalikan naskah.");

        const billing = calculateDeepSeekCharge(data.usage || {}, env);
        const charged = await settleReservedCredits(
          auth.user,
          env,
          reservation.reservationId,
          billing.credits,
          "ai-script-edit:deepseek-direct:" + billing.inputTokens + " input/" + billing.outputTokens + " output tokens",
          {
            provider: "deepseek-direct",
            model: directDeepSeekModel,
            providerCostIdr: billing.providerCostIdr,
            providerCostUsd: billing.providerUsd,
            inputTokens: billing.inputTokens,
            outputTokens: billing.outputTokens,
            requestId
          }
        );
        reservationSettled = true;
        return Response.json({
          text: output,
          creditsCharged: charged.charged,
          creditsRemaining: charged.remaining,
          usage: { inputTokens: billing.inputTokens, outputTokens: billing.outputTokens },
          provider: "deepseek-direct",
          model: directDeepSeekModel,
          providerCostIdr: billing.providerCostIdr
        });
      } catch (error) {
        if (providerResponded) throw error;
        lastError = error;
      }
    }

    await releaseCredits(auth.user, env, reservation.reservationId, "all-script-providers-failed");
    reservationSettled = true;
    return jsonError(lastError?.message || "Kiosapi dan DeepSeek gagal memproses naskah.", 502);
  } catch (error) {
    if (reservation && !reservationSettled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "script-processing-error"); }
      catch (releaseError) { /* Keep the original error; reservation remains visible for admin review. */ }
    }
    return jsonError(error?.message || "Tidak dapat memproses naskah.", error?.status || 502);
  }
}
