/**
 * External viewer client for ComfyUI image push.
 * Reuses interaction patterns from last_image_preview.js.
 * Filters messages by viewer_id from URL query parameter.
 */

const MODE_SPLIT = "split";
const MODE_SIDEBYSIDE = "side-by-side";
const MODE_TOGGLE = "toggle";

const COMPARISON_MODES = [
    { value: MODE_SPLIT, label: "Split (draggable)" },
    { value: MODE_SIDEBYSIDE, label: "Side-by-side" },
    { value: MODE_TOGGLE, label: "A/B toggle" },
];

// Parse viewer_id from URL
function getViewerId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("id") || "default";
}

// State
const state = {
    viewerId: getViewerId(),
    currentImage: null,
    lastImage: null,
    compareMode: MODE_SPLIT,
    sliderRatio: 0.5,
    toggleActive: "current",
    isDragging: false,
    renderFrameRequest: null,
    lastCanvasWidth: null,
    lastCanvasHeight: null,
    lastBackingScale: null,
    // Zoom/pan state
    scale: 1.0,
    panX: 0,
    panY: 0,
    isPanning: false,
    panStartX: 0,
    panStartY: 0,
    // WebSocket
    ws: null,
    reconnectTimeout: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 10,
};

// DOM elements
const elements = {
    canvasWrapper: document.getElementById("canvas-wrapper"),
    canvas: document.getElementById("canvas"),
    overlay: document.getElementById("overlay"),
    modeSelect: document.getElementById("mode-select"),
    toggleButton: document.getElementById("toggle-button"),
    updateButton: document.getElementById("update-button"),
    clearButton: document.getElementById("clear-button"),
    statusLine: document.getElementById("status-line"),
    viewerIdDisplay: document.getElementById("viewer-id-display"),
    connectionStatus: document.getElementById("connection-status"),
    statusIndicator: document.getElementById("status-indicator"),
    statusText: document.getElementById("status-text"),
};

// Get 2D context
const ctx = elements.canvas.getContext("2d");

// Update viewer ID display
elements.viewerIdDisplay.textContent = state.viewerId;

// Utility functions
function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
}

