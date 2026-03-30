/**
 * SceneGraph.js
 *
 * Lightweight scene graph — manages a tree of SceneNode objects, culling
 * and render-order sorting.
 *
 * Inspired by OSG.JS scene graph concepts (MIT)
 *   https://github.com/cedricpinson/osgjs
 * and Three.js Scene (MIT) — https://github.com/mrdoob/three.js
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

const { Transform } = typeof require !== 'undefined'
  ? require('./Transform.js')
  : { Transform: window.GQTransform };

// ---------------------------------------------------------------------------
// SceneNode
// ---------------------------------------------------------------------------

class SceneNode {
  /**
   * @param {string} [name]
   */
  constructor(name = '') {
    this.name      = name;
    this.transform = new Transform();
    this.visible   = true;
    this.renderOrder = 0;
    /** Opaque user data (geometry, material, …) */
    this.data      = null;
    /** @type {SceneNode[]} */
    this.children  = [];
    /** @type {SceneNode|null} */
    this.parent    = null;
  }

  add(child) {
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    this.transform.add(child.transform);
    return this;
  }

  remove(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parent = null;
      this.transform.remove(child.transform);
    }
    return this;
  }
}

// ---------------------------------------------------------------------------
// SceneGraph
// ---------------------------------------------------------------------------

class SceneGraph {
  constructor() {
    this.root = new SceneNode('root');
    /** @type {SceneNode[]} — flat sorted list, rebuilt each frame */
    this._renderList = [];
    this._dirty = true;
  }

  add(node) {
    this.root.add(node);
    this._dirty = true;
    return this;
  }

  remove(node) {
    this.root.remove(node);
    this._dirty = true;
    return this;
  }

  /**
   * Traverse all nodes, update matrices and rebuild the sorted render list.
   */
  update() {
    if (!this._dirty) return this._renderList;
    this._renderList = [];
    this._traverse(this.root, this._renderList);
    this._renderList.sort((a, b) => a.renderOrder - b.renderOrder);
    this._dirty = false;
    return this._renderList;
  }

  _traverse(node, out) {
    if (!node.visible) return;
    node.transform.updateMatrices();
    if (node !== this.root) out.push(node);
    for (const child of node.children) this._traverse(child, out);
  }

  /** Find a node by name (depth-first). */
  findByName(name) { return this._findIn(this.root, name); }
  _findIn(node, name) {
    if (node.name === name) return node;
    for (const c of node.children) { const f = this._findIn(c, name); if (f) return f; }
    return null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SceneNode, SceneGraph };
} else {
  window.GQSceneGraph = { SceneNode, SceneGraph };
}
