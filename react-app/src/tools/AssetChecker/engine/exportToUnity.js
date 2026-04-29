// exportToUnity — maps ingested entries to a Unity folder layout using
// explicit user-defined segment mappings + optional extension/suffix filters.
// No heuristics. Every routing decision is explicitly configured.
//
// Mapping schema:
//   srcSegment   : exact path-segment to match (case-insensitive)
//   extFilter    : optional comma-separated extensions e.g. "json,atlas" — blank = any ext
//   suffixFilter : optional filename stem suffix to match e.g. "_static" — blank = any name
//   dstFolder    : destination folder prefix in the zip
//   dstSuffix    : optional subfolder inserted AFTER parent segments and BEFORE the file
//                  If left blank on an "export" segment row, the engine auto-detects:
//                    · json / atlas → "Animations/"
//                    · PNG whose stem matches an atlas file in the same dir → "Animations/"
//                    · everything else → "StaticArt/"
//                  Files already inside a recognised sub-folder (Animation*, StaticArt*, etc.)
//                  are left in place so a correctly structured input is never double-nested.
//   includeParent: N segments before the matched segment to include in output path
//   flatten      : true = filename only (no sub-path after matched segment)
//
// Matching order: mappings checked top-to-bottom, first full match wins.
// Audio (.ogg/.wav/.mp3/.flac/.aiff) always routes to Audio/ regardless of mappings.
// Anything unmatched lands in fallbackFolder with its full relative path preserved,
// stripping the common root folder (e.g. the dropped folder name) automatically.

import JSZip from 'jszip';

// ---- defaults ---------------------------------------------------------------

export const DEFAULT_EXPORT_SETTINGS = {
  projectName: 'UnityExport',

  mappings: [
    // ── Editor preview files ────────────────────────────────────────────────
    { srcSegment: 'preview',  extFilter: '', suffixFilter: '', dstFolder: 'Art/_Previews/Editor', dstSuffix: '', flatten: false, includeParent: 1 },
    { srcSegment: 'previews', extFilter: '', suffixFilter: '', dstFolder: 'Art/_Previews/Editor', dstSuffix: '', flatten: false, includeParent: 1 },

    // ── Editor source files ─────────────────────────────────────────────────
    // Source folder → Art/_Source/Editor/<featureFolder>/<subPath>
    // (AnimationSources is inside Source, so matching Source correctly gives
    //  Art/_Source/Editor/<feature>/AnimationSources/file.spine)
    { srcSegment: 'source', extFilter: 'spine,psd,psb,ai,blend', suffixFilter: '', dstFolder: 'Art/_Source/Editor', dstSuffix: '', flatten: false, includeParent: 1 },
    { srcSegment: 'source', extFilter: '',                       suffixFilter: '', dstFolder: 'Art/_Source/Editor', dstSuffix: '', flatten: false, includeParent: 1 },

    // ── Runtime art — Export / export folder ────────────────────────────────
    // When dstSuffix is blank the engine auto-detects Animations vs StaticArt:
    //   · json / atlas.txt / atlas-PNG (same stem as atlas in same dir) → Animations/
    //   · everything else (other PNGs, sub-folders) → StaticArt/
    // Files already inside Animation*, StaticArt* etc. are left exactly where they are.
    // Set dstSuffix explicitly to override (e.g. force everything to a fixed folder).
    { srcSegment: 'export',  extFilter: '', suffixFilter: '', dstFolder: 'Art/_Game', dstSuffix: '', flatten: false, includeParent: 1 },

    // ── Named feature folders without an Export subfolder ───────────────────
    { srcSegment: '05_fonts', extFilter: '', suffixFilter: '', dstFolder: 'Art/_Game/Fonts', dstSuffix: '', flatten: false, includeParent: 0 },
    { srcSegment: 'fonts',    extFilter: '', suffixFilter: '', dstFolder: 'Art/_Game/Fonts', dstSuffix: '', flatten: false, includeParent: 0 },
  ],

  fallbackFolder: 'Art/_Game',

  rename: {
    transliterate:  false,
    spacesToKebab:  false,
    stripForbidden: false,
    trimDotsSpaces: false,
    pathBudget:     false,
    pascalCaseArt:  false,
  },
};

// ---- audio auto-route -------------------------------------------------------

const AUDIO_EXT = new Set(['ogg', 'wav', 'mp3', 'flac', 'aiff']);

// ---- Spine / atlas auto-detection -------------------------------------------

// The names of first-level sub-folders that indicate the input is already
// correctly organised — preserve them exactly as-is.
const ALREADY_ORGANISED = new Set([
  'animation', 'animations', 'staticart', 'statics',
  'sprites', 'spine', 'editor',
]);

