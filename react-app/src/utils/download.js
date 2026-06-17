import JSZip from 'jszip';

export function triggerDownload(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

export async function downloadAll(files) {
  for (const f of files) {
    triggerDownload(f.url, f.name);
    await new Promise((r) => setTimeout(r, 80));
  }
}

// Bundle every output file into a single ZIP and download it. Names that
// collide get a numeric suffix so nothing is silently dropped.
export async function downloadAllZip(files, zipName = 'ygg-output.zip') {
  const zip = new JSZip();
  const used = new Set();
  for (const f of files) {
    let name = f.name || 'file';
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const base = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let i = 2;
      while (used.has(`${base}_${i}${ext}`)) i++;
      name = `${base}_${i}${ext}`;
    }
    used.add(name);
    zip.file(name, f.blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, zipName);
  setTimeout(() => URL.revokeObjectURL(url), 7000);
}
