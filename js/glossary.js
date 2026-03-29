/**
 * Glossary Modal – Scientific terminology for GalaxyQuest
 * 
 * Provides interactive educational glossary with Wikipedia links and detailed
 * explanations of astronomical and planetary science terms used in the game.
 */

const GLOSSARY_TERMS = {
    'white_dwarf': {
        term: 'White Dwarf',
        category: 'Stellar Type',
        short: 'The compact remnant of a low-mass star after its red giant phase.',
        full: 'A white dwarf is the dense core remaining after a star like our Sun reaches the end of its life. These objects are typically Earth-sized but contain a Solar mass of material, creating extreme density. They cool slowly over billions of years.',
        wikipedia: 'https://en.wikipedia.org/wiki/White_dwarf',
        arxiv: 'https://arxiv.org/abs/1303.2916'  // Fontaine et al. white dwarf models
    },
    'main_sequence': {
        term: 'Main Sequence',
        category: 'Stellar Classification',
        short: 'The phase where stars spend most of their lives fusing hydrogen in their cores.',
        full: 'The main sequence is a stable phase of stellar evolution lasting billions of years. During this time, stars support themselves through hydrogen fusion. The Sun is currently in its main sequence phase (about 4.6 billion years old of a ~10 billion year lifespan).',
        wikipedia: 'https://en.wikipedia.org/wiki/Main_sequence',
        arxiv: 'https://arxiv.org/abs/astro-ph/0202124'
    },
    'habitable_zone': {
        term: 'Habitable Zone',
        category: 'Planetary Habitability',
        short: 'The orbital region around a star where liquid water can exist on a planet\'s surface.',
        full: 'The habitable zone (also called the "Goldilocks zone") represents the distance from a star where planetary surface temperatures allow liquid water. This depends on the star\'s luminosity: hotter stars have habitable zones farther away, while cool stars like white dwarfs have very narrow habitable zones close to the star.',
        wikipedia: 'https://en.wikipedia.org/wiki/Habitable_zone',
        arxiv: 'https://arxiv.org/abs/1301.6674'  // Kopparapu et al. habitable zone
    },
    'spectral_class': {
        term: 'Spectral Class',
        category: 'Stellar Classification',
        short: 'A categorization of stars based on their surface temperature and light spectrum.',
        full: 'Stars are classified into spectral classes O, B, A, F, G, K, M (from hottest to coolest). The sequence represents increasing temperature and decreasing mass. Our Sun is a G-class (G2V) star. Each class is subdivided 0–9 for finer classification.',
        wikipedia: 'https://en.wikipedia.org/wiki/Stellar_classification',
        arxiv: 'https://arxiv.org/abs/astro-ph/0108020'
    },
    'luminosity_class': {
        term: 'Luminosity Class',
        category: 'Stellar Classification',
        short: 'A designation indicating a star\'s size and evolutionary stage (dwarf, giant, supergiant, etc.).',
        full: 'Roman numerals from Ia (bright supergiant) to VII (white dwarf VIII) indicate luminosity class. Class V stars are main sequence dwarfs like our Sun. Class VIII includes white dwarfs. This classification helps distinguish between, for example, a hot O-class dwarf versus a cool O-class giant.',
        wikipedia: 'https://en.wikipedia.org/wiki/Luminosity_class',
        arxiv: 'https://arxiv.org/abs/1511.08736'
    },
    'temperature_stellar': {
        term: 'Stellar Temperature',
        category: 'Stellar Properties',
        short: 'The effective surface temperature of a star, measured in Kelvin.',
        full: 'Stellar surface temperature dictates the star\'s color and spectrum. The Sun\'s photosphere is ~5,778 K (appearing yellow-white). Hot O-class stars exceed 30,000 K (blue), while cool M-class dwarfs are under 3,700 K (red). White dwarfs cool from ~150,000 K to ~8,000 K over billions of years.',
        wikipedia: 'https://en.wikipedia.org/wiki/Effective_temperature',
        arxiv: 'https://arxiv.org/abs/1210.7467'
    },
    'luminosity': {
        term: 'Luminosity',
        category: 'Stellar Properties',
        short: 'The total amount of light and energy a star emits per unit time.',
        full: 'Luminosity is often expressed in solar units (L☉), where the Sun = 1.0. Luminosity depends on surface temperature and radius (L ∝ R² T⁴). Hot, large stars are luminous; cool, small stars (like red dwarfs or white dwarfs) are dim. White dwarfs typically have luminosities of 0.0001–0.01 L☉.',
        wikipedia: 'https://en.wikipedia.org/wiki/Luminosity',
        arxiv: 'https://arxiv.org/abs/1509.05143'
    },
    'mass_stellar': {
        term: 'Stellar Mass',
        category: 'Stellar Properties',
        short: 'The amount of matter in a star, usually expressed in units of Solar masses (M☉).',
        full: 'The Sun\'s mass is defined as 1 M☉ = 1.99×10³⁰ kg. Most stars range from 0.08 M☉ (brown dwarfs, substellar) to ~150 M☉ (massive O-stars). Mass determines a star\'s luminosity, lifespan, and fate. White dwarfs typically retain 0.5–0.7 M☉ after their progenitor\'s mass is shed.',
        wikipedia: 'https://en.wikipedia.org/wiki/Solar_mass',
        arxiv: 'https://arxiv.org/abs/1908.03222'
    },
    'radius_stellar': {
        term: 'Stellar Radius',
        category: 'Stellar Properties',
        short: 'The distance from a star\'s center to its photosphere, usually measured in Solar radii (R☉).',
        full: 'The Sun\'s radius is 1 R☉ = 6.96×10⁸ m. Stellar radius varies greatly: red dwarf M-stars are ~0.1 R☉, while red giants can exceed 100 R☉. White dwarfs are extremely compact at ~0.01 R☉ (Earth-sized), creating their high density and intense gravity.',
        wikipedia: 'https://en.wikipedia.org/wiki/Solar_radius',
        arxiv: 'https://arxiv.org/abs/1902.08238'
    },
    'metallicity': {
        term: 'Metallicity',
        category: 'Stellar Composition',
        short: 'The proportion of elements heavier than helium in a star\'s composition.',
        full: 'Metallicity is denoted as [Z] or Z (often relative to solar, Z☉ = 0.02). Early universe stars had low metallicity; modern stars like the Sun have solar metallicity. Higher metallicity correlates with stronger planetary magnetic fields and potentially greater planetary diversity.',
        wikipedia: 'https://en.wikipedia.org/wiki/Metallicity',
        arxiv: 'https://arxiv.org/abs/1210.7467'
    },
    'semi_major_axis': {
        term: 'Semi-Major Axis',
        category: 'Orbital Mechanics',
        short: 'Half the longest diameter of an elliptical orbit; used to measure orbital distance.',
        full: 'For a circular orbit, semi-major axis equals orbital radius. Earth\'s semi-major axis is 1 AU (Astronomical Unit). This parameter is crucial for calculating orbital period (via Kepler\'s third law) and determining if a planet is in the habitable zone.',
        wikipedia: 'https://en.wikipedia.org/wiki/Semi-major_axis',
        arxiv: 'https://arxiv.org/abs/1601.00357'
    },
    'orbital_period': {
        term: 'Orbital Period',
        category: 'Orbital Mechanics',
        short: 'The time a planet takes to complete one full orbit around its star.',
        full: 'Kepler\'s third law relates orbital period (P) to semi-major axis (a) and star mass (M): P² = a³/M. Earth\'s period is 1 year; closer planets orbit faster, distant planets slower. This determines seasonal and climate patterns for habitable worlds.',
        wikipedia: 'https://en.wikipedia.org/wiki/Orbital_period',
        arxiv: 'https://arxiv.org/abs/0706.4148'
    },
    'frost_line': {
        term: 'Frost Line',
        category: 'Planetary Formation',
        short: 'The orbital distance from a star where water and other volatiles can freeze.',
        full: 'Beyond the frost line (~2.7√L AU from a star), temperatures drop below 170 K, allowing water ice and ammonia to condense. This boundary marks the transition zone in planetary-formation models where gas giants preferentially form. Closer to the star, only rocky planets emerge.',
        wikipedia: 'https://en.wikipedia.org/wiki/Frost_line_(astrophysics)',
        arxiv: 'https://arxiv.org/abs/1401.2672'
    },
    'planet_class': {
        term: 'Planet Class',
        category: 'Planetary Classification',
        short: 'A categorization of planets based on size, composition, and presumed characteristics.',
        full: 'Common classes include terrestrial (rocky), gas giant, ice giant, and super-Earth. In GalaxyQuest, we use extended classes like "lava world," "desert," "ocean," and "ice world" based on surface conditions and composition.',
        wikipedia: 'https://en.wikipedia.org/wiki/Exoplanet',
        arxiv: 'https://arxiv.org/abs/1710.03842'
    },
    'planetary_composition': {
        term: 'Planetary Composition',
        category: 'Planetary Properties',
        short: 'The material makeup of a planet: silicate, iron, water ice, ammonia, methane, or mixed.',
        full: 'Terrestrial planets are typically silicate-iron bodies similar to Earth. Ice and gas planets contain volatile compounds (H₂O, NH₃, CH₄). Composition evolves during formation and affects surface gravity, interior heat, magnetic field strength, and habitability.',
        wikipedia: 'https://en.wikipedia.org/wiki/Composition_of_exoplanets',
        arxiv: 'https://arxiv.org/abs/1504.04179'
    },
    'habitability_score': {
        term: 'Habitability Score',
        category: 'Planetary Habitability',
        short: 'A composite metric (0–100) rating a planet\'s potential to support complex life.',
        full: 'Factors include liquid water presence, atmospheric composition, temperature stability, radiation protection, and chemical diversity. In GalaxyQuest, this is calculated from temperature, pressure, atmosphere, surface gravity, and magnetic field estimates.',
        wikipedia: 'https://en.wikipedia.org/wiki/Planetary_habitability',
        arxiv: 'https://arxiv.org/abs/1310.5191'
    },
    'bond_albedo': {
        term: 'Bond Albedo',
        category: 'Planetary Properties',
        short: 'The fraction of total incident solar energy reflected or radiated by a planet to space.',
        full: 'Bond albedo ranges from 0 (black body) to 1 (perfect reflector). It depends on clouds, surface color, and atmospheric composition. Earth\'s Bond albedo is ~0.306; high-albedo planets (e.g., Venus) reflect more heat and remain cooler despite high solar flux.',
        wikipedia: 'https://en.wikipedia.org/wiki/Albedo',
        arxiv: 'https://arxiv.org/abs/1903.11071'
    },
    'equilibrium_temperature': {
        term: 'Equilibrium Temperature',
        category: 'Planetary Climate',
        short: 'The theoretical temperature a planet would achieve if it absorbed solar radiation efficiently and radiated thermal energy into space.',
        full: 'Calculated as T_eq = (L_star / 4πd²)^0.25 (1 - A)^0.25 where d is orbital distance and A is Bond albedo. This ignores atmospheric effects and assumes fast radiative equilibrium.',
        wikipedia: 'https://en.wikipedia.org/wiki/Equilibrium_temperature',
        arxiv: 'https://arxiv.org/abs/1209.5989'
    },
    'runaway_greenhouse': {
        term: 'Runaway Greenhouse Effect',
        category: 'Planetary Climate',
        short: 'A condition where water evaporates, enhancing greenhouse warming until all surface water is lost.',
        full: 'Strong radiation (common near hot stars) causes oceans to evaporate. Water vapor is a potent greenhouse gas, raising temperatures further and accelerating evaporation. The inner boundary of the habitable zone is defined by this runaway threshold.',
        wikipedia: 'https://en.wikipedia.org/wiki/Runaway_greenhouse_effect',
        arxiv: 'https://arxiv.org/abs/1301.6674'
    },
    'binary_system': {
        term: 'Binary Star System',
        category: 'Stellar Dynamics',
        short: 'A stellar system where two stars orbit a common barycenter (center of mass).',
        full: 'Binary systems are common in the Milky Way and strongly influence planetary orbit stability. In circumbinary configurations, planets orbit both stars and must remain outside a critical inner radius (Holman-Wiegert criterion) to avoid chaotic destabilization.',
        wikipedia: 'https://en.wikipedia.org/wiki/Binary_star',
        arxiv: 'https://arxiv.org/abs/1302.6254'
    },
    'transit_method': {
        term: 'Transit Method',
        category: 'Exoplanet Detection',
        short: 'A technique to detect exoplanets by measuring the slight dimming of starlight as a planet crosses in front of its star.',
        full: 'When a planet transits its host star, it blocks ~0.01% of the star\'s light. By monitoring this dip, astronomers can determine orbital period, radius, and (via spectroscopy) atmospheric composition. This is how most confirmed exoplanets have been discovered.',
        wikipedia: 'https://en.wikipedia.org/wiki/Transit_method',
        arxiv: 'https://arxiv.org/abs/1001.2010'
    }
};

