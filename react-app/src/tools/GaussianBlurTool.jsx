import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { freshBytes } from '../utils/image.js';

export const gaussBlurMeta = {
  id: 'gaussblur',
  label: 'Gaussian Blur',
  small: 'uniform soft blur',
  icon: '🔘',
  needsMagick: true,
  batchMode: false,
  desc: 'Applies a standard Gaussian blur uniformly across the image. Adjust sigma to control blur strength and radius to set the kernel size (0 = auto from sigma). Optionally feather edges to transparent for compositing.'
};

export function GaussianBlurTool() {
  const [radius, setRadius] = useState(0);
  const [sigma, setSigma] = useState(4);
  const [feather, setFeather] = useState(0);
  const [alphaMode, setAlphaMode] = useState('blur');
  const { registerRunner } = useApp();

  const settingsRef = useRef({ radius, sigma, feather, alphaMode });
  settingsRef.current = { radius, sigma, feather, alphaMode };

  useEffect(() => {
    registerRunner(gaussBlurMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_gblur.png',
      run: async (uint8) => {
        const { radius, sigma, feather, alphaMode } = settingsRef.current;
        const blurArg = `${radius}x${sigma}`;

        if (alphaMode === 'keep') {
          const uint8copy = uint8.slice();

          const rA = await window._Magick.Call(
            [{ name: 'input.png', content: uint8 }],
            ['convert', 'input.png', '-alpha', 'extract', 'alpha.png']
          );
          if (!rA || !rA.length) throw new Error('Alpha extract failed');
          const alpha = rA[0].blob;

          const rB = await window._Magick.Call(
            [{ name: 'input.png', content: uint8copy }],
            ['convert', 'input.png', '-blur', blurArg, 'blurred.png']
          );
          if (!rB || !rB.length) throw new Error('Gaussian blur failed');
          const blurred = rB[0].blob;

          if (feather > 0) {
            const rM = await window._Magick.Call(
              [{ name: 'alpha.png', content: await freshBytes(alpha) }],
              ['convert', 'alpha.png', '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`, '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
            );
            if (!rM || !rM.length) throw new Error('Feather mask failed');
            const mask = rM[0].blob;
            const rMul = await window._Magick.Call(
              [{ name: 'alpha.png', content: await freshBytes(alpha) }, { name: 'mask.png', content: await freshBytes(mask) }],
              ['convert', 'alpha.png', 'mask.png', '-compose', 'Multiply', '-composite', 'combined.png']
            );
            if (!rMul || !rMul.length) throw new Error('Alpha multiply failed');
            const cAlpha = rMul[0].blob;
            const rF = await window._Magick.Call(
              [{ name: 'blurred.png', content: await freshBytes(blurred) }, { name: 'combined.png', content: await freshBytes(cAlpha) }],
              ['convert', 'blurred.png', 'combined.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
            );
            if (!rF || !rF.length) throw new Error('Final composite failed');
            return rF[0].blob;
          }
          const rF = await window._Magick.Call(
            [{ name: 'blurred.png', content: await freshBytes(blurred) }, { name: 'alpha.png', content: await freshBytes(alpha) }],
            ['convert', 'blurred.png', 'alpha.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
          );
          if (!rF || !rF.length) throw new Error('Final composite failed');
          return rF[0].blob;
        }

        if (feather > 0) {
          const rB = await window._Magick.Call(
            [{ name: 'input.png', content: uint8 }],
            ['convert', 'input.png', '-blur', blurArg, 'blurred.png']
          );
          if (!rB || !rB.length) throw new Error('Gaussian blur failed');
          const blurred = rB[0].blob;

          const rM = await window._Magick.Call(
            [{ name: 'blurred.png', content: await freshBytes(blurred) }],
            ['convert', 'blurred.png', '-alpha', 'extract', '-shave', `${feather}x${feather}`, '-bordercolor', 'black', '-border', `${feather}x${feather}`, '-blur', `0x${feather}`, '-level', '20%,80%', 'mask.png']
          );
          if (!rM || !rM.length) throw new Error('Feather mask failed');
          const mask = rM[0].blob;

          const rA = await window._Magick.Call(
            [{ name: 'blurred.png', content: await freshBytes(blurred) }],
            ['convert', 'blurred.png', '-alpha', 'extract', 'orig_a.png']
          );
          if (!rA || !rA.length) throw new Error('Alpha extract failed');
          const origA = rA[0].blob;

          const rMul = await window._Magick.Call(
            [{ name: 'orig_a.png', content: await freshBytes(origA) }, { name: 'mask.png', content: await freshBytes(mask) }],
            ['convert', 'orig_a.png', 'mask.png', '-compose', 'Multiply', '-composite', 'combined.png']
          );
          if (!rMul || !rMul.length) throw new Error('Alpha multiply failed');
          const cAlpha = rMul[0].blob;

          const rF = await window._Magick.Call(
            [{ name: 'blurred.png', content: await freshBytes(blurred) }, { name: 'combined.png', content: await freshBytes(cAlpha) }],
            ['convert', 'blurred.png', 'combined.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'output.png']
          );
          if (!rF || !rF.length) throw new Error('Final composite failed');
          return rF[0].blob;
        }

        const r = await window._Magick.Call(
          [{ name: 'input.png', content: uint8 }],
          ['convert', 'input.png', '-blur', blurArg, 'output.png']
        );
        if (!r || !r.length) throw new Error('Gaussian blur failed');
        return r[0].blob;
      }
    });
    return () => registerRunner(gaussBlurMeta.id, null);
  }, [registerRunner]);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Radius (0 = auto)</label>
          <input type="number" min="0" max="100" value={radius} onChange={(e) => setRadius(+e.target.value)} />
        </div>
        <div className="field">
          <label>
            Sigma (strength) — <span style={{ color: 'var(--accent)' }}>{sigma.toFixed(1)}</span>
          </label>
          <input type="range" min="0.1" max="80" step="0.1" value={sigma} onChange={(e) => setSigma(+e.target.value)} />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Edge feather (0 = none)</label>
          <input type="number" min="0" max="200" value={feather} onChange={(e) => setFeather(+e.target.value)} />
        </div>
        <div className="field">
          <label>Alpha handling</label>
          <select value={alphaMode} onChange={(e) => setAlphaMode(e.target.value)}>
            <option value="keep">Keep original alpha</option>
            <option value="blur">Blur alpha too</option>
          </select>
        </div>
      </div>
    </>
  );
}
