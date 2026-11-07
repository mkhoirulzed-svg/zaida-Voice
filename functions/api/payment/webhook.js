import { getPaymentRecord, fulfillPaymentCredits } from "../../lib/firebase.js";

async function sha512(value) {
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost({ request, env }) {
  const serverKey = String(env.MIDTRANS_SERVER_KEY || "").trim();
  if (!serverKey) return Response.json({ error: "Server key belum dikonfigurasi." }, { status: 503 });
  let notice;
  try { notice = await request.json(); } catch { return Response.json({ error: "Invalid notification." }, { status: 400 }); }
  const { order_id: orderId, status_code: statusCode, gross_amount: grossAmount, signature_key: signature } = notice || {};
  if (!orderId || !statusCode || !grossAmount || !signature) return Response.json({ error: "Incomplete notification." }, { status: 400 });
  const expected = await sha512(String(orderId) + String(statusCode) + String(grossAmount) + serverKey);
  if (expected !== String(signature).toLowerCase()) return Response.json({ error: "Invalid signature." }, { status: 401 });

  try {
    const payment = await getPaymentRecord(env, orderId);
    if (!payment) return Response.json({ error: "Order not found." }, { status: 404 });
    const statusResponse = await fetch("https://api.sandbox.midtrans.com/v2/" + encodeURIComponent(orderId) + "/status", {
      headers: { "Authorization": "Basic " + btoa(serverKey + ":"), "Accept": "application/json" }
    });
    const status = await statusResponse.json().catch(() => ({}));
    if (!statusResponse.ok) return Response.json({ error: "Could not verify transaction status." }, { status: 502 });
    if (Number(status.gross_amount) !== payment.amount) return Response.json({ error: "Payment amount mismatch." }, { status: 400 });
    const isSettled = status.transaction_status === "settlement";
    const isCaptured = status.transaction_status === "capture" && status.fraud_status === "accept";
    if (isSettled || isCaptured) {
      await fulfillPaymentCredits(env, orderId, payment.amount);
    }
    return Response.json({ received: true });
  } catch (error) {
    return Response.json({ error: error.message || "Notification processing failed." }, { status: 500 });
  }
}
