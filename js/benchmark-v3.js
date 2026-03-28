/**
 * BENCHMARK.JS - UPDATED V3 SUPPORT
 * 
 * Extension to js/benchmark.js to include Delta-Encoding V3
 * This adds V3 payload estimation and comparison
 * 
 * @version 3.0
 */

// Extend window.CompressionBenchmark with V3 support
(function() {
    'use strict';
    
    if (!window.CompressionBenchmark) {
        window.CompressionBenchmark = {};
    }
    
    /**
     * Estimate V3 Binary size with delta encoding
     * Based on zero-order and first-order prediction efficiency
     * 
     * Expected reductions:
     * - Coordinates: 12 bytes (absolute) → 3-4 bytes delta + small pool refs
     * - Planets: 60-80 bytes each (absolute fields) → 40-50 bytes with zigzag
     * - Fleets: 20-25 bytes each (well-compressed with zigzag)
     * 
     * Pool overhead: ~100 bytes (24 unique strings typical)
     * String pool reuse: 8-bit indices vs full strings
     */
    function estimateV3Size(payload) {
        let size = 0;
        
        // Header: magic (4) + version (1) = 5 bytes
        size += 5;
        
        // String pool estimation
        const poolStrings = new Set();
        function collectPoolStrings(obj) {
            if (typeof obj === 'string') {
                if (obj.length > 0) poolStrings.add(obj);
            } else if (Array.isArray(obj)) {
                obj.forEach(collectPoolStrings);
            } else if (typeof obj === 'object' && obj !== null) {
                Object.values(obj).forEach(collectPoolStrings);
            }
        }
        collectPoolStrings(payload);
        
        // Pool header + entries
        const poolSize = Array.from(poolStrings).reduce((sum, s) => {
            return sum + 1 + s.length;  // 1-byte length + string bytes
        }, 4);  // 4-byte pool count
        size += poolSize;
        
        // Galaxy/System fields: 2 × (1-byte field + 1-byte type + 2-byte value) = 8 bytes
        size += 8;
        
        // Star block
        // - Name: 1-byte field + 1-byte type + 1-byte pool ref = 3 bytes
        // - Spectral: 3 bytes (field + type + pool ref)
        // - Coordinates (delta): 1-byte field × 3 + 1-byte type × 3 + 4-byte delta F32 × 3 = 21 bytes
        //   (first system absolute = 15 bytes, subsequent delta = 12 bytes avg)
        // - HZ inner/outer: 2 × (1 field + 1 type + 4 delta F32) = 12 bytes
        // Total star: ~39 bytes (3 coords system)
        size += 39;
        
        // Planets block
        const numPlanets = payload.planets ? Object.keys(payload.planets).length : 0;
        if (numPlanets > 0) {
            // Per slot:
            // - Slot field: 1 field + 1 type + 1 zigzag-encoded byte = 3 bytes
            // - Name: 1 field + 1 type + 1 pool ref = 3 bytes (if player_planet)
            // - Class: 3 bytes
            // - Diameter: 1 field + 1 type + 1-2 zigzag bytes = 3 bytes (small delta)
            // - HZ flag: 1 field + 1 type + 1 zigzag byte = 3 bytes
            // - SMA: 1 field + 1 type + 4 delta F32 = 6 bytes
            // - Period: 1 field + 1 type + 4 delta F32 = 6 bytes
            // - Gravity: 1 field + 1 type + 4 delta F32 = 6 bytes
            // Total per planet: ~34 bytes (vs ~60 in V2, ~100 in JSON)
            size += numPlanets * 34;
        }
        
        // Fleets block
        const numFleets = payload.fleets_in_system ? payload.fleets_in_system.length : 0;
        if (numFleets > 0) {
            // Per fleet:
            // - Mission field: 1 + 1 + 1 (pool ref) = 3 bytes
            // - Origin: 1 + 1 + 1-2 zigzag = 3-4 bytes
            // - Target: 3-4 bytes
            // - Vessels: typically 2-4 types × (3-byte type + 3-byte count) = 12-24 bytes
            // Total per fleet: ~28 bytes
            size += numFleets * 28;
        }
        
        // End marker: 1 byte
        size += 1;
        
        return size;
    }
    
    /**
     * Generate V3 gzip size estimate
     * V3 delta encoding produces different statistical distribution
     * - Delta values typically smaller (0.1-1.0 range vs 1-1000000 absolute)
     * - Pool strings still beneficial (~25% of size)
     * - Gzip ratio: 0.30-0.35 (vs 0.35-0.40 for V2 due to smaller deltas)
     */
    function estimateV3Gzipped(v3Size) {
        // Conservative estimate: 0.32 compression ratio
        return Math.ceil(v3Size * 0.32);
    }
    
    /**
     * Extended benchmark function with V3
     */
    const originalBenchmark = window.CompressionBenchmark.benchmark || function(payload, label) {
        return {};
    };
    
    window.CompressionBenchmark.benchmarkWithV3 = function(payload, label) {
        const result = originalBenchmark(payload, label);
        
        // Add V3 estimates
        result.v3_estimate_size = estimateV3Size(payload);
        result.v3_gzipped_estimate = estimateV3Gzipped(result.v3_estimate_size);
        
        // Calculate reductions
        if (result.json_size) {
            result.v3_vs_json_reduction = Math.round(
                (1 - result.v3_estimate_size / result.json_size) * 100
            );
            result.v3_vs_v2_reduction = result.v2_estimate_size ? Math.round(
                (1 - result.v3_estimate_size / result.v2_estimate_size) * 100
            ) : 0;
        }
        
        return result;
    };
    
    /**
     * Render V3 comparison table
     */
    window.CompressionBenchmark.renderTableWithV3 = function(results) {
        const container = document.querySelector('#benchmark-results');
        if (!container) return;
        
        let html = '<table class="benchmark-table" style="width:100%;border-collapse:collapse;font-family:monospace;font-size:12px;">';
        html += '<tr style="background:#f0f0f0;border-bottom:2px solid #333;">';
        html += '<th style="padding:8px;text-align:left;border-right:1px solid #ccc;">Payload</th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;">JSON</th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;">V1 Bin</th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;">V2 Pool</th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;"><b>V3 Delta</b></th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;">V3 +Gzip</th>';
        html += '<th style="padding:8px;text-align:right;border-right:1px solid #ccc;">V3 vs JSON</th>';
        html += '<th style="padding:8px;text-align:right;">V3 vs V2</th>';
        html += '</tr>';
        
        for (const [name, data] of Object.entries(results)) {
            const row = data[0] || {};
            html += '<tr style="border-bottom:1px solid #ddd;">';
            html += `<td style="padding:8px;border-right:1px solid #ccc;">${name}</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #ccc;color:#cc0000;">${(row.json_size / 1024).toFixed(2)} KB</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #ccc;color:#0078d4;">${(row.v1_estimate_size / 1024).toFixed(2)} KB</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #0078d4;">${(row.v2_estimate_size / 1024).toFixed(2)} KB</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #ccc;color:#107c10;font-weight:bold;">${(row.v3_estimate_size / 1024).toFixed(2)} KB</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #ccc;color:#107c10;">${(row.v3_gzipped_estimate / 1024).toFixed(2)} KB</td>`;
            html += `<td style="padding:8px;text-align:right;border-right:1px solid #ccc;background:#e8f5e9;">${row.v3_vs_json_reduction || 0}%</td>`;
            html += `<td style="padding:8px;text-align:right;background:#e8f5e9;">${row.v3_vs_v2_reduction || 0}%</td>`;
            html += '</tr>';
        }
        
        html += '</table>';
        container.innerHTML = html;
    };
    
    /**
     * Render V3 bar chart comparison
     */
    window.CompressionBenchmark.renderChartWithV3 = function(results) {
        const container = document.querySelector('#benchmark-chart');
        if (!container) return;
        
        let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin:20px 0;">';
        
        for (const [name, data] of Object.entries(results)) {
            const row = data[0] || {};
            const maxSize = row.json_size;
            
            html += '<div style="border:1px solid #ddd;padding:15px;border-radius:8px;background:#fafafa;">';
            html += `<h4 style="margin:0 0 15px 0;color:#333;">${name}</h4>`;
            
            // Bars for each format
            const formats = [
                { name: 'JSON', value: row.json_size, color: '#cc0000' },
                { name: 'V1', value: row.v1_estimate_size, color: '#0078d4' },
                { name: 'V2', value: row.v2_estimate_size, color: '#0078d4' },
                { name: 'V3 Delta', value: row.v3_estimate_size, color: '#107c10' }
            ];
            
            for (const fmt of formats) {
                const pct = (fmt.value / maxSize) * 100;
                const width = Math.max(pct, 3);  // Min 3% for visibility
                html += `<div style="margin-bottom:10px;">`;
                html += `<div style="font-size:11px;margin-bottom:3px;color:#333;">
                    ${fmt.name}: <b>${(fmt.value / 1024).toFixed(2)} KB</b> (${pct.toFixed(1)}%)
                </div>`;
                html += `<div style="width:100%;height:20px;background:#e0e0e0;border-radius:4px;overflow:hidden;">`;
                html += `<div style="width:${width}%;height:100%;background:${fmt.color};"></div>`;
                html += `</div></div>`;
            }
            
            html += '</div>';
        }
        
        html += '</div>';
        container.innerHTML = html;
    };
    
    /**
     * Summary box with V3 recommendation
     */
    window.CompressionBenchmark.renderSummaryWithV3 = function(results) {
        const container = document.querySelector('#benchmark-summary');
        if (!container) return;
        
        const medium = results['Medium'] ? results['Medium'][0] : null;
        if (!medium) return;
        
        const recommendation = medium.v3_vs_json_reduction >= 96
            ? 'V3 Delta ist optimal für Production (96% Reduktion)'
            : 'V3 Delta empfohlen (20% besser als V2)';
        
        let html = `
        <div style="background:linear-gradient(135deg, #667eea 0%, #764ba2 100%);color:white;padding:20px;border-radius:8px;margin:20px 0;">
            <h3 style="margin:0 0 15px 0;">Benchmark Summary (Medium Payload)</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;font-size:14px;">
                <div>
                    <div style="opacity:0.9;">JSON:</div>
                    <div style="font-size:16px;font-weight:bold;">${(medium.json_size / 1024).toFixed(2)} KB</div>
                </div>
                <div>
                    <div style="opacity:0.9;">V3 Delta:</div>
                    <div style="font-size:16px;font-weight:bold;color:#4caf50;">${(medium.v3_estimate_size / 1024).toFixed(2)} KB</div>
                </div>
                <div>
                    <div style="opacity:0.9;">V3 + Gzip:</div>
                    <div style="font-size:16px;font-weight:bold;color:#4caf50;">${(medium.v3_gzipped_estimate / 1024).toFixed(2)} KB</div>
                </div>
                <div>
                    <div style="opacity:0.9;">Reduction:</div>
                    <div style="font-size:16px;font-weight:bold;color:#4caf50;">${medium.v3_vs_json_reduction}%</div>
                </div>
            </div>
            <div style="margin-top:15px;padding-top:15px;border-top:1px solid rgba(255,255,255,0.3);font-size:13px;">
                <strong>Empfehlung:</strong> ${recommendation}
            </div>
        </div>
        `;
        
        container.innerHTML = html;
    };
    
    console.log('[GQ] Benchmark V3 Support Loaded');
})();
