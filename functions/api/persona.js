import { verifyFirebaseUser, getUserPersonaProfile, saveUserPersonaProfile } from "../lib/firebase.js";

const allowedTopics = new Set(["olahraga","politik","komedi","pendidikan","teknologi","bisnis","kesehatan","cerita","hiburan","sejarah","iklan"]);
const clean = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
function normalizeProfile(input = {}) {
  const interests = Array.isArray(input.interests) ? [...new Set(input.interests.filter(x => allowedTopics.has(x)))].slice(0, 11) : [];
  return { persona: clean(input.persona, 80), interests, style: clean(input.style, 100) || "santai dan akrab", emotion: clean(input.emotion, 100) || "natural dan netral", audience: clean(input.audience, 120), length: clean(input.length, 100) || "fleksibel sesuai kebutuhan" };
}
export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env); if (auth.error) return auth.error;
  try { return Response.json({ profile: await getUserPersonaProfile(auth.user, env) }); }
  catch (error) { return Response.json({ error: error.message || "Gagal memuat persona." }, { status: error.status || 500 }); }
}
export async function onRequestPut({ request, env }) {
  const auth = await verifyFirebaseUser(request, env); if (auth.error) return auth.error;
  let body; try { body = await request.json(); } catch { return Response.json({ error: "Format data tidak valid." }, { status: 400 }); }
  if (!body.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) return Response.json({ error: "Data persona tidak valid." }, { status: 400 });
  try { const profile = normalizeProfile(body.profile); await saveUserPersonaProfile(auth.user, env, profile); return Response.json({ ok: true, profile }); }
  catch (error) { return Response.json({ error: error.message || "Gagal menyimpan persona." }, { status: error.status || 500 }); }
}
