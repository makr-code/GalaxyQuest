import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const modulePaths = [
  'js/engine/runtime/RuntimeGalaxyInit3DFacade.js',
  'js/engine/runtime/layers/integration/galaxy/Init3DFacade.js',
].map((relativePath) => path.resolve(process.cwd(), relativePath));

function loadModule(modulePath) {
  delete window.GQRuntimeGalaxyInit3DFacade;
  window.eval(fs.readFileSync(modulePath, 'utf8'));
  return window.GQRuntimeGalaxyInit3DFacade;
}

function createRoot(documentRef) {
  const root = documentRef.createElement('main');
  const details = documentRef.createElement('div');
  details.id = 'galaxy-system-details';
  root.append(details);
  return { root, details };
}

describe.each(modulePaths)('Galaxy renderer initialization errors: %s', (modulePath) => {
  it('renders missing-host diagnostics as text and preserves overlay behavior', () => {
    const api = loadModule(modulePath);
    const documentRef = document.implementation.createHTMLDocument();
    const { root, details } = createRoot(documentRef);
    const payload = '<img src=x onerror=alert(1)>';
    const esc = vi.fn((value) => value);
    const toggleGalaxyOverlay = vi.fn();

    api.configureGalaxyInit3DFacadeRuntime({
      documentRef,
      windowRef: { document: documentRef },
      getGalaxy3dInitReason: () => payload,
      setGalaxy3dInitReason: vi.fn(),
      emitRuntimeEvent: vi.fn(),
      toggleGalaxyOverlay,
      esc,
    });

    api.initGalaxy3D(root);

    expect(details.querySelector('.text-red')?.textContent)
      .toBe(`3D engine failed to load. Reason: ${payload}`);
    expect(details.querySelector('img, [onerror]')).toBeNull();
    expect(esc).not.toHaveBeenCalled();
    expect(toggleGalaxyOverlay).toHaveBeenCalledWith(root, '#galaxy-info-overlay', true);
  });

  it('renders missing-Three diagnostics as text while retaining the recovery guard', () => {
    const api = loadModule(modulePath);
    const documentRef = document.implementation.createHTMLDocument();
    const { root, details } = createRoot(documentRef);
    const host = documentRef.createElement('div');
    host.id = 'galaxy-3d-host';
    documentRef.body.append(host);
    const esc = vi.fn((value) => value);
    const toggleGalaxyOverlay = vi.fn();
    const windowRef = { document: documentRef, __GQ_THREE_RECOVERY_IN_FLIGHT: true };

    api.configureGalaxyInit3DFacadeRuntime({
      documentRef,
      windowRef,
      emitRuntimeEvent: vi.fn(),
      setGalaxy3dInitReason: vi.fn(),
      toggleGalaxyOverlay,
      esc,
    });

    api.initGalaxy3D(root);

    expect(details.querySelector('.text-red')?.textContent)
      .toBe('3D renderer unavailable. Fallback list active. Reason: THREE is missing or invalid (Scene constructor unavailable)');
    expect(details.querySelector('img, [onerror]')).toBeNull();
    expect(windowRef.__GQ_THREE_RECOVERY_IN_FLIGHT).toBe(true);
    expect(esc).not.toHaveBeenCalled();
    expect(toggleGalaxyOverlay).toHaveBeenCalledWith(root, '#galaxy-info-overlay', true);
  });
});
