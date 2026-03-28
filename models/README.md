# GalaxyQuest - 3D Model Format

Models are stored in Three.js Object JSON format (metadata.type = Object).
The renderer loads them via api/model_gen.php?type=<id> and parses them
with THREE.ObjectLoader.

---

## Primary Structure

```jsonc
{
  "metadata": { "version": 4.6, "type": "Object" },
  "modelId": "stargate",
  "label": "Stargate",
  "version": 2,
  "scale": 1,
  "lod": { "segments_full": 64, "segments_low": 24 },
  "images": [
    { "uuid": "img_panel", "url": "models/textures/panel_grid.svg" }
  ],
  "textures": [
    { "uuid": "tex_panel", "image": "img_panel", "wrap": [1000, 1000], "repeat": [2, 1] }
  ],
  "geometries": [
    { "uuid": "geo_ring", "type": "TorusGeometry", "radius": 3, "tube": 0.25, "radialSegments": 16, "tubularSegments": 64 }
  ],
  "materials": [
    { "uuid": "mat_ring", "type": "MeshStandardMaterial", "color": 4487423, "map": "tex_panel" }
  ],
  "animations": [
    {
      "name": "native_spin",
      "duration": 4,
      "tracks": [
        {
          "name": "ring.rotation[y]",
          "type": "number",
          "times": [0, 4],
          "values": [0, 6.2831853072],
          "interpolation": 2301
        }
      ]
    }
  ],
  "object": {
    "uuid": "obj_root",
    "type": "Group",
    "userData": {
      "gqAnimations": [
        { "target": "root", "property": "rotation.y", "type": "linear", "speed": 0.4 }
      ]
    },
    "children": [
      { "uuid": "mesh_ring", "type": "Mesh", "geometry": "geo_ring", "material": "mat_ring" }
    ]
  }
}
```

---

## Supported Geometry Types

Supported in current models:

- BoxGeometry
- SphereGeometry
- CylinderGeometry
- TorusGeometry
- RingGeometry
- OctahedronGeometry

---

## Animation Metadata

Animation descriptors are stored in object.userData.gqAnimations.

- linear: value += dt * speed
- sine: value = base + sin(elapsed * 2pi * frequency) * amplitude

## Native Animation Clips

Optional native clips can be provided in the top-level animations array
using Three.js AnimationClip JSON.

- Parsed with THREE.AnimationClip.parse
- Played via THREE.AnimationMixer per instantiated model clone
- Can be combined with gqAnimations (custom lightweight runtime animations)
- Clip naming convention supports runtime state selection:
  - `idle_*` for passive ambient motion
  - `active_*` for online/operational mode
  - `alert_*` for threat/critical visuals
- Runtime state policy in galaxy renderer:
  - Threat score from nearby fleet missions (`attack`, `spy`, `colonize`)
  - Type-specific sensitivity (e.g. `jump_inhibitor` escalates earlier than `relay_station`)
  - State flips only on change to avoid unnecessary animation mixer resets
- All built-in GalaxyQuest models currently ship with an `idle`, `active`,
  and `alert` native clip.

---

## Integration

ModelRegistry supports both:

- Preferred: Three.js Object JSON (this format)
- Legacy: primitive descriptor format (fallback compatibility)

---

## Available Models

| File                    | ID                 | Used for                                  |
|-------------------------|--------------------|-------------------------------------------|
| stargate.json           | stargate           | Stargate star-orbit installation          |
| relay_station.json      | relay_station      | Relay station / comms hub                 |
| jump_inhibitor.json     | jump_inhibitor     | Jump-inhibitor platform                  |
| deep_space_radar.json   | deep_space_radar   | Deep-space radar array                    |
| space_station.json      | space_station      | Generic orbital station (hub + arms)      |
| transport_shuttle.json  | transport_shuttle  | Ambient transport vessel                  |
