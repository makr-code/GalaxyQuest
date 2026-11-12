import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const digestPattern = /^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/;

export function validateNativeServices(config, environment, gpu) {
  if (!['staging', 'production'].includes(environment)) throw new Error('Invalid environment.');
  if (!config || typeof config !== 'object' || config.name !== `galaxyquest-${environment}`) {
    throw new Error('Compose project does not match the requested environment.');
  }
  const expected = gpu ? ['comfyui', 'tts'] : ['tts'];
  const services = config.services;
  if (!services || Object.keys(services).sort().join(',') !== expected.join(',')) {
    throw new Error('Unexpected Compose services.');
  }
  const ports = new Set();
  for (const name of expected) {
    const service = services[name];
    if (!service || !digestPattern.test(service.image ?? '') || service.build != null) {
      throw new Error(`${name} requires a digest-pinned image and no local build.`);
    }
    if (!Array.isArray(service.ports) || service.ports.length !== 1) {
      throw new Error(`${name} must have exactly one published port.`);
    }
    const binding = service.ports[0];
    const published = String(binding.published ?? '');
    if (binding.host_ip !== '127.0.0.1' || binding.protocol !== 'tcp'
      || binding.target !== (name === 'tts' ? 5500 : 8188)
      || !/^[1-9][0-9]{3,4}$/.test(published)
      || Number(published) < 1024 || Number(published) > 65535 || Number(published) === 3306
      || ports.has(published)) {
      throw new Error(`${name} has an unsafe or duplicate host port.`);
    }
    ports.add(published);
  }
  const secret = services.tts.environment?.TTS_SECRET;
  if (typeof secret !== 'string' || secret.length < 32 || /REPLACE_WITH|CHANGEME/i.test(secret)) {
    throw new Error('TTS secret is missing, too short, or a placeholder.');
  }
}

function main() {
  const [environment, mode, ...extra] = process.argv.slice(2);
  if (!['staging', 'production'].includes(environment) || !['tts', 'gpu'].includes(mode) || extra.length) {
    throw new Error('Usage: node deploy/check-native-services.mjs staging|production tts|gpu');
  }
  const directory = path.dirname(fileURLToPath(import.meta.url));
  const args = ['compose', '-p', `galaxyquest-${environment}`,
    '-f', path.join(directory, 'native-plesk-services.yml')];
  if (mode === 'gpu') args.push('-f', path.join(directory, 'native-plesk-gpu.yml'));
  args.push('config', '--format', 'json');
  let config;
  try {
    config = JSON.parse(execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch {
    throw new Error('Cannot resolve Compose configuration; check Docker, required variables and Compose files.');
  }
  validateNativeServices(config, environment, mode === 'gpu');
  console.log('Native service configuration validated. Host ports, GPU, access boundaries and deployment remain unverified.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`NATIVE SERVICE CHECK: ${error.message}`);
    process.exitCode = 1;
  }
}
