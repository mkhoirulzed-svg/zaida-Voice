import { verifyFirebaseUser } from "../../../lib/firebase.js";

function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}
function validAssetId(id) {
  return /^[0-9a-f-]{36}$/i.test(id) || /^voice-[0-9a-f-]{36}$/i.test(id);
}
export async function onRequestGet({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return jsonError("Penyimpanan media R2 belum tersedia.", 503);
  const id = String(params.id || "");
  if (!validAssetId(id)) return jsonError("ID aset tidak valid.", 400);
  const object = await env.VIDEO_MEDIA.get(auth.user.uid + "/" + id);
  if (!object) return jsonError("Aset media tidak ditemukan.", 404);
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Length": String(object.size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
}
export async function onRequestDelete({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return jsonError("Penyimpanan media R2 belum tersedia.", 503);
  const id = String(params.id || "");
  if (!validAssetId(id)) return jsonError("ID aset tidak valid.", 400);
  const key = auth.user.uid + "/" + id;
  const object = await env.VIDEO_MEDIA.head(key);
  if (!object) return jsonError("Aset media tidak ditemukan.", 404);
  await env.VIDEO_MEDIA.delete(key);
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
