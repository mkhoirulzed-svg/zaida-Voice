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

    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@" + CORE_VERSION + "/dist/esm";
    // This app uses a module worker, so load the ESM core build. The UMD build
    // does not expose the default factory expected by the worker import fallback.
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

function parseSrtCues(srt) {
  return String(srt || "").replace(/\r/g, "").trim().split(/\n\s*\n/).map(block => {
    const lines = block.split("\n");
    const timeLine = lines.find(line => line.includes("-->"));
    if (!timeLine) return null;
    const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return null;
    const toSeconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    const text = lines.slice(lines.indexOf(timeLine) + 1).join(" ").replace(/<[^>]+>/g, "").trim();
    if (!text) return null;
    return { start: toSeconds(...match.slice(1, 5)), end: toSeconds(...match.slice(5, 9)), text };
  }).filter(cue => cue && cue.end > cue.start);
}

async function makeCaptionOverlayPng(text, width) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * 0.9);
  canvas.height = width === 720 ? 174 : 190;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Browser tidak dapat membuat gambar caption.");
  const fontSize = width === 720 ? 27 : 32;
  const lineHeight = fontSize * 1.22;
  ctx.font = "700 " + fontSize + "px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const maxTextWidth = canvas.width - 48;
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && ctx.measureText(candidate).width > maxTextWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  while (lines.length > 3) {
    lines.pop();
    lines[2] = lines[2].replace(/[.,;:!?]?$/, "…");
  }
  const blockHeight = lines.length * lineHeight + 34;
  const top = (canvas.height - blockHeight) / 2;
  ctx.fillStyle = "rgba(0,0,0,0.76)";
  ctx.beginPath();
  ctx.roundRect(8, top, canvas.width - 16, blockHeight, 18);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.9)";
  ctx.fillStyle = "#ffffff";
  const firstY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((value, index) => {
    ctx.strokeText(value, canvas.width / 2, firstY + index * lineHeight, maxTextWidth);
    ctx.fillText(value, canvas.width / 2, firstY + index * lineHeight, maxTextWidth);
  });
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Gagal membuat gambar caption.");
  return new Uint8Array(await blob.arrayBuffer());
}

async function renderFormat(ffmpeg, scenes, audioBytes, subtitleText, format, onProgress, audioDuration = null, burnCaptions = false) {
  const isPortrait = format === "9:16";
  const width = isPortrait ? 720 : 1280;
  const height = isPortrait ? 1280 : 720;
  const outputName = "zaida-video-" + (isPortrait ? "9x16" : "16x9") + ".mp4";
  const inputNames = [];
  const sceneDuration = scenes.reduce((sum, scene) => sum + Math.max(2, Math.min(40, Number(scene.estimated_seconds) || 6)), 0);
  const totalSeconds = Number.isFinite(Number(audioDuration)) && Number(audioDuration) > 0 ? Number(audioDuration) : sceneDuration;
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
      if (burnCaptions) {
        const cues = parseSrtCues(subtitleText);
        for (let i = 0; i < cues.length; i++) {
          const name = "zaida_caption_" + i + ".png";
          const png = await makeCaptionOverlayPng(cues[i].text, width);
          await ffmpeg.writeFile(name, png);
          inputNames.push(name);
          args.push("-loop", "1", "-framerate", "24", "-t", String(totalSeconds), "-i", name);
          cues[i].inputIndex = nextInput++;
        }
        if (cues.length) {
          const graph = [
            "[0:v]scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1[base0]"
          ];
          cues.forEach((cue, i) => {
            const next = "base" + (i + 1);
            const start = Math.max(0, cue.start).toFixed(3);
            const end = Math.min(totalSeconds, cue.end).toFixed(3);
            graph.push("[base" + i + "][" + cue.inputIndex + ":v]overlay=x=(W-w)/2:y=H-h-" + (width === 720 ? 72 : 48) + ":eof_action=pass:enable='between(t," + start + "," + end + ")'[" + next + "]");
          });
          args.push("-filter_complex", graph.join(";"), "-map", "[base" + cues.length + "]");
        } else {
          args.push("-map", "0:v:0", "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1");
        }
      } else {
        await ffmpeg.writeFile("zaida_subtitles.srt", new TextEncoder().encode(subtitleText));
        inputNames.push("zaida_subtitles.srt");
        args.push("-i", "zaida_subtitles.srt");
        subtitleInput = nextInput++;
        args.push("-map", "0:v:0", "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1");
      }
    } else {
      args.push("-map", "0:v:0", "-vf", "scale=" + width + ":" + height + ":force_original_aspect_ratio=increase,crop=" + width + ":" + height + ",setsar=1");
    }
    args.push("-r", "24", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart");
    if (audioInput !== null) args.push("-map", audioInput + ":a:0", "-c:a", "aac", "-b:a", "96k");
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

export async function renderVideo({ scenes, audioFile, audioDuration = null, subtitleText = "", burnCaptions = false, format = "9:16", onProgress = () => {} }) {
  if (!Array.isArray(scenes) || scenes.length < 2) throw new Error("Storyboard belum memiliki cukup adegan.");
  if (!["9:16", "16:9"].includes(format)) throw new Error("Pilih format video terlebih dahulu.");
  if (typeof WebAssembly === "undefined") throw new Error("Browser ini belum mendukung WebAssembly.");
  const ffmpeg = await loadFFmpeg(onProgress);
  const audioBytes = audioFile ? new Uint8Array(await audioFile.arrayBuffer()) : null;
  const blob = await renderFormat(ffmpeg, scenes, audioBytes, subtitleText, format, onProgress, audioDuration, burnCaptions);
  onProgress({ phase: "complete", message: "Video " + format + " selesai dibuat." });
  return { format, blob, filename: format === "9:16" ? "zaida-video-vertikal.mp4" : "zaida-video-horizontal.mp4" };
}
