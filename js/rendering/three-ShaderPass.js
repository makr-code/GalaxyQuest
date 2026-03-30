// Three.js ShaderPass - apply a shader to a texture

THREE.ShaderPass = function(shader, textureID) {
  this.shader = shader;
  this.textureID = textureID !== undefined ? textureID : 'tDiffuse';
  this.enabled = true;
  this.needsSwap = true;
  
  // Clone uniforms
  this.uniforms = {};
  for (const key in shader.uniforms) {
    this.uniforms[key] = {
      value: shader.uniforms[key].value !== undefined ? shader.uniforms[key].value : null,
    };
  }

  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  const material = new THREE.ShaderMaterial({
    defines: Object.assign({}, shader.defines || {}),
    uniforms: this.uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });

  this.scene = new THREE.Scene();
  this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.quad = new THREE.Mesh(geometry, material);
  this.scene.add(this.quad);
};

THREE.ShaderPass.prototype.render = function(renderer, writeBuffer, readBuffer, delta) {
  if (this.uniforms[this.textureID]) {
    this.uniforms[this.textureID].value = readBuffer.texture;
  }

  // Update uniforms on material
  for (const key in this.uniforms) {
    if (this.quad.material.uniforms[key]) {
      this.quad.material.uniforms[key].value = this.uniforms[key].value;
    }
  }

  renderer.setRenderTarget(writeBuffer);
  renderer.render(this.scene, this.camera);
};

THREE.ShaderPass.prototype.setSize = function(width, height) {
  // stub
};
