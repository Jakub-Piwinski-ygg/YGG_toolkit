import { mkFinding } from '../findings.js';
import { parseAtlasRegions } from './spineJson.js';

const CAT = '5. Atlas';

function isPot(n) { return n > 0 && (n & (n - 1)) === 0; }

function categoryOf(path, cfg) {
  const lower = path.toLowerCase();
  if (lower.includes('symbol')) return 'symbols';
  if (lower.includes('winseq') || lower.includes('win_sequence') || lower.includes('winsequence')) return 'winseq';
  if (lower.includes('bg') || lower.includes('background')) return 'backgrounds';
  if (lower.includes('ui') || lower.includes('button') || lower.includes('popup')) return 'ui';
  return 'default';
}

export async function run(ctx) {
  const { index, config } = ctx;
  const cfg = config.atlas || {};
  const findings = [];
  const atlases = index.byExt.get('atlas') || [];

  // group atlases by their base (.json) skeleton
  const pagesPerSkeleton = new Map();

  const fillWarn = cfg.fillRatioWarn ?? 0.55;
  const fillMinPageArea = cfg.fillMinPageAreaPx ?? 1024 * 1024; // skip tiny atlases

  for (const a of atlases) {
    const text = await a.file.text();
    const pages = parseAtlasPages(text);
    const cat = categoryOf(a.relPath, cfg);
    const cap = (cfg.categorySizeCaps || {})[cat] || (cfg.categorySizeCaps || {}).default;

    for (const p of pages) {
      // 5.1 page count + dims; check POT for POT categories
      if ((cfg.potCategories || []).includes(cat)) {
        if (!isPot(p.w) || !isPot(p.h)) {
          findings.push(mkFinding({
            ruleId: 'atlas.nonPot',
            severity: 'warn',
            priority: 2,
            category: CAT,
            paths: [a.relPath],
            message: `Atlas page "${p.name}" is non-POT (${p.w}x${p.h}); category "${cat}" requires POT.`
          }));
        }
      }
      // 5.2 size cap — atlases pack either orientation, so allow w/h to map
      // either way (e.g. 4096x644 fits a 2048x4096 cap rotated).
      if (cap) {
        const capLong = Math.max(cap.maxW, cap.maxH);
        const capShort = Math.min(cap.maxW, cap.maxH);
        const pageLong = Math.max(p.w, p.h);
        const pageShort = Math.min(p.w, p.h);
        if (pageLong > capLong || pageShort > capShort) {
          findings.push(mkFinding({
            ruleId: 'atlas.sizeCap',
            severity: 'error',
            priority: 1,
            category: CAT,
            paths: [a.relPath],
            message: `Atlas page "${p.name}" is ${p.w}x${p.h}, exceeds cap ${cap.maxW}x${cap.maxH} (or ${cap.maxH}x${cap.maxW}) for "${cat}".`
          }));
        }
      }
    }

    // 5.3 page count per skeleton
    const base = a.name.replace(/\.atlas$/i, '');
    pagesPerSkeleton.set(`${a.dir}/${base}`, pages.length);

    if (pages.length >= (cfg.maxPagesPerSkeletonError || 4)) {
      findings.push(mkFinding({
        ruleId: 'atlas.tooManyPages',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [a.relPath],
        message: `Atlas has ${pages.length} pages — way over budget.`
      }));
    } else if (pages.length >= (cfg.maxPagesPerSkeletonWarn || 2)) {
      findings.push(mkFinding({
        ruleId: 'atlas.tooManyPages',
        severity: 'warn',
        priority: 2,
        category: CAT,
        paths: [a.relPath],
        message: `Atlas has ${pages.length} pages — consider repacking to a single page.`
      }));
    }

    // 5.4 / 10.3 atlas fill ratio (sum of region areas vs page area)
    const fillRows = [];
    let fillRatioBad = false;
    for (const p of pages) {
      const pageArea = p.w * p.h;
      if (!pageArea || pageArea < fillMinPageArea) continue;
      const usedArea = p.regions.reduce((s, r) => s + (r.w * r.h), 0);
      const ratio = usedArea / pageArea;
      const pct = Math.round(ratio * 100);
      fillRows.push([p.name, `${p.w}x${p.h}`, `${p.regions.length}`, `${pct}%`]);
      if (ratio < fillWarn) {
        fillRatioBad = true;
        findings.push(mkFinding({
          ruleId: 'atlas.lowFillRatio',
          severity: 'info',
          priority: 4,
          category: CAT,
          paths: [a.relPath],
          message: `Atlas page "${p.name}" is ${pct}% full (${p.regions.length} region(s) on ${p.w}x${p.h}) — under ${Math.round(fillWarn * 100)}% threshold.`
        }));
      }
    }
    if (fillRows.length > 0 && !fillRatioBad) {
      findings.push(mkFinding({
        ruleId: 'atlas.fillRatioOk',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [a.relPath],
        message: `${a.name}: atlas fill ratio within budget.`,
        data: {
          kind: 'matrix',
          title: 'Atlas fill ratio',
          columns: ['Page', 'Size', 'Regions', 'Fill'],
          rows: fillRows
        }
      }));
    }

    // emit a pass per atlas if size & page count within budget
    const fitsCap = (p) => {
      if (!cap) return true;
      const cl = Math.max(cap.maxW, cap.maxH), cs = Math.min(cap.maxW, cap.maxH);
      const pl = Math.max(p.w, p.h), ps = Math.min(p.w, p.h);
      return pl <= cl && ps <= cs;
    };
    if (pages.length > 0 &&
        pages.every(fitsCap) &&
        pages.length < (cfg.maxPagesPerSkeletonWarn || 2)) {
      findings.push(mkFinding({
        ruleId: 'atlas.withinBudget',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [a.relPath],
        message: `${a.name}: ${pages.length} page(s), within size and page-count budget.`
      }));
    }

    // 2.7 atlas page filename ↔ disk file (case-sensitive)
    for (const p of pages) {
      const expected = `${a.dir}/${p.name}`;
      const ci = index.hasCi(expected);
      if (!ci) {
        findings.push(mkFinding({
          ruleId: 'naming.atlasPageMissing',
          severity: 'error',
          priority: 1,
          category: '2. Naming',
          paths: [a.relPath],
          message: `Atlas references PNG page "${p.name}" but it doesn't exist on disk.`
        }));
      } else if (ci !== expected) {
        findings.push(mkFinding({
          ruleId: 'naming.atlasPageMissing',
          severity: 'error',
          priority: 1,
          category: '2. Naming',
          paths: [a.relPath, ci],
          message: `Atlas references "${p.name}" but disk file is "${ci.split('/').pop()}" (case differs).`
        }));
      }
    }
  }

  return findings;
}