// Pre-compute: for every directory that contains an atlas file, record the
// base-name(s) of those atlases.  Used to identify atlas-companion PNGs.
// e.g.  dir:"unity_export/02_Symbols/export"  →  stems: {"symbols"}
function buildAtlasStems(entries) {
  const map = new Map(); // dir → Set<lowercaseStem>
  for (const e of entries) {
    if (e.ext !== 'atlas') continue;
    // "symbols.atlas.txt" → strip all extensions → "symbols"
    const stem = e.name.replace(/(\.\w+)+$/, '').toLowerCase();
    if (!map.has(e.dir)) map.set(e.dir, new Set());
    map.get(e.dir).add(stem);
  }
  return map;
}

// Returns "Animations", "StaticArt", or "" (preserve, already organised).
function spineAutoSuffix(entry, afterSegs, atlasMap) {
  // afterSegs = path segments after the matched segment, including the filename.
  // If the first sub-folder is already a well-known organised name → leave it.
  if (afterSegs.length > 1 && ALREADY_ORGANISED.has(afterSegs[0].toLowerCase())) {
    return '';
  }

  const ext = (entry.ext || '').toLowerCase();

  // json and .atlas.txt files are always Spine runtime assets
  if (ext === 'json' || ext === 'atlas') return 'Animations';

  // PNG: atlas-companion if its stem matches an atlas file in the same directory
  if (ext === 'png') {
    const stem = entry.name.replace(/\.[^.]+$/, '').toLowerCase();
    const dirStems = atlasMap.get(entry.dir);
    if (dirStems && dirStems.has(stem)) return 'Animations';
    return 'StaticArt';
  }

  // Everything else → StaticArt
  return 'StaticArt';
}

// ---- mapping logic ----------------------------------------------------------

function matchesFilters(entry, m) {
  const ext  = (entry.ext  || '').toLowerCase();
  const name = (entry.name || '').toLowerCase();

  if (m.extFilter && m.extFilter.trim()) {
    const allowed = m.extFilter.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!allowed.some((a) => ext === a || name.endsWith('.' + a))) return false;
  }

  if (m.suffixFilter && m.suffixFilter.trim()) {
    const sf   = m.suffixFilter.trim().toLowerCase();
    const dot  = name.lastIndexOf('.');
    const stem = dot >= 0 ? name.slice(0, dot) : name;
    if (!stem.endsWith(sf)) return false;
  }

  return true;
}

// Detect whether all entries share the same root segment (dropped folder name).
// Returns 1 if so → strip that segment in fallback, else 0.
function detectRootDepth(entries) {
  if (entries.length < 2) return 0;
  const first = entries[0].segments[0];
  if (!first) return 0;
  return entries.every((e) => e.segments[0] === first) ? 1 : 0;
}

// Segments that trigger auto-detection when dstSuffix is blank.
const EXPORT_SEGS = new Set(['export', 'exports']);

function resolveTarget(entry, mappings, fallbackFolder, rootDepth, atlasMap) {
  const segs = entry.segments; // includes filename as last element
  const ext  = (entry.ext || '').toLowerCase();

  if (AUDIO_EXT.has(ext)) return `Audio/${entry.name}`;

  for (const m of mappings) {
    const needle = (m.srcSegment || '').toLowerCase().trim();
    if (!needle) continue;
    // Search only the directory segments (exclude filename = last element)
    const idx = segs.slice(0, -1).findIndex((s) => s.toLowerCase() === needle);
    if (idx === -1) continue;
    if (!matchesFilters(entry, m)) continue;

    const dst        = (m.dstFolder || fallbackFolder).replace(/\/+$/, '');
    const n          = Math.max(0, parseInt(m.includeParent, 10) || 0);
    const parentSegs = n > 0 ? segs.slice(Math.max(0, idx - n), idx) : [];
    const afterSegs  = segs.slice(idx + 1); // includes filename

    // Determine the sub-folder to insert between parent and file path.
    // Explicit dstSuffix always wins; otherwise auto-detect for export segments.
    let sub = (m.dstSuffix || '').trim();
    if (!sub && EXPORT_SEGS.has(needle)) {
      sub = spineAutoSuffix(entry, afterSegs, atlasMap);
    }

    const base    = [dst, ...parentSegs, ...(sub ? [sub] : [])];
    const subPath = afterSegs.join('/') || entry.name;

    if (m.flatten) return [...base, entry.name].join('/');
    return [...base, subPath].join('/');
  }

  // Fallback: preserve full relative path under fallbackFolder, stripping the
  // common root wrapper (e.g. the dropped "unity_export" folder name).
  const fb       = (fallbackFolder || 'Art/_Game').replace(/\/+$/, '');
  const pathSegs = rootDepth > 0 ? segs.slice(rootDepth) : segs;
  return `${fb}/${pathSegs.join('/')}`;
}

