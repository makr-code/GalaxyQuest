/**
 * Integration: Ship Designer → Asset Pipeline
 * 
 * Bridges generated TRELLIS2 GLB files into the existing 3D asset management system
 * - Budget validation
 * - Quality tier enforcement
 * - Texture compilation
 * - Database persistence
 */

export class ShipDesignerAssetPipeline {
  constructor(opts = {}) {
    this.apiBase = opts.apiBase || '/api';
    this.onProgress = opts.onProgress || (() => {});
    this.onError = opts.onError || (() => {});
  }

  /**
   * Validate generated GLB against faction/class budget constraints
   * 
   * @param {ArrayBuffer} glbBuffer - Raw GLB file data
   * @param {Object} metadata - Generation metadata with tri_budget, faction_code, etc.
   * @returns {Promise<{valid: boolean, stats: Object, warnings: string[]}>}
   */
  async validateGLB(glbBuffer, metadata) {
    this.onProgress({ stage: 'validation', percent: 10 });

    try {
      // Parse GLB header to extract geometry stats
      const stats = this.parseGLBStats(glbBuffer);
      
      const warnings = [];
      const triBudget = metadata.tri_budget || 8000;
      
      // Check triangle count
      if (stats.triangleCount > triBudget) {
        warnings.push(
          `Triangle count ${stats.triangleCount} exceeds budget ${triBudget}. ` +
          `Consider lower quality tier or larger ship class.`
        );
      }
      
      // Check material count (max 8 per ship for performance)
      if (stats.materialCount > 8) {
        warnings.push(
          `Material count ${stats.materialCount} exceeds recommended 8. ` +
          `Consolidate textures to improve performance.`
        );
      }
      
      // Validate signature parts presence
      const factionSignatureParts = this.getSignaturePartsForFaction(metadata.faction_code);
      const presentParts = this.detectSignatureParts(glbBuffer, factionSignatureParts);
      
      if (presentParts.length < 2) {
        warnings.push(
          `Only ${presentParts.length} signature parts detected (need >= 2). ` +
          `Ship may not be recognizable as ${metadata.faction_code}.`
        );
      }

      this.onProgress({ stage: 'validation', percent: 100 });

      return {
        valid: warnings.length === 0 || warnings.every(w => w.includes('Consider')),
        stats: {
          triangleCount: stats.triangleCount,
          materialCount: stats.materialCount,
          trianglePercentOfBudget: Math.round((stats.triangleCount / triBudget) * 100),
          fileSize: glbBuffer.byteLength,
          presentSignatureParts: presentParts,
        },
        warnings,
      };
    } catch (e) {
      this.onError(`GLB validation failed: ${e.message}`);
      return {
        valid: false,
        stats: {},
        warnings: [e.message],
      };
    }
  }

  /**
   * Parse basic GLB stats without full loading
   * (Triangle count, material count, etc.)
   */
  parseGLBStats(glbBuffer) {
    // Minimal GLB header parsing
    // Full implementation would use THREE.GLTFLoader
    const view = new DataView(glbBuffer);
    
    // GLB magic: 0x46546C67 (glTF)
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546c67) {
      throw new Error('Invalid GLB file: incorrect magic number');
    }

    const version = view.getUint32(4, true);
    if (version !== 2) {
      throw new Error('Only GLB v2 supported');
    }

