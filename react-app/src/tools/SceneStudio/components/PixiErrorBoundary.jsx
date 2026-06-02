// PixiErrorBoundary — isolates PixiViewport crashes so the rest of Scene
// Studio (inspector, timeline, hierarchy) stays interactive when Pixi
// blows up mid-render (e.g. the v8 SpritePipe "Cannot read 'orig' of
// null" race condition on a not-yet-uploaded texture).

import { Component } from 'react';

export class PixiErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.warn('[SceneStudio] PixiViewport crashed; the rest of the UI stays alive.', error, info);
  }
  reset = () => {
    this.setState({ error: null });
  };
  render() {
    if (this.state.error) {
      return (
        <div className="scene-pixi-error">
          <div className="scene-pixi-error-title">Viewport crashed</div>
          <div className="scene-pixi-error-msg">{String(this.state.error?.message || this.state.error)}</div>
          <div className="scene-pixi-error-hint">
            Timeline + inspector still work. Click <em>Retry</em> to remount the viewport.
          </div>
          <button className="scene-btn scene-btn--primary" onClick={this.reset}>↻ Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
