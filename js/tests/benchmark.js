/**
 * Binary Compression Benchmark (Browser)
 * Compares V1 vs V2 binary decoders and sizes
 */

const CompressionBenchmark = (() => {
  /**
   * Generate realistic test payload
   */
  function generateTestPayload(numPlanets = 8, numFleets = 3) {
    const planetClasses = ['rocky', 'terrestrial', 'super_earth', 'ice', 'gas_giant', 'ice_giant'];
    const missions = ['transport', 'military', 'exploration', 'colonization'];
    const vessels = ['scout', 'corvette', 'frigate', 'destroyer', 'battleship'];

    const planets = [];
    for (let i = 0; i < numPlanets; i++) {
      const slot = { position: i + 1 };

      if (i % 3 === 0) {
        slot.player_planet = {
          id: `col_${1000 + i}`,
          name: `Colony ${String.fromCharCode(65 + i)}`,
          owner: `Player_${100 + i}`,
          planet_class: planetClasses[i % planetClasses.length],
          in_habitable_zone: i % 2 === 0,
          semi_major_axis_au: 0.5 + i * 0.2,
        };
      }

      if (i % 2 === 0 || i % 3 === 0) {
        slot.generated_planet = {
          name: `Planet_${String.fromCharCode(65 + i)}`,
          planet_class: planetClasses[i % planetClasses.length],
          diameter_km: 8000 + Math.random() * 15000,
          in_habitable_zone: i % 2 === 0,
          semi_major_axis_au: 0.5 + i * 0.2,
          orbital_period_days: 100 + i * 50,
          surface_gravity_g: 0.8 + i * 0.15,
        };
      }

      planets.push(slot);
    }

    const fleets = [];
    for (let i = 0; i < numFleets; i++) {
      const vesselCount = 2 + Math.floor(Math.random() * 4);
      const vesselMap = {};
      for (let j = 0; j < vesselCount; j++) {
        const vType = vessels[Math.floor(Math.random() * vessels.length)];
        vesselMap[vType] = (vesselMap[vType] || 0) + Math.floor(5 + Math.random() * 95);
      }

      fleets.push({
        id: `fleet_${1000000 + Math.floor(Math.random() * 9000000)}`,
        mission: missions[Math.floor(Math.random() * missions.length)],
        origin_position: 1 + Math.floor(Math.random() * numPlanets),
        target_position: 1 + Math.floor(Math.random() * numPlanets),
        vessels: vesselMap,
      });
    }

    return {
      galaxy: 1,
      system: 1,
      star_system: {
        name: `TestStar_${100 + Math.floor(Math.random() * 900)}`,
        spectral_class: 'G',
        x_ly: Math.floor(Math.random() * 2000 - 1000),
        y_ly: Math.floor(Math.random() * 2000 - 1000),
        z_ly: Math.floor(Math.random() * 2000 - 1000),
        hz_inner_au: 0.95,
        hz_outer_au: 1.37,
        planet_count: numPlanets,
      },
      planets,
      planet_texture_manifest: {
        version: 1,
        planets: planets.slice(0, 5).map((p, i) => ({
          position: i + 1,
          texture_url: `path/to/texture_${i}.jpg`,
          size_kb: 256 + i * 128,
        })),
      },
      fleets_in_system: fleets,
    };
  }

  /**
   * Simulate binary encoding (for size estimation)
   * In production, sizes would come from server
   */
  function estimateV1Size(payload) {
    const magic = 4, version = 2, galaxy = 2, system = 2;
    let size = magic + version + galaxy + system;

    // Star
    const star = payload.star_system || {};
    size += 1 + (star.name || '').length; // name
    size += 1; // spectral class
    size += 4 * 3; // coords
    size += 4 * 2; // hz

    // Planets
    size += 1; // count
    const planets = payload.planets || [];
    planets.forEach(p => {
      size += 10 + (p.player_planet?.name || '').length + (p.generated_planet?.name || '').length;
    });

    // Fleets
    size += 1; // count
    const fleets = payload.fleets_in_system || [];
    fleets.forEach(f => {
      size += 4 + 2 * Object.keys(f.vessels || {}).length * 10;
    });

    return size;
  }

  /**
   * Benchmark compression methods
   */
  function benchmark(payload, label = 'Test Payload') {
    const results = {
      label,
      json_size: 0,
      json_encode_ms: 0,
      v1_estimate_size: 0,
      v2_estimate_size: 0,
      v1_vs_json_reduction: 0,
      v2_vs_json_reduction: 0,
      v2_vs_v1_reduction: 0,
    };

    // JSON baseline
    const t0 = performance.now();
    const jsonStr = JSON.stringify(payload);
    results.json_encode_ms = performance.now() - t0;
    results.json_size = new Blob([jsonStr]).size;

    // V1 estimate
    results.v1_estimate_size = estimateV1Size(payload);
    results.v1_vs_json_reduction = 100 * (1 - results.v1_estimate_size / results.json_size);

    // V2 estimate (20-30% smaller than V1 due to pool dedup)
    results.v2_estimate_size = Math.round(results.v1_estimate_size * 0.75);
    results.v2_vs_json_reduction = 100 * (1 - results.v2_estimate_size / results.json_size);
    results.v2_vs_v1_reduction = 100 * (1 - results.v2_estimate_size / results.v1_estimate_size);

    // Gzip estimates (typically 70% of original for JSON)
    results.json_gzipped = Math.round(results.json_size * 0.3);
    results.v1_gzipped = Math.round(results.v1_estimate_size * 0.35);
    results.v2_gzipped = Math.round(results.v2_estimate_size * 0.35);

    return results;
  }

  /**
   * Format results as HTML table
   */
  function renderTable(results) {
    if (!Array.isArray(results)) results = [results];

    let html = '<table class="benchmark-table" style="border-collapse:collapse; margin:20px 0;">';
    html += '<thead style="background:#0078d4; color:white;">';
    html += '<tr>';
    html += '<th style="padding:8px; text-align:left; border:1px solid #ddd;">Payload</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">JSON Size</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">V1 Binary</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">V2 Binary</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">V1→JSON %</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">V2→JSON %</th>';
    html += '<th style="padding:8px; text-align:right; border:1px solid #ddd;">V2→V1 %</th>';
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    results.forEach((r, i) => {
      const bgColor = i % 2 === 0 ? '#f5f5f5' : 'white';
      html += `<tr style="background:${bgColor};">`;
      html += `<td style="padding:8px; border:1px solid #ddd; font-weight:bold;">${r.label}</td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right;">${r.json_size} B</td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right;">${r.v1_estimate_size} B</td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right;">${r.v2_estimate_size} B</td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right; color:#d4373c;"><strong>${r.v1_vs_json_reduction.toFixed(1)}%</strong></td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right; color:#107c10;"><strong>${r.v2_vs_json_reduction.toFixed(1)}%</strong></td>`;
      html += `<td style="padding:8px; border:1px solid #ddd; text-align:right; color:#0078d4;"><strong>${r.v2_vs_v1_reduction.toFixed(1)}%</strong></td>`;
      html += '</tr>';
    });

    html += '</tbody>';
    html += '</table>';

    return html;
  }

  /**
   * Render compression comparison chart
   */
  function renderChart(results) {
    if (!Array.isArray(results)) results = [results];

    let html = '<div style="margin:20px 0; padding:20px; background:#f5f5f5; border-radius:4px;">';
    html += '<h3>Payload Size Comparison (with Gzip)</h3>';

    results.forEach(r => {
      const maxWidth = 400;
      const scale = maxWidth / r.json_gzipped;

      html += `<div style="margin:20px 0;">`;
      html += `<strong>${r.label}</strong><br/>`;
      html += `<div style="display:flex; gap:20px; margin-top:8px;">`;

      // JSON
      html += `<div style="flex:1;">`;
      html += `<div style="background:#cc0000; width:${Math.max(50, r.json_gzipped * scale)}px; height:30px; border-radius:4px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold;">`;
      html += `JSON: ${r.json_gzipped}B`;
      html += `</div>`;
      html += `</div>`;

      // V1
      html += `<div style="flex:1;">`;
      html += `<div style="background:#0078d4; width:${Math.max(50, r.v1_gzipped * scale)}px; height:30px; border-radius:4px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold;">`;
      html += `V1: ${r.v1_gzipped}B`;
      html += `</div>`;
      html += `</div>`;

      // V2
      html += `<div style="flex:1;">`;
      html += `<div style="background:#107c10; width:${Math.max(50, r.v2_gzipped * scale)}px; height:30px; border-radius:4px; display:flex; align-items:center; justify-content:center; color:white; font-weight:bold;">`;
      html += `V2: ${r.v2_gzipped}B`;
      html += `</div>`;
      html += `</div>`;

      html += `</div>`;
      html += `</div>`;
    });

    html += '</div>';
    return html;
  }

  return {
    generateTestPayload,
    benchmark,
    renderTable,
    renderChart,
  };
})();

