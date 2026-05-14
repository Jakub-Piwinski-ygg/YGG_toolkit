import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';

export const charExtractorMeta = {
  id: 'charextractor',
  label: 'Char Extractor',
  small: 'unique chars · font cmap',
  icon: '🔤',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Extract the unique character set from pasted text, or read the cmap table of a TTF / OTF / WOFF / WOFF2 font to list every codepoint it can render. Useful for sizing baked-text atlases, validating font coverage against a translation, or generating the minimal character list a localised font needs to support. Filters by spaces / punctuation / digits / emoji, sorts by unicode / alpha / category, renders glyphs in the loaded font.'
};

const OPENTYPE_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js';

// Lazy-loads opentype.js once and caches the global on window.
let _opentypePromise = null;
function loadOpentype() {
  if (window.opentype) return Promise.resolve(window.opentype);
  if (_opentypePromise) return _opentypePromise;
  _opentypePromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENTYPE_CDN;
    s.onload = () => resolve(window.opentype);
    s.onerror = () => reject(new Error('Failed to load opentype.js from CDN'));
    document.head.appendChild(s);
  });
  return _opentypePromise;
}

function getCategory(char) {
  const cp = char.codePointAt(0);
  if (cp === undefined) return 'other';
  if (/\s/.test(char)) return 'whitespace';
  try { if (/\p{Emoji}/u.test(char) && cp > 127) return 'emoji'; } catch (_) {}
  try { if (/\p{N}/u.test(char)) return 'digit'; } catch (_) {}
  try { if (/\p{P}|\p{S}/u.test(char)) return 'punctuation'; } catch (_) {}
  if (cp < 128) return 'ascii-letter';
  if (cp >= 0x4E00 && cp <= 0x9FFF) return 'CJK';
  if (cp >= 0x3400 && cp <= 0x4DBF) return 'CJK-ext';
  if (cp >= 0x0400 && cp <= 0x04FF) return 'Cyrillic';
  if (cp >= 0x0600 && cp <= 0x06FF) return 'Arabic';
  if (cp >= 0x0900 && cp <= 0x097F) return 'Devanagari';
  if (cp >= 0x0370 && cp <= 0x03FF) return 'Greek';
  if (cp >= 0xAC00 && cp <= 0xD7A3) return 'Korean';
  if (cp >= 0x3040 && cp <= 0x30FF) return 'Japanese';
  if (cp >= 0x0590 && cp <= 0x05FF) return 'Hebrew';
  if (cp >= 0x0E00 && cp <= 0x0E7F) return 'Thai';
  if (cp >= 0x0100 && cp <= 0x024F) return 'Latin-ext';
  return 'other';
}

function hex(cp) { return cp.toString(16).toUpperCase().padStart(4, '0'); }

