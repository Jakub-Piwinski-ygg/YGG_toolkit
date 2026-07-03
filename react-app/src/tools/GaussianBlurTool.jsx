import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { freshBytes, makeFeatherMask } from '../utils/image.js';
import { makeBatchRun } from '../utils/batch.js';
import { NumberField } from '../components/NumberField.jsx';

export const gaussBlurMeta = {
  id: 'gaussblur',
  label: 'Gaussian Blur',
  small: 'uniform soft blur',
  icon: '🔘',
  needsMagick: true,
  batchMode: true,
  desc: 'Applies a standard Gaussian blur uniformly across the image. Adjust sigma to control blur strength and radius to set the kernel size (0 = auto from sigma). Optionally feather edges to transparent for compositing.'
};

export function GaussianBlurTool() {
  const [radius, setRadius] = useState(0);
  const [sigma, setSigma] = useState(4);
  const [feather, setFeather] = useState(0);
  const [alphaMode, setAlphaMode] = useState('blur');
  const { registerRunner, log, setProgressLabel } = useApp();

  const settingsRef = useRef({ radius, sigma, feather, alphaMode });
  settingsRef.current = { radius, sigma, feather, alphaMode };

  useEffect(() => {
    const outName = (n) => n.replace(/\.png$/i, '') + '_gblur.png';
    const processOne = async (uint8) => {
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
            const mask = await makeFeatherMask(await freshBytes(alpha), feather, { prep: 'asis' });
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

          const mask = await makeFeatherMask(await freshBytes(blurred), feather, { prep: 'alphaExtract' });

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
    };
    registerRunner(gaussBlurMeta.id, {
      outName,
      run: makeBatchRun(processOne, outName, { log, setProgressLabel })
    });
    return () => registerRunner(gaussBlurMeta.id, null);
  }, [registerRunner, log, setProgressLabel]);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Radius (0 = auto)</label>
          <NumberField min={0} max={100} value={radius} onChange={(v) => setRadius(v)} />
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
          <NumberField min={0} max={200} value={feather} onChange={(v) => setFeather(v)} />
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
