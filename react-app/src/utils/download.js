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
