// Minimal USTAR tar writer + gzip, enough to produce a .unitypackage:
// a gzipped tarball where every asset lives in a `<guid>/` folder holding
//   asset       (the file bytes — omitted for folders)
//   asset.meta  (Unity importer settings)
//   pathname    (project-relative path, e.g. "Assets/Foo/bar.png")

const te = new TextEncoder();

function writeOctal(view, offset, length, value) {
  // length-1 digits + NUL terminator, zero padded
  const str = value.toString(8).padStart(length - 1, '0');
  for (let i = 0; i < str.length; i++) view[offset + i] = str.charCodeAt(i);
  view[offset + length - 1] = 0;
}

function writeStr(view, offset, str) {
  for (let i = 0; i < str.length; i++) view[offset + i] = str.charCodeAt(i);
}

function tarHeader(name, size, isDir) {
  if (name.length > 99) throw new Error(`tar entry name too long: ${name}`);
  const h = new Uint8Array(512);
  writeStr(h, 0, name);                  // name
  writeOctal(h, 100, 8, isDir ? 0o755 : 0o644); // mode
  writeOctal(h, 108, 8, 0);              // uid
  writeOctal(h, 116, 8, 0);              // gid
  writeOctal(h, 124, 12, size);          // size
  writeOctal(h, 136, 12, 0);             // mtime (fixed → deterministic output)
  h[156] = isDir ? 0x35 : 0x30;          // typeflag: '5' dir, '0' file
  writeStr(h, 257, 'ustar');             // magic
  h[262] = 0;
  writeStr(h, 263, '00');                // version
  // checksum: field treated as 8 spaces during computation
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  const chk = sum.toString(8).padStart(6, '0');
  writeStr(h, 148, chk);
  h[154] = 0;
  h[155] = 0x20;
  return h;
}

/**
 * Build a tar archive from entries: { name, data?: Uint8Array, dir?: true }.
 * Returns a Blob (application/x-tar).
 */
export function buildTar(entries) {
  const chunks = [];
  for (const e of entries) {
    if (e.dir) {
      chunks.push(tarHeader(e.name.endsWith('/') ? e.name : `${e.name}/`, 0, true));
      continue;
    }
    const data = typeof e.data === 'string' ? te.encode(e.data) : e.data;
    chunks.push(tarHeader(e.name, data.byteLength, false));
    chunks.push(data);
    const pad = data.byteLength % 512;
    if (pad) chunks.push(new Uint8Array(512 - pad));
  }
  chunks.push(new Uint8Array(1024)); // end-of-archive
  return new Blob(chunks, { type: 'application/x-tar' });
}

/** gzip a Blob via the native CompressionStream. */
export async function gzipBlob(blob) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser does not support CompressionStream (needed to gzip the .unitypackage). Use Chrome/Edge or a current Firefox.');
  }
  const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).blob();
}

/**
 * Pack Unity package items into a .unitypackage Blob.
 * Each item: { guid, path, data?: Uint8Array|string, meta: string }.
 * Folder items simply omit `data`.
 */
export async function buildUnityPackage(items) {
  const entries = [];
  for (const it of items) {
    entries.push({ name: `${it.guid}/`, dir: true });
    if (it.data != null) entries.push({ name: `${it.guid}/asset`, data: it.data });
    entries.push({ name: `${it.guid}/asset.meta`, data: it.meta });
    entries.push({ name: `${it.guid}/pathname`, data: it.path });
  }
  const tar = buildTar(entries);
  const gz = await gzipBlob(tar);
  return new Blob([gz], { type: 'application/octet-stream' });
}
