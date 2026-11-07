import { Vector3 } from 'three';

export function isHeroShipActive(entity) {
  return !!entity && !entity.heroDestroyed && !entity.heroPending;
}

export class HeroBattleWaves {
  constructor(session) {
    this.session = session;
    this.events = [];
    const half = session.entities.length / 2;
    const initial = Math.ceil(half / 2);
    const split = initial + Math.ceil((half - initial) / 2);
    this.plan = session.entities.map((entity, index) => {
      const lane = index % half;
      const wave = lane < initial ? 0 : lane < split ? 1 : 2;
      const at = wave * 8 * session.timelineScale;
      entity.heroPending = wave > 0;
      entity.heroStatus.arrival = at;
      entity.heroStatus.flank = wave === 1 ? 'north' : wave === 2 ? 'south' : 'center';
      return { index, wave, at, flank: entity.heroStatus.flank };
    });
  }

  advance() {
    for (const entry of this.plan) {
      const entity = this.session.entities[entry.index];
      if (entity.heroPending && this.session.time >= entry.at) {
        entity.heroPending = false;
        entity.heroDecisionPhase = -1;
        this.events.push({ ...entry, step: this.session.step });
      }
    }
  }

  position(index, time, moving, destination) {
    const entry = this.plan[index];
    if (!entry.wave || !moving) return destination;
    const side = index < this.session.entities.length / 2 ? -1 : 1;
    const origin = this.session.center.clone().addScaledVector(new Vector3(
      side * 13, -4, entry.wave === 1 ? -9 : 9,
    ), this.session.scale);
    const p = Math.min(1, Math.max(0, (time - entry.at) / 2));
    return origin.lerp(destination, p * p * (3 - 2 * p));
  }

  snapshot() {
    return { enabled: true, events: this.events.map(entry => ({ ...entry })),
      waves: [0, 1, 2].map(wave => {
        const entries = this.plan.filter(entry => entry.wave === wave);
        return { wave, at: wave * 8 * this.session.timelineScale, flank: ['center', 'north', 'south'][wave],
          total: entries.length,
          pending: entries.filter(entry => this.session.entities[entry.index].heroPending).length,
          active: entries.filter(entry => isHeroShipActive(this.session.entities[entry.index])).length };
      }) };
  }
}