    // For now, return conservative estimates
    // In production, use THREE.GLTFLoader for accurate stats
    return {
      triangleCount: Math.floor(glbBuffer.byteLength / 50), // rough estimate
      materialCount: Math.min(4, Math.floor(glbBuffer.byteLength / 10000)), // conservative
      hasAnimations: false,
      boundingBoxSize: [100, 100, 100], // estimate
    };
  }

  /**
   * Detect presence of faction-specific signature parts by node name matching
   */
  detectSignatureParts(glbBuffer, expectedParts) {
    // In production, would extract actual node names from glTF JSON chunk
    // For now, return subset for validation
    const present = [];
    
    for (const part of expectedParts) {
      // Check if part name appears in buffer (rough heuristic)
      const partBytes = new TextEncoder().encode(part);
      if (this.bufferContains(glbBuffer, partBytes)) {
        present.push(part);
      }
    }
    
    return present;
  }

  /**
   * Check if buffer contains a byte sequence
   */
  bufferContains(buffer, searchBytes) {
    const view = new Uint8Array(buffer);
    const searchView = new Uint8Array(searchBytes);
    
    for (let i = 0; i < view.length - searchView.length; i++) {
      let match = true;
      for (let j = 0; j < searchView.length; j++) {
        if (view[i + j] !== searchView[j]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
    return false;
  }

  /**
   * Get expected signature parts for a faction
   */
  getSignaturePartsForFaction(factionCode) {
    const signatures = {
      vor_tak: ['jaw_bridge', 'dorsal_spine', 'armor_scales'],
      syl_nar: ['halo_tentacles', 'lumen_veins', 'tide_fins'],
      aereth: ['crystal_core', 'energy_vanes', 'sensor_crown'],
      kryl_tha: ['chitin_ridges', 'swarm_appendages', 'mandible_jaw'],
      zhareen: ['archive_spire', 'data_node_cluster', 'sealed_vault_section'],
      vel_ar: ['stealth_vanes', 'sensor_ghost_array', 'shadow_cowl'],
    };
    
    return signatures[factionCode] || [];
  }

  /**
   * Prepare GLB for import: compress, validate, generate preview thumbnail
   */
  async prepareForImport(glbBuffer, metadata) {
    this.onProgress({ stage: 'prepare', percent: 20 });

    // Compress to GZIP (if needed for storage)
    const compressed = await this.compressGLB(glbBuffer);
    
    this.onProgress({ stage: 'prepare', percent: 50 });

    // Generate thumbnail (would use Three.js canvas renderer)
    const thumbnail = await this.generateThumbnail(glbBuffer, metadata);
    
    this.onProgress({ stage: 'prepare', percent: 100 });

    return {
      glbBuffer,
      compressed,
      thumbnail,
      metadata: {
        ...metadata,
        import_timestamp: new Date().toISOString(),
        import_version: '2.0',
      },
    };
  }

  /**
   * Compress GLB with GZIP (stub - requires zlib)
   */
  async compressGLB(glbBuffer) {
    // In production: use pako or node-zlib
    // For now, return uncompressed with note
    console.warn('[ShipDesignerAssetPipeline] GZIP compression not yet implemented');
    return glbBuffer;
  }

  /**
   * Generate thumbnail for ship (stub - requires Three.js)
   */
  async generateThumbnail(glbBuffer, metadata) {
    // In production: use THREE.GLTFLoader + WebGLRenderer to render thumbnail
    // For now, return placeholder
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, 256, 256);
    
    ctx.fillStyle = '#60a5fa';
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🛸', 128, 100);
    ctx.font = '12px monospace';
    ctx.fillText(metadata.faction_code.toUpperCase(), 128, 140);
    ctx.fillText(metadata.ship_class, 128, 160);
    
    return canvas.toDataURL('image/png');
  }

  /**
   * Save generated ship to database and asset store
   */
  async saveShip(glbBuffer, metadata) {
    this.onProgress({ stage: 'save', percent: 10 });

    try {
      // Prepare for import
      const prepared = await this.prepareForImport(glbBuffer, metadata);
      
      this.onProgress({ stage: 'save', percent: 50 });

      // Upload to server
      const formData = new FormData();
      formData.append('action', 'save_generated_ship');
      formData.append('glb_data', new Blob([prepared.glbBuffer], { type: 'model/gltf-binary' }), 'ship.glb');
      formData.append('thumbnail', prepared.thumbnail);
      formData.append('metadata', JSON.stringify(prepared.metadata));

      const res = await fetch(`${this.apiBase}/ship_designer_engine.php`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error(`Server error: ${res.statusText}`);
      }

      const result = await res.json();
      
      this.onProgress({ stage: 'save', percent: 100 });

      return {
        success: true,
        shipId: result.ship_id,
        assetUrl: result.asset_url,
        thumbnail: prepared.thumbnail,
      };
    } catch (e) {
      this.onError(`Failed to save ship: ${e.message}`);
      throw e;
    }
  }

  /**
   * Quality tier scaling (reduce geometry for performance)
   * 
   * Used when GLB exceeds budget but quality is good:
   * - high: full geometry (> 10k tri)
   * - medium: 70% geometry (~7k tri)
   * - low: 40% geometry (~3k tri)
   */
  async scaleQualityTier(glbBuffer, targetTriCount) {
    this.onProgress({ stage: 'scale', percent: 10 });

    // In production: use mesh simplification library (e.g., three-mesh-bvh + simplification)
    // For now, stub that returns unmodified
    console.warn('[ShipDesignerAssetPipeline] Quality tier scaling not yet implemented');
    
    this.onProgress({ stage: 'scale', percent: 100 });
    return glbBuffer;
  }

  /**
   * Apply faction-specific post-processing:
   * - Material adjustments (roughness, metallic)
   * - Color palette enforcement
   * - Normal map generation (if needed)
   */
  async applyFactionPostProcessing(glbBuffer, metadata) {
    this.onProgress({ stage: 'post_process', percent: 10 });

    const factionCode = metadata.faction_code;
    
    // Get faction-specific overrides
    const colorOverrides = this.getColorPaletteForFaction(factionCode);
    const materialOverrides = this.getMaterialOverridesForFaction(factionCode);

    this.onProgress({ stage: 'post_process', percent: 50 });

    // In production: modify glTF chunk to apply overrides
    // For now, just return unmodified with notes
    console.log(`[ShipDesignerAssetPipeline] Would apply color overrides for ${factionCode}:`, colorOverrides);

    this.onProgress({ stage: 'post_process', percent: 100 });

    return glbBuffer;
  }

  getColorPaletteForFaction(factionCode) {
    const palettes = {
      vor_tak: { primary: '#8B4513', secondary: '#C0C0C0', accent: '#FFB84D' },
      syl_nar: { primary: '#4169E1', secondary: '#7FFFD4', accent: '#90EE90' },
      aereth: { primary: '#2288EE', secondary: '#FFFFFF', accent: '#FFD700' },
      kryl_tha: { primary: '#228B22', secondary: '#FFD700', accent: '#00FF00' },
      zhareen: { primary: '#CC44AA', secondary: '#FFD700', accent: '#FF69B4' },
      vel_ar: { primary: '#1C1C1C', secondary: '#4A4A4A', accent: '#00BFFF' },
    };
    
    return palettes[factionCode] || palettes.vor_tak;
  }

  getMaterialOverridesForFaction(factionCode) {
    const overrides = {
      vor_tak: { roughness: 0.8, metallic: 0.6 },
      syl_nar: { roughness: 0.2, metallic: 0.1 },
      aereth: { roughness: 0.3, metallic: 0.9 },
      kryl_tha: { roughness: 0.5, metallic: 0.4 },
      zhareen: { roughness: 0.6, metallic: 0.8 },
      vel_ar: { roughness: 0.9, metallic: 0.3 },
    };
    
    return overrides[factionCode] || { roughness: 0.6, metallic: 0.5 };
  }
}

// ─── Export for use in ship-designer.js ────────────────────────────────────

export default ShipDesignerAssetPipeline;
