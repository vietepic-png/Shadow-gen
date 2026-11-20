/**
 * Lightweight 2D silhouette shadow helpers.
 * Mask canvases should be white with alpha describing the selected silhouette.
 */

export function getLightingAtTime(minutes) {
  const t = ((minutes % 1440) + 1440) % 1440;
  // A simple stylized cycle: dawn 06:00, noon 12:00, sunset 18:00.
  const phase = (t / 1440) * Math.PI * 2 - Math.PI / 2;
  const daylight = Math.max(0, Math.sin(phase));
  const elevation = Math.max(4, 8 + daylight * 72);
  const angle = (t / 1440) * 360 + 180;
  const length = Math.round(100 * (1 - daylight) + 8);
  const opacity = daylight > 0 ? 0.15 + (1 - daylight) * 0.3 : 0;
  return { angle: Math.round(angle) % 360, elevation, length, opacity };
}

export function createShadow(maskCanvas, options = {}) {
  const {
    angle = 135,
    length = 80,
    objectHeight = 32,
    opacity = 0.35,
    blur = 1,
    color = "#252535",
    contact = true,
    time = null,
  } = options;

  const lighting = time === null ? null : getLightingAtTime(time);
  const effectiveAngle = lighting ? lighting.angle : angle;
  const effectiveLength = lighting ? lighting.length : length;
  const effectiveOpacity = lighting ? lighting.opacity : opacity;

  // Auto-ish length uses elevation when a time is supplied; manual mode uses slider.
  const radians = effectiveAngle * Math.PI / 180;
  const shadowLength = time === null
    ? effectiveLength
    : Math.max(0, objectHeight / Math.tan(Math.max(4, lighting.elevation) * Math.PI / 180));

  const dx = Math.cos(radians) * shadowLength;
  const dy = Math.sin(radians) * shadowLength;

  const out = document.createElement("canvas");
  const pad = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) + blur * 3 + (contact ? 2 : 0));
  out.width = maskCanvas.width + pad * 2;
  out.height = maskCanvas.height + pad * 2;
  const ctx = out.getContext("2d");

  // Colorize mask via source-in.
  const tinted = document.createElement("canvas");
  tinted.width = maskCanvas.width;
  tinted.height = maskCanvas.height;
  const tctx = tinted.getContext("2d");
  tctx.drawImage(maskCanvas, 0, 0);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, tinted.width, tinted.height);
  tctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalAlpha = effectiveOpacity;
  ctx.filter = blur > 0 ? `blur(${blur}px)` : "none";
  ctx.drawImage(tinted, pad + dx, pad + dy);
  ctx.restore();

  if (contact && blur > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, effectiveOpacity * 1.35);
    ctx.filter = "none";
    ctx.drawImage(tinted, pad + dx * 0.15, pad + dy * 0.15);
    ctx.restore();
  }

  return { canvas: out, offsetX: pad, offsetY: pad };
}

export function renderComposite(targetContext, shadow, objectX, objectY) {
  if (!shadow?.canvas) return;
  targetContext.save();
  targetContext.globalCompositeOperation = "multiply";
  targetContext.drawImage(
    shadow.canvas,
    objectX - shadow.offsetX,
    objectY - shadow.offsetY
  );
  targetContext.restore();
}
