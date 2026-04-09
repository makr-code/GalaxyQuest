/**
 * GQNeighborWaypointOverlay.js
 *
 * Renders neighbor navigation waypoints as canvas-2D elements on top of the
 * Galaxy3DRenderer WebGL canvas, giving them the visual appearance of 3D
 * in-world markers.  Uses the renderer's getWorldScreenPosition() + THREE
 * camera.project() to track 3D world-space positions each animation frame.
 *
 * Supported views
 * ───────────────
 *  • System neighbor view  – waypoints placed in the direction of neighboring
 *    stars (computed from galaxy ly-coordinates, placed at a fixed radius from
 *    systemOrigin inside the Three.js scene).
 *  • Planet neighbor view  – waypoints placed at the mesh world-position of
 *    each neighboring planet inside renderer.systemPlanetEntries.
 *
 * Usage
 * ─────
 *  const overlay = GQNeighborWaypointOverlay.getOverlay();
 *  overlay.mount(rendererDomElement, () => window.galaxy3d);
 *  overlay.setSystemNeighbors(currentStar, neighbors, onSelect);
 *  overlay.setPlanetNeighbors(enrichedEntries, onSelect);
 *  overlay.setColonyNeighbors(currentColony, neighborEntries, onSelect);
 *  overlay.clear();
 *  overlay.activate(rank);   // programmatic click (e.g. keyboard 1/2/3)
 *  overlay.dispose();
 *
 * License: MIT — makr-code/GalaxyQuest
 */
