import { createShadow, renderComposite, getLightingAtTime } from "./shadow.js";

const $ = (selector) => document.querySelector(selector);

const fileInput = $("#file-input");
const openBtn = $("#open-btn");
const emptyOpenBtn = $("#empty-open-btn");
const exportBtn = $("#export-btn");
const canvas = $("#map-canvas");
const stage = $("#canvas-stage");
const emptyState = $("#empty-state");
const ctx = canvas.getContext("2d");

const controls = {
  angle: $("#sun-angle"),
  length: $("#shadow-length"),
  height: $("#object-height"),
  opacity: $("#opacity"),
  blur: $("#blur"),
  color: $("#shadow-color"),
  contact: $("#contact-shadow"),
  time: $("#time-of-day"),
};

const outputs = {
  angle: $("#sun-angle-value"),
  length: $("#shadow-length-value"),
  height: $("#object-height-value"),
  opacity: $("#opacity-value"),
  blur: $("#blur-value"),
  time: $("#time-value"),
};

let sourceImage = null;
let sourceFileName = "map";
let objects = [];
let selectedObjectId = null;
let tool = "select";
let polygonPoints = [];
let view = { zoom: 1, panX: 0, panY: 0 };
let dragging = false;
let dragStart = null;
let renderQueued = false;
let objectCounter = 1;

function setStatus(message) {
  const status = document.querySelector(".statusbar span:nth-child(2)");
  if (status) status.textContent = message;
}

function openFiles() {
  fileInput.click();
}

openBtn?.addEventListener("click", openFiles);
emptyOpenBtn?.addEventListener("click", openFiles);

fileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const image = await loadImage(file);
  sourceImage = image;
  sourceFileName = file.name.replace(/\.png$/i, "") || "map";
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.hidden = false;
  emptyState.hidden = true;

  objects = [];
  selectedObjectId = null;
  polygonPoints = [];
  view.zoom = 1;
  view.panX = 0;
  view.panY = 0;

  $("#canvas-size").textContent = `${canvas.width} × ${canvas.height}`;
  setStatus("Image loaded");
  fitCanvas();
  render();
  fileInput.value = "";
});

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = reject;
    image.src = url;
  });
}

function fitCanvas() {
  if (!sourceImage) return;
  const availableW = stage.clientWidth - 40;
  const availableH = stage.clientHeight - 40;
  view.zoom = Math.min(availableW / canvas.width, availableH / canvas.height, 1);
  view.panX = (stage.clientWidth - canvas.width * view.zoom) / 2;
  view.panY = (stage.clientHeight - canvas.height * view.zoom) / 2;
  updateZoomLabel();
  render();
}

function updateZoomLabel() {
  $("#zoom-level").textContent = `${Math.round(view.zoom * 100)}%`;
}

