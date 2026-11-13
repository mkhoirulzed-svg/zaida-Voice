const MEDIABUNNY_VERSION = "1.61.6";
let mediabunnyPromise = null;

function parseSrtCues(srt) {
  return String(srt || "").replace(/\r/g, "").trim().split(/\n\s*\n/).map(block => {
    const lines = block.split("\n");
    const timeLine = lines.find(line => line.includes("-->"));
    if (!timeLine) return null;
    const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
    if (!match) return null;
    const seconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
    return {
      start: seconds(...match.slice(1, 5)),
      end: seconds(...match.slice(5, 9)),
      text: lines.slice(lines.indexOf(timeLine) + 1).join(" ").replace(/<[^>]+>/g, "").trim()
    };
  }).filter(cue => cue && cue.text && cue.end > cue.start);
}

function imageFromScene(scene, index) {
  const source = scene.uploadedImageDataUrl || (scene.generatedImage?.b64 ? "data:" + (scene.generatedImage.mime || "image/png") + ";base64," + scene.generatedImage.b64 : "");
  if (!source) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Gambar adegan " + (index + 1) + " gagal dimuat."));
    image.src = source;
  });
}

function drawCover(ctx, image, width, height, progress, shot) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  let zoom = 1.08, dx = 0, dy = 0;
  const p = Math.max(0, Math.min(1, progress));
  if (shot === "close-up" || shot === "detail") zoom = 1.04 + p * 0.22;
  else if (shot === "wide") zoom = 1.22 - p * 0.16;
  else if (shot === "overhead") { zoom = 1.04 + p * 0.08; dy = (p - .5) * height * .025; }
  else if (shot === "split") { zoom = 1.02 + p * .06; dx = (p - .5) * width * .025; }
  else if (shot === "medium") dx = (p - .5) * width * .065;
  else dx = (.5 - p) * width * .07;
  const w = image.naturalWidth * scale * zoom;
  const h = image.naturalHeight * scale * zoom;
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  ctx.drawImage(image, (width - w) / 2 + dx, (height - h) / 2 + dy, w, h);
  ctx.restore();
}

