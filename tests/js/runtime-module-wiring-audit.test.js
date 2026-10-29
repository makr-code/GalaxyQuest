import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve(process.cwd(), 'js/main.js');
const indexPath = path.resolve(process.cwd(), 'index.html');
const moduleLoaderPath = path.resolve(process.cwd(), 'js/runtime/runtime-module-loader.js');
const expectedInitializers = [
  'initializeAllianceDomain',
  'initializeColonizationDomain',
  'initializeDiplomacyDomain',
  'initializeEconomyDomain',
  'initializeEspionageDomain',
  'initializeEventDomain',
  'initializeFleetDomain',
  'initializeGalaxyDomain',
  'initializeMarketDomain',
  'initializeNPCDomain',
  'initializeResearchDomain',
  'initializeWarDomain',
];

function collectMainDomainImports(source) {
  const imports = new Map();
  const importPattern = /import\s+\{\s*(initialize\w+Domain)\s*\}\s+from\s+['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(importPattern)) {
    imports.set(match[1], path.resolve(path.dirname(mainPath), match[2]));
  }

  return imports;
}

function collectBootDomainInitializers(source) {
  const initializers = new Set();
  const initializerPattern = /\{\s*name:\s*'[^']+'\s*,\s*fn:\s*(initialize\w+Domain)\s*\}/g;

  for (const match of source.matchAll(initializerPattern)) {
    initializers.add(match[1]);
  }

  return initializers;
}

describe('runtime module wiring audit', () => {
  it('loads auth and renderer through the ES module composition root', () => {
    const mainSource = fs.readFileSync(mainPath, 'utf8');
    const indexSource = fs.readFileSync(indexPath, 'utf8');
    const loaderSource = fs.readFileSync(moduleLoaderPath, 'utf8');
    const authSource = fs.readFileSync(path.resolve(process.cwd(), 'js/network/auth.js'), 'utf8');
    const starfieldSource = fs.readFileSync(path.resolve(process.cwd(), 'js/rendering/starfield.js'), 'utf8');

    expect(mainSource).toContain("import './network/auth.js';");
    expect(mainSource).toContain("import './rendering/starfield.js';");
    expect(indexSource).toContain('<script type="module" src="/js/main.js"></script>');
    expect(indexSource).not.toContain('window.__GQ_AUTH_FORCE_WEBGL = true;');
    expect(indexSource).not.toMatch(/<script\s+src="js\/(?:network\/auth|rendering\/starfield)\.js/);
    expect(loaderSource).toContain("['js/runtime/wm.js'");
    expect(loaderSource).toContain("['js/runtime/wm-widgets.js'");
    expect(loaderSource).toContain("['js/runtime/gqwm.js'");
    expect(loaderSource).toContain("['js/rendering/galaxy-renderer-core.js'");
    expect(loaderSource).toContain("['js/legacy/galaxy3d-webgpu.js'");
    expect(mainSource).toContain("'gq:authenticated'");
    expect(authSource).toContain("new CustomEvent('gq:authenticated')");
    expect(starfieldSource).toContain("import { loadAuthGalaxySamples } from './auth-galaxy-loader.js';");
    expect(starfieldSource).toContain('runtime.renderer.setStars?.(runtime.stars, { preserveView: true });');
  });

  it('keeps every ES module domain import wired into the main boot sequence', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const imports = collectMainDomainImports(source);
    const initializers = collectBootDomainInitializers(source);

    expect([...imports.keys()].sort()).toEqual(expectedInitializers);
    expect([...initializers].sort()).toEqual(expectedInitializers);
    expect([...imports.values()].every((filePath) => fs.existsSync(filePath))).toBe(true);
  });
});
