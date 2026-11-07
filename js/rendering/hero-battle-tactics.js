import { Vector3 } from 'three';
import { HERO_SHIP_PROFILES } from './hero-battle-models.js';
import { isHeroShipActive } from './hero-battle-waves.js';

const STRATEGIES = ['flank', 'focus-fire', 'escort', 'withdraw'];
const PHASE_SECONDS = 4;

function random(seed, wing, phase, slot, channel) {
  let value = (seed ^ Math.imul(wing + 1, 0x9e3779b9) ^ Math.imul(phase + 1, 0x85ebca6b)
    ^ Math.imul(slot + 1, 0xc2b2ae35) ^ Math.imul(channel + 1, 0x27d4eb2d)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Replay-local presentation plans; never authoritative fleet AI or damage rules.
export class HeroBattleTactics {
  constructor(seed, shipCount, durationSeconds = 30) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
      || !Number.isInteger(shipCount) || shipCount < 8 || shipCount > 128 || shipCount % 2
      || !Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300) {
      throw new TypeError('Invalid hero tactics seed or fleet size');
    }
    this.seed = seed;
    this.half = shipCount / 2;
    this.maxTime = Math.max(34, durationSeconds + 4);
    this.plans = [0, 1].map(wing => {
      const plans = [];
      let remaining = [];
      for (let phase = 0; phase <= Math.floor(this.maxTime / PHASE_SECONDS); phase++) {
        if (!remaining.length) remaining = [...STRATEGIES];
        const previous = plans.at(-1)?.strategy;
        const choices = remaining.filter(strategy => strategy !== previous);
        const strategy = choices[Math.floor(random(seed, wing, phase, 0, 0) * choices.length)];
        remaining = remaining.filter(candidate => candidate !== strategy);
        plans.push({ wing, phase, at: phase * PHASE_SECONDS, strategy,
          flank: random(seed, wing, phase, 0, 2) < 0.5 ? -1 : 1 });
      }
      return plans;
    });
  }

  decision(index, time) {
    if (!Number.isInteger(index) || index < 0 || index >= this.half * 2
      || !Number.isFinite(time) || time < 0 || time > this.maxTime) {
      throw new TypeError('Invalid hero tactics sample');
    }
    const wing = index < this.half ? 0 : 1;
    const phase = Math.floor(time / PHASE_SECONDS);
    return this.plans[wing][phase];
  }

  variation(index, phase, channel) {
    return random(this.seed, index < this.half ? 0 : 1, phase, index % this.half, channel);
  }

  offset(index, phase, shipClass) {
    const plan = this.plans[index < this.half ? 0 : 1][phase];
    const profile = HERO_SHIP_PROFILES[shipClass];
    const fast = ['hit-and-run', 'interceptor'].includes(profile.role);
    const side = index < this.half ? -1 : 1;
    const spread = this.variation(index, phase, 3);
    if (plan.strategy === 'flank') return new Vector3(side * (fast ? -1 : 0.2), -0.4,
      plan.flank * (fast ? 2 + spread * 2 : 0.5));
    if (plan.strategy === 'focus-fire') return new Vector3(side * (fast ? -0.8 : -0.3), 0.2,
      (spread - 0.5) * 0.8);
    if (plan.strategy === 'escort') return new Vector3(side * (fast ? 8 - profile.range : 0),
      -0.5, (spread - 0.5) * 2);
    return new Vector3(side * (fast ? 4 + spread * 1.5 : 0.8), -1, (spread - 0.5) * 2);
  }

  displacement(index, time, shipClass) {
    const plan = this.decision(index, time);
    const current = this.offset(index, plan.phase, shipClass);
    if (plan.phase === 0) return current;
    const progress = Math.min(1, (time - plan.at) / 1.2);
    const blend = progress * progress * (3 - 2 * progress);
    return this.offset(index, plan.phase - 1, shipClass).lerp(current, blend);
  }

  target(index, time, entities) {
    const plan = this.decision(index, time);
    const start = plan.wing === 0 ? this.half : 0;
    const enemies = entities.map((entity, slot) => ({ entity, slot }))
      .filter(({ entity, slot }) => slot >= start && slot < start + this.half && isHeroShipActive(entity));
    if (!enemies.length) return -1;
    if (plan.strategy === 'focus-fire') {
      const capitals = enemies.filter(({ entity }) => ['carrier', 'standoff'].includes(entity.heroStatus.role));
      const pool = capitals.length ? capitals : enemies;
      return pool[Math.floor(random(this.seed, plan.wing, plan.phase, 0, 4) * pool.length)].slot;
    }
    if (plan.strategy === 'escort') {
      const carrier = entities.slice(plan.wing * this.half, (plan.wing + 1) * this.half)
        .find(entity => isHeroShipActive(entity) && entity.heroStatus.role === 'carrier');
      if (carrier) {
        enemies.sort((a, b) => a.entity.position.distanceToSquared(carrier.position)
          - b.entity.position.distanceToSquared(carrier.position) || a.slot - b.slot);
        return enemies[Math.floor(this.variation(index, plan.phase, 5) * Math.min(3, enemies.length))].slot;
      }
    }
    return enemies[Math.floor(this.variation(index, plan.phase, 6) * enemies.length)].slot;
  }

  snapshot() {
    return { phaseSeconds: PHASE_SECONDS, plans: this.plans.flat().map(plan => ({ ...plan })) };
  }
}
