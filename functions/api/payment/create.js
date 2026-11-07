import { verifyFirebaseUser, getOrCreateAccount, createPaymentRecord, updatePaymentCheckout } from "../../lib/firebase.js";

const PACKAGES = {
  starter: { name: "Starter", amount: 19000, credits: 19000 },
  basic: { name: "Basic", amount: 29000, credits: 30000 },
  creator: { name: "Creator", amount: 49000, credits: 52000 },
  pro: { name: "Pro", amount: 79000, credits: 86000 },
  premium: { name: "Premium", amount: 100000, credits: 112000 }
};

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.MIDTRANS_SERVER_KEY) return Response.json({ error: "MIDTRANS_SERVER_KEY belum dikonfigurasi." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Format permintaan tidak valid." }, { status: 400 }); }
  const selected = PACKAGES[String(body.packageId || "").toLowerCase()];
  if (!selected) return Response.json({ error: "Paket tidak valid." }, { status: 400 });

  try {
    await getOrCreateAccount(auth.user, env);
    const orderId = "ZV-" + crypto.randomUUID();
    await createPaymentRecord(env, {
      orderId, uid: auth.user.uid, email: auth.user.email,
      packageId: String(body.packageId).toLowerCase(),
      packageName: selected.name, amount: selected.amount, credits: selected.credits
    });
    const origin = new URL(request.url).origin;
    const response = await fetch("https://app.sandbox.midtrans.com/snap/v1/transactions", {
      method: "POST",
      headers: {
        "Authorization": "Basic " + btoa(env.MIDTRANS_SERVER_KEY + ":"),
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: selected.amount },
        item_details: [{ id: selected.name.toLowerCase(), price: selected.amount, quantity: 1, name: "ZAIDA Voice - " + selected.name }],
        customer_details: { email: auth.user.email },
        callbacks: { finish: origin + "/?payment=finish&order_id=" + encodeURIComponent(orderId) }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.redirect_url) {
      return Response.json({ error: data.error_messages?.join(" ") || "Midtrans gagal membuat halaman pembayaran." }, { status: 502 });
    }
    await updatePaymentCheckout(env, orderId, { token: data.token, redirectUrl: data.redirect_url });
    return Response.json({ orderId, redirectUrl: data.redirect_url });
  } catch (error) {
    return Response.json({ error: error.message || "Tidak dapat membuat pembayaran." }, { status: error.status || 502 });
  }
}
