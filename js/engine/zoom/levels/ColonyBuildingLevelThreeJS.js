/**
 * ColonyBuildingLevelThreeJS.js
 *
 * Dedicated Level-5 renderer for ZOOM_LEVEL.COLONY_BUILDING.
 * Reuses ObjectApproachLevelThreeJS internals but forces BUILDING target type.
 */

'use strict';

var { ObjectApproachLevelThreeJS: BaseLevel } = typeof require !== 'undefined'
  ? require('./ObjectApproachLevelThreeJS.js')
  : window.GQObjectApproachLevelThreeJS;

class ColonyBuildingLevelThreeJS extends BaseLevel {
  async enter(prevLevel, transitionPayload) {
    const payload = Object.assign({}, transitionPayload || {}, { targetType: 'BUILDING' });
    return super.enter(prevLevel, payload);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ColonyBuildingLevelThreeJS };
} else {
  window.GQColonyBuildingLevelThreeJS = { ColonyBuildingLevelThreeJS };
}
