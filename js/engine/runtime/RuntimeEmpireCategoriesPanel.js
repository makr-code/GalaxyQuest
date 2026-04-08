'use strict';

/**
 * RuntimeEmpireCategoriesPanel
 *
 * Spider-chart (SVG polygon) for the 7 empire category scores (0–100) with
 * numeric bar-rows beneath each axis label.
 * Referenz: docs/gamedesign/EMPIRE_CATEGORIES.md
 *           api/empire.php
 */
(function () {
  const AXES = ['economy', 'military', 'research', 'growth', 'stability', 'diplomacy', 'espionage'];
  const AXIS_LABELS = {
    economy:   'Economy',
    military:  'Military',
    research:  'Research',
    growth:    'Growth',
    stability: 'Stability',
    diplomacy: 'Diplomacy',
    espionage: 'Espionage',
  };

  function createEmpireCategoriesPanel(opts = {}) {
    const wm  = opts.wm;
    const api = opts.api;
    const esc = opts.esc || ((v) => String(v ?? ''));
    const uiKitSkeletonHTML = opts.uiKitSkeletonHTML || (() => '<p class="text-muted">Loading…</p>');
    const gameLog   = typeof opts.gameLog   === 'function' ? opts.gameLog   : (() => {});
    const showToast = typeof opts.showToast === 'function' ? opts.showToast : (() => {});

    // ── Geometry helpers ─────────────────────────────────────────────────────

    function polarToCartesian(cx, cy, r, angleRad) {
      return {
        x: cx + r * Math.cos(angleRad),
        y: cy + r * Math.sin(angleRad),
      };
    }

    function buildSpiderSvg(scores) {
      const n   = AXES.length;
      const cx  = 160;
      const cy  = 160;
      const R   = 120; // max radius
      const pad = 30;  // label padding beyond R

      // Axes start at the top (−π/2) and go clockwise
      const angles = AXES.map((_, i) => (2 * Math.PI * i) / n - Math.PI / 2);

      // Background grid rings at 25 / 50 / 75 / 100 %
      const gridRings = [0.25, 0.5, 0.75, 1.0].map((frac) => {
        const pts = angles
          .map((a) => {
            const p = polarToCartesian(cx, cy, R * frac, a);
            return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
          })
          .join(' ');
        return `<polygon points="${pts}" fill="none" stroke="#2a3550" stroke-width="1"/>`;
      });

      // Axis lines
      const axisLines = angles.map((a) => {
        const p = polarToCartesian(cx, cy, R, a);
        return `<line x1="${cx}" y1="${cy}" x2="${p.x.toFixed(2)}" y2="${p.y.toFixed(2)}" stroke="#2a3550" stroke-width="1"/>`;
      });

      // Data polygon
      const dataPoints = AXES.map((key, i) => {
        const val = Math.min(100, Math.max(0, Number(scores[key] ?? 0)));
        const p   = polarToCartesian(cx, cy, R * (val / 100), angles[i]);
        return `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
      }).join(' ');

      // Labels and value ticks
      const labels = AXES.map((key, i) => {
        const a   = angles[i];
        const lp  = polarToCartesian(cx, cy, R + pad, a);
        const val = Math.min(100, Math.max(0, Number(scores[key] ?? 0)));
        const anchor = Math.cos(a) > 0.1 ? 'start' : Math.cos(a) < -0.1 ? 'end' : 'middle';
        return `<text x="${lp.x.toFixed(2)}" y="${lp.y.toFixed(2)}"
          text-anchor="${anchor}" dominant-baseline="middle"
          font-size="11" fill="#9fb0ce">${esc(AXIS_LABELS[key])} (${val})</text>`;
      });

      return `<svg viewBox="0 0 320 320" width="320" height="320" style="display:block;margin:0 auto;">
        ${gridRings.join('')}
        ${axisLines.join('')}
        <polygon points="${dataPoints}" fill="rgba(79,140,255,0.25)" stroke="#4f8cff" stroke-width="2"/>
        ${labels.join('')}
      </svg>`;
    }

    // ── Bar rows ─────────────────────────────────────────────────────────────

    function buildBarRows(scores) {
      return AXES.map((key) => {
        const val = Math.min(100, Math.max(0, Number(scores[key] ?? 0)));
        const hue = val >= 70 ? '#4f8cff' : val >= 40 ? '#f0b429' : '#e05c5c';
        return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span style="width:80px;font-size:12px;color:#9fb0ce;flex-shrink:0;">${esc(AXIS_LABELS[key])}</span>
          <div style="flex:1;background:#1a2235;border-radius:4px;height:10px;overflow:hidden;">
            <div style="width:${val}%;height:100%;background:${hue};border-radius:4px;transition:width .3s;"></div>
          </div>
          <span style="width:32px;text-align:right;font-size:12px;color:#e3efff;">${val}</span>
        </div>`;
      }).join('');
    }

    // ── Main panel ───────────────────────────────────────────────────────────

    class EmpireCategoriesPanel {
      constructor() {
        this.scores = null;
      }

      async loadData() {
        const res = await (api.getEmpireScores ? api.getEmpireScores() : Promise.resolve(null));
        this.scores = (res && res.success !== false) ? (res.scores || res) : null;
      }

      renderHtml() {
        const s = this.scores || {};
        const total = AXES.reduce((acc, k) => acc + Math.min(100, Math.max(0, Number(s[k] ?? 0))), 0);
        return `<div style="padding:16px;color:#c8d8f0;font-family:sans-serif;">
          <h3 style="margin:0 0 12px;color:#e3efff;font-size:16px;">Empire Category Scores</h3>
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
            <div style="flex:0 0 auto;">${buildSpiderSvg(s)}</div>
            <div style="flex:1;min-width:200px;">
              ${buildBarRows(s)}
              <div style="margin-top:12px;font-size:13px;color:#9fb0ce;">
                Total: <strong style="color:#e3efff;">${total}</strong> / 700
              </div>
            </div>
          </div>
        </div>`;
      }

      async render() {
        const root = wm.body('empire-categories');
        if (!root) return;
        root.innerHTML = uiKitSkeletonHTML();
        try {
          await this.loadData();
          root.innerHTML = this.renderHtml();
        } catch (err) {
          gameLog('warn', 'EmpireCategoriesPanel load failed', err);
          root.innerHTML = '<p style="color:#e05c5c;padding:16px;">Failed to load empire scores.</p>';
        }
      }
    }

    return new EmpireCategoriesPanel();
  }

  const api = {
    createEmpireCategoriesPanel,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeEmpireCategoriesPanel = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