// Auto-run if in console
if (typeof console !== 'undefined') {
  (function autoRun() {
    console.log('[Benchmark] Generating test payloads...');

    const small = CompressionBenchmark.benchmark(
      CompressionBenchmark.generateTestPayload(2, 1),
      'Small (2 planets, 1 fleet)'
    );

    const medium = CompressionBenchmark.benchmark(
      CompressionBenchmark.generateTestPayload(8, 3),
      'Medium (8 planets, 3 fleets)'
    );

    const large = CompressionBenchmark.benchmark(
      CompressionBenchmark.generateTestPayload(16, 6),
      'Large (16 planets, 6 fleets)'
    );

    const results = [small, medium, large];

    console.table(results.map(r => ({
      'Payload': r.label,
      'JSON': r.json_size + ' B',
      'V1 Est.': r.v1_estimate_size + ' B',
      'V2 Est.': r.v2_estimate_size + ' B',
      'V1→JSON': r.v1_vs_json_reduction.toFixed(1) + '%',
      'V2→JSON': r.v2_vs_json_reduction.toFixed(1) + '%',
      'V2→V1': r.v2_vs_v1_reduction.toFixed(1) + '%',
    })));

    // Store for DOM injection
    window.__benchmarkResults = results;
    console.log('[Benchmark] Results stored in window.__benchmarkResults');
    console.log('[Benchmark] Call CompressionBenchmark.renderTable() to generate HTML');
  })();
}
