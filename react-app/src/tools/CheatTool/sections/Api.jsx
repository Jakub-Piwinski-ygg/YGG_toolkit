import { Section } from '../components/Section.jsx';
import { EnvPills } from '../components/EnvPills.jsx';
import { useCheatTool } from '../CheatToolContext.jsx';
import { PROXY_TARGETS } from '../lib/envs.js';

export function ApiSection() {
  const {
    env, setEnv,
    proxyTarget, setProxyTarget,
    proxyPort, updateProxyPort,
    customBaseUrl, setCustomBaseUrl,
    urlPreview,
    configStatus, fetchGameConfig,
    request, sendRequest, cancelRequest,
    historySaveRequest,
    validation
  } = useCheatTool();

  return (
    <Section icon="⚡" iconKind="green" title="API Connection" subtitle="SEND REQUEST">
      <div className="ct-sub-heading">Środowisko</div>
      <EnvPills active={env} onSelect={setEnv} />

      {env === 'proxy' ? (
        <div className="ct-proxy-target">
          <div className="ct-sub-heading">Środowisko docelowe przez proxy</div>
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
            ⚡ Uruchom proxy: <code>node proxy.js</code><br />
            <span className="dim">Wymaga Node.js • proxy.js w tym samym folderze • domyślny port 3030</span>
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

      <div className="ct-config-fetch-bar">
        <div className="ct-config-status">
          <div className={`ct-config-dot ${configStatus.state}`} />
          <span>{configStatus.msg}</span>
        </div>
        <button className="ct-config-fetch-btn" onClick={fetchGameConfig}>⬇ Pobierz config gry</button>
      </div>

      <div className="ct-send-row">
        <button
          className={`ct-send-btn${request.inFlight ? ' loading' : ''}`}
          disabled={request.inFlight}
          onClick={sendRequest}
        >
          <span className="icon">{request.inFlight ? '◌' : '▶'}</span>
          <span>{request.inFlight ? 'Wysyłanie...' : 'Wyślij zapytanie'}</span>
        </button>
        <button className="ct-save-btn" onClick={historySaveRequest} title="Zapisz do historii bez wysyłania">📋 Zapisz</button>
        {request.inFlight ? (
          <button className="ct-cancel-btn" onClick={cancelRequest} title="Przerwij">✕</button>
        ) : null}
      </div>

      {!validation.ok ? <ValidationBar errors={validation.errors} /> : null}
    </Section>
  );
}

function ValidationBar({ errors }) {
  return (
    <details className="ct-validation-bar">
      <summary>⚠ {errors.length} {errors.length === 1 ? 'błąd walidacji' : 'błędy walidacji'} — kliknij aby rozwinąć</summary>
      <ul>
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </details>
  );
}
