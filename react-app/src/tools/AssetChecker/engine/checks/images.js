import { mkFinding } from '../findings.js';
import { isUnderSource, isUnderPreview } from '../spineTriplet.js';

const CAT = '6. Images';

const SIZE_IDEAL = 4 * 1024 * 1024;   // ≤ 4 MB → pass (green)
const SIZE_BAD   = 16 * 1024 * 1024;  // ≥ 16 MB → error (red)

function isPot(n) { return n > 0 && (n & (n - 1)) === 0; }

async function pngDims(file) {
  const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const view = new DataView(buf.buffer);
  return { w: view.getUint32(16), h: view.getUint32(20) };
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
  const pngs = (index.byExt.get('png') || []).filter((e) => !isUnderSource(e) && !isUnderPreview(e));
  const potCats = new Set(cfg.potCategories || []);
  let nonPotCount = 0;
  let bigCount = 0;
  let imageCount = 0;

  for (const e of pngs) {
    imageCount++;
    const dims = await pngDims(e.file);
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
        message: `PNG ${dims.w}x${dims.h} exceeds max-axis ${cfg.maxAxisPx}px.`
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
