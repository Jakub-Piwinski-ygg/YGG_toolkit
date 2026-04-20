import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getImageDimensions } from '../utils/image.js';

export const cropMeta = {
  id: 'crop',
  label: 'Canvas Resize',
  small: 'crop or pad to exact size',
  icon: '✂️',
  needsMagick: true,
  batchMode: false,
  desc: 'Resizes the canvas of each PNG to exact pixel dimensions. If the target is smaller than the source the image is center-cropped; if larger, transparent pixels are added around the image to reach the target size.'
};

export function CropTool() {
  const [w, setW] = useState(256);
  const [h, setH] = useState(256);
  const [modeHint, setModeHint] = useState({ className: '', text: 'load files to preview mode' });
  const { inputFiles, log, registerRunner } = useApp();

  const settingsRef = useRef({ w, h });
  settingsRef.current = { w, h };

  useEffect(() => {
    registerRunner(cropMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_resized.png',
      run: async (uint8) => {
        const { w: tw, h: th } = settingsRef.current;
        const r = await window._Magick.Call(
          [{ name: 'input.png', content: uint8 }],
          ['convert', 'input.png', '-background', 'transparent', '-gravity', 'Center', '-extent', `${tw}x${th}`, '+repage', 'output.png']
        );
        if (!r || !r.length) throw new Error('No output from ImageMagick');
        return r[0].blob;
      }
    });
    return () => registerRunner(cropMeta.id, null);
  }, [registerRunner]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!inputFiles.length || !w || !h) {
        setModeHint({ className: '', text: 'load files to preview mode' });
        return;
      }
      try {
        const bytes = new Uint8Array(await inputFiles[0].file.arrayBuffer());
        const dims = await getImageDimensions(bytes);
        if (cancelled) return;
        const willCrop = w < dims.w || h < dims.h;
        const willPad = w > dims.w || h > dims.h;
        if (willCrop && willPad)
          setModeHint({ className: 'mode-crop', text: 'mixed — crop on one axis, pad on other' });
        else if (willCrop)
          setModeHint({ className: 'mode-crop', text: 'will CENTER CROP (target smaller than source)' });
        else if (willPad)
          setModeHint({ className: 'mode-pad', text: 'will PAD with transparency (target larger than source)' });
        else
          setModeHint({ className: 'mode-pad', text: 'same size — no change' });
      } catch {
        /* ignore */
      }
    })();
    return () => { cancelled = true; };
  }, [inputFiles, w, h]);

  const matchFirst = async () => {
    if (!inputFiles.length) return;
    try {
      const bytes = new Uint8Array(await inputFiles[0].file.arrayBuffer());
      const dims = await getImageDimensions(bytes);
      setW(dims.w);
      setH(dims.h);
      log(`✓ matched first image: ${dims.w} × ${dims.h} px`, 'ok');
    } catch (e) {
      log(`✗ match failed: ${e.message || e}`, 'err');
    }
  };

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Width (px)</label>
          <input type="number" min="1" max="8192" value={w} onChange={(e) => setW(+e.target.value)} />
        </div>
        <div className="field">
          <label>Height (px)</label>
          <input type="number" min="1" max="8192" value={h} onChange={(e) => setH(+e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
        <button className="btn btn-match" disabled={!inputFiles.length} onClick={matchFirst}>
          ↓ match first image
        </button>
        <div className={`crop-mode-hint ${modeHint.className}`}>
          <span className="mode-dot"></span>
          <span>{modeHint.text}</span>
        </div>
      </div>
    </>
  );
}