export function CharExtractorTool() {
  const { log, registerRunner } = useApp();

  const [tab, setTab] = useState('text');        // 'text' | 'font'
  const [text, setText] = useState('');
  const [filters, setFilters] = useState({ spaces: true, punct: true, digits: true, emoji: true });
  const [sortMode, setSortMode] = useState('unicode');
  const [viewMode, setViewMode] = useState('grid');
  const [chars, setChars] = useState([]);        // [{char, cp, cat}]
  const [source, setSource] = useState('text');  // 'text' | 'font'
  const [fontInfo, setFontInfo] = useState(null);
  const [fontFileName, setFontFileName] = useState('');
  const [loadingFont, setLoadingFont] = useState(false);
  const [fontReady, setFontReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  // Sub-objects we need across the lifecycle but don't drive React renders directly.
  const parsedFontRef = useRef(null);
  const fontFaceRef = useRef(null);
  const fontUrlRef = useRef(null);

  const fontFamilyName = useMemo(
    () => 'CharExtractorFont_' + Math.random().toString(36).slice(2, 8),
    []
  );

  const extractText = () => {
    if (!text.trim()) {
      log('Char Extractor: paste some text first', 'err');
      return;
    }
    const seen = new Set();
    const result = [];
    for (const c of text) {
      if (!seen.has(c)) {
        seen.add(c);
        result.push({ char: c, cp: c.codePointAt(0), cat: getCategory(c) });
      }
    }
    setChars(result);
    setSource('text');
    log(`Char Extractor: extracted ${result.length} unique character(s) from text`, 'ok');
  };

  const extractFont = () => {
    const font = parsedFontRef.current;
    if (!font) {
      log('Char Extractor: load a font file first', 'err');
      return;
    }
    const cmapMap = font.tables.cmap.glyphIndexMap;
    const result = [];
    for (const cpStr of Object.keys(cmapMap)) {
      const cp = parseInt(cpStr, 10);
      if (cp < 32) continue;
      try {
        const c = String.fromCodePoint(cp);
        result.push({ char: c, cp, cat: getCategory(c) });
      } catch (_) {}
    }
    result.sort((a, b) => a.cp - b.cp);
    setChars(result);
    setSource('font');
    log(`Char Extractor: extracted ${result.length} glyph(s) from font cmap`, 'ok');
  };

  const handleFontFile = async (file) => {
    if (!file) return;
    setLoadingFont(true);
    setFontReady(false);
    try {
      const opentype = await loadOpentype();
      const buffer = await file.arrayBuffer();
      const font = opentype.parse(buffer);
      parsedFontRef.current = font;

      // Build a FontFace so we can render glyphs in the loaded face.
      if (fontUrlRef.current) URL.revokeObjectURL(fontUrlRef.current);
      const blob = new Blob([buffer], { type: 'font/ttf' });
      const url = URL.createObjectURL(blob);
      fontUrlRef.current = url;
      const ff = new FontFace(fontFamilyName, `url(${url})`);
      ff.load().then((loaded) => {
        document.fonts.add(loaded);
        fontFaceRef.current = loaded;
        setFontReady(true);
      }).catch(() => setFontReady(false));

      setFontInfo({
        family: font.names.fontFamily?.en || '—',
        style: font.names.fontSubfamily?.en || '—',
        version: font.names.version?.en || '—',
        glyphs: Object.keys(font.tables.cmap.glyphIndexMap).length
      });
      setFontFileName(file.name);
      log(`Char Extractor: loaded font "${file.name}" (${(file.size / 1024).toFixed(1)} KB)`, 'info');
    } catch (e) {
      log(`Char Extractor: could not parse font — ${e.message || e}`, 'err');
    } finally {
      setLoadingFont(false);
    }
  };

  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFontFile(f);
  };

  const clearFont = () => {
    parsedFontRef.current = null;
    setFontInfo(null);
    setFontFileName('');
    setFontReady(false);
    if (fontUrlRef.current) {
      URL.revokeObjectURL(fontUrlRef.current);
      fontUrlRef.current = null;
    }
  };

  const clearAll = () => {
    setText('');
    setChars([]);
    setSource('text');
    clearFont();
  };

  const copyChars = () => {
    const filtered = filterAndSort(chars, filters, sortMode);
    navigator.clipboard.writeText(filtered.map((c) => c.char).join('')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Revoke the font blob URL on unmount.
  useEffect(() => () => {
    if (fontUrlRef.current) URL.revokeObjectURL(fontUrlRef.current);
  }, []);

  // Wire the global RUN button to do "extract from active tab".
  useEffect(() => {
    registerRunner(charExtractorMeta.id, {
      outName: () => 'characters.txt',
      run: async () => {
        if (tab === 'font') extractFont();
        else extractText();
        return null;
      }
    });
    return () => registerRunner(charExtractorMeta.id, null);
    // re-register when settings that affect the closure change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerRunner, tab, text]);

  const filtered = useMemo(
    () => filterAndSort(chars, filters, sortMode),
    [chars, filters, sortMode]
  );

  const totalChars = source === 'font' ? chars.length : [...text].length;
  const scripts = new Set(filtered.map((c) => c.cat)).size;
  const useCustomFont = source === 'font' && fontReady;
  const glyphFamily = useCustomFont ? fontFamilyName : 'var(--font-mono)';

  return (
    <div className="charext">
      <div className="charext-grid">
        {/* INPUT */}
        <div className="charext-panel">
          <div className="charext-tabbar">
            <button
              className={'charext-tab' + (tab === 'text' ? ' active' : '')}
              onClick={() => setTab('text')}
            >📝 text input</button>
            <button
              className={'charext-tab font' + (tab === 'font' ? ' active' : '')}
              onClick={() => setTab('font')}
            >🔤 font file</button>
          </div>

          {tab === 'text' && (
            <>
              <div className="charext-header">
                paste text <span>{[...text].length} chars</span>
              </div>
              <textarea
                className="charext-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste your text here — supports any language, Chinese, Arabic, Cyrillic, emoji, special characters…"
                onKeyDown={(e) => { if (e.key === 'Enter' && e.ctrlKey) extractText(); }}
              />
              <div className="charext-controls">
                <button className="btn btn-primary" onClick={extractText}>EXTRACT</button>
                <button className="btn" onClick={clearAll}>CLEAR</button>
                <div className="charext-toggles">
                  {['spaces', 'punct', 'digits', 'emoji'].map((k) => (
                    <button
                      key={k}
                      className={'charext-toggle' + (filters[k] ? ' active' : '')}
                      onClick={() => setFilters((f) => ({ ...f, [k]: !f[k] }))}
                    >{k === 'punct' ? 'punctuation' : k}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {tab === 'font' && (
            <>
              <div className="charext-header">
                drop a font file <span style={{ color: 'var(--accent3)' }}>TTF · OTF · WOFF</span>
              </div>
              <label
                className={'charext-drop' + (dragOver ? ' drag-over' : '')}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  accept=".ttf,.otf,.woff,.woff2"
                  onChange={(e) => handleFontFile(e.target.files?.[0])}
                />
                <div className="charext-drop-icon">⬇</div>
                <div className="charext-drop-label">
                  {fontFileName ? (
                    <>
                      <strong>{fontFileName}</strong><br />
                      <span style={{ color: '#555', fontSize: '0.65rem' }}>loaded · click to change</span>
                    </>
                  ) : (
                    <>
                      Drop a <strong>TTF / OTF / WOFF</strong> file here<br />
                      or click to browse<br />
                      <span style={{ color: '#555', fontSize: '0.65rem' }}>reads cmap table only — no ligatures or font features</span>
                    </>
                  )}
                </div>
              </label>

              {loadingFont && (
                <div className="charext-progress"><div className="charext-progress-fill" /></div>
              )}

              {fontInfo && (
                <div className="charext-fontinfo">
                  <div><span>family</span><b>{fontInfo.family}</b></div>
                  <div><span>style</span><b>{fontInfo.style}</b></div>
                  <div><span>version</span><b>{fontInfo.version}</b></div>
                  <div><span>cmap entries</span><b>{fontInfo.glyphs.toLocaleString()}</b></div>
                </div>
              )}

              <div className="charext-controls">
                <button
                  className="btn btn-primary charext-btn-font"
                  onClick={extractFont}
                  disabled={!parsedFontRef.current}
                >EXTRACT FROM FONT</button>
                <button className="btn" onClick={clearFont}>CLEAR</button>
              </div>
            </>
          )}
        </div>

        {/* OUTPUT */}
        <div className="charext-panel">
          <div className="charext-header">
            unique characters
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <select className="charext-select" value={sortMode} onChange={(e) => setSortMode(e.target.value)}>
                <option value="unicode">sort: unicode</option>
                <option value="alpha">sort: alpha</option>
                <option value="category">sort: category</option>
              </select>
              <select className="charext-select" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
                <option value="grid">view: grid</option>
                <option value="list">view: list</option>
                <option value="table">view: table</option>
              </select>
            </div>
          </div>

          <div className="charext-output">
            {filtered.length === 0 ? (
              <div className="charext-empty">↑ paste text or drop a font file to extract characters</div>
            ) : viewMode === 'grid' ? (
              <div className="charext-cardgrid">
                {filtered.map((c) => (
                  <div className="charext-card" key={c.cp} title={`U+${hex(c.cp)} · ${c.cat}`}>
                    <span className="charext-glyph" style={{ fontFamily: glyphFamily }}>{c.char}</span>
                    <span className="charext-meta">U+{hex(c.cp)}</span>
                  </div>
                ))}
              </div>
            ) : viewMode === 'list' ? (
              <div className="charext-list" style={{ fontFamily: glyphFamily }}>
                {filtered.map((c) => c.char).join(' ')}
              </div>
            ) : (
              <table className="charext-table">
                <thead>
                  <tr>
                    <th>char</th>
                    <th>codepoint</th>
                    <th>hex entity</th>
                    <th>category</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.cp}>
                      <td style={{ fontSize: '1.2rem', fontFamily: glyphFamily }}>{c.char}</td>
                      <td>U+{hex(c.cp)}</td>
                      <td style={{ color: '#555' }}>&#x{hex(c.cp)};</td>
                      <td><span className="charext-badge">{c.cat}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {filtered.length > 0 && (
            <div className="charext-statbar">
              <div>unique: <b>{filtered.length.toLocaleString()}</b></div>
              <div>total: <b>{totalChars.toLocaleString()}</b></div>
              <div>scripts: <b>{scripts}</b></div>
              <span className={'charext-source ' + source}>
                {source === 'font' ? `🔤 ${fontInfo?.family || fontFileName}` : '📝 text'}
              </span>
              <button className="btn" onClick={copyChars}>COPY ALL</button>
            </div>
          )}
        </div>
      </div>

      {copied && <div className="charext-flash">Copied!</div>}
    </div>
  );
}

function filterAndSort(chars, filters, sortMode) {
  const filtered = chars.filter((c) => {
    if (!filters.spaces && c.cat === 'whitespace') return false;
    if (!filters.punct && c.cat === 'punctuation') return false;
    if (!filters.digits && c.cat === 'digit') return false;
    if (!filters.emoji && c.cat === 'emoji') return false;
    return true;
  });
  if (sortMode === 'alpha') filtered.sort((a, b) => a.char.localeCompare(b.char));
  else if (sortMode === 'unicode') filtered.sort((a, b) => a.cp - b.cp);
  else if (sortMode === 'category') filtered.sort((a, b) => a.cat.localeCompare(b.cat) || a.cp - b.cp);
  return filtered;
}