(function (global) {
  'use strict';

  // ── Visual constants ────────────────────────────────────────────────────
  const RANK_STROKE = [
    'rgba(136,212,255,0.82)',
    'rgba(124,177,228,0.66)',
    'rgba(100,145,190,0.52)',
  ];
  const RANK_BG = [
    'rgba(12,38,64,0.90)',
    'rgba(16,32,54,0.86)',
    'rgba(17,28,46,0.83)',
  ];
  const RANK_TIP = [
    'rgba(92,177,234,0.96)',
    'rgba(78,144,206,0.92)',
    'rgba(67,120,172,0.90)',
  ];
  const LABEL_COLOR     = 'rgba(200,230,255,0.88)';
  const DIST_COLOR      = 'rgba(160,210,255,0.62)';
  const RANK_TEXT_COLOR = '#e4f4ff';
  const ACTIVE_PULSE_MS = 460;

  // ── Factory ──────────────────────────────────────────────────────────────
  function createNeighborWaypointOverlay() {
    let _canvas3d      = null;
    let _overlay       = null;
    let _ctx           = null;
    let _rafId         = null;
    let _getRenderer   = () => null;
    let _waypoints     = [];   // [{rank, label, dist, worldPos, onActivate}]
    let _hitAreas      = [];   // [{x, y, r, idx}]  for click detection
    let _hovered       = -1;
    let _resizeObs     = null;
    let _pulseIndex    = -1;
    let _pulseUntil    = 0;

    // ── Mount / size sync ────────────────────────────────────────────────

    /**
     * Mount an overlay <canvas> on top of canvas3d.
     * Idempotent — re-calling with the same canvas3d is a no-op.
     * Calling with a different canvas3d first disposes the old overlay.
     */
    function mount(canvas3d, getRendererFn) {
      if (!canvas3d) return;
      if (_canvas3d === canvas3d) return; // already mounted → no-op
      _teardown();

      _canvas3d    = canvas3d;
      _getRenderer = typeof getRendererFn === 'function' ? getRendererFn : () => null;

      _overlay = document.createElement('canvas');
      _overlay.style.cssText =
        'position:absolute;top:0;left:0;pointer-events:auto;z-index:5;border-radius:inherit;';

      const parent = canvas3d.parentElement;
      if (parent) {
        if (!parent.style.position || parent.style.position === 'static') {
          parent.style.position = 'relative';
        }
        parent.appendChild(_overlay);
      }

      _ctx = _overlay.getContext('2d');
      _overlay.addEventListener('click',      _onClick);
      _overlay.addEventListener('mousemove',  _onHover);
      _overlay.addEventListener('mouseleave', _onLeave);

      _syncSize();

      if (typeof ResizeObserver !== 'undefined') {
        _resizeObs = new ResizeObserver(_syncSize);
        _resizeObs.observe(_canvas3d);
      }

      _rafId = requestAnimationFrame(_loop);
    }

    function _syncSize() {
      if (!_overlay || !_canvas3d) return;
      const w = _canvas3d.clientWidth  || 800;
      const h = _canvas3d.clientHeight || 600;
      if (_overlay.width !== w || _overlay.height !== h) {
        _overlay.width  = w;
        _overlay.height = h;
        _overlay.style.width  = w + 'px';
        _overlay.style.height = h + 'px';
      }
    }

    // ── Waypoint setters ─────────────────────────────────────────────────

    /**
     * Arm system-neighbor waypoints.
     * World positions are derived from galaxy-space ly-coordinates relative to
     * the current star, placed at a fixed radius from renderer.systemOrigin.
     */
    function setSystemNeighbors(currentStar, neighbors, onSelect) {
      const T        = typeof window !== 'undefined' && window.THREE;
      const renderer = _getRenderer();
      if (!T || !renderer || !renderer.systemOrigin || !currentStar) {
        _waypoints = [];
        return;
      }

      _waypoints = (Array.isArray(neighbors) ? neighbors : [])
        .slice(0, 3)
        .map((nb, i) => {
          const dx = Number(nb.x_ly || 0) - Number(currentStar.x_ly || 0);
          const dy = Number(nb.y_ly || 0) - Number(currentStar.y_ly || 0);
          const dz = Number(nb.z_ly || 0) - Number(currentStar.z_ly || 0);
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
          // Three.js axes: X=galX, Y=galZ (disk up), Z=galY
          const dir = new T.Vector3(dx / len, dz / len * 0.42, dy / len).normalize();
          const worldPos = renderer.systemOrigin.clone().addScaledVector(dir, 280);
          return {
            rank: i + 1,
            label: String(nb.name || ('System ' + (nb.system_index || 0))),
            dist:  Number(nb.distance_ly || 0).toFixed(1) + ' ly',
            worldPos,
            onActivate: function () {
              if (typeof onSelect === 'function') onSelect(nb);
            },
          };
        });
    }

    /**
     * Arm planet-neighbor waypoints.
     * @param {Array<{slot, label, distText}>} neighborEntries  – enriched entries
     * @param {function} onSelect  – called with the entry when activated
     */
    function setPlanetNeighbors(neighborEntries, onSelect) {
      const T        = typeof window !== 'undefined' && window.THREE;
      const renderer = _getRenderer();
      if (!T || !renderer || !Array.isArray(neighborEntries)) {
        _waypoints = [];
        return;
      }

      const sysEntries = Array.isArray(renderer.systemPlanetEntries)
        ? renderer.systemPlanetEntries : [];

      _waypoints = neighborEntries.slice(0, 3).map((entry, i) => {
        const pos    = Number(entry.slot?.position || 0);
        const sys    = sysEntries.find((e) => Number(e.slot?.position || 0) === pos);
        if (!sys?.mesh) return null;
        return {
          rank: i + 1,
          label: String(entry.label || 'Pos ' + pos),
          dist:  String(entry.distText || ''),
          getWorldPos: function () {
            return sys.mesh.getWorldPosition(new T.Vector3());
          },
          onActivate: function () {
            if (typeof onSelect === 'function') onSelect(entry);
          },
        };
      }).filter(Boolean);
    }

    /**
     * Arm colony-neighbor waypoints.
     * Uses same-system planet mesh positions where available and falls back to
     * directional vectors around renderer.systemOrigin for cross-system targets.
     */
    function setColonyNeighbors(currentColony, neighborEntries, onSelect) {
      const T        = typeof window !== 'undefined' && window.THREE;
      const renderer = _getRenderer();
      if (!T || !renderer || !renderer.systemOrigin || !currentColony || !Array.isArray(neighborEntries)) {
        _waypoints = [];
        return;
      }

      const sysEntries = Array.isArray(renderer.systemPlanetEntries)
        ? renderer.systemPlanetEntries : [];

      _waypoints = neighborEntries.slice(0, 3).map((entry, i) => {
        const col = entry?.colony || null;
        if (!col) return null;

        const sameSystem = Number(col.galaxy || 0) === Number(currentColony.galaxy || 0)
          && Number(col.system || 0) === Number(currentColony.system || 0);

        const pos = Number(col.position || 0);
        const meshEntry = sameSystem
          ? sysEntries.find((e) => Number(e.slot?.position || 0) === pos)
          : null;

        let getWorldPos = null;
        if (meshEntry?.mesh) {
          getWorldPos = function () {
            return meshEntry.mesh.getWorldPosition(new T.Vector3());
          };
        } else {
          const dg = Number(col.galaxy || 0) - Number(currentColony.galaxy || 0);
          const ds = Number(col.system || 0) - Number(currentColony.system || 0);
          const dp = Number(col.position || 0) - Number(currentColony.position || 0);
          const dir = new T.Vector3((dg * 50) + (ds * 3), ds * 0.65, (dp * 2) + (ds * 0.6));
          if (dir.lengthSq() < 0.0001) dir.set((i + 1) * 0.7, 0.2, 1);
          dir.normalize();
          const staticPos = renderer.systemOrigin.clone().addScaledVector(dir, 225 + (i * 24));
          getWorldPos = function () {
            return staticPos;
          };
        }

        return {
          rank: i + 1,
          label: String(entry.label || 'Kolonie ' + Number(col.id || 0)),
          dist:  String(entry.distText || ''),
          getWorldPos,
          onActivate: function () {
            if (typeof onSelect === 'function') onSelect(entry);
          },
        };
      }).filter(Boolean);
    }

    function clear() {
      _waypoints = [];
      _hitAreas  = [];
      _pulseIndex = -1;
      _pulseUntil = 0;
    }

    function _nowMs() {
      return (typeof performance !== 'undefined' && typeof performance.now === 'function')
        ? performance.now()
        : Date.now();
    }

    function _triggerPulse(idx) {
      _pulseIndex = Number(idx);
      _pulseUntil = _nowMs() + ACTIVE_PULSE_MS;
    }

    function _pulseFor(idx) {
      if (idx !== _pulseIndex) return 0;
      const remain = _pulseUntil - _nowMs();
      if (remain <= 0) return 0;
      const t = remain / ACTIVE_PULSE_MS;
      return Math.max(0, Math.min(1, t));
    }

    function _activateByIndex(idx) {
      if (idx < 0 || idx >= _waypoints.length) return;
      _triggerPulse(idx);
      _waypoints[idx].onActivate();
    }

    /** Programmatically activate the waypoint with the given rank (1–3). */
    function activate(rank) {
      const idx = _waypoints.findIndex((w) => w.rank === Number(rank));
      _activateByIndex(idx);
    }

    // ── Render loop ──────────────────────────────────────────────────────

    function _loop() {
      _rafId = requestAnimationFrame(_loop);
      _draw();
    }

    function _draw() {
      if (!_ctx || !_overlay) return;
      _syncSize();
      const W = _overlay.width;
      const H = _overlay.height;
      _ctx.clearRect(0, 0, W, H);
      if (!_waypoints.length) return;

      const renderer = _getRenderer();
      if (!renderer || typeof renderer.getWorldScreenPosition !== 'function') return;
      if (!renderer.camera) return;

      _hitAreas = [];

      for (let i = 0; i < _waypoints.length; i++) {
        const wp = _waypoints[i];
        if (!wp) continue;
        const worldPos = typeof wp.getWorldPos === 'function'
          ? wp.getWorldPos()
          : wp.worldPos;
        if (!worldPos) continue;

        // Determine if the point is behind the camera (NDC z > 1).
        const proj = worldPos.clone().project(renderer.camera);
        const behindCam = proj.z > 1.0;

        // CSS-pixel screen coordinates from the renderer's own projection util.
        const scr = renderer.getWorldScreenPosition(worldPos);
        if (!scr) continue;

        const MARGIN = 48;
        // Clamp to a MARGIN-wide safe zone inside the canvas.
        const clampX = Math.max(MARGIN, Math.min(W - MARGIN, scr.x));
        const clampY = Math.max(MARGIN, Math.min(H - MARGIN, scr.y));
        const clamped = (clampX !== scr.x || clampY !== scr.y);

        if (!behindCam && !clamped) {
          _drawBadge(clampX, clampY, wp, i);
        } else {
          // For behind-camera targets: mirror the projected position so the
          // edge arrow still points in the correct cardinal direction.
          const arrX = behindCam
            ? Math.max(MARGIN, Math.min(W - MARGIN, W - scr.x))
            : clampX;
          const arrY = behindCam
            ? Math.max(MARGIN, Math.min(H - MARGIN, H - scr.y))
            : clampY;
          _drawEdgeArrow(arrX, arrY, scr.x, scr.y, W, H, wp, i);
        }
      }
    }

    // ── Drawing helpers ──────────────────────────────────────────────────

    function _drawBadge(cx, cy, wp, idx) {
      const ri  = wp.rank - 1;
      const hov = idx === _hovered;
      const pulse = _pulseFor(idx);
      const R   = (hov ? 30 : 24) + (pulse * 6);
      const ctx = _ctx;

      ctx.save();

      // Glow aura
      const auraR = R + 18 + (pulse * 10);
      const grd = ctx.createRadialGradient(cx, cy, R - 6, cx, cy, auraR);
      grd.addColorStop(0, RANK_STROKE[ri]);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
      ctx.fillStyle = grd;
      ctx.fill();

      if (pulse > 0.01) {
        ctx.beginPath();
        ctx.arc(cx, cy, R + 12 + (pulse * 12), 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(170,225,255,${(0.20 + pulse * 0.45).toFixed(3)})`;
        ctx.stroke();
      }

      // Outer ring
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.lineWidth  = 2 + (pulse * 0.9);
      ctx.strokeStyle = RANK_STROKE[ri];
      ctx.stroke();

      // Inner fill
      ctx.beginPath();
      ctx.arc(cx, cy, R - 4, 0, Math.PI * 2);
      ctx.fillStyle  = RANK_BG[ri];
      ctx.fill();
      ctx.lineWidth  = 1.5;
      ctx.strokeStyle = RANK_STROKE[ri];
      ctx.stroke();

      // Rank numeral
      ctx.fillStyle    = RANK_TEXT_COLOR;
      ctx.font         = 'bold ' + (hov ? 15 : 13) + 'px system-ui, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(wp.rank), cx, cy);

      // Name label
      ctx.font         = '10px system-ui, sans-serif';
      ctx.fillStyle    = LABEL_COLOR;
      ctx.textBaseline = 'top';
      ctx.fillText(wp.label, cx, cy + R + 6);

      // Distance
      if (wp.dist) {
        ctx.font      = '9px monospace';
        ctx.fillStyle = DIST_COLOR;
        ctx.fillText(wp.dist, cx, cy + R + 19);
      }

      ctx.restore();
      _hitAreas.push({ x: cx, y: cy, r: R + 18, idx });
    }

    function _drawEdgeArrow(cx, cy, tx, ty, W, H, wp, idx) {
      const ri  = wp.rank - 1;
      const hov = idx === _hovered;
      const pulse = _pulseFor(idx);
      const sz  = (hov ? 20 : 16) + (pulse * 3);
      const tip = sz * 1.8;
      const ctx = _ctx;
      // Bearing from screen center toward the (possibly off-screen) target.
      const angle = Math.atan2(ty - H / 2, tx - W / 2);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle + Math.PI / 2);

      // Arrow triangle (tip points in bearing direction)
      ctx.beginPath();
      ctx.moveTo(0,      -tip / 2);
      ctx.lineTo(-sz / 2, tip / 2);
      ctx.lineTo( sz / 2, tip / 2);
      ctx.closePath();
      ctx.fillStyle  = RANK_TIP[ri];
      ctx.fill();
      ctx.lineWidth   = 1.5 + (pulse * 0.8);
      ctx.strokeStyle = RANK_STROKE[ri];
      ctx.stroke();

      if (pulse > 0.01) {
        ctx.beginPath();
        ctx.moveTo(0,      -tip / 2 - (pulse * 3));
        ctx.lineTo(-sz / 2 - (pulse * 2), tip / 2 + (pulse * 2));
        ctx.lineTo( sz / 2 + (pulse * 2), tip / 2 + (pulse * 2));
        ctx.closePath();
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(170,225,255,${(0.18 + pulse * 0.42).toFixed(3)})`;
        ctx.stroke();
      }

      // Rank numeral (un-rotated so it always reads horizontally).
      ctx.rotate(-(angle + Math.PI / 2));
      ctx.fillStyle    = '#ffffff';
      ctx.font         = 'bold ' + (sz < 19 ? 10 : 12) + 'px system-ui, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(wp.rank), 0, 0);

      ctx.restore();

      // Label next to the edge arrow
      ctx.save();
      const onLeft  = cx < W / 2;
      ctx.textAlign    = onLeft ? 'left' : 'right';
      ctx.textBaseline = 'middle';
      const labelOffX  = onLeft ? tip + 6 : -(tip + 6);

      ctx.font      = '9px system-ui, sans-serif';
      ctx.fillStyle = LABEL_COLOR;
      ctx.fillText(wp.label, cx + labelOffX, cy);

      if (wp.dist) {
        ctx.font      = '8px monospace';
        ctx.fillStyle = DIST_COLOR;
        ctx.fillText(wp.dist, cx + labelOffX, cy + 12);
      }
      ctx.restore();

      _hitAreas.push({ x: cx, y: cy, r: sz + 10, idx });
    }

    // ── Events ───────────────────────────────────────────────────────────

    function _hitTest(ev) {
      if (!_overlay) return -1;
      const rect = _overlay.getBoundingClientRect();
      const mx   = ev.clientX - rect.left;
      const my   = ev.clientY - rect.top;
      for (let i = 0; i < _hitAreas.length; i++) {
        const ha = _hitAreas[i];
        const dx = mx - ha.x;
        const dy = my - ha.y;
        if (dx * dx + dy * dy <= ha.r * ha.r) return ha.idx;
      }
      return -1;
    }

    function _onClick(ev) {
      const idx = _hitTest(ev);
      if (idx < 0 || idx >= _waypoints.length) return;
      ev.stopPropagation();
      _activateByIndex(idx);
    }

    function _onHover(ev) {
      const idx = _hitTest(ev);
      if (idx !== _hovered) {
        _hovered = idx;
        if (_overlay) _overlay.style.cursor = idx >= 0 ? 'pointer' : '';
      }
    }

    function _onLeave() {
      _hovered = -1;
    }

    // ── Cleanup ──────────────────────────────────────────────────────────

    function _teardown() {
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
      if (_overlay) {
        _overlay.removeEventListener('click',      _onClick);
        _overlay.removeEventListener('mousemove',  _onHover);
        _overlay.removeEventListener('mouseleave', _onLeave);
        _overlay.parentElement?.removeChild(_overlay);
        _overlay = null;
      }
      _ctx      = null;
      _canvas3d = null;
      _waypoints = [];
      _hitAreas  = [];
      _pulseIndex = -1;
      _pulseUntil = 0;
    }

    return {
      mount,
      setSystemNeighbors,
      setPlanetNeighbors,
      setColonyNeighbors,
      clear,
      activate,
      dispose: _teardown,
    };
  }

  // ── Module-level singleton ───────────────────────────────────────────────
  let _instance = null;

  function getOverlay() {
    if (!_instance) _instance = createNeighborWaypointOverlay();
    return _instance;
  }

  // ── Export ───────────────────────────────────────────────────────────────
  global.GQNeighborWaypointOverlay = { createNeighborWaypointOverlay, getOverlay };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.GQNeighborWaypointOverlay;
  }
})(typeof window !== 'undefined' ? window : globalThis);
