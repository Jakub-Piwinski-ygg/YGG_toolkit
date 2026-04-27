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
  desc: 'Browse sound effects and music across your repos. Connect with a personal access token, pick a repo, and play .wav / .mp3 / .ogg files inline. Use the global search to scan all repos for an audio filename. Press RUN to rescan the repo list.'
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
