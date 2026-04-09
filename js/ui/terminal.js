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
    const lcMsg = msg.toLowerCase();
    if (!msg) return false;

    // Ignore repeated three.js deprecation warning in in-app console log stream.
    if (source === 'console' && /build\/three(\.min)?\.js/.test(lcMsg) && lcMsg.includes('deprecated')) {
      return true;
    }

    // Ignore WebGPU powerPreference platform limitation on Windows (crbug.com/369219127).
    if (source === 'console' && lcMsg.includes('powerpreference') && lcMsg.includes('ignored')) {
      return true;
    }

    // Ignore WebGPU device helper unavailable fallback messages (covered by _warnOnce tracking).
    if (source === 'console' && lcMsg.includes('webgpu') && lcMsg.includes('device helper')) {
      return true;
    }

    // Ignore expected request abort chatter when switching views/home navigation.
    if ((source === 'fetch' || source === 'trace' || source === 'console')
      && /home navigation|view switch|aborterror: home navigation|aborterror: view switch/.test(lcMsg)) {
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

  const BOOT_MAX_LINES = 180;
  const UI_CONSOLE_PANEL_ID = 'ui-console-panel';
  const UI_CONSOLE_LOG_ID = 'ui-console-log';
  const UI_CONSOLE_TOGGLE_ID = 'ui-console-toggle';
  let bootUi = null;
  let uiConsoleTakeoverLogged = false;

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function directBootProbe(message, level = 'info') {
    try {
      const bootLog = document.getElementById('ui-console-log');
      if (!bootLog) return;
      const ts = new Date();
      const hh = String(ts.getHours()).padStart(2, '0');
      const mm = String(ts.getMinutes()).padStart(2, '0');
      const ss = String(ts.getSeconds()).padStart(2, '0');
      const lvl = String(level || 'info').toUpperCase();
      const cls = lvl === 'ERROR' ? 'boot-line-error' : lvl === 'WARN' ? 'boot-line-warn' : 'boot-line-info';
      const row = document.createElement('div');
      row.className = `boot-line ${cls}`;
      row.textContent = `[${hh}:${mm}:${ss}] [${lvl}] [probe] ${String(message || '')}`;
      bootLog.appendChild(row);
      bootLog.scrollTop = bootLog.scrollHeight;
    } catch (_) {}
  }

  function ensureBootStyle() {
    // Unified console styling is owned by CSS (style.css/gqwm.css).
  }

  function ensureBootTerminalDom() {
    if (typeof document === 'undefined') return null;

    const root = document.getElementById('boot-terminal');
    if (!root) return null;

    const mode = document.getElementById('boot-terminal-mode');
    const clearBtn = document.getElementById('ui-console-clear');
    const copyBtn = document.getElementById('ui-console-copy');
    const toggleBtn = document.getElementById('ui-console-close');
    const log = document.getElementById('ui-console-log');
    if (!log) return null;

    root.setAttribute('data-gq-terminal-ready', '1');
    return { root, log, clearBtn, copyBtn, toggleBtn, mode };
  }

  async function copyBootTerminalToClipboard() {
    const lines = entries.map((e) => {
      const ts = new Date(Number(e?.ts || Date.now())).toISOString();
      const level = String(e?.level || 'info').toUpperCase();
      const source = String(e?.source || 'app');
      const text = String(e?.text || '');
      return `[${ts}] [${level}] [${source}] ${text}`;
    });
    const payload = lines.join('\n');

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const ta = document.createElement('textarea');
        ta.value = payload;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.left = '-10000px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      append('info', ['Boot terminal copied to clipboard'], 'system');
      return true;
    } catch (err) {
      append('error', ['Boot terminal copy failed', safeStringify(err)], 'system');
      return false;
    }
  }

  function setBootModeLabel(modeText) {
    const mode = bootUi?.mode || document.getElementById('boot-terminal-mode');
    if (!mode) return;
    mode.textContent = `Mode: ${String(modeText || 'GQLog')}`;
  }

  function renderBootTerminal() {
    if (!bootUi?.log) return;
    const source = entries.slice(-BOOT_MAX_LINES);
    bootUi.log.innerHTML = source.map((entry) => {
      const ts = new Date(Number(entry?.ts || Date.now()));
      const hh = String(ts.getHours()).padStart(2, '0');
      const mm = String(ts.getMinutes()).padStart(2, '0');
      const ss = String(ts.getSeconds()).padStart(2, '0');
      const level = String(entry?.level || 'info').toLowerCase();
      const levelLabel = level.toUpperCase();
      const src = escapeHtml(entry?.source || 'app');
      const text = escapeHtml(entry?.text || '');
      const cls = level === 'error'
        ? 'boot-line-error'
        : level === 'warn'
          ? 'boot-line-warn'
          : 'boot-line-info';
      return `<div class="boot-line ${cls}">[${hh}:${mm}:${ss}] [${levelLabel}] [${src}] ${text}</div>`;
    }).join('');
    bootUi.log.scrollTop = bootUi.log.scrollHeight;
  }

  function clearEntriesInternal() {
    entries.length = 0;
    persist(entries);
    emit({ ts: Date.now(), level: 'info', source: 'api', text: 'Terminal log cleared' });
  }

  function bindBootTerminal() {
    if (typeof document === 'undefined') return false;
    // After unified takeover, don't re-bind (would conflict with UIConsoleController)
    const checkRoot = document.getElementById('boot-terminal');
    if (checkRoot && checkRoot.getAttribute('data-gq-terminal-replaced') === 'ui-console') return false;
    ensureBootStyle();
    bootUi = ensureBootTerminalDom();
    if (!bootUi) return false;
    const localUi = bootUi;

    if (!window.__gqBootTerminalLogListener) {
      window.__gqBootTerminalLogListener = true;
      window.addEventListener('gq:terminal-log', () => {
        renderBootTerminal();
      });
    }

    if (localUi.clearBtn && !localUi.clearBtn.__gqBound) {
      localUi.clearBtn.__gqBound = true;
      localUi.clearBtn.addEventListener('click', () => {
        clearEntriesInternal();
        renderBootTerminal();
      });
    }

    if (localUi.copyBtn && !localUi.copyBtn.__gqBound) {
      localUi.copyBtn.__gqBound = true;
      localUi.copyBtn.addEventListener('click', async () => {
        await copyBootTerminalToClipboard();
      });
    }

    if (localUi.toggleBtn && localUi.toggleBtn.id === 'boot-terminal-toggle' && !localUi.toggleBtn.__gqBound) {
      localUi.toggleBtn.__gqBound = true;
      localUi.toggleBtn.addEventListener('click', () => {
        if (!localUi.root) return;
        const visible = !localUi.root.classList.contains('hidden');
        localUi.root.classList.toggle('hidden', visible);
        localUi.toggleBtn.textContent = visible ? 'Show' : 'Hide';
      });
    }

    setBootModeLabel('GQLog');
    renderBootTerminal();
    syncBootTerminalWithUiConsole();
    directBootProbe('terminal.js bound boot terminal');
    return true;
  }

  function isUiConsoleReady() {
    if (window.__gqUiConsoleReady) return true;
    if (typeof document === 'undefined') return false;
    const panel = document.getElementById(UI_CONSOLE_PANEL_ID);
    const log = document.getElementById(UI_CONSOLE_LOG_ID);
    const toggle = document.getElementById(UI_CONSOLE_TOGGLE_ID);
    if (!panel || !log || !toggle) return false;
    return Boolean(window.__gqTerminalLogBound);
  }

  function syncBootTerminalWithUiConsole() {
    const root = bootUi?.root || document.getElementById('boot-terminal');
    if (!root) return;

    if (isUiConsoleReady()) {
      // Unified design: boot-terminal IS the ui-console panel, no need to hide it.
      if (!root.classList.contains('ui-console-panel')) {
        root.classList.add('hidden');
      }
      root.setAttribute('data-gq-terminal-replaced', 'ui-console');
      setBootModeLabel('UI Console');
      if (!uiConsoleTakeoverLogged) {
        uiConsoleTakeoverLogged = true;
        append('info', ['Boot terminal merged with UI console'], 'system');
      }
      bootUi = null; // Prevent renderBootTerminal from conflicting with UIConsoleController
      return;
    }

    root.removeAttribute('data-gq-terminal-replaced');
  }

  function scheduleUiConsoleTakeoverSync() {
    syncBootTerminalWithUiConsole();
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      syncBootTerminalWithUiConsole();
      if (isUiConsoleReady() || attempts >= 90) {
        clearInterval(timer);
      }
    }, 1000);
  }

  function takeOverBootAdapter() {
    const adapter = window.__GQ_BOOT_TERMINAL_ADAPTER;
    if (!adapter || adapter.__gqTakenOver) return false;
    if (typeof adapter.takeover !== 'function') return false;
    try {
      adapter.__gqTakenOver = true;
      adapter.takeover(window.GQLog || null);
      return true;
    } catch (_) {
      adapter.__gqTakenOver = false;
      return false;
    }
  }

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
      const text = normalizeArgs(Array.from(args || []));
      const ignored = shouldIgnoreLog(level, 'console', text);
      if (!ignored && !shouldSkip(level)) append(level, args, 'console');
      if (!ignored) callOriginal(level, args);
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
  function isExpectedAuthProbeMiss(url, status) {
    if (Number(status || 0) !== 401) return false;
    const lowerUrl = String(url || '').toLowerCase();
    return lowerUrl.includes('api/auth.php?action=me');
  }
  if (originalFetch) {
    window.fetch = async function (...args) {
      const url = String(args?.[0] || '');
      const start = performance.now();
      try {
        const response = await originalFetch(...args);
        const took = Math.round(performance.now() - start);
        if (!response.ok) {
          if (isExpectedAuthProbeMiss(url, response.status)) {
            if (isDebugEnabled()) {
              append('debug', [`HTTP ${response.status}`, url, `(${took}ms)`, 'expected-session-miss'], 'fetch');
            }
            return response;
          }
          append('warn', [`HTTP ${response.status}`, url, `(${took}ms)`], 'fetch');
        } else if (isDebugEnabled()) {
          append('debug', [`HTTP ${response.status}`, url, `(${took}ms)`], 'fetch');
        }
        return response;
      } catch (err) {
        const took = Math.round(performance.now() - start);
        const urlText = String(url || '');
        const isQuietAuthProbe = /api\/auth\.php\?action=me(?:&|&amp;)quiet=1/i.test(urlText);
        const errText = safeStringify(err);
        const isTimeoutLike = /timeout|etimedout|abort/i.test(String(errText || ''));
        if (isAbortLike(err)) {
          if (isDebugEnabled()) {
            append('debug', ['FetchAbort', url, `(${took}ms)`, safeStringify(err)], 'fetch');
          }
        } else if (isQuietAuthProbe && isTimeoutLike) {
          append('warn', ['FetchTimeout', url, `(${took}ms)`, errText], 'fetch');
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
      clearEntriesInternal();
      renderBootTerminal();
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
    bindBootTerminal() {
      return bindBootTerminal();
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
  append('info', ['Terminal logger initialized'], 'system');
  directBootProbe('terminal.js initialized');
  takeOverBootAdapter();

  function bindBootTerminalWhenReady() {
    takeOverBootAdapter();
    if (bindBootTerminal()) {
      scheduleUiConsoleTakeoverSync();
      return;
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        takeOverBootAdapter();
        bindBootTerminal();
        scheduleUiConsoleTakeoverSync();
      }, { once: true });
    } else {
      setTimeout(() => {
        takeOverBootAdapter();
        bindBootTerminal();
        scheduleUiConsoleTakeoverSync();
      }, 0);
    }
  }

  bindBootTerminalWhenReady();

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
    takeOverBootAdapter();
    bindBootTerminal();
    scheduleUiConsoleTakeoverSync();
  });

  window.addEventListener('gq:terminal-log', () => {
    syncBootTerminalWithUiConsole();
  });

  window.addEventListener('gq:ui-console-ready', () => {
    syncBootTerminalWithUiConsole();
  });
})();
