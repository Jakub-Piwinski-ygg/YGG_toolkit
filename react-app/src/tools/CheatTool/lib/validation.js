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
    errors.push('Game ID musi być dodatnią liczbą');
    mark('gameId', 'Wymagane: dodatnia liczba całkowita');
  }

  // 2. Multiplier root
  if (state.multiplierEnabled) {
    const f = parseFloat(state.multFrom);
    const t = parseFloat(state.multTo);
    if (!isNaN(f) && !isNaN(t) && f > t) {
      errors.push(`Multiplier root: From (${f}) > To (${t})`);
      mark('multFrom', `From (${f}) większe niż To (${t})`);
      mark('multTo', `From (${f}) większe niż To (${t})`);
    }
  }

  // 3. Multiplier next mode
  if (state.nextMultEnabled) {
    const f = parseFloat(state.nextMultFrom);
    const t = parseFloat(state.nextMultTo);
    if (!isNaN(f) && !isNaN(t) && f > t) {
      errors.push(`Multiplier next mode: From (${f}) > To (${t})`);
      mark('nextMultFrom', `From (${f}) większe niż To (${t})`);
      mark('nextMultTo', `From (${f}) większe niż To (${t})`);
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
      errors.push('Custom URL: pole nie może być puste');
      mark('customBaseUrl', 'Wymagany URL z http:// lub https://');
    } else if (!/^https?:\/\//i.test(url)) {
      errors.push('Custom URL: musi zaczynać się od http:// lub https://');
      mark('customBaseUrl', 'Musi zaczynać się od http:// lub https://');
    }
  }

  // 7. Proxy port
  if (state.env === 'proxy') {
    const port = parseInt(state.proxyPort);
    if (!port || port < 1 || port > 65535) {
      errors.push(`Port proxy: niepoprawny (${port || 'puste'})`);
      mark('proxyPort', 'Port musi być w zakresie 1–65535');
    }
  }

  // 8. Trigger count
  if (state.nextModeEnabled) {
    const cnt = parseInt(state.triggerCount);
    if (!isNaN(cnt) && cnt < 0) {
      errors.push(`Trigger count: ujemna wartość (${cnt})`);
      mark('triggerCount', 'Count nie może być ujemny');
    }
  }

  return { ok: errors.length === 0, errors, fieldErrors };
}
