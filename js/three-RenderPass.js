// Three.js RenderPass - renders scene to texture

THREE.RenderPass = function(scene, camera, overrideMaterial, clearColor, clearAlpha) {
  this.scene = scene;
  this.camera = camera;
  this.overrideMaterial = overrideMaterial;
  this.clearColor = clearColor;
  this.clearAlpha = clearAlpha !== undefined ? clearAlpha : 0;
  this.enabled = true;
  this.needsSwap = true;
};

THREE.RenderPass.prototype.render = function(renderer, writeBuffer, readBuffer, delta) {
  const oldAutoClear = renderer.autoClear;
  renderer.autoClear = true;

  const oldClearColor = renderer.getClearColor(new THREE.Color());
  const oldClearAlpha = renderer.getClearAlpha();

  if (this.clearColor !== undefined) {
    renderer.setClearColor(this.clearColor, this.clearAlpha);
  }

  renderer.setRenderTarget(writeBuffer);
  renderer.render(this.scene, this.camera);

  renderer.setClearColor(oldClearColor, oldClearAlpha);
  renderer.autoClear = oldAutoClear;
};

THREE.RenderPass.prototype.setSize = function(width, height) {
  // stub
};