function drawCaption(ctx, text, width, height, style = {}, time = 0, cue = null) {
  if (!text) return;
  const animation = style.animation || "static";
  const wordCues = Array.isArray(style.wordCues) ? style.wordCues.filter(word => !cue || (word.start >= cue.start && word.end <= cue.end)) : [];
  if (animation === "typewriter" && cue && wordCues.length) {
    const visible = wordCues.filter(word => word.start <= time);
    const active = wordCues.find(word => time >= word.start && time <= word.end);
    text = visible.map(word => word.text).join(" ");
    if (active) {
      const ratio = Math.max(0, Math.min(1, (time - active.start) / (active.end - active.start)));
      const count = Math.max(1, Math.ceil(active.text.length * ratio));
      text = visible.slice(0, -1).map(word => word.text).concat(active.text.slice(0, count)).join(" ");
    }
  } else if (animation === "word" && cue && wordCues.length) {
    const active = wordCues.find(word => time >= word.start && time <= word.end);
    text = active?.text || "";
  }
  const preset = style.preset || "capcut";
  const fontSize = Math.max(18, Math.min(52, Number(style.fontSize) || 28)) * (width / 720);
  const font = String(style.font || (preset === "cinematic" ? "Georgia" : "Arial")).replace(/['"]/g, "");
  const color = preset === "karaoke" ? "#ffe45e" : (style.textColor || "#ffffff");
  const outline = style.outlineColor || "#000000";
  const outlineWidth = Math.max(0, Math.min(6, Number(style.outlineWidth ?? 2))) * (width / 720);
  const background = style.background || (preset === "classic" || preset === "cinematic" ? "none" : "soft");
  const opacity = Math.max(0, Math.min(1, Number(style.backgroundOpacity ?? .76)));
  ctx.save();
  ctx.font = "700 " + fontSize + "px '" + font + "', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const maxWidth = width * .86, words = String(text).split(/\s+/), lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? line + " " + word : word;
    if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
    else line = candidate;
  }
  if (line) lines.push(line);
  while (lines.length > 3) { lines.pop(); lines[2] = lines[2].replace(/[.,;:!?]?$/, "…"); }
  const lineHeight = fontSize * 1.22, blockHeight = lines.length * lineHeight + fontSize * .9;
  const position = style.position || "bottom";
  const centerY = position === "top" ? height * .14 + blockHeight / 2 : position === "middle" ? height / 2 : height * .84 - blockHeight / 2;
  if (background !== "none") {
    ctx.fillStyle = background === "solid" ? "rgba(0,0,0,1)" : "rgba(0,0,0," + opacity + ")";
    const boxWidth = Math.min(maxWidth + fontSize * .8, width * .94);
    ctx.beginPath(); ctx.roundRect((width - boxWidth) / 2, centerY - blockHeight / 2, boxWidth, blockHeight, fontSize * .35); ctx.fill();
  }
  ctx.lineJoin = "round"; ctx.lineWidth = outlineWidth * 2; ctx.strokeStyle = outline; ctx.fillStyle = color;
  const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((value, i) => {
    if (outlineWidth) ctx.strokeText(value, width / 2, firstY + i * lineHeight, maxWidth);
    ctx.fillText(value, width / 2, firstY + i * lineHeight, maxWidth);
    if (animation === "karaoke" && cue && wordCues.length) {
      const active = wordCues.find(word => time >= word.start && time <= word.end);
      if (active && value.includes(active.text)) {
        const before = value.slice(0, value.indexOf(active.text));
        const activeWidth = ctx.measureText(active.text).width;
        const beforeWidth = ctx.measureText(before).width;
        const lineWidth = ctx.measureText(value).width;
        const x = (width - lineWidth) / 2 + beforeWidth;
        ctx.save(); ctx.fillStyle = "#ffe45e";
        ctx.fillText(active.text, x + activeWidth / 2, firstY + i * lineHeight);
        ctx.restore();
      }
    }
  });
  ctx.restore();
}

export async function renderVideo({ scenes, audioFile, audioDuration = null, subtitleText = "", burnCaptions = false, captionStyle = {}, format = "9:16", onProgress = () => {} }) {
  if (!Array.isArray(scenes) || scenes.length < 2) throw new Error("Storyboard belum memiliki cukup adegan.");
  if (!["9:16", "16:9"].includes(format)) throw new Error("Pilih format video terlebih dahulu.");
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("Browser ini belum mendukung WebCodecs untuk ekspor MP4 langsung. Coba Chrome versi terbaru.");
  }
  onProgress({ phase: "loading", message: "Memuat mesin ekspor MP4…" });
  if (!mediabunnyPromise) mediabunnyPromise = import("https://esm.sh/mediabunny@" + MEDIABUNNY_VERSION);
  const mb = await mediabunnyPromise;
  const portrait = format === "9:16", width = portrait ? 720 : 1280, height = portrait ? 1280 : 720, fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Browser tidak dapat membuat kanvas video.");

  const images = await Promise.all(scenes.map(imageFromScene));
  const baseDurations = scenes.map(scene => Math.max(0.8, Math.min(40, Number(scene.estimated_seconds) || 6)));
  const sceneTotal = baseDurations.reduce((a, b) => a + b, 0);
  let audioContext = null, audioBuffer = null, output = null, videoSource = null, audioSource = null;
  try {
    if (audioFile) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioBuffer = await audioContext.decodeAudioData(await audioFile.arrayBuffer());
    }
    const totalDuration = audioBuffer?.duration || (Number(audioDuration) > 0 ? Number(audioDuration) : sceneTotal);
    if (!Number.isFinite(totalDuration) || totalDuration <= 0) throw new Error("Durasi video tidak valid.");
    const durations = baseDurations.map(value => value / sceneTotal * totalDuration);
    const cues = burnCaptions ? parseSrtCues(subtitleText).filter(c => c.start < totalDuration) : [];
    output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target: new mb.BufferTarget() });
    videoSource = new mb.CanvasSource(canvas, { codec: "avc", quality: new mb.Quality("high") });
    output.addVideoTrack(videoSource, { frameRate: fps });
    if (audioBuffer) {
      audioSource = new mb.AudioBufferSource({ codec: "aac", quality: new mb.Quality("high") });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    if (audioSource) await audioSource.add(audioBuffer);

    const totalFrames = Math.ceil(totalDuration * fps);
    let sceneIndex = 0, sceneStart = 0;
    for (let frame = 0; frame < totalFrames; frame++) {
      const time = frame / fps;
      while (sceneIndex < scenes.length - 1 && time >= sceneStart + durations[sceneIndex]) {
        sceneStart += durations[sceneIndex]; sceneIndex++;
      }
      const scene = scenes[sceneIndex];
      ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, width, height);
      if (images[sceneIndex]) drawCover(ctx, images[sceneIndex], width, height, (time - sceneStart) / durations[sceneIndex], scene.shot || scene.cameraShot || "medium");
      else {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#172554"); gradient.addColorStop(1, "#111827");
        ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "700 " + Math.round(width * .045) + "px Arial";
        ctx.fillText(scene.title || ("Adegan " + (sceneIndex + 1)), width / 2, height / 2, width * .82);
      }
      const cue = cues.find(item => time >= item.start && time <= item.end);
      if (cue) drawCaption(ctx, cue.text, width, height, captionStyle, time, cue);
      await videoSource.add(time, Math.min(1 / fps, totalDuration - time));
      if (frame % 30 === 0 || frame === totalFrames - 1) {
        const progress = (frame + 1) / totalFrames;
        onProgress({ phase: "rendering", progress, message: "Merender MP4 langsung dari timeline… " + Math.round(progress * 100) + "%", format });
      }
    }
    videoSource.close(); if (audioSource) audioSource.close();
    await output.finalize();
    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Mesin ekspor tidak menghasilkan file MP4.");
    const blob = new Blob([buffer], { type: "video/mp4" });
    onProgress({ phase: "complete", message: "Video " + format + " selesai dibuat." });
    return { format, blob, filename: portrait ? "zaida-video-vertikal.mp4" : "zaida-video-horizontal.mp4" };
  } finally {
    try { videoSource?.close(); } catch {}
    try { audioSource?.close(); } catch {}
    if (audioContext) try { await audioContext.close(); } catch {}
  }
}
