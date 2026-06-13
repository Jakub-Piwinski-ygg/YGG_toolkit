#!/usr/bin/env node
// Asset Library import helper — does the *mechanical* half of an import.
// The importing agent decides WHAT to import and into WHICH category
// (see docs/ASSET_LIBRARY_IMPORT.md); this script converts, thumbnails,
// zips and keeps public/assetLibrary/manifest.json consistent.
//
// Static images:
//   node scripts/asset-library-add.mjs --category noise --license vfxstudio \
//        --source "VFX_Texture_Library_v1.0.0" [--tags a,b] [--name "X"] [--slug x] [--slug-prefix pack] <files…>
//
// Frame sequences (each input is a DIRECTORY of numbered frames):
//   node scripts/asset-library-add.mjs --seq --fps 30 --category noise \
//        --license vfxstudio --source "…" [--slug x] [--slug-prefix pack] <frameDirs…>
//
// Validation:
//   node scripts/asset-library-add.mjs --validate
//
// Requires ImageMagick CLI (`magick`) on PATH. PNG output is lossless;
// thumbs are 256px WebP; sequence previews are animated WebP (~15 fps).

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'public', 'assetLibrary');
const MANIFEST = path.join(LIB, 'manifest.json');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.tga', '.bmp', '.gif', '.tif', '.tiff']);
const PREVIEW_FPS = 15; // animated-webp preview frame rate (frames are subsampled to this)

// ---------- small utils ----------

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }
function warn(msg) { console.warn(`WARN: ${msg}`); }

function slugify(s) {
  return s
    .normalize('NFKD')
    .replace(/[×x](?=\d)/g, 'x')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function normalizeSlugPrefix(s) {
  const p = slugify(s || '');
  return p ? `${p}-` : '';
}

function prettyName(slug) {
  const seq = slug.endsWith('-seq');
  const base = (seq ? slug.slice(0, -4) : slug)
    .split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  return seq ? `${base} (sequence)` : base;
}

function magick(args, context) {
  const r = spawnSync('magick', args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  if (r.error) die(`magick not runnable (${r.error.message}) — is ImageMagick installed?`);
  if (r.status !== 0) die(`magick failed (${context}): ${r.stderr || r.stdout}`);
}

// PNG dimensions straight from the IHDR chunk — no image deps needed.
function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  if (buf.readUInt32BE(0) !== 0x89504e47) die(`${file} is not a PNG`);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) {
    return {
      categories: [
        { id: 'noise', label: 'Noise', icon: '🌫️' },
        { id: 'flowmaps', label: 'Flowmaps', icon: '🌀' },
        { id: 'particles', label: 'Particles', icon: '✨' },
        { id: 'texture', label: 'Textures', icon: '🎨' },
        { id: 'basics', label: 'Basics', icon: '⬜' },
        { id: 'trails', label: 'Trails', icon: '💫' },
        { id: 'patterns', label: 'Patterns', icon: '🔷' },
        { id: 'ui', label: 'UI', icon: '🎛️' }
      ],
      licenses: {
        cc0: { label: 'CC0 — public domain', file: 'licenses/cc0.txt' },
        unknown: { label: 'License unknown — check with lead before external use', file: null }
      },
      assets: []
    };
  }
  // Strip a UTF-8 BOM if present — PowerShell 5.1 tooling loves to add one.
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8').replace(/^﻿/, ''));
}

function saveManifest(m) {
  m.assets.sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));
  fs.mkdirSync(LIB, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');
}

// ---------- arg parsing ----------

const argv = process.argv.slice(2);
const opts = { tags: [], inputs: [] };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  switch (a) {
    case '--validate': opts.validate = true; break;
    case '--seq': opts.seq = true; break;
    case '--category': opts.category = argv[++i]; break;
    case '--license': opts.license = argv[++i]; break;
    case '--source': opts.source = argv[++i]; break;
    case '--name': opts.name = argv[++i]; break;
    case '--slug': opts.slug = argv[++i]; break;
    case '--slug-prefix': opts.slugPrefix = argv[++i]; break;
    case '--fps': opts.fps = Number(argv[++i]); break;
    case '--tags': opts.tags = argv[++i].split(',').map((t) => t.trim()).filter(Boolean); break;
    default:
      if (a.startsWith('--')) die(`unknown option ${a}`);
      opts.inputs.push(a);
  }
}

const slugPrefix = opts.slug ? '' : normalizeSlugPrefix(opts.slugPrefix);

// ---------- validate mode ----------

