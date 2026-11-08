/* ZAIDA Video Editor V2 — progressive UI layer. Existing video logic/API remains untouched. */
(() => {
  const body = document.body;
  const page = document.getElementById("videoStudioPage");
  if (!page || page.dataset.editorV2Ready) return;
  page.dataset.editorV2Ready = "true";

  const heading = page.querySelector(".video-heading");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "video-v2-toggle";
  toggle.id = "videoEditorV2Toggle";
  toggle.setAttribute("aria-pressed", "false");
  toggle.innerHTML = '<span aria-hidden="true">✦</span> Coba editor baru';
  heading.append(toggle);

  const sections = [
    { id: "videoTopic", label: "Konsep" },
    { id: "storyboardResult", label: "Storyboard" },
    { id: "captionEditorPanel", label: "Caption" },
    { id: "videoRenderPanel", label: "Preview & ekspor" }
  ];
  const nav = document.createElement("nav");
  nav.className = "video-v2-steps";
  nav.setAttribute("aria-label", "Tahapan editor video");
  nav.innerHTML = sections.map((s, i) => '<button type="button" data-target="' + s.id + '"><span>' + (i + 1) + '</span>' + s.label + '</button>').join("");
  page.insertBefore(nav, layout);

  const setMode = enabled => {
    body.classList.toggle("video-editor-v2", enabled);
    toggle.setAttribute("aria-pressed", String(enabled));
    toggle.innerHTML = enabled ? '<span aria-hidden="true">↩</span> Kembali ke tampilan lama' : '<span aria-hidden="true">✦</span> Coba editor baru';
    try { localStorage.setItem("zaida-video-editor-mode", enabled ? "v2" : "classic"); } catch {}
    if (enabled) updateSteps();
  };
  toggle.addEventListener("click", () => setMode(!body.classList.contains("video-editor-v2")));
  nav.addEventListener("click", event => {
    const button = event.target.closest("button[data-target]");
    if (!button) return;
    const target = document.getElementById(button.dataset.target);
    (target || document.getElementById("videoTopic"))?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function updateSteps() {
    const hasBoard = !document.getElementById("storyboardResult").hidden;
    const player = document.getElementById("videoPreviewPlayer");
    const hasPreview = Boolean(player.currentSrc || player.src);
    nav.querySelectorAll("button").forEach((button, index) => {
      const done = index === 0 ? Boolean(document.getElementById("videoTopic").value.trim()) :
        index === 1 ? hasBoard : index === 2 ? hasPreview : false;
      button.classList.toggle("is-done", done);
    });
  }
  new MutationObserver(updateSteps).observe(document.getElementById("storyboardResult"), { attributes: true, attributeFilter: ["hidden"] });
  ["videoTopic", "videoPreviewPlayer"].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener(id === "videoTopic" ? "input" : "loadedmetadata", updateSteps);
  });
  document.getElementById("generateStoryboard")?.addEventListener("click", () => setTimeout(updateSteps, 300));
  document.getElementById("renderDualVideo")?.addEventListener("click", () => setTimeout(updateSteps, 500));
  document.getElementById("exportFinalVideo")?.addEventListener("click", updateSteps);

  try { if (localStorage.getItem("zaida-video-editor-mode") === "v2") setMode(true); } catch {}
})();
