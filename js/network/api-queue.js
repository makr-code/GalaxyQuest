/**
 * API Queue and Concurrency Management
 * Handles request prioritization, backpressure, and concurrent request limiting.
 */
const APIQueue = (() => {
  let _requestQueue = [];
  let _inflightTasks = new Map();
  let _activeByRequestClass = Object.create(null);
  let _maxConcurrentRequests = 4;
  let _activeNetworkRequests = 0;
  let _requestSequence = 0;
  let _requestTaskId = 0;
  
  const _requestClassCaps = {
    auth: 2,
    overview: 1,
    stars: 1,
    binary: 2,
    mutation: 2,
  };

  function _log(level, message, data = null) {
    const lvl = String(level || 'info').toLowerCase();
    const sink = window.GQLog && typeof window.GQLog[lvl] === 'function'
      ? window.GQLog[lvl].bind(window.GQLog)
      : null;
    if (sink) {
      if (data == null) sink('[api-queue]', message);
      else sink('[api-queue]', message, data);
      return;
    }
    const consoleMethod = (lvl === 'error' || lvl === 'warn' || lvl === 'info') ? lvl : 'log';
    if (data == null) console[consoleMethod]('[GQ][API][queue]', message);
    else console[consoleMethod]('[GQ][API][queue]', message, data);
  }

  function _emitQueueStats(label = 'Queue aktiv') {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    window.dispatchEvent(new CustomEvent('gq:queue-stats', {
      detail: {
        queued: _requestQueue.length,
        inFlight: _activeNetworkRequests,
        concurrency: _maxConcurrentRequests,
        label,
      },
    }));
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
    if (/api\/auth\.php\?action=csrf|api\/auth\.php\?action=me/.test(ep)) return 'critical';
    if (/api\/game\.php\?action=overview/.test(ep)) return 'critical';
    if (/api\/galaxy\.php\?action=stars/.test(ep)) return 'high';
    if (/api\/galaxy\.php\?/.test(ep)) return 'high';
    if (/api\/fleet\.php\?action=send|api\/fleet\.php\?action=recall/.test(ep)) return 'high';
    if (/api\/messages\.php\?action=users/.test(ep)) return 'low';
    if (/api\/leaderboard\.php\?/.test(ep)) return 'low';
    return 'normal';
  }

  function _resolveRequestClass(endpoint, init = {}, explicitClass = '') {
    if (explicitClass) return String(explicitClass);
    const ep = String(endpoint || '').toLowerCase();
    const method = String(init?.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return 'mutation';
    if (/api\/auth\.php\?action=csrf|api\/auth\.php\?action=me/.test(ep)) return 'auth';
    if (/api\/game\.php\?action=overview/.test(ep)) return 'overview';
    if (/api\/galaxy\.php\?action=stars/.test(ep)) return 'stars';
    if (/api\/galaxy\.php\?/.test(ep)) return 'binary';
    return 'default';
  }

  function _hasCriticalQueuePressure() {
    return _requestQueue.some((item) => item.priorityValue === 0);
  }

  function _canStartTask(task) {
    if (!task) return false;
    const cls = String(task.requestClass || 'default');
    const activeInClass = Number(_activeByRequestClass[cls] || 0);
    const classCap = Number(_requestClassCaps[cls] || 0);
    if (classCap > 0 && activeInClass >= classCap) return false;

    if (task.priorityValue > 0 && _hasCriticalQueuePressure() && _activeNetworkRequests >= Math.max(1, _maxConcurrentRequests - 1)) {
      return false;
    }
    return true;
  }

  function _pickNextQueuedTask() {
    if (_requestQueue.length === 0) return null;

    for (let i = 0; i < _requestQueue.length; i += 1) {
      const candidate = _requestQueue[i];
      if (_canStartTask(candidate)) {
        return _requestQueue.splice(i, 1)[0];
      }
    }
    return null;
  }

  function _pumpRequestQueue(executeTask) {
    while (_activeNetworkRequests < _maxConcurrentRequests && _requestQueue.length > 0) {
      const task = _pickNextQueuedTask();
      if (!task) break;

      if (task.cancelled) {
        task.reject(APITransport.createAbortError(task.cancelReason || 'Request cancelled before start'));
        continue;
      }

      _activeNetworkRequests += 1;
      _activeByRequestClass[task.requestClass] = Number(_activeByRequestClass[task.requestClass] || 0) + 1;
      task.started = true;
      _inflightTasks.set(task.id, task);

      executeTask(task)
        .then((resp) => task.resolve(resp))
        .catch((err) => task.reject(err))
        .finally(() => {
          _inflightTasks.delete(task.id);
          _activeNetworkRequests = Math.max(0, _activeNetworkRequests - 1);
          _activeByRequestClass[task.requestClass] = Math.max(0, Number(_activeByRequestClass[task.requestClass] || 0) - 1);
          _emitQueueStats('Queue synchronisiert…');
          _pumpRequestQueue(executeTask);
        });
    }
  }

  function _queueFetch(endpoint, init = {}, options = {}, executeTask) {
    const endpointText = String(endpoint || '');
    const priority = _resolveRequestPriority(endpoint, options.priority);
    const priorityValue = _priorityValue(priority);
    const method = String(init?.method || 'GET').toUpperCase();
    const requestClass = _resolveRequestClass(endpoint, init, options.requestClass);
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
      const fetchEndpoint = APITransport.versionEndpoint(endpointText);
      _requestQueue.push({
        id: taskId,
        endpoint,
        fetchEndpoint,
        init: Object.assign({}, init, { signal }),
        resolve,
        reject,
        priority,
        priorityValue,
        requestClass,
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
      _pumpRequestQueue(executeTask);
    });
  }

  function _cancelPendingRequests(reason = 'View switch', predicate = null, sessionExpired = false) {
    const test = typeof predicate === 'function' ? predicate : (() => true);
    let cancelledQueued = 0;
    let cancelledInflight = 0;

    for (let i = _requestQueue.length - 1; i >= 0; i -= 1) {
      const task = _requestQueue[i];
      if (!task || !task.canCancel || !test(task)) continue;
      _requestQueue.splice(i, 1);
      task.cancelled = true;
      task.cancelReason = reason;
      task.reject(APITransport.createAbortError(reason));
      cancelledQueued += 1;
    }

    for (const task of _inflightTasks.values()) {
      if (!task || !task.canCancel || !test(task)) continue;
      try {
        task.cancelled = true;
        task.cancelReason = reason;
        task.controller.abort(APITransport.createAbortError(reason));
        cancelledInflight += 1;
      } catch (err) {
        _log('warn', 'Abbruch einer Inflight-Anfrage fehlgeschlagen', {
          reason,
          endpoint: String(task?.endpoint || ''),
          error: err,
        });
      }
    }

    if (cancelledQueued > 0 || cancelledInflight > 0) {
      _emitQueueStats(`Anfragen verworfen (${cancelledQueued + cancelledInflight})`);
    }

    return { cancelledQueued, cancelledInflight };
  }

  return {
    queueFetch: (endpoint, init, options, executeTask) => _queueFetch(endpoint, init, options, executeTask),
    pumpQueue: (executeTask) => _pumpRequestQueue(executeTask),
    cancelPendingRequests: (reason, predicate, sessionExpired) => _cancelPendingRequests(reason, predicate, sessionExpired),
    getQueueStats: () => ({
      queued: _requestQueue.length,
      inFlight: _activeNetworkRequests,
      concurrency: _maxConcurrentRequests,
      pendingLoads: 0,
    }),
    setConcurrencyLimit: (limit) => {
      const n = Math.max(1, Math.min(8, Number(limit || _maxConcurrentRequests)));
      _maxConcurrentRequests = n;
      return _maxConcurrentRequests;
    },
    resolveRequestPriority: (endpoint, explicitPriority) => _resolveRequestPriority(endpoint, explicitPriority),
    resolveRequestClass: (endpoint, init, explicitClass) => _resolveRequestClass(endpoint, init, explicitClass),
    getActiveRequestCount: () => _activeNetworkRequests,
    getQueueLength: () => _requestQueue.length,
  };
})();

if (typeof window !== 'undefined') {
  window.APIQueue = APIQueue;
}
