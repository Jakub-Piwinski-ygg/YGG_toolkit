import { useEffect } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { useRepoBrowser } from '../context/RepoBrowserContext.jsx';
import { RepoBrowserView } from '../components/RepoBrowserView.jsx';

export const contentBrowserMeta = {
  id: 'contentbrowser',
  label: 'Art Browser',
  small: 'browse repos for art',
  icon: '🎨',
  needsMagick: false,
  batchMode: false,
  needsFiles: false,
  desc: 'Browse your GitHub or GitLab repositories for images and send them straight to the Art Tools. Paste a personal access token (provider auto-detected), optionally set a repo prefix, then pick a repo to navigate its tree. Use the global search to scan all repos for a filename. Press RUN to rescan the repo list.'
};

export function ContentBrowserTool() {
  const { registerRunner } = useApp();
  const { authed, doFetchRepos } = useRepoBrowser();

  useEffect(() => {
    registerRunner(contentBrowserMeta.id, {
      outName: () => '',
      run: async () => {
        if (authed) await doFetchRepos();
        return null;
      }
    });
    return () => registerRunner(contentBrowserMeta.id, null);
  }, [registerRunner, authed, doFetchRepos]);

  return <RepoBrowserView mode="art" />;
}
