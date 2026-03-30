/*
 * GalaxyQuest DOM Builder – js/gq-ui.js
 * Based on Three.js editor/js/libs/ui.js (MIT License, © 2010-2024 three.js authors)
 *
 * Provides a lightweight fluent DOM builder that replaces innerHTML template strings.
 * Exposed globally as window.GQUI.
 *
 * Usage:
 *   const el = GQUI.div('my-class').add(GQUI.span().setText('Hello'));
 *   parent.appendChild(el.dom);
 */
(function () {
  'use strict';
  if (window.GQUI) return;

  // ── Base element ───────────────────────────────────────────────────────────

  class UIElement {
    constructor(tag) {
      this.dom = (typeof tag === 'string') ? document.createElement(tag) : tag;
    }

    /** Append UIElement(s) or raw DOM nodes as children. */
    add(...children) {
      children.forEach((c) => {
        if (c == null) return;
        this.dom.appendChild(c instanceof UIElement ? c.dom : c);
      });
      return this;
    }

    /** Remove all child nodes. */
    clear() {
      while (this.dom.firstChild) this.dom.removeChild(this.dom.firstChild);
      return this;
    }

    setId(id)           { this.dom.id = String(id); return this; }
    setClass(cls)       { this.dom.className = String(cls || ''); return this; }
    addClass(cls)       { String(cls || '').split(/\s+/).filter(Boolean).forEach((c) => this.dom.classList.add(c)); return this; }
    setTitle(t)         { this.dom.title = String(t == null ? '' : t); return this; }
    setText(t)          { this.dom.textContent = String(t == null ? '' : t); return this; }
    setStyle(prop, val) { this.dom.style[prop] = val; return this; }
    setAttribute(n, v)  { this.dom.setAttribute(n, String(v)); return this; }
    setData(key, val)   { this.dom.dataset[key] = String(val == null ? '' : val); return this; }
    setDisabled(b)      { this.dom.disabled = !!b; return this; }
    setValue(v)         { this.dom.value = v; return this; }
    on(ev, fn)          { this.dom.addEventListener(ev, fn); return this; }
    onClick(fn)         { return this.on('click', fn); }
    onChange(fn)        { return this.on('change', fn); }
  }

  // ── Concrete element types ─────────────────────────────────────────────────

  class UIDiv    extends UIElement { constructor() { super('div');    } }
  class UISpan   extends UIElement { constructor() { super('span');   } }
  class UILabel  extends UIElement { constructor() { super('label');  } }
  class UIStrong extends UIElement { constructor() { super('strong'); } }

  class UIButton extends UIElement {
    constructor(text = '') {
      super('button');
      this.dom.type = 'button';
      if (text) this.dom.textContent = text;
    }
  }

  class UISelect extends UIElement {
    constructor() { super('select'); }

    /**
     * Add an <option> to this select.
     * @param {string} value
     * @param {string} text
     * @param {boolean} [disabled=false]
     * @param {Object}  [dataset={}]  – key/value pairs set on option.dataset
     */
    addOption(value, text, disabled = false, dataset = {}) {
      const opt = document.createElement('option');
      opt.value = String(value);
      opt.textContent = String(text);
      opt.disabled = disabled;
      Object.entries(dataset).forEach(([k, v]) => { opt.dataset[k] = String(v == null ? '' : v); });
      this.dom.appendChild(opt);
      return this;
    }
  }

  class UIInput extends UIElement {
    constructor(type = 'text') {
      super('input');
      this.dom.type = type;
    }
    setMin(v)         { this.dom.min = String(v); return this; }
    setMax(v)         { this.dom.max = String(v); return this; }
    setPlaceholder(p) { this.dom.placeholder = String(p); return this; }
  }

  // ── Utility helpers ────────────────────────────────────────────────────────

  /** Remove all child nodes from a raw DOM element. */
  function clearNode(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  /**
   * Clear a raw DOM element and append a single status span inside it.
   * @param {Element} el
   * @param {string}  msg
   * @param {string}  [cssClass='text-muted']
   */
  function setStatus(el, msg, cssClass) {
    if (!el) return;
    clearNode(el);
    const span = new UISpan().setClass(cssClass || 'text-muted').setText(msg);
    el.appendChild(span.dom);
  }

  /**
   * Clear a raw DOM element and append a UIElement (or raw node) as its sole child.
   * @param {Element}           el
   * @param {UIElement|Element} child
   */
  function mount(el, child) {
    if (!el) return;
    clearNode(el);
    if (!child) return;
    el.appendChild(child instanceof UIElement ? child.dom : child);
  }

  // ── Convenience factories ──────────────────────────────────────────────────

  function applyClasses(uiEl, clsArray) {
    const joined = clsArray.filter(Boolean).join(' ');
    if (joined) uiEl.setClass(joined);
    return uiEl;
  }

  window.GQUI = {
    // Classes (for instanceof checks or subclassing)
    UIElement,
    UIDiv,
    UISpan,
    UILabel,
    UIStrong,
    UIButton,
    UISelect,
    UIInput,

    // Factories
    el:     (tag)          => new UIElement(tag),
    div:    (...cls)       => applyClasses(new UIDiv(),   cls),
    span:   (...cls)       => applyClasses(new UISpan(),  cls),
    label:  (...cls)       => applyClasses(new UILabel(), cls),
    strong: ()             => new UIStrong(),
    btn:    (text, ...cls) => applyClasses(new UIButton(text), cls),
    select: (...cls)       => applyClasses(new UISelect(), cls),
    input:  (type, ...cls) => applyClasses(new UIInput(type), cls),

    // DOM utilities
    clearNode,
    setStatus,
    mount,
  };
})();
