import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [inputFiles, setInputFiles] = useState([]);
  const [outputFiles, setOutputFiles] = useState([]);
  const [currentTool, setCurrentTool] = useState('webp');
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
      registerRunner,
      getRunner
    }),
    [
      inputFiles,
      outputFiles,
      currentTool,
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
