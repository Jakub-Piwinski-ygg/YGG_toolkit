import { useState } from 'react';
import { Section } from '../components/Section.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { copyToClipboard } from '../lib/playResponse.js';

export function HistorySection() {
  const { history, historyDelete, historyClearAll } = useCheatTool();
  const [selected, setSelected] = useState(new Set());
  const [copied, setCopied] = useState(false);

  const toggle = (id) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const selectAll = () => setSelected(new Set(history.map((e) => e.id)));
  const selectNone = () => setSelected(new Set());
  const copySelected = async () => {
    const lines = history.filter((e) => selected.has(e.id)).map((e) => e.json);
    if (!lines.length) return;
    const ok = await copyToClipboard(lines.join('\n'));
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  const clearAll = () => {
    if (!confirm('Wyczyścić całą historię?')) return;
    historyClearAll();
    setSelected(new Set());
  };

  return (
    <Section
      icon="📋"
      iconKind="purple"
      title="Request History"
      subtitle="ZAPISANE REQUESTY"
      collapsible
      defaultOpen={false}
      rightSlot={<span className="ct-section-count">{history.length ? `(${history.length})` : ''}</span>}
    >
      <div className="ct-history-actions">
        <button className="ct-add-btn" onClick={selectAll}>☑ Zaznacz wszystkie</button>
        <button className="ct-add-btn" onClick={selectNone}>☐ Odznacz wszystkie</button>
        <button className="ct-copy-btn" onClick={copySelected}>📋 Kopiuj zaznaczone</button>
        <button className="ct-copy-btn danger" onClick={clearAll}>🗑 Wyczyść historię</button>
        {copied ? <span className="ct-history-copied">✓ Skopiowano!</span> : null}
      </div>
      <div className="ct-history-rows">
        {history.length === 0 ? (
          <div className="ct-empty">Brak zapisanych requestów.</div>
        ) : history.map((e) => (
          <div className="ct-history-row" key={e.id}>
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={() => toggle(e.id)}
            />
            <div className="ct-history-info">
              <div className="ct-history-label">{e.label}</div>
              <div className="ct-history-ts">{e.ts}</div>
              <div className="ct-history-json">{e.json.slice(0, 120)}…</div>
            </div>
            <button className="ct-remove-btn" onClick={() => historyDelete(e.id)} title="Usuń">×</button>
          </div>
        ))}
      </div>
    </Section>
  );
}
