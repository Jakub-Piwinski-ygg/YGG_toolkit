import { useRef, useState } from 'react';
import { Section } from '../components/Section.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { describePreset } from '../lib/jsonBuilder.js';

export function PresetsSection() {
  const { presets, presetSave, presetLoad, presetDelete, presetClearAll, presetImport } = useCheatTool();
  const [name, setName] = useState('');
  const [toast, setToast] = useState(null);
  const fileRef = useRef(null);

  const showToast = (msg, color) => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 2200);
  };

  const onSave = () => {
    presetSave(name);
    setName('');
    showToast('💾 Saved', 'var(--ct-green)');
  };
  const onExportAll = () => {
    if (!presets.length) return showToast('No presets to export', 'var(--ct-text-dim)');
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = `cheat_presets_${ts}.json`; a.click();
    URL.revokeObjectURL(url);
    showToast('⬇ Exported', 'var(--ct-green)');
  };
  const onImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const arr = JSON.parse(ev.target.result);
        presetImport(arr);
        showToast(`⬆ Imported ${arr.length}`, 'var(--ct-green)');
      } catch (err) {
        showToast(`✗ Error: ${err.message}`, 'var(--ct-red)');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };
  const onClearAll = () => {
    if (!confirm('Delete all presets? This action cannot be undone.')) return;
    presetClearAll();
    showToast('🗑 Cleared', 'var(--ct-text-dim)');
  };
  const onLoad = (id) => {
    presetLoad(id);
    const e = presets.find((p) => p.id === id);
    showToast(`▶ Loaded: ${e?.name || ''}`, 'var(--ct-green)');
  };
  const onDelete = (id) => {
    if (!confirm('Delete this preset?')) return;
    presetDelete(id);
  };

  return (
    <Section
      icon="💾"
      iconKind="purple"
      title="Presets"
      subtitle="SAVE / LOAD"
      collapsible
      defaultOpen={false}
      rightSlot={
        <span className="ct-section-count">{presets.length ? `(${presets.length})` : ''}</span>
      }
    >
      <div className="ct-preset-save-row">
        <input
          type="text"
          value={name}
          placeholder="Preset name (e.g. FS1 MaxWin 5000x)"
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="ct-add-btn" onClick={onSave}>💾 Save</button>
      </div>
      <div className="ct-preset-actions">
        <button className="ct-copy-btn" onClick={onExportAll}>⬇ Export all</button>
        <label className="ct-copy-btn">
          ⬆ Import
          <input ref={fileRef} type="file" accept="application/json,.json" onChange={onImport} hidden />
        </label>
        <button className="ct-copy-btn danger" onClick={onClearAll}>🗑 Clear all</button>
        {toast ? <span className="ct-preset-toast" style={{ color: toast.color }}>{toast.msg}</span> : null}
      </div>
      <div className="ct-preset-list">
        {presets.length === 0 ? (
          <div className="ct-empty">No saved presets. Save the current state using the button above.</div>
        ) : (
          presets.map((e) => (
            <div className="ct-preset-row" key={e.id}>
              <div className="ct-preset-info">
                <div className="ct-preset-name">{e.name}</div>
                <div className="ct-preset-desc">{describePreset(e.data)}</div>
                <div className="ct-preset-ts">{e.ts}</div>
              </div>
              <button className="ct-load-btn" onClick={() => onLoad(e.id)}>▶ Load</button>
              <button className="ct-remove-btn" onClick={() => onDelete(e.id)}>×</button>
            </div>
          ))
        )}
      </div>
    </Section>
  );
}
