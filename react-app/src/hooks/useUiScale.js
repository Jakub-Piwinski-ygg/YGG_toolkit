// useUiScale — global UI zoom for the whole toolkit.
//
// The shell mixes rem (app shell) and px (Scene Studio) units, so a
// root-font-size approach wouldn't scale Scene Studio. CSS `zoom` scales every
// unit uniformly, and — crucially — keeps pointer coordinates and
// getBoundingClientRect in the same post-zoom space, so the Pixi viewport's
// hit-testing stays correct.
//
// Default is 0.8 (80%) on first load. Ctrl/Cmd + '-' / '='|'+' step the scale;
// Ctrl/Cmd + '0' resets to the 0.8 default. The choice persists.

import { useEffect } from 'react';

// v2: default lowered to 0.8 (the earlier 1.5 was too big). Bumping the key
// so anyone with a persisted 1.5 gets the new default once, then their own
// Ctrl±/0 choices persist again.
const LS_KEY = 'ygg-toolkit:ui-scale:v2';
const MIN = 0.5;
const MAX = 2.5;
const STEP = 0.1;
const DEFAULT = 0.8;

export function useUiScale() {
  useEffect(() => {
    const root = document.getElementById('root');
    const clamp = (v) => Math.min(MAX, Math.max(MIN, Math.round(v * 100) / 100));

    let scale = DEFAULT;
    try {
      const saved = parseFloat(localStorage.getItem(LS_KEY));
      if (Number.isFinite(saved)) scale = clamp(saved);
    } catch { /* no storage */ }

    const apply = (v) => {
      scale = clamp(v);
      if (root) root.style.zoom = String(scale);
      try { localStorage.setItem(LS_KEY, String(scale)); } catch { /* quota */ }
    };
    apply(scale);

    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); apply(scale + STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); apply(scale - STEP); }
      else if (e.key === '0') { e.preventDefault(); apply(DEFAULT); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
