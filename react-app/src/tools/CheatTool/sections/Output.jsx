import { useCheatTool } from '../CheatToolContext.jsx';
import { syntaxHL } from '../lib/jsonBuilder.js';
import { copyToClipboard, findSpinSteps, extractBoardReels, describeCombination, extractWinPositions } from '../lib/playResponse.js';
import { symColor } from '../lib/symbolColors.js';
import { useState } from 'react';

// Right-hand output panel: JSON tabs (Pretty/Minified/PascalCase), API response
// (Wynik / Real Spin), status bar. Designed to be the wide column.
export function OutputPanel() {
  const {
    builtJson, outputTab, setOutputTab,
    response, playResponse, respTab, setRespTab,
    oakConditions, mainBoard, gameModeName, nextModeEnabled, nextGameModeName,
    playWithCheat
  } = useCheatTool();
  const [copyOk, setCopyOk] = useState(null);

  const text = outputTab === 'pretty'
    ? JSON.stringify(builtJson.clean, null, 2)
    : outputTab === 'minified'
      ? JSON.stringify(builtJson.pascal)
      : JSON.stringify(builtJson.pascal, null, 2);

  const onCopy = async () => {
    const ok = await copyToClipboard(text);
    setCopyOk(ok);
    setTimeout(() => setCopyOk(null), 1500);
  };
  const onDownload = () => {
    const blob = new Blob([JSON.stringify(builtJson.pascal)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const now = new Date();
    const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    a.href = url; a.download = `cheat_${ts}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const boardSymCount = (() => {
    const counts = new Set();
    mainBoard.grid.forEach((r) => r.forEach((s) => { if (s) counts.add(s); }));
    return counts.size;
  })();

  return (
    <div className="ct-right-panel">
      <div className="ct-output-header">
        <div className="ct-output-title">
          <div className="ct-output-dot" />
          JSON Output
        </div>
        <button className="ct-copy-btn" onClick={onCopy}>
          {copyOk === null ? 'Copy' : copyOk ? '✓ Skopiowano' : '✗ Błąd'}
        </button>
        <button className="ct-copy-btn success" onClick={onDownload}>⬇ .txt</button>
      </div>
      <div className="ct-output-tabs">
        <div className={`ct-tab${outputTab === 'pretty' ? ' active' : ''}`} onClick={() => setOutputTab('pretty')}>Pretty</div>
        <div className={`ct-tab${outputTab === 'minified' ? ' active' : ''}`} onClick={() => setOutputTab('minified')}>Minified</div>
        <div className={`ct-tab${outputTab === 'pascal' ? ' active' : ''}`} onClick={() => setOutputTab('pascal')}>PascalCase</div>
      </div>
      <div className="ct-output-body">
        {outputTab === 'minified' ? (
          <pre className="minified">{text}</pre>
        ) : (
          <pre dangerouslySetInnerHTML={{ __html: syntaxHL(text) }} />
        )}
      </div>

      {response ? (
        <div className="ct-response-panel">
          <div className="ct-response-header">
            <span className="ct-response-title">API Response</span>
            <span className="ct-response-status" style={{ color: response.res?.ok ? 'var(--ct-green)' : 'var(--ct-red)' }}>
              {response.res?.ok ? '✓ ' : '✗ '}{response.res?.status || ''}
            </span>
          </div>
          <div className="ct-resp-tabs">
            <div className={`ct-resp-tab${respTab === 'result' ? ' active' : ''}`} onClick={() => setRespTab('result')}>Wynik</div>
            {playResponse ? (
              <div className={`ct-resp-tab${respTab === 'play' ? ' active' : ''}`} onClick={() => setRespTab('play')}>🎰 Real Spin</div>
            ) : null}
          </div>
          {respTab === 'result' ? <ResultTab onPlay={playWithCheat} /> : null}
          {respTab === 'play' ? <PlayTab /> : null}
        </div>
      ) : null}

      <div className="ct-status-bar">
        <div className="ct-status-item">
          <div className="ct-status-dot" />
          <span>{boardSymCount} symbols</span>
        </div>
        <div className="ct-status-item">
          <div className="ct-status-dot" style={{ background: 'var(--ct-accent2)' }} />
          <span>{oakConditions.length} OAK</span>
        </div>
        <div className="ct-status-item">
          <div className="ct-status-dot" style={{ background: 'var(--ct-accent)' }} />
          <span>{nextModeEnabled ? `${gameModeName} → ${nextGameModeName}` : gameModeName}</span>
        </div>
      </div>
    </div>
  );
}

function ResultTab({ onPlay }) {
  const { response, getPlayStake, setPlayStake } = useCheatTool();
  if (!response) return null;
  if (response.error) {
    return <div className="ct-error-box">❌ {response.error.message || 'Błąd połączenia'}</div>;
  }
  const data = response.data || {};
  const ok = data.ReverseEngineerSuccess ?? data.reverseEngineerSuccess;
  const winMult = data.WinMultiplier ?? data.winMultiplier;
  const singleSpinId = data.SpinId ?? data.spinId;
  const spinIdsMap = data.SpinIds ?? data.spinIds;
  const allSpinIds = spinIdsMap && typeof spinIdsMap === 'object'
    ? Object.entries(spinIdsMap).filter(([, v]) => v) : [];
  const spinId = singleSpinId ?? (allSpinIds[0]?.[1] ?? null);
  const mode = data.GameModeName ?? data.gameModeName ?? allSpinIds[0]?.[0];
  const features = data.FeaturesKey ?? data.featuresKey;
  const error = data.ReverseEngineerError ?? data.reverseEngineerError;
  const method = data.ReverseEngineerMethod ?? data.reverseEngineerMethod;
  const rng = data.RandomNumbers ?? data.randomNumbers;
  const cheatString = (rng && rng.length) ? rng.join(',') : null;
  const partialSuccess = ok === false && (allSpinIds.length > 0 || singleSpinId);

  return (
    <div className="ct-response-body">
      {partialSuccess ? (
        <div className="ct-info-box partial">
          <div className="title">⚠ Częściowy sukces</div>
          <div className="body">
            Solver znalazł spin w bazie, ale reverse-engineer nie domknął się.<br />
            Możesz spróbować użyć <code>SpinId</code> bezpośrednio.<br />
            <span className="dim">Backend error: {error || '?'}</span>
          </div>
        </div>
      ) : null}
      {ok === false && !partialSuccess ? (
        <div className="ct-error-box">❌ Solver failed<br /><br />{error || 'Brak szczegółów błędu.'}</div>
      ) : (
        <>
          {ok !== false ? (
            <div className="ct-resp-field"><span className="key">Status</span><span className="val success">✓ Znaleziono spin</span></div>
          ) : null}
          <div className="ct-resp-field"><span className="key">Win Multiplier</span><span className="val highlight">{winMult ?? '—'}×</span></div>
          <div className="ct-resp-field"><span className="key">Game Mode</span><span className="val">{mode ?? '—'}</span></div>
          {features ? (
            <div className="ct-resp-field"><span className="key">Features</span>
              <span className="val" style={{ color: features === 'None' ? 'var(--ct-text-dim)' : 'var(--ct-accent2)' }}>{features}</span>
            </div>
          ) : null}
          {allSpinIds.length > 0
            ? allSpinIds.map(([m, id]) => <SpinIdRow key={id} m={allSpinIds.length > 1 ? m : null} id={id} />)
            : spinId ? <SpinIdRow id={spinId} /> : null}
          {cheatString ? (
            <div className="ct-resp-field" style={{ alignItems: 'start' }}>
              <span className="key">Random Numbers</span>
              <span className="rng-row">
                <code>{rng.join(', ')}</code>
                <CopyBtn text={cheatString} />
              </span>
            </div>
          ) : null}
          {cheatString ? (
            <PlayCheatBox cheatString={cheatString} onPlay={onPlay} getPlayStake={getPlayStake} setPlayStake={setPlayStake} />
          ) : null}
        </>
      )}
      {method ? (
        <details className="ct-method-sql">
          <summary>▶ Pokaż SQL backendu (reverseEngineerMethod)</summary>
          <pre>{method}</pre>
        </details>
      ) : null}
    </div>
  );
}

function SpinIdRow({ m, id }) {
  return (
    <div className="ct-resp-field" style={{ alignItems: 'start' }}>
      <span className="key">Spin ID{m ? ` (${m})` : ''}</span>
      <span className="rng-row">
        <code>{id}</code>
        <CopyBtn text={id} />
      </span>
    </div>
  );
}

function CopyBtn({ text }) {
  const [s, setS] = useState('📋');
  return (
    <button
      className="ct-mini-copy"
      onClick={async () => {
        const ok = await copyToClipboard(text);
        setS(ok ? '✓' : '✗');
        setTimeout(() => setS('📋'), 1500);
      }}
    >{s}</button>
  );
}

function PlayCheatBox({ cheatString, onPlay, getPlayStake, setPlayStake }) {
  const stake = getPlayStake();
  const [cashBet, setCashBet] = useState(stake.cashBet);
  const [currency, setCurrency] = useState(stake.currency);
  const replay = () => {
    setPlayStake({ cashBet, currency });
    onPlay(cheatString, true);
  };
  return (
    <div className="ct-play-box">
      <div className="ct-play-box-head">
        <div className="title">🎰 Zagraj prawdziwym spinem</div>
        <div className="meta">⚡ auto-play w tle → zakładka 🎰 Real Spin</div>
      </div>
      <div className="ct-play-box-row">
        <input type="number" value={cashBet} step={0.1} min={0.01} placeholder="cashBet" onChange={(e) => setCashBet(parseFloat(e.target.value) || 0)} />
        <input type="text" value={currency} maxLength={3} placeholder="EUR" onChange={(e) => setCurrency(e.target.value.toUpperCase())} />
        <button onClick={replay} className="ct-play-btn">↻ Powtórz</button>
      </div>
      <div className="ct-play-box-foot">Real spin renderowany w zakładce "🎰 Real Spin".</div>
    </div>
  );
}

function PlayTab() {
  const { playResponse } = useCheatTool();
  if (!playResponse) return null;
  if (playResponse.loading) return <div className="ct-loading">◌ Wysyłanie play request...</div>;
  if (playResponse.error) {
    return (
      <div className="ct-error-box">
        ❌ {playResponse.error.message || 'Błąd połączenia'}<br /><br />
        <span className="dim">URL: {playResponse.url}</span>
      </div>
    );
  }
  const { data, res, url, body } = playResponse;
  const firstResult = data?.results?.[0] ?? data?.Results?.[0];
  const firstActions = firstResult?.clientData?.actions ?? firstResult?.ClientData?.Actions ?? [];
  const findAction = (suffix) => firstActions.find((a) => (a.$type ?? a.type ?? '').endsWith(suffix));
  const modeStartAction = findAction('PresentModeStart');
  const modeWinAction = findAction('PresentModeWin');
  const totalWin = data?.totalWin ?? data?.TotalWin
    ?? data?.win ?? data?.Win
    ?? firstResult?.cashWin ?? firstResult?.CashWin
    ?? modeWinAction?.modeWin?.amountNormalizedToBet ?? modeWinAction?.modeWin?.amount;
  const balance = data?.balance ?? data?.Balance ?? data?.playerBalance?.cash;
  const spinId = data?.spinId ?? data?.SpinId ?? data?.gameRound?.id;
  const gameMode = data?.gameModeName ?? data?.GameModeName ?? data?.mode
    ?? modeStartAction?.modeName ?? modeStartAction?.ModeName;
  const featuresKey = data?.featuresKey ?? data?.FeaturesKey;
  const nextMode = data?.nextGameMode?.identifier ?? data?.NextGameMode?.Identifier
    ?? data?.nextCommands?.[0]?.modeName;
  const steps = findSpinSteps(data);

  return (
    <div className="ct-response-body">
      <div className="ct-info-box info">
        <div className="title-row">
          <strong>🎰 Real Spin Result</strong>
          <span style={{ color: res?.ok ? 'var(--ct-green)' : 'var(--ct-red)' }}>{res?.ok ? '✓ ' : '✗ '}{res?.status}</span>
        </div>
        {totalWin !== undefined ? <div className="ct-resp-field"><span className="key">Total Win</span><span className="val highlight">{totalWin}</span></div> : null}
        {gameMode ? <div className="ct-resp-field"><span className="key">Game Mode</span><span className="val">{gameMode}</span></div> : null}
        {featuresKey ? <div className="ct-resp-field"><span className="key">Features</span><span className="val" style={{ color: featuresKey === 'None' ? 'var(--ct-text-dim)' : 'var(--ct-accent2)' }}>{featuresKey}</span></div> : null}
        {nextMode ? <div className="ct-resp-field"><span className="key">Next Mode</span><span className="val" style={{ color: 'var(--ct-accent2)' }}>{nextMode}</span></div> : null}
        {balance !== undefined ? <div className="ct-resp-field"><span className="key">Balance</span><span className="val">{balance}</span></div> : null}
        {spinId ? <div className="ct-resp-field" style={{ alignItems: 'start' }}><span className="key">Spin ID</span><span className="val small dim word-break">{spinId}</span></div> : null}
      </div>
      {(steps && steps.length > 0) ? (
        <div className="ct-spin-inspector">{steps.map((s, i) => <SpinStep key={i} step={s} idx={i} />)}</div>
      ) : (
        <div className="ct-info-box dim">ℹ Nie udało się znaleźć stepów spinu w odpowiedzi.</div>
      )}
      <details className="ct-detail">
        <summary>▶ Request</summary>
        <div className="dim small"><strong>POST</strong> {url}</div>
        <pre>{JSON.stringify(body, null, 2)}</pre>
      </details>
      <details className="ct-detail" open>
        <summary>▶ Pełna odpowiedź (JSON)</summary>
        <pre>{typeof data === 'string' ? data : JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}

function SpinStep({ step, idx }) {
  const stepWin = step.stepWin ?? step.StepWin ?? step.win ?? step.Win ?? 0;
  const combos = step.wonCombinations ?? step.WonCombinations ?? step.wins ?? step.Wins ?? [];
  const reels = extractBoardReels(step);
  const winMap = new Map();
  combos.forEach((combo) => {
    const payout = combo.combinationPayout ?? combo.CombinationPayout ?? combo.payout ?? combo.Payout ?? 0;
    const desc = describeCombination(combo);
    extractWinPositions(combo).forEach(({ reel, row }) => {
      const k = `${reel},${row}`;
      if (!winMap.has(k)) winMap.set(k, []);
      winMap.get(k).push({ payout, desc });
    });
  });

  return (
    <div className="ct-spin-mode-block">
      <div className="ct-spin-mode-header">
        <span>Step {idx + 1}</span>
        <span className="win">{stepWin > 0 ? stepWin + '×' : '—'}</span>
      </div>
      <div className="ct-spin-board-grid">
        {reels && Array.isArray(reels) ? reels.map((reel, ri) => (
          <div className="ct-spin-reel" key={ri}>
            {(reel.cells ?? reel.Cells ?? reel.symbols ?? reel.Symbols ?? []).map((cell, ci) => {
              const sym = cell.symbol?.symbolCode ?? cell.Symbol?.SymbolCode
                ?? cell.symbolCode ?? cell.SymbolCode
                ?? cell.symbol ?? cell.Symbol
                ?? (typeof cell === 'string' ? cell : '?');
              const isWin = winMap.has(`${ri},${ci}`);
              const c = sym && sym !== '?' && sym !== '·' ? symColor(sym) : null;
              const style = c ? { background: c + '1f', borderColor: c + '55', color: c } : undefined;
              const tt = isWin ? winMap.get(`${ri},${ci}`).map((w) => `+${w.payout}× ${w.desc}`).join('\n') : '';
              return (
                <div
                  key={ci}
                  className={`ct-spin-cell${isWin ? ' winning' : ''}`}
                  style={style}
                  title={tt}
                >{sym}</div>
              );
            })}
          </div>
        )) : <div className="ct-empty small">Brak danych boardu w tym stepie.</div>}
      </div>
      {combos.length > 0 ? (
        <div className="ct-combo-list">
          {combos.map((combo, i) => {
            const payout = combo.combinationPayout ?? combo.CombinationPayout ?? combo.payout ?? combo.Payout ?? 0;
            const desc = describeCombination(combo);
            const positions = extractWinPositions(combo);
            const posLabel = positions.length > 0 ? positions.map((p) => `R${p.reel + 1}:${p.row + 1}`).join(' ') : '';
            return (
              <div className="ct-combo-row" key={i}>
                <span className="payout">+{payout}×</span>
                <span className="desc">{desc || <i className="dim">brak opisu</i>}</span>
                {posLabel ? <span className="pos">{posLabel}</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
