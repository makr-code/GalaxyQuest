import { Vector3 } from 'three';
import { isHeroShipActive } from './hero-battle-waves.js';

export const HERO_COMMAND_GROUPS = Object.freeze({
  line: 'Feuerlinie', escort: 'Eskorte', reserve: 'Reserve',
});
export const HERO_COMMAND_ACTIONS = Object.freeze({
  priority: 'Zielprioritaet', escort: 'Konvoi eskortieren', deploy: 'Reserve einsetzen',
  withdraw: 'Rueckzug', auto: 'Auftrag aufheben',
});
export const HERO_ENEMY_REACTIONS = Object.freeze({
  'flank-escort': 'Eskorte binden', 'intercept-convoy': 'Konvoi abfangen',
  'counter-reserve': 'Reserve abfangen', 'pin-line': 'Feuerlinie binden',
  regroup: 'Beschaedigte Grossschiffe zurueckziehen',
});

export class HeroBattleOrders {
  constructor(session) {
    this.session = session;
    this.selected = 'line';
    this.commands = [];
    this.active = new Map();
    this.reactions = new Map();
    this.reactionLog = [];
    const half = session.entities.length / 2;
    const reserve = session.entities.slice(0, half).map((entity, index) => ({ entity, index }))
      .filter(({ entity, index }) => index > 0 && ['hit-and-run', 'interceptor'].includes(entity.heroStatus.role))
      .slice(-Math.max(1, Math.floor(half / 4))).map(({ index }) => index);
    for (let index = 0; index < half; index++) {
      const state = session.entities[index].heroStatus;
      state.group = index === 0 ? 'convoy' : state.role === 'standoff' ? 'line'
        : reserve.includes(index) ? 'reserve' : 'escort';
    }
    session.entities[0].heroStatus.label = 'Konvoi · QA';
  }

  enemyGroup(index) {
    if (index < this.session.entities.length / 2) return null;
    return ['carrier', 'standoff'].includes(this.session.entities[index].heroStatus.role) ? 'screen' : 'raiders';
  }

  defenders(group) {
    return this.session.entities.map((entity, index) => ({ entity, index }))
      .filter(({ entity, index }) => entity.heroStatus.group === group && isHeroShipActive(entity) && this.canFire(index));
  }

  react() {
    const { session } = this;
    if (session.step % 60) return;
    const escort = this.defenders('escort');
    const reserve = this.defenders('reserve');
    for (const id of ['raiders', 'screen']) {
      const members = session.entities.map((entity, index) => ({ entity, index }))
        .filter(({ entity, index }) => this.enemyGroup(index) === id && isHeroShipActive(entity));
      if (!members.length) { this.reactions.delete(id); continue; }
      const previous = this.reactions.get(id);
      const damaged = id === 'screen' && (previous?.action === 'regroup'
        || members.reduce((sum, { entity }) => sum + entity.heroStatus.hull, 0) / members.length < 0.5);
      const action = damaged ? 'regroup' : reserve.length ? 'counter-reserve'
        : id === 'screen' ? 'pin-line' : !escort.length && !session.entities[0].heroDestroyed
          ? 'intercept-convoy' : 'flank-escort';
      if (!damaged && previous && !session.entities[previous.target]?.heroDestroyed && previous.action !== 'regroup'
        && session.time - previous.at < 3) continue;
      if (previous?.action === action && (action === 'regroup'
        || (previous.target >= 0 && !session.entities[previous.target].heroDestroyed))) continue;
      const candidates = action === 'counter-reserve' ? reserve : action === 'flank-escort' ? escort
        : action === 'intercept-convoy' ? [{ entity: session.entities[0], index: 0 }] : this.defenders('line');
      const alive = session.entities.slice(0, session.entities.length / 2)
        .map((entity, index) => ({ entity, index })).filter(({ entity }) => isHeroShipActive(entity));
      const pool = candidates.length ? candidates : alive;
      pool.sort((a, b) => a.entity.position.distanceToSquared(members[0].entity.position)
        - b.entity.position.distanceToSquared(members[0].entity.position) || a.index - b.index);
      const target = action === 'regroup' ? -1 : pool[0]?.index ?? -1;
      const reaction = { group: id, action, target, at: session.time, step: session.step,
        from: new Map(members.map(({ entity, index }) => [index, entity.position.clone()])) };
      this.reactions.set(id, reaction);
      this.reactionLog.push({ group: id, action, target, step: session.step });
      if (this.reactionLog.length > 64) this.reactionLog.shift();
    }
  }

