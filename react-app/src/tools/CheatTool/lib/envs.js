// Environment routing + fetch option builder for the cheat tool. Pure: callers
// supply state, this returns { url, options }. Mirrors getEndpointUrl /
// buildFetchOptions from cheat-tool.html.

export const PROXY_PORT_KEY = 'cheat_tool_proxy_port';

export const ENV_LABELS = {
  dev: 'DEV-02',
  staging: 'STAGING',
  prod: 'PROD',
  proxy: '⚡ LOCAL PROXY',
  custom: 'CUSTOM'
};

const STATIC_BASES = {
  dev: 'https://ugs.dev-02.dev.yggops.io',
  staging: 'https://ugs.staging.yggops.io',
  prod: 'https://ugs.yggops.io'
};

export const PROXY_TARGETS = [
  { value: 'https://ugs.dev-02.dev.yggops.io', label: 'DEV-02' },
  { value: 'https://ugs.staging.yggops.io', label: 'STAGING' },
  { value: 'https://ugs.yggops.io', label: 'PROD' }
];

export function getProxyPortFromStorage() {
  const stored = parseInt(localStorage.getItem(PROXY_PORT_KEY));
  return stored && stored >= 1 && stored <= 65535 ? stored : 3030;
}
export function setProxyPortInStorage(p) {
  const v = parseInt(p);
  if (!v || v < 1 || v > 65535) return false;
  localStorage.setItem(PROXY_PORT_KEY, String(v));
  return true;
}

export function getBaseUrl(state) {
  if (state.env === 'custom') return (state.customBaseUrl || '').trim();
  if (state.env === 'proxy') return `http://localhost:${state.proxyPort}`;
  return STATIC_BASES[state.env] || '';
}

export function getEndpointUrl(state) {
  if (state.env === 'proxy') return `http://localhost:${state.proxyPort}/cheats/find-spin`;
  return `${getBaseUrl(state)}/cheats/find-spin`;
}

export function buildFetchOptions(state, method, body, extraHeaders = {}) {
  const rtpVariant = state.rtpVariant || '0.94';
  if (state.env === 'proxy') {
    const targetBase = state.proxyTarget;
    const endpoint = body ? '/cheats/find-spin' : extraHeaders['_endpoint'] || '';
    return {
      url: `http://localhost:${state.proxyPort}${endpoint}`,
      options: {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-Rtp-Variant': rtpVariant,
          'X-Target-Url': targetBase + endpoint,
          ...extraHeaders
        },
        ...(body ? { body: JSON.stringify(body) } : {})
      }
    };
  }

  return {
    url: getEndpointUrl(state),
    options: {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Rtp-Variant': rtpVariant,
        ...extraHeaders
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  };
}
