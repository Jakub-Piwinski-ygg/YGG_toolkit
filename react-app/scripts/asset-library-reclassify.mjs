#!/usr/bin/env node
// Reclassify Asset Library entries by slug/name keywords.
// Usage:
//   node scripts/asset-library-reclassify.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIB = path.join(ROOT, 'public', 'assetLibrary');
const MANIFEST = path.join(ROOT, 'public', 'assetLibrary', 'manifest.json');

function addCategoryIfMissing(categories, cat) {
  if (!categories.some((c) => c.id === cat.id)) categories.push(cat);
}

function classify(asset) {
  const text = `${asset.slug || ''} ${asset.name || ''}`.toLowerCase();

  if (/\bflowmap\b/.test(text)) return 'flowmaps';
  if (/\bparticle\b/.test(text)) return 'particles';
  if (/\bline\b/.test(text)) return 'trails';
  if (/\b(noise|aura)\b/.test(text)) return 'noise';
  return asset.category;
}

function remapCategoryPrefix(relPath, fromCategory, toCategory) {
  if (!relPath) return relPath;
  const from = `${fromCategory}/`;
  if (!relPath.startsWith(from)) return relPath;
  return `${toCategory}/${relPath.slice(from.length)}`;
}

function moveIfNeeded(oldRel, newRel) {
  if (!oldRel || !newRel || oldRel === newRel) return;
  const oldAbs = path.join(LIB, oldRel);
  const newAbs = path.join(LIB, newRel);
  if (!fs.existsSync(oldAbs)) return;
  fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  fs.renameSync(oldAbs, newAbs);
}

function pruneEmptyDirs(root) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) pruneEmptyDirs(path.join(root, entry.name));
  }
  if (fs.readdirSync(root).length === 0) fs.rmdirSync(root);
}

function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`ERROR: missing manifest: ${MANIFEST}`);
    process.exit(1);
  }

  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8').replace(/^\uFEFF/, ''));

  addCategoryIfMissing(m.categories, { id: 'flowmaps', label: 'Flowmaps', icon: '🌀' });
  addCategoryIfMissing(m.categories, { id: 'particles', label: 'Particles', icon: '✨' });

  // Keep category order stable and intentional.
  const order = ['noise', 'flowmaps', 'particles', 'texture', 'basics', 'trails', 'patterns', 'ui'];
  m.categories.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  let changed = 0;
  const moved = { file: 0, thumb: 0, origFile: 0 };
  for (const a of m.assets) {
    const prevCategory = a.category;
    const next = classify(a);
    if (next !== prevCategory) {
      const oldFile = a.file;
      const oldThumb = a.thumb;
      const oldOrig = a.origFile;

      const newFile = remapCategoryPrefix(oldFile, prevCategory, next);
      const newThumb = remapCategoryPrefix(oldThumb, prevCategory, next);
      const newOrig = remapCategoryPrefix(oldOrig, prevCategory, next);

      moveIfNeeded(oldFile, newFile);
      moveIfNeeded(oldThumb, newThumb);
      moveIfNeeded(oldOrig, newOrig);

      if (oldFile && newFile !== oldFile) moved.file++;
      if (oldThumb && newThumb !== oldThumb) moved.thumb++;
      if (oldOrig && newOrig !== oldOrig) moved.origFile++;

      a.file = newFile;
      a.thumb = newThumb;
      if (oldOrig) a.origFile = newOrig;
      a.category = next;
      changed++;
    }
  }

  m.assets.sort((a, b) => a.category.localeCompare(b.category) || a.slug.localeCompare(b.slug));
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');

  // Best-effort cleanup for now-empty old category trees.
  for (const c of ['noise', 'texture', 'trails', 'flowmaps', 'particles']) {
    const thumbs = path.join(LIB, c, 'thumbs');
    pruneEmptyDirs(thumbs);
    pruneEmptyDirs(path.join(LIB, c));
  }

  console.log(`Reclassified ${changed} assets.`);
  console.log(`Moved files: file=${moved.file}, thumb=${moved.thumb}, origFile=${moved.origFile}`);
}

main();
