/*
 * GalaxyQuest Terminal Logger
 * Centralized logging/error capture for all frontend scripts.
 */
(function () {
  if (window.__gqTerminalInitialized) {
    return;
  }
  window.__gqTerminalInitialized = true;

  const MAX_ENTRIES = 400;
  const STORAGE_KEY = 'gq_terminal_log';
  const DEBUG_FLAG_KEY = 'gq_debug_logs';
  const TRACE_FLAG_KEY = 'gq_trace_functions';
  const SESSION_START_TS = Date.now();

  const originalConsole = {
    log: console.log ? console.log.bind(console) : () => {},
    info: console.info ? console.info.bind(console) : () => {},
    warn: console.warn ? console.warn.bind(console) : () => {},
    error: console.error ? console.error.bind(console) : () => {},
    debug: console.debug ? console.debug.bind(console) : () => {},
  };

  function isDebugEnabled() {
    try {
      return localStorage.getItem(DEBUG_FLAG_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function isTraceEnabled() {
    try {
      return localStorage.getItem(TRACE_FLAG_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function safeStringify(value) {
    if (value === null || value === undefined) return String(value);
    if (typeof value === 'string') return value;
    if (value instanceof Error) {
      return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    }
    try {
      return JSON.stringify(value);
    } catch (_) {
      try {
        return String(value);
      } catch (_) {
        return '[unserializable]';
      }
    }
  }

  function normalizeArgs(args) {
    return (Array.isArray(args) ? args : [args]).map(safeStringify).join(' ');
  }

  function shouldIgnoreLog(level, source, text) {
    const msg = String(text || '');
    if (!msg) return false;

    // Ignore repeated three.js deprecation warning in in-app console log stream.
    if (source === 'console' && msg.includes('Scripts "build/three.js" and "build/three.min.js" are deprecated')) {
      return true;
    }

    // Expected auth pre-check 401 on login page should not be noisy.
    if (source === 'fetch' && level === 'warn' && msg.includes('HTTP 401') && msg.includes('api/auth.php?action=me')) {
      return true;
    }

    return false;
  }

  function isAbortLike(value) {
    if (!value) return false;
    if (typeof value === 'string') return /abort|cancel|navigation/i.test(value);
    const name = String(value?.name || '');
    const msg = String(value?.message || value?.reason || value?.cause?.message || value?.cause || '');
    return name === 'AbortError' || /abort|cancel|navigation/i.test(msg);
  }

  function loadPersisted() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function persist(entries) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch (_) {}
  }

  const entries = loadPersisted().slice(-MAX_ENTRIES);

  function emit(entry) {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gq:terminal-log', { detail: entry }));
    }
  }

  function append(level, args, source = 'app') {
    const text = normalizeArgs(Array.from(args || []));
    if (shouldIgnoreLog(level, source, text)) return null;
    const prev = entries.length ? entries[entries.length - 1] : null;
    if (prev && prev.level === level && prev.source === source && prev.text === text) {
      const dt = Date.now() - Number(prev.ts || 0);
      if (dt >= 0 && dt < 1500) {
        return prev;
      }
    }
    const entry = {
      ts: Date.now(),
      sessionStartTs: SESSION_START_TS,
      level,
      source,
      text,
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.shift();
    persist(entries);
    emit(entry);
    return entry;
  }

  function shouldSkip(level) {
    if (level === 'debug' && !isDebugEnabled()) return true;
    return false;
  }

  function summarizeArg(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    const t = typeof value;
    if (t === 'string') {
      const s = value.length > 42 ? `${value.slice(0, 39)}...` : value;
      return `"${s}"`;
    }
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (t === 'function') return `fn:${value.name || 'anonymous'}`;
    if (value instanceof Error) return `${value.name}:${value.message}`;
    if (t === 'object') {
      const name = value.constructor?.name || 'Object';
      return name;
    }
    return t;
  }

  function summarizeArgs(args) {
    const list = Array.isArray(args) ? args : Array.from(args || []);
    return list.slice(0, 5).map(summarizeArg).join(', ');
  }

  function summarizeResult(value) {
    if (value === null || value === undefined) return String(value);
    if (Array.isArray(value)) return `Array(${value.length})`;
    if (typeof value === 'object') return value.constructor?.name || 'Object';
    return summarizeArg(value);
  }

  function wrapFunction(ownerName, fnName, fn) {
    if (typeof fn !== 'function') return fn;
    if (fn.__gqInstrumented) return fn;

    const wrapped = function (...args) {
      const trace = isTraceEnabled();
      const started = performance.now();
      const label = `${ownerName}.${fnName}`;

      if (trace) {
        append('debug', [`→ ${label}(${summarizeArgs(args)})`], 'trace');
      }

      try {
        const out = fn.apply(this, args);
        if (out && typeof out.then === 'function') {
          return out.then((value) => {
            if (trace) {
              const took = Math.round(performance.now() - started);
              append('debug', [`← ${label} ok (${took}ms) -> ${summarizeResult(value)}`], 'trace');
            }
            return value;
          }).catch((err) => {
            const took = Math.round(performance.now() - started);
            if (isAbortLike(err)) {
              if (trace) append('debug', [`↺ ${label} aborted (${took}ms)`, safeStringify(err)], 'trace');
            } else {
              append('error', [`✖ ${label} failed (${took}ms)`, safeStringify(err)], 'trace');
            }
            throw err;
          });
        }

        if (trace) {
          const took = Math.round(performance.now() - started);
          append('debug', [`← ${label} ok (${took}ms) -> ${summarizeResult(out)}`], 'trace');
        }
        return out;
      } catch (err) {
        const took = Math.round(performance.now() - started);
        if (isAbortLike(err)) {
          if (trace) append('debug', [`↺ ${label} aborted (${took}ms)`, safeStringify(err)], 'trace');
        } else {
          append('error', [`✖ ${label} threw (${took}ms)`, safeStringify(err)], 'trace');
        }
        throw err;
      }
    };

    try { Object.defineProperty(wrapped, 'name', { value: fn.name, configurable: true }); } catch (_) {}
    wrapped.__gqInstrumented = true;
    wrapped.__gqOriginal = fn;
    return wrapped;
  }

  function instrumentObject(ownerName, target, opts = {}) {
    if (!target || (typeof target !== 'object' && typeof target !== 'function')) return 0;
    const include = Array.isArray(opts.include) && opts.include.length ? new Set(opts.include) : null;
    const exclude = new Set(Array.isArray(opts.exclude) ? opts.exclude : []);

    let count = 0;
    Object.getOwnPropertyNames(target).forEach((key) => {
      if (!key || key === 'constructor') return;
      if (include && !include.has(key)) return;
      if (exclude.has(key)) return;

      let value;
      try {
        value = target[key];
      } catch (_) {
        return;
      }
      if (typeof value !== 'function') return;
      if (value.__gqInstrumented) return;

      const wrapped = wrapFunction(ownerName, key, value);
      try {
        target[key] = wrapped;
        count += 1;
      } catch (_) {
        // Non-writable or accessor-based APIs are skipped.
      }
    });
    return count;
  }

  function instrumentPrototype(ownerName, ctor, opts = {}) {
    if (!ctor || !ctor.prototype) return 0;
    return instrumentObject(`${ownerName}.prototype`, ctor.prototype, opts);
  }

  const installedTargets = new Set();
  let instrumentationLogged = false;
  function installRuntimeInstrumentation() {
    let total = 0;

    if (window.WM && !installedTargets.has('WM')) {
      total += instrumentObject('WM', window.WM, {
        include: ['register', 'open', 'close', 'refresh', 'body', 'isOpen', 'setTitle'],
      });
      installedTargets.add('WM');
    }

    if (window.API && !installedTargets.has('API')) {
      total += instrumentObject('API', window.API);
      installedTargets.add('API');
    }

    if (window.BinaryDecoder && !installedTargets.has('BinaryDecoder')) {
      total += instrumentObject('BinaryDecoder', window.BinaryDecoder, { include: ['decode'] });
      installedTargets.add('BinaryDecoder');
    }
    if (window.BinaryDecoderV2 && !installedTargets.has('BinaryDecoderV2')) {
      total += instrumentObject('BinaryDecoderV2', window.BinaryDecoderV2, { include: ['decode'] });
      installedTargets.add('BinaryDecoderV2');
    }
    if (window.BinaryDecoderV3 && !installedTargets.has('BinaryDecoderV3')) {
      total += instrumentObject('BinaryDecoderV3', window.BinaryDecoderV3, { include: ['decode'] });
      installedTargets.add('BinaryDecoderV3');
    }

    if (window.GQGalaxyModel && !installedTargets.has('GQGalaxyModel')) {
      total += instrumentPrototype('GQGalaxyModel', window.GQGalaxyModel);
      installedTargets.add('GQGalaxyModel');
    }
    if (window.GQGalaxyDB && !installedTargets.has('GQGalaxyDB')) {
      total += instrumentPrototype('GQGalaxyDB', window.GQGalaxyDB);
      installedTargets.add('GQGalaxyDB');
    }
    if (window.GQAudioManager && !installedTargets.has('GQAudioManager')) {
      total += instrumentPrototype('GQAudioManager', window.GQAudioManager);
      installedTargets.add('GQAudioManager');
    }

    if (total > 0 && !instrumentationLogged) {
      append('info', [`Function instrumentation installed (+${total})`], 'system');
      instrumentationLogged = true;
    }
    return total;
  }

  function callOriginal(level, args) {
    const fn = originalConsole[level] || originalConsole.log;
    try {
      fn(...args);
    } catch (_) {}
  }

  function wrapConsoleMethod(level) {
    return function (...args) {
      if (!shouldSkip(level)) append(level, args, 'console');
      callOriginal(level, args);
    };
  }

  console.log = wrapConsoleMethod('log');
  console.info = wrapConsoleMethod('info');
  console.warn = wrapConsoleMethod('warn');
  console.error = wrapConsoleMethod('error');
  console.debug = wrapConsoleMethod('debug');

  window.addEventListener('error', (ev) => {
    const target = ev?.filename ? `${ev.filename}:${ev.lineno || 0}:${ev.colno || 0}` : 'window';
    append('error', [`UncaughtError ${target}`, ev?.message || 'unknown error'], 'window');
  });

  window.addEventListener('unhandledrejection', (ev) => {
    append('error', ['UnhandledRejection', safeStringify(ev?.reason)], 'promise');
  });

  const originalFetch = window.fetch ? window.fetch.bind(window) : null;
  if (originalFetch) {
    window.fetch = async function (...args) {
      const url = String(args?.[0] || '');
      const start = performance.now();
      try {
        const response = await originalFetch(...args);
        const took = Math.round(performance.now() - start);
        if (!response.ok) {
          append('warn', [`HTTP ${response.status}`, url, `(${took}ms)`], 'fetch');
        } else if (isDebugEnabled()) {
          append('debug', [`HTTP ${response.status}`, url, `(${took}ms)`], 'fetch');
        }
        return response;
      } catch (err) {
        const took = Math.round(performance.now() - start);
        if (isAbortLike(err)) {
          if (isDebugEnabled()) {
            append('debug', ['FetchAbort', url, `(${took}ms)`, safeStringify(err)], 'fetch');
          }
        } else {
          append('error', ['FetchError', url, `(${took}ms)`, safeStringify(err)], 'fetch');
        }
        throw err;
      }
    };
  }

  const api = {
    entries,
    debugEnabled: isDebugEnabled,
    setDebugEnabled(value) {
      try {
        localStorage.setItem(DEBUG_FLAG_KEY, value ? '1' : '0');
      } catch (_) {}
    },
    traceEnabled: isTraceEnabled,
    setTraceEnabled(value) {
      try {
        localStorage.setItem(TRACE_FLAG_KEY, value ? '1' : '0');
      } catch (_) {}
    },
    log(...args) { append('log', args, 'api'); callOriginal('log', args); },
    info(...args) { append('info', args, 'api'); callOriginal('info', args); },
    warn(...args) { append('warn', args, 'api'); callOriginal('warn', args); },
    error(...args) { append('error', args, 'api'); callOriginal('error', args); },
    debug(...args) {
      if (shouldSkip('debug')) return;
      append('debug', args, 'api');
      callOriginal('debug', args);
    },
    clear() {
      entries.length = 0;
      persist(entries);
      emit({ ts: Date.now(), level: 'info', source: 'api', text: 'Terminal log cleared' });
    },
    getAll() {
      return entries.slice();
    },
    getSessionEntries() {
      return entries.filter((e) => Number(e?.sessionStartTs || 0) === SESSION_START_TS);
    },
    instrumentNow() {
      return installRuntimeInstrumentation();
    },
    download(fileName = '') {
      const name = fileName || `gq-terminal-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
      const lines = entries.map((e) => `[${new Date(e.ts).toISOString()}] [${e.level}] [${e.source}] ${e.text}`);
      const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };

  window.GQLog = api;

  let instrumentRetries = 0;
  const instrumentTimer = setInterval(() => {
    installRuntimeInstrumentation();
    instrumentRetries += 1;
    if (instrumentRetries >= 45) {
      clearInterval(instrumentTimer);
    }
  }, 1000);

  window.addEventListener('load', () => {
    installRuntimeInstrumentation();
  });
})();
