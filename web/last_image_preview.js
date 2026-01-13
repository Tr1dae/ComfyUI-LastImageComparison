import { app } from "../../scripts/app.js";

const STORAGE_KEY_PREFIX = "comfy_last_image_";
const MODE_SPLIT = "split";
const MODE_SIDEBYSIDE = "side-by-side";
const MODE_TOGGLE = "toggle";

const COMPARISON_MODES = [
  { value: MODE_SPLIT, label: "Split (draggable)" },
  { value: MODE_SIDEBYSIDE, label: "Side-by-side" },
  { value: MODE_TOGGLE, label: "A/B toggle" },
];

const STYLE = `
.lei-last-image-root {
  font-family: var(--font-family, "Segoe UI", sans-serif);
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  color: #f5f5f5;
  height: 100%;
  width: 100%;
  min-height: 0;
  min-width: 0;
}
.lei-last-image-canvas-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 6px;
  overflow: hidden;
  background: #05070d;
  border: 1px solid rgba(255, 255, 255, 0.08);
  flex: 1;
  min-height: 160px;
  display: flex;
  align-items: stretch;
  min-width: 0;
  contain: layout style paint;
}
.lei-last-image-canvas-wrapper.lei-split-mode {
  cursor: ew-resize;
}
.lei-last-image-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.lei-last-image-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  justify-content: center;
  align-items: center;
  text-align: center;
  font-size: 12px;
  padding: 0.5rem;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.75));
  color: #c0c0c0;
  pointer-events: none;
}
.lei-mode-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.lei-mode-row label {
  font-size: 12px;
  color: #b9b9b9;
  flex-shrink: 0;
}
.lei-mode-row select {
  flex: 1;
  background: #121425;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  padding: 3px 6px;
  color: #fff;
  font-size: 12px;
}
.lei-toggle-button,
.lei-action-button {
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: #1f2230;
  color: #fff;
  padding: 4px 10px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
.lei-toggle-button:hover:not(:disabled),
.lei-action-button:hover:not(:disabled) {
  background: #2d3146;
  border-color: rgba(255, 255, 255, 0.35);
}
.lei-toggle-button:disabled,
.lei-action-button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.lei-action-row {
  display: flex;
  gap: 0.4rem;
}
.lei-status-line {
  font-size: 11px;
  color: #9ba3c0;
  min-height: 18px;
}
`;

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected) {
    return;
  }
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.appendChild(style);
  stylesInjected = true;
}

function makeStorageKey(nodeId) {
  return `${STORAGE_KEY_PREFIX}${nodeId}`;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function registerListener(state, target, type, handler, options) {
  target.addEventListener(type, handler, options);
  state.listeners.push({ target, type, handler, options });
}

function createImageEntry(payload, onReady) {
  if (!payload || !payload.base64) {
    return null;
  }

  const format = (payload.format ?? "PNG").toUpperCase();
  const mime = payload.mime ?? `image/${format.toLowerCase()}`;
  const src = `data:${mime};base64,${payload.base64}`;
  const img = new Image();
  const entry = {
    data: { base64: payload.base64, mime, format },
    img,
    loaded: false,
    error: false,
    width: 0,
    height: 0,
  };

  const handleLoad = () => {
    if (entry.loaded) {
      return;
    }
    entry.loaded = true;
    entry.width = img.naturalWidth;
    entry.height = img.naturalHeight;
    onReady?.();
  };

  const handleError = () => {
    entry.error = true;
    onReady?.();
  };

  img.onload = handleLoad;
  img.onerror = handleError;
  img.src = src;

  if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
    handleLoad();
  }

  return entry;
}

function scheduleRender(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }
  if (state.renderFrameRequest) {
    return;
  }
  state.renderFrameRequest = requestAnimationFrame(() => {
    state.renderFrameRequest = null;
    renderPreview(node);
  });
}


// Debounced version for resize events to prevent excessive renders
function scheduleDebouncedRender(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }

  // Clear any existing timeout
  if (state.resizeTimeout) {
    clearTimeout(state.resizeTimeout);
  }

  // Debounce resize events by 100ms
  state.resizeTimeout = setTimeout(() => {
    state.resizeTimeout = null;
    scheduleRender(node);
  }, 100);
}

