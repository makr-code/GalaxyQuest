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

  it('keeps debris targeting contract: explicit id first, nearest-position fallback second', () => {
    expect(source).toMatch(/const\s+targetDebrisId\s*=\s*this\._normalizeWeaponFireDebrisId\(/);
    expect(source).toMatch(/if\s*\(targetDebrisId\)\s*\{[\s\S]*?this\.debrisManager\.get\(targetDebrisId\)[\s\S]*?this\.debrisManager\.get\(String\(targetDebrisId\)\)/);
    expect(source).toMatch(/if\s*\(!nearestDebris\s*&&\s*targetPos\)\s*\{[\s\S]*?_findNearestDebrisToPosition\(targetPos,\s*50\)/);
  });

  it('keeps debris damage + fragment spawn pipeline contract', () => {
    expect(source).toMatch(/this\.debrisManager\.applyDamage\(nearestDebris\.id,\s*damageAmount,\s*\{/);
    expect(source).toMatch(/attacker:\s*String\(ev\.sourceOwner\s*\|\|\s*'unknown'\)/);
    expect(source).toMatch(/weaponKind:\s*String\(ev\.weaponKind\s*\|\|\s*'impact'\)/);
    expect(source).toMatch(/const\s+debris\s*=\s*this\.debrisManager\.get\(nearestDebris\.id\)/);
    expect(source).toMatch(/this\._spawnDebrisFragmentsByState\(debris,\s*impactPos,\s*elapsed\)/);
  });

  it('keeps debris state intensity mapping and destruction event contract', () => {
    expect(source).toMatch(/switch\s*\(debris\.state\)\s*\{/);
    expect(source).toMatch(/case\s*'damaged'\s*:[\s\S]*?fragmentCount\s*=\s*6/);
    expect(source).toMatch(/case\s*'critical'\s*:[\s\S]*?fragmentCount\s*=\s*12/);
    expect(source).toMatch(/case\s*'destroyed'\s*:[\s\S]*?fragmentCount\s*=\s*24/);
    expect(source).toMatch(/window\.dispatchEvent\(new\s+CustomEvent\('gq:debris:destroyed'/);
  });

  it('keeps installation cadence table values for alert and non-alert states', () => {
    expect(source).toMatch(/_installationWeaponFxCadence\(kind,\s*state\)/);
    expect(source).toMatch(/case\s*'plasma':\s*return\s*alert\s*\?\s*0\.75\s*:\s*1\.15;/);
    expect(source).toMatch(/case\s*'rail':\s*return\s*alert\s*\?\s*0\.42\s*:\s*0\.8;/);
    expect(source).toMatch(/case\s*'missile':\s*return\s*alert\s*\?\s*1\.35\s*:\s*2\.1;/);
    expect(source).toMatch(/case\s*'beam':[\s\S]*?default:[\s\S]*?return\s*alert\s*\?\s*0\.28\s*:\s*0\.5;/);
  });

  it('keeps installation shot duration table values for alert and non-alert states', () => {
    expect(source).toMatch(/_installationWeaponFxShotDuration\(kind,\s*state\)/);
    expect(source).toMatch(/case\s*'plasma':\s*return\s*alert\s*\?\s*0\.52\s*:\s*0\.36;/);
    expect(source).toMatch(/case\s*'rail':\s*return\s*alert\s*\?\s*0\.1\s*:\s*0\.08;/);
    expect(source).toMatch(/case\s*'missile':\s*return\s*alert\s*\?\s*0\.72\s*:\s*0\.55;/);
    expect(source).toMatch(/case\s*'beam':[\s\S]*?default:[\s\S]*?return\s*alert\s*\?\s*0\.34\s*:\s*0\.22;/);
  });

  it('keeps trigger integration multiplying cadenceScale and using shotDuration', () => {
    expect(source).toMatch(/const\s+cadence\s*=\s*this\._installationWeaponFxCadence\(fxEntry\.kind,\s*activeState\)\s*\*\s*Math\.max\(0\.1,\s*Number\(cadenceScale\)\s*\|\|\s*1\)/);
    expect(source).toMatch(/const\s+shotDuration\s*=\s*this\._installationWeaponFxShotDuration\(fxEntry\.kind,\s*activeState\)/);
    expect(source).toMatch(/fxEntry\.fireUntil\s*=\s*Math\.max\(Number\(fxEntry\.fireUntil\s*\|\|\s*0\),\s*elapsed\s*\+\s*shotDuration\)/);
    expect(source).toMatch(/fxEntry\.nextFireAt\s*=\s*elapsed\s*\+\s*cadence/);
  });
});
