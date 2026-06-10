// Deterministic Unity identifiers + small binary helpers for the
// .unitypackage exporter. GUIDs are derived from a stable seed string
// (package name + asset path) so re-exporting the same scene produces the
// same GUIDs — Unity then treats it as an update, not a duplicate.

const te = new TextEncoder();

async function sha1Hex(str) {
  const digest = await crypto.subtle.digest('SHA-1', te.encode(str));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32-hex-char Unity GUID, deterministic for a given seed. */
export async function guidFor(seed) {
  const hex = await sha1Hex(`ygg-unity-guid:${seed}`);
  return hex.slice(0, 32);
}

/**
 * Deterministic positive int64 (as decimal string) for YAML object anchors
 * (`--- !u!1 &<fileID>`). Unity only needs uniqueness within one file.
 */
export async function fileIdFor(seed) {
  const hex = await sha1Hex(`ygg-unity-fileid:${seed}`);
  let id = BigInt(`0x${hex.slice(0, 15)}`); // 60 bits — always positive
  if (id === 0n) id = 1n;
  return id.toString();
}

/** Parse PNG IHDR for {width, height}. Returns null when not a PNG. */
export function pngSize(bytes) {
  if (!bytes || bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Decode a data: URL into bytes. Returns null for non-data URLs. */
export function dataUrlToBytes(src) {
  if (typeof src !== 'string' || !src.startsWith('data:')) return null;
  const comma = src.indexOf(',');
  if (comma < 0) return null;
  const head = src.slice(0, comma);
  const body = src.slice(comma + 1);
  if (/;base64$/i.test(head)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return te.encode(decodeURIComponent(body));
}

/** Sanitize a name into a Unity-safe file/GameObject segment. */
export function safeName(name, fallback = 'Asset') {
  const s = String(name || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[#%&*:<>?\\/{|}~"']/g, '')
    .replace(/\s+/g, '_')
    .trim();
  return s || fallback;
}
