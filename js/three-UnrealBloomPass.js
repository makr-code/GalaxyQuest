// Three.js UnrealBloomPass - bloom effect for bright areas

THREE.UnrealBloomPass = function(resolution, strength, radius, threshold) {
  this.resolution = resolution || new THREE.Vector2(1024, 1024);
  this.strength = strength !== undefined ? strength : 1.0;
  this.radius = radius !== undefined ? radius : 0.4;
  this.threshold = threshold !== undefined ? threshold : 0.85;
  this.enabled = true;
  this.needsSwap = true;

  // Create render targets for bloom
  const bloomRenderTargetOptions = {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  };

  this.highPassRenderTarget = new THREE.WebGLRenderTarget(
    Math.floor(this.resolution.x / 2),
    Math.floor(this.resolution.y / 2),
    bloomRenderTargetOptions
  );

  this.blurRenderTarget = new THREE.WebGLRenderTarget(
    Math.floor(this.resolution.x / 2),
    Math.floor(this.resolution.y / 2),
    bloomRenderTargetOptions
  );

  // High-pass filter (extract bright areas)
  this._makeHighPassPass();
  
  // Blur passes (separable Gaussian)
  this._makeBlurPasses();
  
  // Composite pass (blend bloom over original)
  this._makeCompositePass();
};

THREE.UnrealBloomPass.prototype._makeHighPassPass = function() {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      threshold: { value: this.threshold },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform float threshold;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(tDiffuse, vUv);
        float lum = dot(texel.rgb, vec3(0.299, 0.587, 0.114));
        if (lum > threshold) {
          gl_FragColor = texel;
        } else {
          gl_FragColor = vec4(0.0);
        }
      }
    `,
  };

  const geometry = this._makeFullscreenGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: shader.uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });

  this.highPassScene = new THREE.Scene();
  this.highPassCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.highPassMesh = new THREE.Mesh(geometry.clone(), material);
  this.highPassScene.add(this.highPassMesh);
  this.highPassUniforms = material.uniforms;
};

THREE.UnrealBloomPass.prototype._makeBlurPasses = function() {
  const shader = {
    uniforms: {
      tDiffuse: { value: null },
      uRadius: { value: this.radius },
      uDirection: { value: new THREE.Vector2(1, 0) },
      uResolution: { value: new THREE.Vector2(this.resolution.x / 2, this.resolution.y / 2) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      uniform vec2 uDirection;
      uniform float uRadius;
      uniform vec2 uResolution;
      varying vec2 vUv;
      
      void main() {
        vec2 inv = uDirection / uResolution;
        vec4 color = vec4(0.0);
        float weights = 0.0;
        float r = uRadius * 10.0;
        
        for (float i = -r; i <= r; i += 1.0) {
          float w = exp(-i * i / (r * r));
          color += texture2D(tDiffuse, vUv + inv * i) * w;
          weights += w;
        }
        
        gl_FragColor = color / weights;
      }
    `,
  };

  const geometry = this._makeFullscreenGeometry();
  
  // Horizontal blur
  const matH = new THREE.ShaderMaterial({
    uniforms: shader.uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });
  matH.uniforms.uDirection.value.set(1, 0);
  
  this.blurHScene = new THREE.Scene();
  this.blurHCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.blurHMesh = new THREE.Mesh(geometry.clone(), matH);
  this.blurHScene.add(this.blurHMesh);
  this.blurHUniforms = matH.uniforms;

  // Vertical blur
  const matV = new THREE.ShaderMaterial({
    uniforms: shader.uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });
  matV.uniforms.uDirection.value.set(0, 1);
  
  this.blurVScene = new THREE.Scene();
  this.blurVCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.blurVMesh = new THREE.Mesh(geometry.clone(), matV);
  this.blurVScene.add(this.blurVMesh);
  this.blurVUniforms = matV.uniforms;
};

THREE.UnrealBloomPass.prototype._makeCompositePass = function() {
  const shader = {
    uniforms: {
      tBase: { value: null },
      tBloom: { value: null },
      uStrength: { value: this.strength },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tBase;
      uniform sampler2D tBloom;
      uniform float uStrength;
      varying vec2 vUv;
      
      void main() {
        vec4 base = texture2D(tBase, vUv);
        vec4 bloom = texture2D(tBloom, vUv);
        gl_FragColor = base + bloom * uStrength;
      }
    `,
  };

  const geometry = this._makeFullscreenGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: shader.uniforms,
    vertexShader: shader.vertexShader,
    fragmentShader: shader.fragmentShader,
  });

  this.compositeScene = new THREE.Scene();
  this.compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  this.compositeMesh = new THREE.Mesh(geometry, material);
  this.compositeScene.add(this.compositeMesh);
  this.compositeUniforms = material.uniforms;
};

THREE.UnrealBloomPass.prototype._makeFullscreenGeometry = function() {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]);
  const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  return geometry;
};

THREE.UnrealBloomPass.prototype.render = function(renderer, writeBuffer, readBuffer, delta, maskActive) {
  // Extract bright areas (high-pass)
  this.highPassUniforms.tDiffuse.value = readBuffer.texture;
  this.highPassUniforms.threshold.value = this.threshold;
  renderer.setRenderTarget(this.highPassRenderTarget);
  renderer.render(this.highPassScene, this.highPassCamera);

  // Horizontal blur
  this.blurHUniforms.tDiffuse.value = this.highPassRenderTarget.texture;
  this.blurHUniforms.uRadius.value = this.radius;
  renderer.setRenderTarget(this.blurRenderTarget);
  renderer.render(this.blurHScene, this.blurHCamera);

  // Vertical blur
  this.blurVUniforms.tDiffuse.value = this.blurRenderTarget.texture;
  this.blurVUniforms.uRadius.value = this.radius;
  renderer.setRenderTarget(this.highPassRenderTarget);
  renderer.render(this.blurVScene, this.blurVCamera);

  // Composite (blend bloom over original)
  this.compositeUniforms.tBase.value = readBuffer.texture;
  this.compositeUniforms.tBloom.value = this.highPassRenderTarget.texture;
  this.compositeUniforms.uStrength.value = this.strength;
  renderer.setRenderTarget(writeBuffer);
  renderer.render(this.compositeScene, this.compositeCamera);
};

THREE.UnrealBloomPass.prototype.setSize = function(width, height) {
  this.highPassRenderTarget.setSize(width / 2, height / 2);
  this.blurRenderTarget.setSize(width / 2, height / 2);
};

THREE.UnrealBloomPass.prototype.dispose = function() {
  this.highPassRenderTarget.dispose();
  this.blurRenderTarget.dispose();
};
