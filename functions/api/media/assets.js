import { verifyFirebaseUser } from "../../lib/firebase.js";

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_PREFIXES = ["image/", "video/", "audio/"];

function jsonError(message, status = 400) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function mediaKind(contentType = "") {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "other";
}

export async function onRequestGet({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return jsonError("Penyimpanan media R2 belum tersedia.", 503);

  const prefix = auth.user.uid + "/";
  const assets = [];
  let cursor;
  let pages = 0;
  do {
    const result = await env.VIDEO_MEDIA.list({ prefix, limit: 1000, cursor });
    for (const object of result.objects || []) {
      const assetId = object.key.slice(prefix.length);
      if (!assetId || assetId.includes("/")) continue;
      const contentType = object.httpMetadata?.contentType || "application/octet-stream";
      const kind = mediaKind(contentType);
      if (kind === "other") continue;
      assets.push({
        id: assetId,
        kind,
        contentType,
        size: object.size,
        uploadedAt: object.uploaded ? object.uploaded.toISOString() : null,
        name: object.customMetadata?.fileName || assetId,
        source: object.customMetadata?.source || object.customMetadata?.project || "ZAIDA"
      });
    }
    cursor = result.truncated ? result.cursor : undefined;
    pages += 1;
  } while (cursor && pages < 5);

  assets.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || ""));
  return Response.json({ assets, hasMore: Boolean(cursor) }, { headers: { "Cache-Control": "no-store" } });
}

export async function onRequestPost({ request, env }) {
  const auth = await verifyFirebaseUser(request, env);
  if (auth.error) return auth.error;
  if (!env.VIDEO_MEDIA) return jsonError("Penyimpanan media R2 belum tersedia.", 503);

  const contentType = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_PREFIXES.some(prefix => contentType.startsWith(prefix))) return jsonError("Format yang didukung: gambar, video, dan audio.", 415);
  const declaredSize = Number(request.headers.get("Content-Length") || 0);
  if (declaredSize > MAX_FILE_SIZE) return jsonError("Ukuran file maksimal 100 MB.", 413);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength) return jsonError("File kosong.", 400);
  if (bytes.byteLength > MAX_FILE_SIZE) return jsonError("Ukuran file maksimal 100 MB.", 413);

  const id = crypto.randomUUID();
  const rawName = request.headers.get("X-File-Name") || "media";
  let fileName = "media";
  try { fileName = decodeURIComponent(rawName).replace(/[\\/\\0-\\x1f]/g, "").slice(0, 120) || "media"; } catch {}
  await env.VIDEO_MEDIA.put(auth.user.uid + "/" + id, bytes, {
    httpMetadata: { contentType, cacheControl: "private, no-store" },
    customMetadata: { uid: auth.user.uid, project: "zaida-media-library", kind: mediaKind(contentType), source: "media-library-upload", fileName }
  });
  return Response.json({ ok: true, asset: { id, kind: mediaKind(contentType), contentType, size: bytes.byteLength, name: fileName, uploadedAt: new Date().toISOString(), source: "media-library-upload" } }, { headers: { "Cache-Control": "no-store" } });
}
