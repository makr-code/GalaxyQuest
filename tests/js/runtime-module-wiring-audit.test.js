import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const runtimeDir = path.resolve(process.cwd(), 'js/engine/runtime');
const gamePath = path.resolve(process.cwd(), 'js/runtime/game.js');

function collectJsFilesRecursive(dir) {
  const result = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectJsFilesRecursive(fullPath));
    } else if (entry.name.endsWith('.js')) {
      result.push(fullPath);
    }
  }
  return result;
}

function collectRegisteredRuntimeModules() {
  const files = collectJsFilesRecursive(runtimeDir);
  const registered = new Set();
  const registrationPattern = /window\.(GQRuntime\w+)\s*=/g;

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, 'utf8');
    for (const match of source.matchAll(registrationPattern)) {
      registered.add(match[1]);
    }
  }

  return registered;
}

function collectDirectGameRequires() {
  const source = fs.readFileSync(gamePath, 'utf8');
  const required = new Set();
  const requirePattern = /requireRuntimeApi\('(GQRuntime\w+)'/g;

  for (const match of source.matchAll(requirePattern)) {
    required.add(match[1]);
  }

  return required;
}

describe('runtime module wiring audit', () => {
  it('keeps direct game wiring complete except approved indirect modules', () => {
    const registered = collectRegisteredRuntimeModules();
    const required = collectDirectGameRequires();

    const gap = [...registered].filter((name) => !required.has(name)).sort();

    const allowedIndirectModules = [
      'GQRuntimeNavigationSequences',
      'GQRuntimeViewHyperlinks',
    ];

    expect(gap).toEqual(allowedIndirectModules);
  });
});
