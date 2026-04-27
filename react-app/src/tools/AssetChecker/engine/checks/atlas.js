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
      // 5.2 size cap
      if (cap && (p.w > cap.maxW || p.h > cap.maxH)) {
        findings.push(mkFinding({
          ruleId: 'atlas.sizeCap',
          severity: 'error',
          priority: 1,
          category: CAT,
          paths: [a.relPath],
          message: `Atlas page "${p.name}" is ${p.w}x${p.h}, exceeds cap ${cap.maxW}x${cap.maxH} for "${cat}".`
        }));
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

    // emit a pass per atlas if size & page count within budget
    if (pages.length > 0 &&
        pages.every((p) => !cap || (p.w <= cap.maxW && p.h <= cap.maxH)) &&
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
  // A page block starts with the PNG filename, followed by indented attributes.
  // libgdx atlas format: filename line, then "size: WxH", "filter: ...", etc.
  const lines = atlasText.split(/\r?\n/);
  const pages = [];
  let cur = null;
  for (const line of lines) {
    if (/\.(png|webp|jpg)$/i.test(line.trim()) && !line.startsWith(' ') && !line.startsWith('\t')) {
      if (cur) pages.push(cur);
      cur = { name: line.trim(), w: 0, h: 0 };
      continue;
    }
    if (cur) {
      const m = line.match(/^\s*size\s*:\s*(\d+)\s*[,xX]\s*(\d+)/);
      if (m) { cur.w = +m[1]; cur.h = +m[2]; }
    }
  }
  if (cur) pages.push(cur);
  return pages;
}
