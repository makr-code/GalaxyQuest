# GalaxyQuest - Fraktions-Beispiele fuer KI-3D-Generierung

Status: draft v1.0
Version: 1.0
Stand: 2026-04-02
Bezug: FACTION_3D_OBJECT_DESIGN_LANGUAGE.md, models/schema/gq-faction-object.schema.json

---

## 1. Nutzung

Dieses Dokument liefert sofort nutzbare Beispielauftraege fuer die Kernfraktionen.
Jeder Auftrag besteht aus:

1. Prompt-Block fuer das KI-System
2. Minimal-Template als valides Start-JSON

Hinweis:
1. Templates sind bewusst kompakt und sollen durch die KI erweitert werden.
2. Alle Beispiele nutzen designLanguageVersion = egl-1.0.

---

## 2. Vor'Tak - ship / destroyer

### 2.1 Prompt

```text
Generate a Three.js Object JSON model for GalaxyQuest.
faction_code: vor_tak
object_class: ship
archetype: destroyer
style intent:
- heavy forward wedge silhouette
- armored dorsal spine
- jaw-like front bridge
- dark metal + bronze accents
constraints:
- allowed geometries: BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, RingGeometry, OctahedronGeometry
- primitive budget: 12-24
- include clips: idle_, active_, alert_
- include gqModelSemantics with at least 2 silhouetteTags and 2 signatureParts
output:
- one valid JSON object only
```

### 2.2 Minimal-Template

```json
{
  "metadata": { "version": 4.6, "type": "Object", "generator": "GalaxyQuest Faction 3D Gen" },
  "modelId": "vor_tak_destroyer_a",
  "label": "Vor'Tak Destroyer A",
  "version": 1,
  "scale": 1,
  "lod": { "segments_full": 20, "segments_low": 10 },
  "geometries": [
    { "uuid": "geo_hull_1", "type": "CylinderGeometry", "radiusTop": 0.2, "radiusBottom": 0.6, "height": 3.1, "radialSegments": 10 },
    { "uuid": "geo_spine_1", "type": "BoxGeometry", "width": 0.25, "height": 0.35, "depth": 2.3 }
  ],
  "materials": [
    { "uuid": "mat_hull_1", "type": "MeshStandardMaterial", "color": 1717069, "emissive": 1315860, "metalness": 0.72, "roughness": 0.38 },
    { "uuid": "mat_armor_1", "type": "MeshStandardMaterial", "color": 9145227, "emissive": 1775894, "metalness": 0.78, "roughness": 0.44 }
  ],
  "animations": [
    { "name": "idle_pitch", "duration": 3.2, "tracks": [{ "name": "vor_tak_destroyer_a.rotation[z]", "type": "number", "times": [0, 1.6, 3.2], "values": [-0.02, 0.02, -0.02], "interpolation": 2301 }] },
    { "name": "active_drive", "duration": 2.4, "tracks": [{ "name": "mesh_spine_1.scale[y]", "type": "number", "times": [0, 1.2, 2.4], "values": [1, 1.08, 1], "interpolation": 2301 }] },
    { "name": "alert_hard_turn", "duration": 1.8, "tracks": [{ "name": "vor_tak_destroyer_a.rotation[y]", "type": "number", "times": [0, 0.9, 1.8], "values": [0, 0.12, 0], "interpolation": 2301 }] }
  ],
  "object": {
    "uuid": "obj_root",
    "type": "Group",
    "name": "vor_tak_destroyer_a",
    "userData": {
      "gqModelSemantics": {
        "factionCode": "vor_tak",
        "objectClass": "ship",
        "archetype": "destroyer",
        "designLanguageVersion": "egl-1.0",
        "silhouetteTags": ["forward_wedge", "armored_spine"],
        "signatureParts": ["jaw_bridge", "dorsal_spine"]
      },
      "designIntent": "Frontlastiger Keilrumpf mit militaerischer Panzerwirkung.",
      "recognitionHints": ["wedge", "spine", "bronze"],
      "gqAnimations": []
    },
    "children": [
      { "uuid": "mesh_hull_1", "type": "Mesh", "name": "mesh_hull_1", "geometry": "geo_hull_1", "material": "mat_hull_1", "rotation": [1.5708, 0, 0], "userData": { "role": "hull" } },
      { "uuid": "mesh_spine_1", "type": "Mesh", "name": "mesh_spine_1", "geometry": "geo_spine_1", "material": "mat_armor_1", "position": [0, 0.26, 0.2], "userData": { "role": "spine" } }
    ]
  }
}
```

---

## 3. Syl'Nar - station / orbital_sanctum

### 3.1 Prompt

```text
Generate a Three.js Object JSON station model for GalaxyQuest.
faction_code: syl_nar
object_class: station
archetype: orbital_sanctum
style intent:
- flowing circular silhouette
- tentacle-like halo structures
- translucent bioluminescent materials
constraints:
- primitive budget: 18-40
- include idle, active, alert animations
- preserve readable profile at 10% scale
output: one valid JSON object
```

### 3.2 Minimal-Template

