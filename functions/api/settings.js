import { verifyFirebaseUser, getUserStudioSettings, saveUserStudioSettings } from "../lib/firebase.js";

function normalizeSettings(input = {}) {
  const allowedLengths = new Set([
    "singkat, sekitar 30 detik",
    "sekitar 1 menit",
    "sekitar 3 menit",
    "panjang, sekitar 5 menit",
    "fleksibel sesuai kebutuhan"
  ]);
  return {
    includeSubtitle: input.includeSubtitle === true,
    includeMetadataTags: input.includeMetadataTags === true,
    writerLength: allowedLengths.has(input.writerLength) ? input.writerLength : "fleksibel sesuai kebutuhan"
  };
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  try {
    return Response.json({ settings: normalizeSettings(await getUserStudioSettings(auth.user, env)) });
  } catch (error) {
    return Response.json({ error: error.message || "Gagal memuat pengaturan." }, { status: error.status || 500 });
  }
}

export async function onRequestPut({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  let body;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Format data tidak valid." }, { status: 400 }); }
  if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
    return Response.json({ error: "Data pengaturan tidak valid." }, { status: 400 });
  }
  try {
    const settings = normalizeSettings(body.settings);
    await saveUserStudioSettings(auth.user, env, settings);
    return Response.json({ ok: true, settings });
  } catch (error) {
    return Response.json({ error: error.message || "Gagal menyimpan pengaturan." }, { status: error.status || 500 });
  }
}
