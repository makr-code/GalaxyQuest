/*
 * Canvas Input Controller
 * Platform/input layer for 3D canvases. Similar to common OpenGL/DirectX engine
 * layouts: raw DOM events are normalized here, renderer/game code consumes
 * semantic callbacks and state snapshots instead of owning DOM wiring.
 */
(function () {
  'use strict';

  class GQCanvasInputController {
    constructor(opts = {}) {
      if (!opts.surface) throw new Error('GQCanvasInputController: surface required');
      this.surface = opts.surface;
      this.container = opts.container || opts.surface;
      this.windowTarget = opts.windowTarget || window;
      this.keyboardTarget = opts.keyboardTarget || this.windowTarget;
      this.enabled = opts.enabled !== false;
      this.captureWheel = opts.captureWheel !== false;
      this.resolveActions = typeof opts.resolveActions === 'function' ? opts.resolveActions : null;
      this.resolveActionsByContext = (opts.resolveActionsByContext && typeof opts.resolveActionsByContext === 'object')
        ? Object.assign(Object.create(null), opts.resolveActionsByContext)
        : Object.create(null);
      this.onAction = typeof opts.onAction === 'function' ? opts.onAction : null;
      this.currentContext = String(opts.context || 'default');
      this.callbacks = Object.assign({}, opts.callbacks || {}, {
        onPointerMove: typeof opts.onPointerMove === 'function' ? opts.onPointerMove : null,
        onPointerDown: typeof opts.onPointerDown === 'function' ? opts.onPointerDown : null,
        onPointerUp: typeof opts.onPointerUp === 'function' ? opts.onPointerUp : null,
        onPointerCancel: typeof opts.onPointerCancel === 'function' ? opts.onPointerCancel : null,
        onClick: typeof opts.onClick === 'function' ? opts.onClick : null,
        onDoubleClick: typeof opts.onDoubleClick === 'function' ? opts.onDoubleClick : null,
        onWheel: typeof opts.onWheel === 'function' ? opts.onWheel : null,
        onContextMenu: typeof opts.onContextMenu === 'function' ? opts.onContextMenu : null,
        onKeyDown: typeof opts.onKeyDown === 'function' ? opts.onKeyDown : null,
        onKeyUp: typeof opts.onKeyUp === 'function' ? opts.onKeyUp : null,
        onResize: typeof opts.onResize === 'function' ? opts.onResize : null,
      });
      this.state = {
        pointerId: null,
        pointerType: '',
        inside: false,
        buttonsMask: 0,
        buttonsDown: Object.create(null),
        keysDown: Object.create(null),
        pointer: {
          clientX: 0,
          clientY: 0,
          localX: 0,
          localY: 0,
          ndcX: 0,
          ndcY: 0,
        },
        drag: {
          active: false,
          button: -1,
          startClientX: 0,
          startClientY: 0,
          startLocalX: 0,
          startLocalY: 0,
          deltaClientX: 0,
          deltaClientY: 0,
          deltaLocalX: 0,
          deltaLocalY: 0,
        },
        modifiers: {
          alt: false,
          ctrl: false,
          meta: false,
          shift: false,
        },
      };
      this._bound = false;
      this._handlers = null;
      this._resizeObserver = null;
    }

    bind() {
      if (this._bound) return;
      const handlers = {
        onPointerMove: (evt) => this._handlePointerMove(evt),
        onPointerDown: (evt) => this._handlePointerDown(evt),
        onPointerUp: (evt) => this._handlePointerUp(evt),
        onPointerCancel: (evt) => this._handlePointerCancel(evt),
        onPointerLeave: (evt) => this._handlePointerLeave(evt),
        onClick: (evt) => this._emit('onClick', evt),
        onDoubleClick: (evt) => this._emit('onDoubleClick', evt),
        onWheel: (evt) => this._handleWheel(evt),
        onContextMenu: (evt) => this._handleContextMenu(evt),
        onKeyDown: (evt) => this._handleKeyDown(evt),
        onKeyUp: (evt) => this._handleKeyUp(evt),
        onResize: () => this._emitResize(),
      };
      this._handlers = handlers;

      this.surface.addEventListener('pointermove', handlers.onPointerMove);
      this.surface.addEventListener('pointerdown', handlers.onPointerDown);
      this.surface.addEventListener('pointerup', handlers.onPointerUp);
      this.surface.addEventListener('pointercancel', handlers.onPointerCancel);
      this.surface.addEventListener('pointerleave', handlers.onPointerLeave);
      this.surface.addEventListener('click', handlers.onClick);
      this.surface.addEventListener('dblclick', handlers.onDoubleClick);
      this.surface.addEventListener('wheel', handlers.onWheel, { passive: false });
      this.surface.addEventListener('contextmenu', handlers.onContextMenu, { capture: true });
      this.windowTarget.addEventListener('pointerup', handlers.onPointerUp);
      this.windowTarget.addEventListener('pointercancel', handlers.onPointerCancel);
      this.keyboardTarget.addEventListener('keydown', handlers.onKeyDown);
      this.keyboardTarget.addEventListener('keyup', handlers.onKeyUp);
      this.windowTarget.addEventListener('resize', handlers.onResize);

      if (typeof ResizeObserver !== 'undefined') {
        try {
          this._resizeObserver = new ResizeObserver(() => this._emitResize());
          this._resizeObserver.observe(this.container);
        } catch (_) {
          this._resizeObserver = null;
        }
      }

      this._bound = true;
    }

    unbind() {
      if (!this._bound || !this._handlers) return;
      const h = this._handlers;
      this.surface.removeEventListener('pointermove', h.onPointerMove);
      this.surface.removeEventListener('pointerdown', h.onPointerDown);
      this.surface.removeEventListener('pointerup', h.onPointerUp);
      this.surface.removeEventListener('pointercancel', h.onPointerCancel);
      this.surface.removeEventListener('pointerleave', h.onPointerLeave);
      this.surface.removeEventListener('click', h.onClick);
      this.surface.removeEventListener('dblclick', h.onDoubleClick);
      this.surface.removeEventListener('wheel', h.onWheel);
      this.surface.removeEventListener('contextmenu', h.onContextMenu, { capture: true });
      this.windowTarget.removeEventListener('pointerup', h.onPointerUp);
      this.windowTarget.removeEventListener('pointercancel', h.onPointerCancel);
      this.keyboardTarget.removeEventListener('keydown', h.onKeyDown);
      this.keyboardTarget.removeEventListener('keyup', h.onKeyUp);
      this.windowTarget.removeEventListener('resize', h.onResize);
      if (this._resizeObserver) {
        try { this._resizeObserver.disconnect(); } catch (_) {}
        this._resizeObserver = null;
      }
      this._handlers = null;
      this._bound = false;
      this._resetTransientState();
    }

    setEnabled(enabled) {
      this.enabled = enabled !== false;
      if (!this.enabled) this._resetTransientState();
    }

    setContext(name) {
      const next = String(name || 'default');
      this.currentContext = next;
    }

    registerContextResolver(name, resolverFn) {
      const key = String(name || 'default');
      if (typeof resolverFn !== 'function') {
        delete this.resolveActionsByContext[key];
        return;
      }
      this.resolveActionsByContext[key] = resolverFn;
    }

    isButtonDown(button) {
      return !!this.state.buttonsDown[String(Number(button || 0))];
    }

    getSnapshot() {
      return {
        pointerId: this.state.pointerId,
        pointerType: this.state.pointerType,
        inside: this.state.inside,
        buttonsMask: this.state.buttonsMask,
        buttonsDown: Object.assign({}, this.state.buttonsDown),
        keysDown: Object.assign({}, this.state.keysDown),
        pointer: Object.assign({}, this.state.pointer),
        drag: Object.assign({}, this.state.drag),
        modifiers: Object.assign({}, this.state.modifiers),
      };
    }

    _resetTransientState() {
      this.state.pointerId = null;
      this.state.pointerType = '';
      this.state.buttonsMask = 0;
      this.state.buttonsDown = Object.create(null);
      this.state.drag.active = false;
      this.state.drag.button = -1;
      this.state.drag.deltaClientX = 0;
      this.state.drag.deltaClientY = 0;
      this.state.drag.deltaLocalX = 0;
      this.state.drag.deltaLocalY = 0;
    }

    _updateModifiers(evt) {
      this.state.modifiers.alt = !!evt?.altKey;
      this.state.modifiers.ctrl = !!evt?.ctrlKey;
      this.state.modifiers.meta = !!evt?.metaKey;
      this.state.modifiers.shift = !!evt?.shiftKey;
    }

    _makeContext(evt) {
      const rect = this.surface.getBoundingClientRect();
      const clientX = Number(evt?.clientX || 0);
      const clientY = Number(evt?.clientY || 0);
      const width = Math.max(1, Number(rect.width || 1));
      const height = Math.max(1, Number(rect.height || 1));
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      return {
        nativeEvent: evt,
        controller: this,
        state: this.getSnapshot(),
        button: Number(evt?.button ?? -1),
        buttons: Number(evt?.buttons || this.state.buttonsMask || 0),
        pointerId: Number(evt?.pointerId ?? this.state.pointerId ?? -1),
        pointerType: String(evt?.pointerType || this.state.pointerType || 'mouse'),
        clientX,
        clientY,
        localX,
        localY,
        ndcX: ((localX / width) * 2) - 1,
        ndcY: -(((localY / height) * 2) - 1),
        deltaX: Number(evt?.deltaX || 0),
        deltaY: Number(evt?.deltaY || 0),
        altKey: !!evt?.altKey,
        ctrlKey: !!evt?.ctrlKey,
        metaKey: !!evt?.metaKey,
        shiftKey: !!evt?.shiftKey,
        key: String(evt?.key || ''),
        inputContext: this.currentContext,
      };
    }

    _resolveActionsForContext(ctx, phase) {
      const contextual = this.resolveActionsByContext?.[this.currentContext];
      if (typeof contextual === 'function') {
        return contextual(ctx, phase, this.currentContext);
      }
      if (typeof this.resolveActions === 'function') {
        return this.resolveActions(ctx, phase, this.currentContext);
      }
      return null;
    }

    _emit(name, evt) {
      if (!this.enabled) return;
      const cb = this.callbacks[name];
      if (typeof cb !== 'function') return;
      return cb(this._makeContext(evt));
    }

    _dispatchActions(phase, evt) {
      if (!this.enabled || typeof this.resolveActions !== 'function' || typeof this.onAction !== 'function') return;
      const ctx = this._makeContext(evt || {});
      const actions = this._resolveActionsForContext(ctx, String(phase || ''));
      if (!Array.isArray(actions) || !actions.length) return;
      for (const action of actions) {
        if (!action || typeof action !== 'object') continue;
        this.onAction(Object.assign({ phase }, action), ctx);
      }
    }

    _emitResize() {
      if (!this.enabled) return;
      const cb = this.callbacks.onResize;
      if (typeof cb !== 'function') return;
      cb({ controller: this, state: this.getSnapshot() });
    }

    _handlePointerMove(evt) {
      this.state.inside = true;
      this.state.pointerId = Number(evt?.pointerId ?? this.state.pointerId ?? -1);
      this.state.pointerType = String(evt?.pointerType || 'mouse');
      this.state.buttonsMask = Number(evt?.buttons || 0);
      this._updateModifiers(evt);

      const ctx = this._makeContext(evt);
      this.state.pointer.clientX = ctx.clientX;
      this.state.pointer.clientY = ctx.clientY;
      this.state.pointer.localX = ctx.localX;
      this.state.pointer.localY = ctx.localY;
      this.state.pointer.ndcX = ctx.ndcX;
      this.state.pointer.ndcY = ctx.ndcY;

      if (this.state.drag.active) {
        this.state.drag.deltaClientX = ctx.clientX - this.state.drag.startClientX;
        this.state.drag.deltaClientY = ctx.clientY - this.state.drag.startClientY;
        this.state.drag.deltaLocalX = ctx.localX - this.state.drag.startLocalX;
        this.state.drag.deltaLocalY = ctx.localY - this.state.drag.startLocalY;
      }

      this._dispatchActions('pointermove', evt);
      this._emit('onPointerMove', evt);
    }

    _handlePointerDown(evt) {
      if (!this.enabled) return;
      this.state.inside = true;
      this.state.pointerId = Number(evt?.pointerId ?? -1);
      this.state.pointerType = String(evt?.pointerType || 'mouse');
      this.state.buttonsMask = Number(evt?.buttons || 0);
      this.state.buttonsDown[String(Number(evt?.button ?? 0))] = true;
      this._updateModifiers(evt);
      const ctx = this._makeContext(evt);
      this.state.pointer.clientX = ctx.clientX;
      this.state.pointer.clientY = ctx.clientY;
      this.state.pointer.localX = ctx.localX;
      this.state.pointer.localY = ctx.localY;
      this.state.pointer.ndcX = ctx.ndcX;
      this.state.pointer.ndcY = ctx.ndcY;
      this.state.drag.active = true;
      this.state.drag.button = Number(evt?.button ?? -1);
      this.state.drag.startClientX = ctx.clientX;
      this.state.drag.startClientY = ctx.clientY;
      this.state.drag.startLocalX = ctx.localX;
      this.state.drag.startLocalY = ctx.localY;
      this.state.drag.deltaClientX = 0;
      this.state.drag.deltaClientY = 0;
      this.state.drag.deltaLocalX = 0;
      this.state.drag.deltaLocalY = 0;
      this._dispatchActions('pointerdown', evt);
      try { this.surface.setPointerCapture?.(evt.pointerId); } catch (_) {}
      this._emit('onPointerDown', evt);
    }

    _handlePointerUp(evt) {
      this.state.buttonsMask = Number(evt?.buttons || 0);
      delete this.state.buttonsDown[String(Number(evt?.button ?? 0))];
      this._updateModifiers(evt);
      this._dispatchActions('pointerup', evt);
      this._emit('onPointerUp', evt);
      if (this.state.pointerId != null) {
        try { this.surface.releasePointerCapture?.(this.state.pointerId); } catch (_) {}
      }
      this.state.drag.active = false;
      this.state.drag.button = -1;
      this.state.drag.deltaClientX = 0;
      this.state.drag.deltaClientY = 0;
      this.state.drag.deltaLocalX = 0;
      this.state.drag.deltaLocalY = 0;
      if (!Object.keys(this.state.buttonsDown).length) {
        this.state.pointerId = null;
      }
    }

    _handlePointerCancel(evt) {
      this._dispatchActions('pointercancel', evt);
      this._emit('onPointerCancel', evt);
      this._resetTransientState();
    }

    _handlePointerLeave(evt) {
      this.state.inside = false;
      if (!this.state.drag.active) {
        this.state.pointerId = null;
      }
      this._emit('onPointerMove', evt);
    }

    _handleWheel(evt) {
      if (!this.enabled) return;
      if (this.captureWheel) evt.preventDefault();
      this._updateModifiers(evt);
      this._dispatchActions('wheel', evt);
      this._emit('onWheel', evt);
    }

    _handleContextMenu(evt) {
      if (!this.enabled) return;
      const result = this._emit('onContextMenu', evt);
      if (result !== true) {
        evt.preventDefault();
      }
    }

    _handleKeyDown(evt) {
      if (!this.enabled) return;
      this.state.keysDown[String(evt?.key || '')] = true;
      this._updateModifiers(evt);
      this._dispatchActions('keydown', evt);
      this._emit('onKeyDown', evt);
    }

    _handleKeyUp(evt) {
      delete this.state.keysDown[String(evt?.key || '')];
      this._updateModifiers(evt);
      this._dispatchActions('keyup', evt);
      this._emit('onKeyUp', evt);
    }
  }

  window.GQCanvasInputController = GQCanvasInputController;
})();