```json
{
  "metadata": { "version": 4.6, "type": "Object", "generator": "GalaxyQuest Faction 3D Gen" },
  "modelId": "syl_nar_orbital_sanctum_a",
  "label": "Syl'Nar Orbital Sanctum A",
  "version": 1,
  "scale": 1,
  "lod": { "segments_full": 28, "segments_low": 12 },
  "geometries": [
    { "uuid": "geo_halo_1", "type": "TorusGeometry", "radius": 2.1, "tube": 0.28, "radialSegments": 10, "tubularSegments": 28 },
    { "uuid": "geo_core_1", "type": "SphereGeometry", "radius": 0.82, "widthSegments": 14, "heightSegments": 12 }
  ],
  "materials": [
    { "uuid": "mat_halo_1", "type": "MeshStandardMaterial", "color": 2181260, "emissive": 5308415, "metalness": 0.22, "roughness": 0.2, "transparent": true, "opacity": 0.86 },
    { "uuid": "mat_core_1", "type": "MeshStandardMaterial", "color": 6911999, "emissive": 9234175, "metalness": 0.1, "roughness": 0.18, "transparent": true, "opacity": 0.9 }
  ],
  "animations": [
    { "name": "idle_halo_drift", "duration": 6, "tracks": [{ "name": "mesh_halo_1.rotation[y]", "type": "number", "times": [0, 6], "values": [0, 6.2831853072], "interpolation": 2301 }] },
    { "name": "active_lumen_pulse", "duration": 2.4, "tracks": [{ "name": "mesh_core_1.scale[x]", "type": "number", "times": [0, 1.2, 2.4], "values": [1, 1.08, 1], "interpolation": 2301 }] },
    { "name": "alert_tide_surge", "duration": 2.1, "tracks": [{ "name": "mesh_core_1.scale[y]", "type": "number", "times": [0, 1.05, 2.1], "values": [1, 1.14, 1], "interpolation": 2301 }] }
  ],
  "object": {
    "uuid": "obj_root",
    "type": "Group",
    "name": "syl_nar_orbital_sanctum_a",
    "userData": {
      "gqModelSemantics": {
        "factionCode": "syl_nar",
        "objectClass": "station",
        "archetype": "orbital_sanctum",
        "designLanguageVersion": "egl-1.0",
        "silhouetteTags": ["flowing_orbit", "halo_tentacles"],
        "signatureParts": ["lumen_veins", "tide_fins"]
      },
      "designIntent": "Biolumineszente Ringstruktur mit fluider Mystik-Anmutung.",
      "recognitionHints": ["halo", "translucent", "bioluminescence"],
      "gqAnimations": []
    },
    "children": [
      { "uuid": "mesh_halo_1", "type": "Mesh", "name": "mesh_halo_1", "geometry": "geo_halo_1", "material": "mat_halo_1", "rotation": [1.5708, 0, 0], "userData": { "role": "halo" } },
      { "uuid": "mesh_core_1", "type": "Mesh", "name": "mesh_core_1", "geometry": "geo_core_1", "material": "mat_core_1", "userData": { "role": "core" } }
    ]
  }
}
```

---

## 4. Aereth - relay_or_sensor / phase_array

### 4.1 Prompt

```text
Generate a Three.js Object JSON relay model for GalaxyQuest.
faction_code: aereth
object_class: relay_or_sensor
archetype: phase_array
style intent:
- spear-like energy geometry
- crystal axis and arc emitters
- clean high-tech profile
constraints:
- primitive budget: 10-24
- include idle, active, alert clips
output: one valid JSON object
```

---

## 5. Kryl'Tha - base / brood_fortress

### 5.1 Prompt

```text
Generate a Three.js Object JSON base model for GalaxyQuest.
faction_code: kryl_tha
object_class: base
archetype: brood_fortress
style intent:
- segmented chitin shell
- asymmetric growth silhouette
- visible brood chambers
constraints:
- primitive budget: 16-36
- include idle, active, alert clips
output: one valid JSON object
```

---

## 6. Zhareen - building / archive_spire

### 6.1 Prompt

```text
Generate a Three.js Object JSON building model for GalaxyQuest.
faction_code: zhareen
object_class: building
archetype: archive_spire
style intent:
- faceted crystal tower
- high symmetry and vertical elegance
- refractive shard petals
constraints:
- primitive budget: 8-20
- include idle, active, alert clips
output: one valid JSON object
```

---

## 7. Vel'Ar - ship / cloak_frigate

### 7.1 Prompt

```text
Generate a Three.js Object JSON ship model for GalaxyQuest.
faction_code: vel_ar
object_class: ship
archetype: cloak_frigate
style intent:
- narrow stealth silhouette
- veil wings and mask nodes
- fog-like emissive channels
constraints:
- primitive budget: 10-22
- include idle, active, alert clips
output: one valid JSON object
```

---

## 8. Schnellcheck nach Generierung

1. JSON gegen models/schema/gq-faction-object.schema.json validieren.
2. ObjectLoader-Parse testen.
3. Sichttest in 10% Skalierung fuer Fraktionslesbarkeit.
4. Performancecheck fuer Primitive- und Material-Budget.

CLI:

```bash
npm run validate:models:faction
```

