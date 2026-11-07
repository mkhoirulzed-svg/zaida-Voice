import { verifyFirebaseUser, getPaymentRecord, fulfillPaymentCredits } from "../../lib/firebase.js";

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.MIDTRANS_SERVER_KEY) return Response.json({ error: "Server key belum dikonfigurasi." }, { status: 503 });
  const orderId = new URL(request.url).searchParams.get("order_id") || "";
  if (!/^ZV-[0-9a-f-]{36}$/i.test(orderId)) return Response.json({ error: "Order ID tidak valid." }, { status: 400 });
  try {
    const payment = await getPaymentRecord(env, orderId);
    if (!payment || payment.uid !== auth.user.uid) return Response.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
    if (payment.status !== "paid") {
      const response = await fetch("https://api.sandbox.midtrans.com/v2/" + encodeURIComponent(orderId) + "/status", {
        headers: { "Authorization": "Basic " + btoa(env.MIDTRANS_SERVER_KEY + ":"), "Accept": "application/json" }
      });
      const status = await response.json().catch(() => ({}));
      if (response.ok && Number(status.gross_amount) === payment.amount &&
          (status.transaction_status === "settlement" || (status.transaction_status === "capture" && status.fraud_status === "accept"))) {
        await fulfillPaymentCredits(env, orderId, payment.amount);
      }
    }
    const latest = await getPaymentRecord(env, orderId);
    return Response.json({ orderId, status: latest?.status || "pending", packageName: payment.packageName });
  } catch (error) {
    return Response.json({ error: error.message || "Tidak dapat memeriksa pembayaran." }, { status: 502 });
  }
}
