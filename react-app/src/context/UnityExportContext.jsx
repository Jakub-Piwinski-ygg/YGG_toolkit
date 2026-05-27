import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_EXPORT_SETTINGS } from '../tools/AssetChecker/engine/exportToUnity.js';

const UnityExportContext = createContext(null);

const LS_KEY = 'ygg-toolkit:unity-export-settings:v1';

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...DEFAULT_EXPORT_SETTINGS,
      ...parsed,
      rename: { ...DEFAULT_EXPORT_SETTINGS.rename, ...(parsed.rename || {}) },
      mappings: Array.isArray(parsed.mappings) ? parsed.mappings : DEFAULT_EXPORT_SETTINGS.mappings,
    };
  } catch {
    return null;
  }
}

// Persistent, app-wide Unity export settings. Both Asset Checker (real exports)
// and Project Scaffold (empty-folder template + mandatory metadata) read &
// mutate the same configuration so the user only ever tunes mappings once.
export function UnityExportProvider({ children }) {
  const [settings, setSettings] = useState(() => loadFromStorage() || DEFAULT_EXPORT_SETTINGS);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* quota / private mode */ }
  }, [settings]);

  const setRename = useCallback((key, val) => {
    setSettings((s) => ({ ...s, rename: { ...s.rename, [key]: val } }));
  }, []);

  const updateMapping = useCallback((idx, field, val) => {
    setSettings((s) => ({
      ...s,
      mappings: s.mappings.map((m, i) => (i === idx ? { ...m, [field]: val } : m)),
    }));
  }, []);

  const removeMapping = useCallback((idx) => {
    setSettings((s) => ({ ...s, mappings: s.mappings.filter((_, i) => i !== idx) }));
  }, []);

  const addMapping = useCallback(() => {
    setSettings((s) => ({
      ...s,
      mappings: [...s.mappings, { srcSegment: '', extFilter: '', suffixFilter: '', dstFolder: '', dstSuffix: '', flatten: true, includeParent: 0 }],
    }));
  }, []);

  const moveMapping = useCallback((idx, dir) => {
    setSettings((s) => {
      const next = s.mappings.slice();
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return s;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return { ...s, mappings: next };
    });
  }, []);

  const resetSettings = useCallback(() => setSettings(DEFAULT_EXPORT_SETTINGS), []);

  const value = useMemo(
    () => ({ settings, setSettings, setRename, updateMapping, removeMapping, addMapping, moveMapping, resetSettings }),
    [settings, setRename, updateMapping, removeMapping, addMapping, moveMapping, resetSettings]
  );

  return <UnityExportContext.Provider value={value}>{children}</UnityExportContext.Provider>;
}

export function useUnityExport() {
  const ctx = useContext(UnityExportContext);
  if (!ctx) throw new Error('useUnityExport must be used inside <UnityExportProvider>');
  return ctx;
}
