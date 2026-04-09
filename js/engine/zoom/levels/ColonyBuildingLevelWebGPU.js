/**
 * ColonyBuildingLevelWebGPU.js
 *
 * Dedicated Level-5 renderer for ZOOM_LEVEL.COLONY_BUILDING.
 * Reuses ObjectApproachLevelWebGPU internals but forces BUILDING target type.
 */

'use strict';

var { ObjectApproachLevelWebGPU: BaseLevel } = typeof require !== 'undefined'
  ? require('./ObjectApproachLevelWebGPU.js')
  : window.GQObjectApproachLevelWebGPU;

class ColonyBuildingLevelWebGPU extends BaseLevel {
  async enter(prevLevel, transitionPayload) {
    const payload = Object.assign({}, transitionPayload || {}, { targetType: 'BUILDING' });
    return super.enter(prevLevel, payload);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonyBuildingLevelWebGPU };
} else {
  window.GQColonyBuildingLevelWebGPU = { ColonyBuildingLevelWebGPU };
}
