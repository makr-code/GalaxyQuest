import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStartFlightTour } from '../../js/rendering/start-flight-tour.js';

const target = {
  galaxy_index: 1,
  system_index: 42,
  name: 'Test System',
  x_ly: 20,
  y_ly: -4,
  z_ly: 80,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('read-only start flight tour', () => {
  it('resumes saved coordinates before selecting a DB target and persists only flight coordinates', async () => {
    vi.useFakeTimers();
    const savedState = { start: [1, 2, 3], destination: [10, 20, 30] };
    const scenes = [];
    const order = [];
    let sceneAttempts = 0;
    const writeFlightState = vi.fn();
    const clearFlightState = vi.fn();
    const navigateTo = vi.fn(() => new Promise((resolve) => { order.push('navigate'); order.resolve = resolve; }));
    const tour = createStartFlightTour({
      getStars: () => [],
      showScene: (scene) => {
        scenes.push(scene);
        order.push('scene');
        sceneAttempts += 1;
        return sceneAttempts > 1;
      },
      readResumeState: () => savedState,
      restoreFlightCoordinates: (coordinates) => {
        order.push('restore');
        expect(coordinates).toEqual(savedState);
        return true;
      },
      getFlightCoordinates: () => ({ start: [2, 3, 4], destination: [10, 20, 30] }),
      writeFlightState,
      clearFlightState,
      navigateTo,
      flightDurationMs: 5000,
      retryDelayMs: 5000,
    });

    tour.start();
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(0);
    expect(order.slice(0, 4)).toEqual(['scene', 'scene', 'restore', 'navigate']);
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'point', x_ly: 10, y_ly: 20, z_ly: 30 },
      expect.objectContaining({ durationMs: 5000 }));
    expect(writeFlightState).toHaveBeenCalledWith({ start: [2, 3, 4], destination: [10, 20, 30] });

    await vi.advanceTimersByTimeAsync(1000);
    expect(writeFlightState).toHaveBeenCalledTimes(2);
    order.resolve(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(writeFlightState).toHaveBeenLastCalledWith({ start: [10, 20, 30], destination: [10, 20, 30] });

    tour.stop();
    expect(clearFlightState).toHaveBeenCalledOnce();
    expect(scenes.at(-1)).toBeNull();
  });

  it('flies from region through system, planet and preview-only surface using DB targets', async () => {
    vi.useFakeTimers();
    const scenes = [];
    const status = vi.fn();
    const navigateTo = vi.fn(async () => true);
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        preview_only: true,
        system: { ...target, temperature_k: 5778 },
        planets: [
          { position: 1, planet_class: 'gas_giant', can_colonize: false, semi_major_axis_au: 5.2,
            moons: [{ moon_index: 101, name: 'Test Moon', planet_class: 'ice_dwarf', semi_major_axis_parent_r: 8 }] },
          { position: 2, planet_class: 'rocky', can_colonize: true, semi_major_axis_au: 1.0,
            facilities: [{ type: 'shipyard', label: 'Shipyard', level: 2, zone: 'orbital' },
              { type: 'hydroponic_farm', label: 'Hydroponic Farm', level: 3, zone: 'surface' }],
            moons: [{ moon_index: 201, name: 'Colonizable Moon', planet_class: 'rocky', semi_major_axis_parent_r: 6 }] },
        ],
        free_comets: [{ body_id: 'g1-s42-c1', body_type: 'comet', name: 'Icarus',
          diameter_km: 12, semi_major_axis_au: 45, orbital_eccentricity: 0.86, local_x: 44, local_y: 1, local_z: 0 }],
        rogue_planets: [{ body_id: 'g1-s42-r1', body_type: 'rogue_planet', name: 'Drifter',
          planet_class: 'ice_dwarf', diameter_km: 5000, local_x: -70, local_y: 4, local_z: 0 }],
        star_installations: [{ type: 'stargate', label: 'Stargate', level: 2, position: 2 }],
        planet_texture_manifest: { planets: {
          2: { seed: 8123, variant: 'ocean', palette: { base: '#166a88', accent: '#62cde0' }, clouds: 0.7, atmosphere: 0.65 },
        } },
      }),
    }));
    const tour = createStartFlightTour({
      getStars: () => [target],
      showScene: (scene) => { scenes.push(scene); return true; },
      navigateTo,
      onStatus: status,
      fetchImpl,
      random: () => 0.99,
      regionDurationMs: 5,
      flightDurationMs: 5,
      systemDurationMs: 5,
      planetDurationMs: 5,
      surfaceDurationMs: 5,
      retryDelayMs: 5,
    });

    tour.start();
    await vi.advanceTimersByTimeAsync(25);

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('action=auth_flight_preview'), expect.objectContaining({
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'system' }, expect.objectContaining({ durationMs: 5 }));
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'planet', position: 2 }, expect.any(Object));
    expect(navigateTo).toHaveBeenCalledWith({ kind: 'moon', position: 201, parentPosition: 2 }, expect.any(Object));
    expect(scenes.map((scene) => scene?.stage)).toContain('region');
    expect(scenes.map((scene) => scene?.stage)).toContain('system');
    expect(scenes.map((scene) => scene?.stage)).toContain('planet');
    expect(scenes.map((scene) => scene?.stage)).toContain('moon');
    expect(scenes.map((scene) => scene?.stage)).toContain('surface');
    const surfaceScene = scenes.find((scene) => scene?.stage === 'surface');
    expect(surfaceScene.sceneGraph.type).toBe('galaxy');
    expect(surfaceScene.sceneGraph.children[0].children[1].children[0].type).toBe('moon');
    expect(surfaceScene.sceneGraph.children[0].children[1].children.map((node) => node.type))
      .toContain('facility');
    expect(surfaceScene.sceneGraph.children[0].children.map((node) => node.type))
      .toEqual(expect.arrayContaining(['comet', 'rogue_planet', 'star-installation']));
    expect(surfaceScene.sceneGraph.children[0].children[1].data.texture).toEqual({
      seed: 8123, variant: 'ocean', palette: { base: '#166a88', accent: '#62cde0' }, clouds: 0.7, atmosphere: 0.65,
    });
    const surface = scenes.find((scene) => scene?.stage === 'surface');
    expect(surface.flightTour).toBe(true);
    expect(surface.draft.preview_only).toBe(true);
    expect(surface.draft.position.position).toBe(2);
    tour.stop();
    expect(scenes.at(-1)).toBeNull();
    expect(status).toHaveBeenCalled();
  });

  it('retries while DB targets are unavailable and stops without issuing writes', async () => {
    vi.useFakeTimers();
    const scenes = [];
    const fetchImpl = vi.fn();
    let stars = [];
    const tour = createStartFlightTour({
      getStars: () => stars,
      showScene: (scene) => { scenes.push(scene); return true; },
      fetchImpl,
      retryDelayMs: 50,
    });
    tour.start();
    await vi.advanceTimersByTimeAsync(20);
    expect(fetchImpl).not.toHaveBeenCalled();
    stars = [target];
    tour.stop();
    expect(scenes.at(-1)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('does not advance targets on a timer while the spatial camera is still flying', async () => {
    vi.useFakeTimers();
    const scenes = [];
    let arrive;
    const navigateTo = vi.fn(() => new Promise((resolve) => { arrive = resolve; }));
    const tour = createStartFlightTour({
      getStars: () => [target],
      showScene: (scene) => { scenes.push(scene); return true; },
      navigateTo,
      fetchImpl: async () => ({ ok: true, json: async () => ({ success: true, preview_only: true,
        system: target, planets: [{ position: 1, can_colonize: true, planet_class: 'rocky' }] }) }),
      flightDurationMs: 5,
    });
    tour.start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(navigateTo).toHaveBeenCalledTimes(1);
    expect(scenes.at(-1).stage).toBe('system');
    arrive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(scenes.at(-1).stage).toBe('planet');
    tour.stop();
    arrive(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(scenes.at(-1)).toBeNull();
  });
});