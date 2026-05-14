import { Section } from '../components/Section.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { RangeRow } from '../components/FieldRow.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

export function MultiplierSection() {
  const {
    multiplierEnabled, setMultiplierEnabled,
    multFrom, setMultFrom, multTo, setMultTo,
    validation
  } = useCheatTool();
  return (
    <Section icon="✕" iconKind="green" title="Multiplier Conditions" subtitle="WIN RANGE">
      <Toggle checked={multiplierEnabled} onChange={setMultiplierEnabled} label="Enable multiplier constraint" />
      {multiplierEnabled ? (
        <>
          <RangeRow
            label="Win Range"
            fromValue={multFrom}
            toValue={multTo}
            onFromChange={setMultFrom}
            onToChange={setMultTo}
            fromError={validation.fieldErrors.multFrom}
            toError={validation.fieldErrors.multTo}
          />
          <div className="ct-hint">Tip: set FromValue = ToValue for an exact win</div>
        </>
      ) : null}
    </Section>
  );
}
