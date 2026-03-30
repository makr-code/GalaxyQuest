/**
 * HR-Diagram Visualizer
 * 
 * Interactive Hertzsprung-Russell (HR) Diagram showing stellar classification
 * by luminosity and effective temperature.
 */

function openHRDiagram(currentStarType = 'main_sequence') {
    const width = 800;
    const height = 600;
    const padding = 60;

    // Build modal
    const backdrop = document.createElement('div');
    backdrop.className = 'hr-diagram-backdrop';
    backdrop.addEventListener('click', () => backdrop.remove());

    const modal = document.createElement('div');
    modal.className = 'hr-diagram-modal';

    const html = `
        <div class="hr-diagram-header">
            <h2>Hertzsprung-Russell Diagram</h2>
            <button class="hr-diagram-close">&times;</button>
        </div>
        <div class="hr-diagram-content">
            <canvas id="hr-canvas" width="${width}" height="${height}"></canvas>
            <div class="hr-diagram-legend">
                <div class="hr-legend-item">
                    <span class="hr-legend-dot main-sequence"></span>
                    <span>Main Sequence</span>
                </div>
                <div class="hr-legend-item">
                    <span class="hr-legend-dot white-dwarf"></span>
                    <span>White Dwarfs</span>
                </div>
                <div class="hr-legend-item">
                    <span class="hr-legend-dot red-giant"></span>
                    <span>Red Giants</span>
                </div>
                <div class="hr-legend-item">
                    <span class="hr-legend-dot supergiant"></span>
                    <span>Supergiants</span>
                </div>
                <div class="hr-legend-item">
                    <span class="hr-legend-dot brown-dwarf"></span>
                    <span>Brown Dwarfs</span>
                </div>
            </div>
            <div class="hr-diagram-info">
                <h4>About the HR Diagram</h4>
                <p>
                    The Hertzsprung-Russell (HR) Diagram plots stars by their absolute magnitude (luminosity)
                    against their effective surface temperature (or spectral class). Most stars follow the
                    <strong>Main Sequence</strong> diagonal, burning hydrogen in their cores. White dwarfs appear
                    in the lower left (hot but dim), while giants and supergiants populate the right side
                    (cool but luminous).
                </p>
                <p>
                    This fundamental diagram helps us understand stellar evolution and classify unknown stars.
                </p>
                <a href="https://en.wikipedia.org/wiki/Hertzsprung%E2%80%93Russell_diagram" target="_blank" rel="noopener">
                    📖 Learn more on Wikipedia
                </a>
            </div>
        </div>
    `;

    modal.innerHTML = html;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Attach close handler
    const closeBtn = modal.querySelector('.hr-diagram-close');
    closeBtn.addEventListener('click', () => backdrop.remove());

    // Draw HR diagram
    setTimeout(() => {
        const canvas = modal.querySelector('#hr-canvas');
        _drawHRDiagram(canvas, width, height, padding, currentStarType);
    }, 0);
}

function _drawHRDiagram(canvas, width, height, padding, highlightType) {
    const ctx = canvas.getContext('2d');

    // Style
    ctx.fillStyle = '#0d1b2e';
    ctx.fillRect(0, 0, width, height);

    // Axes
    ctx.strokeStyle = '#3aa0ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, height - padding);
    ctx.lineTo(width - padding, height - padding);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#c8d8e8';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Temperature (K)', width / 2, height - 15);
    
    ctx.save();
    ctx.translate(20, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Luminosity (L☉)', 0, 0);
    ctx.restore();

    // Axis ticks and values
    const tempRange = [3000, 30000];  // Kelvin
    const lumRange = [0.0001, 100000];  // Solar luminosities

    // Temperature axis (X)
    for (let i = 0; i < 7; i++) {
        const temp = tempRange[0] + (tempRange[1] - tempRange[0]) * i / 6;
        const x = padding + (width - 2 * padding) * i / 6;
        
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, height - padding);
        ctx.lineTo(x, height - padding + 5);
        ctx.stroke();
        
        ctx.fillStyle = '#7a9bbf';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(Math.round(temp).toLocaleString(), x, height - 25);
    }

    // Luminosity axis (Y) - log scale
    for (let i = 0; i <= 12; i++) {
        const logLum = Math.log10(lumRange[0]) + (Math.log10(lumRange[1]) - Math.log10(lumRange[0])) * i / 12;
        const lum = Math.pow(10, logLum);
        const y = height - padding - (height - 2 * padding) * i / 12;
        
        ctx.strokeStyle = '#1e3a5f';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding - 5, y);
        ctx.lineTo(padding, y);
        ctx.stroke();
        
        ctx.fillStyle = '#7a9bbf';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        if (lum < 1) {
            ctx.fillText('10^' + logLum.toFixed(0), padding - 10, y + 3);
        } else {
            ctx.fillText(lum.toFixed(0), padding - 10, y + 3);
        }
    }

    // Draw Main Sequence curve (theoretical)
    ctx.strokeStyle = '#ffcc00';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    let first = true;
    for (let temp = 3000; temp <= 30000; temp += 100) {
        // Approximate main sequence relation
        const tempRatio = temp / 5778;
        const lum = Math.pow(tempRatio, 3.5);
        
        const x = padding + (width - 2 * padding) * (temp - tempRange[0]) / (tempRange[1] - tempRange[0]);
        const logLum = Math.log10(lum);
        const logRange = Math.log10(lumRange[1]) - Math.log10(lumRange[0]);
        const y = height - padding - (height - 2 * padding) * (logLum - Math.log10(lumRange[0])) / logRange;
        
        if (first) {
            ctx.moveTo(x, y);
            first = false;
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Annotate regions
    ctx.fillStyle = 'rgba(255, 200, 100, 0.3)';
    ctx.globalAlpha = 0.15;
    ctx.fillRect(padding + 200, padding, 300, 100);  // White dwarf region
    ctx.fillRect(padding + 100, padding + 250, 200, height - 3 * padding - 250);  // Giants region
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = '#c8d8e8';
    ctx.font = '11px sans-serif';
    ctx.fillText('White Dwarfs', padding + 250, padding + 40);
    ctx.fillText('Red Giants', padding + 180, height - padding - 100);

    // Mark current star type
    if (highlightType === 'white_dwarf') {
        _markRegion(ctx, padding + 200, padding + 100, 50, highlightType);
    } else if (highlightType === 'red_giant') {
        _markRegion(ctx, padding + 150, padding + 300, 100, highlightType);
    } else {
        // Main sequence
        _markRegion(ctx, padding + 400, padding + 180, 50, highlightType);
    }
}

function _markRegion(ctx, x, y, radius, type) {
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1.0;
}

// Expose globally
window.openHRDiagram = openHRDiagram;
