import { Section } from '../components/Section.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

export function CountersSection() {
  const {
    counterConditions, addCounter, removeCounter, updateCounter,
    mainBoard, validation
  } = useCheatTool();
  return (
    <Section icon="⊞" iconKind="blue" title="Counter State Conditions" subtitle="COUNTERS">
      {counterConditions.map((c) => (
        <div className="ct-counter-row" key={c.id}>
          <input
            type="text"
            value={c.name}
            placeholder="counterName"
            onChange={(e) => updateCounter(c.id, 'name', e.target.value)}
          />
          <input
            type="number"
            value={c.from}
            placeholder="From"
            onChange={(e) => updateCounter(c.id, 'from', e.target.value)}
            className={`ct-num-center${validation.fieldErrors[`counter-${c.id}-from`] ? ' ct-invalid' : ''}`}
            title={validation.fieldErrors[`counter-${c.id}-from`] || ''}
          />
          <span className="ct-range-sep">—</span>
          <input
            type="number"
            value={c.to}
            placeholder="To"
            onChange={(e) => updateCounter(c.id, 'to', e.target.value)}
            className={`ct-num-center${validation.fieldErrors[`counter-${c.id}-to`] ? ' ct-invalid' : ''}`}
            title={validation.fieldErrors[`counter-${c.id}-to`] || ''}
          />
          <button className="ct-remove-btn" onClick={() => removeCounter(c.id)}>×</button>
        </div>
      ))}
      <button className="ct-add-btn" onClick={addCounter}>+ Add counter condition</button>
      {mainBoard.megawaysMode && mainBoard.reelHeights.length > 0 ? (
        <div className="ct-mw-counter-preview">
          <div className="ct-sub-heading">⚡ Auto — Megaways counters</div>
          {mainBoard.reelHeights.map((h, i) => (
            <div className="ct-mw-counter-row" key={i}>
              <input type="text" readOnly value={`NumberOfSymbols${i}`} />
              <input type="number" readOnly value={h} className="ct-num-center" title="fromValue" />
              <input type="number" readOnly value={h} className="ct-num-center" title="toValue" />
            </div>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
