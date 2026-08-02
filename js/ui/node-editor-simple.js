/**
 * Simple Node Editor – Functional 3D ship geometry modification
 * Exposed as window.createNodeEditor
 */

(function() {
  'use strict';

  window.createNodeEditor = function(opts = {}) {
    const { container, apiBase = '/api' } = opts;

    if (!container || !window.THREE) {
      console.error('[NodeEditor] Invalid setup');
      return null;
    }

    const state = {
      nodes: [],
      edges: [],
      selectedNode: null,
      nodeIdCounter: 0,
      scene: null,
      camera: null,
      renderer: null,
      raycaster: new window.THREE.Raycaster(),
      mouse: new window.THREE.Vector2(),
    };

    // Setup HTML
    container.innerHTML = `
      <div style="display:flex; flex-direction:column; height:100%; background:#0a0e27;">
        <div style="background:#1f2937; padding:0.75rem; display:flex; gap:0.5rem; border-bottom:1px solid #374151;">
          <button class="ne-btn-add" style="padding:0.4rem 0.8rem; background:#3b82f6; color:white; border:none; border-radius:3px; cursor:pointer;">➕ Add</button>
          <button class="ne-btn-delete" style="padding:0.4rem 0.8rem; background:#ef4444; color:white; border:none; border-radius:3px; cursor:pointer;">❌ Delete</button>
          <button class="ne-btn-connect" style="padding:0.4rem 0.8rem; background:#8b5cf6; color:white; border:none; border-radius:3px; cursor:pointer;">🔗 Connect</button>
          <div style="flex:1;"></div>
          <button class="ne-btn-export" style="padding:0.4rem 0.8rem; background:#f59e0b; color:white; border:none; border-radius:3px; cursor:pointer;">📤 Export</button>
        </div>
        <div style="display:flex; gap:1rem; flex:1; overflow:hidden; padding:1rem;">
          <div class="ne-canvas-container" style="flex:1; background:#111827; border:1px solid #1f2937; border-radius:4px; position:relative;">
            <canvas class="ne-canvas" style="width:100%; height:100%;"></canvas>
          </div>
          <div style="flex:0 0 280px; background:#1f2937; border-radius:4px; padding:1rem; border:1px solid #374151; display:flex; flex-direction:column;">
            <div style="font-weight:bold; color:#e5e7eb; margin-bottom:1rem; font-size:0.85rem;">Node List</div>
            <div class="ne-node-list" style="flex:1; overflow-y:auto; font-size:0.85rem; color:#d1d5db;">No nodes</div>
            <div style="border-top:1px solid #374151; padding-top:1rem; margin-top:1rem;">
              <div style="font-size:0.8rem; color:#9ca3af;">
                <div>Nodes: <strong class="ne-stat-nodes">0</strong></div>
                <div>Edges: <strong class="ne-stat-edges">0</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Three.js Setup
    const canvas = container.querySelector('.ne-canvas');
    const canvasContainer = container.querySelector('.ne-canvas-container');

    state.scene = new window.THREE.Scene();
    state.scene.background = new window.THREE.Color(0x111827);

    state.camera = new window.THREE.PerspectiveCamera(75, canvasContainer.clientWidth / canvasContainer.clientHeight, 0.1, 1000);
    state.camera.position.z = 8;

    state.renderer = new window.THREE.WebGLRenderer({ canvas, antialias: true });
    state.renderer.setSize(canvasContainer.clientWidth, canvasContainer.clientHeight);

    // Lighting
    const light = new window.THREE.DirectionalLight(0xffffff, 0.7);
    light.position.set(5, 10, 7);
    state.scene.add(light);
    state.scene.add(new window.THREE.AmbientLight(0xffffff, 0.5));

    // Grid
    const gridGeo = new window.THREE.BufferGeometry();
    const gridPoints = [];
    for (let i = 0; i <= 20; i++) {
      const pos = -10 + i;
      gridPoints.push(pos, 0, -10, pos, 0, 10, -10, 0, pos, 10, 0, pos);
    }
    gridGeo.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(gridPoints), 3));
    const gridMat = new window.THREE.LineBasicMaterial({ color: 0x444444, transparent: true, opacity: 0.2 });
    state.scene.add(new window.THREE.LineSegments(gridGeo, gridMat));

    // Animation
    const animate = () => {
      requestAnimationFrame(animate);
      state.renderer.render(state.scene, state.camera);
    };
    animate();

    // Functions
    function addNode(type = 'hull', pos = { x: Math.random() * 4 - 2, y: Math.random() * 4 - 2, z: 0 }) {
      const id = state.nodeIdCounter++;
      const geo = new window.THREE.SphereGeometry(0.3, 16, 16);
      const mat = new window.THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.3, roughness: 0.6 });
      const sphere = new window.THREE.Mesh(geo, mat);
      sphere.position.set(pos.x, pos.y, pos.z);
      sphere.userData.nodeId = id;
      state.scene.add(sphere);

      state.nodes.push({ id, type, position: pos, sphere });
      updateUI();
      return id;
    }

    function deleteNode(id) {
      const idx = state.nodes.findIndex(n => n.id === id);
      if (idx >= 0) {
        state.scene.remove(state.nodes[idx].sphere);
        state.nodes.splice(idx, 1);
        state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
        updateUI();
        redrawEdges();
      }
    }

    function connectNodes(fromId, toId) {
      if (fromId !== toId && !state.edges.find(e => e.from === fromId && e.to === toId)) {
        state.edges.push({ from: fromId, to: toId });
        redrawEdges();
        updateUI();
      }
    }

    function redrawEdges() {
      state.scene.children.forEach(obj => {
        if (obj instanceof window.THREE.LineSegments && obj !== state.scene.children.find(o => o.userData && o.userData.isGrid)) {
          state.scene.remove(obj);
        }
      });

      const geo = new window.THREE.BufferGeometry();
      const points = [];
      state.edges.forEach(e => {
        const from = state.nodes.find(n => n.id === e.from);
        const to = state.nodes.find(n => n.id === e.to);
        if (from && to) points.push(from.position.x, from.position.y, from.position.z, to.position.x, to.position.y, to.position.z);
      });
      
      if (points.length > 0) {
        geo.setAttribute('position', new window.THREE.BufferAttribute(new Float32Array(points), 3));
        const mat = new window.THREE.LineBasicMaterial({ color: 0x60a5fa });
        state.scene.add(new window.THREE.LineSegments(geo, mat));
      }
    }

    function updateUI() {
      container.querySelector('.ne-stat-nodes').textContent = state.nodes.length;
      container.querySelector('.ne-stat-edges').textContent = state.edges.length;
      const list = container.querySelector('.ne-node-list');
      list.innerHTML = state.nodes.length === 0 ? '<div style="color:#6b7280;font-style:italic;">No nodes</div>' :
        state.nodes.map(n => `<div style="padding:0.4rem; background:#111827; border:1px solid #374151; border-radius:3px; margin-bottom:0.3rem; cursor:pointer;" data-id="${n.id}"><strong>Node ${n.id}</strong><br><small style="color:#9ca3af;">${n.type}</small></div>`).join('');
    }

    // Event Handlers
    container.querySelector('.ne-btn-add').onclick = () => addNode();
    container.querySelector('.ne-btn-delete').onclick = () => {
      if (state.selectedNode !== null) {
        deleteNode(state.selectedNode);
        state.selectedNode = null;
      }
    };
    container.querySelector('.ne-btn-connect').onclick = () => {
      if (state.selectedNode !== null) {
        const others = state.nodes.filter(n => n.id !== state.selectedNode);
        if (others.length > 0) connectNodes(state.selectedNode, others[0].id);
      }
    };
    container.querySelector('.ne-btn-export').onclick = () => {
      const desc = `Ship Geometry: ${state.nodes.length} nodes, ${state.edges.length} edges`;
      console.log('[NodeEditor]', desc);
      alert(desc);
    };

    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      state.mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1;
      state.mouse.y = -(e.clientY - rect.top) / rect.height * 2 + 1;
      state.raycaster.setFromCamera(state.mouse, state.camera);
      const hit = state.raycaster.intersectObjects(state.nodes.map(n => n.sphere));
      if (hit.length > 0) state.selectedNode = hit[0].object.userData.nodeId;
    });

    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      state.camera.position.multiplyScalar(1 - e.deltaY * 0.001);
    });

    // Initial state
    addNode('hull', { x: 0, y: 0, z: 0 });
    addNode('engine', { x: 2, y: -1, z: -2 });
    addNode('sensor', { x: 0, y: 1, z: 1 });
    connectNodes(0, 1);
    connectNodes(0, 2);

    return state;
  };
})();
