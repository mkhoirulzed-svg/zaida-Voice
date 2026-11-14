import { verifyFirebaseUser } from "../../../lib/firebase.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return Response.json({ error: "Penyimpanan media belum tersedia." }, { status: 503 });
  const id = String(params.id || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "ID aset tidak valid." }, { status: 400 });
  const object = await env.VIDEO_MEDIA.get(auth.user.uid + "/" + id);
  if (!object) return Response.json({ error: "Aset gambar tidak ditemukan." }, { status: 404 });
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
