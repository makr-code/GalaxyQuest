import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mainPath = path.resolve(process.cwd(), 'js/main.js');
const indexPath = path.resolve(process.cwd(), 'index.html');
const moduleLoaderPath = path.resolve(process.cwd(), 'js/runtime/runtime-module-loader.js');
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
    expect(authSource).toContain('await startAuthenticatedGame();');
    expect(authSource).toContain("new CustomEvent('gq:authenticated')");
    expect(starfieldSource).toContain("import { loadAuthGalaxySamples } from './auth-galaxy-loader.js';");
    expect(starfieldSource).toContain(
      'runtime.renderer.setStars?.(renderableStars(runtime.stars), { preserveView: true });'
    );
  });

  it('awaits real server state instead of launching placeholder domains after showing the shell', () => {
    const source = fs.readFileSync(mainPath, 'utf8');
    const auth = fs.readFileSync(path.resolve('js/network/auth.js'), 'utf8');
    const session = fs.readFileSync(path.resolve('js/engine/runtime/server-game-session.js'), 'utf8');
    expect(source).not.toContain('loadEconomyState');
    expect(source).not.toContain('initializeEconomyDomain');
    const boot = auth.slice(auth.indexOf('async function startGameShell()'));
    expect(boot.indexOf('await startAuthenticatedGame();')).toBeLessThan(boot.indexOf('setGameVisible();'));
    expect(session).toContain("api/game.php?action=overview");
    expect(session).not.toContain('setInterval');
    expect(auth).toContain('shutdownAuthenticatedGame();');
  });
});
