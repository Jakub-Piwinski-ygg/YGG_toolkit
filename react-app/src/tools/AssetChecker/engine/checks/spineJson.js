import { mkFinding } from '../findings.js';
import { compileRegex } from '../regex.js';
import { findSpineExports } from '../spineTriplet.js';

const CAT = '4. Spine JSON';

async function readJson(entry) {
  try {
    const text = await entry.file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function run(ctx) {
  const { index, config } = ctx;
  const cfg = config.spine || {};
  const findings = [];
  const target = cfg.targetVersion;
  const textPrefixes = cfg.textBonePrefixes || ['TEXT_', 'text_'];
  let textNameRe = null;
  if (cfg.textIndicatingBoneNameRegex) {
    try { textNameRe = compileRegex(cfg.textIndicatingBoneNameRegex); }
    catch (e) { /* ignore — checked.versionMismatch will still run */ }
  }
  // Slots parented to a TEXT_ bone whose name matches this regex are treated
  // as legitimate decorations (shadow, glow, halo, etc) — flagged at info,
  // not as a mock-text export error.
  let textBoneDecorationRe = null;
  try {
    textBoneDecorationRe = compileRegex(cfg.textBoneDecorationRegex || '(?i)(shadow|glow|halo|backdrop|blur|light|underlay|outline|stroke|gradient|fade)');
  } catch { /* fall through */ }

  const triplets = findSpineExports(index);
  const jsons = triplets.map((t) => t.json);

  // 2.6 base-name mismatch between json and atlas
  //   - single .json + atlas with different bases → real mismatch (warn)
  //   - many .json + one shared atlas → multi-skeleton pattern (info-pass; emit once)
  // Atlas+png are the runtime pair, so the atlas base is the source of truth;
  // suggested rename targets the .json.
  const multiAtlasReported = new Set();
  for (const t of triplets) {
    if (t.baseMismatch) {
      const atlasBase = t.atlas.name.replace(/\.atlas\.txt$/i, '').replace(/\.atlas$/i, '');
      findings.push(mkFinding({
        ruleId: 'naming.spineTripletMismatch',
        severity: 'warn',
        priority: 2,
        category: '2. Naming',
        paths: [t.json.relPath, t.atlas.relPath],
        message: `Spine triplet base names don't match: ${t.json.name} ↔ ${t.atlas.name}.`,
        data: { suggestion: { from: t.json.name, to: `${atlasBase}.json`, reason: 'rename .json to match the atlas + png pair' } }
      }));
    } else if (t.multiSkeleton && !multiAtlasReported.has(t.atlas.relPath)) {
      multiAtlasReported.add(t.atlas.relPath);
      findings.push(mkFinding({
        ruleId: 'spine.multiSkeletonAtlas',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [t.atlas.relPath],
        message: `${t.sharedAtlasJsonCount} skeletons share ${t.atlas.name} — multi-skeleton pattern (e.g. one atlas per Symbols project).`
      }));
    }
  }

  const versions = new Map();
  const skeletonStats = []; // { path, name, bones, verts } for §10.4 percentile

  // Per-atlas union of regions referenced by ALL skeletons sharing it.
  // (Multi-skeleton atlases share regions across skeletons; the unused-region
  // check must use the union, not each skeleton's individual references.)
  const atlasReferencedUnion = new Map(); // atlasPath → Set of refnames
  const atlasRegions = new Map();          // atlasPath → Set of regions

  for (const t of triplets) {
    const j = t.json;
    const data = await readJson(j);
    if (!data) {
      findings.push(mkFinding({
        ruleId: 'spine.parseError',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [j.relPath],
        message: `Failed to parse Spine JSON: ${j.name}`
      }));
      continue;
    }

    const ver = data.skeleton?.spine || 'unknown';
    versions.set(j.relPath, ver);

    // Per-rule pass tracking for THIS file. Each rule below sets its key to
    // false on the first violation so we know whether to emit a per-file pass.
    const rulePass = { '4.1': true, '4.2': true, '4.3': true, '4.5': true, '4.7': true, '4.8': true };

    // 4.1 spine version
    if (target && !ver.startsWith(target)) {
      rulePass['4.1'] = false;
      findings.push(mkFinding({
        ruleId: 'spine.versionMismatch',
        severity: 'error',
        priority: 1,
        category: CAT,
        paths: [j.relPath],
        message: `Spine version "${ver}" doesn't match target "${target}".`
      }));
    }

    const bones = data.bones || [];
    const slots = data.slots || [];
    const skins = data.skins || [];

    // index TEXT bones
    const isTextBone = (name) => textPrefixes.some((p) => name.startsWith(p));
    const boneTextStatus = new Map();
    for (const b of bones) boneTextStatus.set(b.name, isTextBone(b.name));

    // 4.2 mock text in export — slot parented to TEXT bone with attachments
    const slotByBone = new Map();
    for (const s of slots) {
      if (!s.bone) continue;
      if (!slotByBone.has(s.bone)) slotByBone.set(s.bone, []);
      slotByBone.get(s.bone).push(s);
    }

    const slotHasAttachment = new Set();
    for (const skin of skins) {
      const attachments = skin.attachments || skin; // spine 4.x vs 3.x layout
      for (const slotName of Object.keys(attachments || {})) {
        const atts = attachments[slotName] || {};
        if (Object.keys(atts).length > 0) slotHasAttachment.add(slotName);
      }
    }

    for (const [boneName, isText] of boneTextStatus) {
      if (!isText) continue;
      const childSlots = slotByBone.get(boneName) || [];
      for (const s of childSlots) {
        if (!slotHasAttachment.has(s.name)) continue;
        rulePass['4.2'] = false;
        const decoration =
          textBoneDecorationRe && (textBoneDecorationRe.test(s.name) || textBoneDecorationRe.test(boneName));
        if (decoration) {
          findings.push(mkFinding({
            ruleId: 'spine.textBoneDecoration',
            severity: 'info',
            priority: 4,
            category: CAT,
            paths: [j.relPath],
            message: `Decoration "${s.name}" sits under TEXT bone "${boneName}" — fine if intentional (shadow/glow/etc); ignore otherwise.`
          }));
        } else {
          findings.push(mkFinding({
            ruleId: 'spine.mockTextInExport',
            severity: 'error',
            priority: 1,
            category: CAT,
            paths: [j.relPath],
            message: `Mock text attachment found under TEXT bone "${boneName}" (slot "${s.name}") — delete before export.`
          }));
        }
      }
    }

    // 4.3 expected TEXT bone hint (bone name contains "win amount" etc but missing prefix)
    if (textNameRe) {
      for (const b of bones) {
        if (isTextBone(b.name)) continue;
        if (textNameRe.test(b.name)) {
          rulePass['4.3'] = false;
          findings.push(mkFinding({
            ruleId: 'naming.boneTextPrefix',
            severity: 'warn',
            priority: 2,
            category: CAT,
            paths: [j.relPath],
            message: `Bone "${b.name}" looks text-related but doesn't start with TEXT_/text_.`
          }));
        }
      }
    }

    // 4.5 budgets
    const boneCount = bones.length;
    let vertCount = 0;
    for (const skin of skins) {
      const attachments = skin.attachments || skin;
      for (const slotName of Object.keys(attachments || {})) {
        const atts = attachments[slotName] || {};
        for (const att of Object.values(atts)) {
          if (att.vertices) vertCount += Math.floor(att.vertices.length / 2);
        }
      }
    }
    skeletonStats.push({ path: j.relPath, name: j.name, bones: boneCount, verts: vertCount });

    if (cfg.boneCountWarn && boneCount > cfg.boneCountWarn) {
      rulePass['4.5'] = false;
      findings.push(mkFinding({
        ruleId: 'spine.budgetExceeded',
        severity: 'info',
        priority: 4,
        category: CAT,
        paths: [j.relPath],
        message: `Bone count ${boneCount} exceeds warn threshold ${cfg.boneCountWarn}.`
      }));
    }
    if (cfg.vertexCountWarn && vertCount > cfg.vertexCountWarn) {
      rulePass['4.5'] = false;
      findings.push(mkFinding({
        ruleId: 'spine.budgetExceeded',
        severity: 'info',
        priority: 4,
        category: CAT,
        paths: [j.relPath],
        message: `Vertex count ${vertCount} exceeds warn threshold ${cfg.vertexCountWarn}.`
      }));
    }

    // 4.7 animation lints
    const animations = data.animations || {};
    const lints = cfg.animationLints || [];
    for (const animName of Object.keys(animations)) {
      for (const lint of lints) {
        if (new RegExp(lint.regex).test(animName)) {
          rulePass['4.7'] = false;
          findings.push(mkFinding({
            ruleId: 'spine.animationLint',
            severity: 'warn',
            priority: 3,
            category: CAT,
            paths: [j.relPath],
            message: `Animation "${animName}": ${lint.message}`
          }));
        }
      }
    }

    // 4.8 attachment names should resolve in atlas
    const atlasEntry = t.atlas;
    const atlasPath = atlasEntry.relPath;
    if (atlasEntry) {
      let regionSet = atlasRegions.get(atlasPath);
      if (!regionSet) {
        const atlasText = await atlasEntry.file.text();
        regionSet = new Set(parseAtlasRegions(atlasText));
        atlasRegions.set(atlasPath, regionSet);
        atlasReferencedUnion.set(atlasPath, new Set());
      }
      const union = atlasReferencedUnion.get(atlasPath);
      for (const skin of skins) {
        const attachments = skin.attachments || skin;
        for (const slotName of Object.keys(attachments || {})) {
          for (const [attName, att] of Object.entries(attachments[slotName] || {})) {
            const refName = att.name || attName;
            union.add(refName);
            if (!regionSet.has(refName)) {
              rulePass['4.8'] = false;
              findings.push(mkFinding({
                ruleId: 'spine.attachmentUnresolved',
                severity: 'error',
                priority: 1,
                category: CAT,
                paths: [j.relPath, atlasPath],
                message: `Attachment "${refName}" not found in atlas — Unity import will fail.`
              }));
            }
          }
        }
      }
    }

    // Per-rule per-file passes for this Spine JSON
    const RULE_PASS_LABELS = {
      '4.1': `Spine version is "${ver}" (matches target).`,
      '4.2': `No mock-text attachments found under TEXT bones.`,
      '4.3': `All text-suggestive bones use the TEXT_/text_ prefix.`,
      '4.5': `Bone (${boneCount}) and vertex (${vertCount}) counts are within budget.`,
      '4.7': `All ${Object.keys(animations).length} animation name(s) pass naming lints.`,
      '4.8': `All attachment names resolve in the paired atlas.`
    };
    for (const ruleKey of Object.keys(rulePass)) {
      if (!rulePass[ruleKey]) continue;
      // skip 4.1 if version was unknown / no target
      if (ruleKey === '4.1' && !target) continue;
      // skip 4.7 if no lints configured
      if (ruleKey === '4.7' && !(cfg.animationLints || []).length) continue;
      findings.push(mkFinding({
        ruleId: `spine.rule${ruleKey.replace('.', '_')}Pass`,
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [j.relPath],
        message: `${j.name} — ${RULE_PASS_LABELS[ruleKey]}`
      }));
    }
  }

  // 10.4 bone/vertex outliers — flag the top percentile across the drop.
  // Only meaningful when several skeletons exist; needs at least the
  // configured minimum so a 2-skeleton drop doesn't auto-flag the larger one.
  const minForPercentile = cfg.percentileMinSkeletons ?? 4;
  const percentileCutoff = cfg.percentileCutoff ?? 0.95;
  if (skeletonStats.length >= minForPercentile) {
    const boneSorted = [...skeletonStats].map((s) => s.bones).sort((a, b) => a - b);
    const vertSorted = [...skeletonStats].map((s) => s.verts).sort((a, b) => a - b);
    const idx = Math.floor(percentileCutoff * (boneSorted.length - 1));
    const boneThresh = boneSorted[idx];
    const vertThresh = vertSorted[idx];
    const outliers = skeletonStats.filter((s) => s.bones >= boneThresh || s.verts >= vertThresh);
    for (const s of outliers) {
      const reasons = [];
      if (s.bones >= boneThresh) reasons.push(`bones=${s.bones}`);
      if (s.verts >= vertThresh) reasons.push(`vertices=${s.verts}`);
      findings.push(mkFinding({
        ruleId: 'spine.budgetOutlier',
        severity: 'info',
        priority: 4,
        category: CAT,
        paths: [s.path],
        message: `${s.name} is in the top ${Math.round((1 - percentileCutoff) * 100)}% (${reasons.join(', ')}) — review for optimisation.`
      }));
    }
    if (outliers.length === 0) {
      findings.push(mkFinding({
        ruleId: 'spine.budgetPercentileOk',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [],
        message: `No skeletons in the top ${Math.round((1 - percentileCutoff) * 100)}% bone/vertex bracket.`
      }));
    }
  }

  // 5.5 unused regions — computed against the UNION of all skeletons sharing
  // the atlas, so multi-skeleton atlases (e.g. Symbols) don't false-flag every
  // region used by a sibling skeleton.
  for (const [atlasPath, regionSet] of atlasRegions) {
    const referenced = atlasReferencedUnion.get(atlasPath) || new Set();
    const unused = [...regionSet].filter((r) => !referenced.has(r));
    const sharingJsons = triplets.filter((t) => t.atlas.relPath === atlasPath).map((t) => t.json.name);
    const sharedNote = sharingJsons.length > 1 ? ` (shared by ${sharingJsons.length} skeletons)` : '';
    if (unused.length > 0) {
      findings.push(mkFinding({
        ruleId: 'atlas.unusedRegion',
        severity: 'info',
        priority: 4,
        category: '5. Atlas',
        paths: [atlasPath],
        message: `${unused.length} region(s) in ${atlasPath.split('/').pop()} are not referenced by any skeleton${sharedNote}: ${unused.slice(0, 8).join(', ')}${unused.length > 8 ? `, +${unused.length - 8} more` : ''}.`,
        data: {
          kind: 'matrix',
          title: 'Unused regions',
          columns: ['Region'],
          rows: unused.map((r) => [r])
        }
      }));
    } else if (regionSet.size > 0) {
      findings.push(mkFinding({
        ruleId: 'atlas.allRegionsUsed',
        severity: 'pass',
        priority: 5,
        category: '5. Atlas',
        paths: [atlasPath],
        message: `All ${regionSet.size} region(s) in ${atlasPath.split('/').pop()} are referenced${sharedNote}.`
      }));
    }
  }

  // 11.1 spine version drift
  const allVers = [...new Set(versions.values())];
  if (allVers.length > 1) {
    findings.push(mkFinding({
      ruleId: 'consistency.spineVersionDrift',
      severity: 'error',
      priority: 1,
      category: '11. Cross-consistency',
      paths: [...versions.keys()],
      message: `Mixed Spine versions in drop: ${allVers.join(', ')}.`
    }));
  } else if (allVers.length === 1) {
    findings.push(mkFinding({
      ruleId: 'consistency.spineVersionConsistent',
      severity: 'pass',
      priority: 5,
      category: '11. Cross-consistency',
      paths: [],
      message: `All ${jsons.length} Spine export(s) use version ${allVers[0]}.`
    }));
  }
  return findings;
}

export function parseAtlasRegions(atlasText) {
  // Spine atlas: blocks separated by blank lines; first non-page line of each block is the region name.
  const regions = [];
  const lines = atlasText.split(/\r?\n/);
  let i = 0;
  // skip header (page name + size/format/filter/repeat)
  while (i < lines.length) {
    // look for region: a non-empty line not preceded by blank (after page block) that doesn't contain ':'
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s+/.test(line)) { i++; continue; } // indented attribute line
    if (line.includes(':')) { i++; continue; } // header attribute
    // line is potentially a page name (ends with .png) or region name
    if (/\.(png|webp|jpg)$/i.test(line.trim())) { i++; continue; }
    regions.push(line.trim());
    i++;
  }
  return regions;
}
