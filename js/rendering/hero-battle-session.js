import { Quaternion, Vector3 } from 'three';
import { aimHeroTurret, HERO_DESTRUCTION_PROFILES, HERO_SHIP_PROFILES, heroShipClassAt } from './hero-battle-models.js';
import { HeroBattleDepth } from './hero-battle-depth.js';
import { HeroBattleMetrics } from './hero-battle-metrics.js';
import { HeroBattleAudio } from './hero-battle-audio.js';
import { SPACE_WEAPON_PROFILES, SpaceWeaponRenderPass, resolveWeaponMuzzle } from './space-weapon-render-pass.js';
import { HeroBattleHud } from './hero-battle-hud.js';
import { HeroDebrisRenderPass } from './hero-debris-render-pass.js';
import { HeroBattleTactics } from './hero-battle-tactics.js';
import { HeroBattleOrders } from './hero-battle-orders.js';
import { HeroBattleCommandPanel } from './hero-battle-command-panel.js';
import { HeroBattleWaves, isHeroShipActive } from './hero-battle-waves.js';

export class HeroBattleSession {
  constructor(space, { seed, audio, view, getAudioSettings, fleetLod = false, primitiveBudget = 256,
    cinematic = false, formation = 'classic', tactics = false, scenario = 'battle', reinforcements = false,
    durationSeconds = 30 }) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff
      || !['near', 'middle', 'system'].includes(view) || typeof audio !== 'boolean'
      || typeof fleetLod !== 'boolean' || !Number.isInteger(primitiveBudget)
      || primitiveBudget < 1 || primitiveBudget > 768 || typeof cinematic !== 'boolean'
      || !['classic', 'mixed'].includes(formation) || (formation === 'mixed' && !cinematic)) {
      throw new TypeError('Invalid hero replay options');
    }
    if (typeof tactics !== 'boolean' || (tactics && formation !== 'mixed')) {
      throw new TypeError('Hero tactics require a mixed cinematic formation');
    }
    if (!['battle', 'convoy'].includes(scenario) || (scenario === 'convoy' && formation !== 'mixed')) {
      throw new TypeError('Convoy QA requires a mixed cinematic formation');
    }
    this.space = space;
    this.seed = seed;
    this.view = view;
    this.audioEnabled = audio;
    this.getAudioSettings = getAudioSettings;
    this.fleetLod = fleetLod;
    this.primitiveBudget = primitiveBudget;
    this.cinematic = cinematic;
    this.formation = formation;
    this.tacticsEnabled = tactics;
    this.scenario = scenario;
    if (typeof reinforcements !== 'boolean' || (reinforcements && scenario !== 'convoy')) {
      throw new TypeError('Reinforcements require convoy QA');
    }
    this.reinforcements = reinforcements;
    if (!Number.isFinite(durationSeconds) || durationSeconds < 1 || durationSeconds > 300
      || (durationSeconds > 30 && scenario !== 'convoy')) throw new RangeError('Invalid hero duration');
    this.durationSeconds = durationSeconds;
    this.timelineScale = Math.max(1, durationSeconds / 30);
    this.decisions = [];
    this.damagePass = new SpaceWeaponRenderPass();
    this.debrisPass = new HeroDebrisRenderPass();
    this.damageEvents = [];
    this.destructions = [];
    this.fireCount = 0;
    this.explosionCount = 0;
    this.debrisCount = 0;
    this.peakDamagePrimitives = 0;
    this.lastDamagePrimitives = 0;
    this.peakPrimitives = 0;
    this.peakShipDrawCalls = 0;
    this.peakRetainedEffects = 0;
    this.budgetCounters = { evicted: space.weaponRenderPass.evictedEffects, rejected: space.weaponRenderPass.rejectedEffects };
    this.depth = new HeroBattleDepth();
    this.metrics = new HeroBattleMetrics();
    this.time = 0;
    this.step = 0;
    this.shots = 0;
    this.outcomes = { miss: 0, shield: 0, hull: 0 };
    this.log = [];
    this.impacts = [];
    this.disposed = false;
  }

  async initialize(entities, center, scale) {
    if (this.formation === 'mixed' && (entities.length < 8 || entities.length % 2)) {
      throw new RangeError('Mixed hero formation requires at least eight ships in two equal wings');
    }
    this.entities = entities;
    this.center = center.clone().add(this.space.origin);
    this.scale = scale;
    if (this.tacticsEnabled) this.tactics = new HeroBattleTactics(this.seed, entities.length, this.durationSeconds);
    for (const [index, entity] of entities.entries()) {
      const resource = this.space.vesselRenderPass.resources.get(entity.id);
      if (!resource?.asset.rig) throw new Error('Hero ship requires an authored turret and muzzle');
      entity.weaponRig = resource.asset.rig;
      entity.turretQuaternion = new Quaternion();
      entity.heroLight = { hull: 0, shield: 0 };
      entity.heroContact = { normal: new Vector3(0, 0, 1), age: 0 };
      entity.weaponMount = { position: entity.position.clone(), quaternion: entity.quaternion.clone(),
        scale: entity.scale };
      if (this.cinematic) {
        const shipClass = heroShipClassAt(index, entities.length, this.formation);
        const profile = HERO_SHIP_PROFILES[shipClass];
        entity.heroStatus = { role: profile?.role ?? (index % 2 ? 'standoff' : 'hit-and-run'),
          shipClass, label: profile?.label ?? (index % 2 ? 'Kreuzer' : 'Fregatte'),
          shield: 1, hull: 1, destroyed: false, nextFire: 0 };
        if (this.formation === 'mixed') {
          const capital = ['carrier', 'standoff'].includes(profile.role);
          const carrier = profile.role === 'carrier';
          for (const [at, shield, hull] of capital
            ? [[2, 0.85, 1], [5, 0.6, 1], [8, 0.35, 0.8], [11, carrier ? 0.25 : 0, carrier ? 0.8 : 0.32]]
            : [[1.5, 0.65, 1], [3, 0.2, 0.68], [4.5, 0, 0.32], [6.5, 0, 0.22]]) {
            this.damageEvents.push({ at, entity, shield, hull });
          }
          const lane = index % (entities.length / 2);
          if (lane % 12 === 3) this.damageEvents.push({ at: 7, entity, shield: 0, hull: 0 });
          if (lane % 12 === 2) this.damageEvents.push({ at: 9, entity, shield: 0, hull: 0 });
          if (lane % 12 === 1) this.damageEvents.push({ at: 12, entity, shield: 0, hull: 0 });
          continue;
        }
        // Authored QA state keyframes, independent of illustrative shot outcomes.
        for (const [at, shield, hull] of [[1.5, 0.65, 1], [3, 0.2, 0.68], [4.5, 0, 0.32],
          [6.5, 0, index % 4 === 0 ? 0 : 0.22]]) {
          this.damageEvents.push({ at: at + (index % 2) * 0.25, entity, shield, hull });
        }
        if (index % 4 === 1) this.damageEvents.push({ at: 8, entity, shield: 0, hull: 0 });
      }
    }
    for (const event of this.damageEvents) event.at *= this.timelineScale;
    if (this.reinforcements) {
      this.waves = new HeroBattleWaves(this);
      for (const event of this.damageEvents) event.at += event.entity.heroStatus.arrival;
    }
    if (this.scenario === 'convoy') this.orders = new HeroBattleOrders(this);
    if (this.audioEnabled) {
      this.getAudioSettings();
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is unavailable');
      const context = new AudioContextClass();
      this.audio = new HeroBattleAudio(context, { scale, getSettings: this.getAudioSettings });
      await context.resume();
      if (context.state !== 'running') throw new Error('Enable hero audio from a user gesture');
    }
    if (this.disposed) await this.audio?.dispose();
  }

  positionAt(index, time, moving) {
    const half = this.entities.length / 2;
    const side = index < half ? -1 : 1;
    const lane = index % half;
    const phase = time * 0.5 + index * Math.PI / 2 + (this.seed % 97) / 97;
    if (this.cinematic) {
      if (this.formation === 'mixed') {
        const profile = HERO_SHIP_PROFILES[this.entities[index].heroStatus.shipClass];
        const fast = ['hit-and-run', 'interceptor'].includes(profile.role);
        const run = time * Math.PI * 2 / profile.period + lane * 0.7 + (this.seed % 97) / 97
          + (moving && this.tactics ? this.tactics.variation(index, 0, 7) * Math.PI * 2 : 0);
        const position = this.center.clone().add(new Vector3(
          side * this.scale * (profile.range - (moving ? Math.sin(run) * profile.excursion : 0)),
          -this.scale * (3 + Math.floor(lane / 12) * 4)
            + (moving ? Math.cos(run) * this.scale * (fast ? 1.5 : 0.15) : 0),
          ((lane % 6) - 2.5) * this.scale * 1.25
            + (moving && fast ? Math.sin(run * 2) * this.scale * 0.7 : 0),
        ));
        if (moving && this.tactics) {
          position.addScaledVector(this.tactics.displacement(index, time, this.entities[index].heroStatus.shipClass), this.scale);
        }
        const destination = this.orders ? this.orders.destination(index, time, position, moving) : position;
        return this.waves ? this.waves.position(index, time, moving, destination) : destination;
      }
      const small = index % 2 === 0;
      const run = time * Math.PI * 2 / 4.2 + lane * 0.7 + (this.seed % 97) / 97;
      return this.center.clone().add(new Vector3(
        side * this.scale * (small ? 4.2 - (moving ? Math.sin(run) * 2.8 : 0)
          : 7 + (moving ? Math.sin(time * 0.15 + lane) * 0.25 : 0)),
        -this.scale * (3 + Math.floor(lane / 8) * 3)
          + (moving ? Math.cos(run) * this.scale * (small ? 1.8 : 0.15) : 0),
        (lane % 8 - (Math.min(half, 8) - 1) / 2) * this.scale * 3
          + (moving && small ? Math.sin(run * 2) * this.scale * 0.6 : 0),
      ));
    }
    return this.center.clone().add(new Vector3(
      side * this.scale * 4 + (moving ? Math.sin(phase) * this.scale * 0.8 : 0),
      -this.scale * (3 + Math.floor(lane / 8) * 3) + (moving ? Math.cos(phase) * this.scale * 0.6 : 0),
      (lane % 8 - (Math.min(half, 8) - 1) / 2) * this.scale * 3
        + (moving ? Math.sin(phase * 0.8) * this.scale * 0.7 : 0),
    ));
  }

  update(elapsed, moving, effects, weaponKinds) {
    const started = performance.now();
    // Fixed replay-local presentation steps, never a gameplay tick.
    const targetStep = Math.floor(elapsed * 60);
    while (this.step <= targetStep) {
      this.time = this.step / 60;
      this.advance(moving, effects, weaponKinds);
      this.step++;
    }
    this.metrics.record(performance.now() - started, elapsed);
    this.peakRetainedEffects = Math.max(this.peakRetainedEffects, this.space.weaponRenderPass.effects.length);
  }

  recordRenderStats() {
    this.peakPrimitives = Math.max(this.peakPrimitives, this.space.weaponRenderPass.drawnEffects);
    this.peakShipDrawCalls = Math.max(this.peakShipDrawCalls, this.space.vesselRenderPass.frameStats?.drawCalls || 0);
    this.lastWeaponStats = { ...this.space.weaponRenderPass.frameStats };
    this.lastVesselStats = { ...this.space.vesselRenderPass.frameStats };
    this.lastDamagePrimitives = this.damagePass.drawnEffects;
    this.peakDamagePrimitives = Math.max(this.peakDamagePrimitives, this.lastDamagePrimitives);
  }

  attachHud(stop) {
    if (this.cinematic && !this.hud) this.hud = new HeroBattleHud();
    if (this.orders && !this.commandPanel) this.commandPanel = new HeroBattleCommandPanel(this, stop);
  }

  issueCommand(command) {
    if (this.disposed) throw new Error('Die QA-Schlacht ist beendet');
    if (!this.orders) throw new Error('Befehle sind nur im Konvoi-QA-Szenario verfuegbar');
    return this.orders.enqueue(command);
  }

  renderPresentation(pass, device, format, width, height) {
    if (!this.cinematic) return;
    this.damagePass.render(pass, device, format, this.space.camera, this.space.origin,
      performance.now() / 1000, width, height, true, this.time, 128);
    this.hud?.update(this.entities, this.space.camera, this.space.origin,
      window.innerWidth, window.innerHeight, this.space.bodies, this.orders?.selected);
    this.commandPanel?.update();
  }

  updateDamage(moving) {
    for (const event of this.damageEvents) {
      if (event.played || event.entity.heroPending || this.time < event.at) continue;
      event.played = true;
      Object.assign(event.entity.heroStatus, { shield: event.shield, hull: event.hull, destroyed: event.hull === 0 });
      event.entity.heroStatus.nextFire = this.time;
      if (event.hull === 0) {
        event.entity.heroDestroyed = true;
        const index = this.entities.indexOf(event.entity);
        const velocity = moving ? this.positionAt(index, this.time + 0.02, true)
          .sub(event.entity.position).divideScalar(0.02) : new Vector3();
        this.damagePass.firePresentation('debris', event.entity, {
          time: this.time, priority: 2, velocity, fragments: false,
        });
        const shipClass = HERO_SHIP_PROFILES[event.entity.heroStatus.shipClass]?.destruction
          ?? event.entity.heroStatus.shipClass;
        const burst = this.debrisPass.spawn(event.entity, {
          time: this.time, velocity, seed: (this.seed + index) >>> 0, shipClass,
        });
        const source = { position: event.entity.position.clone(), quaternion: event.entity.quaternion.clone(),
          scale: event.entity.scale };
        this.destructions.push({ burst, source, velocity, nextDetonation: 0, nextFire: this.time,
          wreckSources: burst.fragments.filter(fragment => fragment.major).slice(0, 2).map(() => ({
            position: source.position.clone(), quaternion: source.quaternion.clone(), scale: source.scale * 0.35,
          })) });
        this.destructions = this.destructions.filter(sequence => this.debrisPass.bursts.includes(sequence.burst));
        this.debrisCount++;
      }
    }
    for (const entity of this.entities) {
      const state = entity.heroStatus;
      if (!state || !isHeroShipActive(entity) || state.hull > 0.68 || this.time < state.nextFire) continue;
      state.nextFire = this.time + 0.4;
      const offsets = HERO_DESTRUCTION_PROFILES[HERO_SHIP_PROFILES[state.shipClass]?.destruction ?? state.shipClass].fireOffsets;
      for (const offset of offsets.slice(0, state.hull <= 0.32 ? offsets.length : 1)) {
        this.damagePass.firePresentation('fire', entity, { time: this.time, offset: new Vector3(...offset) });
        this.fireCount++;
      }
      entity.heroLight.hull = Math.max(entity.heroLight.hull, 0.45);
    }
    for (const sequence of this.destructions) {
      const { burst, source, velocity } = sequence;
      const age = this.time - burst.time;
      const detonations = HERO_DESTRUCTION_PROFILES[burst.shipClass].detonations;
      while (sequence.nextDetonation < detonations.length
        && age >= detonations[sequence.nextDetonation].delay) {
        const detonation = detonations[sequence.nextDetonation++];
        const at = burst.time + detonation.delay;
        source.position.copy(burst.position).addScaledVector(velocity, detonation.delay);
        this.damagePass.firePresentation('explosion', source, {
          time: at, offset: new Vector3(...detonation.offset), velocity,
          size: detonation.size, duration: detonation.duration, priority: 2,
        });
        this.explosionCount++;
        this.audio?.play('missile', resolveWeaponMuzzle(source, new Vector3(...detonation.offset)),
          this.space.camera, this.space.origin, true);
      }
      if (age < 3.2 && sequence.wreckSources.length) {
        const fragments = this.debrisPass.sample(burst, this.time);
        for (const [index, wreck] of sequence.wreckSources.entries()) {
          wreck.position.copy(fragments[index].position);
          wreck.quaternion.copy(fragments[index].quaternion);
          if (age < 2.4 && this.time >= sequence.nextFire) {
            this.damagePass.firePresentation('fire', wreck, {
              time: this.time, size: 0.6, priority: 2,
              offset: new Vector3(0, 0, fragments[index].size.z * 0.65 / wreck.scale),
            });
            this.fireCount++;
          }
        }
        if (this.time >= sequence.nextFire) sequence.nextFire = this.time + 0.4;
      }
    }
    this.destructions = this.destructions.filter(sequence => this.time < sequence.burst.time + 6);
  }

  advance(moving, effects, weaponKinds) {
    const time = this.time;
    this.presentationMoving = moving;
    this.waves?.advance();
    this.orders?.apply();
    if (this.fleetLod) {
      const expired = new Set();
      for (const effect of effects) {
        if (time >= effect.time + effect.lifetime) { expired.add(effect); effects.delete(effect); }
      }
      if (expired.size) this.space.weaponRenderPass.remove(expired);
    }
    for (let index = 0; index < this.entities.length; index++) {
      const entity = this.entities[index];
      if (!isHeroShipActive(entity)) continue;
      entity.position.copy(this.positionAt(index, time, moving));
      if (moving) {
        const capital = this.formation === 'mixed'
          ? ['carrier', 'standoff'].includes(entity.heroStatus.role) : index % 2;
        const direction = this.cinematic && capital && !entity.heroStatus?.group && !this.orders
          ? new Vector3(index < this.entities.length / 2 ? 1 : -1, 0, 0)
          : this.positionAt(index, time + 0.02, true).sub(entity.position).normalize();
        entity.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction);
      }
    }
    if (this.cinematic) this.updateDamage(moving);
    this.orders?.react();
    for (let index = 0; index < this.entities.length; index++) {
      const entity = this.entities[index];
      if (!isHeroShipActive(entity)) continue;
      let targetIndex = (index + this.entities.length / 2) % this.entities.length;
      let decision = null;
      if (this.tactics) {
        decision = this.tactics.decision(index, time);
        if (entity.heroDecisionPhase !== decision.phase || !isHeroShipActive(this.entities[entity.heroTargetIndex])) {
          entity.heroTargetIndex = this.tactics.target(index, time, this.entities);
          entity.heroDecisionPhase = decision.phase;
          this.decisions.push({ step: this.step, source: index, target: entity.heroTargetIndex,
            phase: decision.phase, strategy: decision.strategy });
          if (this.decisions.length > 1152) this.decisions.shift();
        }
        targetIndex = entity.heroTargetIndex;
        if (targetIndex < 0) continue;
      }
      if (this.cinematic && !isHeroShipActive(this.entities[targetIndex])) {
        const start = index < this.entities.length / 2 ? this.entities.length / 2 : 0;
        targetIndex = this.entities.findIndex((candidate, candidateIndex) => candidateIndex >= start
          && candidateIndex < start + this.entities.length / 2 && isHeroShipActive(candidate));
        if (targetIndex < 0) continue;
      }
      if (this.orders) {
        targetIndex = this.orders.target(index, targetIndex);
        if (targetIndex < 0) continue;
      }
      const target = this.entities[targetIndex];
      const priority = this.fleetLod && index % (this.entities.length / 2) === 0 ? 2 : 0;
      const age = time - (entity.lastHeroShot ?? -10);
      entity.turretRecoil = age < 0.25 ? 0.035 * (1 - age / 0.25) : 0;
      const mount = aimHeroTurret(entity, target.position, 1 / 60, entity.turretRecoil);
      entity.weaponMount.position.copy(mount.position);
      entity.weaponMount.quaternion.copy(mount.quaternion);
      entity.muzzleOffset = mount.muzzleOffset;
      entity.heroLight.hull *= 0.94;
      entity.heroLight.shield *= 0.92;
      entity.heroContact.age += 1 / 60;
      const profile = this.formation === 'mixed' ? HERO_SHIP_PROFILES[entity.heroStatus.shipClass] : null;
      const period = profile?.shotPeriod ?? 84;
      const offset = 60 + (this.tactics ? Math.floor(this.tactics.variation(index, 0, 8) * period)
        : this.entities.length === 4 ? index * 12 : Math.floor(index * period / this.entities.length));
      const phaseStep = ((this.step - offset) % period + period) % period;
      if (this.orders && !this.orders.canFire(index)) continue;
      if (this.step >= offset - 12 && phaseStep === period - 12) {
        const muzzle = resolveWeaponMuzzle(entity.weaponMount, entity.muzzleOffset);
        const charge = this.space.weaponRenderPass.fire(muzzle, muzzle, {
          time, flash: true, charge: true, width: 9, lifetime: 0.2, color: [0.35, 0.7, 1.5],
          source: entity.weaponMount, muzzleOffset: entity.muzzleOffset,
          priority,
        });
        charge.replay = true;
        effects.add(charge);
      }
      if (this.step < offset || phaseStep !== 0) continue;
      const activeOrder = this.orders?.active.get(entity.heroStatus?.group);
      const ordered = (activeOrder && activeOrder.action !== 'auto')
        || this.orders?.reactions.has(this.orders.enemyGroup(index));
      if (!ordered && decision?.strategy === 'withdraw' && time - decision.at < 1.5) continue;
      const closeAttack = profile ? ['hit-and-run', 'interceptor'].includes(profile.role) : index % 2 === 0;
      if (!ordered && this.cinematic && closeAttack && (!decision || ['flank', 'focus-fire'].includes(decision.strategy))
        && Math.abs(entity.position.x - this.center.x) > this.scale * 4.8) continue;
      const cycle = Math.floor((this.step - offset) / period);
      const allowedWeapons = profile ? weaponKinds.filter(kind => profile.weapons.includes(kind)) : weaponKinds;
      const weapons = allowedWeapons.length ? allowedWeapons : weaponKinds;
      const kind = weapons[this.tactics ? Math.floor(this.tactics.variation(index, cycle, 9) * weapons.length)
        : (profile ? cycle + index : cycle * this.entities.length + index) % weapons.length];
      const outcome = ['shield', 'hull', 'miss'][(cycle + index + this.seed) % 3];
      const flight = SPACE_WEAPON_PROFILES[kind].flightSeconds;
      const targetNormal = entity.position.clone().sub(target.position).normalize();
      const targetCapital = this.formation === 'mixed'
        ? ['carrier', 'standoff'].includes(target.heroStatus.role) : targetIndex % 2;
      const futureQuaternion = target.heroDestroyed ? target.quaternion.clone() : moving && this.cinematic && targetCapital && !target.heroStatus?.group && !this.orders
        ? new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0),
          new Vector3(targetIndex < this.entities.length / 2 ? 1 : -1, 0, 0)) : moving
        ? new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0),
          this.positionAt(targetIndex, time + flight + 0.02, true)
            .sub(this.positionAt(targetIndex, time + flight, true)).normalize())
        : target.quaternion.clone();
      const impactOffset = targetNormal.clone().applyQuaternion(futureQuaternion.invert())
        .multiplyScalar(outcome === 'shield' ? 0.65 : 0.25);
      const aim = this.positionAt(targetIndex, time + flight, moving)
        .addScaledVector(targetNormal, target.scale * (outcome === 'shield' ? 0.65 : 0.25));
      if (outcome === 'miss') aim.z += this.scale * 1.5;
      const shot = this.space.weaponRenderPass.fireWeapon(kind, entity.weaponMount, aim, {
        time, muzzleOffset: entity.muzzleOffset, impact: outcome !== 'miss',
        impactKind: outcome === 'miss' ? 'generic' : outcome,
        impactNormal: targetNormal, target: outcome !== 'miss' ? target : null,
        impactOffset: outcome !== 'miss' ? impactOffset : null,
        sourceVelocity: this.positionAt(index, time + 0.02, moving).sub(entity.position).divideScalar(0.02),
        priority,
      });
      shot.replay = true;
      effects.add(shot);
      this.shots++;
      this.outcomes[outcome]++;
      this.log.push({ step: this.step, source: index, target: targetIndex, kind, outcome,
        ...(decision ? { strategy: decision.strategy, phase: decision.phase } : {}),
        ...(this.orders ? { order: this.orders.active.get(entity.heroStatus?.group)?.action ?? null } : {}),
        ...(this.orders?.enemyGroup(index) ? {
          reaction: this.orders.reactions.get(this.orders.enemyGroup(index))?.action ?? null,
        } : {}),
        from: shot.from.toArray(), to: shot.to.toArray() });
      if (this.log.length > 256) this.log.shift();
      if (outcome !== 'miss') this.impacts.push({ at: time + flight, target, shot, outcome });
      entity.lastHeroShot = time;
      this.audio?.play(kind, shot.from, this.space.camera, this.space.origin);
    }
    for (const impact of this.impacts) {
      if (impact.played || time < impact.at) continue;
      impact.played = true;
      if (impact.target.heroDestroyed) continue;
      impact.target.heroLight[impact.outcome] = 0.6;
      impact.target.heroContact.normal.copy(impact.shot.targetOffset).normalize();
      impact.target.heroContact.age = 0;
      this.audio?.play(impact.shot.kind, resolveWeaponMuzzle(impact.target, impact.shot.targetOffset),
        this.space.camera, this.space.origin, true);
    }
    this.impacts = this.impacts.filter((impact) => time < impact.at + 0.8);
    if (this.fleetLod) {
      const retained = new Set(this.space.weaponRenderPass.effects);
      for (const effect of effects) if (!retained.has(effect)) effects.delete(effect);
    }
  }

  snapshot() {
    return { seed: this.seed, view: this.view, formation: this.formation, replayTime: this.time, shots: this.shots,
      scenario: this.scenario, command: this.orders?.snapshot() ?? null,
      waves: this.waves?.snapshot() ?? { enabled: false },
      tactics: { enabled: this.tacticsEnabled, ...this.tactics?.snapshot(),
        decisions: this.decisions.map(decision => ({ ...decision })) },
      outcomes: { ...this.outcomes }, log: this.log.map((entry) => ({ ...entry, from: [...entry.from], to: [...entry.to] })),
      metrics: this.metrics.snapshot(),
      audio: { enabled: this.audioEnabled, played: this.audio?.played || 0, voices: this.audio?.voices.size || 0 },
      hdr: this.space.bloom?.sceneFormat === 'rgba16float', bloom: !!this.space.bloom,
      limits: { effects: 64, primitives: this.fleetLod ? this.primitiveBudget : 768 },
      fleet: { enabled: this.fleetLod, ships: this.entities?.length || 0,
        weapons: { ...this.lastWeaponStats },
        vessels: { ...this.lastVesselStats },
        peakPrimitives: this.peakPrimitives, peakShipDrawCalls: this.peakShipDrawCalls,
        peakRetainedEffects: this.peakRetainedEffects,
        evicted: this.space.weaponRenderPass.evictedEffects - this.budgetCounters.evicted,
        rejected: this.space.weaponRenderPass.rejectedEffects - this.budgetCounters.rejected },
      presentation: { enabled: this.cinematic, fires: this.fireCount, explosions: this.explosionCount,
        debrisClouds: this.debrisCount,
        activeDestructions: this.destructions.length,
        primitiveLimit: 128, drawnPrimitives: this.lastDamagePrimitives,
        peakPrimitives: this.peakDamagePrimitives,
        meshDebris: this.debrisPass.snapshot(),
        ships: this.entities?.map((entity) => ({ id: entity.id, ...entity.heroStatus })) || [] } };
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.destructions.length = 0;
    const errors = [];
    try { this.hud?.dispose(); } catch (error) { errors.push(error); }
    try { this.commandPanel?.dispose(); } catch (error) { errors.push(error); }
    try { this.orders?.dispose(); } catch (error) { errors.push(error); }
    try { this.damagePass.clear(); this.damagePass.dispose(); } catch (error) { errors.push(error); }
    try { this.debrisPass.dispose(); } catch (error) { errors.push(error); }
    try { this.depth.dispose(); } catch (error) { errors.push(error); }
    try { await this.metrics.dispose(); } catch (error) { errors.push(error); }
    try { await this.audio?.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Hero battle resource cleanup failed');
  }
}
