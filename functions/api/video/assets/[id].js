import { verifyFirebaseUser } from "../../../lib/firebase.js";

export async function onRequestPut({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return Response.json({ error: "Penyimpanan media R2 belum tersedia." }, { status: 503 });
  const id = String(params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "ID aset tidak valid." }, { status: 400 });
  const mime = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!mime.startsWith("audio/")) return Response.json({ error: "Hanya file audio yang dapat disimpan melalui endpoint ini." }, { status: 415 });
  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > 100 * 1024 * 1024) return Response.json({ error: "Ukuran audio maksimal 100 MB." }, { status: 413 });
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return Response.json({ error: "File audio kosong." }, { status: 400 });
  if (bytes.byteLength > 100 * 1024 * 1024) return Response.json({ error: "Ukuran audio maksimal 100 MB." }, { status: 413 });
  await env.VIDEO_MEDIA.put(auth.user.uid + "/" + id, bytes, {
    httpMetadata: { contentType: mime, cacheControl: "private, no-store" },
    customMetadata: { uid: auth.user.uid, project: "zaida-video-studio", kind: "audio", source: request.headers.get("X-Video-Audio-Source") || "unknown" }
  });
  return Response.json({ ok: true, assetId: id, size: bytes.byteLength }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return Response.json({ error: "Penyimpanan media belum tersedia." }, { status: 503 });
  const id = String(params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "ID aset tidak valid." }, { status: 400 });
  const object = await env.VIDEO_MEDIA.get(auth.user.uid + "/" + id);
  if (!object) return Response.json({ error: "Aset media tidak ditemukan." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
