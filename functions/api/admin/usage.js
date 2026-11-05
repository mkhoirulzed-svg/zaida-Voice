import { verifyFirebaseUser, getOrCreateAccount } from "../../lib/firebase.js";

const read = (v) => {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  return null;
};
export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try {
    const account = await getOrCreateAccount(auth.user, env);
    if (account.role !== "admin") return Response.json({ error: "Akses admin diperlukan." }, { status: 403 });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await createServiceAssertion(env)
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Tidak dapat mengakses laporan Firestore.");
    const url = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(env.FIREBASE_PROJECT_ID) + "/databases/(default)/documents:runQuery";
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "credit_ledger" }], orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }], limit: 100 } })
    });
    const rows = await response.json();
    if (!response.ok) throw new Error(rows.error?.message || "Gagal membaca transaksi.");
    const transactions = (Array.isArray(rows) ? rows : []).filter(x => x.document).map(x => {
      const f = x.document.fields || {};
      return {
        id: x.document.name.split("/").pop(),
        uid: read(f.uid), type: read(f.type), amount: read(f.amount),
        description: read(f.description), provider: read(f.provider),
        model: read(f.model), providerCostIdr: read(f.providerCostIdr) || 0,
        providerCostUsd: Number(read(f.providerCostUsd) || 0),
        inputTokens: read(f.inputTokens) || 0, outputTokens: read(f.outputTokens) || 0,
        characters: read(f.characters) || 0, createdAt: read(f.createdAt)
      };
    });
    const usage = transactions.filter(x => x.type === "usage");
    return Response.json({
      count: transactions.length,
      creditsCharged: usage.reduce((sum, x) => sum + Math.abs(Number(x.amount) || 0), 0),
      providerCostIdr: usage.reduce((sum, x) => sum + (Number(x.providerCostIdr) || 0), 0),
      providerCostUsd: usage.reduce((sum, x) => sum + (Number(x.providerCostUsd) || 0), 0),
      byProvider: ["deepseek", "elevenlabs"].map(provider => {
        const items = usage.filter(x => x.provider === provider);
        return { provider, requests: items.length, creditsCharged: items.reduce((sum,x)=>sum+Math.abs(Number(x.amount)||0),0), providerCostIdr: items.reduce((sum,x)=>sum+(Number(x.providerCostIdr)||0),0), providerCostUsd: items.reduce((sum,x)=>sum+(Number(x.providerCostUsd)||0),0) };
      }),
      transactions
    });
  } catch (error) {
    return Response.json({ error: error.message || "Laporan penggunaan tidak tersedia." }, { status: 503 });
  }
}

// Minimal RS256 service-account assertion, scoped to Firestore read access.
const enc = new TextEncoder();
const b64 = bytes => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
};
async function createServiceAssertion(env) {
  if (!env.FIREBASE_CLIENT_EMAIL || !env.FIREBASE_PRIVATE_KEY || !env.FIREBASE_PROJECT_ID) throw new Error("Konfigurasi Firestore server belum lengkap.");
  const now = Math.floor(Date.now() / 1000);
  const header = b64(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64(enc.encode(JSON.stringify({ iss: env.FIREBASE_CLIENT_EMAIL, sub: env.FIREBASE_CLIENT_EMAIL, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600, scope: "https://www.googleapis.com/auth/datastore" })));
  const unsigned = header + "." + claim;
  const pem = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), c => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned));
  return unsigned + "." + b64(new Uint8Array(signature));
}