/**
 * Opens the glossary modal with RAG-enhanced LLM definitions
 */
function openGlossaryModal() {
    const backdrop = document.createElement('div');
    backdrop.className = 'glossary-backdrop';
    backdrop.addEventListener('click', () => backdrop.remove());

    const modal = document.createElement('div');
    modal.className = 'glossary-modal';
    
    let html = `
        <div class="glossary-header">
            <h2>Scientific Glossary <span class="glossary-header-badge">with AI</span></h2>
            <button class="glossary-close">&times;</button>
        </div>
        <div class="glossary-search">
            <input type="text" id="glossary-search-input" placeholder="Search terms..." />
            <span class="glossary-info-icon" title="Definitions enhanced by Ollama LLM + Wikipedia RAG">🤖</span>
        </div>
        <div class="glossary-content">
    `;

    // Build glossary entries
    for (const [key, entry] of Object.entries(GLOSSARY_TERMS)) {
        html += `
            <div class="glossary-entry" data-term="${key}" data-category="${entry.category}">
                <div class="glossary-entry-header">
                    <h3>${entry.term}</h3>
                    <span class="glossary-category">${entry.category}</span>
                    <span class="glossary-loading" style="display:none;">✨ Loading AI...</span>
                </div>
                <p class="glossary-short">${entry.short}</p>
                <p class="glossary-full glossary-full-static">${entry.full}</p>
                <p class="glossary-full glossary-full-ai" style="display:none; color: #00d4ff; font-style: italic;"></p>
                <div class="glossary-links">
                    <a href="${entry.wikipedia}" target="_blank" rel="noopener">📖 Wikipedia</a>
                    ${entry.arxiv ? `<a href="${entry.arxiv}" target="_blank" rel="noopener">📄 ArXiv Paper</a>` : ''}
                    <button class="glossary-btn-ai" data-term="${key}">🤖 AI Enhanced</button>
                </div>
            </div>
        `;
    }

    html += `
        </div>
    `;

    modal.innerHTML = html;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Attach event listeners
    const closeBtn = modal.querySelector('.glossary-close');
    closeBtn.addEventListener('click', () => backdrop.remove());

    const searchInput = modal.querySelector('#glossary-search-input');
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        const entries = modal.querySelectorAll('.glossary-entry');
        entries.forEach(entry => {
            const term = entry.getAttribute('data-term').toLowerCase();
            const category = entry.getAttribute('data-category').toLowerCase();
            const text = entry.textContent.toLowerCase();
            if (term.includes(query) || category.includes(query) || text.includes(query)) {
                entry.style.display = 'block';
            } else {
                entry.style.display = 'none';
            }
        });
    });

    // Load LLM-enhanced definitions in background
    setTimeout(() => {
        modal.querySelectorAll('[data-term]').forEach(entry => {
            const termKey = entry.getAttribute('data-term');
            loadLLMDefinition(entry, termKey);
        });
    }, 500);

    // Attach AI button listeners
    modal.querySelectorAll('.glossary-btn-ai').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const termKey = btn.getAttribute('data-term');
            const entry = btn.closest('.glossary-entry');
            toggleAIDefinition(entry, termKey);
        });
    });

    // Focus search input for immediate typing
    searchInput.focus();
}

