const SPINE_VERSION = '4.2.79';
const JS_URL = `https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-webgl@${SPINE_VERSION}/dist/iife/spine-webgl.min.js`;

let _promise = null;

export function loadSpineRuntime() {
  if (_promise) return _promise;
  _promise = new Promise((resolve, reject) => {
    if (window.spine?.SceneRenderer) { resolve(window.spine); return; }
    const s = document.createElement('script');
    s.src = JS_URL;
    s.async = true;
    s.onload = () =>
      window.spine?.SceneRenderer
        ? resolve(window.spine)
        : reject(new Error('spine-webgl loaded but window.spine.SceneRenderer is missing'));
    s.onerror = () => reject(new Error('Failed to load spine-webgl from ' + JS_URL));
    document.head.appendChild(s);
  });
  return _promise;
}
