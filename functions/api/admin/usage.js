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


export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try {
    const admin = await getOrCreateAccount(auth.user, env);
    if (admin.role !== "admin") return Response.json({ error: "Akses admin diperlukan." }, { status: 403 });
    const body = await request.json();
    const email = String(body.email || "").trim().toLowerCase();
    const credits = Number(body.credits);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "Masukkan email pengguna yang valid." }, { status: 400 });
    if (!Number.isSafeInteger(credits) || credits < 1 || credits > 1000000) return Response.json({ error: "Jumlah kredit harus 1 sampai 1.000.000." }, { status: 400 });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await createServiceAssertion(env) })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("Tidak dapat mengakses Firestore.");
    const base = "https://firestore.googleapis.com/v1/projects/" + encodeURIComponent(env.FIREBASE_PROJECT_ID) + "/databases/(default)/documents";
    const query = await fetch(base + ":runQuery", {
      method: "POST", headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "users" }], where: { fieldFilter: { field: { fieldPath: "email" }, op: "EQUAL", value: { stringValue: email } } }, limit: 1 } })
    });
    const found = await query.json();
    if (!query.ok) throw new Error(found.error?.message || "Gagal mencari akun.");
    const userDoc = Array.isArray(found) ? found.find(x => x.document)?.document : null;
    if (!userDoc) return Response.json({ error: "Akun dengan email tersebut belum ditemukan. Pengguna harus mendaftar terlebih dahulu." }, { status: 404 });
    const fields = userDoc.fields || {};
    const current = Number(fields.credits?.integerValue || 0);
    const next = current + credits;
    const userUid = fields.uid?.stringValue || userDoc.name.split("/").pop();
    const now = new Date().toISOString();
    const ledgerId = crypto.randomUUID().replace(/-/g, "");
    const ledgerName = "projects/" + env.FIREBASE_PROJECT_ID + "/databases/(default)/documents/credit_ledger/" + ledgerId;
    const commit = await fetch(base + ":commit", {
      method: "POST", headers: { Authorization: "Bearer " + tokenData.access_token, "Content-Type": "application/json" },
      body: JSON.stringify({ writes: [
        { update: { name: userDoc.name, fields: { credits: { integerValue: String(next) }, updatedAt: { stringValue: now } } }, updateMask: { fieldPaths: ["credits", "updatedAt"] }, currentDocument: { updateTime: userDoc.updateTime } },
        { update: { name: ledgerName, fields: { uid: { stringValue: userUid }, email: { stringValue: email }, type: { stringValue: "grant" }, amount: { integerValue: String(credits) }, description: { stringValue: "Penambahan kredit oleh admin" }, provider: { stringValue: "admin" }, model: { stringValue: "manual-credit" }, providerCostIdr: { integerValue: "0" }, providerCostUsd: { stringValue: "0" }, inputTokens: { integerValue: "0" }, outputTokens: { integerValue: "0" }, characters: { integerValue: "0" }, requestId: { stringValue: "" }, createdAt: { stringValue: now } } }, currentDocument: { exists: false } }
      ] })
    });
    const committed = await commit.json().catch(() => ({}));
    if (!commit.ok) {
      const detail = committed.error?.message || "Tidak ada detail dari Firestore.";
      const status = committed.error?.status || "";
      console.error("Admin credit grant Firestore commit failed:", commit.status, status, detail);
      if (commit.status === 409 || /ABORTED|FAILED_PRECONDITION|precondition/i.test(status + " " + detail)) {
        return Response.json({ error: "Data saldo berubah saat diproses. Muat ulang dashboard lalu coba lagi. Detail: " + detail }, { status: 409 });
      }
      return Response.json({ error: "Firestore menolak penambahan kredit (HTTP " + commit.status + "): " + detail }, { status: 502 });
    }
    return Response.json({ success: true, email, creditsAdded: credits, balance: next });
  } catch (error) {
    return Response.json({ error: error.message || "Gagal menambahkan kredit." }, { status: 503 });
  }
}
