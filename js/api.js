/**
 * Thin API wrapper for the game frontend.
 * All requests automatically attach the CSRF token from the session.
 */
const API = (() => {
  let _csrfToken = null;
  const _getCache = new Map();
  let _activeLoads = 0;
  let _activeNetworkRequests = 0;
  let _requestSequence = 0;
  let _requestTaskId = 0;
  const _requestQueue = [];
  const _inflightTasks = new Map();
  let _maxConcurrentRequests = 4;
  let _lastConnectivityProbe = { ts: 0, data: null };

  // Short-lived cache tuned for frequently refreshed strategy-game data.
  const _defaultGetTtlMs = [
    { re: /api\/game\.php\?action=health/i, ttl: 5 * 1000 },
    { re: /api\/game\.php\?action=overview/i, ttl: 10 * 1000 },
    { re: /api\/game\.php\?action=resources/i, ttl: 8 * 1000 },
    { re: /api\/game\.php\?action=leaderboard/i, ttl: 20 * 1000 },
    { re: /api\/buildings\.php\?action=list/i, ttl: 10 * 1000 },
    { re: /api\/research\.php\?action=list/i, ttl: 12 * 1000 },
    { re: /api\/shipyard\.php\?action=list/i, ttl: 12 * 1000 },
    { re: /api\/fleet\.php\?action=list/i, ttl: 10 * 1000 },
    { re: /api\/messages\.php\?action=inbox/i, ttl: 8 * 1000 },
    { re: /api\/messages\.php\?action=users/i, ttl: 20 * 1000 },
    { re: /api\/galaxy\.php\?action=stars/i, ttl: 45 * 1000 },
    { re: /api\/galaxy\.php\?/i, ttl: 15 * 1000 },
    { re: /api\/achievements\.php\?action=list/i, ttl: 15 * 1000 },
    { re: /api\/leaders\.php\?action=list/i, ttl: 15 * 1000 },
    { re: /api\/factions\.php\?action=/i, ttl: 20 * 1000 },
  ];

  const _mutationInvalidatePatterns = [
    /^api\/game\.php\?action=/i,
    /^api\/buildings\.php\?action=/i,
    /^api\/research\.php\?action=/i,
    /^api\/shipyard\.php\?action=/i,
    /^api\/fleet\.php\?action=/i,
    /^api\/achievements\.php\?action=/i,
    /^api\/leaders\.php\?action=/i,
    /^api\/factions\.php\?action=/i,
    /^api\/messages\.php\?action=/i,
    /^api\/galaxy\.php\?/i,
  ];

  function _emitLoadProgress(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('gq:load-progress', {
      detail: Object.assign({}, detail, {
        queued: _requestQueue.length,
        inFlight: _activeNetworkRequests,
        concurrency: _maxConcurrentRequests,
      }),
    }));
  }

  function _emitLoadError(detail) {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('gq:load-error', { detail }));
  }

  function _emitQueueStats(label = 'Queue aktiv') {
    const busy = _activeLoads > 0 || _activeNetworkRequests > 0 || _requestQueue.length > 0;
    _emitLoadProgress({
      active: busy,
      progress: _activeLoads > 0 ? 0.12 : (busy ? 0.06 : 0),
      pending: _activeLoads,
      label,
    });
  }

  function _isAbortError(err) {
    if (!err) return false;
    if (typeof err === 'string') {
      return /abort|cancel|navigation/i.test(err);
    }
    const name = String(err.name || '');
    const message = String(err.message || '');
    const reason = String(err.reason || err.cause?.message || err.cause || '');
    return name === 'AbortError' || /abort|cancel|navigation/i.test(message) || /abort|cancel|navigation/i.test(reason);
  }

  function _createAbortError(message = 'Request cancelled') {
    try {
      return new DOMException(message, 'AbortError');
    } catch (_) {
      const e = new Error(message);
      e.name = 'AbortError';
      return e;
    }
  }

  function _detectConcurrencyLimit() {
    try {
      const nav = navigator || {};
      const conn = nav.connection || nav.mozConnection || nav.webkitConnection || {};
      const cores = Number(nav.hardwareConcurrency || 0);
      const mem = Number(nav.deviceMemory || 0);
      const effectiveType = String(conn.effectiveType || '').toLowerCase();
      const saveData = !!conn.saveData;

      if (saveData || effectiveType === 'slow-2g' || effectiveType === '2g') return 2;
      if (cores > 0 && cores <= 4) return 3;
      if (mem > 0 && mem <= 4) return 3;
      if (effectiveType === '3g') return 3;
      if (cores >= 12 || mem >= 12) return 6;
      return 4;
    } catch (_) {
      return 4;
    }
  }

  _maxConcurrentRequests = _detectConcurrencyLimit();
  try {
    const conn = navigator?.connection || navigator?.mozConnection || navigator?.webkitConnection;
    if (conn && typeof conn.addEventListener === 'function') {
      conn.addEventListener('change', () => {
        _maxConcurrentRequests = _detectConcurrencyLimit();
        _emitQueueStats('Netzwerkprofil aktualisiert…');
        _pumpRequestQueue();
      });
    }
  } catch (_) {}

  function _reportLoadError(endpoint, err, context = '') {
    const message = _describeError(err, endpoint, context);
    const diagnostics = _diagnoseFromError(err, endpoint, context);
    console.error('[GQ][API] Ladefehler', {
      endpoint,
      context,
      message,
      kind: diagnostics.kind,
      error: err,
    });
    _emitLoadError({
      endpoint: String(endpoint || ''),
      context: String(context || ''),
      message,
      kind: String(diagnostics.kind || 'unknown'),
      error: err,
    });
  }

  function _describeError(err, endpoint = '', context = '') {
    const parts = [];
    const ep = String(endpoint || '');
    const cx = String(context || '');
    if (cx) parts.push(cx);
    if (ep) parts.push(ep);

    let detail = '';
    if (err instanceof Error) {
      detail = String(err.message || err.name || '').trim();
      const causeMsg = String(err.cause?.message || err.cause || '').trim();
      if (!detail && causeMsg) detail = causeMsg;
      if (!detail) detail = String(err.name || 'Error');
    } else if (err && typeof err === 'object') {
      const status = Number(err.status || 0);
      const statusText = String(err.statusText || '').trim();
      const msg = String(err.message || err.error || err.reason || '').trim();
      if (status > 0) {
        detail = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`;
      } else if (msg) {
        detail = msg;
      } else {
        try {
          detail = JSON.stringify(err);
        } catch (_) {
          detail = String(err);
        }
      }
    } else if (typeof err === 'string') {
      detail = err.trim();
    } else if (typeof err === 'number' || typeof err === 'boolean') {
      detail = String(err);
    }

    if (!detail) detail = 'Unbekannter Ladefehler';
    const snippet = String(err?.responseSnippet || '').trim();
    if (snippet) {
      detail += ` | body: ${snippet}`;
    }
    parts.push(detail);
    return parts.join(': ');
  }

  function _diagnoseFromError(err, endpoint = '', context = '') {
    if (_isAbortError(err)) {
      return {
        kind: 'abort',
        reachable: null,
        message: _describeError(err, endpoint, context),
      };
    }

    const status = Number(err?.status || err?.cause?.status || 0);
    const statusText = String(err?.statusText || err?.cause?.statusText || '').trim();
    const rawMessage = String(err?.message || err?.cause?.message || err || '').toLowerCase();
    const offline = typeof navigator !== 'undefined' && navigator && navigator.onLine === false;

    if (offline) {
      return {
        kind: 'offline',
        reachable: false,
        status: 0,
        message: 'Netzwerk offline',
      };
    }

    if (status > 0) {
      if (status === 401 || status === 403) {
        return {
          kind: 'auth',
          reachable: true,
          status,
          message: `Auth-Fehler (${status}${statusText ? ` ${statusText}` : ''})`,
        };
      }
      return {
        kind: 'http',
        reachable: true,
        status,
        message: `HTTP ${status}${statusText ? ` ${statusText}` : ''}`,
      };
    }

    if (rawMessage.includes('timeout')) {
      return {
        kind: 'timeout',
        reachable: null,
        status: 0,
        message: 'Zeitueberschreitung beim Verbindungsaufbau',
      };
    }

    if (rawMessage.includes('failed to fetch') || rawMessage.includes('networkerror') || rawMessage.includes('network error')) {
      return {
        kind: 'unreachable',
        reachable: false,
        status: 0,
        message: 'API nicht erreichbar (Failed to fetch)',
      };
    }

    return {
      kind: 'unknown',
      reachable: null,
      status: status || 0,
      message: _describeError(err, endpoint, context),
    };
  }

  async function _probeConnectivity(force = false) {
    const now = Date.now();
    const ttlMs = 12000;
    if (!force && _lastConnectivityProbe.data && (now - _lastConnectivityProbe.ts) < ttlMs) {
      return _lastConnectivityProbe.data;
    }

    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) {
      const data = {
        ok: false,
        kind: 'offline',
        reachable: false,
        status: 0,
        latencyMs: 0,
        message: 'Client offline',
        ts: now,
      };
      _lastConnectivityProbe = { ts: now, data };
      return data;
    }

    const controller = new AbortController();
    const started = performance.now();
    const timeout = setTimeout(() => controller.abort(_createAbortError('Connectivity probe timeout')), 3500);
    try {
      const resp = await _queueFetch('api/auth.php?action=csrf', {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      }, { priority: 'critical', canCancel: false });
      const latencyMs = Math.max(0, Math.round(performance.now() - started));
      const status = Number(resp?.status || 0);
      const data = {
        ok: !!resp && status > 0 && status < 500,
        kind: status >= 500 ? 'http' : 'ok',
        reachable: !!resp && status > 0,
        status,
        latencyMs,
        message: status >= 500 ? `HTTP ${status}` : 'API erreichbar',
        ts: Date.now(),
      };
      _lastConnectivityProbe = { ts: Date.now(), data };
      return data;
    } catch (err) {
      const diag = _diagnoseFromError(err, 'api/auth.php?action=csrf', 'CONNECTIVITY');
      const data = {
        ok: false,
        kind: diag.kind,
        reachable: diag.reachable,
        status: Number(diag.status || 0),
        latencyMs: Math.max(0, Math.round(performance.now() - started)),
        message: String(diag.message || 'Connectivity probe failed'),
        ts: Date.now(),
      };
      _lastConnectivityProbe = { ts: Date.now(), data };
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }

  function _isTransientError(err) {
    const status = Number(err?.status || 0);
    if (status > 0) {
      // Retry only on clearly transient HTTP statuses.
      return status >= 500 || status === 408 || status === 429;
    }
    const message = String(err?.message || err || '').toLowerCase();
    return message.includes('failed to fetch')
      || message.includes('networkerror')
      || message.includes('network error')
      || message.includes('timeout')
      || message.includes('temporarily unavailable');
  }

  function _sanitizeSnippet(text, maxLen = 300) {
    const clean = String(text || '')
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .trim();
    if (!clean) return '';
    if (clean.length <= maxLen) return clean;
    return `${clean.slice(0, maxLen)}...`;
  }

  function _contentTypeOf(response) {
    try {
      return String(response?.headers?.get('content-type') || '').toLowerCase();
    } catch (_) {
      return '';
    }
  }

  async function _throwHttpError(endpoint, response, context = '') {
    const status = Number(response?.status || 0);
    const statusText = String(response?.statusText || '').trim();
    const contentType = _contentTypeOf(response);
    const err = new Error(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    err.status = status;
    err.statusText = statusText;
    err.endpoint = endpoint;
    err.context = context;
    err.contentType = contentType || 'unknown';

    try {
      const clone = response.clone();
      const raw = await clone.text();
      const snippet = _sanitizeSnippet(raw, 300);
      if (snippet) err.responseSnippet = snippet;
    } catch (_) {
      // Ignore body read errors for diagnostics.
    }

    throw err;
  }

  function _priorityValue(name) {
    const key = String(name || 'normal').toLowerCase();
    if (key === 'critical') return 0;
    if (key === 'high') return 1;
    if (key === 'low') return 3;
    return 2;
  }

  function _resolveRequestPriority(endpoint, explicitPriority) {
    if (explicitPriority) return String(explicitPriority);

    const ep = String(endpoint || '').toLowerCase();
    if (/api\/galaxy\.php\?action=stars/.test(ep)) return 'critical';
    if (/api\/galaxy\.php\?/.test(ep)) return 'high';
    if (/api\/fleet\.php\?action=send|api\/fleet\.php\?action=recall/.test(ep)) return 'high';
    if (/api\/messages\.php\?action=users/.test(ep)) return 'low';
    if (/api\/leaderboard\.php\?/.test(ep)) return 'low';
    return 'normal';
  }

  function _pickNextQueuedTask() {
    if (_requestQueue.length === 0) return null;

    const hasHighWaiting = _requestQueue.some((item) => item.priorityValue <= 1);
    if (hasHighWaiting && _activeNetworkRequests >= (_maxConcurrentRequests - 1)) {
      const highIdx = _requestQueue.findIndex((item) => item.priorityValue <= 1);
      if (highIdx >= 0) {
        return _requestQueue.splice(highIdx, 1)[0];
      }
    }

    return _requestQueue.shift();
  }

  function _pumpRequestQueue() {
    while (_activeNetworkRequests < _maxConcurrentRequests && _requestQueue.length > 0) {
      const task = _pickNextQueuedTask();
      if (!task) return;

      if (task.cancelled) {
        task.reject(_createAbortError(task.cancelReason || 'Request cancelled before start'));
        continue;
      }

      _activeNetworkRequests += 1;
      task.started = true;
      _inflightTasks.set(task.id, task);

      fetch(task.endpoint, task.init)
        .then((resp) => task.resolve(resp))
        .catch((err) => task.reject(err))
        .finally(() => {
          _inflightTasks.delete(task.id);
          _activeNetworkRequests = Math.max(0, _activeNetworkRequests - 1);
          _emitQueueStats('Queue synchronisiert…');
          _pumpRequestQueue();
        });
    }
  }

  function _queueFetch(endpoint, init = {}, options = {}) {
    const priority = _resolveRequestPriority(endpoint, options.priority);
    const priorityValue = _priorityValue(priority);
    const method = String(init?.method || 'GET').toUpperCase();
    const controller = new AbortController();
    const signal = options.signal || controller.signal;
    const canCancel = options.canCancel !== false && (method === 'GET' || method === 'HEAD');
    const taskId = ++_requestTaskId;

    if (options.signal && typeof options.signal.addEventListener === 'function') {
      options.signal.addEventListener('abort', () => {
        controller.abort(options.signal.reason || 'Aborted by caller signal');
      }, { once: true });
    }

    return new Promise((resolve, reject) => {
      _requestQueue.push({
        id: taskId,
        endpoint,
        init: Object.assign({}, init, { signal }),
        resolve,
        reject,
        priority,
        priorityValue,
        method,
        canCancel,
        controller,
        cancelled: false,
        cancelReason: '',
        seq: ++_requestSequence,
        started: false,
      });

      _requestQueue.sort((a, b) => {
        if (a.priorityValue !== b.priorityValue) return a.priorityValue - b.priorityValue;
        return a.seq - b.seq;
      });

      _emitQueueStats('Anfrage eingereiht…');
      _pumpRequestQueue();
    });
  }

  function _cancelPendingRequests(reason = 'View switch', predicate = null) {
    const test = typeof predicate === 'function' ? predicate : (() => true);
    let cancelledQueued = 0;
    let cancelledInflight = 0;

    for (let i = _requestQueue.length - 1; i >= 0; i -= 1) {
      const task = _requestQueue[i];
      if (!task || !task.canCancel || !test(task)) continue;
      _requestQueue.splice(i, 1);
      task.cancelled = true;
      task.cancelReason = reason;
      task.reject(_createAbortError(reason));
      cancelledQueued += 1;
    }

    for (const task of _inflightTasks.values()) {
      if (!task || !task.canCancel || !test(task)) continue;
      try {
        task.cancelled = true;
        task.cancelReason = reason;
        task.controller.abort(_createAbortError(reason));
        cancelledInflight += 1;
      } catch (_) {}
    }

    if (cancelledQueued > 0 || cancelledInflight > 0) {
      _emitQueueStats(`Anfragen verworfen (${cancelledQueued + cancelledInflight})`);
    }

    return { cancelledQueued, cancelledInflight };
  }

  async function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function _retryDelayMs(attempt) {
    const base = 220;
    const jitter = Math.floor(Math.random() * 90);
    return Math.min(1800, (base * (2 ** attempt)) + jitter);
  }

  async function _fetchWithRetry(endpoint, init = {}, options = {}) {
    const method = String(init?.method || 'GET').toUpperCase();
    const idempotent = method === 'GET' || method === 'HEAD';
    const retryCount = idempotent
      ? Math.max(0, Number.isFinite(Number(options.retryCount)) ? Number(options.retryCount) : 2)
      : 0;

    let lastErr = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      try {
        const response = await _queueFetch(endpoint, init, options);
        if (!response || !response.ok) {
          await _throwHttpError(endpoint, response, method);
        }
        return response;
      } catch (err) {
        lastErr = err;
        if (_isAbortError(err)) throw err;
        const transient = _isTransientError(err);
        if (!idempotent || !transient || attempt >= retryCount) {
          const finalMessage = _describeError(err, endpoint, `${method} retry ${attempt + 1}/${retryCount + 1}`);
          const wrapped = new Error(finalMessage);
          wrapped.cause = err;
          if (err?.status) wrapped.status = err.status;
          if (err?.statusText) wrapped.statusText = err.statusText;
          if (err?.responseSnippet) wrapped.responseSnippet = err.responseSnippet;
          throw wrapped;
        }
        console.warn('[GQ][API] Retry due to transient error', {
          endpoint,
          method,
          attempt: attempt + 1,
          maxAttempts: retryCount + 1,
          error: _describeError(err, endpoint, method),
        });
        await _sleep(_retryDelayMs(attempt));
      }
    }
    throw lastErr || new Error('Network request failed');
  }

  function _sanitizeLoadLabel(endpoint, fallback = 'Lade Daten…') {
    const ep = String(endpoint || '').trim();
    if (!ep) return fallback;
    try {
      const path = ep.replace(/^https?:\/\/[^/]+/i, '');
      const noQuery = path.split('?')[0] || path;
      const shortPath = noQuery.replace(/^\/+/, '');
      return shortPath ? `Lade ${shortPath}…` : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function _beginLoad(endpoint, label) {
    _activeLoads += 1;
    const finalLabel = _sanitizeLoadLabel(endpoint, label);
    _emitLoadProgress({
      active: true,
      progress: 0.08,
      endpoint,
      pending: _activeLoads,
      label: finalLabel,
    });
    return {
      endpoint,
      label: finalLabel,
      closed: false,
    };
  }

  function _tickLoad(ticket, progress, phaseLabel) {
    if (!ticket || ticket.closed) return;
    _emitLoadProgress({
      active: true,
      progress: Math.max(0.08, Math.min(0.98, Number(progress || 0))),
      endpoint: ticket.endpoint,
      pending: _activeLoads,
      label: phaseLabel ? String(phaseLabel) : ticket.label,
    });
  }

  function _endLoad(ticket) {
    if (!ticket || ticket.closed) return;
    ticket.closed = true;
    _activeLoads = Math.max(0, _activeLoads - 1);

    if (_activeLoads > 0) {
      _emitLoadProgress({
        active: true,
        progress: 0.2,
        endpoint: ticket.endpoint,
        pending: _activeLoads,
        label: `Lade Daten (${_activeLoads})…`,
      });
      return;
    }

    _emitLoadProgress({
      active: true,
      progress: 1,
      endpoint: ticket.endpoint,
      pending: 0,
      label: 'Laden abgeschlossen',
    });

    setTimeout(() => {
      _emitLoadProgress({
        active: false,
        progress: 0,
        endpoint: ticket.endpoint,
        pending: 0,
        label: 'Bereit',
      });
    }, 200);
  }

  function _clone(value) {
    try {
      if (typeof structuredClone === 'function') return structuredClone(value);
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return value;
    }
  }

  function _resolveGetTtl(endpoint) {
    for (const rule of _defaultGetTtlMs) {
      if (rule.re.test(endpoint)) return Number(rule.ttl) || 0;
    }
    return 0;
  }

  function _purgeExpiredGetCache(now = Date.now()) {
    for (const [key, item] of _getCache.entries()) {
      if (!item || item.expiresAt <= now) _getCache.delete(key);
    }
  }

  function _invalidateGetCache(patterns = _mutationInvalidatePatterns) {
    if (!patterns?.length) {
      _getCache.clear();
      return;
    }
    for (const key of [..._getCache.keys()]) {
      if (patterns.some((re) => re.test(key))) {
        _getCache.delete(key);
      }
    }
  }

  async function _csrf() {
    if (!_csrfToken) {
      const r = await _fetchWithRetry('api/auth.php?action=csrf', {}, { priority: 'high', retryCount: 1 });
      const d = await r.json();
      _csrfToken = d.token;
    }
    return _csrfToken;
  }

  async function get(endpoint, options = {}) {
    const loadTicket = _beginLoad(endpoint, 'Lade Daten…');
    const cacheMode = String(options.cacheMode || 'default');
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : _resolveGetTtl(endpoint);
    const now = Date.now();

    _purgeExpiredGetCache(now);

    if (cacheMode !== 'no-store' && ttlMs > 0) {
      const hit = _getCache.get(endpoint);
      if (hit && hit.expiresAt > now) return _clone(hit.data);
    }

    try {
      _tickLoad(loadTicket, 0.25, loadTicket.label);
      const r = await _fetchWithRetry(endpoint, {}, { priority: options.priority, retryCount: options.retryCount });
      if (r.status === 401) { window.location.href = 'index.html'; throw new Error('Not authenticated'); }
      _tickLoad(loadTicket, 0.7, 'Verarbeite Antwort…');
      const data = await r.json();
      _tickLoad(loadTicket, 0.92, 'Fertigstelle Daten…');
      if (cacheMode !== 'no-store' && ttlMs > 0 && data && data.success !== false) {
        _getCache.set(endpoint, {
          data: _clone(data),
          expiresAt: Date.now() + ttlMs,
        });
      }
      return data;
    } catch (err) {
      if (_isAbortError(err)) throw err;
      // Auth-check endpoint can legitimately return 401 before login.
      if (Number(err?.status || err?.cause?.status || 0) === 401 && /api\/auth\.php\?action=me/i.test(String(endpoint || ''))) {
        throw err;
      }
      if (cacheMode === 'stale-if-error') {
        const stale = _getCache.get(endpoint);
        if (stale?.data) {
          console.warn('[GQ][API] Verwende stale Cache wegen Fehler', { endpoint, error: err });
          return _clone(stale.data);
        }
      }
      _reportLoadError(endpoint, err, 'GET');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  async function post(endpoint, body) {
    const loadTicket = _beginLoad(endpoint, 'Sende Daten…');
    try {
      const csrf = await _csrf();
      _tickLoad(loadTicket, 0.22, loadTicket.label);
      const r = await _fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(body),
      }, {});
      if (r.status === 401) { window.location.href = 'index.html'; throw new Error('Not authenticated'); }
      _tickLoad(loadTicket, 0.72, 'Verarbeite Serverantwort…');
      const data = await r.json();
      if (data && data.success !== false) {
        _invalidateGetCache();
      }
      _tickLoad(loadTicket, 0.92, 'Aktualisiere Ansicht…');
      return data;
    } catch (err) {
      if (_isAbortError(err)) throw err;
      _reportLoadError(endpoint, err, 'POST');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  async function getBinary(endpoint, options = {}) {
    const loadTicket = _beginLoad(endpoint, 'Lade Sternsystem…');
    const cacheMode = String(options.cacheMode || 'default');
    const ttlMs = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : _resolveGetTtl(endpoint);
    const now = Date.now();

    _purgeExpiredGetCache(now);

    if (cacheMode !== 'no-store' && ttlMs > 0) {
      const hit = _getCache.get(endpoint);
      if (hit && hit.expiresAt > now) return _clone(hit.data);
    }

    try {
      _tickLoad(loadTicket, 0.24, loadTicket.label);
      const r = await _fetchWithRetry(endpoint, {}, {
        priority: options.priority || 'high',
        retryCount: options.retryCount,
      });
      if (r.status === 401) { window.location.href = 'index.html'; throw new Error('Not authenticated'); }
      _tickLoad(loadTicket, 0.52, 'Dekodiere Binärdaten…');
      
      // Check for binary format marker
      const contentType = r.headers.get('content-type') || '';
      if (contentType.includes('octet-stream')) {
        // Binary mode
        const buffer = await r.arrayBuffer();
        let data = null;

        // Version is stored after magic as u16 (offset 4..5).
        try {
          const view = new DataView(buffer);
          const magic = view.getUint32(0, false);
          const version = view.getUint16(4, false);
          if (magic === 0xDEADBEEF) {
            if (version === 3 && typeof BinaryDecoderV3 !== 'undefined' && BinaryDecoderV3?.decode) {
              data = BinaryDecoderV3.decode(buffer);
            } else if (version === 2 && typeof BinaryDecoderV2 !== 'undefined' && BinaryDecoderV2?.decode) {
              data = BinaryDecoderV2.decode(buffer);
            } else if (version === 1 && typeof BinaryDecoder !== 'undefined' && BinaryDecoder?.decode) {
              data = BinaryDecoder.decode(buffer);
            }
          }
        } catch (_) {
          data = null;
        }

        // Legacy fallback chain (in case version parse fails or decoder missing).
        if (!data && typeof BinaryDecoderV3 !== 'undefined' && BinaryDecoderV3?.decode) {
          data = BinaryDecoderV3.decode(buffer);
        }
        if (!data && typeof BinaryDecoderV2 !== 'undefined' && BinaryDecoderV2?.decode) {
          data = BinaryDecoderV2.decode(buffer);
        }
        if (!data && typeof BinaryDecoder !== 'undefined' && BinaryDecoder?.decode) {
          data = BinaryDecoder.decode(buffer);
        }
        
        if (!data) {
          throw new Error('Binary decode failed');
        }
        _tickLoad(loadTicket, 0.86, 'Baue Nutzdaten auf…');
        
        // Add metadata
        data.success = true;
        data.server_ts_ms = data.server_ts_ms || Date.now();
        
        if (cacheMode !== 'no-store' && ttlMs > 0) {
          _getCache.set(endpoint, {
            data: _clone(data),
            expiresAt: Date.now() + ttlMs,
          });
        }
        
        return data;
      } else {
        // Fallback to JSON
        _tickLoad(loadTicket, 0.7, 'Verarbeite JSON-Fallback…');
        const data = await r.json();
        if (cacheMode !== 'no-store' && ttlMs > 0 && data && data.success !== false) {
          _getCache.set(endpoint, {
            data: _clone(data),
            expiresAt: Date.now() + ttlMs,
          });
        }
        return data;
      }
    } catch (err) {
      if (_isAbortError(err)) throw err;
      if (cacheMode === 'stale-if-error') {
        const stale = _getCache.get(endpoint);
        if (stale?.data) {
          console.warn('[GQ][API] Verwende stale Cache (binary) wegen Fehler', { endpoint, error: err });
          return _clone(stale.data);
        }
      }
      _reportLoadError(endpoint, err, 'GET_BINARY');
      throw err;
    } finally {
      _endLoad(loadTicket);
    }
  }

  return {
    // Cache control
    invalidateCache: () => _invalidateGetCache(),
    cancelPendingRequests: (reason = 'View switch') =>
      _cancelPendingRequests(reason, (task) => String(task.method || 'GET').toUpperCase() !== 'POST'),
    getQueueStats: () => ({
      queued: _requestQueue.length,
      inFlight: _activeNetworkRequests,
      concurrency: _maxConcurrentRequests,
      pendingLoads: _activeLoads,
    }),
    setConcurrencyLimit: (limit) => {
      const n = Math.max(1, Math.min(8, Number(limit || _maxConcurrentRequests)));
      _maxConcurrentRequests = n;
      _pumpRequestQueue();
      return _maxConcurrentRequests;
    },
    networkHealth: (force = false) => _probeConnectivity(!!force),

    // Auth
    me:     () => get('api/auth.php?action=me'),
    logout: () => post('api/auth.php?action=logout', {}),

    // Game overview
    overview:    ()    => get('api/game.php?action=overview', { priority: 'high' }),
    health:      ()    => get('api/game.php?action=health'),
    resources:   (cid) => get(`api/game.php?action=resources&colony_id=${cid}`),
    planetIntel: (g, s, p) => get(`api/game.php?action=planet_intel&galaxy=${g}&system=${s}&position=${p}`),
    leaderboard: ()    => get('api/game.php?action=leaderboard'),
    renameColony:  (cid, name) => post('api/game.php?action=rename_colony',   { colony_id: cid, name }),
    setColonyType: (cid, type) => post('api/game.php?action=set_colony_type', { colony_id: cid, colony_type: type }),

    // Buildings
    buildings:     (cid)        => get(`api/buildings.php?action=list&colony_id=${cid}`),
    upgrade:       (cid, type)  => post('api/buildings.php?action=upgrade', { colony_id: cid, type }),
    finishBuilding:(cid)        => post('api/buildings.php?action=finish',  { colony_id: cid }),

    // Research
    research:      (cid)        => get(`api/research.php?action=list&colony_id=${cid}`),
    doResearch:    (cid, type)  => post('api/research.php?action=research', { colony_id: cid, type }),
    finishResearch:()           => post('api/research.php?action=finish', {}),

    // Shipyard
    ships:    (cid)              => get(`api/shipyard.php?action=list&colony_id=${cid}`),
    buildShip:(cid, type, count) => post('api/shipyard.php?action=build', { colony_id: cid, type, count }),

    // Fleet
    fleets:     ()        => get('api/fleet.php?action=list'),
    sendFleet:  (payload) => post('api/fleet.php?action=send', payload),
    recallFleet:(id)      => post('api/fleet.php?action=recall', { fleet_id: id }),

    // Galaxy
    galaxy: (g, s) => getBinary(`api/galaxy.php?galaxy=${g}&system=${s}&format=bin`, { priority: 'high' }),
    galaxyStars: (g, from = 1, to = 25000, maxPoints = 1500) =>
      get(`api/galaxy.php?action=stars&galaxy=${g}&from=${from}&to=${to}&max_points=${maxPoints}`, { priority: 'critical' }),
    galaxySearch: (g, q, limit = 18) =>
      get(`api/galaxy.php?action=search&galaxy=${g}&q=${encodeURIComponent(String(q || ''))}&limit=${Math.max(1, Number(limit || 18))}`),

    // Achievements / quests
    achievements:    ()    => get('api/achievements.php?action=list'),
    claimAchievement:(id)  => post('api/achievements.php?action=claim', { achievement_id: id }),

    // PvP
    togglePvp: () => post('api/game.php?action=pvp_toggle', {}),

    // Leaders
    leaders:        ()                      => get('api/leaders.php?action=list'),
    hireLeader:     (name, role)            => post('api/leaders.php?action=hire',     { name, role }),
    assignLeader:   (lid, cid, fid)         => post('api/leaders.php?action=assign',   { leader_id: lid, colony_id: cid ?? undefined, fleet_id: fid ?? undefined }),
    setAutonomy:    (lid, autonomy)         => post('api/leaders.php?action=autonomy', { leader_id: lid, autonomy }),
    dismissLeader:  (lid)                   => post('api/leaders.php?action=dismiss',  { leader_id: lid }),
    aiTick:         ()                      => post('api/leaders.php?action=ai_tick',  {}),

    // Factions & diplomacy
    factions:        ()           => get('api/factions.php?action=list'),
    tradeOffers:     (fid)        => get(`api/factions.php?action=trade_offers&faction_id=${fid}`),
    acceptTrade:     (oid, cid)   => post('api/factions.php?action=accept_trade',  { offer_id: oid, colony_id: cid }),
    factionQuests:   (fid)        => get(`api/factions.php?action=quests&faction_id=${fid}`),
    startFactionQuest:(fqid)      => post('api/factions.php?action=start_quest',   { faction_quest_id: fqid }),
    checkFactionQuests:()         => post('api/factions.php?action=check_quests',  {}),
    claimFactionQuest:(uqid)      => post('api/factions.php?action=claim_quest',   { user_quest_id: uqid }),

    // Messages
    inbox:    ()               => get('api/messages.php?action=inbox'),
    messageUsers: (q = '')     => get(`api/messages.php?action=users&q=${encodeURIComponent(String(q || ''))}`),
    readMsg:  (id)             => get(`api/messages.php?action=read&id=${id}`),
    sendMsg:  (to, sub, body)  => post('api/messages.php?action=send', { to_username: to, subject: sub, body }),
    deleteMsg:(id)             => post('api/messages.php?action=delete', { id }),
  };
})();

if (typeof window !== 'undefined') {
  window.API = API;
}
