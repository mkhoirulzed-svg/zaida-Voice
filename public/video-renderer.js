const FFMPEG_VERSION = "0.12.10";
const CORE_VERSION = "0.12.10";

let ffmpegInstance = null;
let loadPromise = null;
let recentFFmpegLogs = [];

async function loadFFmpeg(onProgress = () => {}) {
  if (ffmpegInstance?.loaded) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    onProgress({ phase: "loading", message: "Memuat mesin render video…" });
    const { FFmpeg } = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@" + FFMPEG_VERSION + "/dist/esm/index.js");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      onProgress({ phase: "rendering", progress: Math.max(0, Math.min(1, progress)) });
    });
    recentFFmpegLogs = [];
    ffmpeg.on("log", ({ message }) => {
      const line = String(message || "").trim();
      if (!line) return;
      recentFFmpegLogs.push(line);
      if (recentFFmpegLogs.length > 30) recentFFmpegLogs.shift();
      onProgress({ phase: "log", message: line.slice(0, 240) });
    });

    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + CORE_VERSION + "/dist/umd";
    // Keep core assets on their original HTTPS origin. Blob URLs can fail when
    // the FFmpeg module worker dynamically imports ffmpeg-core.js.
    const coreURL = base + "/ffmpeg-core.js";
    const wasmURL = base + "/ffmpeg-core.wasm";
    const classWorkerURL = new URL("/ffmpeg/worker.js", window.location.origin).href;
    onProgress({ phase: "loading", message: "Memuat FFmpeg Core " + CORE_VERSION + "…" });
    await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
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

async function renderFormat(ffmpeg, scenes, audioBytes, subtitleText, format, onProgress) {
  const isPortrait = format === "9:16";
  const width = isPortrait ? 720 : 1280;
  const height = isPortrait ? 1280 : 720;
  const outputName = "zaida-video-" + (isPortrait ? "9x16" : "16x9") + ".mp4";
  const inputNames = [];
  const totalSeconds = scenes.reduce((sum, scene) => sum + Math.max(2, Math.min(40, Number(scene.estimated_seconds) || 6)), 0);
  const hasAllImages = scenes.every(scene => Boolean(scene.generatedImage?.b64));
  try {
    let args;
    if (hasAllImages) {
      const listName = "zaida_concat_" + (isPortrait ? "portrait" : "landscape") + ".txt";
      const concatLines = [];
      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i], ext = safeExtension(scene.generatedImage.mime);
        const name = "zaida_scene_" + i + "." + ext;
        inputNames.push(name);
        await ffmpeg.writeFile(name, base64ToBytes(scene.generatedImage.b64));
        concatLines.push("file '" + name + "'");
        concatLines.push("duration " + Math.max(2, Math.min(40, Number(scene.estimated_seconds) || 6)).toFixed(2));
      }
      concatLines.push("file '" + inputNames[inputNames.length - 1] + "'");
      await ffmpeg.writeFile(listName, new TextEncoder().encode(concatLines.join("\n")));
      inputNames.push(listName);
      args = ["-f", "concat", "-safe", "0", "-i", listName];
    } else {
      // Mode tanpa gambar AI: FFmpeg membuat kanvas video langsung dari sumber lavfi.
      args = ["-f", "lavfi", "-i", "color=c=0x111827:s=" + width + "x" + height + ":r=24:d=" + totalSeconds];
    }

    let nextInput = 1, audioInput = null, subtitleInput = null;
    if (audioBytes) {
      await ffmpeg.writeFile("zaida_narration_audio.mp3", audioBytes);
      inputNames.push("zaida_narration_audio.mp3");
      args.push("-i", "zaida_narration_audio.mp3");
      audioInput = nextInput++;
    }
    if (subtitleText && subtitleText.trim()) {
      await ffmpeg.writeFile("zaida_subtitles.srt", new TextEncoder().encode(subtitleText));
      inputNames.push("zaida_subtitles.srt");
      args.push("-i", "zaida_subtitles.srt");
      subtitleInput = nextInput++;
    }
    args.push(
      "-map", "0:v:0",
      "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1",
      "-r", "24", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart"
    );
    if (audioInput !== null) args.push("-map", audioInput + ":a:0", "-af", "apad", "-c:a", "aac", "-b:a", "96k");
    else args.push("-an");
    if (subtitleInput !== null) args.push("-map", subtitleInput + ":s:0", "-c:s", "mov_text", "-metadata:s:s:0", "language=ind");
    args.push("-t", String(totalSeconds), "-y", outputName);
    onProgress({ phase: "rendering", message: hasAllImages ? "Merender video dari gambar adegan…" : "Membuat video dasar langsung dengan FFmpeg…", format });
    const exitCode = await ffmpeg.exec(args);
    if (exitCode !== 0) {
      const details = recentFFmpegLogs.slice(-8).join("\n");
      throw new Error("FFmpeg berhenti dengan kode " + exitCode + (details ? ". Log terakhir: " + details : ". Tidak ada log FFmpeg."));
    }
    const output = await ffmpeg.readFile(outputName);
    if (!output || !output.length) throw new Error("FFmpeg selesai tetapi file MP4 kosong. Log: " + recentFFmpegLogs.slice(-8).join("\n"));
    return new Blob([output], { type: "video/mp4" });
  } finally {
    for (const name of [...inputNames, outputName]) {
      try { await ffmpeg.deleteFile(name); } catch {}
    }
  }
}

export async function renderVideo({ scenes, audioFile, subtitleText = "", format = "9:16", onProgress = () => {} }) {
  if (!Array.isArray(scenes) || scenes.length < 2) throw new Error("Storyboard belum memiliki cukup adegan.");
  if (!["9:16", "16:9"].includes(format)) throw new Error("Pilih format video terlebih dahulu.");
  if (typeof WebAssembly === "undefined") throw new Error("Browser ini belum mendukung WebAssembly.");
  const ffmpeg = await loadFFmpeg(onProgress);
  const audioBytes = audioFile ? new Uint8Array(await audioFile.arrayBuffer()) : null;
  const blob = await renderFormat(ffmpeg, scenes, audioBytes, subtitleText, format, onProgress);
  onProgress({ phase: "complete", message: "Video " + format + " selesai dibuat." });
  return { format, blob, filename: format === "9:16" ? "zaida-video-vertikal.mp4" : "zaida-video-horizontal.mp4" };
}
