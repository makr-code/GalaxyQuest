/*
 * Galaxy Renderer Event Binding Shared
 * Single source of truth for renderer DOM event wiring.
 */
(function () {
  function bindViaInputController(instance) {
    if (!window.GQCanvasInputController || !instance || !instance.renderer?.domElement) return false;
    const supportsSemanticInput = typeof instance._resolveInputActions === 'function'
      && typeof instance._handleInputAction === 'function';
    const baseContext = typeof instance._getInputContext === 'function'
      ? instance._getInputContext()
      : (instance.systemMode ? 'system' : 'galaxy');
    const actionResolverProfiles = supportsSemanticInput
      ? {
          galaxy: (ctx, phase) => instance._resolveInputActions(ctx, phase, 'galaxy'),
          system: (ctx, phase) => instance._resolveInputActions(ctx, phase, 'system'),
          planetApproach: (ctx, phase) => instance._resolveInputActions(ctx, phase, 'planetApproach'),
          colonySurface: (ctx, phase) => instance._resolveInputActions(ctx, phase, 'colonySurface'),
          objectApproach: (ctx, phase) => instance._resolveInputActions(ctx, phase, 'objectApproach'),
        }
      : null;

    instance._inputController = new window.GQCanvasInputController({
      surface: instance.renderer.domElement,
      container: instance.container,
      keyboardTarget: window,
      windowTarget: window,
      context: baseContext,
      captureWheel: true,
      enabled: instance.interactive !== false,
      resolveActionsByContext: actionResolverProfiles,
      resolveActions: supportsSemanticInput ? ((ctx, phase, contextName) => instance._resolveInputActions(ctx, phase, contextName)) : null,
      onAction: supportsSemanticInput ? ((action, ctx) => instance._handleInputAction(action, ctx)) : null,
      onResize: () => instance._onResize(),
      onPointerMove: (ctx) => instance._handlePointerMove?.(ctx.nativeEvent, ctx),
      onPointerDown: supportsSemanticInput ? null : ((ctx) => instance._handleMouseDown?.(ctx.nativeEvent, ctx)),
      onPointerUp: supportsSemanticInput ? null : ((ctx) => instance._handleMouseUp?.(ctx.nativeEvent, ctx)),
      onPointerCancel: supportsSemanticInput ? null : ((ctx) => instance._handleMouseUp?.(ctx.nativeEvent, ctx)),
      onClick: (ctx) => instance._handleClick?.(ctx.nativeEvent, ctx),
      onDoubleClick: (ctx) => instance._handleDoubleClick?.(ctx.nativeEvent, ctx),
      onWheel: supportsSemanticInput ? null : ((ctx) => instance._handleWheel?.(ctx.nativeEvent, ctx)),
      onContextMenu: (ctx) => {
        if (instance._handleContextMenu) return instance._handleContextMenu(ctx.nativeEvent, ctx);
        return false;
      },
      onKeyDown: supportsSemanticInput ? null : ((ctx) => instance._handleKeyDown?.(ctx.nativeEvent, ctx)),
      onKeyUp: supportsSemanticInput ? null : ((ctx) => instance._handleKeyUp?.(ctx.nativeEvent, ctx)),
    });
    instance._inputController.bind();
    return true;
  }

  function bindEvents(instance) {
    if (!instance || !instance.renderer?.domElement) return;

    if (bindViaInputController(instance)) {
      if (!instance.interactive) {
        instance.renderer.domElement.style.pointerEvents = 'none';
      }
      return;
    }

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

    if (instance._inputController) {
      instance._inputController.unbind();
      instance._inputController = null;
    }

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