export function parseAtlasPages(atlasText) {
  // libgdx / Spine atlas format. Page block starts with PNG filename and
  // header attributes (size, format, filter, repeat). Subsequent unindented
  // non-image lines are region names; their indented attrs include the
  // packed `size: w,h` (post-trim, what actually consumes atlas space).
  // We treat the first `size:` after a region name as that region's size.
  const lines = atlasText.split(/\r?\n/);
  const pages = [];
  let curPage = null;
  let curRegion = null;
  let pageSizeCaptured = false;
  let regionSizeCaptured = false;

  const pushRegion = () => {
    if (curPage && curRegion && curRegion.w > 0 && curRegion.h > 0) {
      curPage.regions.push(curRegion);
    }
    curRegion = null;
    regionSizeCaptured = false;
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    const isIndented = /^[ \t]/.test(raw);

    if (!trimmed) {
      pushRegion();
      continue;
    }

    if (!isIndented && /\.(png|webp|jpg)$/i.test(trimmed)) {
      pushRegion();
      if (curPage) pages.push(curPage);
      curPage = { name: trimmed, w: 0, h: 0, regions: [] };
      pageSizeCaptured = false;
      continue;
    }

    if (!isIndented && trimmed.includes(':')) {
      // Page-level attribute (size / format / filter / repeat).
      if (curPage && !pageSizeCaptured) {
        const m = trimmed.match(/^size\s*:\s*(\d+)\s*[,xX]\s*(\d+)/);
        if (m) {
          curPage.w = +m[1]; curPage.h = +m[2];
          pageSizeCaptured = true;
        }
      }
      continue;
    }

    if (!isIndented && !trimmed.includes(':')) {
      pushRegion();
      curRegion = { name: trimmed, w: 0, h: 0 };
      continue;
    }

    if (isIndented && curPage && curRegion) {
      const m = trimmed.match(/^size\s*:\s*(\d+)\s*[,xX]\s*(\d+)/);
      if (m && !regionSizeCaptured) {
        curRegion.w = +m[1]; curRegion.h = +m[2];
        regionSizeCaptured = true;
      }
    }
  }
  pushRegion();
  if (curPage) pages.push(curPage);
  return pages;
}
