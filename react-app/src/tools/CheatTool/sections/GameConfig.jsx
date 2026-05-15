import { useEffect, useMemo, useState } from 'react';
import { Section } from '../components/Section.jsx';
import { FieldRow } from '../components/FieldRow.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { EnvPills } from '../components/EnvPills.jsx';
import { PROXY_TARGETS } from '../lib/envs.js';

const BASE = (import.meta?.env?.BASE_URL || './').replace(/\/?$/, '/');

export function GameConfigSection() {
  const {
    gameId, setGameId,
    rtpVariant, setRtpVariant,
    validation,
    configStatus, fetchGameConfig,
    env, setEnv,
    proxyTarget, setProxyTarget,
    proxyPort, updateProxyPort,
    customBaseUrl, setCustomBaseUrl,
    urlPreview
  } = useCheatTool();
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

      <div className="ct-config-fetch-bar" style={{ marginTop: 12 }}>
        <div className="ct-config-status">
          <div className={`ct-config-dot ${configStatus.state}`} />
          <span>{configStatus.msg}</span>
        </div>
        <button className="ct-config-fetch-btn" onClick={fetchGameConfig}>⬇ Fetch game config</button>
      </div>

      <details className="ct-inline-foldout">
        <summary>API connection</summary>

        <div className="ct-sub-heading">Environment</div>
        <EnvPills active={env} onSelect={setEnv} />

        {env === 'proxy' ? (
          <div className="ct-proxy-target">
            <div className="ct-sub-heading">Proxy target environment</div>
            <select value={proxyTarget} onChange={(e) => setProxyTarget(e.target.value)}>
              {PROXY_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <div className="ct-proxy-port-row">
              <span className="ct-sub-heading-inline">Port proxy</span>
              <input
                type="number"
                min={1}
                max={65535}
                value={proxyPort}
                onChange={(e) => updateProxyPort(e.target.value)}
                className={`ct-num-center${validation.fieldErrors.proxyPort ? ' ct-invalid' : ''}`}
                title={validation.fieldErrors.proxyPort || ''}
              />
            </div>
            <div className="ct-info-box warn">
              ⚡ Start proxy: <code>node proxy.js</code><br />
              <span className="dim">Requires Node.js • proxy.js in the same folder • default port 3030</span>
            </div>
          </div>
        ) : null}

        {env === 'custom' ? (
          <div style={{ marginBottom: 10 }}>
            <input
              type="text"
              value={customBaseUrl}
              placeholder="https://ugs.custom.yggops.io"
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              className={validation.fieldErrors.customBaseUrl ? 'ct-invalid' : ''}
              title={validation.fieldErrors.customBaseUrl || ''}
              style={{ width: '100%' }}
            />
          </div>
        ) : null}

        <div className="ct-url-preview">
          POST <span>{urlPreview}</span>
        </div>
      </details>
    </Section>
  );
}
