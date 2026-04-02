# GalaxyQuest - Fraktionsspezifische 3D-Objekt-Designsprache

Status: draft v1.0
Version: 1.0
Stand: 2026-04-02
Bezug: GAMEDESIGN.md, VESSEL_MODULE_BLUEPRINT_DESIGN.md, models/README.md, fractions/*/spec.json

---

## 1. Ziel

Dieses Dokument definiert eine einheitliche Geometriesprache fuer KI-generierte 3D-Objekte
(Schiffe, Basen, Stationen, Gebaeude), damit:

1. Objekte visuell eindeutig einer Fraktion zuordenbar sind.
2. Alle Assets im bestehenden Three.js Object JSON Format kompatibel bleiben.
3. Die KI reproduzierbare, validierbare und performance-sichere Geometrie erzeugt.

Nicht-Ziel:
1. Kein Wechsel des Runtime-Formats (bleibt metadata.type = Object).
2. Kein Highpoly-Sculpting ausserhalb des Primitive-basierten Pipelinescope fuer v1.

---

## 2. Scope und Objektklassen

Diese Spezifikation gilt fuer folgende Objektklassen:

1. ship
2. station
3. base
4. building
5. defense_platform
6. relay_or_sensor

Pro Klasse wird ein gemeinsamer Aufbau genutzt (Silhouette -> Module -> Material -> Animation),
aber mit fraktionsspezifischer Auspraegung.

---

## 3. Einheitliche Geometriesprache (EGL - Entity Geometry Language)

### 3.1 Geometrie-Vokabular (v1 erlaubt)

Nur folgende Primitive sind fuer KI-Generierung zulaessig (kompatibel zu models/README.md):

1. BoxGeometry
2. SphereGeometry
3. CylinderGeometry
4. TorusGeometry
5. RingGeometry
6. OctahedronGeometry

Regel:
1. Komplexe Formen entstehen aus Komposition dieser Primitive (Boolean-Illusion durch Overlap/Layering).

### 3.2 Strukturgrammatik

Jedes Objekt folgt derselben Grammatik:

1. core: Hauptkoerper (Masse, Lesbarkeit in Distanz).
2. profile: Fraktions-Silhouette (Finnen, Ringe, Dornen, Schalen, Segmente).
3. function: Sichtbare Funktionsmodule (Antrieb, Sensor, Andockbereich, Waffenports).
4. signature: Fraktions-Erkennungselement (mindestens 2 markante Features).
5. motion: Idle/Active/Alert-Bewegungsmuster.

### 3.3 Geometrie- und Material-Budgets (v1)

Budget pro Instanz (LOD full):

1. Primitive Count:
   - ship: 8-28
   - station/base: 18-64
   - building: 5-20
2. Materialien: 2-6
3. Texturen: 0-3 (prozedural bevorzugt)
4. Animationstracks:
   - idle: 1-3
   - active: 1-3
   - alert: 1-4

### 3.4 Topologische Regeln

1. Silhouette zuerst: Bei 10% Skalierung muss Fraktion noch unterscheidbar sein.
2. Keine schwebenden Teile ohne visuelle Verbindung oder klaren Energietraeger.
3. Symmetriegrad je Fraktion steuern (siehe Matrix), nicht global erzwingen.
4. Harte Clipping-Ueberlappungen vermeiden (max 15% Volumenpenetration je Nachbarteil als Richtwert).

### 3.5 Rendering- und Materialsprache (erweitert)

Modelle duerfen und sollen ueber Geometrie hinaus eigene Rendering-Signaturen tragen:

1. Eigene Lichtquellen im Modell-Hierarchiebaum (z. B. PointLight, SpotLight, DirectionalLight, RectAreaLight).
2. Material-Maps fuer visuelle Lesbarkeit:
   - map (Albedo)
   - emissiveMap
   - bumpMap + bumpScale
   - normalMap (+ optional normalScale)
   - roughnessMap
   - metalnessMap
   - specularMap (insb. bei MeshPhongMaterial)
3. Materialtypen (v1):
   - MeshStandardMaterial
   - MeshPhongMaterial (fuer explizite specular/shininess-Profile)

Empfehlung fuer Performance:

1. Maximal 3 aktive Light-Nodes je Objekt-Instanz.
2. Emissive-Materialien bevorzugen, wenn ein Licht nur zur Stilerkennung dient.
3. Mehrere Maps nur einsetzen, wenn die Fraktionslesbarkeit dadurch klar steigt.

### 3.6 VFX-Emitter-Sprache (Partikel, Waffenfeuer, Triebwerke)

Modelle koennen zusaetzlich standardisierte VFX-Emitter tragen, die vom Engine-FX-Stack
(ParticleEmitter/CombatFX/BeamEffect) zur Laufzeit gelesen werden.

Pflichtkonzept:

1. Triebwerkseffekte als `thruster`-Emitter.
2. Waffenmuendungsfeuer als `muzzle`-Emitter.
3. Laser/Beam-Ausgabe als `beam`-Definition.

VFX-Emitter liegen in `object.userData.gqVfxEmitters` und sind datengetrieben.

---

---

## 4. KI-Output-Contract (3D JSON)

Die KI erzeugt IMMER valides Three.js Object JSON plus GalaxyQuest Metafelder.

### 4.1 Pflichtfelder auf Top-Level

```json
{
  "metadata": { "version": 4.6, "type": "Object", "generator": "GalaxyQuest Faction 3D Gen" },
  "modelId": "<string>",
  "label": "<string>",
  "version": 1,
  "scale": 1,
  "lod": { "segments_full": 24, "segments_low": 10 },
  "geometries": [],
  "materials": [],
  "animations": [],
  "object": {
    "uuid": "obj_root",
    "type": "Group",
    "name": "<modelId>",
    "userData": {
      "gqModelSemantics": {
        "factionCode": "vor_tak",
        "objectClass": "ship",
        "archetype": "frigate",
        "designLanguageVersion": "egl-1.0",
        "silhouetteTags": ["armored_spine", "forward_wedge"],
        "signatureParts": ["bone_plating", "jaw_bridge"]
      },
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
               "colorEnd": 3355647,
               "sizeStart": 0.16,
               "sizeEnd": 0.02
            }
         ],
         "gqWeaponFx": [
            {
               "id": "laser_primary",
               "kind": "beam",
               "from": "muzzle_l",
               "to": "target",
               "coreColor": 16724787,
               "glowColor": 8965375,
               "glowRadius": 0.18,
               "alpha": 0.9
            }
         ],
      "gqAnimations": []
    },
    "children": []
  }
}
```

### 4.2 Benennungskonvention

1. geometry UUIDs: geo_<role>_<n>
2. material UUIDs: mat_<role>_<n>
3. meshes: mesh_<role>_<n>
4. userData.role MUSS gesetzt sein (z. B. hull, ring, fin, sensor, engine, armor, spine).
5. Light-Nodes: light_<role>_<n>.

### 4.3 Validierungsregeln fuer KI-Ausgabe

1. Nur erlaubte Geometrietypen.
2. Jede Mesh-Referenz auf bestehende geometry + material UUID.
3. Kein NaN, kein Infinity, keine negativen Segmentwerte.
4. Jede Datei muss mindestens ein idle_*, active_*, alert_* Clip oder gqAnimations-Set besitzen.
5. gqModelSemantics.factionCode muss in fractions/* vorhanden sein.
6. Wenn Material-Maps gesetzt sind, muessen die referenzierten texture UUIDs existieren.
7. Light-Nodes duerfen keine ungueltigen/negativen Intensitaeten besitzen.
8. VFX-Emitter duerfen nur bekannte `kind`- und `mode`-Werte nutzen.
9. Beam-FX muessen gueltige Farb-/Alpha-/Radius-Werte besitzen.

---

## 5. Fraktions-Stilsignatur-Matrix (Erkennungsdesign)

Jede Fraktion definiert:
1. Silhouette-Logik
2. Oberflaechen-/Materialcharakter
3. Signaturbauteile (mindestens 2, ideal 3)

| faction_code | Silhouette-Regel | Materialsprache | Signaturbauteile |
|---|---|---|---|
| vor_tak | Keil + Panzergrat, massig, frontlastig | dunkles Metall, Knochenplatten, Bronzeakzente | jaw_bridge, dorsal_spine, armor_scales |
| syl_nar | weiche, fliessende Orbitalformen, tentakelartige Auslaeufer | transluzent, biolumineszent, nass-glossy | halo_tentacles, lumen_veins, tide_fins |
| aereth | schlanke Speer-/Kristallachsen, klare Energiekanal-Linien | halbtransparente Energiekerne, glasig-metallisch | prism_core, phase_blades, arc_emitters |
| kryl_tha | segmentierte Chitin-Koerper, swarm-nodes | organisch-hart, irideszentes Chitin | brood_chambers, segment_ribs, claw_prows |
| zhareen | symmetrische Prisma-Cluster, facettierte Tuerme | kristallin, lichtbrechend, sauber | memory_spires, prism_petals, shard_rings |
| vel_ar | schmale, verschleierte Formen, asymmetrische Cloak-Fluegel | matter-fog, matte Kerne + neblige Emission | veil_wings, mask_nodes, mist_chimneys |
| aethernox | monumentale Monolithen, gravimetrische Ringachsen | uraltes Stein-Metall, runische Emission | ward_monolith, balance_rings, anchor_pylons |
| architekten_des_lichts | tempelartige Geometrie, sakrale Achsen | poliertes Titan + Lichtadern | lumen_arches, sanctum_spires, ritual_halos |
| brut_der_ewigkeit | biomorphe Masse, asymmetrisch wachsend | fleischlich-chitin, pulsierende Venen | brood_sacs, maw_ports, tendon_bridges |
| echos_der_leere | gebrochene, unvollstaendige Silhouette, negative Volumen | dunkel-matt mit kalten Void-Rissen | void_fissures, echo_shards, null_halo |
| helion_confederation | modular, elegant, handelsorientiert (sichtbare Containerpfade) | sauberes Industrie-Metall, Markenakzente | cargo_spines, trade_rings, docking_braids |
| iron_fleet | brutalistisch, blockig, ueberpanzerte Vorwaertsachse | stumpfer Stahl, Schweissnaht-Look, Warnfarben | ram_prow, gun_casemates, slab_armor |
| ketzer_von_verath | ritualisierte Bruchformen, korrumpierte Syl'Nar-Kurven | dunkle Organik + ketzerische Glyphenlichter | blaspheme_halo, scar_tentacles, heretic_core |
| khar_morr_syndicate | zusammengeflickte Silhouette, modulare Beuteplatten | salvaged-metal, gemischte Legierungen | hook_prows, smuggler_pods, scrap_fins |
| myr_keth | polymorphe Polygon-Schwarmkoerper, replizierbare Knoten | lebendes Metall, adaptiver Glanz | seed_nodes, morph_spines, lattice_shell |
| nomaden_des_rifts | lange Rift-Spindeln, versetzte Ringsegmente | staubig-metallisch + dimensionsglow | rift_spines, drift_rings, fold_vanes |
| omniscienta | mathematisch streng, rekursive Muster, algorithmische Symmetrie | sterile Keramik-Metall-Mischung, kaltes Leuchten | logic_obelisks, solver_rings, checksum_beacons |

---

## 6. Klassenprofile pro Objektart

### 6.1 ship

1. Lesbare Front-/Heckrichtung zwingend.
2. 1 primäre Fraktionssignatur vorne oder mittig.
3. 1 Funktionssignatur hinten (Engine/Antriebscluster).

### 6.2 station/base

1. Zentraler Hub + mindestens 2 Ausleger/Orbitalelemente.
2. Fraktionssignatur als Fern-Erkennung (Ringe, Monolith, Halo, Segmentkranz).
3. Dock- und Utility-Bereiche sichtbar trennen.

### 6.3 building

1. Bodenkontakt klar; keine rein schwebenden Volumen ohne Tragrahmen.
2. Vertikale Funktionstuerme oder horizontale Module passend zur Fraktion.
3. Skalierbar als Set (small/medium/large) bei gleicher Signaturfamilie.

---

## 7. KI-Generierungsvorgaben (Prompt zu JSON)

Die KI bekommt 3 Eingaben:

1. faction_code
2. object_class
3. archetype (z. B. corvette, relay_station, research_lab)

Pflichtausgabe:

1. Drei.js Object JSON gemaess Kapitel 4
2. Kurzes Explain-Objekt in userData:
   - designIntent: 1-2 Saetze
   - recognitionHints: 3 Stichwoerter

Optional:

1. texture references (max 3)
2. colorVariants (skins), solange Silhouette unveraendert bleibt
3. lokale Light-Nodes fuer Signaturlichter (z. B. Docking-Beacon, Ritual-Halo, Core-Glow)
4. VFX-Emitter fuer thruster/muzzle/impact/trail
5. beam-Definitionen fuer Laser/Plasma-Strahlen

### 7.1 Negativvorgaben (KI darf NICHT)

1. Keine nicht unterstuetzten Geometrietypen ausgeben.
2. Keine zu filigranen Teile unter 0.02 Welteinheiten bei Basis-Scale 1.
3. Keine komplett fraktionsfremde Signatur uebernehmen (z. B. Vor'Tak-Schiff mit Syl'Nar-Halo-Tentacles als Hauptmerkmal).
4. Keine uebermaessige Light-Inflation (mehr als 3 lokale Lights ohne Gameplay-Begruendung).
5. Keine ungebremste Partikelrate (Richtwert: max. 120 Partikel/s je Emitter bei Dauerbetrieb).

---

## 8. Erkennungsmetriken (Gameplay/QA)

Ein Objekt gilt als fraktionslesbar, wenn in Blindtests:

1. >= 75% korrekte Fraktionszuordnung bei 3 Sekunden Sichtzeit.
2. >= 85% Zuordnung zur richtigen Fraktionsgruppe (military/spiritual/ai/pirate etc.).

Technische QA-Gates:

1. JSON Parse + ObjectLoader Parse erfolgreich.
2. Kein fehlender Material-/Geometry-Link.
3. Clip-Namen idle_/active_/alert_ vorhanden.
4. LOD low reduziert Segmentzahl um mindestens 35% gegenueber full.

---

## 9. Beispiel-Generatorauftrag (normiert)

```text
Generate model JSON for GalaxyQuest.
faction_code: omniscienta
object_class: station
archetype: computation_hub
design_language: egl-1.0
constraints:
- allowed geometries: Box, Sphere, Cylinder, Torus, Ring, Octahedron
- primitive budget full: 18-48
- include idle, active, alert animations
- include gqModelSemantics with silhouetteTags and signatureParts
- silhouette must be readable as omniscienta (recursive mathematical symmetry)
output: single valid Three.js Object JSON document
```

---

## 10. Implementierungsplan

1. Prompt-Profile pro Fraktion um 3D-Designfelder erweitern (fractions/*/spec.json):
   - geometry_language_tags
   - silhouette_rules
   - signature_parts
   - material_language
2. Serverseitige JSON-Validierung in api/model_gen.php ergaenzen (oder separater Validator).
3. QA-Script fuer Fraktionslesbarkeit + Formatchecks in scripts/ anlegen.
4. Schrittweise Rollout-Reihenfolge:
   - Phase 1: 6 Kernfraktionen
   - Phase 2: 11 NPC/Meta-Fraktionen
   - Phase 3: Skin-Varianten und LOD-Tuning

---

## 11. Definition of Done (DoD)

1. Fuer jede Fraktion existiert mindestens:
   - 1 ship
   - 1 station/base
   - 1 building
2. Alle Modelle bestehen QA-Gates aus Kapitel 8.
3. Interne Tester koennen in Blindtests Fraktionen stabil am Design erkennen.
4. Assets laufen ohne Engine-Aenderungen im bestehenden ObjectLoader-Pfad.
