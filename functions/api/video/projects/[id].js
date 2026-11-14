import { verifyFirebaseUser, getVideoProject, saveVideoProject, deleteVideoProject } from "../../../lib/firebase.js";

export async function onRequestGet({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try { return Response.json({ project: await getVideoProject(auth.user, env, params.id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error.message || "Gagal memuat proyek." }, { status: error.status || 500 }); }
}
export async function onRequestPut({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Format data tidak valid." }, { status: 400 }); }
  if (!body || typeof body !== "object" || !body.payload || typeof body.payload !== "object" || Array.isArray(body.payload)) return Response.json({ error: "Data proyek tidak valid." }, { status: 400 });
  try {
    const project = await saveVideoProject(auth.user, env, { ...body, id: params.id });
    return Response.json({ ok: true, project });
  } catch (error) { return Response.json({ error: error.message || "Gagal memperbarui proyek." }, { status: error.status || 500 }); }
}
export async function onRequestDelete({ request, env, params }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try { await deleteVideoProject(auth.user, env, params.id); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error.message || "Gagal menghapus proyek." }, { status: error.status || 500 }); }
}
