// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/trellis2_import.ps1', import.meta.url));
const roots = [];
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0;

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'gq-trellis-import-'));
  roots.push(root);
  mkdirSync(path.join(root, 'scripts'));
  copyFileSync(script, path.join(root, 'scripts', 'trellis2_import.ps1'));
  const source = path.join(root, 'habitat.glb');
  const data = Buffer.from('dev asset fixture; importer does not parse GLB');
  writeFileSync(source, data);
  const report = {
    schema: 'gq.trellis-inspection.v2',
    status: 'DEV_ONLY',
    asset_type: 'building',
    facility_kind: 'industry',
    source_sha256: createHash('sha256').update(data).digest('hex'),
  };
  const target = path.join(root, 'generated', 'trellis2', 'imported', 'building', 'building_generic_v1_lod0_trellis2_dev.glb');
  const inspectionTarget = target.replace(/\.glb$/, '_inspection.json');
  function run(force = false, facilityKind = 'industry', assetType = 'building') {
    const args = [
      '-NoProfile', '-File', path.join(root, 'scripts', 'trellis2_import.ps1'),
      '-SourceGlb', source, '-AssetType', assetType,
    ];
    if (facilityKind) args.push('-FacilityKind', facilityKind);
    if (force) args.push('-Force');
    const result = spawnSync('pwsh', [
      ...args,
    ], { encoding: 'utf8', timeout: 15_000 });
    if (result.error) throw result.error;
    return result;
  }
  return { root, source, data, report, target, inspectionTarget, run };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe.skipIf(!hasPwsh)('TRELLIS DEV import inspection sidecar', () => {
  it('copies a matching report without changing DEV_ONLY status', () => {
    const f = fixture();
    writeFileSync(f.source.replace(/\.glb$/, '_inspection.json'), JSON.stringify(f.report));
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(f.target)).toEqual(f.data);
    expect(JSON.parse(readFileSync(f.inspectionTarget, 'utf8'))).toEqual(f.report);
    const log = JSON.parse(readFileSync(path.join(f.root, 'generated', 'trellis2', 'import_log.jsonl'), 'utf8').trim());
    expect(log.status).toBe('DEV_ONLY');
    expect(log.facility_kind).toBe('industry');
  }, 30_000);

  it('imports a classified generic building only when the report has no facility kind', () => {
    const f = fixture();
    f.report.facility_kind = null;
    writeFileSync(f.source.replace(/\.glb$/, '_inspection.json'), JSON.stringify(f.report));
    const result = f.run(false, null);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(f.inspectionTarget, 'utf8')).facility_kind).toBeNull();
  }, 30_000);

  it('rejects a facility kind on a non-building before importing', () => {
    const f = fixture();
    const result = f.run(false, 'drilling', 'ship');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('nur fuer AssetType building');
    expect(existsSync(f.target)).toBe(false);
  });

  it('still imports legacy assets but explicitly warns that inspection is missing', () => {
    const f = fixture();
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Kein Inspection-Sidecar');
    expect(existsSync(f.inspectionTarget)).toBe(false);
  }, 30_000);

  it.each([
    { source_sha256: '0'.repeat(64) },
    { schema: 'unknown-schema' },
    { status: 'PRODUCTION_READY' },
    { asset_type: 'station' },
    { facility_kind: 'solar' },
    { facility_kind: undefined },
  ])('rejects mismatched reports before overwriting an existing asset: %j', (override) => {
    const f = fixture();
    expect(f.run().status).toBe(0);
    const newData = Buffer.from('new asset');
    writeFileSync(f.source, newData);
    const currentReport = { ...f.report, source_sha256: createHash('sha256').update(newData).digest('hex') };
    const report = { ...currentReport, ...override };
    if (Object.hasOwn(override, 'facility_kind') && override.facility_kind === undefined) delete report.facility_kind;
    writeFileSync(f.source.replace(/\.glb$/, '_inspection.json'), JSON.stringify(report));
    expect(f.run(true).status).not.toBe(0);
    expect(readFileSync(f.target)).toEqual(f.data);
    expect(existsSync(f.inspectionTarget)).toBe(false);
  }, 30_000);

  it('removes a stale target report when replacement has no report', () => {
    const f = fixture();
    const reportPath = f.source.replace(/\.glb$/, '_inspection.json');
    writeFileSync(reportPath, JSON.stringify(f.report));
    expect(f.run().status).toBe(0);
    rmSync(reportPath);
    writeFileSync(f.source, 'replacement asset');
    expect(f.run(true).status).toBe(0);
    expect(existsSync(f.inspectionTarget)).toBe(false);
    expect(readFileSync(f.target, 'utf8')).toBe('replacement asset');
  }, 30_000);

  it('rejects invalid JSON and missing required report fields', () => {
    const f = fixture();
    for (const contents of ['{', '{}']) {
      writeFileSync(f.source.replace(/\.glb$/, '_inspection.json'), contents);
      expect(f.run().status).not.toBe(0);
      expect(existsSync(f.target)).toBe(false);
    }
  }, 30_000);
});
