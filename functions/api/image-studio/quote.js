import { verifyFirebaseUser, getOrCreateAccount, calculateKiosapiCharge } from "../../lib/firebase.js";

const json = (data, status = 200) => Response.json(data, {
  status,
  headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
});

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;

  const useOpenRouter = Boolean(env.OPENROUTER_API_KEY);
  const provider = useOpenRouter ? "openrouter" : env.KIOSAPI_API_KEY ? "kiosapi" : null;
  if (!provider) return json({ error: "Provider AI belum dikonfigurasi." }, 503);

  try {
    const account = await getOrCreateAccount(auth.user, env);
    const mode = new URL(request.url).searchParams.get("mode") === "generate" ? "generate" : "edit";
    const isGenerate = mode === "generate";
    const providerPriceIdr = Math.max(1, Number(isGenerate ? env.ZAIDA_IMAGE_STUDIO_GENERATE_PRICE_IDR : env.ZAIDA_IMAGE_STUDIO_EDIT_PRICE_IDR) || (isGenerate ? 500 : 2500));
    const markup = Math.max(1, Number(env.ZAIDA_AI_MARKUP) || 1.5);
    const estimate = calculateKiosapiCharge({ cost_idr: providerPriceIdr }, env);
    const reserveCeilingIdr = Math.max(providerPriceIdr, Number(isGenerate ? env.ZAIDA_IMAGE_STUDIO_GENERATE_MAX_COST_IDR : env.ZAIDA_IMAGE_STUDIO_EDIT_MAX_COST_IDR) || (isGenerate ? 2500 : 5000));
    const maxTemporaryReserve = Math.ceil(reserveCeilingIdr * markup) + 1;
    return json({
      ok: true,
      mode,
      provider,
      estimatedCredits: estimate.credits,
      estimatedProviderCostIdr: providerPriceIdr,
      maxTemporaryReserve,
      availableCredits: Number(account.credits) || 0,
      estimateIsIndicative: true
    });
  } catch (error) {
    return json({ error: error.message || "Estimasi kredit tidak dapat dimuat." }, error.status || 503);
  }
}
