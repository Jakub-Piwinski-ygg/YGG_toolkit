import { Section } from '../components/Section.jsx';
import { FieldRow } from '../components/FieldRow.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { SymbolAutocompleteInput } from '../components/SymbolAutocompleteInput.jsx';

export function GameModeSection() {
  const {
    gameModeName, setGameModeName, gameModes,
    jsonIndexEnabled, setJsonIndexEnabled,
    jsonIndexValue, setJsonIndexValue,
    jsonGuidEnabled, setJsonGuidEnabled,
    jsonGuidValue, setJsonGuidValue
  } = useCheatTool();
  return (
    <Section icon="◈" iconKind="purple" title="Game Mode" subtitle="ROOT">
      <FieldRow label="Mode Name">
        <SymbolAutocompleteInput
          value={gameModeName}
          onChange={setGameModeName}
          symbols={gameModes}
          placeholder="e.g. BaseGame, base_game, FS1…"
        />
      </FieldRow>
      <FieldRow label="Json Index">
        <div className="ct-inline-row">
          <Toggle checked={jsonIndexEnabled} onChange={setJsonIndexEnabled} />
          <input
            type="number"
            value={jsonIndexValue}
            min={1}
            step={1}
            onChange={(e) => setJsonIndexValue(parseInt(e.target.value) || 1)}
            className="ct-num-narrow"
            title="Przypina cheat do konkretnego deterministycznego wyniku"
          />
        </div>
      </FieldRow>
      <FieldRow label="Json Guid">
        <div className="ct-inline-row">
          <Toggle checked={jsonGuidEnabled} onChange={setJsonGuidEnabled} />
          <input
            type="text"
            value={jsonGuidValue}
            onChange={(e) => setJsonGuidValue(e.target.value)}
            style={{ flex: 1 }}
            placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
            disabled={!jsonGuidEnabled}
          />
        </div>
      </FieldRow>
    </Section>
  );
}