function createImageEntry(base64Data, onReady) {
    if (!base64Data) {
        return null;
    }

    // Remove data URI prefix if present
    let base64 = base64Data;
    if (base64Data.startsWith("data:")) {
        const commaIndex = base64Data.indexOf(",");
        if (commaIndex !== -1) {
            base64 = base64Data.substring(commaIndex + 1);
        }
    }

    const mime = "image/webp";
    const src = `data:${mime};base64,${base64}`;
    const img = new Image();
    const entry = {
        data: { base64, mime, format: "WEBP" },
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

function scheduleRender() {
    if (state.renderFrameRequest) {
        return;
    }
    state.renderFrameRequest = requestAnimationFrame(() => {
        state.renderFrameRequest = null;
        renderPreview();
    });
}

function drawImageInBox(ctx, entry, x, y, width, height) {
    if (!entry || !entry.loaded || !ctx) {
        return;
    }

    const img = entry.img;
    if (!img.naturalWidth || !img.naturalHeight) {
        return;
    }

    const safeWidth = Math.max(width, 1);
    const safeHeight = Math.max(height, 1);

    const imgRatio = img.naturalWidth / img.naturalHeight;
    const boxRatio = safeWidth / safeHeight;
    let drawWidth = safeWidth;
    let drawHeight = safeHeight;

    if (imgRatio > boxRatio) {
        drawHeight = safeWidth / imgRatio;
    } else {
        drawWidth = safeHeight * imgRatio;
    }

    drawWidth = Math.min(drawWidth, safeWidth);
    drawHeight = Math.min(drawHeight, safeHeight);

    const offsetX = x + (safeWidth - drawWidth) / 2;
    const offsetY = y + (safeHeight - drawHeight) / 2;

    if (offsetX >= 0 && offsetY >= 0 && drawWidth > 0 && drawHeight > 0) {
        try {
            ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        } catch (error) {
            console.warn("[Viewer] Failed to draw image:", error);
        }
    }
}

function drawSplit(ctx, width, height) {
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

function drawSideBySide(ctx, width, height) {
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

function drawToggle(ctx, width, height) {
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

function updateStatusText() {
    const hasCurrent = Boolean(state.currentImage?.loaded);
    const hasLast = Boolean(state.lastImage?.loaded);

    if (!hasCurrent) {
        elements.statusLine.textContent = "Waiting for current image…";
        return;
    }

    if (!hasLast) {
        elements.statusLine.textContent = "Last image not saved yet. Press update to store it.";
        return;
    }

    const modeLabel = COMPARISON_MODES.find((m) => m.value === state.compareMode)?.label ?? "Split";
    let suffix = "";
    if (state.compareMode === MODE_TOGGLE) {
        suffix = state.toggleActive === "last" ? " (showing saved)" : " (showing current)";
    }
    elements.statusLine.textContent = `Comparison ready — ${modeLabel}${suffix}`;
}

function updateInteractiveState() {
    const hasCurrent = Boolean(state.currentImage?.loaded);
    const hasLast = Boolean(state.lastImage?.loaded);
    elements.updateButton.disabled = !hasCurrent;
    elements.clearButton.disabled = !hasLast;
    elements.toggleButton.disabled = !hasLast || state.compareMode !== MODE_TOGGLE;
    elements.toggleButton.style.display = state.compareMode === MODE_TOGGLE ? "inline-flex" : "none";
    elements.toggleButton.textContent =
        state.toggleActive === "last" ? "Show current image" : "Show saved image";
    
    if (hasLast) {
        elements.overlay.classList.add("hidden");
    } else {
        elements.overlay.classList.remove("hidden");
        elements.overlay.textContent = "No saved image. Press \"Update last image\" to capture.";
    }
    
    if (state.compareMode === MODE_SPLIT && hasLast) {
        elements.canvasWrapper.classList.add("split-mode");
    } else {
        elements.canvasWrapper.classList.remove("split-mode");
    }
}

function renderPreview() {
    const { canvasWrapper, canvas } = elements;
    if (!canvas || !ctx || !canvasWrapper) {
        return;
    }

    const cssWidth = Math.max(canvasWrapper.clientWidth || 0, 1);
    const cssHeight = Math.max(canvasWrapper.clientHeight || 0, 1);

    const dpr = window.devicePixelRatio || 1;
    let backingScale = dpr;

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

    ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#05070d";
    ctx.fillRect(0, 0, width, height);

    const hasCurrent = Boolean(state.currentImage?.loaded);
    const hasLast = Boolean(state.lastImage?.loaded);
    updateInteractiveState();

    if (!hasCurrent && !hasLast) {
        ctx.fillStyle = "#6b6f85";
        ctx.font = "13px var(--font-family, 'Segoe UI', sans-serif)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Waiting for preview...", width / 2, height / 2);
        updateStatusText();
        return;
    }

    // Apply zoom/pan transform for all modes
    ctx.save();
    ctx.translate(state.panX, state.panY);
    ctx.scale(state.scale, state.scale);

    // Calculate transformed dimensions for clipping
    const transformedWidth = width / state.scale;
    const transformedHeight = height / state.scale;
    const clipX = -state.panX / state.scale;
    const clipY = -state.panY / state.scale;

    ctx.beginPath();
    ctx.rect(clipX, clipY, transformedWidth, transformedHeight);
    ctx.clip();

    switch (state.compareMode) {
        case MODE_SPLIT:
            drawSplit(ctx, transformedWidth, transformedHeight);
            break;
        case MODE_SIDEBYSIDE:
            drawSideBySide(ctx, transformedWidth, transformedHeight);
            break;
        case MODE_TOGGLE:
            drawToggle(ctx, transformedWidth, transformedHeight);
            break;
    }
    ctx.restore();

    updateStatusText();
}

// Image management
function applyCurrentImage(base64Data) {
    if (!base64Data) {
        return;
    }
    const entry = createImageEntry(base64Data, () => scheduleRender());
    state.currentImage = entry;
    scheduleRender();
}

function persistLastImage() {
    if (!state.currentImage?.data?.base64) {
        return;
    }
    const payload = {
        base64: state.currentImage.data.base64,
        mime: state.currentImage.data.mime,
        format: state.currentImage.data.format,
    };
    const entry = createImageEntry(payload.base64, () => scheduleRender());
    state.lastImage = entry;
    scheduleRender();
}

function clearLastImage() {
    state.lastImage = null;
    scheduleRender();
}

function toggleImageView() {
    if (state.toggleActive === "last") {
        state.toggleActive = "current";
    } else {
        state.toggleActive = "last";
    }
    scheduleRender();
}

// WebSocket connection
function getWebSocketURL() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const port = "8788";
    return `${protocol}//${host}:${port}/ws`;
}

function connectWebSocket() {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        return;
    }

    const url = getWebSocketURL();
    updateConnectionStatus("connecting", "Connecting...");

    try {
        const ws = new WebSocket(url);
        
        ws.onopen = () => {
            console.log("[Viewer] WebSocket connected");
            state.reconnectAttempts = 0;
            updateConnectionStatus("connected", "Connected");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                
                // Filter by viewer_id
                if (data.viewer_id !== state.viewerId) {
                    return;
                }

                // Update current image
                if (data.image_webp) {
                    applyCurrentImage(data.image_webp);
                }
            } catch (error) {
                console.warn("[Viewer] Failed to parse message:", error);
            }
        };

        ws.onerror = (error) => {
            console.error("[Viewer] WebSocket error:", error);
            updateConnectionStatus("disconnected", "Connection error");
        };

        ws.onclose = () => {
            console.log("[Viewer] WebSocket closed");
            updateConnectionStatus("disconnected", "Disconnected");
            state.ws = null;

            // Reconnect with exponential backoff
            if (state.reconnectAttempts < state.maxReconnectAttempts) {
                const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts), 30000);
                state.reconnectAttempts++;
                console.log(`[Viewer] Reconnecting in ${delay}ms (attempt ${state.reconnectAttempts})`);
                state.reconnectTimeout = setTimeout(() => {
                    connectWebSocket();
                }, delay);
            } else {
                updateConnectionStatus("disconnected", "Connection failed");
            }
        };

        state.ws = ws;
    } catch (error) {
        console.error("[Viewer] Failed to create WebSocket:", error);
        updateConnectionStatus("disconnected", "Connection failed");
    }
}

