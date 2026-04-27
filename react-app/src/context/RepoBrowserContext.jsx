import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  LS_KEY,
  detectProvider,
  fetchRepos,
  fetchTree
} from '../utils/repoBrowser.js';
import { useApp } from './AppContext.jsx';

const RepoBrowserContext = createContext(null);

// Holds auth + currently-loaded repo/tree state. Both ContentBrowser (art)
// and SoundBrowser tabs read from this so connecting once + selecting a repo
// once is enough — switching tabs only changes the file-type filter.
export function RepoBrowserProvider({ children }) {
  const { log } = useApp();

  const [provider, setProvider] = useState('gitlab');
  const [baseUrl, setBaseUrl] = useState('https://gitlab.yggdrasil.lan');
  const [token, setToken] = useState('');
  const [prefix, setPrefix] = useState('');
  const [authed, setAuthed] = useState(false);

  const [repos, setRepos] = useState([]);
  const [reposLoaded, setReposLoaded] = useState(false);
  const [loadingRepos, setLoadingRepos] = useState(false);

  const [selectedRepo, setSelectedRepo] = useState(null);
  const [tree, setTree] = useState(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [error, setError] = useState('');

  // Cross-repo search state — null when not active
  const [globalSearch, setGlobalSearch] = useState(null);

  const blobCacheRef = useRef({});
  const treeCacheRef = useRef({}); // fullName → tree[]

  // Load persisted config
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
      if (s.provider) setProvider(s.provider);
      if (s.baseUrl) setBaseUrl(s.baseUrl);
      if (s.token) {
        setToken(s.token);
        setAuthed(true);
      }
      if (s.prefix) setPrefix(s.prefix);
    } catch {
      /* ignore */
    }
  }, []);

  const saveConfig = useCallback(
    (patch) => {
      try {
        const current = { provider, baseUrl, token, prefix };
        localStorage.setItem(LS_KEY, JSON.stringify({ ...current, ...patch }));
      } catch {
        /* ignore */
      }
    },
    [provider, baseUrl, token, prefix]
  );

  const doFetchRepos = useCallback(async () => {
    if (!token) {
      setError('Enter an access token first');
      return;
    }
    setLoadingRepos(true);
    setError('');
    log(`Scanning repos${prefix ? ' matching "' + prefix + '"' : ''}…`, 'info');
    try {
      const rs = await fetchRepos(provider, token, baseUrl, prefix);
      setRepos(rs);
      setReposLoaded(true);
      log(`✓ ${rs.length} repo${rs.length !== 1 ? 's' : ''} found`, 'ok');
    } catch (e) {
      setError(e.message);
      log('✗ ' + e.message, 'err');
    } finally {
      setLoadingRepos(false);
    }
  }, [provider, token, baseUrl, prefix, log]);

  const connect = useCallback(() => {
    const t = token.trim();
    if (!t) {
      setError('Paste a token first');
      return;
    }
    const det = detectProvider(t);
    if (det) setProvider(det);
    setAuthed(true);
    saveConfig({ token: t, provider: det || provider });
    setTimeout(doFetchRepos, 0);
  }, [token, provider, saveConfig, doFetchRepos]);

  const disconnect = useCallback(() => {
    setAuthed(false);
    setToken('');
    setRepos([]);
    setReposLoaded(false);
    setSelectedRepo(null);
    setTree(null);
    setCurrentPath('');
    setGlobalSearch(null);
    blobCacheRef.current = {};
    treeCacheRef.current = {};
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const selectRepo = useCallback(
    async (repo) => {
      setSelectedRepo(repo);
      setTree(null);
      setCurrentPath('');
      setLoadingTree(true);
      setError('');
      log(`Loading tree for ${repo.fullName}…`, 'info');
      try {
        // Use cache when present
        let t = treeCacheRef.current[repo.fullName];
        if (!t) {
          t = await fetchTree(provider, token, baseUrl, repo);
          treeCacheRef.current[repo.fullName] = t;
        }
        setTree(t);
        log(`✓ ${t.length} items`, 'ok');
      } catch (e) {
        setError(e.message);
        log('✗ ' + e.message, 'err');
      } finally {
        setLoadingTree(false);
      }
    },
    [provider, token, baseUrl, log]
  );

  const backToRepos = useCallback(() => {
    setSelectedRepo(null);
    setTree(null);
    setCurrentPath('');
  }, []);

  const value = useMemo(
    () => ({
      provider, setProvider,
      baseUrl, setBaseUrl,
      token, setToken,
      prefix, setPrefix,
      authed,
      repos, reposLoaded, loadingRepos,
      selectedRepo, tree, loadingTree, currentPath, setCurrentPath,
      error, setError,
      globalSearch, setGlobalSearch,
      blobCacheRef, treeCacheRef,
      saveConfig, connect, disconnect, doFetchRepos, selectRepo, backToRepos
    }),
    [
      provider, baseUrl, token, prefix, authed,
      repos, reposLoaded, loadingRepos,
      selectedRepo, tree, loadingTree, currentPath, error,
      globalSearch,
      saveConfig, connect, disconnect, doFetchRepos, selectRepo, backToRepos
    ]
  );

  return <RepoBrowserContext.Provider value={value}>{children}</RepoBrowserContext.Provider>;
}

export function useRepoBrowser() {
  const ctx = useContext(RepoBrowserContext);
  if (!ctx) throw new Error('useRepoBrowser must be used inside <RepoBrowserProvider>');
  return ctx;
}
