import { Section } from '../components/Section.jsx';
import { FieldRow } from '../components/FieldRow.jsx';
import { Toggle } from '../components/Toggle.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

export function GameModeSection() {
  const {
    gameModeName, setGameModeName, gameModes,
    jsonIndexEnabled, setJsonIndexEnabled,
    jsonIndexValue, setJsonIndexValue
  } = useCheatTool();
  return (
    <Section icon="◈" iconKind="purple" title="Game Mode" subtitle="ROOT">
      <FieldRow label="Mode Name">
        <input
          type="text"
          value={gameModeName}
          list="ct-game-modes"
          onChange={(e) => setGameModeName(e.target.value)}
          placeholder="np. BaseGame, base_game, FS1…"
        />
        <datalist id="ct-game-modes">
          {gameModes.map((m) => <option key={m} value={m} />)}
        </datalist>
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
    </Section>
  );
}
