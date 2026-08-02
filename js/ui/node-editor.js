/**
 * 3D Node Editor – Interactive ship geometry modification with AI assistance
 * 
 * Exposed globally as window.createNodeEditor
 * 
 * Features:
 * - Wireframe nodes & edges visualization (flat white)
 * - Interactive node manipulation (add/move/delete)
 * - AI-powered prompt refinement
 * - Real-time geometry preview
 * - Export modified geometry as prompt
 */

(function() {
  'use strict';

  window.createNodeEditor = function createNodeEditor(opts = {}) {
  const {
    container,
    initialModel = null,
    apiBase = '/api',
    onPromptUpdate = () => {},
    onExport = () => {},
  } = opts;

  if (!container) {
    console.error('[NodeEditor] Container not provided');
    return null;
  }

  // ─── Node Editor State ─────────────────────────────────────────────────────

  let editorState = {
    nodes: [],
    edges: [],
    selectedNode: null,
    isEditMode: true,
    viewMode: 'wireframe', // wireframe, flatwhite, hybrid
    nodeIdCounter: 0,
    scene: null,
    camera: null,
    renderer: null,
    nodeGeometries: {},
    edgeLines: null,
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
  };

  // ─── HTML Structure ───────────────────────────────────────────────────────

  const html = `
    <div class="node-editor" style="display: flex; flex-direction: column; height: 100%; background: #0a0e27;">
      
      <!-- Toolbar -->
      <div style="background: #1f2937; padding: 0.75rem; display: flex; gap: 0.5rem; align-items: center; border-bottom: 1px solid #374151; flex-wrap: wrap;">
        <span style="font-size: 0.85rem; color: #9ca3af; font-weight: 500; text-transform: uppercase;">Node Editor:</span>
        
        <button id="ne-add-node" style="padding: 0.4rem 0.8rem; background: #3b82f6; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">
          ➕ Add Node
        </button>
        
        <button id="ne-delete-node" style="padding: 0.4rem 0.8rem; background: #ef4444; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">
          ❌ Delete Selected
        </button>
        
        <button id="ne-connect-nodes" style="padding: 0.4rem 0.8rem; background: #8b5cf6; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">
          🔗 Connect Nodes
        </button>
        
        <div style="flex: 1;"></div>
        
        <select id="ne-view-mode" style="padding: 0.4rem 0.6rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-size: 0.85rem;">
          <option value="wireframe">Wireframe</option>
          <option value="flatwhite">Flat White</option>
          <option value="hybrid">Hybrid</option>
        </select>
        
        <button id="ne-ai-suggest" style="padding: 0.4rem 0.8rem; background: #10b981; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">
          🤖 AI Suggestions
        </button>
        
        <button id="ne-export" style="padding: 0.4rem 0.8rem; background: #f59e0b; color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.85rem;">
          📤 Export Geometry
        </button>
      </div>
      
      <!-- Canvas & Node List -->
      <div style="display: flex; gap: 1rem; flex: 1; overflow: hidden;">
        
        <!-- 3D Canvas -->
        <div id="node-canvas-container" style="flex: 1; background: #111827; border: 1px solid #1f2937; border-radius: 4px; position: relative;">
          <canvas id="node-canvas" style="width: 100%; height: 100%;"></canvas>
          <div style="position: absolute; top: 1rem; left: 1rem; font-size: 0.75rem; color: #6b7280;">
            Left-click: Select | Right-drag: Rotate | Scroll: Zoom | Drag node: Move
          </div>
        </div>
        
        <!-- Node Properties Panel -->
        <div id="node-properties-panel" style="flex: 0 0 280px; background: #1f2937; border-radius: 4px; padding: 1rem; overflow-y: auto; border: 1px solid #374151;">
          <div style="font-weight: bold; color: #e5e7eb; margin-bottom: 1rem;">Node Properties</div>
          
          <div id="node-list" style="font-size: 0.85rem; color: #d1d5db;">
            <div style="color: #6b7280; font-style: italic;">Select a node to edit</div>
          </div>
          
          <div id="node-inspector" style="display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #374151;">
            <div style="margin-bottom: 0.5rem;">
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.2rem;">X Position</label>
              <input id="ne-prop-x" type="number" step="0.1" style="width: 100%; padding: 0.3rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-size: 0.85rem;">
            </div>
            <div style="margin-bottom: 0.5rem;">
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.2rem;">Y Position</label>
              <input id="ne-prop-y" type="number" step="0.1" style="width: 100%; padding: 0.3rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-size: 0.85rem;">
            </div>
            <div style="margin-bottom: 0.5rem;">
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.2rem;">Z Position</label>
              <input id="ne-prop-z" type="number" step="0.1" style="width: 100%; padding: 0.3rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-size: 0.85rem;">
            </div>
            <div style="margin-bottom: 0.5rem;">
              <label style="display: block; font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.2rem;">Node Type</label>
              <select id="ne-prop-type" style="width: 100%; padding: 0.3rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-size: 0.85rem;">
                <option value="hull">Hull Vertex</option>
                <option value="engine">Engine Mount</option>
                <option value="sensor">Sensor Node</option>
                <option value="weapon">Weapon Hardpoint</option>
                <option value="structural">Structural Joint</option>
              </select>
            </div>
          </div>
          
          <div id="ai-suggestions" style="margin-top: 1rem; display: none; padding: 1rem; background: #111827; border-radius: 3px; border: 1px solid #374151;">
            <div style="font-weight: bold; color: #60a5fa; margin-bottom: 0.5rem; font-size: 0.85rem;">AI Suggestions</div>
            <div id="ai-suggestions-list" style="font-size: 0.8rem; color: #d1d5db; line-height: 1.5;"></div>
          </div>
        </div>
        
      </div>
      
      <!-- AI Prompt Refiner -->
      <div id="prompt-refiner" style="background: #1f2937; padding: 1rem; border-top: 1px solid #374151; font-size: 0.85rem;">
        <div style="margin-bottom: 0.5rem; color: #9ca3af; font-weight: 500;">Modified Geometry Prompt:</div>
        <textarea id="geometry-prompt" placeholder="Geometry description for AI refinement..." style="width: 100%; height: 80px; padding: 0.5rem; background: #111827; color: #e5e7eb; border: 1px solid #374151; border-radius: 3px; font-family: monospace; font-size: 0.8rem; resize: vertical; box-sizing: border-box;"></textarea>
      </div>
    </div>
  `;

  container.innerHTML = html;

  // ─── Three.js Setup ───────────────────────────────────────────────────────

  function initializeScene() {
    const canvas = container.querySelector('#node-canvas');
    const canvasContainer = container.querySelector('#node-canvas-container');

    editorState.scene = new THREE.Scene();
    editorState.scene.background = new THREE.Color(0x111827);

    editorState.camera = new THREE.PerspectiveCamera(
      75,
      canvasContainer.clientWidth / canvasContainer.clientHeight,
      0.1,
      1000
    );
    editorState.camera.position.z = 8;

    editorState.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    editorState.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);
    editorState.renderer.shadowMap.enabled = true;

    // Lighting for flat white
    const light = new THREE.DirectionalLight(0xffffff, 0.7);
    light.position.set(5, 10, 7);
    editorState.scene.add(light);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    editorState.scene.add(ambientLight);

    // Grid
    const gridGeometry = new THREE.BufferGeometry();
    const gridSize = 20;
    const gridDivisions = 20;
    const points = [];

    for (let i = 0; i <= gridDivisions; i++) {
      const pos = -gridSize / 2 + (i / gridDivisions) * gridSize;
      points.push(pos, 0, -gridSize / 2);
      points.push(pos, 0, gridSize / 2);
      points.push(-gridSize / 2, 0, pos);
      points.push(gridSize / 2, 0, pos);
    }

    gridGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    const gridMaterial = new THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.2 });
    const grid = new THREE.LineSegments(gridGeometry, gridMaterial);
    editorState.scene.add(grid);

    // Animation loop
    const animate = () => {
      requestAnimationFrame(animate);
      editorState.renderer.render(editorState.scene, editorState.camera);
    };
    animate();

    // Handle resize
    window.addEventListener('resize', () => {
      const width = canvasContainer.clientWidth;
      const height = canvasContainer.clientHeight;
      editorState.camera.aspect = width / height;
      editorState.camera.updateProjectionMatrix();
      editorState.renderer.setSize(width, height);
    });

    // Mouse interaction
    canvas.addEventListener('click', (e) => onCanvasClick(e));
    canvas.addEventListener('mousemove', (e) => onCanvasMouseMove(e));
    canvas.addEventListener('mousedown', (e) => onCanvasMouseDown(e));
    canvas.addEventListener('mouseup', (e) => onCanvasMouseUp(e));
    canvas.addEventListener('wheel', (e) => onCanvasScroll(e));
  }

  // ─── Node Management ───────────────────────────────────────────────────────

  function addNode(type = 'hull', position = { x: 0, y: 0, z: 0 }) {
    const nodeId = editorState.nodeIdCounter++;
    const node = {
      id: nodeId,
      type,
      position,
      sphere: null,
    };

    // Create visual representation
    const geometry = new THREE.SphereGeometry(0.3, 16, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.3,
      roughness: 0.6,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(position.x, position.y, position.z);
    sphere.userData.nodeId = nodeId;
    editorState.scene.add(sphere);

    node.sphere = sphere;
    editorState.nodes.push(node);

    updateNodeList();
    return node;
  }

  function deleteNode(nodeId) {
    const idx = editorState.nodes.findIndex(n => n.id === nodeId);
    if (idx >= 0) {
      const node = editorState.nodes[idx];
      if (node.sphere) {
        editorState.scene.remove(node.sphere);
      }
      editorState.nodes.splice(idx, 1);

      // Remove edges connected to this node
      editorState.edges = editorState.edges.filter(
        e => e.from !== nodeId && e.to !== nodeId
      );

      updateNodeList();
      redrawEdges();
    }
  }

  function connectNodes(fromId, toId) {
    if (fromId !== toId && !editorState.edges.find(e => e.from === fromId && e.to === toId)) {
      editorState.edges.push({ from: fromId, to: toId });
      redrawEdges();
    }
  }

  function redrawEdges() {
    if (editorState.edgeLines) {
      editorState.scene.remove(editorState.edgeLines);
    }

    const geometry = new THREE.BufferGeometry();
    const points = [];

    for (const edge of editorState.edges) {
      const fromNode = editorState.nodes.find(n => n.id === edge.from);
      const toNode = editorState.nodes.find(n => n.id === edge.to);

      if (fromNode && toNode) {
        points.push(
          fromNode.position.x, fromNode.position.y, fromNode.position.z,
          toNode.position.x, toNode.position.y, toNode.position.z
        );
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    const material = new THREE.LineBasicMaterial({ color: 0x60a5fa, linewidth: 2 });
    editorState.edgeLines = new THREE.LineSegments(geometry, material);
    editorState.scene.add(editorState.edgeLines);
  }

  function updateNodeList() {
    const list = container.querySelector('#node-list');
    const html = editorState.nodes
      .map(
        node => `
        <div style="padding: 0.4rem; background: #111827; border-radius: 3px; margin-bottom: 0.3rem; cursor: pointer; border: 1px solid #374151;" data-node-id="${node.id}">
          <strong>Node ${node.id}</strong><br>
          <small>${node.type} @ (${node.position.x.toFixed(1)}, ${node.position.y.toFixed(1)}, ${node.position.z.toFixed(1)})</small>
        </div>
      `
      )
      .join('');

    list.innerHTML = html || '<div style="color: #6b7280; font-style: italic;">No nodes yet. Add one to begin.</div>';

    // Add click handlers
    container.querySelectorAll('#node-list > div[data-node-id]').forEach(el => {
      el.addEventListener('click', () => {
        selectNode(parseInt(el.dataset.nodeId));
      });
    });
  }

  function selectNode(nodeId) {
    editorState.selectedNode = nodeId;
    const node = editorState.nodes.find(n => n.id === nodeId);

    if (node) {
      // Update inspector
      const inspector = container.querySelector('#node-inspector');
      inspector.style.display = 'block';

      container.querySelector('#ne-prop-x').value = node.position.x;
      container.querySelector('#ne-prop-y').value = node.position.y;
      container.querySelector('#ne-prop-z').value = node.position.z;
      container.querySelector('#ne-prop-type').value = node.type;

      // Highlight node
      if (node.sphere) {
        node.sphere.material.emissive.setHex(0x3b82f6);
      }
    }
  }

  function deselectNode() {
    if (editorState.selectedNode !== null) {
      const node = editorState.nodes.find(n => n.id === editorState.selectedNode);
      if (node && node.sphere) {
        node.sphere.material.emissive.setHex(0x000000);
      }
    }
    editorState.selectedNode = null;
    container.querySelector('#node-inspector').style.display = 'none';
  }

  // ─── Canvas Interaction ────────────────────────────────────────────────────

  let isDraggingNode = false;
  let draggedNodeId = null;

  function onCanvasClick(e) {
    const rect = e.target.getBoundingClientRect();
    editorState.mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1;
    editorState.mouse.y = -(e.clientY - rect.top) / rect.height * 2 + 1;

    editorState.raycaster.setFromCamera(editorState.mouse, editorState.camera);

    const intersects = editorState.raycaster.intersectObjects(
      editorState.nodes.map(n => n.sphere).filter(Boolean)
    );

    if (intersects.length > 0) {
      const nodeId = intersects[0].object.userData.nodeId;
      selectNode(nodeId);
    } else {
      deselectNode();
    }
  }

  function onCanvasMouseDown(e) {
    if (e.button === 0) {
      // Left click - potential node drag
      const rect = e.target.getBoundingClientRect();
      editorState.mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1;
      editorState.mouse.y = -(e.clientY - rect.top) / rect.height * 2 + 1;

      editorState.raycaster.setFromCamera(editorState.mouse, editorState.camera);
      const intersects = editorState.raycaster.intersectObjects(
        editorState.nodes.map(n => n.sphere).filter(Boolean)
      );

      if (intersects.length > 0) {
        isDraggingNode = true;
        draggedNodeId = intersects[0].object.userData.nodeId;
      }
    }
  }

  function onCanvasMouseMove(e) {
    if (isDraggingNode && draggedNodeId !== null) {
      const rect = e.target.getBoundingClientRect();
      editorState.mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1;
      editorState.mouse.y = -(e.clientY - rect.top) / rect.height * 2 + 1;

      editorState.raycaster.setFromCamera(editorState.mouse, editorState.camera);

      // Create a plane perpendicular to camera view
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const target = new THREE.Vector3();
      editorState.raycaster.ray.intersectPlane(plane, target);

      const node = editorState.nodes.find(n => n.id === draggedNodeId);
      if (node) {
        node.position.x = target.x;
        node.position.y = target.y;
        if (node.sphere) {
          node.sphere.position.copy(node.position);
        }
        redrawEdges();
      }
    }
  }

  function onCanvasMouseUp(e) {
    isDraggingNode = false;
    draggedNodeId = null;
  }

  function onCanvasScroll(e) {
    e.preventDefault();
    const zoom = 1 - e.deltaY * 0.001;
    editorState.camera.position.multiplyScalar(zoom);
  }

  // ─── UI Event Handlers ─────────────────────────────────────────────────────

  container.querySelector('#ne-add-node').addEventListener('click', () => {
    addNode('hull', { x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: 0 });
  });

  container.querySelector('#ne-delete-node').addEventListener('click', () => {
    if (editorState.selectedNode !== null) {
      deleteNode(editorState.selectedNode);
      deselectNode();
    }
  });

  container.querySelector('#ne-connect-nodes').addEventListener('click', () => {
    if (editorState.selectedNode !== null) {
      const others = editorState.nodes.filter(n => n.id !== editorState.selectedNode);
      if (others.length > 0) {
        connectNodes(editorState.selectedNode, others[0].id);
      }
    }
  });

  container.querySelector('#ne-view-mode').addEventListener('change', (e) => {
    editorState.viewMode = e.target.value;
    // Apply view mode to materials
  });

  container.querySelector('#ne-ai-suggest').addEventListener('click', async () => {
    const geometryDescription = generateGeometryDescription();
    try {
      const response = await fetch(`${apiBase}/llm.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: 'You are a spaceship design expert. Suggest geometric improvements for the ship.',
          user_message: `Current ship geometry:\n${geometryDescription}\n\nSuggest 3 specific improvements to the node placement and edge connections.`,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const suggestionsDiv = container.querySelector('#ai-suggestions');
        container.querySelector('#ai-suggestions-list').textContent = data.response || 'No suggestions';
        suggestionsDiv.style.display = 'block';
      }
    } catch (e) {
      console.error('[NodeEditor] AI suggestion error:', e);
    }
  });

  container.querySelector('#ne-export').addEventListener('click', () => {
    const prompt = generateGeometryDescription();
    container.querySelector('#geometry-prompt').value = prompt;
    onExport(prompt);
  });

  // ─── Geometry Description ─────────────────────────────────────────────────

  function generateGeometryDescription() {
    const lines = [];
    lines.push('Ship Geometry Specification:');
    lines.push('');

    lines.push(`Total Nodes: ${editorState.nodes.length}`);
    lines.push(`Total Edges: ${editorState.edges.length}`);
    lines.push('');

    lines.push('Nodes:');
    for (const node of editorState.nodes) {
      lines.push(`  - ${node.type} at (${node.position.x.toFixed(2)}, ${node.position.y.toFixed(2)}, ${node.position.z.toFixed(2)})`);
    }
    lines.push('');

    lines.push('Connections:');
    for (const edge of editorState.edges) {
      const fromNode = editorState.nodes.find(n => n.id === edge.from);
      const toNode = editorState.nodes.find(n => n.id === edge.to);
      if (fromNode && toNode) {
        lines.push(
          `  - ${fromNode.type} → ${toNode.type}`
        );
      }
    }

    return lines.join('\n');
  }

  // ─── Initialization ───────────────────────────────────────────────────────

  initializeScene();

  // Add initial sample nodes
  addNode('hull', { x: 0, y: 0, z: 0 });
  addNode('engine', { x: 2, y: -1, z: -2 });
  addNode('sensor', { x: 0, y: 1, z: 1 });
  connectNodes(0, 1);
  connectNodes(0, 2);

  return {
    addNode,
    deleteNode,
    connectNodes,
    getGeometry: () => ({ nodes: editorState.nodes, edges: editorState.edges }),
    exportPrompt: generateGeometryDescription,
  };
  };

  // IIFE closure
})();