  enemyDestination(index, time, base, moving) {
    const reaction = this.reactions.get(this.enemyGroup(index));
    if (!moving || !reaction) return base;
    const { session } = this;
    let desired = base;
    if (reaction.action === 'regroup') {
      desired = session.center.clone().addScaledVector(new Vector3(12, -3, (index % 6 - 2.5) * 1.25), session.scale);
    } else if (reaction.target >= 0 && !session.entities[reaction.target].heroDestroyed) {
      const fast = this.enemyGroup(index) === 'raiders';
      const variation = session.tactics?.variation(index, 0, 10) ?? ((session.seed + index * 17) % 97) / 97;
      desired = session.positionAt(reaction.target, time, moving).addScaledVector(new Vector3(
        fast ? 2.8 + Math.sin(time * 2 + variation * Math.PI * 2) * 1.8 : 7,
        fast ? Math.cos(time * 2 + index) * 1.2 : 1.5,
        (index % 5 - 2) * 0.9 + (fast ? Math.sin(time + variation * 6) : 0),
      ), session.scale);
    }
    const p = Math.min(1, Math.max(0, (time - reaction.at) / 1.2));
    return (reaction.from.get(index) ?? base).clone().lerp(desired, p * p * (3 - 2 * p));
  }

  enqueue({ group, action, target = null, step = this.session.step }) {
    if (this.session.disposed) throw new Error('Die QA-Schlacht ist beendet');
    if (!Object.hasOwn(HERO_COMMAND_GROUPS, group) || !Object.hasOwn(HERO_COMMAND_ACTIONS, action)
      || (action === 'deploy' && group !== 'reserve')) throw new TypeError('Ungueltiger QA-Gruppenbefehl');
    if (!Number.isInteger(step) || step < this.session.step || step > Math.floor(this.session.durationSeconds * 60)) {
      throw new RangeError('Befehl muss fuer einen zukuenftigen QA-Schritt gelten');
    }
    const half = this.session.entities.length / 2;
    if (action === 'priority') {
      if (!Number.isInteger(target) || target < half || target >= half * 2
        || !isHeroShipActive(this.session.entities[target])) throw new RangeError('Nur ein lebendes, eingetroffenes gegnerisches QA-Ziel ist erlaubt');
    } else if (target !== null) throw new TypeError('Dieser QA-Auftrag hat kein Einzelziel');
    if (!this.session.entities.some(entity => entity.heroStatus.group === group && isHeroShipActive(entity))) {
      throw new Error('Diese Einsatzgruppe hat keine eingetroffenen ueberlebenden Schiffe');
    }
    if (this.commands.length >= 64) throw new RangeError('Maximal 64 QA-Befehle pro Replay');
    const command = { group, action, target, step, applied: false, cancelled: false };
    this.commands.push(command);
    return { ...command };
  }

  apply() {
    for (const command of this.commands.filter(entry => !entry.applied && !entry.cancelled && entry.step <= this.session.step)
      .sort((a, b) => a.step - b.step)) {
      command.applied = true;
      const from = new Map(this.session.entities.map((entity, index) => [index, entity.position.clone()]));
      this.active.set(command.group, { ...command, at: this.session.time, from });
      for (const entity of this.session.entities) {
        if (entity.heroStatus.group === command.group) entity.heroDecisionPhase = -1;
      }
    }
  }

  convoyPosition(time, moving) {
    return this.session.center.clone().add(new Vector3(
      (-9 + Math.min(time / (24 * this.session.timelineScale), 1) * (moving ? 18 : 0)) * this.session.scale,
      -6 * this.session.scale, 0,
    ));
  }

  destination(index, time, base, moving) {
    const { session } = this;
    const group = session.entities[index].heroStatus.group;
    if (!group) return this.enemyDestination(index, time, base, moving);
    if (group === 'convoy') return this.convoyPosition(time, moving);
    if (!moving) return base;
    const order = this.active.get(group);
    const action = !order || order.action === 'auto'
      ? (group === 'escort' ? 'escort' : group === 'reserve' ? 'hold' : 'auto') : order.action;
    let desired = base;
    if (action === 'escort') {
      desired = this.convoyPosition(time, true).addScaledVector(new Vector3(
        -1.1 + (index % 3) * 1.1, -0.8, (index % 5 - 2) * 0.9,
      ), session.scale);
    } else if (action === 'hold' || action === 'withdraw') {
      desired = session.center.clone().addScaledVector(new Vector3(
        action === 'hold' ? -10 : -12, -4 - (index % 3) * 0.6, (index % 6 - 2.5) * 1.1,
      ), session.scale);
    }
    if (!order) return desired;
    const p = Math.min(1, Math.max(0, (time - order.at) / 1.2));
    return order.from.get(index).clone().lerp(desired, p * p * (3 - 2 * p));
  }

