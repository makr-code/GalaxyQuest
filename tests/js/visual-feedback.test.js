/**
 * tests/js/visual-feedback.test.js
 *
 * Test suite for visual feedback system (multi-unit selection, bloom effects, ownership auras)
 *
 * Coverage:
 * - GroupSelectionController bloom state tracking
 * - GroupHighlightBloomPass integration
 * - OwnershipAuraBloomPass integration
 * - BloomPass dynamic parameters
 * - AdvancedRenderingUI colorblind mode
 * - GameEngine integration
 * - ViewportManager propagation
 */

'use strict';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock implementations for testing
class MockMarkerSystem {
  selectObject() {}
  deselectObject() {}
  selectGroup() {}
  deselectGroup() {}
  clearSelection() {}
}

class MockRenderingManager {
  applyPreset() {}
  enableFeature() {}
  disableFeature() {}
}

// Import classes under test
import { GroupSelectionController } from '../../js/engine/selection/GroupSelectionController.js';
import { GroupHighlightBloomPass } from '../../js/engine/post-effects/passes/GroupHighlightBloomPass.js';
import { OwnershipAuraBloomPass } from '../../js/engine/post-effects/passes/OwnershipAuraBloomPass.js';
import { BloomPass } from '../../js/engine/post-effects/passes/BloomPass.js';
import { AdvancedRenderingUI } from '../../js/engine/AdvancedRenderingUI.js';
import { ViewportManager } from '../../js/engine/ViewportManager.js';

