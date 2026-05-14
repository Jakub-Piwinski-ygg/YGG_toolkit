import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

const AppContext = createContext(null);

function toolFromUrl() {
  return new URLSearchParams(window.location.search).get('tool') || 'converter';
}

export function AppProvider({ children }) {
  const [inputFiles, setInputFiles] = useState([]);
  const [outputFiles, setOutputFiles] = useState([]);
  const [currentTool, setCurrentToolRaw] = useState(toolFromUrl);
  const [currentCategory, setCurrentCategory] = useState('arttools');

  // On mount: resolve the correct category for whatever tool was in the URL.
  // Uses the same lazy import as setCurrentTool to avoid circular deps.
  useEffect(() => {
    import('../tools/registry.js').then(({ categoryOfTool }) => {
      const cat = categoryOfTool(toolFromUrl());
      if (cat) setCurrentCategory(cat);
    });
  }, []);

  // Selecting a tool also moves to its category and syncs the URL so the
  // current tool can be bookmarked / shared. Dynamic import avoids a circular
  // module dependency (registry → tool components → this file).
  const setCurrentTool = useCallback(async (id) => {
    setCurrentToolRaw(id);
    const url = new URL(window.location.href);
    url.searchParams.set('tool', id);
    window.history.replaceState(null, '', url.toString());
    const { categoryOfTool } = await import('../tools/registry.js');
    const cat = categoryOfTool(id);
    if (cat) setCurrentCategory(cat);
  }, []);
  const [logEntries, setLogEntries] = useState([
    { type: 'info', msg: '— loading ImageMagick WASM… —' }
  ]);
  const [magickReady, setMagickReady] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');

  // Runners are imperative handles that tools register on mount so the RUN
  // button can invoke whichever tool is active without importing them directly.
  const runnersRef = useRef({});

  const registerRunner = useCallback((id, runner) => {
    if (runner == null) delete runnersRef.current[id];
    else runnersRef.current[id] = runner;
  }, []);

  const getRunner = useCallback((id) => runnersRef.current[id], []);

  const log = useCallback((msg, type = '') => {
    setLogEntries((prev) => [...prev, { msg, type }]);
  }, []);

  const clearLog = useCallback(() => setLogEntries([]), []);

  const addFiles = useCallback((files) => {
    setInputFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const additions = [];
      for (const f of files) {
        if (existing.has(f.name)) continue;
        additions.push({ name: f.name, file: f, url: URL.createObjectURL(f) });
        existing.add(f.name);
      }
      return additions.length ? [...prev, ...additions] : prev;
    });
  }, []);

  // Promote produced output blobs into the working file list. Used by
  // "Replace with output" so a user can chain tools without manual
  // download → re-upload.
  const replaceFilesWithOutput = useCallback(() => {
    setOutputFiles((currentOutputs) => {
      if (!currentOutputs.length) return currentOutputs;
      const newInputs = currentOutputs.map((f) => ({
        name: f.name,
        file: new File([f.blob], f.name, { type: f.blob.type || 'application/octet-stream' }),
        url: URL.createObjectURL(f.blob)
      }));
      setInputFiles((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.url));
        return newInputs;
      });
      currentOutputs.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    setProgressLabel('');
  }, []);

  const removeFile = useCallback((name) => {
    setInputFiles((prev) => {
      const idx = prev.findIndex((x) => x.name === name);
      if (idx === -1) return prev;
      URL.revokeObjectURL(prev[idx].url);
      const next = prev.slice();
      next.splice(idx, 1);
      return next;
    });
  }, []);

  const clearResults = useCallback(() => {
    setOutputFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
    setProgressLabel('');
    setLogEntries([{ type: 'info', msg: '— ready —' }]);
  }, []);

  const pushOutput = useCallback((entry) => {
    setOutputFiles((prev) => [...prev, entry]);
  }, []);

  const resetOutputs = useCallback(() => {
    setOutputFiles((prev) => {
      prev.forEach((f) => URL.revokeObjectURL(f.url));
      return [];
    });
  }, []);

  const value = useMemo(
    () => ({
      inputFiles,
      outputFiles,
      currentTool,
      setCurrentTool,
      currentCategory,
      setCurrentCategory,
      logEntries,
      log,
      clearLog,
      magickReady,
      setMagickReady,
      isRunning,
      setIsRunning,
      progressLabel,
      setProgressLabel,
      addFiles,
      removeFile,
      clearResults,
      pushOutput,
      resetOutputs,
      replaceFilesWithOutput,
      registerRunner,
      getRunner
    }),
    [
      inputFiles,
      outputFiles,
      currentTool,
      currentCategory,
      logEntries,
      magickReady,
      isRunning,
      progressLabel,
      log,
      clearLog,
      addFiles,
      removeFile,
      clearResults,
      pushOutput,
      resetOutputs,
      replaceFilesWithOutput,
      registerRunner,
      getRunner
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
