import { WebPTool, webpMeta } from './WebPTool.jsx';

// As tools are ported, add an entry here. Each entry owns its own file under
// src/tools/. The shell has no tool-specific logic — just renders whichever
// component is active and invokes its registered runner on RUN.
export const ART_TOOLS = [
  { meta: webpMeta, Component: WebPTool }
];