describe('Visual Feedback System', () => {
  let markerSystem, renderingMgr, bloomPass;

  beforeEach(() => {
    markerSystem = new MockMarkerSystem();
    renderingMgr = new MockRenderingManager();
    bloomPass = new BloomPass();
  });

  // =========================================================================
  // GroupSelectionController Tests
  // =========================================================================

  describe('GroupSelectionController', () => {
    let groupCtrl;

    beforeEach(() => {
      groupCtrl = new GroupSelectionController(markerSystem);
    });

    it('should initialize with empty selection and bloom states', () => {
      expect(groupCtrl.getSelectionCount()).toBe(0);
      expect(groupCtrl.getAllBloomStates().size).toBe(0);
      expect(groupCtrl.isMultiSelectionBloomEnabled()).toBe(false);
      expect(groupCtrl.isOwnershipAuraBloomEnabled()).toBe(true);
    });

    it('should enable multi-selection bloom when 2+ units selected', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      expect(groupCtrl.isMultiSelectionBloomEnabled()).toBe(false);

      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });
      expect(groupCtrl.isMultiSelectionBloomEnabled()).toBe(true);
      expect(groupCtrl.getMultiSelectionBloomIntensity()).toBeGreaterThan(0.8);
    });

    it('should scale multi-selection bloom intensity with unit count', () => {
      const units = Array.from({ length: 5 }, (_, i) => ({ id: `unit${i}` }));

      units.forEach((unit, idx) => {
        groupCtrl.toggleUnitSelection(unit, { multiSelect: idx > 0 });
      });

      // Intensity should be 0.8 + (5 * 0.1) = 1.3
      expect(groupCtrl.getMultiSelectionBloomIntensity()).toBe(1.3);
    });

    it('should cap multi-selection bloom intensity at 2.0', () => {
      const units = Array.from({ length: 20 }, (_, i) => ({ id: `unit${i}` }));

      units.forEach((unit, idx) => {
        groupCtrl.toggleUnitSelection(unit, { multiSelect: idx > 0 });
      });

      // Intensity should cap at 2.0
      expect(groupCtrl.getMultiSelectionBloomIntensity()).toBeLessThanOrEqual(2.0);
    });

    it('should disable multi-selection bloom when cleared', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });
      expect(groupCtrl.isMultiSelectionBloomEnabled()).toBe(true);

      groupCtrl.clearSelection();
      expect(groupCtrl.isMultiSelectionBloomEnabled()).toBe(false);
    });

    it('should create group with bloom state', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

      const groupId = groupCtrl.createGroupFromSelection('Test Group', 'fleet');
      expect(groupId).toBeDefined();

      const bloomState = groupCtrl.getGroupBloom(groupId);
      expect(bloomState).toBeDefined();
      expect(bloomState.enabled).toBe(true);
      expect(bloomState.intensity).toBeGreaterThan(0);
      expect(bloomState.color).toBeDefined();
    });

    it('should set custom group bloom parameters', () => {
      const unit = { id: 'unit1' };
      groupCtrl.toggleUnitSelection(unit);

      const groupId = groupCtrl.createGroupFromSelection('Test', 'fleet');
      const customColor = [1.0, 0.0, 0.0]; // Red
      const customIntensity = 1.8;

      groupCtrl.setGroupBloom(groupId, true, customIntensity, customColor);

      const bloomState = groupCtrl.getGroupBloom(groupId);
      expect(bloomState.intensity).toBe(customIntensity);
      expect(bloomState.color).toEqual(customColor);
    });

    it('should emit bloom-updated event when setting group bloom', (done) => {
      const unit = { id: 'unit1' };
      groupCtrl.toggleUnitSelection(unit);

      const groupId = groupCtrl.createGroupFromSelection('Test', 'fleet');

      groupCtrl.on('bloom-updated', ({ groupId: id, enabled, intensity }) => {
        expect(id).toBe(groupId);
        expect(enabled).toBe(true);
        expect(intensity).toBe(1.5);
        done();
      });

      groupCtrl.setGroupBloom(groupId, true, 1.5);
    });

    it('should emit multi-selection-bloom event', (done) => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.on('multi-selection-bloom', ({ enabled, intensity, unitCount }) => {
        if (enabled) {
          expect(intensity).toBeGreaterThan(0);
          expect(unitCount).toBe(2);
          done();
        }
      });

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });
    });

    it('should clear bloom state when dissolving group', () => {
      const unit = { id: 'unit1' };
      groupCtrl.toggleUnitSelection(unit);

      const groupId = groupCtrl.createGroupFromSelection('Test', 'fleet');
      expect(groupCtrl.getGroupBloom(groupId)).toBeDefined();

      groupCtrl.dissolveGroup(groupId);
      expect(groupCtrl.getGroupBloom(groupId)).toBeNull();
    });

    it('should toggle ownership aura bloom', () => {
      expect(groupCtrl.isOwnershipAuraBloomEnabled()).toBe(true);

      groupCtrl.setOwnershipAuraBloom(false);
      expect(groupCtrl.isOwnershipAuraBloomEnabled()).toBe(false);

      groupCtrl.setOwnershipAuraBloom(true);
      expect(groupCtrl.isOwnershipAuraBloomEnabled()).toBe(true);
    });
  });

  // =========================================================================
  // GroupHighlightBloomPass Tests
  // =========================================================================

  describe('GroupHighlightBloomPass', () => {
    let groupCtrl, groupBloom;

    beforeEach(() => {
      groupCtrl = new GroupSelectionController(markerSystem);
      groupBloom = new GroupHighlightBloomPass({
        groupSelectionController: groupCtrl,
      });
    });

    it('should initialize with enabled state', () => {
      expect(groupBloom.enabled).toBe(true);
    });

    it('should return multi-selection bloom params', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

      const params = groupBloom.getMultiSelectionBloomParams();
      expect(params.enabled).toBe(true);
      expect(params.intensity).toBeGreaterThan(0);
      expect(params.color).toBeDefined();
    });

    it('should get all active group blooms', () => {
      const unit = { id: 'unit1' };
      groupCtrl.toggleUnitSelection(unit);

      const groupId = groupCtrl.createGroupFromSelection('Test', 'fleet');
      groupCtrl.setGroupBloom(groupId, true, 1.5);

      const blooms = groupBloom.getActiveGroupBlooms();
      expect(blooms.size).toBe(1);
      expect(blooms.has(groupId)).toBe(true);
    });

    it('should update group boundary', () => {
      const boundary = { geometry: 'mock' };
      groupBloom.updateGroupBoundary('group1', boundary);

      expect(groupBloom._groupBoundaries.has('group1')).toBe(true);
    });

    it('should clear group boundary', () => {
      const boundary = { geometry: 'mock' };
      groupBloom.updateGroupBoundary('group1', boundary);
      expect(groupBloom._groupBoundaries.has('group1')).toBe(true);

      groupBloom.clearGroupBoundary('group1');
      expect(groupBloom._groupBoundaries.has('group1')).toBe(false);
    });

    it('should clear all boundaries', () => {
      groupBloom.updateGroupBoundary('group1', { geometry: 'mock' });
      groupBloom.updateGroupBoundary('group2', { geometry: 'mock' });

      expect(groupBloom._groupBoundaries.size).toBe(2);

      groupBloom.clearAllBoundaries();
      expect(groupBloom._groupBoundaries.size).toBe(0);
    });

    it('should return uniform data', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

      const uniformData = groupBloom.getUniformData();
      expect(uniformData).toBeDefined();
      expect(uniformData.bloomThreshold).toBe(0.6);
      expect(uniformData.bloomStrength).toBeGreaterThan(1.5);
      expect(uniformData.bloomColor).toBeDefined();
    });
  });

  // =========================================================================
  // OwnershipAuraBloomPass Tests
  // =========================================================================

  describe('OwnershipAuraBloomPass', () => {
    let auraBloom;

    beforeEach(() => {
      auraBloom = new OwnershipAuraBloomPass({
        baseIntensity: 0.8,
      });
    });

    it('should initialize with enabled state', () => {
      expect(auraBloom.enabled).toBe(true);
    });

    it('should register object aura', () => {
      const obj = { id: 'obj1', uuid: 'uuid1' };
      const success = auraBloom.registerObjectAura(obj, 'helion_confederation');

      expect(success).toBe(true);
      expect(auraBloom._auraObjects.has('obj1')).toBe(true);
    });

    it('should use uuid if id not available', () => {
      const obj = { uuid: 'uuid123' };
      auraBloom.registerObjectAura(obj, 'myr_keth');

      expect(auraBloom._auraObjects.has('uuid123')).toBe(true);
    });

    it('should unregister object aura', () => {
      const obj = { id: 'obj1' };
      auraBloom.registerObjectAura(obj, 'genesis_kollektiv');
      expect(auraBloom._auraObjects.has('obj1')).toBe(true);

      const success = auraBloom.unregisterObjectAura(obj);
      expect(success).toBe(true);
      expect(auraBloom._auraObjects.has('obj1')).toBe(false);
    });

    it('should clear all auras', () => {
      const obj1 = { id: 'obj1' };
      const obj2 = { id: 'obj2' };

      auraBloom.registerObjectAura(obj1, 'helion_confederation');
      auraBloom.registerObjectAura(obj2, 'myr_keth');
      expect(auraBloom._auraObjects.size).toBe(2);

      auraBloom.clearAllAuras();
      expect(auraBloom._auraObjects.size).toBe(0);
    });

    it('should set faction intensity', () => {
      expect(auraBloom.getFactionIntensity('helion_confederation')).toBe(0.9);

      auraBloom.setFactionIntensity('helion_confederation', 1.2);
      expect(auraBloom.getFactionIntensity('helion_confederation')).toBe(1.2);
    });

    it('should clamp faction intensity to [0, 2]', () => {
      auraBloom.setFactionIntensity('myr_keth', 5.0);
      expect(auraBloom.getFactionIntensity('myr_keth')).toBe(2.0);

      auraBloom.setFactionIntensity('myr_keth', -1.0);
      expect(auraBloom.getFactionIntensity('myr_keth')).toBe(0.0);
    });

    it('should set colorblind mode', () => {
      auraBloom.setColorblindMode('deuteranopia');
      expect(auraBloom._colorblindIntensity).toBe(0.95);

      auraBloom.setColorblindMode('achromatic');
      expect(auraBloom._colorblindIntensity).toBe(0.7);

      auraBloom.setColorblindMode('normal');
      expect(auraBloom._colorblindIntensity).toBe(1.0);
    });

    it('should get object aura', () => {
      const obj = { id: 'obj1' };
      auraBloom.registerObjectAura(obj, 'khar_morr_syndicate', 1.5);

      const aura = auraBloom.getObjectAura(obj);
      expect(aura).toBeDefined();
      expect(aura.faction).toBe('khar_morr_syndicate');
      expect(aura.intensity).toBe(1.5);
    });

    it('should get registered auras', () => {
      const obj1 = { id: 'obj1' };
      const obj2 = { id: 'obj2' };

      auraBloom.registerObjectAura(obj1, 'helion_confederation');
      auraBloom.registerObjectAura(obj2, 'myr_keth');

      const auras = auraBloom.getRegisteredAuras();
      expect(auras.size).toBe(2);
    });

    it('should return uniform data', () => {
      const uniformData = auraBloom.getUniformData();
      expect(uniformData).toBeDefined();
      expect(uniformData.baseIntensity).toBe(0.8);
      expect(uniformData.bloomThreshold).toBe(0.7);
      expect(uniformData.enableOwnershipAura).toBe(1.0);
      expect(uniformData.auraObjectCount).toBe(0);
    });
  });

  // =========================================================================
  // BloomPass Dynamic Parameters Tests
  // =========================================================================

  describe('BloomPass Dynamic Parameters', () => {
    let groupCtrl, bloom;

    beforeEach(() => {
      groupCtrl = new GroupSelectionController(markerSystem);
      bloom = new BloomPass({
        threshold: 0.8,
        strength: 1.2,
        selectionController: groupCtrl,
      });
    });

    it('should initialize with base threshold and strength', () => {
      expect(bloom.threshold).toBe(0.8);
      expect(bloom.strength).toBe(1.2);
      expect(bloom.getEffectiveThreshold()).toBe(0.8);
      expect(bloom.getEffectiveStrength()).toBe(1.2);
    });

    it('should update dynamic parameters based on selection', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

      bloom.updateDynamicParameters();

      // Threshold should be reduced
      const effectiveThreshold = bloom.getEffectiveThreshold();
      expect(effectiveThreshold).toBeLessThan(bloom.threshold);

      // Strength should be increased
      const effectiveStrength = bloom.getEffectiveStrength();
      expect(effectiveStrength).toBeGreaterThan(bloom.strength);
    });

    it('should reset dynamic parameters when no selection', () => {
      const unit = { id: 'unit1' };
      groupCtrl.toggleUnitSelection(unit);

      bloom.updateDynamicParameters();
      let threshold = bloom.getEffectiveThreshold();
      expect(threshold).toBe(bloom.threshold); // No change with single unit

      groupCtrl.clearSelection();
      bloom.updateDynamicParameters();

      threshold = bloom.getEffectiveThreshold();
      expect(threshold).toBe(bloom.threshold);
    });

    it('should allow manual parameter override', () => {
      bloom.setDynamicParameters(0.5, 1.8);

      expect(bloom.getEffectiveThreshold()).toBe(0.5);
      expect(bloom.getEffectiveStrength()).toBe(1.8);
    });

    it('should clamp manual parameters', () => {
      bloom.setDynamicParameters(1.5, 5.0); // Both out of range

      expect(bloom.getEffectiveThreshold()).toBe(1.0); // Max threshold is 1
      expect(bloom.getEffectiveStrength()).toBe(3.0);  // Max strength is 3
    });

    it('should use dynamic parameters in param blocks', () => {
      const unit1 = { id: 'unit1' };
      const unit2 = { id: 'unit2' };

      groupCtrl.toggleUnitSelection(unit1);
      groupCtrl.toggleUnitSelection(unit2, { multiSelect: true });

      bloom.updateDynamicParameters();

      const thresholdBlock = bloom.buildThresholdParamBlock();
      expect(thresholdBlock[0]).toBe(bloom.getEffectiveThreshold());
      expect(thresholdBlock[1]).toBe(bloom.getEffectiveStrength());
    });
  });

  // =========================================================================
  // AdvancedRenderingUI Colorblind Toggle Tests
  // =========================================================================

  describe('AdvancedRenderingUI Colorblind Mode', () => {
    let ui, mockEngine, mockDOM;

    beforeEach(() => {
      // Create mock engine
      mockEngine = {
        ownershipSystem: {
          setColorblindMode: vi.fn(),
        },
      };

      // Mock DOM elements
      mockDOM = {
        colorblindSelect: {
          value: 'normal',
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      };

      // Mock document.getElementById
      global.document = {
        getElementById: (id) => {
          if (id === 'adv-rendering-colorblind') {
            return mockDOM.colorblindSelect;
          }
          return null;
        },
      };

      ui = new AdvancedRenderingUI(mockEngine);
    });

    it('should restore colorblind mode from localStorage', () => {
      localStorage.setItem('adv-rendering-colorblind', 'deuteranopia');

      ui._restorePreferences();

      expect(mockDOM.colorblindSelect.value).toBe('deuteranopia');
    });

    it('should apply colorblind mode to ownership system', () => {
      ui._applyColorblindMode('protanopia');

      expect(mockEngine.ownershipSystem.setColorblindMode).toHaveBeenCalledWith('protanopia');
    });

    it('should save colorblind mode to localStorage', () => {
      const setItemSpy = vi.spyOn(localStorage, 'setItem');

      ui._onColorblindModeChange({ target: { value: 'tritanopia' } });

      expect(setItemSpy).toHaveBeenCalledWith('adv-rendering-colorblind', 'tritanopia');
    });

    it('should emit colorblind-mode-changed event', (done) => {
      if (typeof window !== 'undefined') {
        window.addEventListener('colorblind-mode-changed', (evt) => {
          expect(evt.detail.mode).toBe('achromatic');
          done();
        });
      }

      ui._applyColorblindMode('achromatic');
    });
  });

  // =========================================================================
  // ViewportManager Integration Tests
  // =========================================================================

  describe('ViewportManager Integration', () => {
    let groupCtrl, viewport;

    beforeEach(() => {
      groupCtrl = new GroupSelectionController(markerSystem);

      // Mock canvas and DOM
      const mockCanvas = {
        parentElement: {
          style: {},
        },
      };

      // Mock CameraManager
      const mockCameraManager = {
        get: () => ({}),
      };

      viewport = new ViewportManager(mockCanvas, null, mockCameraManager, {
        groupSelection: groupCtrl,
      });
    });

    it('should set group selection controller', () => {
      const newCtrl = new GroupSelectionController(markerSystem);
      viewport.setGroupSelection(newCtrl);

      expect(viewport.groupSelection).toBe(newCtrl);
    });

    it('should set ownership system', () => {
      const mockSystem = { name: 'ownership' };
      viewport.setOwnershipSystem(mockSystem);

      expect(viewport.ownershipSystem).toBe(mockSystem);
    });

    it('should wire selection events', (done) => {
      const newCtrl = new GroupSelectionController(markerSystem);

      viewport.setGroupSelection(newCtrl);

      if (typeof window !== 'undefined') {
        window.addEventListener('viewport:selection-changed', (evt) => {
          expect(evt.detail.enabled).toBe(true);
          done();
        });
      }

      const unit = { id: 'unit1' };
      newCtrl.toggleUnitSelection(unit);

      const unit2 = { id: 'unit2' };
      newCtrl.toggleUnitSelection(unit2, { multiSelect: true });
    });
  });
});
