/**
 * RuntimeMinimapInteractions.js
 *
 * Pointer and wheel interactions for the minimap canvas.
 */

'use strict';

(function () {
  function createMinimapInteractions(opts = {}) {
    const dragThreshold = Number(opts.dragThreshold || 4) || 4;
    const clickRadius = Number(opts.clickRadius || 18) || 18;
    const resolvePose = typeof opts.resolvePose === 'function' ? opts.resolvePose : (() => null);
    const unprojectPoint = typeof opts.unprojectPoint === 'function' ? opts.unprojectPoint : ((_, x, y) => ({ x, y }));
    const projectPoint = typeof opts.projectPoint === 'function' ? opts.projectPoint : ((_, x, y) => ({ x, y }));
    const setTarget = typeof opts.setTarget === 'function' ? opts.setTarget : (() => false);
    const queueTarget = typeof opts.queueTarget === 'function' ? opts.queueTarget : (() => {});
    const zoom = typeof opts.zoom === 'function' ? opts.zoom : (() => false);
    const openGalaxyWindow = typeof opts.openGalaxyWindow === 'function' ? opts.openGalaxyWindow : (() => {});
    const dispatchNavigate = typeof opts.dispatchNavigate === 'function' ? opts.dispatchNavigate : (() => {});
    const getActiveGalaxy = typeof opts.getActiveGalaxy === 'function' ? opts.getActiveGalaxy : (() => 1);

    function bind(root, canvas) {
      if (!canvas || canvas.__minimapInteractiveBound) return;
      canvas.__minimapInteractiveBound = true;

      const dragState = {
        active: false,
        moved: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        baseTargetX: 0,
        baseTargetY: 0,
      };
      canvas.__minimapDragState = dragState;

      const getPointerPos = (evt) => {
        const rect = canvas.getBoundingClientRect();
        return {
          x: evt.clientX - rect.left,
          y: evt.clientY - rect.top,
        };
      };

      const finishDrag = (evt) => {
        if (!dragState.active) return;
        if (evt && evt.pointerId != null && dragState.pointerId !== evt.pointerId) return;
        if (dragState.pointerId != null) {
          try { canvas.releasePointerCapture(dragState.pointerId); } catch (_) {}
        }
        canvas.classList.remove('is-dragging');
        dragState.active = false;
        dragState.pointerId = null;
      };

      canvas.addEventListener('pointerdown', (evt) => {
        if (evt.button !== 0) return;
        const state = canvas.__minimapState;
        if (!state) return;
        const pose = resolvePose();
        const pointer = getPointerPos(evt);
        const fallbackWorld = unprojectPoint(state, pointer.x, pointer.y);
        dragState.active = true;
        dragState.moved = false;
        dragState.pointerId = evt.pointerId;
        dragState.startX = pointer.x;
        dragState.startY = pointer.y;
        dragState.baseTargetX = Number(pose && pose.targetX != null ? pose.targetX : (fallbackWorld.x || 0));
        dragState.baseTargetY = Number(pose && pose.targetY != null ? pose.targetY : (fallbackWorld.y || 0));
        canvas.classList.add('is-dragging');
        try { canvas.setPointerCapture(evt.pointerId); } catch (_) {}
        evt.preventDefault();
      });

      canvas.addEventListener('pointermove', (evt) => {
        const state = canvas.__minimapState;
        if (!state || !dragState.active || dragState.pointerId !== evt.pointerId) return;
        const pointer = getPointerPos(evt);
        const dx = pointer.x - dragState.startX;
        const dy = pointer.y - dragState.startY;
        if (!dragState.moved && Math.hypot(dx, dy) >= dragThreshold) {
          dragState.moved = true;
        }
        if (!dragState.moved) return;
        const nextX = Math.max(state.minX, Math.min(state.maxX, dragState.baseTargetX + dx / Math.max(0.0001, state.scale)));
        const nextY = Math.max(state.minY, Math.min(state.maxY, dragState.baseTargetY + dy / Math.max(0.0001, state.scale)));
        setTarget(nextX, nextY, true);
      });

      canvas.addEventListener('pointerup', (evt) => {
        const state = canvas.__minimapState;
        if (!state) {
          finishDrag(evt);
          return;
        }

        const wasDrag = dragState.active && dragState.moved && dragState.pointerId === evt.pointerId;
        const pointer = getPointerPos(evt);
        finishDrag(evt);
        if (wasDrag) return;

        let best = null;
        let bestDist = Infinity;
        const stars = Array.isArray(state.stars) ? state.stars : [];
        for (const star of stars) {
          const point = projectPoint(state, star.x_ly, star.y_ly);
          const dist = Math.hypot(pointer.x - point.x, pointer.y - point.y);
          if (dist < bestDist) {
            bestDist = dist;
            best = star;
          }
        }

        if (best && bestDist < clickRadius) {
          openGalaxyWindow();
          dispatchNavigate({
            galaxy: Number(best.galaxy_index || getActiveGalaxy() || 1),
            system: Number(best.system_index || 0),
            star: best,
          });
          return;
        }

        const world = unprojectPoint(state, pointer.x, pointer.y);
        queueTarget(world.x, world.y, true);
      });

      canvas.addEventListener('pointercancel', finishDrag);
      canvas.addEventListener('wheel', (evt) => {
        evt.preventDefault();
        zoom(evt.deltaY);
      }, { passive: false });
      canvas.addEventListener('contextmenu', (evt) => evt.preventDefault());
    }

    return {
      bind,
    };
  }

  const api = {
    createMinimapInteractions,
  };

  if (typeof window !== 'undefined') {
    window.GQRuntimeMinimapInteractions = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
