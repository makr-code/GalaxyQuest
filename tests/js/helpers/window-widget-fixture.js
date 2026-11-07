import fs from 'node:fs';

export function attachWindowWidgets(wm) {
  window.eval(fs.readFileSync('js/runtime/wm-widgets.js', 'utf8'));
  wm.widgets = window.WMWidgets;
  const frames = new Map();
  wm.layout = (id, options) => {
    if (options || !frames.has(id)) {
      frames.get(id)?.destroy();
      const body = wm.body(id);
      body.replaceChildren();
      frames.set(id, wm.widgets.frame(body, options || {}));
    }
    return frames.get(id);
  };
  return wm;
}
