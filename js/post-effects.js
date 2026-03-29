/**
 * Post-Processing Effects Manager
 * Centralizes EffectComposer + all post-pass effects
 * Bloom, Vignette, Chromatic Aberration, etc.
 */

class PostEffectsManager {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.passes = {};
    
    // Config (can be tweaked)
    this.config = {
      bloom: {
        enabled: true,
        threshold: 0.8,
        strength: 1.2,
        radius: 0.6,
      },
      vignette: {
        enabled: true,
        darkness: 0.5,
        falloff: 2.0,
      },
      chromaticAberration: {
        enabled: true,
        power: 0.3,
      },
    };

    this.init();
  }

  init() {
    if (!THREE || !THREE.EffectComposer) {
      console.warn('[PostEffects] Three.js or EffectComposer not loaded');
      return;
    }

    // Create composer
    this.composer = new THREE.EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Base render pass
    const renderPass = new THREE.RenderPass(this.scene, this.camera);
    this.composer.addPass(renderPass);
    this.passes.render = renderPass;

    // Bloom pass
    this._initBloomPass();

    // Vignette pass
    this._initVignettePass();

    // Chromatic Aberration pass
    this._initChromaticAberrationPass();

    // Final copy pass
    const copyShader = new THREE.ShaderPass(THREE.CopyShader);
    copyShader.renderToScreen = true;
    this.composer.addPass(copyShader);
    this.passes.copy = copyShader;
  }

  _initBloomPass() {
    if (!THREE.UnrealBloomPass) {
      console.warn('[PostEffects] UnrealBloomPass not loaded');
      return;
    }

    const bloomPass = new THREE.UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      this.config.bloom.strength,
      this.config.bloom.radius,
      this.config.bloom.threshold
    );
    bloomPass.enabled = this.config.bloom.enabled;
    this.composer.addPass(bloomPass);
    this.passes.bloom = bloomPass;
  }

  _initVignettePass() {
    const vignetteShader = {
      uniforms: {
        'tDiffuse': { value: null },
        'darkness': { value: this.config.vignette.darkness },
        'falloff': { value: this.config.vignette.falloff },
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
        uniform float darkness;
        uniform float falloff;
        varying vec2 vUv;
        void main() {
          vec4 texel = texture2D(tDiffuse, vUv);
          vec2 uv = vUv - 0.5;
          float dist = length(uv);
          float vignette = smoothstep(0.8, 0.0, dist * falloff);
          vec3 vignetteColor = mix(texel.rgb, vec3(0.0), (1.0 - vignette) * darkness);
          gl_FragColor = vec4(vignetteColor, texel.a);
        }
      `,
    };

    const vignettePass = new THREE.ShaderPass(vignetteShader);
    vignettePass.enabled = this.config.vignette.enabled;
    this.composer.addPass(vignettePass);
    this.passes.vignette = vignettePass;
  }

  _initChromaticAberrationPass() {
    const chromaShader = {
      uniforms: {
        'tDiffuse': { value: null },
        'power': { value: this.config.chromaticAberration.power },
        'uResolution': { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
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
        uniform float power;
        uniform vec2 uResolution;
        varying vec2 vUv;
        void main() {
          vec2 uv = vUv;
          vec2 offset = (uv - 0.5) * power / uResolution;
          
          float r = texture2D(tDiffuse, uv + offset).r;
          float g = texture2D(tDiffuse, uv).g;
          float b = texture2D(tDiffuse, uv - offset).b;
          
          gl_FragColor = vec4(r, g, b, texture2D(tDiffuse, uv).a);
        }
      `,
    };

    const chromaPass = new THREE.ShaderPass(chromaShader);
    chromaPass.enabled = this.config.chromaticAberration.enabled;
    this.composer.addPass(chromaPass);
    this.passes.chroma = chromaPass;
  }

  render() {
    if (!this.composer) {
      // Fallback if composer not available
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render();
  }

  resize(width, height) {
    if (!this.composer) return;
    this.composer.setSize(width, height);
    
    // Update vignette resolution
    if (this.passes.vignette?.uniforms?.uResolution) {
      this.passes.vignette.uniforms.uResolution.value.set(width, height);
    }
    
    // Update chroma resolution
    if (this.passes.chroma?.uniforms?.uResolution) {
      this.passes.chroma.uniforms.uResolution.value.set(width, height);
    }
  }

  // Public API for tweaking effects
  setBloomStrength(val) {
    if (this.passes.bloom) {
      this.passes.bloom.strength = val;
      this.config.bloom.strength = val;
    }
  }

  setBloomThreshold(val) {
    if (this.passes.bloom) {
      this.passes.bloom.threshold = val;
      this.config.bloom.threshold = val;
    }
  }

  setVignetteDarkness(val) {
    if (this.passes.vignette?.uniforms?.darkness) {
      this.passes.vignette.uniforms.darkness.value = val;
      this.config.vignette.darkness = val;
    }
  }

  setChromaticPower(val) {
    if (this.passes.chroma?.uniforms?.power) {
      this.passes.chroma.uniforms.power.value = val;
      this.config.chromaticAberration.power = val;
    }
  }

  // Toggle individual effects
  enableBloom(enabled) {
    if (this.passes.bloom) {
      this.passes.bloom.enabled = enabled;
      this.config.bloom.enabled = enabled;
    }
  }

  enableVignette(enabled) {
    if (this.passes.vignette) {
      this.passes.vignette.enabled = enabled;
      this.config.vignette.enabled = enabled;
    }
  }

  enableChromatic(enabled) {
    if (this.passes.chroma) {
      this.passes.chroma.enabled = enabled;
      this.config.chromaticAberration.enabled = enabled;
    }
  }

  dispose() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }
}
