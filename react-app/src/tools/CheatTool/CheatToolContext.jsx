// Single source of truth for the cheat tool. Holds form state, board state,
// conditions, environment, response, presets and history. Exposes actions as
// stable function references so section components can call them without
// re-registering effects.
//
// The original cheat-tool.html kept all this in module globals + DOM nodes.
// Here it lives in React state — every section reads via useCheatTool() and
// writes via the dispatchers below.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { buildJSON, stripEmpty, toPascal, describeCheat, describePreset } from './lib/jsonBuilder.js';
import { validateAll } from './lib/validation.js';
import { buildFetchOptions, getEndpointUrl, getProxyPortFromStorage, setProxyPortInStorage, getBaseUrl, PROXY_TARGETS } from './lib/envs.js';
import { DEFAULT_SYMBOLS } from './lib/symbolColors.js';
import { extractGameModes, extractSymbolsFromConfig } from './lib/playResponse.js';

const PRESETS_KEY = 'cheat_tool_presets';
const HISTORY_KEY = 'cheat_tool_history';
const TRIGGER_KEY = 'cheat_tool_trigger_config';
const PLAY_STAKE_KEY = 'cheat_tool_play_stake';
const PRESET_VERSION = 1;
const PREFERRED_TRIGGER_SYMBOLS = ['FS', 'Scatter', 'Bonus'];