function drawImageInBox(ctx, entry, x, y, width, height) {
  if (!entry || !entry.loaded || !ctx) {
    return;
  }

  const img = entry.img;
  if (!img.naturalWidth || !img.naturalHeight) {
    return;
  }

  // Ensure positive dimensions
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);

  const imgRatio = img.naturalWidth / img.naturalHeight;
  const boxRatio = safeWidth / safeHeight;
  let drawWidth = safeWidth;
  let drawHeight = safeHeight;

  // Fit image within box while maintaining aspect ratio
  if (imgRatio > boxRatio) {
    // Image is wider than box - fit by width
    drawHeight = safeWidth / imgRatio;
  } else {
    // Image is taller than box - fit by height
    drawWidth = safeHeight * imgRatio;
  }

  // Ensure drawn dimensions don't exceed box bounds
  drawWidth = Math.min(drawWidth, safeWidth);
  drawHeight = Math.min(drawHeight, safeHeight);

  // Center the image in the box
  const offsetX = x + (safeWidth - drawWidth) / 2;
  const offsetY = y + (safeHeight - drawHeight) / 2;

  // Additional safety check - ensure we're not drawing outside bounds
  if (offsetX >= 0 && offsetY >= 0 && drawWidth > 0 && drawHeight > 0) {
    try {
      ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
    } catch (error) {
      console.warn("[LastImagePreview] Failed to draw image:", error);
    }
  }
}

function drawSplit(ctx, state, width, height) {
  const hasLast = Boolean(state.lastImage?.loaded);
  const hasCurrent = Boolean(state.currentImage?.loaded);

  if (hasLast) {
    drawImageInBox(ctx, state.lastImage, 0, 0, width, height);
  } else if (hasCurrent) {
    drawImageInBox(ctx, state.currentImage, 0, 0, width, height);
  }

  if (hasCurrent) {
    ctx.save();
    ctx.beginPath();
    const ratio = clamp(state.sliderRatio);
    ctx.rect(0, 0, width * ratio, height);
    ctx.clip();
    drawImageInBox(ctx, state.currentImage, 0, 0, width, height);
    ctx.restore();
  }

  if (hasLast && hasCurrent) {
    const posX = clamp(state.sliderRatio) * width;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(posX, 8);
    ctx.lineTo(posX, height - 8);
    ctx.stroke();
  }
}

function drawSideBySide(ctx, state, width, height) {
  const hasLast = Boolean(state.lastImage?.loaded);
  const hasCurrent = Boolean(state.currentImage?.loaded);

  if (hasLast && hasCurrent) {
    const gutter = 4;
    const columnWidth = (width - gutter) / 2;
    drawImageInBox(ctx, state.lastImage, 0, 0, columnWidth, height);
    drawImageInBox(ctx, state.currentImage, columnWidth + gutter, 0, columnWidth, height);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(columnWidth, 6, gutter, height - 12);
  } else if (hasCurrent) {
    drawImageInBox(ctx, state.currentImage, 0, 0, width, height);
  } else if (hasLast) {
    drawImageInBox(ctx, state.lastImage, 0, 0, width, height);
  }
}

function drawToggle(ctx, state, width, height) {
  const hasLast = Boolean(state.lastImage?.loaded);
  const hasCurrent = Boolean(state.currentImage?.loaded);
  const showLast = state.toggleActive === "last" && hasLast;
  const source = showLast ? state.lastImage : state.currentImage;

  if (source?.loaded) {
    drawImageInBox(ctx, source, 0, 0, width, height);
  } else if (hasCurrent) {
    state.toggleActive = "current";
    drawImageInBox(ctx, state.currentImage, 0, 0, width, height);
  } else if (hasLast) {
    drawImageInBox(ctx, state.lastImage, 0, 0, width, height);
  }
}

function updateStatusText(node) {
  const state = node.previewState;
  const elements = node.previewElements;
  if (!state || !elements) {
    return;
  }
  const statusEl = elements.status;
  if (!statusEl) {
    return;
  }

  const hasCurrent = Boolean(state.currentImage?.loaded);
  const hasLast = Boolean(state.lastImage?.loaded);

  if (!hasCurrent) {
    statusEl.textContent = "Waiting for current image…";
    return;
  }

  if (!hasLast) {
    statusEl.textContent = "Last image not saved yet. Press update to store it.";
    return;
  }

  const modeLabel = COMPARISON_MODES.find((m) => m.value === state.compareMode)?.label ?? "Split";
  let suffix = "";
  if (state.compareMode === MODE_TOGGLE) {
    suffix = state.toggleActive === "last" ? " (showing saved)" : " (showing current)";
  }
  statusEl.textContent = `Comparison ready — ${modeLabel}${suffix}`;
}

