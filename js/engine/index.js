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

// Math
const { Vector2 }                   = require('./math/Vector2');
const { Vector3 }                   = require('./math/Vector3');
const { Vector4 }                   = require('./math/Vector4');
const { Matrix4 }                   = require('./math/Matrix4');
const { Quaternion }                = require('./math/Quaternion');
const { MathUtils }                 = require('./math/MathUtils');

// Utils
const { WebGPUCapabilities }        = require('./utils/WebGPUCapabilities');
const { ShaderCompiler }            = require('./utils/ShaderCompiler');
const { PerformanceMonitor }        = require('./utils/PerformanceMonitor');
const { ResourceTracker }           = require('./utils/ResourceTracker');

// Loaders
const { TextureLoader }             = require('./loaders/TextureLoader');
const { GeometryLoader }            = require('./loaders/GeometryLoader');
const { ShaderLoader }              = require('./loaders/ShaderLoader');

// Game engine layer
const { GameEngine }                = require('./GameEngine');
const { GameLoop }                  = require('./GameLoop');
const { EventBus, sharedBus }       = require('./EventBus');
const { SystemRegistry, SystemPriority } = require('./SystemRegistry');
const { AssetRegistry, AssetType }  = require('./AssetRegistry');

// Scene — cameras
const { FollowCamera, FollowMode }  = require('./scene/FollowCamera');
const { CameraManager }             = require('./scene/CameraManager');

// Viewport
const { ViewportManager, PIP_DEFAULTS } = require('./ViewportManager');

// Game systems (classics-inspired)
const { EventSystem, EventType, EventStatus, Journal, JournalStatus } = require('./game/EventSystem');
const { ResearchTree, ResearchCategory, CivAffinity }      = require('./game/ResearchTree');
const { FleetFormation, Wing, FormationShape, Maneuver, getSlotPositions } = require('./game/FleetFormation');
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
  ColonySimulation, Colony, PopJob, BASE_YIELD, ColonyType, COLONY_TYPE_BONUS,
  // Constants
  ...constants,
};
