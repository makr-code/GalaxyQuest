export function summarizeSamples(samples) {
  if (!samples.length) return { count: 0, averageMs: null, p95Ms: null };
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, averageMs: samples.reduce((a, b) => a + b, 0) / samples.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

export class HeroBattleMetrics {
  constructor() {
    this.cpu = [];
    this.frames = [];
    this.gpu = [];
    this.frame = 0;
    this.lastFrame = null;
    this.pending = null;
    this.disposed = false;
    this.gpuStatus = 'not-sampled';
  }

  record(cpuMs, timestamp) {
    this.cpu.push(cpuMs);
    if (this.lastFrame !== null) this.frames.push((timestamp - this.lastFrame) * 1000);
    this.lastFrame = timestamp;
    for (const values of [this.cpu, this.frames]) if (values.length > 240) values.shift();
  }

  begin(device) {
    this.frame++;
    if (this.disposed || this.gpuStatus === 'failed') return null;
    if (!device.features?.has('timestamp-query')) { this.gpuStatus = 'unsupported'; return null; }
    this.gpuStatus = 'available';
    if (this.pending || this.frame % 30 !== 1 || this.disposed) return null;
    this.device = device;
    this.query ||= device.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolve ||= device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.readback ||= device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.sampling = true;
    return { querySet: this.query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  encode(encoder) {
    if (!this.sampling) return;
    encoder.resolveQuerySet(this.query, 0, 2, this.resolve, 0);
    encoder.copyBufferToBuffer(this.resolve, 0, this.readback, 0, 16);
  }

  submitted() {
    if (!this.sampling) return;
    this.sampling = false;
    this.pending = this.readback.mapAsync(GPUMapMode.READ).then(() => {
      const values = new BigUint64Array(this.readback.getMappedRange());
      const milliseconds = Number(values[1] - values[0]) / 1e6;
      this.readback.unmap();
      if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError('Invalid hero GPU timestamps');
      this.gpu.push(milliseconds);
      if (this.gpu.length > 120) this.gpu.shift();
    }).catch((error) => {
      this.gpuStatus = 'failed';
      this.error = String(error.message || error);
      window.GQLog?.warn?.('[hero-gpu-timing]', this.error);
      if (!window.GQLog?.warn) console.warn('[hero-gpu-timing]', error);
    }).finally(() => { this.pending = null; });
  }

  snapshot() {
    return { cpuUpdate: summarizeSamples(this.cpu), frameInterval: summarizeSamples(this.frames),
      gpuScenePass: summarizeSamples(this.gpu), gpuStatus: this.gpuStatus, gpuError: this.error || null };
  }

  async dispose() {
    this.disposed = true;
    if (this.pending) await this.pending;
    this.query?.destroy();
    this.resolve?.destroy();
    this.readback?.destroy();
    this.query = null;
    this.resolve = null;
    this.readback = null;
  }
}
