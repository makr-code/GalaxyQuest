import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

const corePath = path.resolve(process.cwd(), 'js/rendering/galaxy-renderer-core.js');
const source = fs.readFileSync(corePath, 'utf8');

describe('GalaxyRendererCore weapon-fire source contract', () => {
  it('routes multi-entity sourceType values in _applyPendingInstallationWeaponFire', () => {
    expect(source).toMatch(/switch\s*\(\s*eventSourceType\s*\)/);

    expect(source).toMatch(/case\s*'ship'\s*:\s*[\s\S]*?_applyWeaponFireToShips\(ev,\s*elapsed\)/);
    expect(source).toMatch(/case\s*'debris'\s*:\s*[\s\S]*?_applyWeaponFireToDebris\(ev,\s*elapsed\)/);
    expect(source).toMatch(/case\s*'wormhole'\s*:\s*[\s\S]*?case\s*'gate'\s*:\s*[\s\S]*?case\s*'beacon'\s*:\s*[\s\S]*?_applyWeaponFireToWormholes\(ev,\s*elapsed\)/);
    expect(source).toMatch(/case\s*'installation'\s*:\s*[\s\S]*?default\s*:\s*[\s\S]*?_applyWeaponFireToInstallations\(ev,\s*elapsed\)/);
  });

  it('enforces ship weapon cooldown and target-hint resolution path', () => {
    expect(source).toMatch(/_triggerShipWeaponFire\(fleetEntry,\s*ev,\s*elapsed,\s*state\s*=\s*'active'\)/);
    expect(source).toMatch(/const\s+weaponKey\s*=\s*String\(ev\?\.weaponKind\s*\|\|\s*'default'\)/);
    expect(source).toMatch(/if\s*\(elapsed\s*<\s*nextFireAt\)\s*return;/);
    expect(source).toMatch(/_normalizeWeaponFireTargetPos\(ev\?\.targetPos\s*\?\?\s*ev\?\.target_pos\s*\?\?\s*null\)/);
    expect(source).toMatch(/_resolveShipWeaponTarget\(fleetEntry,\s*shipWorldPos,\s*targetHint,\s*220\)/);
  });

  it('keeps ship target scoring biases for fleet/installation/debris and hint fallback', () => {
    expect(source).toMatch(/considerCandidate\(tmpPos,\s*'fleet',\s*-8\)/);
    expect(source).toMatch(/considerCandidate\(tmpPos,\s*'installation',\s*4\)/);
    expect(source).toMatch(/considerCandidate\(tmpPos,\s*'debris',\s*10\)/);
    expect(source).toMatch(/if\s*\(!best\s*&&\s*hintVec\)\s*\{\s*return\s*\{\s*type:\s*'hint'/);
  });

  it('contains wormhole destabilization rupture trigger contract', () => {
    expect(source).toMatch(/_applyWormholeDestabilizationHit\(installEntry,\s*ev,\s*elapsed\)/);
    expect(source).toMatch(/if\s*\(state\.progress\s*>=\s*1\s*&&\s*elapsed\s*>=\s*Number\(state\.cooldownUntil\s*\|\|\s*0\)\)\s*\{/);
    expect(source).toMatch(/state\.cooldownUntil\s*=\s*elapsed\s*\+\s*4\.5/);
    expect(source).toMatch(/this\._triggerWormholeRupture\(installEntry,\s*state,\s*elapsed\)/);
  });
});