// ---- name sanitization ------------------------------------------------------

const POLISH_MAP = {
  ą:'a',ć:'c',ę:'e',ł:'l',ń:'n',ó:'o',ś:'s',ź:'z',ż:'z',
  Ą:'A',Ć:'C',Ę:'E',Ł:'L',Ń:'N',Ó:'O',Ś:'S',Ź:'Z',Ż:'Z',
};
const FORBIDDEN_RE = /[#%&*:<>?\\{|}~"']/g;

function transliterate(s) {
  let out = '';
  for (const ch of s) out += POLISH_MAP[ch] ?? ch;
  return out.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
}

function pascalCaseBasename(name) {
  const dot  = name.lastIndexOf('.');
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext  = dot >= 0 ? name.slice(dot)    : '';
  return stem.split(/[-_\s]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join('') + ext;
}

export function sanitizePath(path, rules, { isArt }) {
  const hits = [];
  const parts = path.split('/').filter(Boolean);
  const out = parts.map((seg, idx) => {
    const isLast = idx === parts.length - 1;
    let s = seg;
    if (rules.transliterate)  { const t = transliterate(s);                  if (t !== s) { hits.push('transliterate');  s = t; } }
    if (rules.spacesToKebab)  { const t = s.replace(/\s+/g, '-');             if (t !== s) { hits.push('spacesToKebab');  s = t; } }
    if (rules.stripForbidden) { const t = s.replace(FORBIDDEN_RE, '');        if (t !== s) { hits.push('stripForbidden'); s = t; } }
    if (rules.trimDotsSpaces) { const t = s.replace(/^[.\s]+|[.\s]+$/g, ''); if (t !== s) { hits.push('trimDotsSpaces'); s = t; } }
    if (isLast && isArt && rules.pascalCaseArt) { const t = pascalCaseBasename(s); if (t !== s) { hits.push('pascalCaseArt'); s = t; } }
    return s || seg;
  });
  let final = out.join('/');
  if (rules.pathBudget && final.length > 150) {
    const ls   = final.lastIndexOf('/');
    const dir  = ls >= 0 ? final.slice(0, ls + 1) : '';
    const base = ls >= 0 ? final.slice(ls + 1) : final;
    const dot  = base.lastIndexOf('.');
    const stem = dot >= 0 ? base.slice(0, dot) : base;
    const ext  = dot >= 0 ? base.slice(dot)    : '';
    const room = Math.max(8, 150 - dir.length - ext.length);
    if (stem.length > room) { hits.push('pathBudget'); final = dir + stem.slice(0, room) + ext; }
  }
  return { path: final, hits: [...new Set(hits)] };
}

// ---- planning ---------------------------------------------------------------

function isArtPath(p) {
  const lower = p.toLowerCase();
  return !lower.includes('/_source/') && !lower.includes('/_previews/')
      && !lower.startsWith('_source/')  && !lower.startsWith('_previews/')
      && !lower.startsWith('audio/');
}

export function planExport(entries, settings) {
  const { mappings = [], fallbackFolder = 'Art/_Game', rename = {} } = settings;
  const rootDepth = detectRootDepth(entries);
  const atlasMap  = buildAtlasStems(entries);

  const items = entries.map((entry) => {
    const originalTarget = resolveTarget(entry, mappings, fallbackFolder, rootDepth, atlasMap);
    const sanitized      = sanitizePath(originalTarget, rename, { isArt: isArtPath(originalTarget) });
    return {
      entry,
      originalTarget,
      renamedTarget: sanitized.path,
      ruleHits:      sanitized.hits,
      apply:         sanitized.hits.length > 0,
      conflict:      false,
    };
  });
  return recomputeConflicts(items);
}

export function recomputeConflicts(items) {
  const seen = new Map();
  for (const it of items) {
    it.conflict = false;
    const key = (it.apply ? it.renamedTarget : it.originalTarget).toLowerCase();
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(it);
  }
  for (const [, group] of seen) {
    if (group.length > 1) for (const it of group) it.conflict = true;
  }
  return items;
}

// ---- zip building -----------------------------------------------------------

export async function buildZip(items, settings, onProgress) {
  const zip  = new JSZip();
  const root = zip.folder(settings.projectName || 'UnityExport');
  let i = 0;
  for (const it of items) {
    const target = it.apply && !it.conflict ? it.renamedTarget : it.originalTarget;
    root.file(target, await it.entry.file.arrayBuffer());
    if (onProgress && (++i % 50 === 0 || i === items.length)) onProgress(`packing ${i}/${items.length}`);
  }
  return zip.generateAsync({ type: 'blob', compression: 'STORE' }, (m) => {
    if (onProgress) onProgress(`building ${m.percent.toFixed(0)}%`);
  });
}
