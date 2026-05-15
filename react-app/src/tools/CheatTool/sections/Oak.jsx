import { Section } from '../components/Section.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { symColor } from '../lib/symbolColors.js';
import { SymbolAutocompleteInput } from '../components/SymbolAutocompleteInput.jsx';

export function OakSection() {
  const { oakConditions, addOak, removeOak, updateOak, allSymbols } = useCheatTool();
  return (
    <Section icon="★" iconKind="red" title="OAK Win Conditions" subtitle="OF A KIND">
      {oakConditions.map((o) => (
        <OakRow
          key={o.id}
          o={o}
          symbols={allSymbols}
          onChange={(field, val) => updateOak(o.id, field, val)}
          onRemove={() => removeOak(o.id)}
        />
      ))}
      <button className="ct-add-btn" onClick={addOak}>+ Add OAK condition</button>
    </Section>
  );
}

function OakRow({ o, symbols, onChange, onRemove }) {
  return (
    <div className="ct-sym-count-row">
      <SymbolAutocompleteInput
        value={o.symbol}
        onChange={(v) => onChange('symbol', v)}
        symbols={symbols}
        placeholder="Symbol"
        inputStyle={{ color: symColor(o.symbol) }}
      />
      <input
        type="number"
        value={o.count}
        min={2}
        max={999}
        onChange={(e) => onChange('count', e.target.value)}
        className="ct-num-center"
        placeholder="OAK"
      />
      <button className="ct-remove-btn" onClick={onRemove}>×</button>
    </div>
  );
}
