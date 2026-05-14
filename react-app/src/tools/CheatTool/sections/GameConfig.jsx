import { useEffect, useMemo, useState } from 'react';
import { Section } from '../components/Section.jsx';
import { FieldRow } from '../components/FieldRow.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';

const BASE = (import.meta?.env?.BASE_URL || './').replace(/\/?$/, '/');

export function GameConfigSection() {
  const { gameId, setGameId, rtpVariant, setRtpVariant, validation } = useCheatTool();
  const [knownGames, setKnownGames] = useState([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await fetch(BASE + 'configs/cheat-game-ids.json').then((r) => r.json());
        const normalized = Array.isArray(data?.games)
          ? data.games
            .map((g) => ({
              id: parseInt(g?.id, 10),
              name: String(g?.name || '').trim()
            }))
            .filter((g) => Number.isFinite(g.id) && g.id > 0 && g.name)
          : [];
        if (active) setKnownGames(normalized);
      } catch {
        if (active) setKnownGames([]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedKnownGame = useMemo(() => {
    const id = parseInt(gameId, 10);
    if (!Number.isFinite(id) || id <= 0) return '';
    return knownGames.some((g) => g.id === id) ? String(id) : '';
  }, [knownGames, gameId]);

  return (
    <Section icon="⚙" iconKind="blue" title="Game Config" subtitle="REQUIRED">
      <FieldRow label="Known Games">
        <select value={selectedKnownGame} onChange={(e) => setGameId(parseInt(e.target.value, 10) || 0)}>
          <option value="">Custom / manual</option>
          {knownGames.map((g) => (
            <option key={g.id} value={g.id}>{g.name} - {g.id}</option>
          ))}
        </select>
      </FieldRow>
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