function updateInteractiveState(node) {
  const state = node.previewState;
  const elements = node.previewElements;
  if (!state || !elements) {
    return;
  }
  const hasCurrent = Boolean(state.currentImage?.loaded);
  const hasLast = Boolean(state.lastImage?.loaded);
  elements.update.disabled = !hasCurrent;
  elements.clear.disabled = !hasLast;
  elements.toggle.disabled = !hasLast || state.compareMode !== MODE_TOGGLE;
  elements.toggle.style.display = state.compareMode === MODE_TOGGLE ? "inline-flex" : "none";
  elements.toggle.textContent =
    state.toggleActive === "last" ? "Show current image" : "Show saved image";
  elements.overlay.textContent = hasLast
    ? ""
    : "No saved image. Press “Update last image” to learn it.";
  elements.overlay.style.display = hasLast ? "none" : "flex";
  const wrapper = elements.canvasWrapper;
  if (state.compareMode === MODE_SPLIT && hasLast) {
    wrapper.classList.add("lei-split-mode");
  } else {
    wrapper.classList.remove("lei-split-mode");
  }
}

function renderPreview(node) {
  const state = node.previewState;
  const elements = node.previewElements;
  if (!state || !elements) {
    return;
  }
  const { canvasWrapper, canvas, ctx } = elements;
  if (!canvas || !ctx || !canvasWrapper) {
    return;
  }

  // IMPORTANT:
  // - `clientWidth/clientHeight` are layout pixels (node-local), NOT affected by ComfyUI zoom transforms.
  // - `getBoundingClientRect()` IS affected by ComfyUI zoom transforms.
  // If we use rect sizes for CSS sizing, we effectively "double apply" zoom.
  const cssWidth = Math.max(canvasWrapper.clientWidth || 0, 1);
  const cssHeight = Math.max(canvasWrapper.clientHeight || 0, 1);

  const rect = canvasWrapper.getBoundingClientRect();
  const scaleX = rect.width > 0 ? rect.width / cssWidth : 1;
  const scaleY = rect.height > 0 ? rect.height / cssHeight : 1;
  let effectiveZoom = (scaleX + scaleY) / 2;
  if (!Number.isFinite(effectiveZoom) || effectiveZoom <= 0) {
    effectiveZoom = 1;
  }

  const dpr = window.devicePixelRatio || 1;
  let backingScale = dpr * effectiveZoom;

  // Cap backing store to avoid gigantic canvases at extreme zoom / huge nodes
  const MAX_DIMENSION = 8192;
  let targetCanvasWidth = Math.round(cssWidth * backingScale);
  let targetCanvasHeight = Math.round(cssHeight * backingScale);
  const maxTargetDim = Math.max(targetCanvasWidth, targetCanvasHeight);
  if (maxTargetDim > MAX_DIMENSION) {
    const factor = MAX_DIMENSION / maxTargetDim;
    backingScale *= factor;
    targetCanvasWidth = Math.round(cssWidth * backingScale);
    targetCanvasHeight = Math.round(cssHeight * backingScale);
  }

  // Resize backing store only when needed; do NOT set canvas.style.* here.
  // CSS size remains 100% so it follows node sizing; ComfyUI zoom scales the widget once.
  if (
    canvas.width !== targetCanvasWidth ||
    canvas.height !== targetCanvasHeight ||
    state.lastCanvasWidth !== cssWidth ||
    state.lastCanvasHeight !== cssHeight ||
    state.lastBackingScale !== backingScale
  ) {
    canvas.width = targetCanvasWidth;
    canvas.height = targetCanvasHeight;
    state.lastCanvasWidth = cssWidth;
    state.lastCanvasHeight = cssHeight;
    state.lastBackingScale = backingScale;
  }

  const width = cssWidth;
  const height = cssHeight;

  // Draw in CSS pixels; backingScale maps CSS pixels -> backing store pixels.
  ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);

  // Clear canvas completely
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#05070d";
  ctx.fillRect(0, 0, width, height);

  // Clip to ensure nothing draws outside bounds
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const hasCurrent = Boolean(state.currentImage?.loaded);
  const hasLast = Boolean(state.lastImage?.loaded);
  updateInteractiveState(node);

  if (!hasCurrent && !hasLast) {
    ctx.fillStyle = "#6b6f85";
    ctx.font = "13px var(--font-family, 'Segoe UI', sans-serif)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Waiting for preview...", width / 2, height / 2);
    updateStatusText(node);
    return;
  }

  switch (state.compareMode) {
    case MODE_SIDEBYSIDE:
      drawSideBySide(ctx, state, width, height);
      break;
    case MODE_TOGGLE:
      drawToggle(ctx, state, width, height);
      break;
    case MODE_SPLIT:
    default:
      drawSplit(ctx, state, width, height);
      break;
  }

  // Restore clipping context
  ctx.restore();

  updateStatusText(node);
}

