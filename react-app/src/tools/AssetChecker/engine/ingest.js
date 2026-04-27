import { makeEntry } from './fileIndex.js';

// From an <input webkitdirectory> change event.
export function entriesFromInput(fileList) {
  const out = [];
  for (const f of fileList) {
    const rel = f.webkitRelativePath || f.relativePath || f.name;
    out.push(makeEntry(rel, f));
  }
  return out;
}

// From a drag-and-drop DataTransferItemList.
export async function entriesFromDataTransfer(items) {
  const out = [];
  const promises = [];
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (!entry) {
      const f = item.getAsFile?.();
      if (f) out.push(makeEntry(f.name, f));
      continue;
    }
    promises.push(walkEntry(entry, '', out));
  }
  await Promise.all(promises);
  return out;
}

async function walkEntry(entry, prefix, sink) {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    sink.push(makeEntry(prefix + file.name, file));
    return;
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      all.push(...batch);
    } while (batch.length);
    await Promise.all(all.map((c) => walkEntry(c, prefix + entry.name + '/', sink)));
  }
}