// Expose globally for UI triggers
window.openGlossaryModal = openGlossaryModal;

/**
 * Load LLM-enhanced definition in background
 */
async function loadLLMDefinition(entry, termKey) {
    const loading = entry.querySelector('.glossary-loading');
    const aiText = entry.querySelector('.glossary-full-ai');
    
    if (!aiText) return;

    try {
        loading.style.display = 'inline-block';
        loading.textContent = '✨ Loading AI...';
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);  // 30s timeout
        
        const response = await fetch(
            `/api/glossary.php?action=generate&term=${encodeURIComponent(termKey)}`,
            { 
                credentials: 'include',
                signal: controller.signal 
            }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
            const error = await response.json().catch(() => ({}));
            console.warn(`API error ${response.status}:`, error.message);
            loading.textContent = `⚠️ Failed (${response.status})`;
            loading.style.color = '#ff8866';
            return;
        }

        const data = await response.json();
        if (data.full) {
            aiText.textContent = data.full;
            aiText.dataset.source = data.source || 'ollama';
            loading.style.display = 'none';
            
            // Show "AI Enhanced" button as success indicator
            const btn = entry.querySelector('.glossary-btn-ai');
            if (btn) {
                btn.classList.add('glossary-btn-ai-ready');
                const source = data.source === 'ollama_rag' ? 'Ollama + Wikipedia' : 'Cache';
                btn.title = `Enhanced by ${source} • ${data.generated_at ? new Date(data.generated_at).toLocaleDateString() : 'cached'}`;
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            loading.textContent = '⏱️ Timeout (30s)';
            loading.style.color = '#ff9944';
            console.warn(`LLM generation timeout for ${termKey}`);
        } else {
            loading.textContent = '🔌 Offline';
            loading.style.color = '#ff6666';
            console.warn(`Failed to load AI definition for ${termKey}:`, error);
        }
    }
}

/**
 * Toggle between static and AI definition
 */
function toggleAIDefinition(entry, termKey) {
    const staticDef = entry.querySelector('.glossary-full-static');
    const aiDef = entry.querySelector('.glossary-full-ai');
    const btn = entry.querySelector('.glossary-btn-ai');
    
    if (!aiDef.textContent) {
        // Load if not yet loaded
        loadLLMDefinition(entry, termKey);
        return;
    }

    const isShowingAI = aiDef.style.display !== 'none';
    
    if (isShowingAI) {
        // Show static
        staticDef.style.display = 'block';
        aiDef.style.display = 'none';
        btn.classList.remove('glossary-btn-ai-active');
    } else {
        // Show AI
        staticDef.style.display = 'none';
        aiDef.style.display = 'block';
        btn.classList.add('glossary-btn-ai-active');
    }
}
