// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { validateNativeServices } from '../../deploy/check-native-services.mjs';

const digest = `example.invalid/image@sha256:${'a'.repeat(64)}`;
const baseEnv = {
  ...process.env,
  TTS_IMAGE: digest,
  GPU_IMAGE: digest,
  TTS_SECRET: 'a'.repeat(32),
  TTS_PORT: '15500',
  COMFYUI_PORT: '18188',
};

function config(project, gpu = false, overrides = {}) {
  const args = ['compose', '-p', project, '-f', 'deploy/native-plesk-services.yml'];
  if (gpu) args.push('-f', 'deploy/native-plesk-gpu.yml');
  args.push('config', '--format', 'json');
  return JSON.parse(execFileSync('docker', args, {
    env: { ...baseEnv, ...overrides }, encoding: 'utf8', timeout: 30000,
  }));
}

describe.skipIf(process.env.GQ_DOCKER_CONTEXT_TESTS !== '1')('native Plesk service preparation', () => {
  it('validates actual resolved TTS and GPU configuration', () => {
    expect(() => validateNativeServices(config('galaxyquest-staging'), 'staging', false)).not.toThrow();
    expect(() => validateNativeServices(config('galaxyquest-production', true), 'production', true)).not.toThrow();
  });
  it('only adds TTS by default, bound to loopback with persistent caches', () => {
    const result = config('gq-native-staging');
    expect(Object.keys(result.services)).toEqual(['tts']);
    const tts = result.services.tts;
    expect(tts.image).toBe(digest);
    expect(tts.ports).toHaveLength(1);
    expect(tts.ports[0]).toMatchObject({ host_ip: '127.0.0.1', published: '15500', target: 5500 });
    expect(tts.environment.TTS_SECRET).toBe('a'.repeat(32));
    expect(tts.entrypoint.join(' ')).toContain('TTS_SECRET}" -ge 32');
    expect(tts.volumes.map((v) => v.target)).toEqual(['/app/voice_cache', '/app/audio_cache']);
  });

  describe('native service configuration safety checks', () => {
    const fixture = () => ({
      name: 'galaxyquest-staging',
      services: {
        tts: {
          image: digest,
          environment: { TTS_SECRET: 's'.repeat(32) },
          ports: [{ host_ip: '127.0.0.1', protocol: 'tcp', published: '15500', target: 5500 }],
        },
      },
    });
    it('accepts a pinned isolated TTS configuration', () => {
      expect(() => validateNativeServices(fixture(), 'staging', false)).not.toThrow();
    });
    it.each([
      ['wrong environment', (v) => { v.name = 'galaxyquest-production'; }],
      ['tag instead of digest', (v) => { v.services.tts.image = 'example.invalid/image:latest'; }],
      ['local build', (v) => { v.services.tts.build = {}; }],
      ['public binding', (v) => { v.services.tts.ports[0].host_ip = '0.0.0.0'; }],
      ['mysql port', (v) => { v.services.tts.ports[0].published = '3306'; }],
      ['privileged port', (v) => { v.services.tts.ports[0].published = '80'; }],
      ['short secret', (v) => { v.services.tts.environment.TTS_SECRET = 'short'; }],
      ['placeholder secret', (v) => { v.services.tts.environment.TTS_SECRET = 'CHANGEME'.repeat(4); }],
      ['extra service', (v) => { v.services.db = {}; }],
    ])('rejects %s', (_label, change) => {
      const value = fixture();
      change(value);
      expect(() => validateNativeServices(value, 'staging', false)).toThrow();
    });
    it('rejects a GPU service sharing the TTS port', () => {
      const value = fixture();
      value.services.comfyui = { image: digest, ports: [{
        host_ip: '127.0.0.1', protocol: 'tcp', published: '15500', target: 8188,
      }] };
      expect(() => validateNativeServices(value, 'staging', true)).toThrow(/duplicate/);
    });
  });

  it('adds only loopback-bound GPU service when explicitly selected', () => {
    const result = config('gq-native-staging', true);
    expect(Object.keys(result.services).sort()).toEqual(['comfyui', 'tts']);
    const gpu = result.services.comfyui;
    expect(gpu.ports[0]).toMatchObject({ host_ip: '127.0.0.1', published: '18188', target: 8188 });
    expect(gpu.deploy.resources.reservations.devices[0].capabilities).toEqual(['gpu']);
    expect(gpu.build).toBeUndefined();
  });

  it('keeps named volumes and chosen ports distinct between projects', () => {
    const staging = config('gq-native-staging', true);
    const production = config('gq-native-production', true, { TTS_PORT: '15501', COMFYUI_PORT: '18189' });
    for (const name of Object.keys(staging.volumes)) {
      expect(staging.volumes[name].name).not.toBe(production.volumes[name].name);
    }
    for (const service of ['tts', 'comfyui']) {
      expect(staging.services[service].ports[0].published).not.toBe(production.services[service].ports[0].published);
    }
  });

  it.each(['TTS_IMAGE', 'TTS_SECRET', 'TTS_PORT'])('rejects missing %s', (key) => {
    const env = { ...baseEnv, [key]: '' };
    const result = spawnSync('docker', [
      'compose', '-p', 'gq-native-test', '-f', 'deploy/native-plesk-services.yml', 'config', '-q',
    ], { env, encoding: 'utf8', timeout: 30000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(key);
  });
});
