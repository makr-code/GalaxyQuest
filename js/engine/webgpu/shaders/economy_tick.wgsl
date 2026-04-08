/**
 * economy_tick.wgsl
 *
 * WebGPU compute shader for parallel colony economy simulation.
 * Three passes dispatched separately (passIdx uniform: 0/1/2):
 *   0 — Resource production
 *   1 — Consumption
 *   2 — Market price delta
 *
 * See EconomyComputeEngine.js for buffer layout and CPU interface.
 * License: MIT — makr-code/GalaxyQuest
 */

struct ColonyData {
  buildings  : array<f32, 8>,
  bonuses    : array<f32, 8>,
  popClass   : array<f32, 6>,
  stock      : array<f32, 12>,
  population : f32,
  dt         : f32,
  _align     : array<f32, 20>,
}
struct GoodData {
  supply    : f32,
  demand    : f32,
  priceMult : f32,
  _pad      : f32,
}
struct ResultData {
  produced   : array<f32, 12>,
  consumed   : array<f32, 12>,
  priceDelta : array<f32, 12>,
  _align     : array<f32, 12>,
}

@group(0) @binding(0) var<storage, read>       colonies : array<ColonyData>;
@group(0) @binding(1) var<storage, read>       goods    : array<GoodData>;
@group(0) @binding(2) var<storage, read_write> results  : array<ResultData>;
@group(0) @binding(3) var<uniform>             passIdx  : u32;

const BASE_PRODUCTION : array<f32, 8> = array<f32, 8>(
  2.0, 1.5, 1.2, 0.8, 3.0, 2.5, 1.0, 0.5,
);
const POP_CONSUMPTION : array<f32, 6> = array<f32, 6>(
  0.05, 0.08, 0.12, 0.15, 0.10, 0.18,
);
const PRICE_ELASTICITY : f32 = 0.04;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let colIdx = gid.x;
  if (colIdx >= arrayLength(&colonies)) { return; }

  let col = colonies[colIdx];
  let dt  = col.dt;

  if (passIdx == 0u) {
    var produced : array<f32, 12>;
    for (var i : u32 = 0u; i < 8u; i++) {
      let amount = col.buildings[i] * BASE_PRODUCTION[i] * col.bonuses[i] * dt;
      if (i < 12u) { produced[i] = amount; }
    }
    results[colIdx].produced = produced;

  } else if (passIdx == 1u) {
    var consumed : array<f32, 12>;
    for (var cls : u32 = 0u; cls < 6u; cls++) {
      let popCount = col.popClass[cls];
      if (popCount <= 0.0) { continue; }
      let rate    = POP_CONSUMPTION[cls] * popCount * dt;
      let goodIdx = cls % 12u;
      consumed[goodIdx] += min(rate, col.stock[goodIdx]);
    }
    results[colIdx].consumed = consumed;

  } else if (passIdx == 2u) {
    var priceDelta : array<f32, 12>;
    let numGoods = min(arrayLength(&goods), 12u);
    for (var g : u32 = 0u; g < numGoods; g++) {
      priceDelta[g] = -(results[colIdx].produced[g] - results[colIdx].consumed[g]) * PRICE_ELASTICITY;
    }
    results[colIdx].priceDelta = priceDelta;
  }
}