function emptyBoard(reels, rows) {
  return Array.from({ length: rows }, () => Array(reels).fill(''));
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function newBoardForReels(prevGrid, prevReels, prevRows, newReels) {
  if (newReels === prevReels) return prevGrid;
  if (newReels > prevReels) return prevGrid.map((row) => [...row, ...Array(newReels - prevReels).fill('')]);
  return prevGrid.map((row) => row.slice(0, newReels));
}

function newBoardForRows(prevGrid, prevRows, prevReels, newRows) {
  if (newRows === prevRows) return prevGrid;
  if (newRows > prevRows) {
    const extra = Array.from({ length: newRows - prevRows }, () => Array(prevReels).fill(''));
    return [...prevGrid, ...extra];
  }
  return prevGrid.slice(0, newRows);
}

function syncBoardToHeights(grid, reels, heights) {
  const maxRows = Math.max(...heights);
  let next = grid.slice();
  while (next.length < maxRows) next.push(Array(reels).fill(''));
  next = next.slice(0, maxRows);
  next = next.map((row) => {
    const r = row.slice();
    while (r.length < reels) r.push('');
    return r.slice(0, reels);
  });
  return next;
}

const CheatToolContext = createContext(null);

export function CheatToolProvider({ children }) {
  // ---- Form ----
  const [gameId, setGameId] = useState(10857);
  const [rtpVariant, setRtpVariant] = useState('0.94');
  const [gameModeName, setGameModeName] = useState('BaseGame');
  const [jsonIndexEnabled, setJsonIndexEnabled] = useState(false);
  const [jsonIndexValue, setJsonIndexValue] = useState(1);

  const [multiplierEnabled, setMultiplierEnabled] = useState(false);
  const [multFrom, setMultFrom] = useState('');
  const [multTo, setMultTo] = useState('');

  // ---- Next mode ----
  const [nextModeEnabled, setNextModeEnabled] = useState(false);
  const [nextGameModeName, setNextGameModeName] = useState('FS1');
  const [triggerSymbol, setTriggerSymbol] = useState('FS');
  const [triggerCount, setTriggerCount] = useState(3);
  const [triggerUserSet, setTriggerUserSet] = useState({}); // { symbol?:true, count?:true }
  const [nextMultEnabled, setNextMultEnabled] = useState(false);
  const [nextMultFrom, setNextMultFrom] = useState('');
  const [nextMultTo, setNextMultTo] = useState('');

  // ---- Conditions ----
  const [oakConditions, setOakConditions] = useState([]);
  const [counterConditions, setCounterConditions] = useState([]);
  const [transformConditions, setTransformConditions] = useState([]);
  const [nextOakConditions, setNextOakConditions] = useState([]);
  const [nextCounterConditions, setNextCounterConditions] = useState([]);
  const [manualSymbols, setManualSymbols] = useState([]);
  const [nbManualSymbols, setNbManualSymbols] = useState([]);

  // ---- Boards (main + next) ----
  const [mainBoard, setMainBoard] = useState({
    reels: 5,
    rows: 3,
    grid: emptyBoard(5, 3),
    megawaysMode: false,
    reelHeights: []
  });
  const [nbBoard, setNbBoard] = useState({
    reels: 5,
    rows: 3,
    grid: emptyBoard(5, 3),
    megawaysMode: false,
    reelHeights: []
  });

  // ---- Symbols (from game config) ----
  const [allSymbols, setAllSymbols] = useState(DEFAULT_SYMBOLS);
  const [gameModes, setGameModes] = useState([
    'BaseGame', 'base_game', 'FS1', 'FS2', 'FS3', 'FS4'
  ]);
  const [configStatus, setConfigStatus] = useState({
    state: 'idle', // idle | loading | loaded | error
    msg: 'Symbole nie załadowane z API'
  });

  // ---- Env / API ----
  const [env, setEnv] = useState('dev');
  const [proxyTarget, setProxyTarget] = useState(PROXY_TARGETS[0].value);
  const [proxyPort, setProxyPortState] = useState(getProxyPortFromStorage());
  const [customBaseUrl, setCustomBaseUrl] = useState('');

  const [request, setRequest] = useState({
    inFlight: false,
    status: '', // string label
    statusOk: null
  });
  const [response, setResponse] = useState(null); // { data, res, payload, error }
  const [playResponse, setPlayResponse] = useState(null);
  const abortRef = useRef(null);

  // ---- Output tab ----
  const [outputTab, setOutputTab] = useState('pascal');
  const [respTab, setRespTab] = useState('result');

  // ---- Persisted lists ----
  const [presets, setPresets] = useState(() => loadJSON(PRESETS_KEY, []));
  const [history, setHistory] = useState(() => loadJSON(HISTORY_KEY, []));
  useEffect(() => localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)), [presets]);
  useEffect(() => localStorage.setItem(HISTORY_KEY, JSON.stringify(history)), [history]);

  // ---- Trigger config persistence ----
  useEffect(() => {
    const all = loadJSON(TRIGGER_KEY, {});
    const e = all[gameId] || {};
    if (e.symbol !== undefined && !triggerUserSet.symbol) setTriggerSymbol(e.symbol);
    if (e.count !== undefined && !triggerUserSet.count) setTriggerCount(e.count);
    if (e.userSet) setTriggerUserSet(e.userSet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  const persistTrigger = useCallback((symbol, count, userSet) => {
    const all = loadJSON(TRIGGER_KEY, {});
    all[gameId] = { symbol, count, userSet };
    localStorage.setItem(TRIGGER_KEY, JSON.stringify(all));
  }, [gameId]);

  // ---- Trigger auto-detect (when nextGameModeName or symbols change) ----
  useEffect(() => {
    if (!nextModeEnabled) return;
    const mode = (nextGameModeName || '').trim();
    if (!mode || /^base/i.test(mode)) return;
    const numMatch = mode.match(/(\d+)$/);
    const detectedNum = numMatch ? parseInt(numMatch[1]) : null;
    const detectedSym = PREFERRED_TRIGGER_SYMBOLS.find((s) => allSymbols.includes(s)) || null;
    if (!triggerUserSet.symbol && detectedSym) setTriggerSymbol(detectedSym);
    if (!triggerUserSet.count && detectedNum !== null) setTriggerCount(detectedNum);
  }, [nextGameModeName, allSymbols, nextModeEnabled, triggerUserSet]);

  // ---- Snapshot for jsonBuilder/validation ----
  const state = useMemo(
    () => ({
      gameId: parseInt(gameId) || 10857,
      rtpVariant: parseFloat(rtpVariant),
      gameModeName,
      jsonIndexEnabled,
      jsonIndexValue: parseInt(jsonIndexValue) || 1,
      multiplierEnabled,
      multFrom: parseFloat(multFrom),
      multTo: parseFloat(multTo),
      nextModeEnabled,
      nextGameModeName,
      triggerSymbol,
      triggerCount,
      nextMultEnabled,
      nextMultFrom: parseFloat(nextMultFrom),
      nextMultTo: parseFloat(nextMultTo),
      oakConditions, counterConditions, transformConditions,
      nextOakConditions, nextCounterConditions,
      manualSymbols, nbManualSymbols,
      mainBoard, nbBoard,
      env, proxyTarget, proxyPort, customBaseUrl
    }),
    [
      gameId, rtpVariant, gameModeName, jsonIndexEnabled, jsonIndexValue,
      multiplierEnabled, multFrom, multTo,
      nextModeEnabled, nextGameModeName, triggerSymbol, triggerCount,
      nextMultEnabled, nextMultFrom, nextMultTo,
      oakConditions, counterConditions, transformConditions,
      nextOakConditions, nextCounterConditions,
      manualSymbols, nbManualSymbols,
      mainBoard, nbBoard,
      env, proxyTarget, proxyPort, customBaseUrl
    ]
  );

  const builtJson = useMemo(() => {
    const data = buildJSON(state);
    const clean = stripEmpty(data);
    const pascal = toPascal(clean);
    return { data, clean, pascal };
  }, [state]);

  const validation = useMemo(() => validateAll(state), [state]);

  const urlPreview = useMemo(() => getEndpointUrl(state), [state]);

  // ---- Mutators (boards) ----
  const setMainBoardField = useCallback((patch) => {
    setMainBoard((b) => ({ ...b, ...patch }));
  }, []);
  const setNbBoardField = useCallback((patch) => {
    setNbBoard((b) => ({ ...b, ...patch }));
  }, []);

  const paintMainCell = useCallback((ri, ci, sym) => {
    setMainBoard((b) => {
      const grid = b.grid.map((row) => row.slice());
      if (grid[ri] && grid[ri][ci] !== undefined && grid[ri][ci] !== null) grid[ri][ci] = sym;
      return { ...b, grid };
    });
  }, []);
  const paintNbCell = useCallback((ri, ci, sym) => {
    setNbBoard((b) => {
      const grid = b.grid.map((row) => row.slice());
      if (grid[ri] && grid[ri][ci] !== undefined && grid[ri][ci] !== null) grid[ri][ci] = sym;
      return { ...b, grid };
    });
  }, []);

  const changeMainReels = useCallback((delta) => {
    setMainBoard((b) => {
      const next = b.reels + delta;
      if (next < 1 || next > 12) return b;
      const grid = newBoardForReels(b.grid, b.reels, b.rows, next);
      const heights = b.megawaysMode
        ? delta > 0 ? [...b.reelHeights, b.rows] : b.reelHeights.slice(0, next)
        : b.reelHeights;
      return { ...b, reels: next, grid, reelHeights: heights };
    });
  }, []);
  const changeNbReels = useCallback((delta) => {
    setNbBoard((b) => {
      const next = b.reels + delta;
      if (next < 1 || next > 12) return b;
      const grid = newBoardForReels(b.grid, b.reels, b.rows, next);
      const heights = b.megawaysMode
        ? delta > 0 ? [...b.reelHeights, b.rows] : b.reelHeights.slice(0, next)
        : b.reelHeights;
      return { ...b, reels: next, grid, reelHeights: heights };
    });
  }, []);

  const changeMainRows = useCallback((delta) => {
    setMainBoard((b) => {
      if (b.megawaysMode) return b;
      const next = b.rows + delta;
      if (next < 1 || next > 10) return b;
      const grid = newBoardForRows(b.grid, b.rows, b.reels, next);
      return { ...b, rows: next, grid };
    });
  }, []);
  const changeNbRows = useCallback((delta) => {
    setNbBoard((b) => {
      if (b.megawaysMode) return b;
      const next = b.rows + delta;
      if (next < 1 || next > 10) return b;
      const grid = newBoardForRows(b.grid, b.rows, b.reels, next);
      return { ...b, rows: next, grid };
    });
  }, []);

  const toggleMainMegaways = useCallback(() => {
    setMainBoard((b) => {
      const on = !b.megawaysMode;
      if (on) {
        const heights = Array(b.reels).fill(b.rows);
        const grid = syncBoardToHeights(b.grid, b.reels, heights);
        return { ...b, megawaysMode: true, reelHeights: heights, grid };
      }
      return { ...b, megawaysMode: false };
    });
  }, []);
  const toggleNbMegaways = useCallback(() => {
    setNbBoard((b) => {
      const on = !b.megawaysMode;
      if (on) {
        const heights = Array(b.reels).fill(b.rows);
        const grid = syncBoardToHeights(b.grid, b.reels, heights);
        return { ...b, megawaysMode: true, reelHeights: heights, grid };
      }
      return { ...b, megawaysMode: false };
    });
  }, []);

  const changeMainReelHeight = useCallback((reelIdx, delta) => {
    setMainBoard((b) => {
      if (!b.megawaysMode) return b;
      const next = b.reelHeights[reelIdx] + delta;
      if (next < 1 || next > 10) return b;
      const heights = b.reelHeights.slice();
      heights[reelIdx] = next;
      const grid = syncBoardToHeights(b.grid, b.reels, heights);
      return { ...b, reelHeights: heights, grid };
    });
  }, []);
  const changeNbReelHeight = useCallback((reelIdx, delta) => {
    setNbBoard((b) => {
      if (!b.megawaysMode) return b;
      const next = b.reelHeights[reelIdx] + delta;
      if (next < 1 || next > 10) return b;
      const heights = b.reelHeights.slice();
      heights[reelIdx] = next;
      const grid = syncBoardToHeights(b.grid, b.reels, heights);
      return { ...b, reelHeights: heights, grid };
    });
  }, []);

  const clearMainBoard = useCallback(() => {
    setMainBoard((b) => {
      if (b.megawaysMode) {
        const maxRows = Math.max(...b.reelHeights);
        const grid = Array.from({ length: maxRows }, (_, ri) =>
          Array.from({ length: b.reels }, (_, ci) => (ri < b.reelHeights[ci] ? '' : null))
        );
        return { ...b, grid };
      }
      return { ...b, grid: emptyBoard(b.reels, b.rows) };
    });
  }, []);
  const clearNbBoard = useCallback(() => {
    setNbBoard((b) => {
      if (b.megawaysMode) {
        const maxRows = Math.max(...b.reelHeights);
        const grid = Array.from({ length: maxRows }, (_, ri) =>
          Array.from({ length: b.reels }, (_, ci) => (ri < b.reelHeights[ci] ? '' : null))
        );
        return { ...b, grid };
      }
      return { ...b, grid: emptyBoard(b.reels, b.rows) };
    });
  }, []);

  // ---- Condition CRUD ----
  const oakIdRef = useRef(0);
  const counterIdRef = useRef(0);
  const transformIdRef = useRef(0);
  const nextOakIdRef = useRef(0);
  const nextCounterIdRef = useRef(0);
  const manualIdRef = useRef(0);
  const nbManualIdRef = useRef(0);

  const addOak = useCallback(() => setOakConditions((xs) => [...xs, { id: oakIdRef.current++, symbol: 'Hi1', count: 3 }]), []);
  const removeOak = useCallback((id) => setOakConditions((xs) => xs.filter((o) => o.id !== id)), []);
  const updateOak = useCallback((id, field, val) => setOakConditions((xs) => xs.map((o) => o.id === id ? { ...o, [field]: field === 'count' ? (parseInt(val) || 3) : val } : o)), []);

  const addCounter = useCallback(() => setCounterConditions((xs) => [...xs, { id: counterIdRef.current++, name: 'spinsLeft', from: 10, to: 10 }]), []);
  const removeCounter = useCallback((id) => setCounterConditions((xs) => xs.filter((c) => c.id !== id)), []);
  const updateCounter = useCallback((id, field, val) => setCounterConditions((xs) => xs.map((c) => c.id === id ? { ...c, [field]: field !== 'name' ? (parseFloat(val) || 0) : val } : c)), []);

  const addTransform = useCallback(() => setTransformConditions((xs) => [...xs, { id: transformIdRef.current++, name: 'ExpandReels', count: 1 }]), []);
  const removeTransform = useCallback((id) => setTransformConditions((xs) => xs.filter((t) => t.id !== id)), []);
  const updateTransform = useCallback((id, field, val) => setTransformConditions((xs) => xs.map((t) => t.id === id ? { ...t, [field]: field === 'count' ? (parseInt(val) || 1) : val } : t)), []);

  const addNextOak = useCallback(() => setNextOakConditions((xs) => [...xs, { id: nextOakIdRef.current++, symbol: 'Hi1', count: 3 }]), []);
  const removeNextOak = useCallback((id) => setNextOakConditions((xs) => xs.filter((o) => o.id !== id)), []);
  const updateNextOak = useCallback((id, field, val) => setNextOakConditions((xs) => xs.map((o) => o.id === id ? { ...o, [field]: field === 'count' ? (parseInt(val) || 3) : val } : o)), []);

  const addNextCounter = useCallback(() => setNextCounterConditions((xs) => [...xs, { id: nextCounterIdRef.current++, name: 'C_Multiplier', from: 0, to: 0 }]), []);
  const removeNextCounter = useCallback((id) => setNextCounterConditions((xs) => xs.filter((c) => c.id !== id)), []);
  const updateNextCounter = useCallback((id, field, val) => setNextCounterConditions((xs) => xs.map((c) => c.id === id ? { ...c, [field]: field !== 'name' ? (parseFloat(val) || 0) : val } : c)), []);

  const addManualSymbol = useCallback(() => setManualSymbols((xs) => [...xs, { id: manualIdRef.current++, symbol: allSymbols[0] || '', count: 1 }]), [allSymbols]);
  const removeManualSymbol = useCallback((id) => setManualSymbols((xs) => xs.filter((s) => s.id !== id)), []);
  const updateManualSymbol = useCallback((id, field, val) => setManualSymbols((xs) => xs.map((s) => s.id === id ? { ...s, [field]: field === 'count' ? (parseInt(val) || 1) : val } : s)), []);

  const addNbManualSymbol = useCallback(() => setNbManualSymbols((xs) => [...xs, { id: nbManualIdRef.current++, symbol: allSymbols[0] || '', count: 1 }]), [allSymbols]);
  const removeNbManualSymbol = useCallback((id) => setNbManualSymbols((xs) => xs.filter((s) => s.id !== id)), []);
  const updateNbManualSymbol = useCallback((id, field, val) => setNbManualSymbols((xs) => xs.map((s) => s.id === id ? { ...s, [field]: field === 'count' ? (parseInt(val) || 1) : val } : s)), []);

  // ---- Trigger ----
  const updateTriggerSymbol = useCallback((v) => {
    setTriggerSymbol(v);
    setTriggerUserSet((s) => {
      const next = { ...s, symbol: true };
      persistTrigger(v, triggerCount, next);
      return next;
    });
  }, [triggerCount, persistTrigger]);
  const updateTriggerCount = useCallback((v) => {
    const n = parseInt(v);
    setTriggerCount(isNaN(n) ? 0 : n);
    setTriggerUserSet((s) => {
      const next = { ...s, count: true };
      persistTrigger(triggerSymbol, isNaN(n) ? 0 : n, next);
      return next;
    });
  }, [triggerSymbol, persistTrigger]);

  // ---- Game config fetch ----
  const fetchGameConfig = useCallback(async () => {
    const baseUrl = getBaseUrl(state);
    if (!baseUrl) {
      setConfigStatus({ state: 'error', msg: 'Brak base URL — wybierz środowisko' });
      return;
    }
    const url = `${baseUrl}/v2/games/${gameId}/config`;
    setConfigStatus({ state: 'loading', msg: 'Pobieranie...' });
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'X-Rtp-Variant': rtpVariant }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const symbols = extractSymbolsFromConfig(data);
      if (symbols.length === 0) throw new Error('Brak symbolPayouts w paytable');
      setAllSymbols(symbols);
      const modes = extractGameModes(data);
      if (modes.length > 0) setGameModes(modes);
      setConfigStatus({
        state: 'loaded',
        msg: `Załadowano ${symbols.length} symboli${modes.length ? `, ${modes.length} trybów gry` : ''}`
      });
    } catch (err) {
      setConfigStatus({ state: 'error', msg: `Błąd: ${err.message}` });
    }
  }, [gameId, rtpVariant, state]);

  // ---- Send request ----
  const sendRequest = useCallback(async () => {
    if (request.inFlight) return;
    abortRef.current = new AbortController();
    const payload = toPascal(buildJSON(state));
    const { url, options } = buildFetchOptions(state, 'POST', payload);
    const timeoutId = setTimeout(() => abortRef.current?.abort(), 30000);
    setRequest({ inFlight: true, status: 'Wysyłanie...', statusOk: null });
    setResponse(null);
    setPlayResponse(null);
    setRespTab('result');
    try {
      const res = await fetch(url, { ...options, signal: abortRef.current.signal });
      clearTimeout(timeoutId);
      const data = await res.json();
      setRequest({ inFlight: false, status: (res.ok ? '✓ ' : '✗ ') + res.status, statusOk: res.ok });
      setResponse({ data, res: { ok: res.ok, status: res.status }, payload });
      // Auto play if randomNumbers present
      const rng = data.RandomNumbers ?? data.randomNumbers;
      const ok = data.ReverseEngineerSuccess ?? data.reverseEngineerSuccess;
      if (ok !== false && rng && rng.length > 0) {
        setTimeout(() => playWithCheat(rng.join(','), false), 100);
      }
    } catch (err) {
      clearTimeout(timeoutId);
      const wasTimeout = !abortRef.current;
      setRequest({
        inFlight: false,
        status: err.name === 'AbortError' ? (wasTimeout ? '✕ Timeout' : '✕ Przerwano') : '✗ Error',
        statusOk: false
      });
      setResponse({ error: err, payload });
    } finally {
      abortRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, request.inFlight]);

  const cancelRequest = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  // ---- Play with cheat (Real Spin) ----
  const getPlayStake = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(PLAY_STAKE_KEY) || '{"cashBet":1,"currency":"EUR"}');
    } catch {
      return { cashBet: 1, currency: 'EUR' };
    }
  }, []);
  const setPlayStake = useCallback((s) => {
    localStorage.setItem(PLAY_STAKE_KEY, JSON.stringify(s));
  }, []);

  const playWithCheat = useCallback(async (cheatString, switchTabFlag = true) => {
    const stake = getPlayStake();
    const baseUrl = env === 'proxy' ? `http://localhost:${proxyPort}` : getBaseUrl(state);
    const playUrl = `${baseUrl}/v2/games/${gameId}/play`;
    const body = { stakeValue: { cashBet: stake.cashBet, currency: stake.currency }, cheat: cheatString };
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Rtp-Variant': rtpVariant || '0.94'
    };
    if (env === 'proxy') headers['X-Target-Url'] = proxyTarget + `/v2/games/${gameId}/play`;
    if (switchTabFlag) setRespTab('play');
    setPlayResponse({ loading: true, url: playUrl, body });
    try {
      const res = await fetch(playUrl, { method: 'POST', headers, body: JSON.stringify(body) });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      setPlayResponse({ loading: false, data, res: { ok: res.ok, status: res.status }, url: playUrl, body });
    } catch (err) {
      setPlayResponse({ loading: false, error: err, url: playUrl, body });
    }
  }, [env, proxyPort, proxyTarget, rtpVariant, gameId, state, getPlayStake]);

  // ---- Proxy port write-through ----
  const updateProxyPort = useCallback((v) => {
    const n = parseInt(v);
    setProxyPortState(isNaN(n) ? v : n);
    if (n && n >= 1 && n <= 65535) setProxyPortInStorage(n);
  }, []);

  // ---- Presets ----
  const presetSerializeState = useCallback(() => ({
    v: PRESET_VERSION,
    form: {
      gameId, rtpVariant, gameModeName,
      jsonIndexEnabled, jsonIndexValue,
      multiplierEnabled, multFrom, multTo,
      nextModeEnabled, nextGameModeName, triggerSymbol, triggerCount,
      nextMultEnabled, nextMultFrom, nextMultTo
    },
    arrays: {
      oakConditions, counterConditions, transformConditions,
      nextOakConditions, nextCounterConditions,
      manualSymbols, nbManualSymbols
    },
    mainBoard: { ...mainBoard, grid: mainBoard.grid.map((r) => r.slice()), reelHeights: [...mainBoard.reelHeights] },
    nextBoard: { ...nbBoard, grid: nbBoard.grid.map((r) => r.slice()), reelHeights: [...nbBoard.reelHeights] }
  }), [
    gameId, rtpVariant, gameModeName, jsonIndexEnabled, jsonIndexValue,
    multiplierEnabled, multFrom, multTo,
    nextModeEnabled, nextGameModeName, triggerSymbol, triggerCount,
    nextMultEnabled, nextMultFrom, nextMultTo,
    oakConditions, counterConditions, transformConditions,
    nextOakConditions, nextCounterConditions,
    manualSymbols, nbManualSymbols, mainBoard, nbBoard
  ]);

  const presetApplyState = useCallback((data) => {
    if (!data || typeof data !== 'object') return false;
    const f = data.form || {};
    if (f.gameId !== undefined) setGameId(f.gameId);
    if (f.rtpVariant !== undefined) setRtpVariant(f.rtpVariant);
    if (f.gameModeName !== undefined) setGameModeName(f.gameModeName);
    if (f.jsonIndexEnabled !== undefined) setJsonIndexEnabled(!!f.jsonIndexEnabled);
    if (f.jsonIndexValue !== undefined) setJsonIndexValue(f.jsonIndexValue);
    if (f.multiplierEnabled !== undefined) setMultiplierEnabled(!!f.multiplierEnabled);
    if (f.multFrom !== undefined) setMultFrom(f.multFrom);
    if (f.multTo !== undefined) setMultTo(f.multTo);
    if (f.nextModeEnabled !== undefined) setNextModeEnabled(!!f.nextModeEnabled);
    if (f.nextGameModeName !== undefined) setNextGameModeName(f.nextGameModeName);
    if (f.triggerSymbol !== undefined) setTriggerSymbol(f.triggerSymbol);
    if (f.triggerCount !== undefined) setTriggerCount(f.triggerCount);
    if (f.nextMultEnabled !== undefined) setNextMultEnabled(!!f.nextMultEnabled);
    if (f.nextMultFrom !== undefined) setNextMultFrom(f.nextMultFrom);
    if (f.nextMultTo !== undefined) setNextMultTo(f.nextMultTo);
    const a = data.arrays || {};
    setOakConditions(a.oakConditions || []);
    setCounterConditions(a.counterConditions || []);
    setTransformConditions(a.transformConditions || []);
    setNextOakConditions(a.nextOakConditions || []);
    setNextCounterConditions(a.nextCounterConditions || []);
    setManualSymbols(a.manualSymbols || []);
    setNbManualSymbols(a.nbManualSymbols || []);
    if (data.mainBoard) setMainBoard({
      reels: data.mainBoard.reels || 5,
      rows: data.mainBoard.rows || 3,
      grid: data.mainBoard.grid || emptyBoard(5, 3),
      megawaysMode: !!data.mainBoard.megawaysMode,
      reelHeights: data.mainBoard.reelHeights || []
    });
    if (data.nextBoard) setNbBoard({
      reels: data.nextBoard.reels || 5,
      rows: data.nextBoard.rows || 3,
      grid: data.nextBoard.grid || emptyBoard(5, 3),
      megawaysMode: !!data.nextBoard.megawaysMode,
      reelHeights: data.nextBoard.reelHeights || []
    });
    return true;
  }, []);

  const presetSave = useCallback((name) => {
    const data = presetSerializeState();
    const finalName = (name || '').trim() || describePreset(data);
    setPresets((xs) => [{ id: Date.now(), ts: new Date().toLocaleString('pl-PL'), name: finalName, data }, ...xs]);
  }, [presetSerializeState]);
  const presetLoad = useCallback((id) => {
    const e = presets.find((p) => p.id === id);
    if (!e) return false;
    return presetApplyState(e.data);
  }, [presets, presetApplyState]);
  const presetDelete = useCallback((id) => setPresets((xs) => xs.filter((p) => p.id !== id)), []);
  const presetClearAll = useCallback(() => setPresets([]), []);
  const presetImport = useCallback((arr) => {
    if (!Array.isArray(arr)) throw new Error('Plik musi zawierać tablicę presetów');
    setPresets((existing) => {
      const ids = new Set(existing.map((p) => p.id));
      const merged = arr.map((p) => ({ ...p, id: ids.has(p.id) ? Date.now() + Math.random() : p.id }));
      return [...merged, ...existing];
    });
  }, []);

  // ---- History ----
  const historySaveRequest = useCallback(() => {
    const pascal = builtJson.pascal;
    const entry = {
      id: Date.now(),
      ts: new Date().toLocaleString('pl-PL'),
      label: describeCheat(pascal),
      json: JSON.stringify(pascal)
    };
    setHistory((xs) => [entry, ...xs]);
  }, [builtJson.pascal]);
  const historyDelete = useCallback((id) => setHistory((xs) => xs.filter((e) => e.id !== id)), []);
  const historyClearAll = useCallback(() => setHistory([]), []);

  const value = {
    // state slices
    gameId, setGameId,
    rtpVariant, setRtpVariant,
    gameModeName, setGameModeName,
    jsonIndexEnabled, setJsonIndexEnabled,
    jsonIndexValue, setJsonIndexValue,
    multiplierEnabled, setMultiplierEnabled,
    multFrom, setMultFrom,
    multTo, setMultTo,
    nextModeEnabled, setNextModeEnabled,
    nextGameModeName, setNextGameModeName,
    triggerSymbol, updateTriggerSymbol,
    triggerCount, updateTriggerCount,
    nextMultEnabled, setNextMultEnabled,
    nextMultFrom, setNextMultFrom,
    nextMultTo, setNextMultTo,
    oakConditions, addOak, removeOak, updateOak,
    counterConditions, addCounter, removeCounter, updateCounter,
    transformConditions, addTransform, removeTransform, updateTransform,
    nextOakConditions, addNextOak, removeNextOak, updateNextOak,
    nextCounterConditions, addNextCounter, removeNextCounter, updateNextCounter,
    manualSymbols, addManualSymbol, removeManualSymbol, updateManualSymbol,
    nbManualSymbols, addNbManualSymbol, removeNbManualSymbol, updateNbManualSymbol,
    mainBoard, setMainBoardField, paintMainCell, changeMainReels, changeMainRows, toggleMainMegaways, changeMainReelHeight, clearMainBoard,
    nbBoard, setNbBoardField, paintNbCell, changeNbReels, changeNbRows, toggleNbMegaways, changeNbReelHeight, clearNbBoard,
    allSymbols, gameModes, configStatus,
    env, setEnv,
    proxyTarget, setProxyTarget,
    proxyPort, updateProxyPort,
    customBaseUrl, setCustomBaseUrl,
    request, response, playResponse,
    outputTab, setOutputTab,
    respTab, setRespTab,
    builtJson, validation, urlPreview,
    fetchGameConfig, sendRequest, cancelRequest, playWithCheat,
    getPlayStake, setPlayStake,
    presets, presetSave, presetLoad, presetDelete, presetClearAll, presetImport,
    history, historySaveRequest, historyDelete, historyClearAll
  };

  return <CheatToolContext.Provider value={value}>{children}</CheatToolContext.Provider>;
}

export function useCheatTool() {
  const ctx = useContext(CheatToolContext);
  if (!ctx) throw new Error('useCheatTool must be used inside CheatToolProvider');
  return ctx;
}
