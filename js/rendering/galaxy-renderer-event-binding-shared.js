/*
 * Galaxy Renderer Event Binding Shared
 * Single source of truth for renderer DOM event wiring.
 */
(function () {
  function bindEvents(instance) {
    if (!instance || !instance.renderer?.domElement) return;

    instance._onResizeBound = () => instance._onResize();
    window.addEventListener('resize', instance._onResizeBound);

    if (instance.interactive) {
      instance._onMouseMove = (e) => instance._handlePointerMove(e);
      instance._onClick = (e) => instance._handleClick(e);
      instance._onDoubleClick = (e) => instance._handleDoubleClick(e);
      instance._onMouseDown = (e) => instance._handleMouseDown(e);
      instance._onMouseUp = () => instance._handleMouseUp();
      instance._onContextMenu = (e) => { if (instance._handleContextMenu) instance._handleContextMenu(e); };
      instance._onWheel = (e) => instance._handleWheel(e);
      instance._onKeyDown = (e) => instance._handleKeyDown(e);
      instance._onKeyUp = (e) => instance._handleKeyUp(e);

      instance.renderer.domElement.addEventListener('mousemove', instance._onMouseMove);
      instance.renderer.domElement.addEventListener('click', instance._onClick);
      instance.renderer.domElement.addEventListener('dblclick', instance._onDoubleClick);
      instance.renderer.domElement.addEventListener('mousedown', instance._onMouseDown);
      instance.renderer.domElement.addEventListener('contextmenu', instance._onContextMenu, { capture: true });
      window.addEventListener('mouseup', instance._onMouseUp);
      instance.renderer.domElement.addEventListener('wheel', instance._onWheel, { passive: false });
      window.addEventListener('keydown', instance._onKeyDown);
      window.addEventListener('keyup', instance._onKeyUp);
    } else {
      instance.renderer.domElement.style.pointerEvents = 'none';
    }

    if (typeof ResizeObserver !== 'undefined') {
      try {
        instance._containerResizeObserver = new ResizeObserver(() => {
          instance._onResize();
        });
        instance._containerResizeObserver.observe(instance.container);
      } catch (_) {
        instance._containerResizeObserver = null;
      }
    }
  }

  function unbindEvents(instance) {
    if (!instance) return;

    if (instance._onResizeBound) window.removeEventListener('resize', instance._onResizeBound);
    if (instance._containerResizeObserver) {
      try {
        instance._containerResizeObserver.disconnect();
      } catch (_) {}
      instance._containerResizeObserver = null;
    }

    if (instance.renderer?.domElement) {
      if (instance._onMouseMove) instance.renderer.domElement.removeEventListener('mousemove', instance._onMouseMove);
      if (instance._onClick) instance.renderer.domElement.removeEventListener('click', instance._onClick);
      if (instance._onDoubleClick) instance.renderer.domElement.removeEventListener('dblclick', instance._onDoubleClick);
      if (instance._onMouseDown) instance.renderer.domElement.removeEventListener('mousedown', instance._onMouseDown);
      if (instance._onContextMenu) instance.renderer.domElement.removeEventListener('contextmenu', instance._onContextMenu, { capture: true });
      if (instance._onWheel) instance.renderer.domElement.removeEventListener('wheel', instance._onWheel);
    }

    if (instance._onMouseUp) window.removeEventListener('mouseup', instance._onMouseUp);
    if (instance._onKeyDown) window.removeEventListener('keydown', instance._onKeyDown);
    if (instance._onKeyUp) window.removeEventListener('keyup', instance._onKeyUp);
  }

  window.GQGalaxyRendererEventBindingShared = {
    bindEvents,
    unbindEvents,
  };
})();