Einzeldatei:

```bash
node scripts/validate_faction_model_json.mjs models/space_station.json
```

Strikter Modus (erzwingt gqModelSemantics fuer alle Modelle):

```bash
node scripts/validate_faction_model_json.mjs --strict
```

---

## 9. Prompt-Matrix fuer alle Fraktionen (Kurzform)

Fuer schnelle Batch-Generierung kann folgende Kurzform verwendet werden:

```text
Generate a Three.js Object JSON model for GalaxyQuest.
faction_code: <code>
object_class: <ship|station|base|building|defense_platform|relay_or_sensor>
archetype: <archetype>
design_language: egl-1.0
signature_parts: <comma-separated>
silhouette_tags: <comma-separated>
allowed_geometries: BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, RingGeometry, OctahedronGeometry
must_include: gqModelSemantics, idle_*, active_*, alert_*
output: one valid JSON object only
```

| faction_code | silhouette_tags | signature_parts |
|---|---|---|
| vor_tak | forward_wedge, armored_spine | jaw_bridge, dorsal_spine, armor_scales |
| syl_nar | flowing_orbit, halo_tentacles | lumen_veins, tide_fins |
| aereth | spear_axis, crystal_stream | prism_core, arc_emitters |
| kryl_tha | segmented_shell, swarm_node | brood_chambers, claw_prows |
| zhareen | faceted_symmetry, prism_cluster | memory_spires, shard_rings |
| vel_ar | narrow_veil, stealth_asymmetry | veil_wings, mask_nodes |
| aethernox | monolith_axis, balance_rings | ward_monolith, anchor_pylons |
| architekten_des_lichts | sanctum_axis, ritual_halo | lumen_arches, sanctum_spires |
| brut_der_ewigkeit | biomorph_mass, asym_growth | brood_sacs, maw_ports |
| echos_der_leere | broken_profile, negative_volume | void_fissures, echo_shards |
| helion_confederation | modular_tradeframe, cargo_spine | trade_rings, docking_braids |
| iron_fleet | blocky_ram, armored_front | ram_prow, gun_casemates |
| ketzer_von_verath | corrupted_curves, ritual_break | blaspheme_halo, heretic_core |
| khar_morr_syndicate | patchwork_hull, scavenger_mods | hook_prows, smuggler_pods |
| myr_keth | morph_swarm, lattice_shell | seed_nodes, morph_spines |
| nomaden_des_rifts | rift_spindle, drift_rings | fold_vanes, rift_spines |
| omniscienta | recursive_symmetry, algorithmic_grid | logic_obelisks, solver_rings |

---

## 10. Referenzdatei fuer Light + Maps

Als direkte Vorlage fuer erweiterte Rendering-Features steht folgende Datei bereit:

1. models/faction_lit_reference.json

Enthaelt:

1. lokale Light-Node (PointLight)
2. MeshPhongMaterial mit specular + shininess
3. bumpMap + normalMap + specularMap
4. emissiveMap/roughnessMap/metalnessMap auf MeshStandardMaterial

---

## 11. Startset fuer 13 NPC-Fraktionen

Das Startset liegt in:

1. models/faction_starter/

Dateien:

1. models/faction_starter/aethernox_starter_node.json
2. models/faction_starter/khar_morr_syndicate_starter_node.json
3. models/faction_starter/helion_confederation_starter_node.json
4. models/faction_starter/iron_fleet_starter_node.json
5. models/faction_starter/omniscienta_starter_node.json
6. models/faction_starter/myr_keth_starter_node.json
7. models/faction_starter/echos_der_leere_starter_node.json
8. models/faction_starter/ketzer_von_verath_starter_node.json
9. models/faction_starter/architekten_des_lichts_starter_node.json
10. models/faction_starter/nomaden_des_rifts_starter_node.json
11. models/faction_starter/brut_der_ewigkeit_starter_node.json
12. models/faction_starter/schattenkompakt_starter_node.json
13. models/faction_starter/genesis_kollektiv_starter_node.json

Eigenschaften aller Startermodelle:

1. gqModelSemantics pro Fraktion (egl-1.0)
2. lokales PointLight
3. MeshPhongMaterial mit specular/shininess
4. bumpMap + normalMap + specularMap
5. idle_/active_/alert_ Animationen
6. gqVfxEmitters (thruster + muzzle)
7. gqWeaponFx (beam)

VFX-Contract (Kurzform):

```json
{
  "gqVfxEmitters": [
    {
      "id": "thruster_main",
      "kind": "thruster",
      "mode": "continuous",
      "attachTo": "mesh_engine_1",
      "position": [0, 0, -1.2],
      "direction": [0, 0, -1],
      "count": 28,
      "lifetime": 0.5,
      "speed": 7,
      "spread": 0.22,
      "colorStart": 16763904,
      "colorEnd": 3355647
    }
  ],
  "gqWeaponFx": [
    {
      "id": "beam_primary",
      "kind": "beam",
      "from": "muzzle_primary",
      "to": "target",
      "coreColor": 16724787,
      "glowColor": 8965375,
      "glowRadius": 0.18,
      "alpha": 0.9
    }
  ]
}
```
