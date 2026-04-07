/**
 * RuntimeGalaxyNavOrb.js
 *
 * Encapsulates the galaxy nav orb canvas, tuning and slider bindings.
 */

'use strict';

(function () {
  const state = {
    windowRef: null,
    documentRef: null,
    getUiState: null,
    getSettingsState: null,
    getGalaxy3d: null,
    getGalaxyRoot: null,
    isSystemModeActive: null,
    triggerNavAction: null,
    showToast: null,
  };

  function configureGalaxyNavOrbRuntime(opts = {}) {
    state.windowRef = opts.windowRef || window;
    state.documentRef = opts.documentRef || document;
    state.getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : null;
    state.getSettingsState = typeof opts.getSettingsState === 'function' ? opts.getSettingsState : null;
    state.getGalaxy3d = typeof opts.getGalaxy3d === 'function' ? opts.getGalaxy3d : null;
    state.getGalaxyRoot = typeof opts.getGalaxyRoot === 'function' ? opts.getGalaxyRoot : null;
    state.isSystemModeActive = typeof opts.isSystemModeActive === 'function' ? opts.isSystemModeActive : null;
    state.triggerNavAction = typeof opts.triggerNavAction === 'function' ? opts.triggerNavAction : null;
    state.showToast = typeof opts.showToast === 'function' ? opts.showToast : null;
  }

  function bindGalaxyNavOrb(root, bindRepeatButton) {
    const overlay = root?.querySelector('#galaxy-nav-orb-overlay');
    if (!overlay || overlay.dataset.bound === '1') return;
    overlay.dataset.bound = '1';
    const actionRoot = (typeof state.getGalaxyRoot === 'function' ? state.getGalaxyRoot() : null) || root;

    overlay.querySelectorAll('[data-nav-action]').forEach((button) => {
      if (typeof bindRepeatButton === 'function') {
        bindRepeatButton(button, actionRoot);
      }
    });

    const canvas = overlay.querySelector('#galaxy-nav-gizmo');
    const modeBadge = overlay.querySelector('#galaxy-nav-mode-badge');
    const zoomSlider = overlay.querySelector('#gal-nav-zoom-slider');
    const zoomValue = overlay.querySelector('#gal-nav-zoom-value');
    const fovSlider = overlay.querySelector('#gal-nav-fov-slider');
    const fovValue = overlay.querySelector('#gal-nav-fov-value');
    const debugToggle = overlay.querySelector('#gal-nav-debug-toggle');
    const snapToggle = overlay.querySelector('#gal-nav-snap-toggle');
    const holdRateSlider = overlay.querySelector('#gal-nav-hold-rate-slider');
    const holdRateValue = overlay.querySelector('#gal-nav-hold-rate-value');
    const rollSpeedSlider = overlay.querySelector('#gal-nav-roll-speed-slider');
    const rollSpeedValue = overlay.querySelector('#gal-nav-roll-speed-value');
    const zoomCurveSlider = overlay.querySelector('#gal-nav-zoom-curve-slider');
    const zoomCurveValue = overlay.querySelector('#gal-nav-zoom-curve-value');
    const fovCurveSlider = overlay.querySelector('#gal-nav-fov-curve-slider');
    const fovCurveValue = overlay.querySelector('#gal-nav-fov-curve-value');
    const presetButtons = Array.from(overlay.querySelectorAll('[data-nav-preset]'));

    const uiState = typeof state.getUiState === 'function' ? state.getUiState() : {};
    const settingsState = typeof state.getSettingsState === 'function' ? state.getSettingsState() : {};

    const navOrbTuning = uiState.navOrbTuning || (uiState.navOrbTuning = {
      debugHitZones: false,
      snapOnDoubleClick: true,
      holdRateMs: 100,
      holdDelayMs: 170,
      rollStepRad: 0.052,
      zoomCurveExp: 1,
      fovCurveExp: 1,
      preset: 'balanced',
    });

    const NAV_ORB_PRESETS = {
      precise: {
        holdRateMs: 145,
        holdDelayMs: 220,
        rollStepRad: 0.03,
        zoomCurveExp: 1.35,
        fovCurveExp: 1.2,
      },
      balanced: {
        holdRateMs: 100,
        holdDelayMs: 170,
        rollStepRad: 0.052,
        zoomCurveExp: 1,
        fovCurveExp: 1,
      },
      cinematic: {
        holdRateMs: 132,
        holdDelayMs: 210,
        rollStepRad: 0.038,
        zoomCurveExp: 1.6,
        fovCurveExp: 1.45,
      },
      fast: {
        holdRateMs: 62,
        holdDelayMs: 110,
        rollStepRad: 0.085,
        zoomCurveExp: 0.8,
        fovCurveExp: 0.82,
      },
      planet_inspect: {
        holdRateMs: 152,
        holdDelayMs: 230,
        rollStepRad: 0.024,
        zoomCurveExp: 1.85,
        fovCurveExp: 1.72,
      },
      galaxy_sweep: {
        holdRateMs: 56,
        holdDelayMs: 90,
        rollStepRad: 0.102,
        zoomCurveExp: 0.68,
        fovCurveExp: 0.7,
      },
    };

    const NAV_ORB_PRESET_LABELS = {
      precise: 'Precise',
      balanced: 'Balanced',
      cinematic: 'Cinematic',
      fast: 'Fast',
      planet_inspect: 'Planet Inspect',
      galaxy_sweep: 'Galaxy Sweep',
      custom: 'Custom',
    };

    let hoverAction = null;

    const readMode = () => {
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      const inSystem = typeof state.isSystemModeActive === 'function' ? state.isSystemModeActive() : false;
      const hasPlanet = !!(galaxy3d?.systemSelectedEntry || uiState?.activePlanet);
      const hasInfra = !!state.windowRef?._GQ_ftl_map?.success;
      const shipsOn = settingsState.galaxyFleetVectorsVisible !== false;
      if (hasPlanet) return { key: 'planet', label: 'PLANET' };
      if (inSystem && hasInfra && shipsOn) return { key: 'system-plus', label: 'SYSTEM+' };
      if (inSystem) return { key: 'system', label: 'SYSTEM' };
      if (hasInfra && shipsOn) return { key: 'infrastructure', label: 'INFRA+SHIPS' };
      if (hasInfra) return { key: 'infrastructure', label: 'INFRA' };
      if (shipsOn) return { key: 'ships', label: 'SHIPS' };
      return { key: 'galaxy', label: 'GALAXY' };
    };

    const applyModeStyle = () => {
      const mode = readMode();
      overlay.dataset.navMode = mode.key;
      if (modeBadge) {
        modeBadge.textContent = mode.label;
        modeBadge.className = `galaxy-nav-mode-badge is-${mode.key}`;
      }
    };

    const getCameraBasis = () => {
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      const cam = galaxy3d?.camera;
      const three = state.windowRef.THREE;
      if (!cam || !cam.quaternion || !three?.Vector3) {
        return null;
      }
      const right = new three.Vector3(1, 0, 0).applyQuaternion(cam.quaternion).normalize();
      const up = new three.Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
      const forward = new three.Vector3(0, 0, -1).applyQuaternion(cam.quaternion).normalize();
      return { right, up, forward };
    };

    const projectWorldAxis = (axis, basis) => {
      if (!basis || !axis || typeof axis.dot !== 'function') {
        return { x: 0, y: 0, depth: 0 };
      }
      return {
        x: axis.dot(basis.right),
        y: axis.dot(basis.up),
        depth: axis.dot(basis.forward),
      };
    };

    const NAV_RING_RADIUS = 58;
    const NAV_RING_SAMPLES = 72;
    const NAV_RING_HIT_TOLERANCE = 9;

    const buildPlaneRingPoints = (normalVec, basis, cx, cy, radius, samples = NAV_RING_SAMPLES) => {
      const three = state.windowRef.THREE;
      if (!three?.Vector3 || !basis || !normalVec) {
        const fallback = [];
        for (let i = 0; i <= samples; i += 1) {
          const t = (i / samples) * Math.PI * 2;
          fallback.push({ x: cx + Math.cos(t) * radius, y: cy + Math.sin(t) * radius });
        }
        return fallback;
      }

      const n = normalVec.clone().normalize();
      const ref = Math.abs(n.z) < 0.9 ? new state.windowRef.THREE.Vector3(0, 0, 1) : new state.windowRef.THREE.Vector3(0, 1, 0);
      const u = new state.windowRef.THREE.Vector3().crossVectors(n, ref).normalize();
      const v = new state.windowRef.THREE.Vector3().crossVectors(n, u).normalize();
      const points = [];

      for (let i = 0; i <= samples; i += 1) {
        const t = (i / samples) * Math.PI * 2;
        const p = u.clone().multiplyScalar(Math.cos(t)).add(v.clone().multiplyScalar(Math.sin(t)));
        points.push({
          x: cx + (p.dot(basis.right) * radius),
          y: cy - (p.dot(basis.up) * radius),
        });
      }

      return points;
    };

    const drawPolyline = (ctx, points) => {
      if (!Array.isArray(points) || !points.length) return;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i].x, points[i].y);
      }
      ctx.stroke();
    };

    const pointSegmentDistance = (px, py, ax, ay, bx, by) => {
      const abx = bx - ax;
      const aby = by - ay;
      const apx = px - ax;
      const apy = py - ay;
      const abLenSq = (abx * abx) + (aby * aby);
      if (abLenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
      const t = Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLenSq));
      const cx = ax + (abx * t);
      const cy = ay + (aby * t);
      return Math.hypot(px - cx, py - cy);
    };

    const ringHitDistance = (px, py, points) => {
      if (!Array.isArray(points) || points.length < 2) return Number.POSITIVE_INFINITY;
      let minDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i];
        const b = points[i + 1];
        minDist = Math.min(minDist, pointSegmentDistance(px, py, a.x, a.y, b.x, b.y));
      }
      return minDist;
    };

    const nearestPointIndex = (px, py, points) => {
      if (!Array.isArray(points) || !points.length) return -1;
      let idx = -1;
      let minDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i += 1) {
        const p = points[i];
        const d = Math.hypot(px - p.x, py - p.y);
        if (d < minDist) {
          minDist = d;
          idx = i;
        }
      }
      return idx;
    };

    const drawGizmo = (nowMs = (state.windowRef.performance?.now?.() || 0)) => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const cx = w * 0.5;
      const cy = h * 0.5;

      const mode = readMode();
      const pulse = 0.72 + (Math.sin(nowMs * 0.0034) * 0.28);
      const modeGlow = {
        galaxy: 'rgba(52, 104, 170, 0.24)',
        system: 'rgba(90, 170, 225, 0.24)',
        'system-plus': 'rgba(72, 204, 171, 0.24)',
        planet: 'rgba(122, 211, 140, 0.24)',
        infrastructure: 'rgba(230, 172, 90, 0.24)',
        ships: 'rgba(214, 130, 232, 0.24)',
      }[mode.key] || 'rgba(52, 104, 170, 0.24)';

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(9, 20, 38, 0.95)';
      ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(cx, cy, 16, cx, cy, 130);
      g.addColorStop(0, modeGlow);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const basis = getCameraBasis();
      const three = state.windowRef.THREE;
      const axes = three?.Vector3
        ? {
            X: projectWorldAxis(new state.windowRef.THREE.Vector3(1, 0, 0), basis),
            Y: projectWorldAxis(new state.windowRef.THREE.Vector3(0, 1, 0), basis),
            Z: projectWorldAxis(new state.windowRef.THREE.Vector3(0, 0, 1), basis),
          }
        : {
            X: { x: 1, y: 0, depth: 0 },
            Y: { x: 0, y: 1, depth: 0 },
            Z: { x: -0.78, y: -0.62, depth: 0 },
          };

      const drawArrow = (x1, y1, x2, y2, color, label, depth = 0) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / len;
        const uy = dy / len;
        const hx = x2 - ux * 10;
        const hy = y2 - uy * 10;
        const nx = -uy;
        const ny = ux;

        const alpha = Math.max(0.42, Math.min(1, 0.72 + depth * 0.42));
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = hoverAction && hoverAction.includes(`translate-${label.toLowerCase()}`) ? 4 : 3;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(hx + nx * 6, hy + ny * 6);
        ctx.lineTo(hx - nx * 6, hy - ny * 6);
        ctx.closePath();
        ctx.fill();

        ctx.font = '12px Consolas, Menlo, Monaco, monospace';
        ctx.fillText(label, x2 + nx * 10, y2 + ny * 10);
        ctx.globalAlpha = 1;
      };

      const arrowLen = 76;
      const ex = axes.X;
      const ey = axes.Y;
      const ez = axes.Z;
      drawArrow(cx, cy, cx + ex.x * arrowLen, cy - ex.y * arrowLen, '#ff6262', 'X', ex.depth);
      drawArrow(cx, cy, cx + ey.x * arrowLen, cy - ey.y * arrowLen, '#6dff99', 'Y', ey.depth);
      drawArrow(cx, cy, cx + ez.x * arrowLen, cy - ez.y * arrowLen, '#69b5ff', 'Z', ez.depth);

      const ringDefs = (three?.Vector3 && basis)
        ? [
            { key: 'u', label: 'U', color: 'rgba(255, 200, 120, 0.95)', normal: new state.windowRef.THREE.Vector3(0, 0, 1), axisProj: ez },
            { key: 'v', label: 'V', color: 'rgba(130, 255, 225, 0.95)', normal: new state.windowRef.THREE.Vector3(0, 1, 0), axisProj: ey },
            { key: 'w', label: 'W', color: 'rgba(222, 160, 255, 0.95)', normal: new state.windowRef.THREE.Vector3(1, 0, 0), axisProj: ex },
          ]
        : [];

      ringDefs.forEach((ring, idx) => {
        const pts = buildPlaneRingPoints(ring.normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
        const highlight = hoverAction && hoverAction.startsWith(`rotate-${ring.key}`);
        const facing = Number(basis ? ring.normal.dot(basis.forward) : 0);
        const plusIdx = Math.max(0, Math.min(pts.length - 1, facing < 0 ? Math.floor((pts.length - 1) * 0.5) : 0));
        const minusIdx = Math.max(0, Math.min(pts.length - 1, facing < 0 ? 0 : Math.floor((pts.length - 1) * 0.5)));
        ctx.strokeStyle = ring.color;
        ctx.globalAlpha = 0.5 + (pulse * 0.22);
        ctx.lineWidth = highlight ? 3.4 : 2.2;
        drawPolyline(ctx, pts);

        const labelIdx = Math.floor(((idx + 1) / 4) * (pts.length - 1));
        const lp = pts[Math.max(0, Math.min(pts.length - 1, labelIdx))];
        ctx.globalAlpha = highlight ? 1 : (0.82 + pulse * 0.1);
        ctx.fillStyle = ring.color;
        ctx.font = '12px Consolas, Menlo, Monaco, monospace';
        const tx = (lp?.x || cx) + ((ring.axisProj?.x || 0) * 8);
        const ty = (lp?.y || cy) - ((ring.axisProj?.y || 0) * 8);
        ctx.fillText(ring.label, tx, ty);

        const pPlus = pts[plusIdx] || { x: cx, y: cy };
        const pMinus = pts[minusIdx] || { x: cx, y: cy };
        ctx.globalAlpha = highlight ? 1 : 0.88;
        ctx.fillStyle = 'rgba(214, 242, 255, 0.95)';
        ctx.font = '10px Consolas, Menlo, Monaco, monospace';
        ctx.fillText('+', pPlus.x + 3, pPlus.y - 3);
        ctx.fillText('-', pMinus.x + 3, pMinus.y - 3);
        ctx.globalAlpha = 1;
      });

      if (navOrbTuning.debugHitZones) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 10; i += 1) {
          const p = Math.round((w / 10) * i) + 0.5;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, h);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(w, p);
          ctx.stroke();
        }

        if (state.windowRef.THREE?.Vector3 && basis) {
          [
            new state.windowRef.THREE.Vector3(0, 0, 1),
            new state.windowRef.THREE.Vector3(0, 1, 0),
            new state.windowRef.THREE.Vector3(1, 0, 0),
          ].forEach((normal) => {
            const pts = buildPlaneRingPoints(normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
            ctx.strokeStyle = 'rgba(255,255,255,0.34)';
            ctx.lineWidth = 1;
            drawPolyline(ctx, pts);
          });
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(w, cy);
        ctx.stroke();

        if (hoverAction) {
          ctx.fillStyle = 'rgba(0,0,0,0.62)';
          ctx.fillRect(8, 8, 165, 18);
          ctx.fillStyle = 'rgba(196, 232, 255, 0.98)';
          ctx.font = '11px Consolas, Menlo, Monaco, monospace';
          ctx.fillText(`Zone: ${hoverAction}`, 12, 20);
        }
      }

      ctx.fillStyle = 'rgba(220, 235, 255, 0.95)';
      ctx.font = '11px Consolas, Menlo, Monaco, monospace';
      ctx.fillText('Klick + ziehen: Translation / Rotation', 10, h - 16);
    };

    const getActionFromCanvasPoint = (x, y) => {
      if (!canvas) return null;
      const cx = canvas.width * 0.5;
      const cy = canvas.height * 0.5;
      const dx = x - cx;
      const dy = y - cy;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const basis = getCameraBasis();
      const three = state.windowRef.THREE;

      if (three?.Vector3 && basis) {
        const ringDefs = [
          { key: 'u', normal: new state.windowRef.THREE.Vector3(0, 0, 1) },
          { key: 'v', normal: new state.windowRef.THREE.Vector3(0, 1, 0) },
          { key: 'w', normal: new state.windowRef.THREE.Vector3(1, 0, 0) },
        ];

        let best = null;
        ringDefs.forEach((ring) => {
          const pts = buildPlaneRingPoints(ring.normal, basis, cx, cy, NAV_RING_RADIUS, NAV_RING_SAMPLES);
          const dist = ringHitDistance(x, y, pts);
          if (!best || dist < best.dist) {
            best = { key: ring.key, normal: ring.normal, points: pts, dist };
          }
        });

        if (best && best.dist <= NAV_RING_HIT_TOLERANCE) {
          const idx = nearestPointIndex(x, y, best.points);
          const segCount = Math.max(1, best.points.length - 1);
          const phase = idx >= 0 ? ((idx / segCount) * Math.PI * 2) : 0;
          let plus = Math.cos(phase) >= 0;
          const facing = Number(best.normal?.dot?.(basis.forward) || 0);
          if (facing < 0) plus = !plus;
          return `rotate-${best.key}-${plus ? 'plus' : 'minus'}`;
        }
      }

      if (ax > ay * 1.2) return dx >= 0 ? 'translate-x-plus' : 'translate-x-minus';
      if (ay > ax * 1.2) return dy <= 0 ? 'translate-y-plus' : 'translate-y-minus';
      return dy <= 0 ? 'translate-z-plus' : 'translate-z-minus';
    };

    if (canvas) {
      drawGizmo();
      let holdTimer = null;
      let holdStartTimer = null;
      let activeAction = null;

      const stopCanvasHold = () => {
        if (holdStartTimer) {
          state.windowRef.clearTimeout(holdStartTimer);
          holdStartTimer = null;
        }
        if (holdTimer) {
          state.windowRef.clearInterval(holdTimer);
          holdTimer = null;
        }
        activeAction = null;
        canvas?.classList?.remove('is-hovering');
      };

      const eventPos = (ev) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((ev.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
          y: ((ev.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
        };
      };

      const startCanvasHold = (action) => {
        if (!action) return;
        activeAction = action;
        if (typeof state.triggerNavAction === 'function') {
          state.triggerNavAction(action, actionRoot);
        }
        if (holdTimer) state.windowRef.clearInterval(holdTimer);
        holdTimer = state.windowRef.setInterval(() => {
          if (!activeAction || typeof state.triggerNavAction !== 'function') return;
          state.triggerNavAction(activeAction, actionRoot);
        }, Math.max(35, Number(navOrbTuning.holdRateMs || 100)));
      };

      canvas.addEventListener('pointerdown', (ev) => {
        ev.preventDefault();
        canvas.setPointerCapture?.(ev.pointerId);
        const pos = eventPos(ev);
        const action = getActionFromCanvasPoint(pos.x, pos.y);
        hoverAction = action;
        canvas.classList.add('is-hovering');
        drawGizmo();
        if (holdStartTimer) state.windowRef.clearTimeout(holdStartTimer);
        holdStartTimer = state.windowRef.setTimeout(() => {
          holdStartTimer = null;
          startCanvasHold(action);
        }, Math.max(0, Number(navOrbTuning.holdDelayMs || 170)));
      });

      canvas.addEventListener('pointermove', (ev) => {
        const pos = eventPos(ev);
        const nextAction = getActionFromCanvasPoint(pos.x, pos.y);
        hoverAction = nextAction;
        if (activeAction) activeAction = nextAction || activeAction;
        if (navOrbTuning.debugHitZones) drawGizmo();
      });

      canvas.addEventListener('dblclick', (ev) => {
        ev.preventDefault();
        if (!navOrbTuning.snapOnDoubleClick || typeof state.triggerNavAction !== 'function') return;
        state.triggerNavAction('reset', actionRoot);
      });

      canvas.addEventListener('pointerup', stopCanvasHold);
      canvas.addEventListener('pointercancel', stopCanvasHold);
      canvas.addEventListener('lostpointercapture', stopCanvasHold);
      canvas.addEventListener('pointerleave', () => {
        hoverAction = null;
        canvas.classList.remove('is-hovering');
        if (navOrbTuning.debugHitZones) drawGizmo();
      });
    }

    const syncSlidersFromRenderer = () => {
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      applyModeStyle();
      if (!galaxy3d) return;
      const zoomNorm = typeof galaxy3d.getZoomNorm === 'function' ? Number(galaxy3d.getZoomNorm()) : null;
      const fovDeg = typeof galaxy3d.getFov === 'function' ? Number(galaxy3d.getFov()) : null;
      const zCurve = Math.max(0.25, Number(navOrbTuning.zoomCurveExp || 1));
      const fCurve = Math.max(0.25, Number(navOrbTuning.fovCurveExp || 1));

      if (zoomSlider && Number.isFinite(zoomNorm)) {
        const linearT = Math.pow(Math.max(0, Math.min(1, zoomNorm)), 1 / zCurve);
        const pct = Math.round(linearT * 100);
        zoomSlider.value = String(pct);
        if (zoomValue) zoomValue.textContent = `${pct}%`;
      }
      if (fovSlider && Number.isFinite(fovDeg)) {
        const minFov = 25;
        const maxFov = 100;
        const fovT = (Math.max(minFov, Math.min(maxFov, fovDeg)) - minFov) / (maxFov - minFov);
        const linearT = Math.pow(Math.max(0, Math.min(1, fovT)), 1 / fCurve);
        const degLinear = Math.round(minFov + linearT * (maxFov - minFov));
        fovSlider.value = String(degLinear);
        if (fovValue) fovValue.textContent = `${Math.round(fovDeg)}°`;
      }
    };

    const syncTuningUi = () => {
      if (debugToggle) debugToggle.checked = !!navOrbTuning.debugHitZones;
      if (snapToggle) snapToggle.checked = !!navOrbTuning.snapOnDoubleClick;
      if (holdRateSlider) holdRateSlider.value = String(Math.round(Math.max(40, Math.min(220, Number(navOrbTuning.holdRateMs || 100)))));
      if (holdRateValue) holdRateValue.textContent = `${Math.round(Math.max(40, Math.min(220, Number(navOrbTuning.holdRateMs || 100))))}ms`;
      const rollDeg = Math.max(1, Math.min(12, Math.round((Number(navOrbTuning.rollStepRad || 0.052) * 180) / Math.PI)));
      if (rollSpeedSlider) rollSpeedSlider.value = String(rollDeg);
      if (rollSpeedValue) rollSpeedValue.textContent = `${rollDeg}°`;
      const zCurveUi = Math.max(50, Math.min(240, Math.round(Number(navOrbTuning.zoomCurveExp || 1) * 100)));
      const fCurveUi = Math.max(50, Math.min(240, Math.round(Number(navOrbTuning.fovCurveExp || 1) * 100)));
      if (zoomCurveSlider) zoomCurveSlider.value = String(zCurveUi);
      if (zoomCurveValue) zoomCurveValue.textContent = `${(zCurveUi / 100).toFixed(2)}`;
      if (fovCurveSlider) fovCurveSlider.value = String(fCurveUi);
      if (fovCurveValue) fovCurveValue.textContent = `${(fCurveUi / 100).toFixed(2)}`;
      presetButtons.forEach((btn) => {
        const key = String(btn.getAttribute('data-nav-preset') || '');
        btn.classList.toggle('active', key === String(navOrbTuning.preset || 'balanced'));
      });
    };

    const applyPreset = (presetKey) => {
      const key = String(presetKey || 'balanced').toLowerCase();
      const preset = NAV_ORB_PRESETS[key];
      if (!preset) return;
      navOrbTuning.preset = key;
      navOrbTuning.holdRateMs = preset.holdRateMs;
      navOrbTuning.holdDelayMs = preset.holdDelayMs;
      navOrbTuning.rollStepRad = preset.rollStepRad;
      navOrbTuning.zoomCurveExp = preset.zoomCurveExp;
      navOrbTuning.fovCurveExp = preset.fovCurveExp;
      syncTuningUi();
      syncSlidersFromRenderer();
      if (typeof state.showToast === 'function') {
        state.showToast(`Nav-Preset: ${NAV_ORB_PRESET_LABELS[key] || key}`, 'info');
      }
    };

    debugToggle?.addEventListener('change', () => {
      navOrbTuning.debugHitZones = !!debugToggle.checked;
      drawGizmo();
    });

    snapToggle?.addEventListener('change', () => {
      navOrbTuning.snapOnDoubleClick = !!snapToggle.checked;
    });

    holdRateSlider?.addEventListener('input', () => {
      const ms = Math.max(40, Math.min(220, Number(holdRateSlider.value || 100)));
      navOrbTuning.holdRateMs = ms;
      navOrbTuning.preset = 'custom';
      if (holdRateValue) holdRateValue.textContent = `${Math.round(ms)}ms`;
      syncTuningUi();
    });

    rollSpeedSlider?.addEventListener('input', () => {
      const deg = Math.max(1, Math.min(12, Number(rollSpeedSlider.value || 3)));
      navOrbTuning.rollStepRad = (deg * Math.PI) / 180;
      navOrbTuning.preset = 'custom';
      if (rollSpeedValue) rollSpeedValue.textContent = `${Math.round(deg)}°`;
      syncTuningUi();
    });

    zoomCurveSlider?.addEventListener('input', () => {
      const curve = Math.max(0.5, Math.min(2.4, Number(zoomCurveSlider.value || 100) / 100));
      navOrbTuning.zoomCurveExp = curve;
      navOrbTuning.preset = 'custom';
      if (zoomCurveValue) zoomCurveValue.textContent = curve.toFixed(2);
      syncSlidersFromRenderer();
      syncTuningUi();
    });

    fovCurveSlider?.addEventListener('input', () => {
      const curve = Math.max(0.5, Math.min(2.4, Number(fovCurveSlider.value || 100) / 100));
      navOrbTuning.fovCurveExp = curve;
      navOrbTuning.preset = 'custom';
      if (fovCurveValue) fovCurveValue.textContent = curve.toFixed(2);
      syncSlidersFromRenderer();
      syncTuningUi();
    });

    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyPreset(String(btn.getAttribute('data-nav-preset') || 'balanced'));
      });
    });

    zoomSlider?.addEventListener('input', () => {
      const pct = Math.max(0, Math.min(100, Number(zoomSlider.value || 0)));
      if (zoomValue) zoomValue.textContent = `${Math.round(pct)}%`;
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      if (!galaxy3d) return;
      if (typeof galaxy3d.setZoomNorm === 'function') {
        const curve = Math.max(0.25, Number(navOrbTuning.zoomCurveExp || 1));
        const curved = Math.pow(pct / 100, curve);
        galaxy3d.setZoomNorm(curved);
      }
    });

    fovSlider?.addEventListener('input', () => {
      const deg = Math.max(25, Math.min(100, Number(fovSlider.value || 60)));
      const curve = Math.max(0.25, Number(navOrbTuning.fovCurveExp || 1));
      const minFov = 25;
      const maxFov = 100;
      const linearT = (deg - minFov) / (maxFov - minFov);
      const curvedDeg = minFov + Math.pow(Math.max(0, Math.min(1, linearT)), curve) * (maxFov - minFov);
      if (fovValue) fovValue.textContent = `${Math.round(curvedDeg)}°`;
      const galaxy3d = typeof state.getGalaxy3d === 'function' ? state.getGalaxy3d() : null;
      if (!galaxy3d) return;
      if (typeof galaxy3d.setFov === 'function') {
        galaxy3d.setFov(curvedDeg);
      }
    });

    syncTuningUi();
    applyModeStyle();
    drawGizmo();
    syncSlidersFromRenderer();
    let navRaf = 0;
    const animateNavOrb = () => {
      if (!state.documentRef.body.contains(overlay)) {
        if (navRaf) state.windowRef.cancelAnimationFrame(navRaf);
        return;
      }
      applyModeStyle();
      drawGizmo(state.windowRef.performance?.now?.() || 0);
      navRaf = state.windowRef.requestAnimationFrame(animateNavOrb);
    };
    navRaf = state.windowRef.requestAnimationFrame(animateNavOrb);
  }

  const api = {
    configureGalaxyNavOrbRuntime,
    bindGalaxyNavOrb,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeGalaxyNavOrb = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();