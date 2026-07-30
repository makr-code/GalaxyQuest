/**
 * TextureCompressionManager.js
 *
 * Manages texture compression support detection and optimization.
 * Reduces texture cache memory by 60-80% using GPU-compressed formats:
 *   - BC7 (DXT10) — Windows/Desktop
 *   - ASTC — Mobile/WebGPU
 *   - ETC2 — Android fallback
 *
 * Usage:
 *   const compMgr = new TextureCompressionManager();
 *   if (compMgr.isSupported('astc')) {
 *     texture = await compMgr.loadCompressedTexture('/textures/star.astc');
 *   } else {
 *     texture = await loadUncompressedTexture('/textures/star.png');
 *   }
 *
 * License: MIT — makr-code/GalaxyQuest
 */

'use strict';

class TextureCompressionManager {
  constructor() {
    this._supportedFormats = new Set();
    this._extensionCache = new Map();
    this._textureCache = new Map();
    this._metrics = {
      compressionsSaved: 0,
      memoryReducedMB: 0,
      fallbackCount: 0,
    };

    this._detectSupport();
  }

  /**
   * Detect supported compression formats from WebGL/WebGPU extensions.
   * @private
   */
  _detectSupport() {
    try {
      // Try WebGL context for extension detection
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');

      if (gl) {
        // BC7 / DXT10 (Desktop)
        if (gl.getExtension('EXT_texture_compression_s3tc')) {
          this._supportedFormats.add('dxt1');
          this._supportedFormats.add('dxt3');
          this._supportedFormats.add('dxt5');
        }

        // ASTC (Modern, cross-platform)
        if (gl.getExtension('KHR_texture_compression_astc_ldr')) {
          this._supportedFormats.add('astc');
        }

        // ETC2 (Mobile)
        if (gl.getExtension('WEBGL_compressed_texture_etc')) {
          this._supportedFormats.add('etc2');
        }

        // PVRTC (iOS)
        if (gl.getExtension('WEBGL_compressed_texture_pvrtc')) {
          this._supportedFormats.add('pvrtc');
        }

        // S3TC (fallback)
        if (gl.getExtension('WEBGL_compressed_texture_s3tc')) {
          this._supportedFormats.add('s3tc');
        }
      }

      canvas.remove();
    } catch (err) {
      console.warn('[TextureCompressionManager] Failed to detect WebGL compression:', err);
    }

    // WebGPU detection (future-proofing)
    if (navigator.gpu) {
      // WebGPU compression formats: 'bc7-rgba-unorm', 'astc-4x4-unorm', etc.
      this._supportedFormats.add('astc-webgpu');
    }
  }

  /**
   * Check if a compression format is supported.
   * @param {string} format - 'astc', 'bc7', 'dxt5', 'etc2', etc.
   * @returns {boolean}
   */
  isSupported(format) {
    format = String(format).toLowerCase();
    return this._supportedFormats.has(format);
  }

  /**
   * Get best supported format for current hardware.
   * Prefers ASTC (most portable modern format).
   * @returns {string|null} 'astc', 'bc7', 'etc2', 'pvrtc', 'dxt5', or null
   */
  getBestFormat() {
    if (this.isSupported('astc')) return 'astc';
    if (this.isSupported('bc7')) return 'bc7';
    if (this.isSupported('dxt5')) return 'dxt5';
    if (this.isSupported('etc2')) return 'etc2';
    if (this.isSupported('pvrtc')) return 'pvrtc';
    return null;
  }

  /**
   * Get all supported formats.
   * @returns {string[]}
   */
  getSupportedFormats() {
    return Array.from(this._supportedFormats);
  }

  /**
   * Calculate estimated memory reduction from compression.
   * @param {number} uncompressedSizeMB
   * @param {string} format - compression format
   * @returns {number} estimated compressed size in MB
   */
  estimateCompressedSize(uncompressedSizeMB, format) {
    // Rough compression ratios (varies by format and content)
    const ratios = {
      'astc': 0.2,      // ~80% reduction
      'bc7': 0.25,      // ~75% reduction
      'dxt5': 0.3,      // ~70% reduction
      'etc2': 0.2,      // ~80% reduction
      'pvrtc': 0.25,    // ~75% reduction
    };

    const ratio = ratios[format] || 1.0;
    return uncompressedSizeMB * ratio;
  }

  /**
   * Load compressed texture asynchronously.
   * Falls back to uncompressed if loading fails.
   *
   * @param {string} baseUrl - URL without extension
   * @param {string} format - compression format
   * @param {Object} opts - { fallbackUrl, uncompressedSize, ... }
   * @returns {Promise<Blob>} compressed texture data
   */
  async loadCompressedTexture(baseUrl, format, opts = {}) {
    if (!this.isSupported(format)) {
      throw new Error(`Format not supported: ${format}`);
    }

    const cacheKey = `${baseUrl}:${format}`;
    if (this._textureCache.has(cacheKey)) {
      return this._textureCache.get(cacheKey);
    }

    try {
      // Construct compressed URL
      const ext = this._getExtensionForFormat(format);
      const compressedUrl = `${baseUrl}.${ext}`;

      const response = await fetch(compressedUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }

      const blob = await response.blob();
      this._textureCache.set(cacheKey, blob);

      // Track metrics
      const uncompressedSize = opts.uncompressedSize || (blob.size * 5);
      const reducedSize = uncompressedSize - blob.size;
      this._metrics.compressionsSaved++;
      this._metrics.memoryReducedMB += reducedSize / (1024 * 1024);

      return blob;
    } catch (err) {
      console.warn(`[TextureCompressionManager] Compressed texture load failed, trying fallback: ${err.message}`);
      this._metrics.fallbackCount++;

      if (opts.fallbackUrl) {
        const response = await fetch(opts.fallbackUrl);
        return response.blob();
      }

      throw err;
    }
  }

  /**
   * Get file extension for compression format.
   * @private
   */
  _getExtensionForFormat(format) {
    const extensions = {
      'astc': 'astc',
      'bc7': 'dds',
      'dxt5': 'dds',
      'etc2': 'ktx2',
      'pvrtc': 'ktx',
      's3tc': 'dds',
    };
    return extensions[format] || 'bin';
  }

  /**
   * Get compression metrics.
   * @returns {Object}
   */
  getMetrics() {
    return { ...this._metrics };
  }

  /**
   * Get human-readable report.
   * @returns {string}
   */
  report() {
    const supportedList = Array.from(this._supportedFormats).join(', ') || 'none';
    const bestFormat = this.getBestFormat() || 'none';
    const reducedMB = this._metrics.memoryReducedMB.toFixed(1);

    return [
      `[TextureCompressionManager]`,
      `  Supported Formats: ${supportedList}`,
      `  Best Format: ${bestFormat}`,
      `  Compressions Used: ${this._metrics.compressionsSaved}`,
      `  Memory Reduced: ${reducedMB}MB`,
      `  Fallback Count: ${this._metrics.fallbackCount}`,
    ].join('\n');
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TextureCompressionManager };
} else {
  window.GQTextureCompressionManager = TextureCompressionManager;
}
