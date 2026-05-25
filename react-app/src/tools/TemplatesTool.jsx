import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { marked } from 'marked';
import { useApp } from '../context/AppContext.jsx';

export const templatesMeta = {
  id: 'templates',
  label: 'Templates Library',
  small: 'team templates & how-tos',
  icon: '📐',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true,
  desc: 'Browse the team\'s official templates (PSDs, AEPs, Unity prefabs, etc). Each entry is a Markdown file in public/templates/ with YAML frontmatter — drop a new .md in there, list it in manifest.json, and it shows up here. Click a card to expand instructions, then grab the latest file from SharePoint via the link at the bottom.'
};

// Base URL respects Vite's `base` config (e.g. './' locally vs '/YGG_toolkit/'
// on GitHub Pages). All template assets are addressed relative to this.
const TEMPLATES_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') + '/templates/';

// Minimal frontmatter parser — handles the flat `key: value` shape we need.
// Values are trimmed, surrounding quotes stripped. Colons in values are kept
// (we split on the FIRST `:` so URLs survive). No nested structures supported
// because we don't need them.
function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { data: {}, body: raw };
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: match[2] };
}

// Rewrite a relative URL (./foo.png, foo.png, images/x.png) to live under
// /templates/. Absolute URLs (http(s)://, /abs/path) are returned unchanged.
function resolveAsset(url) {
  if (!url) return url;
  if (/^([a-z]+:)?\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  return TEMPLATES_BASE + url.replace(/^\.\//, '');
}

// Configure marked once. Internal team content is trusted, so no sanitization.
const renderer = new marked.Renderer();
const origImage = renderer.image.bind(renderer);
const origLink = renderer.link.bind(renderer);
renderer.image = ({ href, title, text }) => origImage({ href: resolveAsset(href), title, text });
renderer.link = ({ href, title, text }) => {
  const html = origLink({ href, title, text });
  // External / sharepoint links open in a new tab.
  return html.replace('<a ', '<a target="_blank" rel="noreferrer" ');
};
marked.use({ renderer, gfm: true, breaks: false });

// Split rendered HTML at the first heading whose text matches "step-by-step"
// (case-insensitive, hyphen optional). Everything before is the intro, the
// heading and everything after becomes the collapsible steps block. If no
// such heading exists the whole body is treated as intro.
function splitAtSteps(html) {
  if (!html) return { intro: '', steps: null };
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const wrapper = doc.body.firstChild;
  const children = [...wrapper.children];
  const idx = children.findIndex(
    (el) => /^H[1-6]$/.test(el.tagName) && /step.?by.?step/i.test(el.textContent || '')
  );
  if (idx === -1) return { intro: html, steps: null };
  // Drop a trailing <hr> from the intro — the SharePoint button gives us a
  // natural visual break, an extra horizontal rule looks redundant.
  let introEnd = idx;
  if (introEnd > 0 && children[introEnd - 1].tagName === 'HR') introEnd -= 1;
  const intro = children.slice(0, introEnd).map((el) => el.outerHTML).join('');
  const steps = children.slice(idx).map((el) => el.outerHTML).join('');
  return { intro, steps };
}

export function TemplatesTool() {
  const { log } = useApp();
  const [templates, setTemplates] = useState([]);
  const [loadState, setLoadState] = useState('idle'); // idle | loading | ok | err
  const [loadErr, setLoadErr] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const loggedRef = useRef(false);

  // Steps collapse resets whenever the user opens a different card (or closes
  // the current one). One bool is enough since only one card is open at a time.
  useEffect(() => { setStepsOpen(false); }, [expandedId]);

  const loadAll = async () => {
    setLoadState('loading');
    setLoadErr(null);
    try {
      const manifestRes = await fetch(TEMPLATES_BASE + 'manifest.json', { cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error(`manifest.json: ${manifestRes.status}`);
      const manifest = await manifestRes.json();
      const files = Array.isArray(manifest.templates) ? manifest.templates : [];

      const loaded = await Promise.all(files.map(async (file) => {
        try {
          const res = await fetch(TEMPLATES_BASE + file, { cache: 'no-cache' });
          if (!res.ok) throw new Error(`${file}: ${res.status}`);
          const raw = await res.text();
          const { data, body } = parseFrontmatter(raw);
          return {
            id: file,
            name: data.name || file.replace(/\.md$/i, ''),
            description: data.description || '',
            sharepoint: data.sharepoint || '',
            preview: data.preview ? resolveAsset(data.preview) : null,
            updated: data.updated || '',
            ...splitAtSteps(marked.parse(body || ''))
          };
        } catch (e) {
          return { id: file, error: e.message || String(e), name: file };
        }
      }));

      setTemplates(loaded);
      setLoadState('ok');
      if (!loggedRef.current) {
        log(`Loaded ${loaded.length} template${loaded.length === 1 ? '' : 's'} from /templates/.`, 'ok');
        loggedRef.current = true;
      }
    } catch (e) {
      setLoadState('err');
      setLoadErr(e.message || String(e));
      log(`Templates: ${e.message || e}`, 'err');
    }
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const toggle = (id) => setExpandedId((cur) => (cur === id ? null : id));

  const fallbackThumb = useMemo(() => (
    <div className="tpl-thumb tpl-thumb-fallback">
      <span>📄</span>
    </div>
  ), []);

  return (
    <div className="tool-section tpl-root">
      <div className="tpl-head-row">
        <div className="tpl-head-text">
          <div className="tpl-head-title">Team Templates</div>
          <div className="tpl-head-sub">
            {loadState === 'loading' && 'loading…'}
            {loadState === 'ok' && `${templates.length} template${templates.length === 1 ? '' : 's'} — click a card to expand instructions`}
            {loadState === 'err' && <span className="tpl-err-inline">failed to load: {loadErr}</span>}
          </div>
        </div>
        <button className="btn" type="button" onClick={loadAll} title="Refresh from disk">↻ Reload</button>
      </div>

      <div className="tpl-list">
        {templates.map((t) => {
          const open = expandedId === t.id;
          const hasError = !!t.error;
          return (
            <motion.div
              key={t.id}
              layout
              className={`tpl-card ${open ? 'tpl-open' : ''} ${hasError ? 'tpl-error' : ''}`}
              transition={{ layout: { type: 'spring', stiffness: 320, damping: 32 } }}
            >
              <button
                type="button"
                className="tpl-card-head"
                onClick={() => !hasError && toggle(t.id)}
                disabled={hasError}
              >
                {t.preview
                  ? <img className="tpl-thumb" src={t.preview} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  : fallbackThumb}
                <div className="tpl-card-text">
                  <div className="tpl-card-name">{t.name}</div>
                  {!hasError && t.description && <div className="tpl-card-desc">{t.description}</div>}
                  {hasError && <div className="tpl-card-desc tpl-err-inline">⚠ {t.error}</div>}
                </div>
                {t.updated && <span className="tpl-card-date" title="Last edited">{t.updated}</span>}
                {!hasError && <span className="tpl-card-caret">{open ? '▾' : '▸'}</span>}
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="body"
                    className="tpl-card-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                  >
                    {t.intro && (
                      <div className="tpl-md tpl-md-intro" dangerouslySetInnerHTML={{ __html: t.intro }} />
                    )}

                    {t.sharepoint
                      ? (
                        <a
                          className="btn btn-primary tpl-grab"
                          href={t.sharepoint}
                          target="_blank"
                          rel="noreferrer"
                        >
                          ⬇ Open template in SharePoint
                        </a>
                      )
                      : <div className="tpl-no-link">No SharePoint link defined for this template.</div>
                    }

                    {t.steps && (
                      <div className="tpl-steps-wrap">
                        <button
                          type="button"
                          className="tpl-steps-toggle"
                          onClick={() => setStepsOpen((v) => !v)}
                        >
                          <span className="tpl-steps-caret">{stepsOpen ? '▾' : '▸'}</span>
                          <span>{stepsOpen ? 'Hide step-by-step instructions' : 'Show step-by-step instructions'}</span>
                        </button>
                        <AnimatePresence initial={false}>
                          {stepsOpen && (
                            <motion.div
                              key="steps"
                              className="tpl-md tpl-md-steps"
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.22, ease: 'easeOut' }}
                              dangerouslySetInnerHTML={{ __html: t.steps }}
                            />
                          )}
                        </AnimatePresence>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}

        {loadState === 'ok' && templates.length === 0 && (
          <div className="tpl-empty">
            No templates yet. Add a <code>.md</code> file under <code>public/templates/</code> and list it in <code>manifest.json</code>.
          </div>
        )}
      </div>

      <style>{`
        .tpl-root{display:flex;flex-direction:column;gap:.7rem}
        .tpl-head-row{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border);padding-bottom:.55rem}
        .tpl-head-title{font-family:var(--font-mono);font-size:.78rem;color:var(--text);letter-spacing:.04em}
        .tpl-head-sub{font-family:var(--font-mono);font-size:.65rem;color:var(--muted);margin-top:.2rem}
        .tpl-err-inline{color:var(--accent3,#ff6b3d)}
        .tpl-list{display:flex;flex-direction:column;gap:.55rem}
        .tpl-card{background:var(--surface);border:1px solid var(--border);border-radius:5px;overflow:hidden;transition:border-color .15s ease}
        .tpl-card:hover{border-color:var(--accent2)}
        .tpl-open{border-color:var(--accent)}
        .tpl-card.tpl-error{opacity:.65}
        .tpl-card-head{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:.85rem;width:100%;padding:.55rem .8rem;background:transparent;border:0;color:inherit;text-align:left;cursor:pointer;font:inherit}
        .tpl-card-head:disabled{cursor:default}
        .tpl-card-head:hover:not(:disabled){background:var(--surface2)}
        .tpl-thumb{width:144px;height:144px;border-radius:5px;object-fit:cover;background:var(--surface2);border:1px solid var(--border);display:block}
        .tpl-thumb-fallback{display:flex;align-items:center;justify-content:center;font-size:2.6rem;color:var(--muted)}
        .tpl-card-text{display:flex;flex-direction:column;gap:.2rem;min-width:0}
        .tpl-card-name{font-family:var(--font-mono);font-size:.82rem;color:var(--text);font-weight:600}
        .tpl-card-desc{font-family:var(--font-mono);font-size:.68rem;color:var(--muted);line-height:1.45;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
        .tpl-card-date{font-family:var(--font-mono);font-size:.6rem;color:#666;letter-spacing:.05em;align-self:flex-start;padding:.15rem .4rem;border:1px solid var(--border);border-radius:3px;white-space:nowrap}
        .tpl-card-caret{font-family:var(--font-mono);color:var(--muted);font-size:.85rem;width:1ch;text-align:center}
        .tpl-card-body{overflow:hidden;border-top:1px solid var(--border);background:var(--surface2)}
        .tpl-md{padding:1.1rem 2.6rem;font-family:var(--font-mono);font-size:.78rem;line-height:1.6;color:var(--text)}
        .tpl-md h1{font-size:1rem;margin:0 0 .6rem;color:var(--accent2)}
        .tpl-md h2{font-size:.88rem;margin:1rem 0 .45rem;color:var(--accent2)}
        .tpl-md h3{font-size:.8rem;margin:.85rem 0 .35rem;color:var(--text)}
        .tpl-md p{margin:.4rem 0}
        .tpl-md ul,.tpl-md ol{margin:.4rem 0 .4rem 1.25rem;padding:0}
        .tpl-md li{margin:.15rem 0}
        .tpl-md code{background:var(--surface);padding:.05rem .35rem;border-radius:3px;font-size:.74rem;border:1px solid var(--border)}
        .tpl-md pre{background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:.6rem .8rem;overflow-x:auto;margin:.5rem 0}
        .tpl-md pre code{background:transparent;border:0;padding:0;font-size:.72rem}
        .tpl-md blockquote{margin:.5rem 0;padding:.4rem .8rem;border-left:3px solid var(--accent);background:rgba(255,118,46,.06);color:var(--text)}
        .tpl-md a{color:var(--accent2);text-decoration:underline}
        .tpl-md img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:4px;margin:.6rem 0;display:block}
        .tpl-md-steps img{max-width:50%}
        .tpl-md table{border-collapse:collapse;margin:.5rem 0;font-size:.72rem}
        .tpl-md th,.tpl-md td{border:1px solid var(--border);padding:.3rem .5rem}
        .tpl-md th{background:var(--surface);text-align:left}
        .tpl-md hr{border:0;border-top:1px solid var(--border);margin:.8rem 0}
        .tpl-grab{display:inline-flex;align-items:center;gap:.4rem;margin:0 2.6rem 1.2rem;padding:.7rem 1.2rem;font-family:var(--font-mono);font-size:.82rem;text-decoration:none}
        .tpl-no-link{margin:0 2.6rem 1.2rem;padding:.5rem .8rem;font-family:var(--font-mono);font-size:.68rem;color:var(--muted);border:1px dashed var(--border);border-radius:4px}
        .tpl-steps-wrap{border-top:1px solid var(--border);background:var(--surface)}
        .tpl-steps-toggle{display:flex;align-items:center;justify-content:center;gap:.7rem;width:calc(100% - 5.2rem);margin:1rem 2.6rem;padding:.95rem 1.4rem;background:var(--surface2);border:1px solid var(--accent);border-radius:5px;color:var(--accent);font-family:var(--font-mono);font-size:.88rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;cursor:pointer;text-align:center;transition:background .15s ease,color .15s ease}
        .tpl-steps-toggle:hover{background:var(--accent);color:#1a1a1a}
        .tpl-steps-toggle:hover .tpl-steps-caret{color:#1a1a1a}
        .tpl-steps-caret{display:inline-block;font-size:1rem;color:var(--accent)}
        .tpl-md-steps{overflow:hidden;border-top:1px solid var(--border);padding-top:.4rem}
        .tpl-empty{padding:1.5rem;text-align:center;font-family:var(--font-mono);font-size:.74rem;color:var(--muted);border:1px dashed var(--border);border-radius:5px}
        .tpl-empty code{background:var(--surface);padding:.1rem .35rem;border-radius:3px;font-size:.7rem;border:1px solid var(--border)}
      `}</style>
    </div>
  );
}
