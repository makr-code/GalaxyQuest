// Three.js EffectComposer - PostProcessing Pass Manager
// Simplified version for GalaxyQuest

THREE.EffectComposer = function(renderer, renderTarget) {
  this.renderer = renderer;
  this.renderTarget1 = renderTarget || new THREE.WebGLRenderTarget(renderer.domElement.clientWidth, renderer.domElement.clientHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });
  this.renderTarget2 = new THREE.WebGLRenderTarget(renderer.domElement.clientWidth, renderer.domElement.clientHeight, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  this.writeBuffer = this.renderTarget1;
  this.readBuffer = this.renderTarget2;
  this.passes = [];
};

THREE.EffectComposer.prototype.addPass = function(pass) {
  this.passes.push(pass);
  const size = this.renderer.getSize(new THREE.Vector2());
  pass.setSize(size.width, size.height);
};

THREE.EffectComposer.prototype.insertPass = function(pass, index) {
  this.passes.splice(index, 0, pass);
};

THREE.EffectComposer.prototype.removePass = function(pass) {
  this.passes.splice(this.passes.indexOf(pass), 1);
};

THREE.EffectComposer.prototype.render = function(delta) {
  this.writeBuffer = this.renderTarget1;
  this.readBuffer = this.renderTarget2;

  let maskActive = false;

  for (let i = 0, il = this.passes.length; i < il; i++) {
    const pass = this.passes[i];
    if (!pass.enabled) continue;

    pass.render(this.renderer, this.writeBuffer, this.readBuffer, delta, maskActive);

    if (pass.needsSwap) {
      if (maskActive) {
        const tmp = this.readBuffer;
        this.readBuffer = this.writeBuffer;
        this.writeBuffer = tmp;
      } else {
        [this.writeBuffer, this.readBuffer] = [this.readBuffer, this.writeBuffer];
      }
    }
  }
};

THREE.EffectComposer.prototype.setSize = function(width, height) {
  this.renderTarget1.setSize(width, height);
  this.renderTarget2.setSize(width, height);
  for (let i = 0; i < this.passes.length; i++) {
    this.passes[i].setSize(width, height);
  }
};

THREE.EffectComposer.prototype.setPixelRatio = function(pixelRatio) {
  const size = this.renderer.getSize(new THREE.Vector2());
  this.setSize(size.width * pixelRatio, size.height * pixelRatio);
};

THREE.EffectComposer.prototype.dispose = function() {
  this.renderTarget1.dispose();
  this.renderTarget2.dispose();
  for (let i = 0; i < this.passes.length; i++) {
    if (this.passes[i].dispose) {
      this.passes[i].dispose();
    }
  }
};
