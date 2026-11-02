export function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function memorySnapshot() {
  const m = performance.memory;
  return {
    jsHeapUsedBytes: Number.isFinite(m?.usedJSHeapSize) ? m.usedJSHeapSize : null,
    jsHeapLimitBytes: Number.isFinite(m?.jsHeapSizeLimit) ? m.jsHeapSizeLimit : null,
    gpuBytes: null,
  };
}

export function resourceSnapshot(since = 0) {
  if (!performance.getEntriesByType) return null;
  return performance.getEntriesByType('resource').filter(r => r.startTime >= since).map(r => ({
    url: new URL(r.name, location.href).pathname, durationMs: r.duration,
    transferBytes: r.transferSize > 0 ? r.transferSize : null,
    encodedBytes: r.encodedBodySize > 0 ? r.encodedBodySize : null,
  }));
}

/** Bounded observation of completed synchronous render calls, not GPU timings. */
export class FrameCapture {
  constructor({ warmup = 60, samples = 240, timeoutMs = 30000, metadata,
    startupMs = null, resourceStart = 0, signal, now = () => performance.now() } = {}) {
    if (!Number.isInteger(warmup) || warmup < 0 || warmup > 600 ||
      !Number.isInteger(samples) || samples < 2 || samples > 3600 ||
      !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) {
      throw new RangeError('Invalid bounded capture window');
    }
    this.now = now;
    this.warmup = warmup;
    this.samples = samples;
    this.metadata = structuredClone(metadata || {});
    this.startupMs = Number.isFinite(startupMs) && startupMs >= 0 ? startupMs : null;
    this.resourceStart = resourceStart;
    this.frames = [];
    this.cpu = [];
    this.seen = 0;
    this.previous = null;
    this.done = false;
    this.started = now();
    this.memoryBefore = memorySnapshot();
    this.promise = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.hidden = () => { if (document.hidden) this.cancel('Tab hidden; capture invalid'); };
    this.abort = () => this.cancel('Capture cancelled');
    this.signal = signal;
    document.addEventListener('visibilitychange', this.hidden);
    signal?.addEventListener('abort', this.abort, { once: true });
    this.timer = setTimeout(() => this.cancel('Capture timed out: not enough rendered frames'), timeoutMs);
    if (document.hidden || signal?.aborted) this.cancel('Capture requires a visible, non-aborted tab');
  }

  observe(start, submissionMs) {
    if (this.done) return;
    if (!Number.isFinite(start) || !Number.isFinite(submissionMs) || submissionMs < 0 ||
      (this.previous !== null && start <= this.previous)) {
      this.cancel('Invalid frame timing');
      return;
    }
    this.seen++;
    if (this.seen > this.warmup && this.previous !== null) {
      this.frames.push(start - this.previous);
      this.cpu.push(submissionMs);
    }
    this.previous = start;
    if (this.frames.length === this.samples) {
      this.cleanup();
      this.resolve({
        schema: 'gq-render-evaluation-v1', capturedAt: new Date().toISOString(),
        metadata: this.metadata, valid: true, warmupCalls: this.warmup, samples: this.samples,
        elapsedMs: this.now() - this.started, startupToFirstSubmissionMs: this.startupMs,
        frameIntervalMs: { p50: quantile(this.frames, 0.5), p95: quantile(this.frames, 0.95) },
        synchronousRenderCallMs: { p50: quantile(this.cpu, 0.5), p95: quantile(this.cpu, 0.95) },
        gpuTimeMs: null, memoryBefore: this.memoryBefore, memoryAfter: memorySnapshot(),
        resources: resourceSnapshot(this.resourceStart),
      });
    }
  }

  cleanup() {
    this.done = true;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.hidden);
    this.signal?.removeEventListener('abort', this.abort);
    this.onCleanup?.();
  }

  cancel(reason = 'Capture cancelled') {
    if (this.done) return;
    this.cleanup();
    this.reject(new Error(reason));
  }
}

/**
 * Attach to an EXISTING game loop method, without starting a second render loop.
 * The chosen method must execute once per rendered frame and synchronously submit.
 */
export function captureLiveBaseline({
  target, method = 'render', canvas, scene, backend, sceneMetadata = {},
  warmup = 60, samples = 240, timeoutMs = 30000, signal,
}) {
  if (!target || typeof target[method] !== 'function' || !canvas ||
    !['galaxy', 'dense-system', 'colony'].includes(scene) || typeof backend !== 'string') {
    throw new TypeError('Provide a live renderer/loop, canvas, scene and actual backend');
  }
  if (target[method].evaluationCapture) throw new Error('Already capturing this method');
  const original = target[method];
  const own = Object.getOwnPropertyDescriptor(target, method);
  const capture = new FrameCapture({
    warmup, samples, timeoutMs, signal,
    metadata: environmentMetadata(canvas, {
      source: 'live-game', scene, backend, sceneMetadata,
      measuredMethod: method, startupMeasurement: 'unavailable; renderer already running',
    }),
  });
  const wrapper = function (...args) {
    const start = performance.now();
    try {
      const result = original.apply(this, args);
      if (result?.then) {
        capture.cancel('Async render method unsupported; use a synchronous submission boundary');
      } else {
        capture.observe(start, performance.now() - start);
      }
      return result;
    } catch (error) {
      capture.cancel(`Renderer failed: ${error.message}`);
      throw error;
    }
  };
  wrapper.evaluationCapture = true;
  if (!capture.done) {
    target[method] = wrapper;
    capture.onCleanup = () => {
      // Do not undo another owner's later replacement.
      if (target[method] === wrapper) {
        if (own) Object.defineProperty(target, method, own);
        else delete target[method];
      }
    };
  }
  return { promise: capture.promise, cancel: () => capture.cancel() };
}

export function environmentMetadata(canvas, extra) {
  return {
    ...extra, resolution: { width: canvas.width, height: canvas.height },
    device: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGiB: navigator.deviceMemory ?? null, gpuModel: null },
    devicePixelRatio: globalThis.devicePixelRatio || 1,
    timingMeaning: 'Intervals between observed render calls; CPU is synchronous JS call time including submission, NOT GPU execution',
  };
}
