import { Vector3 } from 'three';
import { HERO_COMMAND_ACTIONS, HERO_COMMAND_GROUPS } from './hero-battle-orders.js';
import { isHeroShipActive } from './hero-battle-waves.js';

export class HeroBattleCommandPanel {
  constructor(session, stop) {
    this.session = session;
    this.listeners = new AbortController();
    this.root = document.createElement('section');
    this.root.dataset.heroBattleCommands = '';
    this.root.setAttribute('aria-label', 'Interaktive Konvoi-QA');
    this.root.style.cssText = 'position:fixed;right:12px;bottom:60px;width:min(330px,calc(100vw - 24px));max-height:65vh;overflow:auto;z-index:30;background:#071827ed;border:1px solid #59cfff;color:#eef7ff;padding:12px;font:13px sans-serif;pointer-events:auto';
    for (const type of ['pointerdown', 'click', 'keydown', 'keyup', 'wheel']) {
      this.root.addEventListener(type, event => event.stopPropagation(),
        { signal: this.listeners.signal, passive: type === 'wheel' });
    }
    const title = document.createElement('strong');
    title.textContent = 'Konvoi-Durchbruch · QA';
    const warning = document.createElement('p');
    warning.textContent = 'Nur visuelle Befehle. Schaden und Ergebnis bleiben vorgegeben.';
    this.progress = document.createElement('p');
    this.threat = document.createElement('p');
    this.threat.dataset.heroBattleThreat = '';
    this.enemyStatus = document.createElement('p');
    this.enemyStatus.dataset.heroBattleReactions = '';
    this.overview = document.createElement('p');
    this.overview.dataset.heroBattleGroups = '';
    this.waves = document.createElement('p');
    this.waves.dataset.heroBattleWaves = '';
    this.group = this.select('Einsatzgruppe', Object.entries(HERO_COMMAND_GROUPS));
    this.target = this.select('Gegnerische Zielprioritaet', session.entities.slice(session.entities.length / 2)
      .map((entity, offset) => [String(session.entities.length / 2 + offset), `${offset + 1}: ${entity.heroStatus.label}`]));
    this.status = document.createElement('p');
    this.message = document.createElement('p');
    this.message.setAttribute('role', 'status');
    this.buttons = new Map();
    this.root.prepend(title, warning, this.progress, this.threat, this.enemyStatus, this.overview, this.waves);
    for (const [action, label] of Object.entries(HERO_COMMAND_ACTIONS)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.style.cssText = 'margin:3px;padding:6px;background:#17334a;color:#eef7ff;border:1px solid #536678;cursor:pointer';
      button.addEventListener('click', () => {
        try {
          const command = session.issueCommand({ group: this.group.value, action,
            target: action === 'priority' ? Number(this.target.value) : null });
          this.message.textContent = `${label}: vorgemerkt fuer QA-Schritt ${command.step}`;
        } catch (error) {
          this.message.textContent = error.message;
          console.warn('[hero-qa-command]', error);
        }
      }, { signal: this.listeners.signal });
      this.buttons.set(action, button);
      this.root.append(button);
    }
    const end = document.createElement('button');
    end.type = 'button';
    end.textContent = 'QA beenden';
    end.addEventListener('click', stop, { signal: this.listeners.signal });
    this.root.append(this.status, this.message, end);
    this.group.addEventListener('change', () => { session.orders.selected = this.group.value; this.update(); },
      { signal: this.listeners.signal });
    this.marker = document.createElement('div');
    this.marker.style.cssText = 'position:fixed;pointer-events:none;z-index:21;color:#59cfff;font:12px sans-serif;border:1px dashed #59cfff;padding:5px;background:#071827b0';
    this.marker.textContent = '◇ Durchbruchskorridor · QA';
    this.marker.dataset.heroBattleDestination = '';
    document.body.append(this.root, this.marker);
    this.update();
  }

  select(label, entries) {
    const wrapper = document.createElement('label');
    wrapper.textContent = label;
    wrapper.style.cssText = 'display:block;margin:8px 0';
    const select = document.createElement('select');
    select.setAttribute('aria-label', label);
    select.style.cssText = 'display:block;width:100%;background:#17334a;color:#eef7ff;padding:6px';
    for (const [value, text] of entries) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    }
    wrapper.append(select);
    this.root.append(wrapper);
    return select;
  }

  update() {
    const { session } = this;
    const report = session.orders.snapshot();
    const group = report.groups.find(entry => entry.id === this.group.value);
    this.progress.textContent = `Route: ${Math.round(report.progress * 100)}% · visueller Fortschritt, kein Sieg`;
    const objective = report.objective;
    const threats = { low: 'Niedrig', guarded: 'Abgeschirmt', high: 'Hoch', destroyed: 'Konvoi zerstoert' };
    this.threat.textContent = `Bedrohung: ${threats[objective.threat]} · ${objective.guards} nahe Beschuetzer · ${objective.nearby} nahe Gegner · ${objective.attackers} auf Konvoi angesetzt. Schild ${Math.round(objective.shield * 100)}% / Huelle ${Math.round(objective.hull * 100)}%`;
    this.threat.style.color = objective.threat === 'high' || objective.threat === 'destroyed' ? '#ffac87' : '#91dfff';
    this.enemyStatus.textContent = report.enemies.map(enemy =>
      `${enemy.group === 'raiders' ? 'Angreifer' : 'Grossschiffe'}: ${enemy.label}${enemy.target >= 0 ? ` (Slot ${enemy.target})` : ''}`).join(' · ');
    this.status.textContent = `${group.label}: ${group.alive}/${group.total} · ${group.status}`;
    this.overview.textContent = report.groups.map(entry =>
      `${entry.label}: ${entry.alive} aktiv / ${entry.pending} unterwegs · ${entry.status}`).join(' · ');
    this.waves.hidden = !session.waves;
    if (session.waves) {
      this.waves.textContent = session.waves.snapshot().waves.map(wave =>
        `${wave.wave === 0 ? 'Hauptkraefte' : `Welle ${wave.wave} (${wave.flank === 'north' ? 'Nord' : 'Sued'})`}: ${wave.pending
          ? `${wave.pending} unterwegs · ${Math.max(0, Math.ceil(wave.at - session.time))}s`
          : `${wave.active}/${wave.total} aktiv`}`).join(' · ');
    }
    for (const option of this.target.options) option.disabled = !isHeroShipActive(session.entities[Number(option.value)]);
    if (this.target.selectedOptions[0]?.disabled) {
      this.target.value = [...this.target.options].find(option => !option.disabled)?.value ?? '';
    }
    for (const [action, button] of this.buttons) {
      button.disabled = group.alive === 0 || (action === 'deploy' && group.id !== 'reserve')
        || (action === 'priority' && !this.target.value);
    }
    const point = session.center.clone().addScaledVector(new Vector3(9, -6, 0), session.scale)
      .sub(session.space.origin).project(session.space.camera);
    this.marker.hidden = Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1 || point.z < -1 || point.z > 1;
    this.marker.style.color = this.threat.style.color;
    this.marker.style.left = `${(point.x + 1) * window.innerWidth / 2}px`;
    this.marker.style.top = `${(1 - point.y) * window.innerHeight / 2}px`;
  }

  dispose() {
    this.listeners.abort();
    this.root.remove();
    this.marker.remove();
  }
}
