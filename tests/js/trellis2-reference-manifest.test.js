// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../generated/trellis2/references/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const require = createRequire(import.meta.url);
const surfacePlan = require('../../js/rendering/colony-surface-plan.js');

describe('TRELLIS colony reference manifest', () => {
  it('covers every production surface facility kind exactly once', () => {
    expect(manifest.schema).toBe('gq.trellis-reference.v1');
    expect(manifest.status).toBe('CONCEPT_REFERENCE_ONLY');
    expect(manifest.assets.every(asset => asset.asset_type === 'building')).toBe(true);

    const kinds = manifest.assets.map(asset => asset.facility_kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual([...surfacePlan.FACILITY_KINDS].sort());
  });

  it.each(manifest.assets)('pins $facility_kind to its image bytes', (asset) => {
    const imagePath = path.join(root, asset.file);
    const bytes = readFileSync(imagePath);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
    expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(bytes.readUInt32BE(16)).toBe(1024);
    expect(bytes.readUInt32BE(20)).toBe(1024);
  });
});