  canFire(index) {
    const entity = this.session.entities[index];
    if (!isHeroShipActive(entity) || (entity.heroStatus.arrival > 0
      && this.session.time < entity.heroStatus.arrival + 2)) return false;
    if (this.reactions.get(this.enemyGroup(index))?.action === 'regroup') return false;
    const group = this.session.entities[index].heroStatus.group;
    if (group === 'convoy') return false;
    const action = this.active.get(group)?.action;
    return action !== 'withdraw' && !(group === 'reserve' && (!action || action === 'auto'));
  }

  target(index, fallback) {
    const reaction = this.reactions.get(this.enemyGroup(index));
    if (reaction?.target >= 0 && !this.session.entities[reaction.target].heroDestroyed) return reaction.target;
    const group = this.session.entities[index].heroStatus.group;
    const order = this.active.get(group);
    const entities = this.session.entities;
    const half = entities.length / 2;
    if (order?.action === 'priority' && !entities[order.target].heroDestroyed) return order.target;
    if (group && (order?.action === 'escort' || (group === 'escort' && (!order || order.action === 'auto')))) {
      if (entities[0].heroDestroyed) return fallback;
      const enemies = entities.slice(half).map((entity, offset) => ({ entity, index: half + offset }))
        .filter(({ entity }) => isHeroShipActive(entity));
      enemies.sort((a, b) => a.entity.position.distanceToSquared(entities[0].position)
        - b.entity.position.distanceToSquared(entities[0].position) || a.index - b.index);
      return enemies[0]?.index ?? -1;
    }
    return fallback;
  }

  snapshot() {
    const convoy = this.session.entities[0];
    const enemies = this.session.entities.map((entity, index) => ({ entity, index }))
      .filter(({ entity, index }) => this.enemyGroup(index) && isHeroShipActive(entity));
    const nearby = enemies.filter(({ entity }) => entity.position.distanceToSquared(convoy.position)
      <= (this.session.scale * 4.5) ** 2).length;
    const attackers = convoy.heroDestroyed ? 0 : enemies.filter(({ index }) =>
      this.canFire(index) && this.reactions.get(this.enemyGroup(index))?.target === 0).length;
    const guards = this.session.entities.filter((entity, index) => entity.heroStatus.group
      && entity.heroStatus.group !== 'convoy' && isHeroShipActive(entity) && this.canFire(index)
      && entity.position.distanceToSquared(convoy.position) <= (this.session.scale * 3.5) ** 2).length;
    return { scenario: 'convoy', selected: this.selected,
      progress: this.session.presentationMoving ? Math.min(this.session.time / (24 * this.session.timelineScale), 1) : 0,
      objective: { phase: convoy.heroDestroyed ? 'destroyed' : !this.session.presentationMoving ? 'stationary'
        : this.session.time >= 24 * this.session.timelineScale ? 'route-complete' : 'transit',
      hull: convoy.heroStatus.hull, shield: convoy.heroStatus.shield, guards, nearby, attackers,
      threat: convoy.heroDestroyed ? 'destroyed' : attackers > 0 || nearby > guards ? 'high'
        : nearby > 0 ? 'guarded' : 'low' },
      enemies: [...this.reactions.values()].map(({ group, action, target, step }) =>
        ({ group, action, label: HERO_ENEMY_REACTIONS[action], target, step })),
      reactions: this.reactionLog.map(reaction => ({ ...reaction })),
      commands: this.commands.map(command => ({ ...command })),
      groups: Object.entries(HERO_COMMAND_GROUPS).map(([id, label]) => {
        const members = this.session.entities.filter(entity => entity.heroStatus.group === id);
        const order = this.active.get(id);
        let status = HERO_COMMAND_ACTIONS[order?.action] ?? (id === 'reserve' ? 'Bereit · wartet' : id === 'escort' ? 'Konvoi eskortieren' : 'Automatik');
        if (order?.action === 'priority' && this.session.entities[order.target].heroDestroyed) status = 'Ziel zerstoert · Ersatz durch Automatik';
        if (order?.action === 'escort' && this.session.entities[0].heroDestroyed) status = 'Konvoi zerstoert · Automatik';
        if (!members.some(entity => isHeroShipActive(entity))) {
          status = members.some(entity => entity.heroPending) ? 'Verstaerkung unterwegs' : 'Gruppe zerstoert';
        }
        return { id, label, alive: members.filter(entity => isHeroShipActive(entity)).length,
          pending: members.filter(entity => entity.heroPending).length,
          total: members.length, status };
      }),
    };
  }

  dispose() {
    for (const command of this.commands) if (!command.applied) command.cancelled = true;
    this.active.clear();
    this.reactions.clear();
  }
}
