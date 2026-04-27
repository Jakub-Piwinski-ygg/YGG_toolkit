import { mkFinding } from '../findings.js';
import { parseAtlasRegions } from './spineJson.js';

const CAT = '7. Baked text';

export async function run(ctx) {
  const { index, config } = ctx;
  const cfg = config.bakedText || {};
  const findings = [];
  const stringy = (cfg.stringLikeAttachmentNames || []).map((s) => s.toLowerCase());
  if (!stringy.length) return findings;

  const atlases = index.byExt.get('atlas') || [];
  for (const a of atlases) {
    const text = await a.file.text();
    const regions = parseAtlasRegions(text);
    for (const r of regions) {
      const lr = r.toLowerCase();
      if (stringy.some((s) => lr.includes(s))) {
        findings.push(mkFinding({
          ruleId: 'bakedText.attachmentName',
          severity: 'warn',
          priority: 2,
          category: CAT,
          paths: [a.relPath],
          message: `Region "${r}" looks like baked text — replace with a TEXT_ bone driven by the engine.`
        }));
      }
    }
  }
  return findings;
}
