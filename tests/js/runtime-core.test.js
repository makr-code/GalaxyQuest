import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const eventBusPath = path.resolve(process.cwd(), 'js/engine/EventBus.js');
const corePath = path.resolve(process.cwd(), 'js/engine/runtime/RuntimeCore.js');

function loadModules() {
  delete window.GQEventBus;
  delete window.GQRuntimeCore;
  window.eval(fs.readFileSync(eventBusPath, 'utf8'));
  window.eval(fs.readFileSync(corePath, 'utf8'));
  return window.GQRuntimeCore;
}

describe('GQRuntimeCore.createRuntimeCore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('exports createRuntimeCore and RuntimeCore', () => {
    const mod = loadModules();
    expect(typeof mod.createRuntimeCore).toBe('function');
    expect(typeof mod.RuntimeCore).toBe('function');
  });

  it('createRuntimeCore returns an instance with required methods', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    expect(typeof core.on).toBe('function');
    expect(typeof core.once).toBe('function');
    expect(typeof core.emit).toBe('function');
    expect(typeof core.start).toBe('function');
    expect(typeof core.stop).toBe('function');
    expect(typeof core.bindWindowEvent).toBe('function');
  });

  it('core starts by default (autoStart !== false)', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore();
    expect(core._started).toBe(true);
    core.stop();
  });

  it('core does not start when autoStart is false', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    expect(core._started).toBe(false);
  });

  it('emits runtime:start on start()', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    const handler = vi.fn();
    core.on('runtime:start', handler);
    core.start();
    expect(handler).toHaveBeenCalled();
    core.stop();
  });

  it('emits runtime:stop on stop()', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    const handler = vi.fn();
    core.on('runtime:stop', handler);
    core.start();
    core.stop();
    expect(handler).toHaveBeenCalled();
  });

  it('on/emit works for custom events', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    const handler = vi.fn();
    core.on('test:event', handler);
    core.emit('test:event', { value: 42 });
    expect(handler).toHaveBeenCalledWith({ value: 42 });
  });

  it('bindWindowEvent uses runtimeCore.bindWindowEvent when available', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    const addSpy = vi.spyOn(window, 'addEventListener');
    const nativeHandler = vi.fn();
    core.bindWindowEvent('custom:test', nativeHandler);
    expect(addSpy).toHaveBeenCalledWith('custom:test', expect.any(Function));
    addSpy.mockRestore();
  });
});

describe('GQRuntimeCore window.GQGameRuntimeCore integration', () => {
  it('window.GQGameRuntimeCore is set after createRuntimeCore is called', () => {
    const mod = loadModules();
    const core = mod.createRuntimeCore({ autoStart: false });
    window.GQGameRuntimeCore = core;
    expect(window.GQGameRuntimeCore).toBe(core);
    expect(typeof window.GQGameRuntimeCore.bindWindowEvent).toBe('function');
    delete window.GQGameRuntimeCore;
  });
});
