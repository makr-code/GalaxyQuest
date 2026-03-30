/**
 * index.js — GalaxyQuest Engine main export
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

// Core
const { IGraphicsRenderer }         = require('./core/GraphicsContext');
const { WebGPURenderer }            = require('./core/WebGPURenderer');
const { WebGLRenderer }             = require('./core/WebGLRenderer');
const { RendererFactory }           = require('./core/RendererFactory');

// WebGPU
const { WebGPUDevice }              = require('./webgpu/WebGPUDevice');
const { WebGPUBuffer, BufferType, BufferUsage } = require('./webgpu/WebGPUBuffer');
const { WebGPUTexture }             = require('./webgpu/WebGPUTexture');
const { WebGPUShader }              = require('./webgpu/WebGPUShader');
const { WebGPURenderPass }          = require('./webgpu/WebGPURenderPass');
const { WebGPUCompute }             = require('./webgpu/WebGPUCompute');
const { WebGPUResourcePool }        = require('./webgpu/WebGPUResourcePool');
const { WebGPUPhysics }             = require('./webgpu/WebGPUPhysics');

// Scene
const { Camera, PerspectiveCamera, OrthographicCamera } = require('./scene/Camera');
const { Transform }                 = require('./scene/Transform');
const { Geometry }                  = require('./scene/Geometry');
const { Material }                  = require('./scene/Material');
const { Light, AmbientLight, DirectionalLight, PointLight } = require('./scene/Light');
const { SceneNode, SceneGraph }     = require('./scene/SceneGraph');

// Post-effects
const { EffectComposer }            = require('./post-effects/EffectComposer');
const { RenderPass }                = require('./post-effects/passes/RenderPass');
const { BloomPass }                 = require('./post-effects/passes/BloomPass');
const { VignettePass }              = require('./post-effects/passes/VignettePass');
const { ChromaticPass }             = require('./post-effects/passes/ChromaticPass');
const { ComputePass }               = require('./post-effects/passes/ComputePass');
const { SSAOPass, MAX_KERNEL_SIZE }  = require('./post-effects/passes/SSAOPass');
const { ColonySimulation, Colony, PopJob, BASE_YIELD, ColonyType, COLONY_TYPE_BONUS } = require('./game/ColonySimulation');

// Constants
const constants                     = require('./constants');

module.exports = {
  // Game engine layer
  GameEngine, GameLoop, EventBus, sharedBus,
  SystemRegistry, SystemPriority,
  AssetRegistry, AssetType,
  // Core
  IGraphicsRenderer, WebGPURenderer, WebGLRenderer, RendererFactory,
  // WebGPU
  WebGPUDevice, WebGPUBuffer, BufferType, BufferUsage,
  WebGPUTexture, WebGPUShader, WebGPURenderPass, WebGPUCompute,
  WebGPUResourcePool, WebGPUPhysics,
  // Scene
  Camera, PerspectiveCamera, OrthographicCamera,
  FollowCamera, FollowMode, CameraManager,
  Transform, Geometry, Material,
  Light, AmbientLight, DirectionalLight, PointLight,
  SceneNode, SceneGraph,
  // Viewports
  ViewportManager, PIP_DEFAULTS,
  // Post-effects
  EffectComposer, RenderPass, BloomPass, VignettePass, ChromaticPass, ComputePass,
  SSAOPass, MAX_KERNEL_SIZE,
  PostFxController, PostFxParamMeta,
  // Math
  Vector2, Vector3, Vector4, Matrix4, Quaternion, MathUtils,
  // Utils
  WebGPUCapabilities, ShaderCompiler, PerformanceMonitor, ResourceTracker,
  // Loaders
  TextureLoader, GeometryLoader, ShaderLoader,
  // Game systems
  EventSystem, EventType, EventStatus, Journal, JournalStatus,
  ResearchTree, ResearchCategory, CivAffinity,
  FleetFormation, Wing, FormationShape, Maneuver, getSlotPositions,
  BattleSimulator, BattleFleet, BattleReport,
  ShipClass, SHIP_STATS, SHIP_METAL_VALUE,
  ColonySimulation, Colony, PopJob, BASE_YIELD,
  BuildingType, BUILDING_COST, BUILDING_YIELD, TRADE_CHAIN,
  HUNGER_THRESHOLDS, UNREST_THRESHOLDS,
  ColonyType, COLONY_TYPE_BONUS, MOON_ALLOWED_BUILDINGS, MOON_MAX_SIZE,
  InvasionResult, InvasionReport,
  TROOP_DEFENSE_VALUE, TROOP_ATTACK_VALUE, DEFENSE_DPS_FACTOR,
  MAX_INVASION_ROUNDS, INVASION_LOOT_FRACTION, INVASION_CONQUEST_PENALTIES,
  // Constants
  ...constants,
};
