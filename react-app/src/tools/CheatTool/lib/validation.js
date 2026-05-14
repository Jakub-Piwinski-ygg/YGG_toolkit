// Pure validation. Mirrors validateAll() from cheat-tool.html. Returns
// { ok, errors:[string], fieldErrors:{fieldId:msg} }. Field errors let
// components render their own red borders without DOM lookups.

export function validateAll(state) {
  const errors = [];
  const fieldErrors = {};

  const mark = (id, msg) => {
    fieldErrors[id] = msg;
  };

  // 1. Game ID
  if (!state.gameId || state.gameId < 1) {
    errors.push('Game ID must be a positive number');
    mark('gameId', 'Required: positive integer');
  }

  // 2. Multiplier root
  if (state.multiplierEnabled) {
    const f = parseFloat(state.multFrom);
    const t = parseFloat(state.multTo);
    if (!isNaN(f) && !isNaN(t) && f > t) {
      errors.push(`Multiplier root: From (${f}) > To (${t})`);
      mark('multFrom', `From (${f}) is greater than To (${t})`);
      mark('multTo', `From (${f}) is greater than To (${t})`);
    }
  }

  // 3. Multiplier next mode
  if (state.nextMultEnabled) {
    const f = parseFloat(state.nextMultFrom);
    const t = parseFloat(state.nextMultTo);
    if (!isNaN(f) && !isNaN(t) && f > t) {
      errors.push(`Multiplier next mode: From (${f}) > To (${t})`);
      mark('nextMultFrom', `From (${f}) is greater than To (${t})`);
      mark('nextMultTo', `From (${f}) is greater than To (${t})`);
    }
  }

  // 4. Counter root
  state.counterConditions.forEach((c, i) => {
    if (c.from > c.to) {
      errors.push(`Counter "${c.name || '#' + (i + 1)}": From (${c.from}) > To (${c.to})`);
      fieldErrors[`counter-${c.id}-from`] = 'From > To';
      fieldErrors[`counter-${c.id}-to`] = 'From > To';
    }
  });

  // 5. Counter next mode
  state.nextCounterConditions.forEach((c, i) => {
    if (c.from > c.to) {
      errors.push(`Next counter "${c.name || '#' + (i + 1)}": From (${c.from}) > To (${c.to})`);
      fieldErrors[`nextCounter-${c.id}-from`] = 'From > To';
      fieldErrors[`nextCounter-${c.id}-to`] = 'From > To';
    }
  });

  // 6. Custom URL
  if (state.env === 'custom') {
    const url = (state.customBaseUrl || '').trim();
    if (!url) {
      errors.push('Custom URL: field cannot be empty');
      mark('customBaseUrl', 'URL with http:// or https:// is required');
    } else if (!/^https?:\/\//i.test(url)) {
      errors.push('Custom URL: must start with http:// or https://');
      mark('customBaseUrl', 'Must start with http:// or https://');
    }
  }

  // 7. Proxy port
  if (state.env === 'proxy') {
    const port = parseInt(state.proxyPort);
    if (!port || port < 1 || port > 65535) {
      errors.push(`Proxy port: invalid (${port || 'empty'})`);
      mark('proxyPort', 'Port must be in range 1-65535');
    }
  }

  // 8. Trigger count
  if (state.nextModeEnabled) {
    const cnt = parseInt(state.triggerCount);
    if (!isNaN(cnt) && cnt < 0) {
      errors.push(`Trigger count: negative value (${cnt})`);
      mark('triggerCount', 'Count cannot be negative');
    }
  }

  return { ok: errors.length === 0, errors, fieldErrors };
}
