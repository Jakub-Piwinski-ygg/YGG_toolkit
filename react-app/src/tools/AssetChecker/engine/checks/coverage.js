import { mkFinding } from '../findings.js';
import { folderMatches, normalizeFolderName, compileRegex } from '../regex.js';
import { isUnderSource, isUnderPreview } from '../spineTriplet.js';

const CAT = '3. Coverage';

async function pngDims(file) {
  const buf = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  const view = new DataView(buf.buffer);
  return { w: view.getUint32(16), h: view.getUint32(20) };
}

function inFolder(entry, expected) {
  return folderMatches(entry.segments[0], expected);
}
function dirNormalized(entry) {
  return entry.segments.map(normalizeFolderName).join('/');
}

export async function run(ctx) {
  const { index, config, mode } = ctx;
  const cfg = config.coverage || {};
  const findings = [];

  // 3.4 required statics — search anywhere in drop, case-insensitive
  const allNamesLower = new Set(index.entries.map((e) => e.name.toLowerCase()));
  const missingStatics = [];
  for (const f of cfg.requiredStatics || []) {
    if (!allNamesLower.has(f.toLowerCase())) missingStatics.push(f);
  }
  // Only enforce required-statics in FULL mode. In element / loose drops the
  // user is intentionally inspecting a subset, so missing globals are expected.
  if (mode === 'full' && missingStatics.length) {
    findings.push(mkFinding({
      ruleId: 'coverage.requiredStaticMissing',
      severity: 'error',
      priority: 1,
      category: CAT,
      paths: missingStatics,
      message: `Missing ${missingStatics.length} required static asset${missingStatics.length === 1 ? '' : 's'}.`,
      data: {
        kind: 'matrix',
        title: 'Required statics',
        columns: ['Asset', 'Status'],
        rows: (cfg.requiredStatics || []).map((f) => [
          f,
          allNamesLower.has(f.toLowerCase()) ? '✓ present' : '✗ missing'
        ])
      }
    }));
  } else if (mode === 'full' && (cfg.requiredStatics || []).length) {
    findings.push(mkFinding({
      ruleId: 'coverage.requiredStaticsPresent',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: [],
      message: `All ${cfg.requiredStatics.length} required static asset(s) are present.`
    }));
  }

  // 3.6 previews per element — look for *_landscape.png (1920x1080) and *_portrait.png (1080x2160)
  // anywhere inside (element)/Preview/ or (element)/Previews/. We don't enforce naming
  // beyond the _landscape / _portrait suffix; everything else under Preview/ is ignored.
  const elementRoots = ctx.elementRoots && ctx.elementRoots.length
    ? ctx.elementRoots
    : (() => {
        // If no elementRoots, fall back to top-level Preview/Previews folders for loose mode.
        const tops = index.listTopFolders();
        return tops.filter((t) => /^previews?$/i.test(t)).map((t) => '');
      })();

  const expectedLandscape = { w: 1920, h: 1080 };
  const expectedPortrait  = { w: 1080, h: 2160 };

  const inElementPreview = (entry, eroot) => {
    const lower = entry.relPath.toLowerCase();
    const prefix = eroot ? eroot.toLowerCase() + '/' : '';
    if (eroot && !lower.startsWith(prefix)) return false;
    const rest = eroot ? entry.relPath.slice(eroot.length + 1) : entry.relPath;
    return /^previews?\//i.test(rest);
  };

  for (const eroot of elementRoots) {
    const previewPngs = index.entries.filter((e) => e.ext === 'png' && inElementPreview(e, eroot));

    const checkOne = async (suffixRe, label, expected) => {
      const matches = previewPngs.filter((e) => suffixRe.test(e.name));
      if (matches.length === 0) {
        findings.push(mkFinding({
          ruleId: 'coverage.previewMissing',
          severity: 'warn',
          priority: 2,
          category: CAT,
          paths: [eroot ? `${eroot}/Preview/` : 'Preview/'],
          message: `${eroot || '(drop root)'}: no ${label} preview PNG (expected *_${label}.png at ${expected.w}x${expected.h}).`
        }));
        return;
      }
      // Pick the first match; verify its dimensions
      const e = matches[0];
      const dims = await pngDims(e.file);
      if (!dims) return;
      if (dims.w === expected.w && dims.h === expected.h) {
        findings.push(mkFinding({
          ruleId: 'coverage.previewOk',
          severity: 'pass',
          priority: 5,
          category: CAT,
          paths: [e.relPath],
          message: `${label} preview present at correct ${expected.w}x${expected.h} resolution: ${e.name}.`
        }));
      } else {
        findings.push(mkFinding({
          ruleId: 'coverage.previewWrongSize',
          severity: 'warn',
          priority: 2,
          category: CAT,
          paths: [e.relPath],
          message: `${label} preview ${e.name} is ${dims.w}x${dims.h}, expected ${expected.w}x${expected.h}.`
        }));
      }
    };

    await checkOne(/_landscape\.png$/i, 'landscape', expectedLandscape);
    await checkOne(/_portrait\.png$/i, 'portrait',  expectedPortrait);
  }

  // 3.1 / 3.2 symbol coverage — for each symbol skeleton json under Symbols/
  const symbolJsons = index.entries.filter((e) =>
    inFolder(e, 'Symbols') && e.ext === 'json' &&
    index.hasCi(`${e.dir}/${e.name.replace(/\.json$/i, '')}.atlas`)
  );

  const requiredAnims = cfg.symbolAnimationsRequired || ['idle', 'land', 'win'];
  const symbolMatrixRows = [];
  let anySymMissing = false;

  for (const j of symbolJsons) {
    let anims = [];
    try {
      const data = JSON.parse(await j.file.text());
      anims = Object.keys(data.animations || {});
    } catch { continue; }
    const base = j.name.replace(/\.json$/i, '');
    const row = [base];
    for (const req of requiredAnims) {
      const ok = anims.some((a) => a.toLowerCase().includes(req.toLowerCase()));
      row.push(ok ? '✓' : '✗');
      if (!ok) anySymMissing = true;
    }
    // 3.2 static png alongside
    const staticOk = !!index.hasCi(`Symbols/static/${base}.png`) ||
      !!index.hasCi(`${j.dir}/static/${base}.png`) ||
      !!index.hasCi(`${j.dir}/${base}_static.png`);
    row.push(staticOk ? '✓ static' : '✗ static');
    if (!staticOk) anySymMissing = true;
    symbolMatrixRows.push(row);
  }

  if (symbolMatrixRows.length && anySymMissing) {
    findings.push(mkFinding({
      ruleId: 'coverage.symbolAnimMissing',
      severity: 'error',
      priority: 1,
      category: CAT,
      paths: symbolJsons.map((e) => e.relPath),
      message: `Symbol animation/static coverage gaps across ${symbolMatrixRows.length} skeleton(s).`,
      data: {
        kind: 'matrix',
        title: 'Symbol coverage',
        columns: ['Symbol', ...requiredAnims, 'Static PNG'],
        rows: symbolMatrixRows
      }
    }));
  } else if (symbolMatrixRows.length) {
    findings.push(mkFinding({
      ruleId: 'coverage.symbolsComplete',
      severity: 'pass',
      priority: 5,
      category: CAT,
      paths: symbolJsons.map((e) => e.relPath),
      message: `All ${symbolMatrixRows.length} symbol skeleton(s) have the required animations and static PNG.`
    }));
  }

  // 3.5 win-sequence completeness
  const winSeqJsons = index.entries.filter((e) =>
    e.ext === 'json' && /win.?sequence/i.test(dirNormalized(e))
  );
  const reqWin = cfg.winSequenceAnimationsRequired || [];
  if (winSeqJsons.length && reqWin.length) {
    for (const j of winSeqJsons) {
      let anims = [];
      try {
        const data = JSON.parse(await j.file.text());
        anims = Object.keys(data.animations || {});
      } catch { continue; }
      const missing = reqWin.filter((r) => !anims.some((a) => a.toLowerCase() === r.toLowerCase()));
      if (missing.length) {
        findings.push(mkFinding({
          ruleId: 'coverage.winSeqAnimMissing',
          severity: 'error',
          priority: 1,
          category: CAT,
          paths: [j.relPath],
          message: `Win sequence missing ${missing.length} required animation(s).`,
          data: {
            kind: 'matrix',
            title: `Win sequence — ${j.name}`,
            columns: ['Animation', 'Status'],
            rows: reqWin.map((r) => [r, anims.some((a) => a.toLowerCase() === r.toLowerCase()) ? '✓' : '✗'])
          }
        }));
      } else {
        findings.push(mkFinding({
          ruleId: 'coverage.winSeqComplete',
          severity: 'pass',
          priority: 5,
          category: CAT,
          paths: [j.relPath],
          message: `${j.name} contains all ${reqWin.length} required win-sequence animation(s).`
        }));
      }
    }
  }

  // Buttons must live under a Buttons/ folder so they're imported separately
  // and can be wired up as buttons in the engine. Filename regex matches
  // common button conventions; folder regex matches Buttons/ButtonStrip/etc.
  // Excludes Source/ and Preview/ since those aren't shipping assets.
  let btnNameRe = null, btnFolderRe = null;
  try { btnNameRe = compileRegex(cfg.buttonNameRegex || '(?i)(?:^|[/_-])(btn|button)(?:[_-]|$)'); } catch {}
  try { btnFolderRe = compileRegex(cfg.buttonFolderRegex || '(?i)button'); } catch {}
  if (btnNameRe && btnFolderRe) {
    const pngs = (index.byExt.get('png') || []).filter((e) => !isUnderSource(e) && !isUnderPreview(e));
    const stray = [];
    let candidates = 0;
    for (const e of pngs) {
      if (!btnNameRe.test(e.name)) continue;
      candidates++;
      const inButtonsFolder = e.segments.slice(0, -1).some((s) => btnFolderRe.test(s));
      if (!inButtonsFolder) stray.push(e);
    }
    for (const e of stray) {
      findings.push(mkFinding({
        ruleId: 'coverage.buttonOutsideFolder',
        severity: 'warn',
        priority: 2,
        category: CAT,
        paths: [e.relPath],
        message: `${e.name} looks like a button asset but isn't under a Buttons/ folder — buttons should be exported separately so they can be wired up as buttons in the engine.`
      }));
    }
    if (candidates > 0 && stray.length === 0) {
      findings.push(mkFinding({
        ruleId: 'coverage.buttonsLocated',
        severity: 'pass',
        priority: 5,
        category: CAT,
        paths: [],
        message: `All ${candidates} button-like asset(s) live under a Buttons/ folder.`
      }));
    }
  }

  return findings;
}
