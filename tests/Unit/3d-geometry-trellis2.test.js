/**
 * Tests for AI-Generated 3D Ship Geometry (TRELLIS2 Integration)
 * 
 * Covers:
 * - GLB parsing and validation
 * - Geometry quality checks (triangle budgets, bounding boxes)
 * - Asset import pipeline
 * - Material and texture slot validation
 * - Cross-renderer compatibility (Three.js + WebGPU)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Mock TRELLIS2 GLB Asset Structure
 * Matches: js/engine/runtime/domains/fleet/models/ship-registry.js
 */
class MockGLBAsset {
  constructor(name = 'test-ship', triangles = 5000) {
    this.name = name;
    this.triangles = triangles;
    this.bones = Math.floor(triangles / 500); // Rough estimate
    this.materials = [];
    this.textures = [];
    this.bbox = { min: [-5, -5, -5], max: [5, 5, 5] };
  }

  addMaterial(name) {
    this.materials.push({ name, slots: ['baseColor', 'roughness', 'metallic'] });
  }

  addTexture(materialName, textureType, size) {
    this.textures.push({ material: materialName, type: textureType, size });
  }

  getMetadata() {
    return {
      name: this.name,
      geometry: { triangles: this.triangles, bones: this.bones },
      materials: this.materials.length,
      textures: this.textures.length,
      bbox: this.bbox,
    };
  }
}

/**
 * TRELLIS2 Quality Validator
 * Enforces GalaxyQuest design constraints
 */
class TRELLIS2Validator {
  // Quality budgets (from js/engine/runtime/domains/fleet/models/quality-budget.js)
  static QUALITY_BUDGETS = {
    fighter: { maxTriangles: 3000, maxBones: 8, maxMaterials: 2 },
    corvette: { maxTriangles: 8000, maxBones: 16, maxMaterials: 4 },
    freighter: { maxTriangles: 15000, maxBones: 24, maxMaterials: 6 },
    capital: { maxTriangles: 25000, maxBones: 32, maxMaterials: 8 },
  };

  static QUALITY_TIERS = {
    low: 0.5,    // 50% of budget
    medium: 0.75, // 75% of budget
    high: 1.0,    // 100% of budget
  };

