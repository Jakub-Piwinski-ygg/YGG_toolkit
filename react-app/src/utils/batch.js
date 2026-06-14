// Turn a single-file image processor into a batchMode runner.
//
// The shell's ToolPanel calls a batchMode tool ONCE with all input files and
// expects an array of { name, blob }. This wraps a per-file processor in the
// same loop (read bytes → process → collect) the non-batch path used to do
// internally, with per-file error isolation (one bad file is logged and
// skipped, not fatal to the batch) and per-file progress labels.
//
// processOne receives (uint8, name, file): canvas tools that only need the
// File can ignore uint8; WASM tools use the bytes.

/**
 * @param {(uint8: Uint8Array, name: string, file: File) => Promise<Blob>} processOne
 * @param {(name: string) => string} outName   maps input filename → output filename
 * @param {{ log?: Function, setProgressLabel?: Function }} ctx  from useApp()
 * @returns {(u:any, n:any, f:any, allFiles: {name:string,file:File}[]) => Promise<{name:string,blob:Blob}[]>}
 */
export function makeBatchRun(processOne, outName, { log, setProgressLabel } = {}) {
  return async (_u, _n, _f, allFiles) => {
    const outputs = [];
    for (let i = 0; i < allFiles.length; i++) {
      const { name, file } = allFiles[i];
      setProgressLabel?.(`${i + 1} / ${allFiles.length}`);
      try {
        const uint8 = new Uint8Array(await file.arrayBuffer());
        outputs.push({ name: outName(name), blob: await processOne(uint8, name, file) });
      } catch (e) {
        log?.(`✗ ${name}: ${e.message || e}`, 'err');
      }
    }
    return outputs;
  };
}