function normalizePayload(payload) {
  if (!payload) {
    return null;
  }
  if (Array.isArray(payload)) {
    const [format, mime, base64, width, height] = payload;
    return { format, mime, base64, width, height };
  }
  return payload;
}

function applyCurrentImage(node, payload) {
  if (!payload) {
    return;
  }
  const state = node.previewState;
  if (!state) {
    return;
  }
  const entry = createImageEntry(payload, () => scheduleRender(node));
  state.currentImage = entry;
  scheduleRender(node);
}

function loadStoredLastImage(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }
  let stored = null;
  try {
    stored = localStorage.getItem(state.storageKey);
  } catch (e) {
    console.warn("[LastImagePreview] localStorage read failed", e);
  }
  if (!stored) {
    return;
  }
  try {
    const payload = JSON.parse(stored);
    const entry = createImageEntry(payload, () => scheduleRender(node));
    state.lastImage = entry;
    scheduleRender(node);
  } catch (error) {
    console.warn("[LastImagePreview] corrupt stored last image", error);
  }
}

function persistLastImage(node) {
  const state = node.previewState;
  if (!state || !state.currentImage?.data?.base64) {
    return;
  }
  const payload = {
    base64: state.currentImage.data.base64,
    mime: state.currentImage.data.mime,
    format: state.currentImage.data.format,
  };
  try {
    localStorage.setItem(state.storageKey, JSON.stringify(payload));
  } catch (error) {
    console.warn("[LastImagePreview] Unable to save to localStorage", error);
  }
  const entry = createImageEntry(payload, () => scheduleRender(node));
  state.lastImage = entry;
  scheduleRender(node);
}

function clearLastImage(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }
  try {
    localStorage.removeItem(state.storageKey);
  } catch {
    // ignore
  }
  state.lastImage = null;
  scheduleRender(node);
}

function toggleImageView(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }
  if (state.toggleActive === "last") {
    state.toggleActive = "current";
  } else {
    state.toggleActive = "last";
  }
  scheduleRender(node);
}

function cleanupPreviewState(node) {
  const state = node.previewState;
  if (!state) {
    return;
  }
  if (state.renderFrameRequest) {
    cancelAnimationFrame(state.renderFrameRequest);
    state.renderFrameRequest = null;
  }
  for (const listener of state.listeners) {
    listener.target.removeEventListener(listener.type, listener.handler, listener.options);
  }
  delete node.previewState;
  delete node.previewElements;
}

