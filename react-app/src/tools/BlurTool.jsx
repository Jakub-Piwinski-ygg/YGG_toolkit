import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { freshBytes } from '../utils/image.js';

export const blurMeta = {
  id: 'blur',
  label: 'Directional Blur',
  small: 'motion blur with feathering',
  icon: '💨',
  needsMagick: true,
  batchMode: false,
  desc: 'Applies directional motion blur — edges fade to transparent so the blur blends naturally with surroundings.'
};

export function BlurTool() {
  const [radius, setRadius] = useState(0);
  const [sigma, setSigma] = useState(20);
  const [angle, setAngle] = useState(90);
  const [feather, setFeather] = useState(5);
  const { registerRunner } = useApp();

  const settingsRef = useRef({ radius, sigma, angle, feather });
  settingsRef.current = { radius, sigma, angle, feather };

  useEffect(() => {
    registerRunner(blurMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_blur.png',
      run: async (uint8) => {
        const { radius, sigma, angle, feather } = settingsRef.current;
        const blurArg = `${radius}x${sigma}+${angle}`;

        const r1 = await window._Magick.Call(
          [{ name: 'input.png', content: uint8 }],
          ['convert', 'input.png', '-motion-blur', blurArg, 'blurred.png']
        );
        if (!r1 || !r1.length) throw new Error('Motion blur failed');
        const blurred = r1[0].blob;

        const r2 = await window._Magick.Call(
          [{ name: 'blurred.png', content: await freshBytes(blurred) }],
          ['convert', 'blurred.png', '-alpha', 'off', '-fill', 'white', '-colorize', '100', '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`, '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
        );
        if (!r2 || !r2.length) throw new Error('Mask creation failed');
        const mask = r2[0].blob;

        const r3 = await window._Magick.Call(
          [{ name: 'blurred.png', content: await freshBytes(blurred) }],
          ['convert', 'blurred.png', '-alpha', 'extract', 'orig_alpha.png']
        );
        if (!r3 || !r3.length) throw new Error('Alpha extract failed');
        const alpha = r3[0].blob;

        const r4 = await window._Magick.Call(
          [
            { name: 'orig_alpha.png', content: await freshBytes(alpha) },
            { name: 'mask.png', content: await freshBytes(mask) }
          ],
          ['convert', 'orig_alpha.png', 'mask.png', '-compose', 'Multiply', '-composite', 'combined_alpha.png']
        );
        if (!r4 || !r4.length) throw new Error('Alpha multiply failed');
        const cAlpha = r4[0].blob;

        const r5 = await window._Magick.Call(
          [
            { name: 'blurred.png', content: await freshBytes(blurred) },
            { name: 'combined_alpha.png', content: await freshBytes(cAlpha) }
          ],
          ['convert', 'blurred.png', 'combined_alpha.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
        );
        if (!r5 || !r5.length) throw new Error('Final composite failed');
        return r5[0].blob;
      }
    });
    return () => registerRunner(blurMeta.id, null);
  }, [registerRunner]);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Radius</label>
          <input type="number" min="0" max="50" value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </div>
        <div className="field">
          <label>Sigma (strength)</label>
          <input type="number" min="1" max="100" value={sigma} onChange={(e) => setSigma(+e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>
            Angle — <span style={{ color: 'var(--accent)' }}>{angle}°</span>
          </label>
          <input type="range" min="0" max="360" value={angle} onChange={(e) => setAngle(+e.target.value)} />
        </div>
        <div className="field">
          <label>Edge Feather (px)</label>
          <input type="number" min="0" max="100" value={feather} onChange={(e) => setFeather(+e.target.value)} />
        </div>
      </div>
    </>
  );
}