function updateConnectionStatus(status, text) {
    elements.statusIndicator.className = `status-indicator ${status}`;
    elements.statusText.textContent = text;
}

// Event handlers
elements.modeSelect.addEventListener("change", () => {
    state.compareMode = elements.modeSelect.value;
    if (state.compareMode !== MODE_TOGGLE) {
        state.toggleActive = "current";
    }
    scheduleRender();
});

elements.toggleButton.addEventListener("click", () => toggleImageView());
elements.updateButton.addEventListener("click", () => persistLastImage());
elements.clearButton.addEventListener("click", () => clearLastImage());

// Track space key for pan mode
let spaceKeyPressed = false;
window.addEventListener("keydown", (event) => {
    if (event.key === " " || event.key === "Space") {
        spaceKeyPressed = true;
        elements.canvasWrapper.classList.add("pan-mode");
    }
});
window.addEventListener("keyup", (event) => {
    if (event.key === " " || event.key === "Space") {
        spaceKeyPressed = false;
        elements.canvasWrapper.classList.remove("pan-mode");
    }
});

// Split mode dragging
elements.canvasWrapper.addEventListener("pointerdown", (event) => {
    if (spaceKeyPressed) {
        // Pan mode
        state.isPanning = true;
        state.panStartX = event.clientX - state.panX;
        state.panStartY = event.clientY - state.panY;
        elements.canvasWrapper.classList.add("panning");
        event.preventDefault();
        return;
    }
    
    if (state.compareMode !== MODE_SPLIT || !state.lastImage?.loaded) {
        return;
    }
    
    // Split mode dragging
    state.isDragging = true;
    const rect = elements.canvasWrapper.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    state.sliderRatio = clamp(ratio);
    scheduleRender();
    event.preventDefault();
});

window.addEventListener("pointermove", (event) => {
    if (state.isDragging) {
        const rect = elements.canvasWrapper.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / rect.width;
        state.sliderRatio = clamp(ratio);
        scheduleRender();
        event.preventDefault();
    } else if (state.isPanning) {
        state.panX = event.clientX - state.panStartX;
        state.panY = event.clientY - state.panStartY;
        scheduleRender();
        event.preventDefault();
    }
});

window.addEventListener("pointerup", () => {
    state.isDragging = false;
    state.isPanning = false;
    elements.canvasWrapper.classList.remove("panning");
});

// Zoom with mouse wheel
elements.canvasWrapper.addEventListener("wheel", (event) => {
    event.preventDefault();
    const rect = elements.canvasWrapper.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    const newScale = clamp(state.scale * delta, 0.1, 10);

    // Zoom centered on cursor - keep the point under cursor at the same screen position
    // Formula: newPan = cursorPos - (cursorPos - oldPan) / oldScale * newScale
    state.panX = x - (x - state.panX) / state.scale * newScale;
    state.panY = y - (y - state.panY) / state.scale * newScale;
    state.scale = newScale;

    scheduleRender();
});

// Double-click to reset zoom/pan
elements.canvasWrapper.addEventListener("dblclick", () => {
    state.scale = 1.0;
    state.panX = 0;
    state.panY = 0;
    scheduleRender();
});

// Keyboard shortcuts
window.addEventListener("keydown", (event) => {
    if (state.compareMode === MODE_TOGGLE && (event.key === " " || event.key.toLowerCase() === "t")) {
        if (!["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName ?? "")) {
            event.preventDefault();
            toggleImageView();
        }
    }
});

// Resize handling
let resizeTimeout = null;
window.addEventListener("resize", () => {
    if (resizeTimeout) {
        clearTimeout(resizeTimeout);
    }
    resizeTimeout = setTimeout(() => {
        scheduleRender();
    }, 100);
});

// Initialize
connectWebSocket();
scheduleRender();
