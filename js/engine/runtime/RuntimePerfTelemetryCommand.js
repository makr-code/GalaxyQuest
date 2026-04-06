/**
 * RuntimePerfTelemetryCommand.js
 *
 * Handles the `perftelemetry` UI console command.
 */

'use strict';

(function () {
  const state = {
    getApi: () => null,
    isOptIn: () => false,
    setOptIn: () => false,
    sendSnapshot: async () => false,
  };

  function configurePerfTelemetryCommandRuntime(opts = {}) {
    const {
      getApi = null,
      isOptIn = null,
      setOptIn = null,
      sendSnapshot = null,
    } = opts;

    state.getApi = typeof getApi === 'function' ? getApi : (() => null);
    state.isOptIn = typeof isOptIn === 'function' ? isOptIn : (() => false);
    state.setOptIn = typeof setOptIn === 'function' ? setOptIn : (() => false);
    state.sendSnapshot = typeof sendSnapshot === 'function' ? sendSnapshot : (async () => false);
  }

  function formatBytes(input) {
    const bytes = Math.max(0, Number(input || 0));
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let idx = 0;
    while (value >= 1024 && idx < units.length - 1) {
      value /= 1024;
      idx += 1;
    }
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[idx]}`;
  }

  async function runPerfTelemetryCommand(parts, pushLine) {
    const logLine = typeof pushLine === 'function' ? pushLine : (() => {});
    const arg = String(parts?.[1] || '').toLowerCase();

    if (arg === 'status') {
      logLine(`[state] perftelemetry=${state.isOptIn() ? 'on' : 'off'}`);
      return true;
    }

    if (arg === 'on' || arg === 'off') {
      const ok = state.setOptIn(arg === 'on');
      if (!ok) {
        logLine('[error] Konnte Opt-In nicht speichern.');
        return true;
      }
      logLine(`[ok] perftelemetry=${arg}`);
      return true;
    }

    if (arg === 'send') {
      const sent = await state.sendSnapshot('manual');
      logLine(sent ? '[ok] Perf-Telemetrie gesendet.' : '[warn] Perf-Telemetrie nicht gesendet (Opt-In aus oder keine Renderer-Daten).');
      return true;
    }

    if (arg === 'summary') {
      const mins = Math.max(5, Math.min(24 * 60, Number(parts?.[2] || 60)));
      const api = state.getApi();
      if (!api || typeof api.perfTelemetrySummary !== 'function') {
        logLine('[error] Perf-Telemetrie-Summary API nicht verfuegbar.');
        return true;
      }

      try {
        const res = await api.perfTelemetrySummary({ minutes: mins, source: 'galaxy' });
        if (!res?.success) {
          logLine(`[error] ${res?.error || 'summary failed'}`);
          return true;
        }

        const s = res.summary || {};
        const storage = res.storage || {};
        const today = storage.today || {};
        const limits = storage.limits || {};
        const fps = s.fps || {};
        const ft = s.frame_time_ms || {};
        const dc = s.draw_calls || {};

        logLine(`[perf] summary ${mins}m events=${res.count || 0}`);
        logLine(`[perf] fps avg=${fps.avg ?? 'n/a'} p95=${fps.p95 ?? 'n/a'} min=${fps.min ?? 'n/a'}`);
        logLine(`[perf] frameMs avg=${ft.avg ?? 'n/a'} p95=${ft.p95 ?? 'n/a'} max=${ft.max ?? 'n/a'}`);
        logLine(`[perf] drawCalls avg=${dc.avg ?? 'n/a'} p95=${dc.p95 ?? 'n/a'} max=${dc.max ?? 'n/a'}`);
        logLine(`[perf] storage files=${storage.files_count ?? 0} total=${formatBytes(storage.total_bytes)} latest=${storage.latest_file || 'n/a'} (${formatBytes(storage.latest_size_bytes)})`);
        logLine(`[perf] shards date=${today.date || 'n/a'} count=${today.shards ?? 0} maxShard=${today.max_shard ?? 0}`);
        logLine(`[perf] rotation maxFile=${formatBytes(limits.max_file_bytes)} maxShards=${limits.max_shards ?? 'n/a'} retention=${limits.retention_days ?? 'n/a'}d`);
      } catch (e) {
        logLine(`[error] ${String(e?.message || e || 'summary failed')}`);
      }
      return true;
    }

    logLine('[usage] perftelemetry on|off|status|send|summary [minutes]');
    return true;
  }

  const api = {
    configurePerfTelemetryCommandRuntime,
    runPerfTelemetryCommand,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimePerfTelemetryCommand = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
