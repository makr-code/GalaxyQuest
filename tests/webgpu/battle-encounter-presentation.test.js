import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import {
  normalizeBattleEncounter,
  startBattleEncounterPresentation,
} from '../../js/rendering/battle-encounter-presentation.js';

afterEach(() => {
  vi.useRealTimers();
});

function encounterFixture() {
  return {
    id: 21,
    schema_version: 1,
    rule_version: 'legacy-v1',
    status: 'resolved',
    revision: 2,
    battle_report_id: 38,
    participants: [
      { side: 'attacker', initial_ships: { light_fighter: 4, cruiser: 1 } },
      { side: 'defender', initial_ships: { light_fighter: 3 } },
    ],
    events: [{
      event_type: 'encounter_created',
      payload: { target: { galaxy: 1, system: 2, position: 3 } },
    }, {
      event_type: 'encounter_resolved',
      payload: { battle_report_id: 38, attacker_wins: true, illustrative_rounds: true },
    }],
    outcome: {
      version: 1,
      attacker_wins: true,
      attacker_ships: { light_fighter: 4, cruiser: 1 },
      attacker_lost: { light_fighter: 1, cruiser: 0 },
      attacker_survivors: { light_fighter: 3, cruiser: 1 },
      defender_ships: { light_fighter: 3 },
      defender_lost: { light_fighter: 2 },
      rounds: [
        { round: 1, attacker_pressure: 12, defender_pressure: 8 },
        { round: 2, attacker_pressure: 10, defender_pressure: 6 },
      ],
    },
  };
}

function rendererFixture({ withTarget = true } = {}) {
  const body = {
    userData: { type: 'planet', data: { position: 3 }, radius: 2 },
    getWorldPosition: (target) => target.set(1, 2, 3),
  };
  const entities = new Map();
  const effects = [];
  const space = {
    bodies: withTarget ? [body] : [],
    camera: new PerspectiveCamera(),
    origin: new Vector3(100, 200, 300),
    root: {},
    spaceEntities: entities,
    weaponRenderPass: {
      fire: (...args) => {
        const effect = { args };
        effects.push(effect);
        return effect;
      },
      remove: (removed) => {
        for (const effect of removed) {
          const index = effects.indexOf(effect);
          if (index >= 0) effects.splice(index, 1);
        }
      },
    },
    registerSpaceVessel: (options) => {
      const position = new Vector3().fromArray(options.route[0]);
      entities.set(options.id, {
        id: options.id,
        position,
        quaternion: new Quaternion(),
        scale: options.visual_scale_ly,
      });
      return Promise.resolve(true);
    },
    _removeSpaceEntity: (entity) => entities.delete(entity.id),
  };
  const renderer = {
    getSpaceView: () => space,
    getSharedZoomBackend: () => ({ addFrameHook: () => () => {} }),
  };
  return { renderer, space, entities, effects };
}

describe('server-backed battle presentation', () => {
  it('normalizes exact participant compositions, losses and aggregate pressure', () => {
    const result = normalizeBattleEncounter(encounterFixture());

    expect(result).toMatchObject({
      id: 21,
      reportId: 38,
      target: { galaxy: 1, system: 2, position: 3 },
      attackerWins: true,
      attackerLost: { light_fighter: 1, cruiser: 0 },
      attackerSurvivors: { light_fighter: 3, cruiser: 1 },
      defenderSurvivors: { light_fighter: 1 },
      rounds: [
        { round: 1, attackerPressure: 12, defenderPressure: 8 },
        { round: 2, attackerPressure: 10, defenderPressure: 6 },
      ],
    });
  });

  it.each([
    ['composition mismatch', (encounter) => { encounter.outcome.attacker_ships.light_fighter = 99; }],
    ['non-conserved attacker losses', (encounter) => { encounter.outcome.attacker_lost.light_fighter = 3; }],
    ['invalid target position', (encounter) => { encounter.events[0].payload.target.position = 0; }],
    ['unsupported rule version', (encounter) => { encounter.rule_version = 'next-v2'; }],
  ])('rejects %s instead of inventing presentation data', (_label, mutate) => {
    const encounter = encounterFixture();
    mutate(encounter);
    expect(() => normalizeBattleEncounter(encounter)).toThrow(TypeError);
  });

  it('plays non-impact aggregate cues and cleans only replay-owned scene objects', async () => {
    const { renderer, space, entities, effects } = rendererFixture();
    const replay = await startBattleEncounterPresentation(renderer, encounterFixture());

    expect(entities.size).toBe(8);
    expect(effects).toHaveLength(4);
    expect(space.camera.position.toArray()).toEqual([1, -34, 17]);
    expect(document.querySelector('[data-battle-encounter-presentation="21"]')
      .textContent).toContain('keine einzelnen Schüsse oder Treffer');
    expect(document.querySelector('[data-battle-encounter-presentation="21"]')
      .textContent).toContain('R1 Angreifer 12 · Verteidiger 8');
    expect(document.querySelector('[data-battle-encounter-presentation="21"]')
      .textContent).toContain('Angreifer 5 → 4 (1 verloren) · Verteidiger 3 → 1 (2 verloren)');
    replay.stop();
    await expect(replay.finished).resolves.toEqual({ encounterId: 21, cleaned: true });
    expect(entities.size).toBe(0);
    expect(effects).toHaveLength(0);
    expect(space.camera.position.toArray()).toEqual([0, 0, 0]);
  });

  it('does not restore over camera movement made by the player during replay', async () => {
    const { renderer, space } = rendererFixture();
    const replay = await startBattleEncounterPresentation(renderer, encounterFixture());
    space.camera.position.set(7, 8, 9);
    replay.stop();
    await replay.finished;
    expect(space.camera.position.toArray()).toEqual([7, 8, 9]);
  });

  it('requires the encounter target to be present in the rendered system', async () => {
    const { renderer, entities } = rendererFixture({ withTarget: false });
    await expect(startBattleEncounterPresentation(renderer, encounterFixture()))
      .rejects.toThrow('Das Zielsystem muss gerendert sein');
    expect(entities.size).toBe(0);
  });

  it('surfaces cleanup failures together with a replay setup failure', async () => {
    const { renderer, space } = rendererFixture();
    const registerSpaceVessel = space.registerSpaceVessel;
    space.registerSpaceVessel = async (options) => {
      await registerSpaceVessel(options);
      throw new Error('proxy load failed');
    };
    space._removeSpaceEntity = () => {
      throw new Error('cleanup failed');
    };

    await expect(startBattleEncounterPresentation(renderer, encounterFixture()))
      .rejects.toMatchObject({
        name: 'AggregateError',
        errors: [
          expect.objectContaining({ message: 'proxy load failed' }),
          expect.objectContaining({ message: 'cleanup failed' }),
        ],
      });
  });
});
