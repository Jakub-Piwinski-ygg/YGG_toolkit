import { Section } from '../components/Section.jsx';
import { FieldRow } from '../components/FieldRow.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

export function GameConfigSection() {
  const { gameId, setGameId, rtpVariant, setRtpVariant, validation } = useCheatTool();
  return (
    <Section icon="⚙" iconKind="blue" title="Game Config" subtitle="REQUIRED">
      <FieldRow label="Game ID">
        <input
          type="number"
          value={gameId ?? ''}
          onChange={(e) => setGameId(parseInt(e.target.value) || 0)}
          className={validation.fieldErrors.gameId ? 'ct-invalid' : ''}
          title={validation.fieldErrors.gameId || ''}
        />
      </FieldRow>
      <FieldRow label="RTP Variant">
        <select value={rtpVariant} onChange={(e) => setRtpVariant(e.target.value)}>
          <option value="0.94">0.94</option>
          <option value="0.96">0.96</option>
        </select>
      </FieldRow>
    </Section>
  );
}
