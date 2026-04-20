import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { freshBytes, getImageDimensions } from '../utils/image.js';

export const outlineMeta = {
  id: 'outline',
  label: 'Outline / Stroke',
  small: 'edge-accurate contour',
  icon: '🔲',
  needsMagick: true,
  batchMode: false,
  desc: "Creates a precise outline around every opaque edge of the image using morphological dilation on the alpha channel — the same technique as Photoshop's Stroke (Outside). Works correctly with concavities, holes, thin features and semi-transparent edges."
};

export function OutlineTool() {
  const [width, setWidth] = useState(3);
  const [color, setColor] = useState('#ffffff');
  const [opacity, setOpacity] = useState(100);
  const [position, setPosition] = useState('outside');
  const [threshold, setThreshold] = useState(1);
  const [canvasMode, setCanvasMode] = useState('expand');
  const [kernel, setKernel] = useState('Disk');
  const { registerRunner } = useApp();

  const settingsRef = useRef({ width, color, opacity, position, threshold, canvasMode, kernel });
  settingsRef.current = { width, color, opacity, position, threshold, canvasMode, kernel };

  useEffect(() => {
    registerRunner(outlineMeta.id, {
      outName: (n) => n.replace(/\.png$/i, '') + '_outline.png',
      run: async (uint8) => {
        const { width, color, opacity, position, threshold, canvasMode, kernel } = settingsRef.current;

        let dilateR, erodeR;
        if (position === 'outside') { dilateR = width; erodeR = 0; }
        else if (position === 'inside') { dilateR = 0; erodeR = width; }
        else { dilateR = Math.ceil(width / 2); erodeR = Math.floor(width / 2); }

        let workingUint8;
        if (canvasMode === 'expand' && dilateR > 0) {
          const pad = dilateR;
          const dims = await getImageDimensions(uint8);
          const ew = dims.w + pad * 2, eh = dims.h + pad * 2;
          const padCopy = uint8.slice();
          const rPad = await window._Magick.Call(
            [{ name: 'input.png', content: padCopy }],
            ['convert', 'input.png', '-background', 'transparent', '-gravity', 'Center', '-extent', `${ew}x${eh}`, '+repage', 'padded.png']
          );
          if (!rPad || !rPad.length) throw new Error('Canvas expand failed');
          workingUint8 = await freshBytes(rPad[0].blob);
        } else {
          workingUint8 = uint8.slice();
        }

        const rAlpha = await window._Magick.Call(
          [{ name: 'work.png', content: workingUint8.slice() }],
          ['convert', 'work.png', '-alpha', 'extract', 'alpha.png']
        );
        if (!rAlpha || !rAlpha.length) throw new Error('Alpha extract failed');
        const alphaBlob = rAlpha[0].blob;

        let dilatedBlob = alphaBlob;
        if (dilateR > 0) {
          const args = ['convert', 'alpha.png', '-morphology', 'Dilate', `${kernel}:${dilateR}`];
          if (threshold > 0) args.push('-threshold', `${threshold}%`);
          args.push('dilated.png');
          const rDilate = await window._Magick.Call(
            [{ name: 'alpha.png', content: await freshBytes(alphaBlob) }], args
          );
          if (!rDilate || !rDilate.length) throw new Error('Dilation failed');
          dilatedBlob = rDilate[0].blob;
        }

        let erodedBlob = alphaBlob;
        if (erodeR > 0) {
          const args = ['convert', 'alpha.png', '-morphology', 'Erode', `${kernel}:${erodeR}`];
          if (threshold > 0) args.push('-threshold', `${threshold}%`);
          args.push('eroded.png');
          const rErode = await window._Magick.Call(
            [{ name: 'alpha.png', content: await freshBytes(alphaBlob) }], args
          );
          if (!rErode || !rErode.length) throw new Error('Erosion failed');
          erodedBlob = rErode[0].blob;
        }

        let maskA, maskB;
        if (position === 'outside') { maskA = dilatedBlob; maskB = alphaBlob; }
        else if (position === 'inside') { maskA = alphaBlob; maskB = erodedBlob; }
        else { maskA = dilatedBlob; maskB = erodedBlob; }

        const rNeg = await window._Magick.Call(
          [{ name: 'b.png', content: await freshBytes(maskB) }],
          ['convert', 'b.png', '-negate', 'b_neg.png']
        );
        if (!rNeg || !rNeg.length) throw new Error('Negate failed');
        const negBlob = rNeg[0].blob;

        const rMask = await window._Magick.Call(
          [{ name: 'a.png', content: await freshBytes(maskA) }, { name: 'b_neg.png', content: await freshBytes(negBlob) }],
          ['convert', 'a.png', 'b_neg.png', '-compose', 'Multiply', '-composite', 'outline_mask.png']
        );
        if (!rMask || !rMask.length) throw new Error('Outline mask failed');
        let outlineMaskBlob = rMask[0].blob;

        if (opacity < 100) {
          const opFrac = (opacity / 100).toFixed(4);
          const rOp = await window._Magick.Call(
            [{ name: 'outline_mask.png', content: await freshBytes(outlineMaskBlob) }],
            ['convert', 'outline_mask.png', '-evaluate', 'Multiply', opFrac, 'outline_mask_op.png']
          );
          if (!rOp || !rOp.length) throw new Error('Opacity multiply failed');
          outlineMaskBlob = rOp[0].blob;
        }

        const rColor = await window._Magick.Call(
          [{ name: 'outline_mask.png', content: await freshBytes(outlineMaskBlob) }],
          ['convert', 'outline_mask.png', '-fill', color, '-colorize', '100', 'colored.png']
        );
        if (!rColor || !rColor.length) throw new Error('Colorize failed');
        const coloredBlob = rColor[0].blob;

        const rApplyMask = await window._Magick.Call(
          [{ name: 'colored.png', content: await freshBytes(coloredBlob) }, { name: 'outline_mask.png', content: await freshBytes(outlineMaskBlob) }],
          ['convert', 'colored.png', 'outline_mask.png', '-alpha', 'copy', '-compose', 'CopyOpacity', '-composite', 'outline_layer.png']
        );
        if (!rApplyMask || !rApplyMask.length) throw new Error('Outline layer composite failed');
        const outlineLayerBlob = rApplyMask[0].blob;

        const rFinal = await window._Magick.Call(
          [{ name: 'outline_layer.png', content: await freshBytes(outlineLayerBlob) }, { name: 'work.png', content: workingUint8.slice() }],
          ['convert', 'outline_layer.png', 'work.png', '-compose', 'Over', '-composite', 'output.png']
        );
        if (!rFinal || !rFinal.length) throw new Error('Final composite failed');
        return rFinal[0].blob;
      }
    });
    return () => registerRunner(outlineMeta.id, null);
  }, [registerRunner]);

  return (
    <>
      <div className="field-row">
        <div className="field">
          <label>Outline width (px) — <span style={{ color: 'var(--accent)' }}>{width}</span></label>
          <input type="range" min="1" max="40" step="1" value={width} onChange={(e) => setWidth(+e.target.value)} />
        </div>
        <div className="field">
          <label>Outline colour</label>
          <div className="color-swatch">
            <div className="color-dot" style={{ background: color }} />
            <span className="color-hex">{color}</span>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Outline opacity — <span style={{ color: 'var(--accent)' }}>{opacity}%</span></label>
          <input type="range" min="1" max="100" step="1" value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
        </div>
        <div className="field">
          <label>Position</label>
          <select value={position} onChange={(e) => setPosition(e.target.value)}>
            <option value="outside">Outside</option>
            <option value="center">Center</option>
            <option value="inside">Inside</option>
          </select>
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Threshold — <span style={{ color: 'var(--accent)' }}>{threshold}%</span></label>
          <input type="range" min="0" max="50" step="1" value={threshold} onChange={(e) => setThreshold(+e.target.value)} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.55rem', color: '#555', display: 'block', marginTop: '.15rem' }}>
            0% = soft anti-aliased edges · higher = harder cutoff
          </span>
        </div>
        <div className="field">
          <label>Canvas handling</label>
          <select value={canvasMode} onChange={(e) => setCanvasMode(e.target.value)}>
            <option value="expand">Expand canvas by outline width</option>
            <option value="keep">Keep original canvas (outline may clip)</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Kernel shape</label>
        <select value={kernel} onChange={(e) => setKernel(e.target.value)}>
          <option value="Disk">Disk (round, smooth)</option>
          <option value="Square">Square (blocky, fast)</option>
          <option value="Diamond">Diamond (45° edges)</option>
        </select>
      </div>
    </>
  );
}
