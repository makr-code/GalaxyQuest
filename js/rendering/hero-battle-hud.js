import { Vector3 } from 'three';
import { fleetVisualLod } from './fleet-visual-lod.js';

export class HeroBattleHud {
  constructor() {
    this.root = document.createElement('div');
    this.root.dataset.heroBattleHud = '';
    this.root.setAttribute('aria-label', 'QA battle shield and hull status');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;overflow:hidden';
    this.entries = new Map();
    document.body.append(this.root);
  }

  update(entities, camera, origin, width, height, bodies = [], selectedGroup = null) {
    let shown = 0;
    for (const entity of entities) {
      const state = entity.heroStatus;
      if (!state) continue;
      if (entity.heroPending) {
        const existing = this.entries.get(entity.id);
        if (existing) existing.node.hidden = true;
        continue;
      }
      let entry = this.entries.get(entity.id);
      if (!entry) {
        const node = document.createElement('div');
        node.style.cssText = 'position:absolute;width:88px;color:#eef7ff;font:10px sans-serif;text-align:center;text-shadow:0 1px 2px #000';
        const label = document.createElement('div');
        const bars = ['shield', 'hull'].map((kind) => {
          const track = document.createElement('div');
          track.setAttribute('role', 'progressbar');
          track.setAttribute('aria-valuemin', '0');
          track.setAttribute('aria-valuemax', '100');
          track.style.cssText = 'height:4px;margin:2px 0;background:#10202de0;border:1px solid #536678';
          const fill = document.createElement('div');
          fill.style.cssText = `height:100%;background:${kind === 'shield' ? '#59cfff' : '#72eb8c'}`;
          track.append(fill);
          node.append(track);
          return fill;
        });
        node.prepend(label);
        this.root.append(node);
        entry = { node, label, bars };
        this.entries.set(entity.id, entry);
      }
      const local = entity.position.clone().sub(origin);
      const direction = local.clone().sub(camera.position);
      const distance = direction.length();
      direction.normalize();
      const blocked = bodies.some((body) => {
        if (!['planet', 'moon', 'star'].includes(body.userData.type)) return false;
        const offset = body.getWorldPosition(new Vector3()).sub(camera.position);
        const along = offset.dot(direction);
        return along > 0 && along < distance
          && offset.lengthSq() - along * along < body.userData.radius ** 2;
      });
      const lod = fleetVisualLod(entity.position, entity.scale, camera, origin, height);
      const projected = local.project(camera);
      const visible = !blocked && lod.tier !== 'hidden' && projected.z >= -1 && projected.z <= 1
        && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && shown < 32;
      entry.node.hidden = !visible;
      if (!visible) continue;
      shown++;
      entry.node.style.left = `${(projected.x + 1) * width / 2 - 44}px`;
      entry.node.style.top = `${(1 - projected.y) * height / 2 - Math.max(16, lod.pixels * 0.55)}px`;
      entry.label.textContent = state.destroyed ? 'WRACK · QA'
        : `${state.label || (state.role === 'hit-and-run' ? 'Fregatte' : 'Kreuzer')} ${Math.round(state.hull * 100)}%`;
      entry.node.style.outline = state.group && state.group === selectedGroup ? '1px solid #59cfff' : '';
      for (const [index, kind] of ['shield', 'hull'].entries()) {
        entry.bars[index].style.width = `${state[kind] * 100}%`;
        entry.bars[index].parentElement.setAttribute('aria-label', `${kind} ${Math.round(state[kind] * 100)}%`);
        entry.bars[index].parentElement.setAttribute('aria-valuenow', String(Math.round(state[kind] * 100)));
      }
      entry.bars[1].style.background = state.hull < 0.35 ? '#ff694c' : '#72eb8c';
    }
  }

  dispose() {
    this.root.remove();
    this.entries.clear();
  }
}