function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function render() {
  if (!sourceImage) return;

  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;
  canvas.style.width = `${canvas.width * view.zoom}px`;
  canvas.style.height = `${canvas.height * view.zoom}px`;
  canvas.style.position = "absolute";
  canvas.style.left = `${view.panX}px`;
  canvas.style.top = `${view.panY}px`;

  // Canvas bitmap remains at original resolution. Shadows are composited there.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sourceImage, 0, 0);

  const selected = objects.find((obj) => obj.id === selectedObjectId);
  if (selected) {
    const shadow = createShadow(selected.mask, {
      angle: Number(controls.angle.value),
      length: Number(controls.length.value),
      objectHeight: Number(controls.height.value),
      opacity: Number(controls.opacity.value) / 100,
      blur: Number(controls.blur.value),
      color: controls.color.value,
      contact: controls.contact.checked,
      time: Number(controls.time.value),
    });
    renderComposite(ctx, shadow, selected.bounds.x, selected.bounds.y);
  }

  // Draw selection outlines in image-space; scaled by CSS display.
  ctx.save();
  ctx.lineWidth = 1 / view.zoom;
  ctx.strokeStyle = "#8b9cff";
  ctx.fillStyle = "rgba(139,156,255,0.12)";
  for (const obj of objects) {
    ctx.beginPath();
    obj.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.closePath();
    ctx.stroke();
    if (obj.id === selectedObjectId) ctx.fill();
  }
  if (polygonPoints.length) {
    ctx.beginPath();
    polygonPoints.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.strokeStyle = "#f5c76b";
    ctx.setLineDash([4 / view.zoom, 4 / view.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

function stageToImage(event) {
  const rect = stage.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - view.panX) / view.zoom,
    y: (event.clientY - rect.top - view.panY) / view.zoom,
  };
}

function setTool(nextTool) {
  tool = nextTool;
  document.querySelectorAll(".tool-button").forEach((button) => button.classList.remove("active"));
  const toolButtons = [...document.querySelectorAll(".tool-button")];
  const toolIndex = { select: 0, polygon: 1, brush: 2, erase: 3 }[tool];
  toolButtons[toolIndex]?.classList.add("active");
  canvas.style.cursor = tool === "polygon" ? "crosshair" : tool === "select" ? "default" : "crosshair";
}

document.querySelectorAll(".tool-button").forEach((button, index) => {
  button.addEventListener("click", () => {
    const toolByIndex = ["select", "polygon", "brush", "erase"];
    setTool(toolByIndex[index] || "select");
  });
});

// Double-click or click the first point to close polygon; Enter also closes.
canvas.addEventListener("click", (event) => {
  if (!sourceImage) return;
  const point = stageToImage(event);

  if (tool === "polygon") {
    if (polygonPoints.length >= 3 && event.detail > 1) {
      finishPolygon();
      return;
    }
    polygonPoints.push(point);
    requestRender();
    return;
  }

  if (tool === "select") {
    const hit = [...objects].reverse().find((obj) => pointInPolygon(point, obj.points));
    selectedObjectId = hit?.id ?? null;
    updateObjectList();
    requestRender();
  }
});

canvas.addEventListener("dblclick", (event) => {
  if (tool === "polygon") {
    event.preventDefault();
    finishPolygon();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && tool === "polygon") finishPolygon();
  if (event.key === "Escape") {
    polygonPoints = [];
    requestRender();
  }
  if (event.key === "Delete" && selectedObjectId) {
    objects = objects.filter((obj) => obj.id !== selectedObjectId);
    selectedObjectId = null;
    updateObjectList();
    requestRender();
  }
});

function finishPolygon() {
  if (polygonPoints.length < 3 || !sourceImage) return;
  const points = polygonPoints.map((p) => ({ ...p }));
  const bounds = getBounds(points);
  const mask = createPolygonMask(points, bounds);
  const object = {
    id: `object_${objectCounter++}`,
    name: `Object ${objects.length + 1}`,
    points,
    bounds,
    mask,
  };
  objects.push(object);
  selectedObjectId = object.id;
  polygonPoints = [];
  setTool("select");
  updateObjectList();
  requestRender();
  setStatus("Object selected");
}

function getBounds(points) {
  const minX = Math.floor(Math.min(...points.map((p) => p.x)));
  const minY = Math.floor(Math.min(...points.map((p) => p.y)));
  const maxX = Math.ceil(Math.max(...points.map((p) => p.x)));
  const maxY = Math.ceil(Math.max(...points.map((p) => p.y)));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function createPolygonMask(points, bounds) {
  const mask = document.createElement("canvas");
  mask.width = bounds.width;
  mask.height = bounds.height;
  const mctx = mask.getContext("2d");
  mctx.translate(-bounds.x, -bounds.y);
  mctx.fillStyle = "#fff";
  mctx.beginPath();
  points.forEach((p, index) => {
    if (index === 0) mctx.moveTo(p.x, p.y);
    else mctx.lineTo(p.x, p.y);
  });
  mctx.closePath();
  mctx.fill();

  // Clip selected polygon to source image, then use source alpha as silhouette.
  const source = document.createElement("canvas");
  source.width = bounds.width;
  source.height = bounds.height;
  const sctx = source.getContext("2d");
  sctx.drawImage(sourceImage, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);

  const maskPixels = mctx.getImageData(0, 0, bounds.width, bounds.height);
  const sourcePixels = sctx.getImageData(0, 0, bounds.width, bounds.height);
  for (let i = 0; i < maskPixels.data.length; i += 4) {
    const polygonAlpha = maskPixels.data[i + 3];
    const sourceAlpha = sourcePixels.data[i + 3];
    const alpha = Math.round(polygonAlpha * sourceAlpha / 255);
    maskPixels.data[i] = 255;
    maskPixels.data[i + 1] = 255;
    maskPixels.data[i + 2] = 255;
    maskPixels.data[i + 3] = alpha;
  }
  mctx.putImageData(maskPixels, 0, 0);
  return mask;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-9) + a.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function updateObjectList() {
  const list = $("#object-list");
  list.innerHTML = "";
  if (!objects.length) {
    list.innerHTML = '<div class="object-empty">No objects selected</div>';
    return;
  }
  for (const obj of objects) {
    const row = document.createElement("button");
    row.className = "object-row" + (obj.id === selectedObjectId ? " selected" : "");
    row.innerHTML = `<span class="object-indicator"></span><span class="object-name"></span><span class="object-size"></span>`;
    row.querySelector(".object-name").textContent = obj.name;
    row.querySelector(".object-size").textContent = `${obj.bounds.width}×${obj.bounds.height}`;
    row.addEventListener("click", () => {
      selectedObjectId = obj.id;
      updateObjectList();
      requestRender();
    });
    list.appendChild(row);
  }
}

$("#select-object-btn")?.addEventListener("click", () => setTool("polygon"));
$("#clear-selection-btn")?.addEventListener("click", () => {
  objects = [];
  selectedObjectId = null;
  polygonPoints = [];
  updateObjectList();
  requestRender();
});

// Pan with middle mouse or space + drag. Wheel zooms around pointer.
stage.addEventListener("mousedown", (event) => {
  if (event.button === 1 || event.button === 2 || event.shiftKey) {
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
    event.preventDefault();
  }
});
window.addEventListener("mousemove", (event) => {
  if (dragging && dragStart) {
    view.panX = dragStart.panX + event.clientX - dragStart.x;
    view.panY = dragStart.panY + event.clientY - dragStart.y;
    requestRender();
  }
  if (sourceImage) {
    const point = stageToImage(event);
    $("#cursor-position").textContent = `X: ${Math.round(point.x)}  Y: ${Math.round(point.y)}`;
  }
});
window.addEventListener("mouseup", () => { dragging = false; dragStart = null; });
stage.addEventListener("contextmenu", (event) => event.preventDefault());

stage.addEventListener("wheel", (event) => {
  if (!sourceImage) return;
  event.preventDefault();
  const before = stageToImage(event);
  const factor = event.deltaY < 0 ? 1.1 : 0.9;
  view.zoom = Math.max(0.1, Math.min(8, view.zoom * factor));
  view.panX = event.offsetX - before.x * view.zoom;
  view.panY = event.offsetY - before.y * view.zoom;
  updateZoomLabel();
  requestRender();
}, { passive: false });

document.querySelectorAll(".tool-group .tool-button").forEach((button) => {
  if (button.textContent.trim() === "Fit") button.addEventListener("click", fitCanvas);
  if (button.textContent.trim() === "+") button.addEventListener("click", () => zoomBy(1.2));
  if (button.textContent.trim() === "−") button.addEventListener("click", () => zoomBy(0.8));
});

function zoomBy(factor) {
  if (!sourceImage) return;
  const centerX = stage.clientWidth / 2;
  const centerY = stage.clientHeight / 2;
  const imageX = (centerX - view.panX) / view.zoom;
  const imageY = (centerY - view.panY) / view.zoom;
  view.zoom = Math.max(0.1, Math.min(8, view.zoom * factor));
  view.panX = centerX - imageX * view.zoom;
  view.panY = centerY - imageY * view.zoom;
  updateZoomLabel();
  requestRender();
}

// Controls update their displayed values and preview.
for (const [key, input] of Object.entries(controls)) {
  input?.addEventListener("input", () => {
    updateOutputs();
    requestRender();
  });
}
document.querySelectorAll(".preset-button").forEach((button) => {
  button.addEventListener("click", () => {
    controls.time.value = button.dataset.time;
    updateOutputs();
    applyTimePreset();
    requestRender();
  });
});

function formatTime(minutes) {
  const m = Number(minutes) % 1440;
  const hh = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function updateOutputs() {
  outputs.angle.textContent = `${controls.angle.value}°`;
  outputs.length.textContent = `${controls.length.value}px`;
  outputs.height.textContent = `${controls.height.value} px`;
  outputs.opacity.textContent = `${controls.opacity.value}%`;
  outputs.blur.textContent = `${controls.blur.value} px`;
  outputs.time.textContent = formatTime(controls.time.value);
}

function applyTimePreset() {
  const lighting = getLightingAtTime(Number(controls.time.value));
  controls.angle.value = lighting.angle;
  controls.length.value = lighting.length;
  controls.opacity.value = Math.round(lighting.opacity * 100);
  updateOutputs();
}

exportBtn?.addEventListener("click", () => {
  if (!sourceImage) {
    setStatus("Open an image first");
    return;
  }
  // Export without editor selection outlines.
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(sourceImage, 0, 0);
  const selected = objects.find((obj) => obj.id === selectedObjectId);
  if (selected) {
    const shadow = createShadow(selected.mask, {
      angle: Number(controls.angle.value),
      length: Number(controls.length.value),
      objectHeight: Number(controls.height.value),
      opacity: Number(controls.opacity.value) / 100,
      blur: Number(controls.blur.value),
      color: controls.color.value,
      contact: controls.contact.checked,
      time: Number(controls.time.value),
    });
    renderComposite(exportCtx, shadow, selected.bounds.x, selected.bounds.y);
    exportCtx.drawImage(sourceImage, selected.bounds.x, selected.bounds.y, selected.bounds.width, selected.bounds.height, selected.bounds.x, selected.bounds.y, selected.bounds.width, selected.bounds.height);
  }
  const link = document.createElement("a");
  link.download = `${sourceFileName}_shadow.png`;
  link.href = exportCanvas.toDataURL("image/png");
  link.click();
  setStatus("PNG exported");
});

// Initialize labels and controls.
updateOutputs();
