const FFMPEG_VERSION = "0.12.10";
const CORE_VERSION = "0.12.6";

let ffmpegInstance = null;
let loadPromise = null;

async function loadFFmpeg(onProgress = () => {}) {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress({ phase: "loading", message: "Memuat mesin render video…" });
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@" + FFMPEG_VERSION + "/dist/esm/index.js"),
      import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.2/dist/esm/index.js")
    ]);
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      onProgress({ phase: "rendering", progress: Math.max(0, Math.min(1, progress)) });
    });
    ffmpeg.on("log", ({ message }) => {
      if (/error/i.test(message)) onProgress({ phase: "log", message: message.slice(0, 180) });
    });

    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + CORE_VERSION + "/dist/umd";
    const coreURL = await toBlobURL(base + "/ffmpeg-core.js", "text/javascript");
    const wasmURL = await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm");
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
  })();

  try { return await loadPromise; }
  catch (error) { loadPromise = null; throw error; }
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safeExtension(mime) {
  return String(mime || "").includes("jpeg") || String(mime || "").includes("jpg") ? "jpg" : "png";
}

async function renderFormat(ffmpeg, scenes, audioBytes, format, onProgress) {
  const isPortrait = format === "9:16";
  const width = isPortrait ? 720 : 1280;
  const height = isPortrait ? 1280 : 720;
  const listName = "zaida_concat_" + (isPortrait ? "portrait" : "landscape") + ".txt";
  const outputName = "zaida-video-" + (isPortrait ? "9x16" : "16x9") + ".mp4";
  const inputNames = [];

  try {
    const concatLines = [];
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const ext = safeExtension(scene.generatedImage.mime);
      const name = "zaida_scene_" + i + "." + ext;
      inputNames.push(name);
      await ffmpeg.writeFile(name, base64ToBytes(scene.generatedImage.b64));
      concatLines.push("file '" + name + "'");
      concatLines.push("duration " + Math.max(2, Math.min(40, Number(scene.estimated_seconds) || 6)).toFixed(2));
    }
    concatLines.push("file '" + inputNames[inputNames.length - 1] + "'");
    await ffmpeg.writeFile(listName, new TextEncoder().encode(concatLines.join("\n")));

    const args = [
      "-f", "concat", "-safe", "0", "-i", listName
    ];
    if (audioBytes) {
      await ffmpeg.writeFile("zaida_narration_audio", audioBytes);
      args.push("-i", "zaida_narration_audio");
    }
    args.push(
      "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1",
      "-r", "24", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart"
    );
    if (audioBytes) {
      args.push("-map", "0:v:0", "-map", "1:a:0", "-af", "apad", "-c:a", "aac", "-b:a", "96k");
    } else {
      args.push("-an");
    }
    const totalSeconds = scenes.reduce((sum, scene) => sum + Math.max(2, Math.min(40, Number(scene.estimated_seconds) || 6)), 0);
    args.push("-t", String(totalSeconds), "-y", outputName);
    onProgress({ phase: "rendering", message: "Merender format " + format + "…", format });
    await ffmpeg.exec(args);
    const output = await ffmpeg.readFile(outputName);
    return new Blob([output], { type: "video/mp4" });
  } finally {
    for (const name of [...inputNames, listName, outputName, "zaida_narration_audio"]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

export async function renderDualVideo({ scenes, audioFile, onProgress = () => {} }) {
  if (!Array.isArray(scenes) || scenes.length < 2) throw new Error("Storyboard belum memiliki cukup adegan.");
  const missing = scenes.findIndex(scene => !scene.generatedImage?.b64);
  if (missing !== -1) throw new Error("Gambar adegan " + (missing + 1) + " belum dibuat.");
  if (typeof WebAssembly === "undefined") throw new Error("Browser ini belum mendukung WebAssembly.");

  const ffmpeg = await loadFFmpeg(onProgress);
  const audioBytes = audioFile ? new Uint8Array(await audioFile.arrayBuffer()) : null;
  const results = [];

  for (const format of ["9:16", "16:9"]) {
    const blob = await renderFormat(ffmpeg, scenes, audioBytes, format, onProgress);
    results.push({ format, blob, filename: format === "9:16" ? "zaida-video-vertikal.mp4" : "zaida-video-horizontal.mp4" });
  }
  onProgress({ phase: "complete", message: "Kedua format video selesai dibuat." });
  return results;
}
