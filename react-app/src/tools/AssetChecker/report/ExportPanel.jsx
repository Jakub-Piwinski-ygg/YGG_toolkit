import { useState } from 'react';
import { DEFAULT_EXPORT_SETTINGS } from '../engine/exportToUnity.js';
import { ExportApprovalModal } from './ExportApprovalModal.jsx';

const RULE_LABELS = {
  transliterate:  'Transliterate non-ASCII (ą→a, ł→l, …)',
  spacesToKebab:  'Spaces → kebab-case (-)',
  stripForbidden: 'Strip forbidden chars (# % & * : < > ? \\ { | } ~ " \')',
  trimDotsSpaces: 'Trim leading/trailing dots & spaces',
  pathBudget:     'Truncate paths > 150 chars',
  pascalCaseArt:  'PascalCase basenames in Art folders',
};

export function ExportPanel({ entries, log }) {
  const [open, setOpen]             = useState(false);
  const [settings, setSettings]     = useState(DEFAULT_EXPORT_SETTINGS);
  const [showRename, setShowRename] = useState(false);
  const [modalOpen, setModalOpen]   = useState(false);

  const setRename = (key, val) =>
    setSettings((s) => ({ ...s, rename: { ...s.rename, [key]: val } }));

  const updateMapping = (idx, field, val) =>
    setSettings((s) => ({
      ...s,
      mappings: s.mappings.map((m, i) => (i === idx ? { ...m, [field]: val } : m)),
    }));

  const removeMapping = (idx) =>
    setSettings((s) => ({ ...s, mappings: s.mappings.filter((_, i) => i !== idx) }));

  const addMapping = () =>
    setSettings((s) => ({
      ...s,
      mappings: [...s.mappings, { srcSegment: '', extFilter: '', suffixFilter: '', dstFolder: '', dstSuffix: '', flatten: true, includeParent: 0 }],
    }));

  const moveMapping = (idx, dir) =>
    setSettings((s) => {
      const next = s.mappings.slice();
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return s;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...s, mappings: next };
    });

  return (
    <div className="ac-export-wrap">
      <button
        className={`ac-export-header-btn${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
        disabled={!entries.length}
      >
        <span>{open ? '▼' : '▶'} 📦 Export to Unity</span>
        <span className="ac-export-header-sub">
          {entries.length ? `${entries.length} files · click to ${open ? 'collapse' : 'configure'}` : 'load files first'}
        </span>
      </button>

      {open && (
        <div className="ac-export-panel">

          {/* Project name */}
          <div className="ac-export-row">
            <label>Project name</label>
            <input
              className="ac-export-input"
              type="text"
              value={settings.projectName}
              onChange={(e) => setSettings((s) => ({ ...s, projectName: e.target.value || 'UnityExport' }))}
            />
          </div>

          {/* Mapping table */}
          <div className="ac-export-section">
            <div className="ac-export-section-head">
              <span className="ac-export-section-title">Folder mappings</span>
              <span className="ac-export-section-hint">top-to-bottom priority · first full match wins · audio always → Audio/</span>
            </div>

            <div className="ac-export-help">
              <b>Segment</b> exact folder name anywhere in path &nbsp;·&nbsp;
              <b>Ext</b> comma-separated ext filter (blank = any) &nbsp;·&nbsp;
              <b>FileSuffix</b> filename stem suffix e.g. <code>_static</code> &nbsp;·&nbsp;
              <b>Destination</b> output folder &nbsp;·&nbsp;
              <b>Sub</b> subfolder inserted after parent segs (e.g. <code>Animations</code>) &nbsp;·&nbsp;
              <b>⬆</b> N parent segments to include &nbsp;·&nbsp;
              <b>↧</b> flatten (filename only)
            </div>

            <div className="ac-export-mapping-header">
              <span/>
              <span>Segment</span>
              <span>Ext</span>
              <span>FileSuffix</span>
              <span>Destination folder</span>
              <span title="Sub-folder inserted after parent segs, before filename (e.g. Animations)">Sub</span>
              <span title="Include N parent segments before matched segment">⬆</span>
              <span title="Flatten — filename only">↧</span>
              <span/>
            </div>

            {settings.mappings.map((m, i) => (
              <div key={i} className={`ac-export-mapping-row${!m.srcSegment ? ' ac-export-mapping-empty' : ''}`}>
                <div className="ac-export-mapping-arrows">
                  <button className="ac-export-arrow" onClick={() => moveMapping(i, -1)} disabled={i === 0} title="Move up">↑</button>
                  <button className="ac-export-arrow" onClick={() => moveMapping(i, 1)} disabled={i === settings.mappings.length - 1} title="Move down">↓</button>
                </div>
                <input className="ac-export-input" type="text" value={m.srcSegment}    onChange={(e) => updateMapping(i, 'srcSegment',    e.target.value)} placeholder="e.g. export" />
                <input className="ac-export-input ac-export-filter" type="text" value={m.extFilter}    onChange={(e) => updateMapping(i, 'extFilter',    e.target.value)} placeholder="png,json" />
                <input className="ac-export-input ac-export-filter" type="text" value={m.suffixFilter} onChange={(e) => updateMapping(i, 'suffixFilter', e.target.value)} placeholder="_static" />
                <input className="ac-export-input" type="text" value={m.dstFolder}     onChange={(e) => updateMapping(i, 'dstFolder',     e.target.value)} placeholder="Art/_Game" />
                <input className="ac-export-input ac-export-filter" type="text" value={m.dstSuffix ?? ''} onChange={(e) => updateMapping(i, 'dstSuffix', e.target.value)} placeholder="Statics" title="Subfolder inserted after parent segs (e.g. Animations, Statics)" />
                <input className="ac-export-input ac-export-parent" type="number" min="0" max="5" value={m.includeParent ?? 0} onChange={(e) => updateMapping(i, 'includeParent', Math.max(0, parseInt(e.target.value, 10) || 0))} title="Include N parent segments before matched segment" />
                <input type="checkbox" checked={!!m.flatten} onChange={(e) => updateMapping(i, 'flatten', e.target.checked)} title="Flatten — filename only" className="ac-export-check" />
                <button className="ac-export-x" onClick={() => removeMapping(i)} title="Remove row">×</button>
              </div>
            ))}

            <div className="ac-export-mapping-footer">
              <button className="ac-export-add" onClick={addMapping} type="button">+ Add row</button>
              <div className="ac-export-fallback-row">
                <label>No match fallback:</label>
                <input
                  className="ac-export-input"
                  type="text"
                  value={settings.fallbackFolder}
                  onChange={(e) => setSettings((s) => ({ ...s, fallbackFolder: e.target.value || 'Art/_Game' }))}
                />
                <span className="ac-export-fallback-hint">(full path preserved, root folder stripped)</span>
              </div>
            </div>

            {/* Example accordion */}
            <details className="ac-export-example">
              <summary>How auto-detection works + full routing reference</summary>
              <pre className="ac-export-example-pre">{`AUTO-DETECTION (export segment, Sub column left blank)
  · .json / .atlas.txt                         → Animations/
  · .png whose stem matches an atlas file
    in the same folder (e.g. symbols.png
    when symbols.atlas.txt is present)         → Animations/
  · everything else (other PNGs, sub-folders)  → StaticArt/
  · first sub-folder already named Animation*
    or StaticArt* → preserved exactly as-is   (no prefix added)

Input path → Output path  (unity_export root folder is stripped)
02_Symbols/export/symbol_Hi1.json            → Art/_Game/02_Symbols/Animations/symbol_Hi1.json
02_Symbols/export/symbols.atlas.txt          → Art/_Game/02_Symbols/Animations/symbols.atlas.txt
02_Symbols/export/symbols.png  (atlas PNG)   → Art/_Game/02_Symbols/Animations/symbols.png
02_Symbols/export/scatter_trail.png          → Art/_Game/02_Symbols/StaticArt/scatter_trail.png
02_Symbols/export/Static_assets/sym.png      → Art/_Game/02_Symbols/StaticArt/Static_assets/sym.png
01_Background/Export/Animation/chip.json     → Art/_Game/01_Background/Animation/chip.json  (already organised)
01_Background/Export/StaticArt/bg.png        → Art/_Game/01_Background/StaticArt/bg.png     (already organised)
03_Wins/export/coin_shower/chip_00.png       → Art/_Game/03_Wins/StaticArt/coin_shower/chip_00.png

02_Symbols/Source/AnimationSources/s.spine   → Art/_Source/Editor/02_Symbols/AnimationSources/s.spine
02_Symbols/preview/hp/gameplay.mp4           → Art/_Previews/Editor/02_Symbols/hp/gameplay.mp4
05_Fonts/A-Z/a.png                           → Art/_Game/Fonts/A-Z/a.png

OVERRIDE: set Sub column explicitly to skip auto-detection:
  export  png  _static  Art/_Game  Statics  1  ✓  → forces _static PNGs flat into Statics/`}
              </pre>
            </details>
          </div>

          {/* Rename rules */}
          <div className="ac-export-section">
            <button className="ac-export-toggle" onClick={() => setShowRename((v) => !v)} type="button">
              {showRename ? '▼' : '▶'} Rename rules (all off by default)
            </button>
            {showRename && (
              <div className="ac-export-rules">
                {Object.entries(RULE_LABELS).map(([key, label]) => (
                  <label key={key} className="ac-export-rule">
                    <input type="checkbox" checked={!!settings.rename[key]} onChange={(e) => setRename(key, e.target.checked)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="ac-export-actions">
            <button className="btn btn-primary" disabled={!entries.length} onClick={() => setModalOpen(true)}>
              📦 Export to Unity…
            </button>
          </div>
        </div>
      )}

      {modalOpen && (
        <ExportApprovalModal
          entries={entries}
          settings={settings}
          log={log}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}