app.registerExtension({
  name: "EasyFilePaths.LastImagePreview",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "LastImagePreview") {
      return;
    }

    ensureStyles();

    const originalOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      originalOnNodeCreated?.apply(this, arguments);

      const widgetRoot = document.createElement("div");
      widgetRoot.className = "lei-last-image-widget";
      widgetRoot.style.height = "100%";
      widgetRoot.style.width = "100%";
      widgetRoot.style.display = "flex";
      const contentTarget = document.createElement("div");
      contentTarget.className = "lei-last-image-root";
      contentTarget.style.display = "flex";
      contentTarget.style.flexDirection = "column";
      contentTarget.style.height = "100%";
      contentTarget.style.width = "100%";
      contentTarget.style.minWidth = "0";

      widgetRoot.appendChild(contentTarget);

      const canvasWrapper = document.createElement("div");
      canvasWrapper.className = "lei-last-image-canvas-wrapper";
      canvasWrapper.style.minWidth = "0";
      const canvas = document.createElement("canvas");
      canvas.className = "lei-last-image-canvas";
      const overlay = document.createElement("div");
      overlay.className = "lei-last-image-overlay";
      overlay.textContent = "No saved image. Press “Update last image” to capture.";

      canvasWrapper.append(canvas);
      canvasWrapper.append(overlay);

      const modeRow = document.createElement("div");
      modeRow.className = "lei-mode-row";
      const modeLabel = document.createElement("label");
      modeLabel.textContent = "Compare";
      const modeSelect = document.createElement("select");
      for (const mode of COMPARISON_MODES) {
        const option = document.createElement("option");
        option.value = mode.value;
        option.textContent = mode.label;
        modeSelect.appendChild(option);
      }
      const toggleButton = document.createElement("button");
      toggleButton.type = "button";
      toggleButton.className = "lei-toggle-button";
      toggleButton.textContent = "Show saved image";

      modeRow.append(modeLabel, modeSelect, toggleButton);

      const actionRow = document.createElement("div");
      actionRow.className = "lei-action-row";
      const updateButton = document.createElement("button");
      updateButton.type = "button";
      updateButton.className = "lei-action-button";
      updateButton.textContent = "Update last image";
      const clearButton = document.createElement("button");
      clearButton.type = "button";
      clearButton.className = "lei-action-button";
      clearButton.textContent = "Clear last image";
      actionRow.append(updateButton, clearButton);

      const statusLine = document.createElement("div");
      statusLine.className = "lei-status-line";

      contentTarget.append(modeRow, canvasWrapper, actionRow, statusLine);

      this.previewWidget = this.addDOMWidget(
        nodeData.name,
        "LastImagePreviewWidget",
        widgetRoot,
        { serialize: false, hideOnZoom: false }
      );

      this.previewState = {
        storageKey: makeStorageKey(this.id),
        currentImage: null,
        lastImage: null,
        compareMode: MODE_SPLIT,
        sliderRatio: 0.5,
        toggleActive: "current",
        listeners: [],
        renderFrameRequest: null,
        isDragging: false,
        lastCanvasWidth: null,
        lastCanvasHeight: null,
        lastBackingScale: null,
      };

      this.previewElements = {
        canvasWrapper,
        canvas,
        overlay,
        modeSelect,
        toggle: toggleButton,
        update: updateButton,
        clear: clearButton,
        status: statusLine,
        ctx: canvas.getContext("2d"),
      };

      const state = this.previewState;
      const { ctx } = this.previewElements;

      if (ctx) {
        scheduleRender(this);
      }

      const pointerDown = (event) => {
        if (state.compareMode !== MODE_SPLIT || !state.lastImage?.loaded) {
          return;
        }
        state.isDragging = true;
        const rect = canvasWrapper.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        state.sliderRatio = clamp(ratio);
        scheduleRender(this);
        event.preventDefault();
      };

      const pointerMove = (event) => {
        if (!state.isDragging) {
          return;
        }
        const rect = canvasWrapper.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        state.sliderRatio = clamp(ratio);
        scheduleRender(this);
        event.preventDefault();
      };

      const pointerUp = () => {
        state.isDragging = false;
      };

      const keyDown = (event) => {
        if (
          state.compareMode === MODE_TOGGLE &&
          (event.key === " " || event.key.toLowerCase() === "t") &&
          !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "")
        ) {
          event.preventDefault();
          toggleImageView(this);
        }
      };

      registerListener(state, canvasWrapper, "pointerdown", pointerDown);
      registerListener(state, window, "pointermove", pointerMove);
      registerListener(state, window, "pointerup", pointerUp);
      registerListener(state, window, "keydown", keyDown);

      registerListener(state, modeSelect, "change", () => {
        state.compareMode = modeSelect.value;
        if (state.compareMode !== MODE_TOGGLE) {
          state.toggleActive = "current";
        }
        // Mode changes don't affect canvas size, just redraw
        requestAnimationFrame(() => renderPreview(this));
      });

      registerListener(state, toggleButton, "click", () => toggleImageView(this));
      registerListener(state, updateButton, "click", () => persistLastImage(this));
      registerListener(state, clearButton, "click", () => clearLastImage(this));

      // Canvas has pointer-events: none so wheel events should pass through to ComfyUI zoom handler

      // Add a simple check for node size changes on render
      // We'll check in renderPreview if the node size changed

      loadStoredLastImage(this);
    };

    const originalOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      originalOnExecuted?.apply(this, arguments);
      const payload = normalizePayload(message?.ui?.last_image_preview ?? message?.last_image_preview);
      if (payload) {
        applyCurrentImage(this, payload);
      }
    };

    const originalOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      cleanupPreviewState(this);
      originalOnRemoved?.apply(this, arguments);
    };
  },
});
