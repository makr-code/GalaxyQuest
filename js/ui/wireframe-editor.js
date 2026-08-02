/**
 * Advanced Wireframe Model Editor for GalaxyQuest Ship Designer
 * Features:
 * - Multi-level selection (vertices, edges, faces, components)
 * - Magnetic snap functions (grid, node-to-node, edge alignment)
 * - Component management (engines, weapons, sensors, etc.)
 * - Real-time wireframe rendering with Three.js
 * - Undo/Redo system
 * - Export to JSON geometry
 */

window.createWireframeEditor = function(opts) {
  'use strict';

  const container = opts.container || document.getElementById('node-editor-container');
  if (!container) {
    console.error('[WireframeEditor] Container not found');
    return null;
  }

  const apiBase = opts.apiBase || '/api';
  const onPromptUpdate = opts.onPromptUpdate || (() => {});
  const onExport = opts.onExport || (() => {});

  if (!window.THREE) {
    console.error('[WireframeEditor] THREE.js not found in window');
    return null;
  }

  // Component Color Mapping
  const componentColors = {
    hull: 0xffffff,
    engine: 0xff6b6b,
    sensor: 0x4ecdc4,
    cargo: 0xffe66d,
    weapon: 0xff1493,
    shield: 0x00d4ff,
    armor: 0x95a5a6,
    default: 0x60a5fa,
  };

  // Component Presets - Define geometry for each component type
  const componentPresets = {
    engine: {
      name: 'Engine',
      vertices: [
        { offset: new window.THREE.Vector3(0, 0.5, 0), type: 'engine' },
        { offset: new window.THREE.Vector3(-0.4, -0.5, 0), type: 'engine' },
        { offset: new window.THREE.Vector3(0.4, -0.5, 0), type: 'engine' },
        { offset: new window.THREE.Vector3(0, -0.5, -0.3), type: 'engine' },
      ],
      edges: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]],
    },
    weapon: {
      name: 'Weapon',
      vertices: [
        { offset: new window.THREE.Vector3(0, 0.6, 0), type: 'weapon' },
        { offset: new window.THREE.Vector3(-0.3, -0.3, -0.2), type: 'weapon' },
        { offset: new window.THREE.Vector3(0.3, -0.3, -0.2), type: 'weapon' },
        { offset: new window.THREE.Vector3(0, 0.2, 0.4), type: 'weapon' },
      ],
      edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    },
    sensor: {
      name: 'Sensor',
      vertices: [
        { offset: new window.THREE.Vector3(0, 0.4, 0), type: 'sensor' },
        { offset: new window.THREE.Vector3(-0.25, -0.2, -0.25), type: 'sensor' },
        { offset: new window.THREE.Vector3(0.25, -0.2, -0.25), type: 'sensor' },
        { offset: new window.THREE.Vector3(0, -0.2, 0.25), type: 'sensor' },
      ],
      edges: [[0, 1], [0, 2], [0, 3], [1, 2], [2, 3], [3, 1]],
    },
    shield: {
      name: 'Shield Generator',
      vertices: [
        { offset: new window.THREE.Vector3(0, 0.5, 0.5), type: 'shield' },
        { offset: new window.THREE.Vector3(-0.35, -0.3, 0.3), type: 'shield' },
        { offset: new window.THREE.Vector3(0.35, -0.3, 0.3), type: 'shield' },
        { offset: new window.THREE.Vector3(0, 0.3, -0.4), type: 'shield' },
      ],
      edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]],
    },
    cargo: {
      name: 'Cargo Bay',
      vertices: [
        { offset: new window.THREE.Vector3(-0.4, 0.5, -0.4), type: 'cargo' },
        { offset: new window.THREE.Vector3(0.4, 0.5, -0.4), type: 'cargo' },
        { offset: new window.THREE.Vector3(0.4, 0.5, 0.4), type: 'cargo' },
        { offset: new window.THREE.Vector3(-0.4, 0.5, 0.4), type: 'cargo' },
        { offset: new window.THREE.Vector3(-0.4, -0.5, -0.4), type: 'cargo' },
        { offset: new window.THREE.Vector3(0.4, -0.5, -0.4), type: 'cargo' },
      ],
      edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 5], [4, 5]],
    },
    armor: {
      name: 'Armor Plate',
      vertices: [
        { offset: new window.THREE.Vector3(-0.5, 0.3, 0), type: 'armor' },
        { offset: new window.THREE.Vector3(0.5, 0.3, 0), type: 'armor' },
        { offset: new window.THREE.Vector3(0.5, -0.3, 0), type: 'armor' },
        { offset: new window.THREE.Vector3(-0.5, -0.3, 0), type: 'armor' },
      ],
      edges: [[0, 1], [1, 2], [2, 3], [3, 0]],
    },
  };

  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  const state = {
    // Scene & Rendering
    scene: null,
    camera: null,
    renderer: null,
    raycaster: new window.THREE.Raycaster(),
    mouse: new window.THREE.Vector2(),
    
    // Geometry Data
    vertices: [],           // Array of {id, position: Vector3, components: []}
    edges: [],              // Array of {id, v1Index, v2Index, type: 'hull'|'component'}
    faces: [],              // Array of {id, vertexIndices: []}
    components: [],         // Array of {id, type, vertices: [indices], color}
    
    // UI State
    selectionMode: 'vertices',  // 'vertices', 'edges', 'faces', 'components'
    selectedItems: new Set(),   // IDs of selected vertices/edges/faces/components
    hoveredItem: null,
    draggingVertex: null,
    
    // Rendering Objects
    vertexMeshes: new Map(),    // id -> THREE.Mesh
    edgeLines: new Map(),       // id -> THREE.LineSegments
    faceWireframes: new Map(),  // id -> THREE.LineSegments
    componentMeshes: new Map(), // id -> THREE.Group
    
    // Grid & Snapping
    gridSize: 0.5,
    snapToGrid: true,
    snapToVertices: true,
    snapDistance: 0.3,
    
    // History (Undo/Redo)
    history: [],
    historyIndex: -1,
    
    // Component Colors
    componentColors: componentColors,
  };

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════════════

  container.innerHTML = '';
  container.style.cssText = `
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #0a0e27;
    overflow: hidden;
    font-family: system-ui, sans-serif;
  `;

  // Create toolbar
  const toolbarDiv = document.createElement('div');
  toolbarDiv.style.cssText = `
    background: #1f2937;
    padding: 0.75rem;
    border-bottom: 1px solid #374151;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    flex: 0 0 auto;
  `;
  container.appendChild(toolbarDiv);

  // Create content area
  const contentDiv = document.createElement('div');
  contentDiv.style.cssText = `
    display: flex;
    gap: 1rem;
    flex: 1;
    overflow: hidden;
    padding: 1rem;
    min-height: 0;
  `;
  container.appendChild(contentDiv);

  // Create canvas container
  const canvasContainer = document.createElement('div');
  canvasContainer.style.cssText = `
    flex: 1;
    background: #111827;
    border: 1px solid #1f2937;
    border-radius: 4px;
    position: relative;
    overflow: hidden;
    min-height: 0;
  `;
  contentDiv.appendChild(canvasContainer);

  // Create sidebar
  const sidebarDiv = document.createElement('div');
  sidebarDiv.style.cssText = `
    flex: 0 0 300px;
    background: #1f2937;
    border-radius: 4px;
    padding: 1rem;
    border: 1px solid #374151;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    gap: 1rem;
  `;
  contentDiv.appendChild(sidebarDiv);

  // ═══════════════════════════════════════════════════════════════════
  // THREE.JS SETUP
  // ═══════════════════════════════════════════════════════════════════

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width: 100%; height: 100%; display: block;';
  canvasContainer.appendChild(canvas);

  // Initialize Three.js scene
  state.scene = new window.THREE.Scene();
  state.scene.background = new window.THREE.Color(0x111827);
  state.scene.fog = new window.THREE.Fog(0x111827, 50, 100);

  // Camera
  state.camera = new window.THREE.PerspectiveCamera(
    75,
    canvasContainer.clientWidth / canvasContainer.clientHeight,
    0.1,
    1000
  );
  state.camera.position.set(0, 5, 10);
  state.camera.lookAt(0, 0, 0);

  // Renderer
  state.renderer = new window.THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  state.renderer.setPixelRatio(window.devicePixelRatio);
  state.renderer.shadowMap.enabled = true;
  state.renderer.shadowMap.type = window.THREE.PCFShadowShadowMap;
  state.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);

  // Lighting
  const ambientLight = new window.THREE.AmbientLight(0xffffff, 0.6);
  state.scene.add(ambientLight);

  const directionalLight = new window.THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 15, 10);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  state.scene.add(directionalLight);

  // Grid
  const gridHelper = new window.THREE.GridHelper(20, 20, 0x1f2937, 0x0f172a);
  state.scene.add(gridHelper);

  // ═══════════════════════════════════════════════════════════════════
  // TOOLBAR FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  function createButton(text, color, onClick) {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = `
      padding: 0.4rem 0.8rem;
      background: ${color};
      color: white;
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 0.9rem;
      transition: opacity 0.2s;
    `;
    btn.addEventListener('click', onClick);
    btn.addEventListener('mouseenter', () => (btn.style.opacity = '0.8'));
    btn.addEventListener('mouseleave', () => (btn.style.opacity = '1'));
    return btn;
  }

  // Import button
  const btnImport = createButton('📂 Import', '#6366f1', showImportDialog);
  toolbarDiv.appendChild(btnImport);

  // Mode buttons
  const modeBtnVertices = createButton('📍 Vertices', state.selectionMode === 'vertices' ? '#3b82f6' : '#1e40af', () => {
    state.selectionMode = 'vertices';
    updateModeButtons();
  });
  toolbarDiv.appendChild(modeBtnVertices);

  const modeBtnEdges = createButton('━━ Edges', state.selectionMode === 'edges' ? '#3b82f6' : '#1e40af', () => {
    state.selectionMode = 'edges';
    updateModeButtons();
  });
  toolbarDiv.appendChild(modeBtnEdges);

  const modeBtnFaces = createButton('◼ Faces', state.selectionMode === 'faces' ? '#3b82f6' : '#1e40af', () => {
    state.selectionMode = 'faces';
    updateModeButtons();
  });
  toolbarDiv.appendChild(modeBtnFaces);

  const modeBtnComponents = createButton('⚙ Components', state.selectionMode === 'components' ? '#3b82f6' : '#1e40af', () => {
    state.selectionMode = 'components';
    updateModeButtons();
  });
  toolbarDiv.appendChild(modeBtnComponents);

  function updateModeButtons() {
    const modes = { vertices: modeBtnVertices, edges: modeBtnEdges, faces: modeBtnFaces, components: modeBtnComponents };
    Object.entries(modes).forEach(([mode, btn]) => {
      btn.style.background = state.selectionMode === mode ? '#3b82f6' : '#1e40af';
    });
  }

  // Divider
  const divider = document.createElement('div');
  divider.style.cssText = 'flex: 0 0 1px; background: #374151; margin: 0 0.5rem;';
  toolbarDiv.appendChild(divider);

  // Action buttons
  toolbarDiv.appendChild(createButton('➕ Add Vertex', '#10b981', () => {
    addVertex(new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  }));

  toolbarDiv.appendChild(createButton('🔗 Connect', '#8b5cf6', showConnectDialog));
  toolbarDiv.appendChild(createButton('❌ Delete', '#ef4444', deleteSelected));
  toolbarDiv.appendChild(createButton('🧲 Snap', '#f59e0b', applySnapping));
  toolbarDiv.appendChild(createButton('🔄 Reset', '#6b7280', resetToDefault));

  const btnExport = createButton('📤 Export', '#f59e0b', exportGeometry);
  btnExport.style.marginLeft = 'auto';
  toolbarDiv.appendChild(btnExport);

  toolbarDiv.appendChild(createButton('💾 Save', '#10b981', saveDesignToDatabase));
  toolbarDiv.appendChild(createButton('📂 Load', '#3b82f6', loadDesignsDialog));

  toolbarDiv.appendChild(createButton('↶ Undo', '#1e40af', undo));
  toolbarDiv.appendChild(createButton('↷ Redo', '#1e40af', redo));

  // Transform buttons
  const divider2 = document.createElement('div');
  divider2.style.cssText = 'flex: 0 0 1px; background: #374151; margin: 0 0.5rem;';
  toolbarDiv.appendChild(divider2);

  toolbarDiv.appendChild(createButton('📋 Duplicate', '#8b5cf6', duplicateSelected));
  toolbarDiv.appendChild(createButton('⬆️ Scale', '#06b6d4', showScaleDialog));
  toolbarDiv.appendChild(createButton('↻ Rotate X', '#f59e0b', () => rotateSelected('x', 45)));
  toolbarDiv.appendChild(createButton('↻ Rotate Y', '#f59e0b', () => rotateSelected('y', 45)));
  toolbarDiv.appendChild(createButton('↻ Rotate Z', '#f59e0b', () => rotateSelected('z', 45)));
  toolbarDiv.appendChild(createButton('🪞 Mirror X', '#ec4899', () => mirrorSelected('x')));
  toolbarDiv.appendChild(createButton('🪞 Mirror Y', '#ec4899', () => mirrorSelected('y')));
  toolbarDiv.appendChild(createButton('🪞 Mirror Z', '#ec4899', () => mirrorSelected('z')));
  toolbarDiv.appendChild(createButton('📐 Create Face', '#14b8a6', createFaceFromSelection));

  // ═══════════════════════════════════════════════════════════════════
  // SIDEBAR UI
  // ═══════════════════════════════════════════════════════════════════

  // Selection mode info
  const modeInfoDiv = document.createElement('div');
  modeInfoDiv.style.cssText = `
    padding: 0.5rem;
    background: #111827;
    border-radius: 3px;
    border-left: 3px solid #60a5fa;
    font-size: 0.85rem;
    color: #d1d5db;
  `;
  sidebarDiv.appendChild(modeInfoDiv);

  // Snap settings
  const snapSettingsDiv = document.createElement('div');
  snapSettingsDiv.innerHTML = `
    <div style="font-weight: bold; color: #e5e7eb; margin-bottom: 0.5rem; font-size: 0.9rem;">🧲 Snap Settings</div>
    <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; margin-bottom: 0.4rem; font-size: 0.85rem;">
      <input type="checkbox" id="snap-grid" checked style="width: 14px; height: 14px;">
      <span>Snap to Grid</span>
    </label>
    <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; margin-bottom: 0.4rem; font-size: 0.85rem;">
      <input type="checkbox" id="snap-vertices" checked style="width: 14px; height: 14px;">
      <span>Snap to Vertices</span>
    </label>
    <label style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer; font-size: 0.85rem;">
      <label>Grid Size:</label>
      <input type="number" id="grid-size" value="0.5" min="0.1" max="2" step="0.1" style="width: 50px; padding: 0.2rem; background: #0f172a; color: #e5e7eb; border: 1px solid #374151; border-radius: 2px;">
    </label>
  `;
  snapSettingsDiv.style.cssText = 'padding: 0.75rem; background: #111827; border-radius: 3px; font-size: 0.85rem;';
  sidebarDiv.appendChild(snapSettingsDiv);

  // Stats
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = `
    padding: 0.75rem;
    background: #111827;
    border-radius: 3px;
    border-top: 1px solid #374151;
    font-size: 0.85rem;
  `;
  sidebarDiv.appendChild(statsDiv);

  // Selection list
  const selectionDiv = document.createElement('div');
  selectionDiv.style.cssText = `
    padding: 0.75rem;
    background: #111827;
    border-radius: 3px;
    flex: 1;
    overflow-y: auto;
    max-height: 300px;
  `;
  selectionDiv.innerHTML = `<div style="color: #9ca3af; font-size: 0.85rem;">No selection</div>`;
  sidebarDiv.appendChild(selectionDiv);

  // Component Library
  const componentLibDiv = document.createElement('div');
  componentLibDiv.style.cssText = `
    padding: 0.75rem;
    background: #111827;
    border-radius: 3px;
    border-top: 1px solid #374151;
  `;
  componentLibDiv.innerHTML = `
    <div style="font-weight: bold; color: #e5e7eb; margin-bottom: 0.5rem; font-size: 0.9rem;">⚙️ Components</div>
    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.3rem; font-size: 0.8rem;">
      <button id="comp-engine" style="padding: 0.3rem; background: #ff6b6b; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">🔴 Engine</button>
      <button id="comp-weapon" style="padding: 0.3rem; background: #ff1493; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">🩷 Weapon</button>
      <button id="comp-sensor" style="padding: 0.3rem; background: #4ecdc4; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">🔵 Sensor</button>
      <button id="comp-shield" style="padding: 0.3rem; background: #00d4ff; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">⚡ Shield</button>
      <button id="comp-cargo" style="padding: 0.3rem; background: #ffe66d; color: black; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">📦 Cargo</button>
      <button id="comp-armor" style="padding: 0.3rem; background: #95a5a6; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">🛡️ Armor</button>
    </div>
  `;
  sidebarDiv.appendChild(componentLibDiv);

  // ═══════════════════════════════════════════════════════════════════
  // WIREFRAME GEOMETRY FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════

  function addVertex(position, componentType = 'hull') {
    const id = `v_${state.vertices.length}`;
    const vertex = {
      id,
      position: position.clone(),
      components: [componentType],
    };
    state.vertices.push(vertex);

    // Create mesh for vertex
    const geom = new window.THREE.SphereGeometry(0.15, 8, 8);
    const color = state.componentColors[componentType] || state.componentColors.default;
    const mat = new window.THREE.MeshStandardMaterial({ color, emissive: 0x000000, wireframe: false });
    const mesh = new window.THREE.Mesh(geom, mat);
    mesh.position.copy(position);
    mesh.userData = { type: 'vertex', id };
    state.scene.add(mesh);
    state.vertexMeshes.set(id, mesh);

    saveHistory();
    updateUI();
    return id;
  }

  function addComponent(componentType, basePosition) {
    const preset = componentPresets[componentType];
    if (!preset) {
      console.warn('[WireframeEditor] Unknown component type:', componentType);
      return;
    }

    const baseIdx = state.vertices.length;
    const vertexMap = [];

    // Add vertices
    preset.vertices.forEach(vDef => {
      const pos = basePosition.clone().add(vDef.offset);
      const id = addVertex(pos, vDef.type);
      vertexMap.push(id);
    });

    // Add edges
    preset.edges.forEach(edge => {
      const v1Idx = baseIdx + edge[0];
      const v2Idx = baseIdx + edge[1];
      addEdge(v1Idx, v2Idx, componentType);
    });

    console.log('[WireframeEditor] Added component:', preset.name, 'with', preset.vertices.length, 'vertices');
  }

  function addEdge(v1Index, v2Index, type = 'hull') {
    if (v1Index === v2Index || v1Index >= state.vertices.length || v2Index >= state.vertices.length) return null;

    // Check if edge already exists
    const exists = state.edges.some(e => (e.v1Index === v1Index && e.v2Index === v2Index) || (e.v1Index === v2Index && e.v2Index === v1Index));
    if (exists) return null;

    const id = `e_${state.edges.length}`;
    const edge = { id, v1Index, v2Index, type };
    state.edges.push(edge);

    // Create line for edge
    const v1 = state.vertices[v1Index].position;
    const v2 = state.vertices[v2Index].position;
    const points = [v1, v2];
    const geom = new window.THREE.BufferGeometry().setFromPoints(points);
    const mat = new window.THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 2 });
    const line = new window.THREE.LineSegments(geom, mat);
    line.userData = { type: 'edge', id };
    state.scene.add(line);
    state.edgeLines.set(id, line);

    saveHistory();
    updateUI();
    return id;
  }

  function deleteSelected() {
    if (state.selectedItems.size === 0) return;

    const itemsToDelete = Array.from(state.selectedItems);
    itemsToDelete.forEach(id => {
      if (id.startsWith('v_')) {
        // Delete vertex and connected edges
        const idx = state.vertices.findIndex(v => v.id === id);
        if (idx !== -1) {
          state.vertices.splice(idx, 1);
          state.vertexMeshes.get(id)?.removeFromParent();
          state.vertexMeshes.delete(id);
          state.scene.remove(state.vertexMeshes.get(id));

          // Remove connected edges
          state.edges = state.edges.filter(e => e.v1Index !== idx && e.v2Index !== idx);

          // Remove connected faces
          state.faces = state.faces.filter(f => !f.vertexIndices.includes(idx));
          state.faceWireframes.forEach((wireframe, fId) => {
            const face = state.faces.find(f => f.id === fId);
            if (!face) {
              state.scene.remove(wireframe);
              state.faceWireframes.delete(fId);
            }
          });
        }
      } else if (id.startsWith('e_')) {
        const idx = state.edges.findIndex(e => e.id === id);
        if (idx !== -1) {
          state.edgeLines.get(id)?.removeFromParent();
          state.edgeLines.delete(id);
          state.scene.remove(state.edgeLines.get(id));
          state.edges.splice(idx, 1);
        }
      } else if (id.startsWith('f_')) {
        deleteFaces([id]);
      }
    });

    state.selectedItems.clear();
    saveHistory();
    updateUI();
  }

  function applySnapping() {
    state.vertices.forEach(v => {
      if (state.snapToGrid) {
        v.position.x = Math.round(v.position.x / state.gridSize) * state.gridSize;
        v.position.y = Math.round(v.position.y / state.gridSize) * state.gridSize;
        v.position.z = Math.round(v.position.z / state.gridSize) * state.gridSize;
      }

      if (state.snapToVertices) {
        state.vertices.forEach(other => {
          if (v === other) return;
          const dist = v.position.distanceTo(other.position);
          if (dist < state.snapDistance && dist > 0.01) {
            v.position.lerp(other.position, 0.5);
          }
        });
      }

      // Update mesh position
      const mesh = state.vertexMeshes.get(v.id);
      if (mesh) mesh.position.copy(v.position);
    });

    redrawEdges();
    saveHistory();
  }

  function showConnectDialog() {
    const selected = Array.from(state.selectedItems).filter(id => id.startsWith('v_'));
    if (selected.length < 2) {
      alert('Select at least 2 vertices to connect');
      return;
    }

    for (let i = 0; i < selected.length - 1; i++) {
      const v1Idx = state.vertices.findIndex(v => v.id === selected[i]);
      const v2Idx = state.vertices.findIndex(v => v.id === selected[i + 1]);
      addEdge(v1Idx, v2Idx);
    }
  }

  function showImportDialog() {
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: #1f2937;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 2rem;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 20px 25px rgba(0, 0, 0, 0.3);
    `;

    dialog.innerHTML = `
      <h2 style="margin: 0 0 1.5rem 0; color: #e5e7eb; font-size: 1.3rem;">📂 Import Geometry</h2>
      
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <!-- File Upload Tab -->
        <div style="border-bottom: 1px solid #374151; padding-bottom: 1rem;">
          <h3 style="margin: 0 0 0.75rem 0; color: #d1d5db; font-size: 0.95rem;">📄 From File (JSON)</h3>
          <input type="file" id="import-file" accept=".json" style="width: 100%; padding: 0.5rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; cursor: pointer;">
          <button id="import-file-btn" style="margin-top: 0.5rem; width: 100%; padding: 0.5rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Load from File</button>
        </div>

        <!-- JSON Paste Tab -->
        <div style="border-bottom: 1px solid #374151; padding-bottom: 1rem;">
          <h3 style="margin: 0 0 0.75rem 0; color: #d1d5db; font-size: 0.95rem;">📋 Paste JSON</h3>
          <textarea id="import-json" placeholder='{"vertices": [...], "edges": [...]}' style="width: 100%; height: 150px; padding: 0.5rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px; font-family: monospace; font-size: 0.85rem; resize: vertical; box-sizing: border-box;"></textarea>
          <button id="import-json-btn" style="margin-top: 0.5rem; width: 100%; padding: 0.5rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Load from JSON</button>
        </div>

        <!-- API Load Tab -->
        <div style="padding-bottom: 1rem;">
          <h3 style="margin: 0 0 0.75rem 0; color: #d1d5db; font-size: 0.95rem;">☁️ From API</h3>
          <select id="import-api" style="width: 100%; padding: 0.5rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 4px;">
            <option value="">Select a saved design...</option>
          </select>
          <button id="import-api-btn" style="margin-top: 0.5rem; width: 100%; padding: 0.5rem; background: #3b82f6; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Load from API</button>
        </div>

        <!-- Action Buttons -->
        <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
          <button id="import-cancel" style="padding: 0.5rem 1rem; background: #6b7280; color: white; border: none; border-radius: 4px; cursor: pointer;">Cancel</button>
          <button id="import-clear" style="padding: 0.5rem 1rem; background: #ef4444; color: white; border: none; border-radius: 4px; cursor: pointer;">Clear & Reset</button>
        </div>
      </div>
    `;

    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Load API options
    fetch(apiBase + '/vessel_designs')
      .then(r => r.json())
      .then(designs => {
        const select = document.getElementById('import-api');
        designs.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.name || ('Design #' + d.id);
          select.appendChild(opt);
        });
      })
      .catch(e => console.warn('[ImportDialog] Could not load API designs:', e));

    // File upload handler
    document.getElementById('import-file-btn').addEventListener('click', () => {
      const file = document.getElementById('import-file').files[0];
      if (!file) {
        alert('Please select a file');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          importGeometry(data);
          modal.remove();
        } catch (err) {
          alert('Invalid JSON: ' + err.message);
        }
      };
      reader.readAsText(file);
    });

    // JSON paste handler
    document.getElementById('import-json-btn').addEventListener('click', () => {
      const json = document.getElementById('import-json').value.trim();
      if (!json) {
        alert('Please paste JSON');
        return;
      }
      try {
        const data = JSON.parse(json);
        importGeometry(data);
        modal.remove();
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
      }
    });

    // API load handler
    document.getElementById('import-api-btn').addEventListener('click', () => {
      const id = document.getElementById('import-api').value;
      if (!id) {
        alert('Please select a design');
        return;
      }
      fetch(apiBase + '/vessel_designs/' + id)
        .then(r => r.json())
        .then(design => {
          if (design.geometry) {
            importGeometry(JSON.parse(design.geometry));
            modal.remove();
          } else {
            alert('No geometry found');
          }
        })
        .catch(e => alert('Error loading design: ' + e.message));
    });

    // Close handlers
    document.getElementById('import-cancel').addEventListener('click', () => modal.remove());
    document.getElementById('import-clear').addEventListener('click', () => {
      if (confirm('Clear all geometry and reset?')) {
        resetToDefault();
        modal.remove();
      }
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  }

  function importGeometry(data) {
    // Clear existing
    state.vertices = [];
    state.edges = [];
    state.selectedItems.clear();
    state.vertexMeshes.forEach(m => state.scene.remove(m));
    state.edgeLines.forEach(l => state.scene.remove(l));
    state.vertexMeshes.clear();
    state.edgeLines.clear();

    // Import vertices
    if (data.vertices && Array.isArray(data.vertices)) {
      data.vertices.forEach(v => {
        const pos = new window.THREE.Vector3(v.position.x, v.position.y, v.position.z);
        const compType = (v.components && v.components[0]) || 'hull';
        addVertex(pos, compType);
      });
    }

    // Import edges
    if (data.edges && Array.isArray(data.edges)) {
      data.edges.forEach(e => {
        addEdge(e.v1Index, e.v2Index, e.type || 'hull');
      });
    }

    saveHistory();
    updateUI();
    console.log('[WireframeEditor] Imported:', (data.vertices && data.vertices.length) || 0, 'vertices,', (data.edges && data.edges.length) || 0, 'edges');
  }

  function redrawEdges() {
    state.edgeLines.forEach(line => state.scene.remove(line));
    state.edgeLines.clear();

    state.edges.forEach(edge => {
      const v1 = state.vertices[edge.v1Index].position;
      const v2 = state.vertices[edge.v2Index].position;
      const points = [v1, v2];
      const geom = new window.THREE.BufferGeometry().setFromPoints(points);
      const mat = new window.THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 2 });
      const line = new window.THREE.LineSegments(geom, mat);
      line.userData = { type: 'edge', id: edge.id };
      state.scene.add(line);
      state.edgeLines.set(edge.id, line);
    });
  }

  function resetToDefault() {
    state.vertices = [];
    state.edges = [];
    state.faces = [];
    state.components = [];
    state.selectedItems.clear();

    state.vertexMeshes.forEach(mesh => state.scene.remove(mesh));
    state.edgeLines.forEach(line => state.scene.remove(line));
    state.faceWireframes.forEach(line => state.scene.remove(line));

    state.vertexMeshes.clear();
    state.edgeLines.clear();
    state.faceWireframes.clear();

    // Create default pyramid
    const positions = [
      new window.THREE.Vector3(0, 2, 0),    // top
      new window.THREE.Vector3(-1, 0, -1),  // front-left
      new window.THREE.Vector3(1, 0, -1),   // front-right
      new window.THREE.Vector3(1, 0, 1),    // back-right
      new window.THREE.Vector3(-1, 0, 1),   // back-left
    ];

    positions.forEach((pos, i) => addVertex(pos, 'hull'));

    // Connect edges
    addEdge(0, 1); addEdge(0, 2); addEdge(0, 3); addEdge(0, 4);
    addEdge(1, 2); addEdge(2, 3); addEdge(3, 4); addEdge(4, 1);

    saveHistory();
    updateUI();
  }

  function exportGeometry() {
    const data = {
      vertices: state.vertices.map(v => ({
        id: v.id,
        position: { x: v.position.x, y: v.position.y, z: v.position.z },
        components: v.components,
      })),
      edges: state.edges,
      faces: state.faces,
      components: state.components,
    };

    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'wireframe-geometry.json';
    link.click();
    URL.revokeObjectURL(url);

    onExport(json);
  }

  function saveDesignToDatabase() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); 
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1f2937; padding: 2rem; border-radius: 8px; border: 1px solid #374151;
      min-width: 400px; color: #e5e7eb; font-family: system-ui, sans-serif;
    `;

    const title = document.createElement('h3');
    title.textContent = '💾 Save Design';
    title.style.cssText = 'margin: 0 0 1.5rem 0; font-size: 1.2rem; color: #e5e7eb;';
    modal.appendChild(title);

    // Design Name
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Design Name:';
    nameLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-weight: bold; color: #d1d5db;';
    modal.appendChild(nameLabel);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g., Advanced Warship';
    nameInput.value = 'Untitled Design ' + new Date().toLocaleDateString();
    nameInput.style.cssText = `
      width: 100%; padding: 0.5rem; background: #111827; border: 1px solid #374151; 
      border-radius: 3px; color: #e5e7eb; margin-bottom: 1rem; box-sizing: border-box;
    `;
    modal.appendChild(nameInput);

    // Design Description
    const descLabel = document.createElement('label');
    descLabel.textContent = 'Description:';
    descLabel.style.cssText = 'display: block; margin-bottom: 0.5rem; font-weight: bold; color: #d1d5db;';
    modal.appendChild(descLabel);

    const descInput = document.createElement('textarea');
    descInput.placeholder = 'Optional: Add design notes...';
    descInput.style.cssText = `
      width: 100%; padding: 0.5rem; background: #111827; border: 1px solid #374151; 
      border-radius: 3px; color: #e5e7eb; margin-bottom: 1rem; box-sizing: border-box;
      font-family: system-ui, sans-serif; min-height: 80px; resize: vertical;
    `;
    modal.appendChild(descInput);

    // Stats info
    const statsInfo = document.createElement('div');
    statsInfo.style.cssText = 'background: #111827; padding: 0.75rem; border-radius: 3px; margin-bottom: 1rem; font-size: 0.85rem; color: #9ca3af;';
    statsInfo.innerHTML = `
      <div><strong>${state.vertices.length}</strong> Vertices</div>
      <div><strong>${state.edges.length}</strong> Edges</div>
      <div><strong>${state.faces.length}</strong> Faces</div>
    `;
    modal.appendChild(statsInfo);

    // Buttons
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 0.5rem;';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = '✓ Save to DB';
    saveBtn.style.cssText = `
      flex: 1; padding: 0.6rem; background: #10b981; color: white; border: none; 
      border-radius: 3px; cursor: pointer; font-weight: bold; font-size: 0.95rem;
    `;
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert('Please enter a design name');
        return;
      }
      performSaveToDatabase(name, descInput.value);
      document.body.removeChild(overlay);
    });
    buttons.appendChild(saveBtn);

    const localBtn = document.createElement('button');
    localBtn.textContent = '💾 Save Local';
    localBtn.style.cssText = `
      flex: 1; padding: 0.6rem; background: #3b82f6; color: white; border: none; 
      border-radius: 3px; cursor: pointer; font-weight: bold; font-size: 0.95rem;
    `;
    localBtn.addEventListener('click', () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert('Please enter a design name');
        return;
      }
      saveToLocalStorage(name, descInput.value);
      document.body.removeChild(overlay);
    });
    buttons.appendChild(localBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.style.cssText = `
      flex: 1; padding: 0.6rem; background: #6b7280; color: white; border: none; 
      border-radius: 3px; cursor: pointer; font-weight: bold; font-size: 0.95rem;
    `;
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    buttons.appendChild(cancelBtn);

    modal.appendChild(buttons);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
    nameInput.focus();
  }

  function performSaveToDatabase(name, description) {
    const data = {
      vertices: state.vertices.map(v => ({
        id: v.id,
        position: { x: v.position.x, y: v.position.y, z: v.position.z },
        components: v.components,
      })),
      edges: state.edges,
      faces: state.faces,
      components: state.components,
    };

    const payload = {
      name: name,
      description: description || '',
      vertices: data.vertices,
      edges: data.edges,
      faces: data.faces,
      components: data.components,
    };

    console.log('[WireframeEditor] Saving wireframe design:', name);
    
    fetch(apiBase + '/vessel_designs.php?wireframe=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(result => {
        console.log('[WireframeEditor] Design saved:', result);
        
        // Store design ID in UnifiedDesignerUI if available
        if (window.unifiedUI && result.id) {
          window.unifiedUI.setCurrentDesignId(result.id);
          console.log('[WireframeEditor] Design ID stored:', result.id);
        }
        
        showNotification('✓ Design saved to database!', 'success');
        saveToLocalStorage(name, description, true);
      })
      .catch(err => {
        console.error('[WireframeEditor] Save failed:', err);
        showNotification('⚠ Database save failed, but saved locally', 'warning');
        saveToLocalStorage(name, description, true);
      });
  }

  function saveToLocalStorage(name, description, syncedToDb = false) {
    const data = {
      name: name,
      description: description || '',
      timestamp: new Date().toISOString(),
      syncedToDb: syncedToDb,
      geometry: {
        vertices: state.vertices.map(v => ({
          id: v.id,
          position: { x: v.position.x, y: v.position.y, z: v.position.z },
          components: v.components,
        })),
        edges: state.edges,
        faces: state.faces,
        components: state.components,
      },
    };

    try {
      const key = 'wireframe_design_' + name.replace(/\s+/g, '_');
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.setItem('wireframe_designs_index', JSON.stringify(
        (JSON.parse(localStorage.getItem('wireframe_designs_index') || '[]')).filter(k => k !== key).concat([key])
      ));
      console.log('[WireframeEditor] Design saved to localStorage:', key);
      showNotification('✓ Design saved locally!', 'success');
    } catch (err) {
      console.error('[WireframeEditor] LocalStorage save failed:', err);
      showNotification('✕ Save failed', 'error');
    }
  }

  function loadDesignsDialog() {
    const designs = [];
    
    // Get LocalStorage designs
    try {
      const index = JSON.parse(localStorage.getItem('wireframe_designs_index') || '[]');
      index.forEach(key => {
        const data = JSON.parse(localStorage.getItem(key));
        if (data) {
          designs.push({
            id: key,
            name: data.name,
            description: data.description,
            timestamp: new Date(data.timestamp),
            vertices: data.geometry.vertices.length,
            edges: data.geometry.edges.length,
            faces: data.geometry.faces.length,
            source: 'local',
            data: data,
          });
        }
      });
      designs.sort((a, b) => b.timestamp - a.timestamp);
    } catch (err) {
      console.error('[WireframeEditor] Failed to load design list:', err);
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); 
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1f2937; padding: 2rem; border-radius: 8px; border: 1px solid #374151;
      min-width: 500px; max-height: 80vh; color: #e5e7eb; font-family: system-ui, sans-serif;
      display: flex; flex-direction: column;
    `;

    const title = document.createElement('h3');
    title.textContent = '📂 Load Design';
    title.style.cssText = 'margin: 0 0 1.5rem 0; font-size: 1.2rem; color: #e5e7eb;';
    modal.appendChild(title);

    // Design List
    const listContainer = document.createElement('div');
    listContainer.style.cssText = `
      flex: 1; overflow-y: auto; margin-bottom: 1rem; border: 1px solid #374151; 
      border-radius: 4px; background: #111827;
    `;

    if (designs.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No saved designs';
      empty.style.cssText = 'padding: 2rem; text-align: center; color: #6b7280;';
      listContainer.appendChild(empty);
    } else {
      designs.forEach(design => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding: 1rem; border-bottom: 1px solid #374151; cursor: pointer; 
          transition: background 0.2s; display: flex; justify-content: space-between; align-items: center;
        `;
        item.addEventListener('mouseenter', () => {
          item.style.background = '#374151';
        });
        item.addEventListener('mouseleave', () => {
          item.style.background = 'transparent';
        });

        const info = document.createElement('div');
        info.style.cssText = 'flex: 1;';
        info.innerHTML = `
          <div style="font-weight: bold; color: #60a5fa; margin-bottom: 0.25rem;">${design.name}</div>
          <div style="font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.25rem;">${design.description}</div>
          <div style="font-size: 0.8rem; color: #6b7280;">
            ${design.vertices} V • ${design.edges} E • ${design.faces} F 
            • ${design.timestamp.toLocaleDateString()}
          </div>
        `;
        item.appendChild(info);

        const actions = document.createElement('div');
        actions.style.cssText = 'display: flex; gap: 0.5rem; margin-left: 1rem;';

        const loadBtn = document.createElement('button');
        loadBtn.textContent = '↓ Load';
        loadBtn.style.cssText = `
          padding: 0.4rem 0.8rem; background: #10b981; color: white; border: none; 
          border-radius: 3px; cursor: pointer; font-size: 0.85rem; font-weight: bold;
        `;
        loadBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          performLoadDesign(design);
          document.body.removeChild(overlay);
        });
        actions.appendChild(loadBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑';
        deleteBtn.style.cssText = `
          padding: 0.4rem 0.6rem; background: #ef4444; color: white; border: none; 
          border-radius: 3px; cursor: pointer; font-size: 0.85rem;
        `;
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm('Delete this design?')) {
            localStorage.removeItem(design.id);
            const index = JSON.parse(localStorage.getItem('wireframe_designs_index') || '[]');
            localStorage.setItem('wireframe_designs_index', JSON.stringify(index.filter(k => k !== design.id)));
            showNotification('✓ Design deleted', 'success');
            loadDesignsDialog();
            document.body.removeChild(overlay);
          }
        });
        actions.appendChild(deleteBtn);

        item.appendChild(actions);
        item.addEventListener('click', () => {
          performLoadDesign(design);
          document.body.removeChild(overlay);
        });

        listContainer.appendChild(item);
      });
    }

    modal.appendChild(listContainer);

    // Buttons
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 0.5rem;';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ Close';
    closeBtn.style.cssText = `
      flex: 1; padding: 0.6rem; background: #6b7280; color: white; border: none; 
      border-radius: 3px; cursor: pointer; font-weight: bold;
    `;
    closeBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    buttons.appendChild(closeBtn);

    modal.appendChild(buttons);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

  function performLoadDesign(design) {
    if (!design.data || !design.data.geometry) {
      console.error('[WireframeEditor] Invalid design data');
      return;
    }

    const geom = design.data.geometry;
    
    // Store design ID in UnifiedDesignerUI if available
    if (window.unifiedUI && design.id) {
      // If design.id is numeric (from DB), use it; otherwise it's a localStorage key
      const designId = parseInt(design.id) || design.id;
      window.unifiedUI.setCurrentDesignId(designId);
      console.log('[WireframeEditor] Design ID stored on load:', designId);
    }
    
    // Clear current state
    state.vertices.length = 0;
    state.edges.length = 0;
    state.faces.length = 0;
    state.selectedItems.clear();
    
    state.vertexMeshes.forEach(mesh => state.scene.remove(mesh));
    state.edgeLines.forEach(line => state.scene.remove(line));
    state.faceWireframes.forEach(wireframe => state.scene.remove(wireframe));
    state.componentMeshes.forEach(mesh => state.scene.remove(mesh));
    
    state.vertexMeshes.clear();
    state.edgeLines.clear();
    state.faceWireframes.clear();
    state.componentMeshes.clear();

    // Load vertices
    geom.vertices.forEach(vData => {
      const pos = new window.THREE.Vector3(vData.position.x, vData.position.y, vData.position.z);
      addVertex(pos, vData.components[0] || 'hull');
    });

    // Load edges
    geom.edges.forEach(edge => {
      addEdge(edge.v1Index, edge.v2Index, edge.type || 'hull');
    });

    // Load faces
    geom.faces.forEach(face => {
      const faceId = face.id;
      const vertexIndices = face.vertexIndices;
      
      if (vertexIndices && vertexIndices.length >= 3) {
        const positions = [];
        vertexIndices.forEach(idx => {
          const v = state.vertices[idx];
          if (v) positions.push(v.position.x, v.position.y, v.position.z);
        });

        const geomFace = new window.THREE.BufferGeometry();
        const indices = [];
        for (let i = 0; i < vertexIndices.length; i++) {
          indices.push(i, (i + 1) % vertexIndices.length);
        }

        geomFace.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(positions), 3));
        geomFace.setIndex(new window.THREE.BufferAttribute(new Uint32Array(indices), 1));

        const mat = new window.THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
        const wireframe = new window.THREE.LineSegments(geomFace, mat);
        wireframe.userData = { type: 'face', id: faceId };
        state.scene.add(wireframe);
        state.faceWireframes.set(faceId, wireframe);

        state.faces.push(face);
      }
    });

    saveHistory();
    updateUI();
    console.log('[WireframeEditor] Loaded design:', design.name, 'with', geom.vertices.length, 'vertices');
    showNotification('✓ Design loaded: ' + design.name, 'success');
  }

  function showNotification(message, type = 'info') {
    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; padding: 1rem 1.5rem; 
      border-radius: 4px; font-family: system-ui, sans-serif; font-weight: bold;
      z-index: 10001; animation: slideIn 0.3s ease-out;
    `;
    
    if (type === 'success') {
      notif.style.background = '#10b981';
      notif.style.color = 'white';
    } else if (type === 'warning') {
      notif.style.background = '#f59e0b';
      notif.style.color = 'white';
    } else if (type === 'error') {
      notif.style.background = '#ef4444';
      notif.style.color = 'white';
    } else {
      notif.style.background = '#3b82f6';
      notif.style.color = 'white';
    }
    
    notif.textContent = message;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.style.transition = 'opacity 0.3s ease-in';
      notif.style.opacity = '0';
      setTimeout(() => document.body.removeChild(notif), 300);
    }, 3000);
  }

  function undo() {
    if (state.historyIndex > 0) {
      state.historyIndex--;
      restoreHistory();
    }
  }

  function redo() {
    if (state.historyIndex < state.history.length - 1) {
      state.historyIndex++;
      restoreHistory();
    }
  }

  function duplicateSelected() {
    if (state.selectedItems.size === 0) {
      console.warn('[WireframeEditor] No selection to duplicate');
      return;
    }

    const selectedVertices = Array.from(state.selectedItems).filter(id => id.startsWith('v_'));
    if (selectedVertices.length === 0) {
      console.warn('[WireframeEditor] No vertices selected for duplication');
      return;
    }

    const oldToNewMap = new Map();
    const offset = new window.THREE.Vector3(1, 0, 0);

    // Duplicate vertices
    selectedVertices.forEach(vId => {
      const oldV = state.vertices.find(v => v.id === vId);
      if (oldV) {
        const newPos = oldV.position.clone().add(offset);
        const newVId = addVertex(newPos, oldV.components[0]);
        oldToNewMap.set(oldV.id, newVId);
      }
    });

    // Duplicate edges between selected vertices
    state.edges.forEach(edge => {
      const oldV1 = state.vertices[edge.v1Index];
      const oldV2 = state.vertices[edge.v2Index];
      if (oldToNewMap.has(oldV1.id) && oldToNewMap.has(oldV2.id)) {
        const newV1Idx = state.vertices.findIndex(v => v.id === oldToNewMap.get(oldV1.id));
        const newV2Idx = state.vertices.findIndex(v => v.id === oldToNewMap.get(oldV2.id));
        addEdge(newV1Idx, newV2Idx, edge.type);
      }
    });

    console.log('[WireframeEditor] Duplicated:', selectedVertices.length, 'vertices');
    saveHistory();
  }

  function showScaleDialog() {
    if (state.selectedItems.size === 0) {
      console.warn('[WireframeEditor] No selection to scale');
      return;
    }

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); 
      display: flex; align-items: center; justify-content: center; z-index: 10000;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1f2937; padding: 2rem; border-radius: 8px; border: 1px solid #374151;
      min-width: 350px; color: #e5e7eb; font-family: system-ui, sans-serif;
    `;

    const title = document.createElement('h3');
    title.textContent = '⬆️ Scale Selection';
    title.style.cssText = 'margin: 0 0 1rem 0; font-size: 1.1rem;';
    modal.appendChild(title);

    const container = document.createElement('div');
    container.style.cssText = 'display: flex; gap: 1rem; align-items: center; margin-bottom: 1.5rem;';

    const label = document.createElement('label');
    label.textContent = 'Scale:';
    label.style.cssText = 'flex: 0 0 60px; font-weight: bold;';
    container.appendChild(label);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0.1';
    input.max = '3';
    input.step = '0.1';
    input.value = '1';
    input.style.cssText = 'flex: 1; cursor: pointer;';
    container.appendChild(input);

    const value = document.createElement('span');
    value.textContent = '1.0x';
    value.style.cssText = 'flex: 0 0 50px; text-align: right; font-weight: bold; color: #60a5fa;';
    container.appendChild(value);

    input.addEventListener('input', (e) => {
      value.textContent = parseFloat(e.target.value).toFixed(1) + 'x';
    });

    modal.appendChild(container);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 0.5rem;';

    const okBtn = document.createElement('button');
    okBtn.textContent = '✓ Apply';
    okBtn.style.cssText = 'flex: 1; padding: 0.5rem; background: #10b981; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;';
    okBtn.addEventListener('click', () => {
      const scale = parseFloat(input.value);
      scaleSelected(scale);
      document.body.removeChild(overlay);
    });
    buttons.appendChild(okBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '✕ Cancel';
    cancelBtn.style.cssText = 'flex: 1; padding: 0.5rem; background: #6b7280; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;';
    cancelBtn.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
    buttons.appendChild(cancelBtn);

    modal.appendChild(buttons);
    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) document.body.removeChild(overlay);
    });
    document.body.appendChild(overlay);
  }

  function scaleSelected(scale) {
    const center = new window.THREE.Vector3();
    const selectedVertices = Array.from(state.selectedItems)
      .filter(id => id.startsWith('v_'))
      .map(id => state.vertices.find(v => v.id === id))
      .filter(v => v);

    if (selectedVertices.length === 0) return;

    // Calculate center
    selectedVertices.forEach(v => center.add(v.position));
    center.divideScalar(selectedVertices.length);

    // Scale around center
    selectedVertices.forEach(v => {
      v.position.sub(center).multiplyScalar(scale).add(center);
      const mesh = state.vertexMeshes.get(v.id);
      if (mesh) mesh.position.copy(v.position);
    });

    redrawEdges();
    saveHistory();
    console.log('[WireframeEditor] Scaled selection by', scale.toFixed(2) + 'x');
  }

  function rotateSelected(axis, degrees) {
    const radians = (degrees * Math.PI) / 180;
    const center = new window.THREE.Vector3();
    const selectedVertices = Array.from(state.selectedItems)
      .filter(id => id.startsWith('v_'))
      .map(id => state.vertices.find(v => v.id === id))
      .filter(v => v);

    if (selectedVertices.length === 0) return;

    // Calculate center
    selectedVertices.forEach(v => center.add(v.position));
    center.divideScalar(selectedVertices.length);

    // Rotate around center
    const quaternion = new window.THREE.Quaternion();
    if (axis === 'x') quaternion.setFromAxisAngle(new window.THREE.Vector3(1, 0, 0), radians);
    else if (axis === 'y') quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 1, 0), radians);
    else if (axis === 'z') quaternion.setFromAxisAngle(new window.THREE.Vector3(0, 0, 1), radians);

    selectedVertices.forEach(v => {
      v.position.sub(center).applyQuaternion(quaternion).add(center);
      const mesh = state.vertexMeshes.get(v.id);
      if (mesh) mesh.position.copy(v.position);
    });

    redrawEdges();
    saveHistory();
    console.log('[WireframeEditor] Rotated selection around', axis, 'by', degrees, 'degrees');
  }

  function mirrorSelected(axis) {
    const center = new window.THREE.Vector3();
    const selectedVertices = Array.from(state.selectedItems)
      .filter(id => id.startsWith('v_'))
      .map(id => state.vertices.find(v => v.id === id))
      .filter(v => v);

    if (selectedVertices.length === 0) return;

    // Calculate center
    selectedVertices.forEach(v => center.add(v.position));
    center.divideScalar(selectedVertices.length);

    // Mirror duplicates
    const oldToNewMap = new Map();
    selectedVertices.forEach(oldV => {
      const newPos = oldV.position.clone().sub(center);
      if (axis === 'x') newPos.x *= -1;
      else if (axis === 'y') newPos.y *= -1;
      else if (axis === 'z') newPos.z *= -1;
      newPos.add(center);

      const newVId = addVertex(newPos, oldV.components[0]);
      oldToNewMap.set(oldV.id, newVId);
    });

    // Duplicate edges
    state.edges.forEach(edge => {
      const oldV1 = state.vertices.find((v, i) => i === edge.v1Index);
      const oldV2 = state.vertices.find((v, i) => i === edge.v2Index);
      if (oldV1 && oldV2 && oldToNewMap.has(oldV1.id) && oldToNewMap.has(oldV2.id)) {
        const newV1Idx = state.vertices.findIndex(v => v.id === oldToNewMap.get(oldV1.id));
        const newV2Idx = state.vertices.findIndex(v => v.id === oldToNewMap.get(oldV2.id));
        addEdge(newV1Idx, newV2Idx, edge.type);
      }
    });

    console.log('[WireframeEditor] Mirrored selection along', axis, 'axis');
    saveHistory();
  }

  function createFaceFromSelection() {
    const selectedVertexIds = Array.from(state.selectedItems).filter(id => id.startsWith('v_'));
    if (selectedVertexIds.length < 3) {
      console.warn('[WireframeEditor] Need at least 3 vertices to create a face');
      return;
    }

    const vertexIndices = selectedVertexIds.map(id => 
      state.vertices.findIndex(v => v.id === id)
    ).filter(idx => idx !== -1);

    const faceId = `f_${state.faces.length}`;
    const face = {
      id: faceId,
      vertexIndices: vertexIndices,
      type: 'hull',
    };
    state.faces.push(face);

    // Create opaque filled face geometry
    const positions = [];
    vertexIndices.forEach(idx => {
      const v = state.vertices[idx];
      positions.push(v.position.x, v.position.y, v.position.z);
    });

    // Create triangulated faces for rendering
    const geom = new window.THREE.BufferGeometry();
    const triangles = [];
    for (let i = 1; i < vertexIndices.length - 1; i++) {
      triangles.push(0, i, i + 1);
    }

    geom.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(positions), 3));
    geom.setIndex(new window.THREE.BufferAttribute(new Uint32Array(triangles), 1));
    geom.computeVertexNormals();

    // Opaque green material for faces
    const mat = new window.THREE.MeshPhongMaterial({ 
      color: 0x00ff00, 
      opacity: 1.0,
      transparent: false,
      side: window.THREE.DoubleSide,
      shininess: 30
    });
    const faceMesh = new window.THREE.Mesh(geom, mat);
    faceMesh.userData = { type: 'face', id: faceId };
    state.scene.add(faceMesh);
    state.faceWireframes.set(faceId, faceMesh);

    // Create invisible picking mesh for face selection
    const pickGeom = new window.THREE.BufferGeometry();
    pickGeom.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(positions), 3));
    pickGeom.setIndex(new window.THREE.BufferAttribute(new Uint32Array(triangles), 1));
    
    const pickMesh = new window.THREE.Mesh(pickGeom, new window.THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }));
    pickMesh.userData = { type: 'face', id: faceId };
    state.scene.add(pickMesh);
    state.componentMeshes.set(faceId + '_pick', pickMesh);

    saveHistory();
    updateUI();
    console.log('[WireframeEditor] Created face:', faceId, 'with', vertexIndices.length, 'vertices');
  }

  function deleteFaces(faceIds) {
    faceIds.forEach(faceId => {
      const wireframe = state.faceWireframes.get(faceId);
      if (wireframe) {
        state.scene.remove(wireframe);
        state.faceWireframes.delete(faceId);
      }
      state.faces = state.faces.filter(f => f.id !== faceId);
    });
    saveHistory();
    updateUI();
  }

  function saveHistory() {
    const snapshot = JSON.parse(JSON.stringify({
      vertices: state.vertices,
      edges: state.edges,
      selectedItems: Array.from(state.selectedItems),
    }));
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex = state.history.length - 1;
  }

  function restoreHistory() {
    const snapshot = state.history[state.historyIndex];
    state.vertices = snapshot.vertices.map(v => ({
      ...v,
      position: new window.THREE.Vector3(v.position.x, v.position.y, v.position.z),
    }));
    state.edges = snapshot.edges;
    state.selectedItems = new Set(snapshot.selectedItems);

    state.vertexMeshes.forEach(mesh => state.scene.remove(mesh));
    state.edgeLines.forEach(line => state.scene.remove(line));
    state.vertexMeshes.clear();
    state.edgeLines.clear();

    state.vertices.forEach(v => {
      const geom = new window.THREE.SphereGeometry(0.15, 8, 8);
      const color = state.componentColors[v.components[0]] || state.componentColors.default;
      const mat = new window.THREE.MeshStandardMaterial({ color, emissive: state.selectedItems.has(v.id) ? 0x666666 : 0x000000 });
      const mesh = new window.THREE.Mesh(geom, mat);
      mesh.position.copy(v.position);
      mesh.userData = { type: 'vertex', id: v.id };
      state.scene.add(mesh);
      state.vertexMeshes.set(v.id, mesh);
    });

    redrawEdges();
    updateUI();
  }

  function updateUI() {
    // Update mode info
    const modeTexts = { vertices: 'Vertex Mode', edges: 'Edge Mode', faces: 'Face Mode', components: 'Component Mode' };
    modeInfoDiv.textContent = `📍 ${modeTexts[state.selectionMode] || 'Unknown'}`;

    // Update stats
    statsDiv.innerHTML = `
      <div style="margin-bottom: 0.4rem; color: #d1d5db;"><span style="color: #60a5fa; font-weight: bold;">${state.vertices.length}</span> Vertices</div>
      <div style="margin-bottom: 0.4rem; color: #d1d5db;"><span style="color: #60a5fa; font-weight: bold;">${state.edges.length}</span> Edges</div>
      <div style="margin-bottom: 0.4rem; color: #d1d5db;"><span style="color: #60a5fa; font-weight: bold;">${state.faces.length}</span> Faces</div>
      <div style="color: #d1d5db;"><span style="color: #60a5fa; font-weight: bold;">${state.selectedItems.size}</span> Selected</div>
    `;

    // Update selection list
    const selected = Array.from(state.selectedItems);
    if (selected.length === 0) {
      selectionDiv.innerHTML = `<div style="color: #9ca3af; font-size: 0.85rem;">No selection</div>`;
    } else {
      selectionDiv.innerHTML = `<div style="color: #d1d5db; font-size: 0.85rem;"><strong>Selected Items:</strong><br>${selected.join('<br>')}</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // MOUSE INTERACTIONS
  // ═══════════════════════════════════════════════════════════════════

  function onMouseMove(e) {
    const rect = canvasContainer.getBoundingClientRect();
    state.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    state.raycaster.setFromCamera(state.mouse, state.camera);

    if (state.draggingVertex) {
      const plane = new window.THREE.Plane(new window.THREE.Vector3(0, 0, 1), 0);
      const target = new window.THREE.Vector3();
      state.raycaster.ray.intersectPlane(plane, target);
      state.draggingVertex.position.copy(target);
      state.vertexMeshes.get(state.draggingVertex.id).position.copy(target);
      redrawEdges();
      return;
    }

    // Hover highlighting
    const allObjects = [
      ...Array.from(state.vertexMeshes.values()),
      ...Array.from(state.edgeLines.values()),
    ];
    const intersects = state.raycaster.intersectObjects(allObjects);

    allObjects.forEach(obj => {
      if (obj.userData.type === 'vertex') {
        obj.material.emissive.setHex(0x000000);
      }
    });

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (obj.userData.type === 'vertex') {
        obj.material.emissive.setHex(0x666666);
        canvasContainer.style.cursor = 'grab';
      }
    } else {
      canvasContainer.style.cursor = 'default';
    }
  }

  function onMouseDown(e) {
    state.raycaster.setFromCamera(state.mouse, state.camera);
    
    let intersects = [];
    if (state.selectionMode === 'vertices') {
      const vertexMeshes = Array.from(state.vertexMeshes.values());
      intersects = state.raycaster.intersectObjects(vertexMeshes);
    } else if (state.selectionMode === 'faces') {
      const pickMeshes = Array.from(state.componentMeshes.values()).filter(m => m.userData.type === 'face');
      intersects = state.raycaster.intersectObjects(pickMeshes);
    } else if (state.selectionMode === 'edges') {
      // For edge selection, we still use vertex meshes for now
      const vertexMeshes = Array.from(state.vertexMeshes.values());
      intersects = state.raycaster.intersectObjects(vertexMeshes);
    }

    if (intersects.length > 0) {
      const obj = intersects[0].object;
      const id = obj.userData.id;
      
      if (e.button === 0) { // Left click
        if (!e.ctrlKey && !e.metaKey) {
          state.selectedItems.clear();
        }
        state.selectedItems.add(id);
        
        if (state.selectionMode === 'vertices') {
          state.draggingVertex = state.vertices.find(v => v.id === id);
          canvasContainer.style.cursor = 'grabbing';
        }
      }
      updateUI();
    }
  }

  function onMouseUp() {
    if (state.draggingVertex) {
      saveHistory();
      state.draggingVertex = null;
    }
    canvasContainer.style.cursor = 'default';
  }

  function onWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 1.1 : 0.9;
    const distance = state.camera.position.length();
    state.camera.position.multiplyScalar(delta);
    state.camera.position.clampLength(2, 50);
  }

  canvasContainer.addEventListener('mousemove', onMouseMove);
  canvasContainer.addEventListener('mousedown', onMouseDown);
  canvasContainer.addEventListener('mouseup', onMouseUp);
  canvasContainer.addEventListener('wheel', onWheel, { passive: false });

  // Settings updates
  document.getElementById('snap-grid')?.addEventListener('change', (e) => {
    state.snapToGrid = e.target.checked;
  });
  document.getElementById('snap-vertices')?.addEventListener('change', (e) => {
    state.snapToVertices = e.target.checked;
  });
  document.getElementById('grid-size')?.addEventListener('change', (e) => {
    state.gridSize = parseFloat(e.target.value);
  });

  // Component Library Buttons
  document.getElementById('comp-engine')?.addEventListener('click', () => {
    addComponent('engine', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });
  document.getElementById('comp-weapon')?.addEventListener('click', () => {
    addComponent('weapon', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });
  document.getElementById('comp-sensor')?.addEventListener('click', () => {
    addComponent('sensor', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });
  document.getElementById('comp-shield')?.addEventListener('click', () => {
    addComponent('shield', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });
  document.getElementById('comp-cargo')?.addEventListener('click', () => {
    addComponent('cargo', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });
  document.getElementById('comp-armor')?.addEventListener('click', () => {
    addComponent('armor', new window.THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2));
  });

  // ═══════════════════════════════════════════════════════════════════
  // ANIMATION LOOP
  // ═══════════════════════════════════════════════════════════════════

  function animate() {
    requestAnimationFrame(animate);

    // Update selected vertex highlighting
    state.vertices.forEach(v => {
      const mesh = state.vertexMeshes.get(v.id);
      if (mesh) {
        mesh.material.emissive.setHex(state.selectedItems.has(v.id) ? 0x00ff00 : 0x000000);
      }
    });

    state.renderer.render(state.scene, state.camera);
  }

  // Handle window resize
  window.addEventListener('resize', () => {
    const w = canvasContainer.clientWidth;
    const h = canvasContainer.clientHeight;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h);
  });

  // Initialize with default geometry
  resetToDefault();
  animate();

  console.log('[WireframeEditor] Initialized successfully');

  return {
    addVertex,
    addEdge,
    deleteSelected,
    exportGeometry,
    resetToDefault,
  };
};