function validate() {
  if (!fs.existsSync(MANIFEST)) die('no manifest.json — nothing imported yet');
  const m = loadManifest();
  const catIds = new Set(m.categories.map((c) => c.id));
  const expected = new Set(['manifest.json']);
  let errors = 0;
  const seen = new Set();

  for (const a of m.assets) {
    const id = a.slug || a.file;
    if (!a.slug || !a.name || !a.category || !a.file || !a.thumb || !a.license || !(a.w > 0) || !(a.h > 0)) {
      console.error(`  ✗ ${id}: missing required field(s)`); errors++;
    }
    if (seen.has(a.slug)) { console.error(`  ✗ duplicate slug ${a.slug}`); errors++; }
    seen.add(a.slug);
    if (!catIds.has(a.category)) { console.error(`  ✗ ${id}: unknown category "${a.category}"`); errors++; }
    if (!m.licenses[a.license]) { console.error(`  ✗ ${id}: unknown license "${a.license}"`); errors++; }
    if (a.type === 'sequence' && !(a.frames > 0)) { console.error(`  ✗ ${id}: sequence without frames count`); errors++; }
    for (const f of [a.file, a.thumb, a.origFile]) {
      if (!f) continue;
      expected.add(f.replace(/\//g, path.sep));
      if (!fs.existsSync(path.join(LIB, f))) { console.error(`  ✗ ${id}: missing file ${f}`); errors++; }
    }
  }
  for (const [, lic] of Object.entries(m.licenses)) {
    if (lic.file) {
      expected.add(lic.file.replace(/\//g, path.sep));
      if (!fs.existsSync(path.join(LIB, lic.file))) { console.error(`  ✗ missing license file ${lic.file}`); errors++; }
    }
  }
  // Orphans: files on disk no manifest entry points at.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
  for (const f of walk(LIB)) {
    const rel = path.relative(LIB, f);
    if (rel.startsWith('licenses' + path.sep)) continue;
    if (!expected.has(rel)) { console.error(`  ✗ orphan file (no manifest entry): ${rel}`); errors++; }
  }
  if (errors) die(`validation failed with ${errors} problem(s)`);
  console.log(`OK: ${m.assets.length} assets, ${m.categories.length} categories — manifest and files are consistent.`);
}

// ---------- import modes ----------

function requireCommonOpts(m) {
  if (!opts.category) die('--category is required');
  if (!opts.license) die('--license is required');
  if (!opts.source) die('--source is required');
  if (!m.categories.some((c) => c.id === opts.category)) {
    die(`unknown category "${opts.category}" — add it to manifest.json categories first`);
  }
  if (!m.licenses[opts.license]) {
    die(`unknown license "${opts.license}" — add it to manifest.json licenses (+ licenses/<id>.txt) first`);
  }
  if (opts.inputs.length === 0) die('no input files/directories given');
  if (opts.slug && opts.inputs.length > 1) die('--slug only makes sense with a single input');
  if (opts.name && opts.inputs.length > 1) die('--name only makes sense with a single input');
}

function entryBase(slug) {
  return {
    slug,
    name: opts.name || prettyName(slug),
    category: opts.category,
    license: opts.license,
    source: opts.source,
    ...(opts.tags.length ? { tags: opts.tags } : {})
  };
}

function addStatics(m) {
  const catDir = path.join(LIB, opts.category);
  const thumbDir = path.join(catDir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  let added = 0, skipped = 0;

  for (const input of opts.inputs) {
    if (!fs.existsSync(input)) { warn(`missing input ${input} — skipped`); skipped++; continue; }
    const ext = path.extname(input).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) { warn(`${input}: not an image — skipped`); skipped++; continue; }
    const baseSlug = slugify(path.basename(input, ext));
    const slug = opts.slug || `${slugPrefix}${baseSlug}`.replace(/^-+|-+$/g, '');
    if (!slug) { warn(`${input}: empty slug — skipped`); skipped++; continue; }
    if (m.assets.some((a) => a.slug === slug)) { warn(`slug "${slug}" already in library — skipped (${input})`); skipped++; continue; }

    const pngRel = `${opts.category}/${slug}.png`;
    const pngAbs = path.join(LIB, pngRel);
    if (ext === '.png') {
      fs.copyFileSync(input, pngAbs);
    } else {
      magick([input, 'PNG32:' + pngAbs], input);
    }
    const thumbRel = `${opts.category}/thumbs/${slug}.webp`;
    magick([pngAbs, '-resize', '256x256>', '-quality', '80', path.join(LIB, thumbRel)], `thumb ${slug}`);

    const { w, h } = pngSize(pngAbs);
    const entry = {
      ...entryBase(slug),
      file: pngRel,
      thumb: thumbRel,
      w, h,
      bytes: fs.statSync(pngAbs).size,
      origFormat: ext.slice(1).replace('jpeg', 'jpg')
    };
    if (ext !== '.png') {
      const origRel = `${opts.category}/${slug}${ext}`;
      fs.copyFileSync(input, path.join(LIB, origRel));
      entry.origFile = origRel;
      entry.origBytes = fs.statSync(input).size;
    }
    m.assets.push(entry);
    added++;
    console.log(`  + ${slug}  (${w}x${h}, ${entry.origFormat})`);
  }
  return { added, skipped };
}

function addSequences(m) {
  const catDir = path.join(LIB, opts.category);
  const thumbDir = path.join(catDir, 'thumbs');
  fs.mkdirSync(thumbDir, { recursive: true });
  const fps = opts.fps || 30;
  let added = 0, skipped = 0;

  for (const dir of opts.inputs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) { warn(`${dir}: not a directory — skipped`); skipped++; continue; }
    const frames = fs.readdirSync(dir)
      .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((f) => path.join(dir, f));
    if (frames.length < 2) { warn(`${dir}: ${frames.length} frame(s) — not a sequence, skipped`); skipped++; continue; }

    // Slug from the shared frame-name prefix (e.g. Noise_00_0000.tga → noise-00).
    const first = path.basename(frames[0], path.extname(frames[0]));
    const inferred = slugify(first.replace(/[_-]?\d+$/, ''));
    const baseSlug = opts.slug || `${slugPrefix}${inferred}`.replace(/^-+|-+$/g, '');
    if (!baseSlug) { warn(`${dir}: empty slug — skipped`); skipped++; continue; }
    const slug = baseSlug.endsWith('-seq') ? baseSlug : `${baseSlug}-seq`;
    if (m.assets.some((a) => a.slug === slug)) { warn(`slug "${slug}" already in library — skipped (${dir})`); skipped++; continue; }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-lib-seq-'));
    try {
      // One mogrify per sequence — far faster than per-frame magick calls.
      const srcExt = path.extname(frames[0]).toLowerCase();
      if (srcExt === '.png') {
        for (const f of frames) fs.copyFileSync(f, path.join(tmp, path.basename(f)));
      } else {
        // Use an @list file instead of passing every frame path as a command
        // arg. This avoids Windows command-line length limits on long
        // sequences (e.g. 400+ frames with deep folder paths).
        const srcList = path.join(tmp, 'src-frames.txt');
        fs.writeFileSync(srcList, frames.map((f) => `'${f.replace(/\\/g, '/')}'`).join('\n'));
        magick(['mogrify', '-format', 'png', '-path', tmp, '@' + srcList], `mogrify ${dir}`);
      }
      const pngFrames = fs.readdirSync(tmp)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => path.join(tmp, f));
      if (pngFrames.length !== frames.length) die(`${dir}: converted ${pngFrames.length}/${frames.length} frames`);

      const zipRel = `${opts.category}/${slug}.zip`;
      const zip = new AdmZip();
      for (const f of pngFrames) zip.addLocalFile(f);
      zip.writeZip(path.join(LIB, zipRel));

      // Animated preview: subsample to ~PREVIEW_FPS, 256px lossy WebP.
      const step = Math.max(1, Math.round(fps / PREVIEW_FPS));
      const previewFrames = pngFrames.filter((_, i) => i % step === 0);
      const listFile = path.join(tmp, 'frames.txt');
      fs.writeFileSync(listFile, previewFrames.map((f) => `'${f.replace(/\\/g, '/')}'`).join('\n'));
      const thumbRel = `${opts.category}/thumbs/${slug}.webp`;
      magick([
        '-delay', `1x${Math.round(fps / step)}`,
        '@' + listFile,
        '-resize', '256x256>',
        '-loop', '0',
        '-quality', '60',
        path.join(LIB, thumbRel)
      ], `preview ${slug}`);

      const { w, h } = pngSize(pngFrames[0]);
      m.assets.push({
        ...entryBase(slug),
        type: 'sequence',
        file: zipRel,
        thumb: thumbRel,
        w, h,
        bytes: fs.statSync(path.join(LIB, zipRel)).size,
        frames: frames.length,
        fps,
        origFormat: srcExt.slice(1)
      });
      added++;
      console.log(`  + ${slug}  (${frames.length} frames @ ${fps}fps, ${w}x${h}, ${(fs.statSync(path.join(LIB, zipRel)).size / 1048576).toFixed(1)} MB zip)`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { added, skipped };
}

// ---------- main ----------

if (opts.validate) {
  validate();
} else {
  const m = loadManifest();
  requireCommonOpts(m);
  const { added, skipped } = opts.seq ? addSequences(m) : addStatics(m);
  if (added) saveManifest(m);
  console.log(`Done: ${added} added, ${skipped} skipped. Manifest: ${path.relative(process.cwd(), MANIFEST)}`);
}
