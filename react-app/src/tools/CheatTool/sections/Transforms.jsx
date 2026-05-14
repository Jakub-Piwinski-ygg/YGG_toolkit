import { Section } from '../components/Section.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

export function TransformsSection() {
  const { transformConditions, addTransform, removeTransform, updateTransform } = useCheatTool();
  return (
    <Section icon="⟳" iconKind="purple" title="Board Transformations" subtitle="TRANSFORMATIONS">
      {transformConditions.map((t) => (
        <div className="ct-transform-row" key={t.id}>
          <input
            type="text"
            value={t.name}
            placeholder="transformationType"
            onChange={(e) => updateTransform(t.id, 'name', e.target.value)}
          />
          <input
            type="number"
            value={t.count}
            min={1}
            onChange={(e) => updateTransform(t.id, 'count', e.target.value)}
            className="ct-num-center"
            placeholder="Count"
          />
          <button className="ct-remove-btn" onClick={() => removeTransform(t.id)}>×</button>
        </div>
      ))}
      <button className="ct-add-btn" onClick={addTransform}>+ Dodaj transformation</button>
    </Section>
  );
}
