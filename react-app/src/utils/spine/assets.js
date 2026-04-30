import { loadSpineRuntime } from './runtime.js';
import { findAtlasPages, resolvePageToFile } from './atlas.js';

function loadImage(src, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
    const abort = () => { img.src = ''; reject(new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

// Build all spine runtime objects needed to render a skeleton.
//
// Props:
//   context     — spine.ManagedWebGLRenderingContext (owns the GL context)
//   spec        — { jsonPath, atlasPath, dir, textures: [{path, relName}] }
//   resolveUrl  — async (repoPath) => blobUrl  (auth-aware, cached)
//   signal      — AbortSignal (optional)
//
// Returns: { skeletonData, atlas, dispose }
// Caller must call dispose() when done to free GL textures.
export async function buildSpineAssets({ context, spec, resolveUrl, signal }) {
  const spine = await loadSpineRuntime();
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // 1. Fetch JSON and atlas text via auth-aware resolver
  const jsonBlobUrl = await resolveUrl(spec.jsonPath);
  const atlasBlobUrl = await resolveUrl(spec.atlasPath);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  const [jsonText, atlasText] = await Promise.all([
    fetch(jsonBlobUrl).then((r) => {
      if (!r.ok) throw new Error(`Spine JSON fetch failed (HTTP ${r.status}): ${spec.jsonPath}`);
      return r.text();
    }),
    fetch(atlasBlobUrl).then((r) => {
      if (!r.ok) throw new Error(`Spine atlas fetch failed (HTTP ${r.status}): ${spec.atlasPath}`);
      return r.text();
    }),
  ]);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // 2. Parse atlas page names using our own parser (no runtime needed yet).
  //    We must pre-load ALL textures before calling new TextureAtlas(),
  //    because the TextureAtlas constructor calls textureLoader() synchronously.
  const pages = findAtlasPages(atlasText);
  if (!pages.length) {
    throw new Error(
      `No texture pages found in atlas for "${spec.name}". ` +
      `Is this a valid Spine .atlas file?`
    );
  }

  // 3. Resolve each page name → candidate file → fetch image → GL texture
  const glTextures = [];
  const texByPage = {};

  for (const { name } of pages) {
    const hit = resolvePageToFile(name, spec.textures || []);
    if (!hit) {
      const available = (spec.textures || []).map((t) => t.relName).join(', ') || '(none found)';
      throw new Error(
        `Atlas page "${name}" has no matching texture in "${spec.dir}".\n` +
        `Available images: ${available}`
      );
    }

    const texBlobUrl = await resolveUrl(hit.path);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const img = await loadImage(texBlobUrl, signal);
    const tex = new spine.GLTexture(context, img);
    glTextures.push(tex);
    // Register under both the raw page name and the resolved relName so the
    // TextureAtlas lookup can't miss due to extension/path differences.
    texByPage[name] = tex;
    texByPage[hit.relName] = tex;
  }

  // 4. Build TextureAtlas and bind textures to each page.
  //    In spine-webgl 4.2 the constructor takes only the atlas text —
  //    the textureLoader callback was removed.  Textures must be set
  //    manually via page.setTexture() after construction.
  const atlas = new spine.TextureAtlas(atlasText);
  for (const page of atlas.pages) {
    // texByPage is keyed by both the raw page name and the matched relName
    const tex = texByPage[page.name]
      ?? texByPage[page.name.replace(/\.(png|webp|jpg|jpeg)$/i, '')];
    if (!tex) {
      const available = pages.map((p) => p.name).join(', ');
      throw new Error(
        `Atlas page "${page.name}" has no loaded texture.\n` +
        `Loaded pages: ${available}`
      );
    }
    page.setTexture(tex);
  }

  // 5. Build skeleton data from JSON
  const attachmentLoader = new spine.AtlasAttachmentLoader(atlas);
  const skeletonJson = new spine.SkeletonJson(attachmentLoader);
  let skeletonData;
  try {
    skeletonData = skeletonJson.readSkeletonData(JSON.parse(jsonText));
  } catch (e) {
    throw new Error(`Failed to parse skeleton JSON: ${e.message}`);
  }

  return {
    skeletonData,
    atlas,
    dispose: () => glTextures.forEach((t) => { try { t.dispose(); } catch { /* ignore */ } }),
  };
}
