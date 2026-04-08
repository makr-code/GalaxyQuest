/**
 * RuntimeMinimapRenderer.js
 *
 * Minimap render pipeline.
 */

'use strict';

(function () {
  function createMinimapRenderer(opts = {}) {
    const minimapPad = Number(opts.minimapPad || 14) || 14;
    const minimapGridDivs = Number(opts.minimapGridDivs || 5) || 5;
    const getGalaxyStars = typeof opts.getGalaxyStars === 'function' ? opts.getGalaxyStars : (() => []);
    const getColonies = typeof opts.getColonies === 'function' ? opts.getColonies : (() => []);
    const getCurrentColony = typeof opts.getCurrentColony === 'function' ? opts.getCurrentColony : (() => null);
    const getUiState = typeof opts.getUiState === 'function' ? opts.getUiState : (() => ({}));
    const getPinnedStar = typeof opts.getPinnedStar === 'function' ? opts.getPinnedStar : (() => null);
    const resolvePose = typeof opts.resolvePose === 'function' ? opts.resolvePose : (() => null);
    const projectPoint = typeof opts.projectPoint === 'function' ? opts.projectPoint : (() => ({ x: 0, y: 0 }));
    const drawCameraOverlay = typeof opts.drawCameraOverlay === 'function' ? opts.drawCameraOverlay : (() => {});
    const getStarClassColor = typeof opts.getStarClassColor === 'function' ? opts.getStarClassColor : (() => '#ffffff');
    // Optional – autobahn lane data from trade routes
    const getTradeRoutes = typeof opts.getTradeRoutes === 'function' ? opts.getTradeRoutes : (() => []);

    function draw(root, wrap, canvas, hud) {
      if (!root || !wrap || !canvas) return;

      const w = Math.max(100, wrap.clientWidth || 260);
      const h = Math.max(100, wrap.clientHeight || 260);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#050d1e';
      ctx.fillRect(0, 0, w, h);

      const starsRaw = getGalaxyStars();
      const stars = Array.isArray(starsRaw) ? starsRaw.filter((s) => s.x_ly != null && s.y_ly != null) : [];

      if (!stars.length) {
        if (hud) hud.dataset.backend = 'offline';
        ctx.fillStyle = 'rgba(80, 140, 200, 0.6)';
        ctx.font = '11px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('Galaxy data loading...', w / 2, h / 2);
        canvas.__minimapState = null;
        return;
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const s of stars) {
        const sx = Number(s.x_ly);
        const sy = Number(s.y_ly);
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
      }

      const rangeX = (maxX - minX) || 1;
      const rangeY = (maxY - minY) || 1;
      const scaleX = (w - minimapPad * 2) / rangeX;
      const scaleY = (h - minimapPad * 2) / rangeY;
      const scale = Math.min(scaleX, scaleY);
      const offX = minimapPad + ((w - minimapPad * 2) - rangeX * scale) / 2;
      const offY = minimapPad + ((h - minimapPad * 2) - rangeY * scale) / 2;
      const pose = resolvePose();

      canvas.__minimapState = {
        minX,
        minY,
        maxX,
        maxY,
        scale,
        offX,
        offY,
        width: w,
        height: h,
        stars,
        pose,
      };

      if (hud) {
        hud.dataset.backend = pose?.backend || 'offline';
        const badge = hud.querySelector('.minimap-badge');
        const meta = hud.querySelector('.minimap-meta');
        if (badge) badge.textContent = pose ? `LIVE ${String(pose.backend || '').toUpperCase()}` : 'STATIC';
        if (meta) meta.textContent = pose ? 'Ziehen bewegt die Kamera' : 'Klick springt zum System';
      }

      ctx.strokeStyle = 'rgba(50, 90, 150, 0.22)';
      ctx.lineWidth = 0.5;
      const gridStepLy = Math.max(1, Math.round(rangeX / minimapGridDivs));
      for (let gx = Math.ceil(minX / gridStepLy) * gridStepLy; gx <= maxX; gx += gridStepLy) {
        const cx = offX + (gx - minX) * scale;
        ctx.beginPath();
        ctx.moveTo(cx, minimapPad);
        ctx.lineTo(cx, h - minimapPad);
        ctx.stroke();
      }
      for (let gy = Math.ceil(minY / gridStepLy) * gridStepLy; gy <= maxY; gy += gridStepLy) {
        const cy = offY + (gy - minY) * scale;
        ctx.beginPath();
        ctx.moveTo(minimapPad, cy);
        ctx.lineTo(w - minimapPad, cy);
        ctx.stroke();
      }

      const colonies = getColonies();
      const ownColonySystems = new Set(
        (Array.isArray(colonies) ? colonies : []).map((col) => Number(col.system || col.system_index || 0)).filter(Boolean)
      );
      const currentColony = getCurrentColony();
      const uiState = getUiState() || {};
      const pinnedStar = getPinnedStar();
      const currentSysIdx = Number(currentColony?.system || currentColony?.system_index || 0);
      const activeSysIdx = Number(uiState.activeStar?.system_index || pinnedStar?.system_index || 0);

      // ── Autobahn lane overlay ──────────────────────────────────────────────
      const autobahnApi = typeof window !== 'undefined' ? window.GQGalaxyAutobahnLayer : null;
      let highwayHubs = null;
      if (autobahnApi && typeof autobahnApi.buildAutobahnEdges === 'function') {
        const routes = getTradeRoutes();
        if (Array.isArray(routes) && routes.length) {
          const edges = autobahnApi.buildAutobahnEdges(routes);
          autobahnApi.drawAutobahnEdges(ctx, edges, canvas.__minimapState, projectPoint, stars);
          highwayHubs = autobahnApi.buildHighwayHubSet(edges);
        }
      }

      for (const star of stars) {
        const sx = Number(star.x_ly);
        const sy = Number(star.y_ly);
        const point = projectPoint(canvas.__minimapState, sx, sy);
        const cx = point.x;
        const cy = point.y;
        const sysIdx = Number(star.system_index || 0);
        const galaxyIdx = Number(star.galaxy_index || 1);
        const isOwn = sysIdx > 0 && ownColonySystems.has(sysIdx);
        const isCurrent = currentSysIdx > 0 && sysIdx === currentSysIdx;
        const isActive = activeSysIdx > 0 && sysIdx === activeSysIdx;
        const isHighwayHub = highwayHubs ? highwayHubs.has(`${galaxyIdx}:${sysIdx}`) : false;
        const hasForeignColony = !isOwn && Number(star.colony_count || 0) > 0;

        // ── Kurzinfo: highway hub ring ──
        if (isHighwayHub && !isCurrent && !isActive) {
          ctx.beginPath();
          ctx.arc(cx, cy, 5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 179, 71, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (isCurrent) {
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#ffe066';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255, 224, 102, 0.7)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (isActive) {
          ctx.beginPath();
          ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = '#5de4ff';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, 6, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(93, 228, 255, 0.55)';
          ctx.lineWidth = 1.25;
          ctx.stroke();
        } else if (isOwn) {
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#44ee88';
          ctx.fill();
          // Kurzinfo: own colony tier ring
          ctx.beginPath();
          ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(68, 238, 136, 0.4)';
          ctx.lineWidth = 0.8;
          ctx.stroke();
        } else if (hasForeignColony) {
          // Kurzinfo: foreign colony – colored dot with faction color
          const colonyColor = String(star.colony_owner_color || star.faction_color || '#7db7ee');
          ctx.beginPath();
          ctx.arc(cx, cy, 2, 0, Math.PI * 2);
          ctx.fillStyle = colonyColor;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(cx, cy, 3.8, 0, Math.PI * 2);
          ctx.strokeStyle = colonyColor + '66';
          ctx.lineWidth = 0.7;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, 1, 0, Math.PI * 2);
          ctx.fillStyle = getStarClassColor(star.spectral_class);
          ctx.fill();
        }
      }

      drawCameraOverlay(ctx, canvas.__minimapState, pose);

      ctx.font = '9px Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = 'rgba(100, 160, 220, 0.6)';
      const routeCount = (() => { try { return getTradeRoutes().length; } catch (_) { return 0; } })();
      const statsLabel = routeCount > 0 ? `${stars.length} stars · ${routeCount} routes` : `${stars.length} stars`;
      ctx.fillText(statsLabel, 5, h - 5);
    }

    return {
      draw,
    };
  }

  const api = {
    createMinimapRenderer,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapRenderer = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
