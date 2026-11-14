// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildShuttleTextureWorkflow, buildShuttleWorkflow } from '../../scripts/trellis2_generate_shuttle.mjs';

describe('TRELLIS2 shuttle workflow', () => {
  const runId = '0123456789abcdef0123456789abcdef';

  it('uses the alpha-preserving 512 mesh path and a unique shuttle prefix', () => {
    const workflow = buildShuttleWorkflow({ id: 'patchwork_tug', imageName: 'shuttle.png', runId });
    expect(workflow['194'].inputs).toMatchObject({ image: ['6', 2], remove_background: false });
    expect(workflow['216']).toBeUndefined();
    expect(workflow['250']).toBeUndefined();
    expect(workflow['257']).toBeUndefined();
    expect(workflow['202'].inputs.mesh).toEqual(['218', 0]);
    expect(workflow['219'].inputs.value).toBe(`gq_trellis2/shuttle_patchwork_tug_${runId}`);
  });

  it('rejects unknown shuttles, unsafe image names and run identifiers', () => {
    expect(() => buildShuttleWorkflow({ id: '../industry', imageName: 'shuttle.png', runId })).toThrow();
    expect(() => buildShuttleWorkflow({ id: 'patchwork_tug', imageName: '../x.png', runId })).toThrow();
    expect(() => buildShuttleWorkflow({ id: 'patchwork_tug', imageName: 'x.png', runId: '../x' })).toThrow();
  });

  it('resolves and verifies the pinned input in a dry run', () => {
    const script = fileURLToPath(new URL('../../scripts/trellis2_generate_shuttle.mjs', import.meta.url));
    const output = execFileSync(process.execPath, [script, '--id', 'patchwork_tug'], { encoding: 'utf8' });
    expect(output).toContain('Input: patchwork_tug_trellis_v1.png');
    expect(output).toContain('af1d5757f3311db6565f1014036770e955cff9841c4d269abf359afdf141890b');
    expect(output).toContain('Dry run only');
  });

  it('plans texturing the pinned mesh directly at 512 without shape generation', () => {
    const workflow = buildShuttleTextureWorkflow({ id: 'patchwork_tug', imageName: 'shuttle.png', runId });
    expect(Object.keys(workflow).sort()).toEqual(['194', '203', '219', '258', '260', '39', '6'].sort());
    expect(workflow['194'].inputs).toMatchObject({ image: ['6', 2], remove_background: false });
    expect(workflow['260'].inputs.glb_path).toBe(
      '/workspace/output/gq_trellis2/shuttle_patchwork_tug_6613380216584a3fa81741c2bd9cd3e6_00001__zero_area_cleaned_normals.glb',
    );
    expect(workflow['258'].inputs).toMatchObject({
      pipeline: ['39', 0], trimesh: ['260', 0], image: ['194', 0], resolution: 512, texture_size: 1024,
    });
    expect(workflow['203'].inputs.trimesh).toEqual(['258', 0]);
    expect(workflow['219'].inputs.value).toBe(`gq_trellis2/shuttle_patchwork_tug_texture_${runId}`);
    expect(() => buildShuttleTextureWorkflow({ id: 'dock_mule', imageName: 'shuttle.png', runId }))
      .toThrow(/no pinned texture mesh/);
  });

  it('refuses to submit an unverified texture plan', () => {
    const script = fileURLToPath(new URL('../../scripts/trellis2_generate_shuttle.mjs', import.meta.url));
    expect(() => execFileSync(process.execPath, [script, '--texture-plan', '--submit'], { stdio: 'pipe' }))
      .toThrow(/preflight-only/);
  });
});
