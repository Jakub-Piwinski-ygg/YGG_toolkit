import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';

const MAGICK_URL = 'https://knicknic.github.io/wasm-imagemagick/magickApi.js';

export function useMagick() {
  const { setMagickReady, clearLog, log } = useApp();

  useEffect(() => {
    if (window._Magick) {
      setMagickReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // @vite-ignore — external CDN module, loaded at runtime not build time
        const Magick = await import(/* @vite-ignore */ MAGICK_URL);
        if (cancelled) return;
        window._Magick = Magick;
        setMagickReady(true);
        clearLog();
        log('ImageMagick WASM loaded — no local install needed', 'info');
        log('Drop PNG files on the left, choose a tool and hit RUN.', 'info');
      } catch (e) {
        if (cancelled) return;
        log(`WASM load failed: ${e.message || e}`, 'err');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
