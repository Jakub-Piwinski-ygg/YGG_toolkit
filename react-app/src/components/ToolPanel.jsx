import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { ART_TOOLS } from '../tools/registry.js';
import { useApp } from '../context/AppContext.jsx';
import { OutputLog } from './OutputLog.jsx';
import { WasmBadge } from './WasmBadge.jsx';

export function ToolPanel() {
  const {
    currentTool,
    inputFiles,
    magickReady,
    isRunning,
    progressLabel,
    clearResults,
    resetOutputs,
    pushOutput,
    log,
    clearLog,
    setIsRunning,
    setProgressLabel,
    getRunner,
    currentCategory
  } = useApp();

  const tool = ART_TOOLS.find((t) => t.meta.id === currentTool);
  const fullBleed = tool?.meta.fullBleed === true;
  const needsWasm = tool?.meta.needsMagick ?? true;
  const needsFiles = tool?.meta.needsFiles !== false;
  const showArtToolbar = currentCategory === 'arttools';
  const runDisabled =
    isRunning || (needsFiles && inputFiles.length === 0) || (needsWasm && !magickReady);

  // Track which fullBleed tools have been activated so they stay mounted
  // (and keep their in-memory state, e.g. Scene Studio's Pixi instance).
  // We compute the render set synchronously so the first visit has no flash.
  const [activatedFullBleed, setActivatedFullBleed] = useState(() => new Set());
  const fullBleedIdsToRender = useMemo(() => {
    const ids = new Set(activatedFullBleed);
    if (fullBleed && currentTool) ids.add(currentTool);
    return ids;
  }, [activatedFullBleed, fullBleed, currentTool]);

  useEffect(() => {
    if (!fullBleed || !currentTool) return;
    setActivatedFullBleed((prev) => {
      if (prev.has(currentTool)) return prev;
      const next = new Set(prev);
      next.add(currentTool);
      return next;
    });
  }, [fullBleed, currentTool]);

  // Add a body class while a fullbleed tool is the active view so CSS can
  // target it without matching keep-mounted-but-hidden instances.
  useEffect(() => {
    if (fullBleed) {
      document.body.classList.add('fullbleed-tool-active');
    } else {
      document.body.classList.remove('fullbleed-tool-active');
    }
    return () => document.body.classList.remove('fullbleed-tool-active');
  }, [fullBleed]);

  const handleRestart = () => {
    resetOutputs();
    clearLog();
    log('— restarted — loaded files preserved —', 'info');
  };

  const handleRun = async () => {
    const runner = getRunner(currentTool);
    if (!runner) {
      log(`No runner registered for ${currentTool}`, 'err');
      return;
    }
    if (needsFiles && !inputFiles.length) return;

    clearLog();
    resetOutputs();
    setIsRunning(true);
    log(
      needsFiles
        ? `Running ${tool.meta.label} on ${inputFiles.length} file(s)`
        : `Running ${tool.meta.label}`,
      'info'
    );

    try {
      if (!needsFiles) {
        setProgressLabel('processing…');
        const blob = await runner.run(null, null, null, inputFiles);
        if (blob) {
          const outname = runner.outName();
          pushOutput({ name: outname, blob, url: URL.createObjectURL(blob) });
          log(`✓ → ${outname}`, 'ok');
          setProgressLabel('done — 1 file');
        } else {
          setProgressLabel('done');
        }
      } else if (tool.meta.batchMode) {
        setProgressLabel('processing…');
        const result = await runner.run(null, null, null, inputFiles);
        const items = Array.isArray(result)
          ? result
          : result
          ? [{ name: runner.outName(), blob: result }]
          : [];
        for (const { name, blob } of items) {
          pushOutput({ name, blob, url: URL.createObjectURL(blob) });
          log(`✓ → ${name}`, 'ok');
        }
        setProgressLabel(`done — ${items.length} file(s)`);
      } else {
        let okCount = 0;
        for (let i = 0; i < inputFiles.length; i++) {
          const { name, file } = inputFiles[i];
          setProgressLabel(`${i + 1} / ${inputFiles.length}`);
          try {
            const uint8 = new Uint8Array(await file.arrayBuffer());
            const blob = await runner.run(uint8, name, file);
            const outname = runner.outName(name);
            pushOutput({ name: outname, blob, url: URL.createObjectURL(blob) });
            log(`✓ ${name} → ${outname}`, 'ok');
            okCount++;
          } catch (e) {
            log(`✗ ${name}: ${e.message || e}`, 'err');
          }
        }
        setProgressLabel(`done — ${okCount} file(s)`);
      }
    } catch (e) {
      log(`✗ ${e.message || e}`, 'err');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <>
      {/* Persistent fullBleed panel — once a fullBleed tool is visited it stays
          mounted (display:none when inactive) so in-memory state is never lost.
          Scene Studio's Pixi instance and scene data survive tool switches. */}
      {fullBleedIdsToRender.size > 0 && (
        <div className="panel fullbleed-panel" style={{ display: fullBleed ? undefined : 'none' }}>
          {[...fullBleedIdsToRender].map((toolId) => {
            const t = ART_TOOLS.find((x) => x.meta.id === toolId);
            if (!t) return null;
            return (
              <div
                key={toolId}
                style={{
                  display: toolId === currentTool ? 'flex' : 'none',
                  flexDirection: 'column',
                  width: '100%',
                  minHeight: 0,
                  flex: 1
                }}
              >
                <t.Component />
              </div>
            );
          })}
        </div>
      )}

      {/* Regular (non-fullBleed) art tool settings panel */}
      {!fullBleed && (
        <div className="panel">
          <div className="panel-header">
            <div className="panel-header-title">
              settings <span>{tool?.meta.label || ''}</span>
            </div>
            {showArtToolbar ? (
              <div className="panel-header-tools">
                <WasmBadge />
                <button
                  className="restart-btn"
                  title="Restart toolkit — loaded files are preserved"
                  onClick={handleRestart}
                >
                  ↻ restart
                </button>
              </div>
            ) : null}
          </div>
          <div className="settings-body">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentTool}
                className="tool-section"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <p className="tool-desc">{tool?.meta.desc}</p>
                {tool && <tool.Component />}
              </motion.div>
            </AnimatePresence>

            <div className="action-row">
              <motion.button
                className="btn btn-primary"
                disabled={runDisabled}
                onClick={handleRun}
                whileTap={{ scale: 0.97 }}
              >
                ▶ RUN
              </motion.button>
              <button className="btn" onClick={clearResults}>
                CLEAR
              </button>
              <span className="progress-label">{progressLabel}</span>
            </div>

            <OutputLog />
          </div>
        </div>
      )}
    </>
  );
}
