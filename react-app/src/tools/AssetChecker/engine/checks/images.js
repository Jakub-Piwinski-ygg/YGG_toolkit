import { mkFinding } from '../findings.js';
import { isUnderSource, isUnderPreview } from '../spineTriplet.js';

const CAT = '6. Images';

const SIZE_IDEAL = 4 * 1024 * 1024;   // ≤ 4 MB → pass (green)
const SIZE_BAD   = 16 * 1024 * 1024;  // ≥ 16 MB → error (red)

function isPot(n) { return n > 0 && (n & (n - 1)) === 0; }

// Static-image extensions we run technical checks on. PNG is still the
// primary format; jpg/webp/gif/bmp are accepted so loose-asset drops of
// non-PNG static art aren't silently skipped.
const STATIC_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'];
const ALPHA_CAPABLE_EXTS = new Set(['png', 'webp', 'gif']);

async function pngDimsFromHeader(file) {
  const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const view = new DataView(buf.buffer);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

// Generic image-dim reader. PNGs use the cheap header parse; everything
// else falls back to createImageBitmap (decodes the file once — small cost
// for jpg/webp/gif which we'd decode for alpha analysis anyway).
async function imageDims(file, ext) {
  if (ext === 'png') return pngDimsFromHeader(file);
  try {
    const bm = await createImageBitmap(file);
    const dims = { w: bm.width, h: bm.height };
    bm.close?.();
    return dims;
  } catch { return null; }
}

// Decode a PNG to a downscaled canvas and compute alpha stats:
//   - transparentRatio: fraction of pixels with alpha < threshold
//   - tightBox: bbox of pixels with alpha >= threshold (in canvas coords)
//   - canvasW/H: downscaled canvas dims
// We downscale to ANALYSIS_MAX on the long edge — alpha ratios and bbox
// proportions are scale-invariant within rounding, and this caps cost on
// large drops. Returns null if the PNG is too big or fails to decode.
const ANALYSIS_MAX = 512;
const ANALYSIS_ALPHA_THRESHOLD = 8;
const ANALYSIS_SKIP_AXIS = 8192; // bail on absurdly large files

async function analyzeAlpha(file, dims) {
  if (!dims) return null;
  if (dims.w > ANALYSIS_SKIP_AXIS || dims.h > ANALYSIS_SKIP_AXIS) return null;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = long > ANALYSIS_MAX ? ANALYSIS_MAX / long : 1;
  const cw = Math.max(1, Math.round(bitmap.width * scale));
  const ch = Math.max(1, Math.round(bitmap.height * scale));
  let canvas;
  try {
    canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(cw, ch)
      : Object.assign(document.createElement('canvas'), { width: cw, height: ch });
  } catch { bitmap.close?.(); return null; }
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) { bitmap.close?.(); return null; }
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(bitmap, 0, 0, cw, ch);
  bitmap.close?.();
  let data;
  try { data = ctx.getImageData(0, 0, cw, ch).data; } catch { return null; }

  let transparent = 0;
  let minX = cw, minY = ch, maxX = -1, maxY = -1;
  const total = cw * ch;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const a = data[(y * cw + x) * 4 + 3];
      if (a < ANALYSIS_ALPHA_THRESHOLD) {
        transparent++;
      } else {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  const tightBox = maxX >= 0
    ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    : null;
  return {
    transparentRatio: transparent / total,
    tightBox,
    canvasW: cw,
    canvasH: ch
  };
}

// Map a filename to a custom resolution-cap category via patterns.
// cfg.categoryPatterns: { categoryId: ["regex", ...] }
function matchResolutionCategory(name, patterns) {
  const lower = name.toLowerCase();
  for (const [cat, list] of Object.entries(patterns || {})) {
    for (const pat of list) {
      try { if (new RegExp(pat, 'i').test(lower)) return cat; } catch { /* skip bad regex */ }
    }
  }
  return null;
}

function sizeGauge(bytes) {
  // 0 at SIZE_IDEAL or below, 1 at SIZE_BAD or above, linear in between.
  if (bytes <= SIZE_IDEAL) return { t: 0, label: 'green', severity: 'pass' };
  if (bytes >= SIZE_BAD) return { t: 1, label: 'red', severity: 'error' };
  const t = (bytes - SIZE_IDEAL) / (SIZE_BAD - SIZE_IDEAL);
  // 0..0.5 → orange/info, 0.5..1 → red/warn
  if (t < 0.5) return { t, label: 'orange', severity: 'info' };
  return { t, label: 'red-warn', severity: 'warn' };
}

export async function run(ctx) {
  const { index, config, mode } = ctx;
  const cfg = config.images || {};
  const findings = [];
  // Source/ contains raw / WIP files — skip them entirely.
  // Preview/ files have their own dedicated check in coverage.js.
  // We include PNG + JPG/WEBP/GIF/BMP so loose-asset drops of non-PNG
  // static art still get size, dimension, and alpha checks.
  const images = [];
  for (const ext of STATIC_IMAGE_EXTS) {
    const list = index.byExt.get(ext) || [];
    for (const e of list) {
      if (!isUnderSource(e) && !isUnderPreview(e)) images.push({ entry: e, ext });
    }
  }
  const potCats = new Set(cfg.potCategories || []);
  const resCaps = cfg.categoryMaxSize || {};
  const resPatterns = cfg.categoryPatterns || {};
  const alphaEmptyThreshold = cfg.alphaEmptyRatio ?? 0.9;
  const trimRatioThreshold = cfg.trimRatioWarn ?? 0.5;
  const enableDeepAnalysis = cfg.deepImageAnalysis !== false;
  let nonPotCount = 0;
  let bigCount = 0;
  let imageCount = 0;

  for (const { entry: e, ext } of images) {
    imageCount++;
    const dims = await imageDims(e.file, ext);
    const hasAlpha = ALPHA_CAPABLE_EXTS.has(ext);
    const top = (e.segments[0] || '').toLowerCase();
    const cat = categoryFromTop(top);
    const sizeMB = (e.size / 1024 / 1024).toFixed(2);
    const fileFindings = []; // collected per-file so we can decide pass vs not

    // File-size traffic light
    const gauge = sizeGauge(e.size);
    const gaugeData = {
      bytes: e.size,
      idealMB: SIZE_IDEAL / 1024 / 1024,
      badMB: SIZE_BAD / 1024 / 1024,
      t: gauge.t,
      label: gauge.label
    };
    if (gauge.severity !== 'pass') {
      fileFindings.push(mkFinding({
        ruleId: 'image.fileSize',
        severity: gauge.severity,
        priority: gauge.severity === 'error' ? 1 : (gauge.severity === 'warn' ? 2 : 4),
        category: CAT,
        paths: [e.relPath],
        message: `${e.name} is ${sizeMB} MB.`,
        data: { gauge: gaugeData }
      }));
      bigCount++;
    }

    if (dims && cfg.maxAxisPx && (dims.w > cfg.maxAxisPx || dims.h > cfg.maxAxisPx)) {
      fileFindings.push(mkFinding({
        ruleId: 'image.axisTooLarge',
        severity: 'warn',
        priority: 3,
        category: CAT,
        paths: [e.relPath],
        message: `${ext.toUpperCase()} ${dims.w}x${dims.h} exceeds max-axis ${cfg.maxAxisPx}px.`
      }));
    }

    if (dims && cat && potCats.has(cat)) {
      if (!isPot(dims.w) || !isPot(dims.h)) {
        nonPotCount++;
        fileFindings.push(mkFinding({
          ruleId: 'image.nonPot',
          severity: 'warn',
          priority: 3,
          category: CAT,
          paths: [e.relPath],
          message: `${cat} asset is non-POT: ${dims.w}x${dims.h}.`
        }));
      }
    }

    // 6.12 per-category resolution caps (e.g. flares ≤ 128, small UI ≤ 256)
    if (dims) {
      const resCat = matchResolutionCategory(e.name, resPatterns);
      if (resCat && resCaps[resCat]) {
        const capPx = resCaps[resCat];
        const longEdge = Math.max(dims.w, dims.h);
        if (longEdge > capPx) {
          fileFindings.push(mkFinding({
            ruleId: 'image.categoryAxisExceeded',
            severity: 'warn',
            priority: 3,
            category: CAT,
            paths: [e.relPath],
            message: `${e.name} (${resCat}) is ${dims.w}x${dims.h}; category cap is ${capPx}px on the long edge.`
          }));
        }
      }
    }

    // 6.7 / 6.8 deep alpha analysis (canvas-based, downscaled).
    // Skip for JPEGs / BMPs — they have no alpha channel, so the
    // "almost-empty alpha" check would always misfire.
    if (enableDeepAnalysis && dims && hasAlpha) {
      const stats = await analyzeAlpha(e.file, dims);
      if (stats) {
        if (stats.transparentRatio > alphaEmptyThreshold) {
          fileFindings.push(mkFinding({
            ruleId: 'image.almostEmptyAlpha',
            severity: 'warn',
            priority: 3,
            category: CAT,
            paths: [e.relPath],
            message: `${e.name}: ${Math.round(stats.transparentRatio * 100)}% of pixels are transparent — trim canvas before export.`
          }));
        } else if (stats.tightBox) {
          const canvasArea = stats.canvasW * stats.canvasH;
          const usedArea = stats.tightBox.w * stats.tightBox.h;
          const usedRatio = usedArea / canvasArea;
          if (usedRatio < trimRatioThreshold) {
            fileFindings.push(mkFinding({
              ruleId: 'image.excessivePadding',
              severity: 'info',
              priority: 4,
              category: CAT,
              paths: [e.relPath],
              message: `${e.name}: content occupies ${Math.round(usedRatio * 100)}% of canvas — consider tighter trim.`
            }));
          }
        }
      }
    }

    if (dims && cat === 'backgrounds' && cfg.backgroundCanonicalSizes) {
      const longEdge = Math.max(dims.w, dims.h);
      if (!cfg.backgroundCanonicalSizes.includes(longEdge)) {
        fileFindings.push(mkFinding({
          ruleId: 'image.bgNonCanonical',
          severity: 'info',
          priority: 4,
          category: CAT,
          paths: [e.relPath],
          message: `Background long-edge ${longEdge}px isn't one of ${cfg.backgroundCanonicalSizes.join('/')}.`
        }));
      }
    }

    findings.push(...fileFindings);

    // Always emit a per-file size pass so the tree badge shows the file was
    // verified (including its size against the gauge).
    if (gauge.severity === 'pass') {
      const dimsStr = dims ? ` ${dims.w}x${dims.h}` : '';
      findings.push(mkFinding({
        ruleId: 'image.fileSizeOk',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [e.relPath],
        message: `${e.name}: ${sizeMB} MB${dimsStr} — within size budget.`,
        data: { gauge: gaugeData }
      }));
    }
  }

  if (imageCount > 0 && nonPotCount === 0 && potCats.size > 0) {
    findings.push(mkFinding({
      ruleId: 'image.allPot',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [],
      message: `All POT-required PNGs have power-of-two dimensions.`
    }));
  }

  return findings;
}

function categoryFromTop(top) {
  if (!top) return null;
  if (top.includes('symbol')) return 'symbols';
  if (top.includes('background')) return 'backgrounds';
  if (top.includes('button')) return 'ui';
  if (top.includes('popup')) return 'ui';
  return null;
}
