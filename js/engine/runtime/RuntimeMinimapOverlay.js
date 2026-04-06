/**
 * RuntimeMinimapOverlay.js
 *
 * Minimap overlay drawing helpers.
 */

'use strict';

(function () {
  function createMinimapOverlay(opts = {}) {
    const projectPoint = typeof opts.projectPoint === 'function' ? opts.projectPoint : (() => ({ x: 0, y: 0 }));
    const clampCanvasPoint = typeof opts.clampCanvasPoint === 'function' ? opts.clampCanvasPoint : ((_, p) => p || { x: 0, y: 0 });

    function drawCameraOverlay(ctx, state, pose) {
      if (!ctx || !state || !pose) return;

      const rawApex = projectPoint(state, pose.cameraX, pose.cameraY);
      const rawTarget = projectPoint(state, pose.targetX, pose.targetY);
      const apex = clampCanvasPoint(state, rawApex);
      const target = clampCanvasPoint(state, rawTarget);

      const dirXRaw = target.x - apex.x;
      const dirYRaw = target.y - apex.y;
      const dirLen = Math.hypot(dirXRaw, dirYRaw) || 1;
      const dirX = dirXRaw / dirLen;
      const dirY = dirYRaw / dirLen;
      const perpX = -dirY;
      const perpY = dirX;
      const zoom = Math.max(0.45, Number(pose.zoom || 1));
      const fovFactor = Math.max(0.52, Math.min(1.45, 1.35 / zoom));
      const nearDist = Math.max(10, dirLen * 0.22);
      const farDist = Math.max(22, dirLen * 0.86);
      const nearHalf = Math.max(6, farDist * 0.12 * fovFactor);
      const farHalf = Math.max(12, farDist * 0.23 * fovFactor);

      const nearCenter = { x: apex.x + dirX * nearDist, y: apex.y + dirY * nearDist };
      const farCenter = { x: apex.x + dirX * farDist, y: apex.y + dirY * farDist };
      const nearLeft = { x: nearCenter.x - perpX * nearHalf, y: nearCenter.y - perpY * nearHalf };
      const nearRight = { x: nearCenter.x + perpX * nearHalf, y: nearCenter.y + perpY * nearHalf };
      const farLeft = { x: farCenter.x - perpX * farHalf, y: farCenter.y - perpY * farHalf };
      const farRight = { x: farCenter.x + perpX * farHalf, y: farCenter.y + perpY * farHalf };

      ctx.save();
      ctx.shadowColor = 'rgba(79, 222, 255, 0.45)';
      ctx.shadowBlur = 14;
      ctx.fillStyle = 'rgba(35, 157, 214, 0.12)';
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(farLeft.x, farLeft.y);
      ctx.lineTo(farRight.x, farRight.y);
      ctx.closePath();
      ctx.fill();

      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(110, 229, 255, 0.9)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(nearLeft.x, nearLeft.y);
      ctx.lineTo(farLeft.x, farLeft.y);
      ctx.lineTo(farRight.x, farRight.y);
      ctx.lineTo(nearRight.x, nearRight.y);
      ctx.closePath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(farLeft.x, farLeft.y);
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(farRight.x, farRight.y);
      ctx.moveTo(nearLeft.x, nearLeft.y);
      ctx.lineTo(nearRight.x, nearRight.y);
      ctx.moveTo(nearCenter.x, nearCenter.y);
      ctx.lineTo(farCenter.x, farCenter.y);
      ctx.stroke();

      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(147, 219, 255, 0.55)';
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(148, 235, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(apex.x, apex.y, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(148, 235, 255, 0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(target.x, target.y, 4.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    return {
      drawCameraOverlay,
    };
  }

  const api = {
    createMinimapOverlay,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapOverlay = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