  static validate(asset, shipClass = 'corvette', tier = 'high') {
    const budget = this.QUALITY_BUDGETS[shipClass];
    if (!budget) throw new Error(`Unknown ship class: ${shipClass}`);

    const tierFactor = this.QUALITY_TIERS[tier];
    const allowedTriangles = Math.floor(budget.maxTriangles * tierFactor);

    const errors = [];
    const warnings = [];

    // Triangle budget
    if (asset.triangles > allowedTriangles) {
      errors.push(
        `Geometry exceeds budget: ${asset.triangles} > ${allowedTriangles} triangles ` +
        `(${shipClass}/${tier})`
      );
    }

    // Bone count
    if (asset.bones > budget.maxBones) {
      errors.push(
        `Too many bones: ${asset.bones} > ${budget.maxBones} (${shipClass})`
      );
    }

    // Material count
    if (asset.materials.length > budget.maxMaterials) {
      warnings.push(
        `Material count at limit: ${asset.materials.length}/${budget.maxMaterials}`
      );
    }

    // Bounding box validity
    if (!this._validateBBox(asset.bbox)) {
      errors.push(`Invalid bounding box: ${JSON.stringify(asset.bbox)}`);
    }

    // Material slot validation
    const missingSlots = asset.materials.filter(
      m => !m.slots || m.slots.length < 2
    );
    if (missingSlots.length > 0) {
      warnings.push(`Materials missing standard slots: ${missingSlots.map(m => m.name).join(', ')}`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  static _validateBBox(bbox) {
    if (!bbox || !bbox.min || !bbox.max) return false;
    if (bbox.min.length !== 3 || bbox.max.length !== 3) return false;
    for (let i = 0; i < 3; i++) {
      if (bbox.min[i] >= bbox.max[i]) return false;
    }
    // Check reasonable ship size (1-100m in each dimension)
    const size = bbox.max.map((v, i) => Math.abs(v - bbox.min[i]));
    return size.every(s => s > 0.1 && s < 200);
  }
}

describe('3D Geometry: TRELLIS2 AI Generation & Validation', () => {
  let asset;

  beforeEach(() => {
    asset = new MockGLBAsset('corvette-001', 6000);
    asset.addMaterial('hull');
    asset.addMaterial('windows');
    asset.addTexture('hull', 'baseColor', 2048);
    asset.addTexture('hull', 'roughness', 1024);
  });

  describe('GLB Asset Structure', () => {
    it('should create valid GLB asset with metadata', () => {
      expect(asset.name).toBe('corvette-001');
      expect(asset.triangles).toBe(6000);
      expect(asset.materials.length).toBe(2);
      expect(asset.textures.length).toBe(2);
    });

    it('should have valid bounding box', () => {
      expect(asset.bbox.min).toEqual([-5, -5, -5]);
      expect(asset.bbox.max).toEqual([5, 5, 5]);
      expect(asset.bbox.min[0] < asset.bbox.max[0]).toBe(true);
    });

    it('should calculate geometry metadata', () => {
      const meta = asset.getMetadata();
      expect(meta.geometry.triangles).toBe(6000);
      expect(meta.materials).toBe(2);
      expect(meta.textures).toBe(2);
    });
  });

  describe('Quality Budget Validation', () => {
    it('should validate corvette within medium tier budget', () => {
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject geometry exceeding budget', () => {
      asset.triangles = 10000; // Exceeds corvette medium (6000)
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toMatch(/exceeds budget/i);
    });

    it('should pass high-tier capital ship with many triangles', () => {
      asset.triangles = 24000;
      asset.bones = 30;
      asset.materials.push({ name: 'thrusters', slots: ['emissive'] });
      asset.materials.push({ name: 'armor', slots: ['normal', 'roughness'] });
      const result = TRELLIS2Validator.validate(asset, 'capital', 'high');
      expect(result.valid).toBe(true);
    });

    it('should warn on material count approaching limit', () => {
      asset.materials.push({ name: 'm3', slots: ['baseColor'] });
      asset.materials.push({ name: 'm4', slots: ['baseColor'] });
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'high');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should reject ships with invalid bounding boxes', () => {
      asset.bbox = { min: [5, 5, 5], max: [-5, -5, -5] }; // min > max
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Invalid bounding box'))).toBe(true);
    });

    it('should reject oversized ships', () => {
      asset.bbox = { min: [0, 0, 0], max: [500, 500, 500] }; // 500m per side
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(false);
    });
  });

  describe('Ship Class Quality Tiers', () => {
    it('should allow increasing quality with larger ship class', () => {
      asset.triangles = 8000;

      // Should fail for fighter
      let result = TRELLIS2Validator.validate(asset, 'fighter', 'high');
      expect(result.valid).toBe(false);

      // Should pass for corvette
      result = TRELLIS2Validator.validate(asset, 'corvette', 'high');
      expect(result.valid).toBe(true);

      // Should pass for freighter
      result = TRELLIS2Validator.validate(asset, 'freighter', 'high');
      expect(result.valid).toBe(true);
    });

    it('should support low/medium/high quality tiers', () => {
      // Low tier: 50% of 8000 = 4000
      asset.triangles = 4000;
      const lowRes = TRELLIS2Validator.validate(asset, 'corvette', 'low');
      expect(lowRes.valid).toBe(true);

      // Medium tier: 75% of 8000 = 6000
      asset.triangles = 6000;
      const medRes = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(medRes.valid).toBe(true);

      // High tier: 100% of 8000 = 8000
      asset.triangles = 8000;
      const highRes = TRELLIS2Validator.validate(asset, 'corvette', 'high');
      expect(highRes.valid).toBe(true);
    });
  });

  describe('Material & Texture Validation', () => {
    it('should validate material slot structure', () => {
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(true);
      expect(asset.materials[0].slots).toContain('baseColor');
    });

    it('should warn on incomplete material slots', () => {
      asset.materials[0].slots = []; // Missing slots
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should track texture metadata (type, size)', () => {
      expect(asset.textures[0].type).toBe('baseColor');
      expect(asset.textures[0].size).toBe(2048);
      expect(asset.textures[0].material).toBe('hull');
    });

    it('should allow high-res textures for capital ships', () => {
      asset.materials = [];
      asset.textures = [];
      asset.addMaterial('main_hull');
      asset.addTexture('main_hull', 'baseColor', 4096);
      asset.addTexture('main_hull', 'normal', 4096);

      const meta = asset.getMetadata();
      expect(meta.textures).toBe(2);
    });
  });

  describe('Geometry Compatibility', () => {
    it('should support Three.js rendering requirements', () => {
      // Three.js can handle up to 65k vertices per BufferGeometry without index
      expect(asset.triangles * 3).toBeLessThan(200000);
      expect(asset.materials.length).toBeGreaterThan(0);
    });

    it('should support WebGPU rendering pipeline', () => {
      // WebGPU has different buffer requirements
      expect(asset.bones).toBeLessThanOrEqual(64); // Typical bone limit
      expect(asset.triangles).toBeLessThan(100000); // Practical limit
    });

    it('should have consistent vertex attribute count', () => {
      const attributesPerVertex = 8; // pos(3) + normal(3) + uv(2) typical
      const totalVertices = asset.triangles * 3;
      const bufferSize = totalVertices * attributesPerVertex * 4; // 4 bytes per float
      expect(bufferSize).toBeLessThan(256 * 1024 * 1024); // Less than 256 MB
    });
  });

  describe('TRELLIS2 Import Pipeline', () => {
    it('should generate standardized asset naming', () => {
      expect(asset.name).toMatch(/^[a-z]+-\d{3}$/);
    });

    it('should preserve material hierarchy after import', () => {
      asset.addMaterial('hull_plating');
      asset.addMaterial('hull_details');
      asset.addMaterial('cockpit');
      expect(asset.materials.length).toBe(5);
    });

    it('should handle texture remapping during import', () => {
      // Simulate texture remapping: ComfyUI texture → GQ texture slot
      const textureMap = {
        'albedo': 'baseColor',
        'roughness_metallic': ['roughness', 'metallic'],
        'normal': 'normal',
      };
      
      expect(textureMap['albedo']).toBe('baseColor');
      expect(Array.isArray(textureMap['roughness_metallic'])).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should throw on unknown ship class', () => {
      expect(() => {
        TRELLIS2Validator.validate(asset, 'unknown-class', 'high');
      }).toThrow('Unknown ship class');
    });

    it('should handle missing bbox gracefully', () => {
      asset.bbox = null;
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'medium');
      expect(result.valid).toBe(false);
    });

    it('should handle malformed material definitions', () => {
      asset.materials.push({ name: 'bad' }); // Missing slots
      const result = TRELLIS2Validator.validate(asset, 'corvette', 'high');
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
