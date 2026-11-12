import { describe, expect, it } from 'vitest';
import {
  buildFacilityWorkflow,
  getComfyJobFailure,
  selectNewExportPath,
} from '../../scripts/trellis2_generate_facility.mjs';

describe('TRELLIS2 facility generation workflow', () => {
  it('builds the inspected ComfyUI image-to-GLB path for a manifest facility', () => {
    const workflow = buildFacilityWorkflow({
      facilityKind: 'industry',
      imageName: 'gq_industry_concept_0123456789abcdef.png',
      seed: 20261112,
    });

    expect(workflow['6'].inputs.image).toBe('gq_industry_concept_0123456789abcdef.png');
    expect(workflow['39'].inputs.modelname).toBe('microsoft/TRELLIS.2-4B');
    expect(workflow['39'].inputs.conv_backend).toBe('spconv');
    expect(workflow['194'].inputs.image).toEqual(['6', 0]);
    expect(workflow['213'].inputs).toMatchObject({ pipeline: ['39', 0], image: ['194', 0] });
    expect(workflow['214'].inputs).toMatchObject({
      pipeline: ['213', 2], image_cond: ['213', 0], seed: 20261112,
    });
    expect(workflow['215'].inputs).toMatchObject({ pipeline: ['214', 2], coords: ['214', 0] });
    expect(workflow['216'].inputs).toMatchObject({
      pipeline: ['215', 2], shape_slat: ['215', 0], sparse_structure_resolution: ['214', 1],
    });
    expect(workflow['217'].inputs).toMatchObject({ pipeline: ['216', 2], shape_slat: ['216', 0] });
    expect(workflow['203'].inputs).toEqual({
      trimesh: ['202', 0], filename_prefix: ['219', 0], file_format: 'glb',
    });
    expect(workflow['219'].inputs.value).toBe('gq_trellis2/building_industry_pilot_v1');
  });

  it('rejects non-manifest classes, unsafe image names and invalid seeds', () => {
    expect(() => buildFacilityWorkflow({ facilityKind: 'habitat', imageName: 'habitat.png' }))
      .toThrow(/not in the reference manifest/);
    expect(() => buildFacilityWorkflow({ facilityKind: 'industry', imageName: '..\\outside.png' }))
      .toThrow(/plain PNG filename/);
    expect(() => buildFacilityWorkflow({ facilityKind: 'industry', imageName: 'industry.png', seed: -1 }))
      .toThrow(/Seed must be an integer/);
  });

  it('resolves the single new export when ComfyUI omits output-node history', () => {
    const existing = 'C:\\output\\gq_trellis2\\building_industry_pilot_v1_00001_.glb';
    const generated = 'C:\\output\\gq_trellis2\\building_industry_pilot_v1_00002_.glb';

    expect(selectNewExportPath([existing, generated], [existing])).toBe(generated);
    expect(() => selectNewExportPath([existing], [existing])).toThrow(/found 0/);
    expect(() => selectNewExportPath([generated, `${generated}.copy`], [])).toThrow(/found 2/);
  });

  it('surfaces ComfyUI errors even when completed is false', () => {
    const job = {
      status: {
        status_str: 'error',
        completed: false,
        messages: ['CUDA error: no kernel image is available for execution on the device'],
      },
    };

    expect(getComfyJobFailure(job, 'prompt-1')).toContain('ComfyUI job prompt-1 failed');
    expect(getComfyJobFailure({ status: { status_str: 'running', completed: false } }, 'prompt-2'))
      .toBeNull();
    expect(getComfyJobFailure({ status: { status_str: 'success', completed: true } }, 'prompt-3'))
      .toBeNull();
  });
});
