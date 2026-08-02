<?php
/**
 * Ship Component Prompt Library
 * 
 * Strukturierte Prompts für konsistente 3D-Geometrie und Texturen
 * - Detaillierte Geometrie-Spezifikationen (Panels, Kanten, Details)
 * - Material- und Texture-Beschreibungen (PBR, Wear, Patina)
 * - Fraktions-spezifische Ästhetik
 * 
 * File: api/ship_component_prompts.php
 */

declare(strict_types=1);

// ────────────────────────────────────────────────────────────────────────────

/**
 * Zentrale Prompt-Bibliothek für 3D-Schiff-Komponenten
 */
final class ShipComponentPromptLibrary {
    
    /**
     * Hull Prompts mit spezifischen Geometrie-Anforderungen
     */
    private static array $HULL_PROMPTS = [
        'vor_tak' => [
            'geometry' => <<<'GEOM'
HULL GEOMETRY SPECIFICATION – Vor'Tak Faction
═════════════════════════════════════════════

Silhouette Style: WEDGE + ARMORED
Base Form: Angular, front-heavy wedge with reinforced bow section

Panel Layout (REQUIRED):
• Center spine running bow-to-stern (recessed line, ~4mm depth)
• Port/starboard hull plates arranged in overlapping rows
• Each plate has beveled edge (2-3mm chamfer) for structural emphasis
• Longitudinal ribbing: 8-12 ribs, evenly spaced along fuselage

Detail Elements:
□ Bow section: Aggressive angular cuts, converging panels toward point
□ Mid-section: Bulging slightly outward (0.5% scale increase) for weapon hardpoints
□ Stern: Tapers to engine mount junction, 3x port/starboard fins

Specific geometry:
- Primary polygon budget: 4000-5000 triangles (corvette scale)
- Symmetry: Bilateral (left-right mirror)
- Central ridge: Slight keel line 10% below centerline
- Panel intersections: Hard creases (90° angles), no smoothing
- Weapon hardpoints: 3 visible mounting plates (top, starboard, port)

Avoid:
✗ Rounded edges (Vor'Tak is angular and aggressive)
✗ Smooth curves (use straight line segments instead)
✗ Organic flowing forms (this is military hardware)
✗ Large flat panels (break up with substructure details)
GEOM,
            'texture' => <<<'TEX'
TEXTURE SPECIFICATION – Vor'Tak Faction
════════════════════════════════════════

Base Material: Weathered Metal Plating
Color: Dark metallic (RGB: 139, 69, 19 / #8B4513) with bronze accents

PBR Map Requirements:
┌─────────────────────────────────────────────┐
│ ALBEDO (Diffuse Color Map)                  │
├─────────────────────────────────────────────┤
│ Primary: #5C3317 (dark brown-bronze)        │
│ Panel seams: #3A2010 (darker recesses)      │
│ Accent edges: #A67B5B (lighter bronze)      │
│ Wear areas: #7A6050 (lighter exposure)      │
│ Rust patches: #8B5A2B (reddish-brown)       │
└─────────────────────────────────────────────┘

METALLIC MAP:
• Metal panels: 0.9 (high metallic)
• Seams/recesses: 0.4 (semi-metallic)
• Worn edges: 0.7 (intermediate metallic)
• Rust patches: 0.2 (low metallic, oxidized)

ROUGHNESS MAP:
• Polished surfaces: 0.3 (shiny)
• Standard hull: 0.6 (medium roughness)
• Worn/weathered: 0.8 (rough texture)
• Rust areas: 0.9 (very rough)

NORMAL MAP DETAILS:
• Panel seams: Recessed grooves (depth ~2mm at game scale)
• Rivet patterns: Circular indents, scattered across hull
• Micro-scratches: Linear scratch patterns running longitudinally
• Impact damage: Random dents and deformation marks
• Corrosion pitting: Fine pitting pattern in rust zones

Surface Details:
▪ Panel lines: Sharp creases with shadow emphasis
▪ Rivets: Circular metal fasteners, ~1mm diameter each
▪ Weathering: Salt corrosion stains, darker near edges
▪ Wear: Scuff marks and impact scoring on exposed edges
▪ Paint variations: Faded areas where paint has chipped
▪ Patina: Green/teal oxidation in recessed areas

Wear Pattern Strategy:
1. Edges & corners: Heavy wear (80% opacity)
2. Top surfaces: Medium wear (50% opacity)
3. Protected recesses: Minimal wear (20% opacity)
4. Strategic damage: 3-5 impact zones with raised metal rim

Emission (Optional):
• Main hull: No emission (0.0)
• Damage scars: Faint glow if hot (0.05 in red channel)
• Running lights: Separate texture layer (not in main hull)
TEX,
            'assembly' => <<<'ASSEM'
ASSEMBLY SPECIFICATION – Vor'Tak Hull
══════════════════════════════════════

Component Integration Points:
┌────────────┬──────────────┬────────────────────┐
│ Component  │ Location     │ Integration Type   │
├────────────┼──────────────┼────────────────────┤
│ Engines    │ Stern (2x)   │ Flush-mounted      │
│ Weapons    │ Top/Port     │ Ball-turret mount  │
│ Shields    │ Bow/Sides    │ Flush-mounted      │
│ Sensors    │ Top-center   │ Pod attachment     │
│ Landing    │ Ventral      │ Bay door (hidden)  │
└────────────┴──────────────┴────────────────────┘

Mounting Surfaces:
• Engine mount: Tapered cone junction, 100mm diameter
• Weapon turret: Raised platform, 80mm height
• Shield generator: Flush recess, 60mm deep
• Sensor: Dorsal pod, 120mm height

Orientation Constraints:
→ Forward vector: Positive X-axis (bow points +X)
→ Up vector: Positive Z-axis (top points +Z)
→ Starboard vector: Positive Y-axis

Scale Reference: 60 meters nose-to-tail (for corvette class)
ASSEM,
        ],
        
        'syl_nar' => [
            'geometry' => <<<'GEOM'
HULL GEOMETRY SPECIFICATION – Syl'Nar Faction
═════════════════════════════════════════════

Silhouette Style: FLOWING CURVES + ORGANIC
Base Form: Streamlined bio-inspired form with curved surfaces

Panel Layout (REQUIRED):
• Continuous flowing surface with minimal hard edges
• Longitudinal ridges (tentacle-like ribbing): 6-8 organic curves
• Curved panels arranged radially around central axis
• Organic bulges and indentations (not symmetrical)

Detail Elements:
□ Bow section: Tapering cone with subtle lobes
□ Mid-section: Undulating curvature, 3D S-curves along length
□ Stern: Multiple finlets extending from main body
□ Appendages: 2-4 flexible-looking sensor tentacles

Specific geometry:
- Primary polygon budget: 4500-5500 triangles (corvette scale)
- Symmetry: Radial with bilateral asymmetry allowed
- Central axis: Flowing S-curve (10-15% deviation from centerline)
- Panel intersections: Smooth transitions (curved blends)
- Organic detail: Bulging chambers visible under translucent sections

Avoid:
✗ Hard angular cuts (use smooth curves instead)
✗ Symmetrical layouts (embrace organic asymmetry)
✗ Military/geometric appearance
✗ Flat panel designs

Surface Characteristics:
• Bulging sections: 15-20% volume increase in mid-body
• Translucent areas: 2-3 light-emitting chambers visible
• Flexible-looking appendages: Curved tendrils extending from body
• Organic texture: Pseudo-biological panel pattern
GEOM,
            'texture' => <<<'TEX'
TEXTURE SPECIFICATION – Syl'Nar Faction
════════════════════════════════════════

Base Material: Bioluminescent Organic Shell
Color: Deep ocean blue (RGB: 65, 105, 225 / #4169E1) with cyan accents

PBR Map Requirements:
┌─────────────────────────────────────────────┐
│ ALBEDO (Diffuse Color Map)                  │
├─────────────────────────────────────────────┤
│ Primary: #2E5090 (deep blue)                │
│ Recesses: #1A3050 (very dark blue)          │
│ Ridges: #5A9FD4 (lighter cyan-blue)         │
│ Bio-luminescent zones: #00FFFF (bright cyan)│
│ Wear: #7DB8E8 (light sky-blue)              │
└─────────────────────────────────────────────┘

METALLIC MAP:
• Shell surface: 0.2 (mostly non-metallic, organic)
• Ridge highlights: 0.4 (subtle metallic sheen)
• Bioluminescent areas: 0.0 (pure organic)
• Corroded sections: 0.1 (oxidized/weathered)

ROUGHNESS MAP:
• Smooth shell: 0.4 (slightly glossy)
• Ridge surfaces: 0.5 (medium)
• Damaged areas: 0.7 (rough exposure)
• Bio-luminescent zones: 0.2 (smooth, polished)

NORMAL MAP DETAILS:
• Organic ridging: Flowing curves and undulations
• Bio-luminescent veins: Glowing cracks/lines in surface
• Scale pattern: Fine overlapping scale texture
• Suction cups: Small circular indents (similar to bio-organic matter)
• Slime layer: Wet, slimy surface appearance
• Growth patterns: Random biological growth and barnacles

Emission Map (CRITICAL for Syl'Nar):
• Bio-luminescent zones: 0.8 (bright glow in cyan/blue)
• Ridge highlights: 0.2 (subtle glow)
• Running lights: Embedded into organic texture
• Vein networks: 0.6 (visible pulsating glow)

Surface Details:
▪ Bioluminescent veins: Cyan/teal glowing lines across hull
▪ Organic ridging: Smooth flowing curves, not sharp
▪ Wet appearance: Specular highlights suggesting moisture
▪ Growth/barnacles: Subtle biological growth patterns
▪ Scale overlap: Layered scale-like pattern
▪ Pulsating glow: Animation-ready emission texture

Wear Pattern Strategy:
1. Exposed ridges: Moderate wear (40% opacity)
2. Protected valleys: Minimal wear (10% opacity)
3. Active glow zones: No wear (0% - always clean)
4. Damage: Cracks revealing brighter internal glow

Special Effects:
• Translucent sections: Separate material layer (0.3 opacity)
• Bioluminescence: Animated pulsing (0.3-0.8 range)
• Ambient glow: Self-illumination when dark
TEX,
            'assembly' => <<<'ASSEM'
ASSEMBLY SPECIFICATION – Syl'Nar Hull
══════════════════════════════════════

Component Integration Points:
┌────────────┬──────────────┬────────────────────┐
│ Component  │ Location     │ Integration Type   │
├────────────┼──────────────┼────────────────────┤
│ Engines    │ Stern (2x)   │ Integrated organic │
│ Weapons    │ Flexible     │ Deployable tentacle│
│ Shields    │ Distributed  │ Bioluminescent     │
│ Sensors    │ Multiple     │ Organic bulges     │
│ Symbiont   │ Internal     │ Embedded organisms │
└────────────┴──────────────┴────────────────────┘

Mounting Surfaces:
• Engine integration: Organic tapered junction
• Weapon deployment: Flexible curved arm, 150mm reach
• Shield nodes: 3-4 distributed points along hull
• Sensor bulges: Raised organic formations
• Propulsion: Integrated into stern section

Orientation Constraints:
→ Forward vector: Positive X-axis (bow points +X)
→ Up vector: Positive Z-axis (top points +Z)
→ Starboard vector: Positive Y-axis (flexible)

Scale Reference: 60 meters nose-to-tail (for corvette class)
ASSEM,
        ],
    ];
    
    /**
     * Component-specific prompts
     */
    private static array $COMPONENT_PROMPTS = [
        'weapons' => [
            'description' => 'Weapon Turret – Hardpoint Mount',
            'geometry' => <<<'GEOM'
WEAPONS GEOMETRY SPECIFICATION
════════════════════════════════

Type: Ball turret with weapon pod
Polygon budget: 800-1200 triangles

Structure:
• Rotating ball base: 400-500 triangles
• Weapon pod: Specific to hardpoint size
  - Small: 100-200 triangles (point defense)
  - Medium: 300-400 triangles (primary weapon)
  - Large: 500-700 triangles (capital weapon)
• Mounting bracket: 100-150 triangles
• Servo motors/details: 50-100 triangles

Rotation Points:
□ Horizontal: 360° unrestricted
□ Vertical: ±45° (typical firing arc)
□ Traverse speed: Implied by geometry (no animation)

Faction Variations:
• Vor'Tak: Angular pod, heavy armor plating
• Syl'Nar: Organic bulges, fluid silhouette
GEOM,
            'texture' => <<<'TEX'
WEAPONS TEXTURE SPECIFICATION
═════════════════════════════

Match hull aesthetic:
- Vor'Tak: Dark bronze with weathering, metallic surfaces
- Syl'Nar: Bioluminescent blue with organic ridging

Weapon pod finish:
• Dark matte surface (0.1 metallic, 0.8 rough)
• Tactical markings: Subtle paint wear
• Barrel/opening: Bright interior (0.95 metallic)

Mounting bracket:
• Steel/iron appearance
• Heavy corrosion near hull junction
• Wear marks from turret rotation
TEX,
        ],
        
        'engines' => [
            'description' => 'Propulsion Module – Twin Mount',
            'geometry' => <<<'GEOM'
ENGINES GEOMETRY SPECIFICATION
═════════════════════════════════

Type: Dual thruster pods for stern mount
Polygon budget: 1000-1400 triangles per engine (2000 total)

Structure:
• Engine bell/nozzle: 600-800 triangles
• Intake manifold: 200-300 triangles
• Support struts: 100-150 triangles per engine
• Heat radiator fins: 100-150 triangles per engine

Details:
□ Nozzle geometry: Expanding bell with visible turbulence
□ Intake: Ribbed channels suggesting high-velocity flow
□ Radiator fins: Multiple thin fins for heat dissipation
□ Power conduits: Visible external tubing

Faction Variations:
• Vor'Tak: Mechanical, heavy construction, sharp nozzles
• Syl'Nar: Organic tube-like design, bioluminescent chambers
GEOM,
            'texture' => <<<'TEX'
ENGINES TEXTURE SPECIFICATION
═════════════════════════════

Engine nozzle:
• Interior: Dark red/orange (heat-damaged appearance)
• Metallic: 0.9 (shiny, metallic bell)
• Roughness: 0.4 (smooth from high temperature)
• Burnt/charred edges: Black/dark gray (from exhaust)

Intake manifold:
• Ridged texture (suction-like ribbing)
• Color gradient: Outer (hull color) → Inner (darker)
• Metallic: 0.7 (reinforced steel)
• Rust/corrosion near vents

Radiator fins:
• Pale gray/white (heat-dissipating surface)
• Metallic: 0.8 (aluminum-like)
• Roughness: 0.6 (oxidized finish)
• Dust/debris accumulation
TEX,
        ],
        
        'shields' => [
            'description' => 'Shield Generator – Energy Defense Node',
            'geometry' => <<<'GEOM'
SHIELDS GEOMETRY SPECIFICATION
═════════════════════════════════

Type: Distributed shield generator node
Polygon budget: 600-900 triangles

Structure:
• Generator core: 300-400 triangles (central active element)
• Emission array: 150-200 triangles
• Support structure: 100-150 triangles
• Capacitor/power banks: 50-100 triangles

Details:
□ Core: Slightly glowing geometric form
□ Array: Radiating elements suggesting energy projection
□ Vents: Passive cooling elements
□ Power connections: Visible conduit attachments

Faction Variations:
• Vor'Tak: Solid mechanical block, industrial appearance
• Syl'Nar: Organic bulge with bioluminescent interior
GEOM,
            'texture' => <<<'TEX'
SHIELDS TEXTURE SPECIFICATION
════════════════════════════════

Generator core:
• Emissive surface: Glowing effect (0.4-0.8 emission)
• Color: Primary faction color (blue for Syl'Nar, bronze for Vor'Tak)
• Metallic: 0.6
• Roughness: 0.3 (polished active surface)

Array elements:
• Metallic: 0.8 (shiny reflective)
• Roughness: 0.4 (precision-engineered)
• Slight wear at edges

Support structure:
• Matches hull color and finish
• Industrial/organic based on faction
TEX,
        ],
        
        'sensors' => [
            'description' => 'Sensor Array – Targeting & Scanning Pod',
            'geometry' => <<<'GEOM'
SENSORS GEOMETRY SPECIFICATION
════════════════════════════════

Type: Dorsal-mounted sensor array
Polygon budget: 500-800 triangles

Structure:
• Main pod: 300-400 triangles
• Antenna arrays: 100-150 triangles
• Rotating turret (implied): 50-100 triangles
• Cable/structural support: 50-100 triangles

Details:
□ Pod: Slightly bulging, streamlined form
□ Antennae: Multiple directional arrays
□ Receiver dishes: Parabolic surfaces
□ Targeting laser?: Optional bright element

Faction Variations:
• Vor'Tak: Rigid dish arrays, mechanical antennae
• Syl'Nar: Flexible organic tendrils, bulging sensory nodes
GEOM,
            'texture' => <<<'TEX'
SENSORS TEXTURE SPECIFICATION
══════════════════════════════

Main pod:
• Metallic: 0.7 (electromagnetic shielding)
• Roughness: 0.5
• Color: Slightly lighter than hull (for heat management)

Receiver dishes:
• Metallic: 0.95 (pristine reflective surface)
• Roughness: 0.2 (smooth, precision-engineered)
• Faint grid pattern: Mesh/screen texture

Antennae:
• Metallic: 0.8
• Roughness: 0.4
• Color: Faction-specific coating (bronze, cyan, etc.)

Targeting indicator (if present):
• Emissive: 0.3-0.5 in red channel
• Color: Bright red or faction color
TEX,
        ],
    ];
    
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Get full hull prompt (geometry + texture + assembly)
     */
    public static function getHullPrompt(string $factionCode): string {
        $specs = self::$HULL_PROMPTS[$factionCode] ?? self::$HULL_PROMPTS['vor_tak'];
        
        return <<<PROMPT
# 3D SHIP HULL GENERATION PROMPT
## Faction: {$factionCode}
## Model: TRELLIS2 Text-to-3D

---

{$specs['geometry']}

---

{$specs['texture']}

---

{$specs['assembly']}

---

## EXPORT REQUIREMENTS

Format: GLB (with embedded materials)
Scale: 60 meters reference length
Orientation: X-forward, Z-up
Geometry: Optimized for game engine import
Materials: PBR-compatible (metallic + roughness)
Textures: 2048x2048 resolution recommended

## QUALITY CRITERIA

✓ Geometry matches faction aesthetic
✓ Textures show appropriate wear/weathering
✓ Panel details are visible (no smooth blob)
✓ Component mounting points are recessed
✓ Symmetry maintained where specified
✓ Polygon count within budget (4500-5500 triangles)
✓ Tangent space normal maps included
✓ Emission maps ready for bioluminescence (if applicable)

---

Generate this 3D model with full attention to geometric detail and material authenticity.
PROMPT;
    }
    
    /**
     * Get component prompt
     */
    public static function getComponentPrompt(string $componentType, string $factionCode, string $size = 'medium'): string {
        $spec = self::$COMPONENT_PROMPTS[$componentType] ?? null;
        if (!$spec) {
            throw new \InvalidArgumentException("Unknown component type: $componentType");
        }
        
        $sizeDescriptor = match($size) {
            'small' => 'Point defense (compact, high-fire-rate)',
            'medium' => 'Primary armament (balanced, versatile)',
            'large' => 'Capital weapon (heavy, high-damage)',
            default => 'Standard configuration'
        };
        
        $factionAesthetic = match($factionCode) {
            'vor_tak' => 'Angular, armored, dark bronze with metallic accents',
            'syl_nar' => 'Organic, flowing curves, bioluminescent blue with cyan highlights',
            default => 'Standard military aesthetic'
        };
        
        return <<<PROMPT
# 3D COMPONENT GENERATION PROMPT
## Component: {$spec['description']}
## Faction: {$factionCode}
## Size: {$size} ({$sizeDescriptor})
## Model: TRELLIS2 Text-to-3D

---

## COMPONENT SPECIFICATION

Faction Aesthetic: {$factionAesthetic}

{$spec['geometry']}

---

{$spec['texture']}

---

## MATERIAL INTEGRATION

This component will be mounted on a {$factionCode} faction ship hull.
Ensure color consistency with faction primary colors:
- Vor'Tak: Dark bronze (#8B4513), silver accents
- Syl'Nar: Ocean blue (#4169E1), cyan accents (#00FFFF)

---

## EXPORT REQUIREMENTS

Format: GLB (with embedded materials)
Orientation: X-forward, Z-up, Y-starboard
Mounting point: Base of component (flat surface at Z=0)
Polygon budget: See geometry specification
Materials: PBR-compatible
Textures: 1024x1024 or 2048x2048 resolution

---

Generate a detailed, faction-authentic 3D component ready for game engine integration.
PROMPT;
    }
    
    /**
     * Get assembly prompt for combining components
     */
    public static function getAssemblyPrompt(
        string $factionCode,
        array $selectedComponents = []
    ): string {
        $componentList = implode("\n• ", array_keys($selectedComponents));
        
        return <<<PROMPT
# SHIP ASSEMBLY PROMPT
## Faction: {$factionCode}
## Customization Assembly

---

## SELECTED COMPONENTS

• {$componentList}

---

## ASSEMBLY INSTRUCTIONS

1. Load base hull (provided separately)
2. Position and mount selected components at designated hardpoints
3. Ensure visual cohesion between all elements
4. Maintain faction aesthetic throughout assembly
5. Verify all surfaces are properly textured and detailed
6. Optimize geometry for game engine (target 8000-12000 triangles total)

---

## FACTION SPECIFICATIONS

Base Hull: Canonical form (geometry + texture provided)
Component Mounting: Follow integration points defined in hull specification

---

## FINAL OUTPUT

Format: Single unified GLB mesh
All components integrated into one model
Materials baked where possible
Optimization level: Medium (game-ready but detailed)

---

Generate the final assembled ship model by integrating all components into a cohesive, game-ready 3D asset.
PROMPT;
    }
    
    /**
     * Get all geometry specifications as reference
     */
    public static function getGeometryReference(string $factionCode): array {
        return [
            'hull' => self::$HULL_PROMPTS[$factionCode]['geometry'] ?? '',
            'components' => array_map(
                fn($comp) => $comp['geometry'],
                self::$COMPONENT_PROMPTS
            ),
        ];
    }
    
    /**
     * Get all texture specifications as reference
     */
    public static function getTextureReference(string $factionCode): array {
        return [
            'hull' => self::$HULL_PROMPTS[$factionCode]['texture'] ?? '',
            'components' => array_map(
                fn($comp) => $comp['texture'],
                self::$COMPONENT_PROMPTS
            ),
        ];
    }
}

// ────────────────────────────────────────────────────────────────────────────
// API ENDPOINT: Get Prompt Specifications
// ────────────────────────────────────────────────────────────────────────────

if (basename(__FILE__) === basename($_SERVER['SCRIPT_FILENAME'] ?? '')) {
    $action = $_GET['action'] ?? '';
    
    try {
        switch ($action) {
            case 'get_hull_prompt':
                $factionCode = $_GET['faction_code'] ?? 'vor_tak';
                $prompt = ShipComponentPromptLibrary::getHullPrompt($factionCode);
                json_ok(['prompt' => $prompt, 'faction' => $factionCode]);
                break;
            
            case 'get_component_prompt':
                $componentType = $_GET['component'] ?? 'weapons';
                $factionCode = $_GET['faction_code'] ?? 'vor_tak';
                $size = $_GET['size'] ?? 'medium';
                $prompt = ShipComponentPromptLibrary::getComponentPrompt($componentType, $factionCode, $size);
                json_ok(['prompt' => $prompt, 'component' => $componentType, 'faction' => $factionCode]);
                break;
            
            case 'get_assembly_prompt':
                $factionCode = $_GET['faction_code'] ?? 'vor_tak';
                $components = json_decode($_GET['components'] ?? '[]', true);
                $prompt = ShipComponentPromptLibrary::getAssemblyPrompt($factionCode, $components);
                json_ok(['prompt' => $prompt, 'faction' => $factionCode]);
                break;
            
            case 'get_geometry_reference':
                $factionCode = $_GET['faction_code'] ?? 'vor_tak';
                $geometry = ShipComponentPromptLibrary::getGeometryReference($factionCode);
                json_ok(['geometry_specs' => $geometry]);
                break;
            
            case 'get_texture_reference':
                $factionCode = $_GET['faction_code'] ?? 'vor_tak';
                $textures = ShipComponentPromptLibrary::getTextureReference($factionCode);
                json_ok(['texture_specs' => $textures]);
                break;
            
            default:
                json_error("Unknown action: $action", 400);
        }
    } catch (\Exception $e) {
        error_log("Prompt library error: " . $e->getMessage());
        json_error("Internal server error", 500);
    }
}

?>
