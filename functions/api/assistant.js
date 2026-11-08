import {
  verifyFirebaseUser,
  getOrCreateAccount,
  calculateDeepSeekCharge,
  calculateKiosapiCharge,
  estimateDeepSeekReservation,
  estimateKiosapiReservation,
  estimateKiosapiCostIdr,
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

function parseAssistantOutput(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("AI tidak mengembalikan jawaban.");
  let output;
  try { output = JSON.parse(raw); }
  catch { throw new Error("Format jawaban AI tidak valid; penggunaan provider tetap tercatat."); }
  const reply = typeof output.reply === "string" ? output.reply.trim() : "";
  const script = typeof output.script === "string" ? output.script.trim() : "";
  if (!reply) throw new Error("AI tidak mengembalikan jawaban; penggunaan provider tetap tercatat.");
  return { reply, script };
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;

  const hasKiosapi = Boolean(env.KIOSAPI_API_KEY);
  const hasDirectDeepSeek = Boolean(env.DEEPSEEK_API_KEY);
  if (!hasKiosapi && !hasDirectDeepSeek) {
    return jsonError("KIOSAPI_API_KEY atau DEEPSEEK_API_KEY belum dikonfigurasi di Cloudflare.", 503);
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonError("Format permintaan tidak valid.", 400); }

  const requestId = typeof body.requestId === "string" && /^[0-9a-f-]{36}$/i.test(body.requestId) ? body.requestId : null;
  if (!requestId) return jsonError("ID permintaan tidak valid. Silakan muat ulang dan coba lagi.", 400);

  const profile = body.profile && typeof body.profile === "object" ? body.profile : {};
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw.slice(-12)
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string" && m.content.trim())
    .map(m => ({ role: m.role, content: m.content.trim().slice(0, 3000) }));

  if (!messages.length || messages[messages.length - 1].role !== "user") return jsonError("Kirim pesan terlebih dahulu.", 400);
  if (messages.reduce((n, m) => n + m.content.length, 0) > 12000) return jsonError("Percakapan terlalu panjang. Mulai percakapan baru.", 400);

  const allowed = ["olahraga", "politik", "komedi", "pendidikan", "teknologi", "bisnis", "kesehatan", "cerita", "hiburan", "sejarah", "iklan"];
  const interests = Array.isArray(profile.interests) ? profile.interests.filter(x => allowed.includes(x)).slice(0, 10) : [];
  const safe = (v, max = 160) => typeof v === "string" ? v.trim().slice(0, max) : "";
  const persona = safe(profile.persona, 80);
  const style = safe(profile.style, 100) || "santai dan akrab";
  const emotion = safe(profile.emotion, 100) || "natural dan netral";
  const audience = safe(profile.audience, 120) || "pendengar umum";
  const length = safe(profile.length, 100) || "fleksibel sesuai kebutuhan";

  const mode = body.mode === "super-chat" ? "super-chat" : "script-assistant";
  const system = mode === "super-chat"
    ? `Kamu adalah ZAIDA AI, asisten percakapan umum berbahasa Indonesia yang cerdas, ramah, jujur, dan praktis. Bantu pengguna berdiskusi, menjelaskan konsep, menganalisis masalah, mencari ide, menulis, merencanakan pekerjaan, dan menyelesaikan berbagai pertanyaan. Ikuti konteks percakapan; jangan menganggap setiap pertanyaan sebagai permintaan membuat naskah audio/video. Jika pengguna meminta naskah, bantu membuatnya secara natural dan siap digunakan. Jangan mengarang fakta, kutipan, data, atau berita. Untuk informasi yang belum pasti, nyatakan keterbatasannya. Untuk topik kesehatan, hukum, keuangan, dan keselamatan, berikan informasi hati-hati dan jangan menggantikan tenaga profesional.
OUTPUT: Balas HANYA JSON valid dengan properti "reply" dan "script". "reply" berisi jawaban percakapan yang lengkap dan membantu. "script" berisi naskah final lengkap HANYA jika pengguna secara eksplisit meminta dibuatkan/dituliskan naskah atau meminta versi final; selain itu gunakan string kosong. Jika menghasilkan naskah, buat siap dibacakan tanpa catatan proses atau label yang tidak perlu.`
    : `Kamu adalah ZAIDA Assistant, partner kreatif untuk merancang naskah audio dan video berbahasa Indonesia. Berdiskusilah secara natural, kolaboratif, dan membantu. Jangan langsung membuat naskah final sebelum pengguna memintanya atau konteks jelas bahwa ia ingin naskah dibuat. Bantu menggali ide, sudut pandang, struktur, hook, dan ajakan bertindak. Jaga akurasi: jangan mengarang fakta, kutipan, data, atau berita. Untuk topik politik, kesehatan, dan isu faktual, bedakan fakta dan opini serta minta konteks bila diperlukan. Hindari ujaran kebencian dan manipulasi.
PERSONALISASI PENGGUNA:
Persona: ${persona || "belum ditentukan"}
Minat: ${interests.join(", ") || "belum ditentukan"}
Gaya komunikasi: ${style}
Nuansa/emosi naskah: ${emotion}
Target pendengar: ${audience}
Panjang target: ${length}
Gunakan preferensi ini sebagai arahan, bukan batasan kaku.
OUTPUT: Balas HANYA JSON valid dengan properti "reply" dan "script". "reply" berisi respons percakapan untuk pengguna. "script" berisi naskah final lengkap HANYA jika pengguna secara eksplisit meminta dibuatkan/dituliskan naskah atau meminta versi final; selain itu gunakan string kosong. Naskah harus siap dibacakan, tanpa catatan proses atau label yang tidak perlu. Jangan mengubah preferensi personalisasi menjadi klaim faktual.`;

  const primaryModel = env.ZAIDA_KIOSAPI_PRIMARY_MODEL || "openai/gpt-4o-mini";
  const fallbackModel = env.ZAIDA_KIOSAPI_FALLBACK_MODEL || "deepseek/deepseek-v4-flash";
  const directDeepSeekModel = env.ZAIDA_DIRECT_DEEPSEEK_MODEL || "deepseek-chat";
  const maxOutputTokens = 1200;
  const promptMessages = [{ role: "system", content: system }, ...messages];
  let reservation = null;
  let reservationSettled = false;
  let providerResponded = false;

  try {
    await getOrCreateAccount(auth.user, env);
    const inputCharacters = system.length + messages.reduce((n, m) => n + m.content.length, 0);
    const reserveAmount = hasKiosapi
      ? estimateKiosapiReservation(inputCharacters, maxOutputTokens, env)
      : estimateDeepSeekReservation(inputCharacters, maxOutputTokens, env);

    reservation = await reserveCredits(auth.user, env, reserveAmount, "ai-assistant", {
      requestId,
      provider: hasKiosapi ? "kiosapi" : "deepseek",
      model: hasKiosapi ? primaryModel : directDeepSeekModel
    });

    let lastError = null;

    // Kiosapi is the primary gateway. The models array provides its model-level fallback.
    if (hasKiosapi) {
      try {
        const upstream = await fetch("https://api.kiosapi.id/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + env.KIOSAPI_API_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            models: primaryModel === fallbackModel ? [primaryModel] : [primaryModel, fallbackModel],
            messages: promptMessages,
            temperature: 0.75,
            max_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
            stream: false
          })
        });

        const data = await readJson(upstream);
        if (!upstream.ok) {
          const error = new Error(data.error?.message || data.message || "Kiosapi gagal memproses percakapan (HTTP " + upstream.status + ").");
          error.status = upstream.status;
          throw error;
        }

        // Once a successful upstream response arrives it may be billable.
        // Do not call another provider if billing or output parsing subsequently fails.
        providerResponded = true;
        const modelUsed = upstream.headers.get("X-Kiosapi-Model-Used") || data.model || primaryModel;
        const headerCost = upstream.headers.get("X-Kiosapi-Cost-IDR");
        const reportedCost = data.usage?.cost_idr ?? (headerCost !== null ? Number(headerCost) : null);
        const providerCostIdr = reportedCost !== null && Number.isFinite(Number(reportedCost))
          ? Math.max(0, Number(reportedCost))
          : estimateKiosapiCostIdr(data.usage || {}, modelUsed, env);
        const billing = calculateKiosapiCharge({ ...(data.usage || {}), cost_idr: providerCostIdr }, env);
        const charged = await settleReservedCredits(
          auth.user,
          env,
          reservation.reservationId,
          billing.credits,
          "ai-assistant:kiosapi:" + modelUsed,
          {
            provider: "kiosapi",
            model: modelUsed,
            providerCostIdr: Math.ceil(providerCostIdr),
            inputTokens: billing.inputTokens,
            outputTokens: billing.outputTokens,
            requestId
          }
        );
        reservationSettled = true;

        const parsed = parseAssistantOutput(data.choices?.[0]?.message?.content);
        return Response.json({
          ...parsed,
          creditsCharged: charged.charged,
          creditsRemaining: charged.remaining,
          usage: { inputTokens: billing.inputTokens, outputTokens: billing.outputTokens },
          provider: "kiosapi",
          model: modelUsed,
          providerCostIdr
        });
      } catch (error) {
        if (providerResponded) throw error;
        lastError = error;
      }
    }

    // Emergency direct DeepSeek fallback if Kiosapi is unavailable or rejects the request.
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
            messages: promptMessages,
            temperature: 0.75,
            max_tokens: maxOutputTokens,
            response_format: { type: "json_object" },
            stream: false
          })
        });
        const data = await readJson(upstream);
        if (!upstream.ok) {
          const error = new Error(data.error?.message || "DeepSeek gagal memproses percakapan (HTTP " + upstream.status + ").");
          error.status = upstream.status;
          throw error;
        }

        providerResponded = true;
        const billing = calculateDeepSeekCharge(data.usage || {}, env);
        const charged = await settleReservedCredits(
          auth.user,
          env,
          reservation.reservationId,
          billing.credits,
          "ai-assistant:deepseek-direct:" + billing.inputTokens + " input/" + billing.outputTokens + " output tokens",
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

        const parsed = parseAssistantOutput(data.choices?.[0]?.message?.content);
        return Response.json({
          ...parsed,
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

    await releaseCredits(auth.user, env, reservation.reservationId, "all-assistant-providers-failed");
    reservationSettled = true;
    return jsonError(lastError?.message || "Kiosapi dan DeepSeek gagal memproses percakapan.", lastError?.status || 502);
  } catch (error) {
    if (reservation && !reservationSettled && !providerResponded) {
      try { await releaseCredits(auth.user, env, reservation.reservationId, "assistant-processing-error"); }
      catch { /* Reservation remains visible for admin review. */ }
    }
    return jsonError(error?.message || "Tidak dapat memproses percakapan.", error?.status || 502);
  }
}