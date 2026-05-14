import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useRepoBrowser } from '../context/RepoBrowserContext.jsx';
import { RepoBrowserView } from '../components/RepoBrowserView.jsx';

export const soundBrowserMeta = {
  id: 'soundbrowser',
  label: 'Sound Browser',
  small: 'browse & preview SFX',
  icon: '🔊',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  fullBleed: true,
  hideOutput: true
};

export function SoundBrowserTool() {
  const { registerRunner } = useApp();
  const { authed, doFetchRepos } = useRepoBrowser();

  useEffect(() => {
    registerRunner(soundBrowserMeta.id, {
      outName: () => '',
      run: async () => {
        if (authed) await doFetchRepos();
        return null;
      }
    });
    return () => registerRunner(soundBrowserMeta.id, null);
  }, [registerRunner, authed, doFetchRepos]);

  return <RepoBrowserView mode="sounds" />;
}
