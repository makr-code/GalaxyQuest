# GalaxyQuest - Runtime Mapping fuer Fraktions-3D-VFX

Status: in-progress v1.1
Version: 1.1
Stand: 2026-04-02
Bezug: docs/gamedesign/FACTION_3D_OBJECT_DESIGN_LANGUAGE.md, models/schema/gq-faction-object.schema.json, js/engine/fx/*

---

## 1. Ziel

Dieses Dokument definiert die 1:1-Laufzeitabbildung der modellseitigen VFX-Felder
auf den bestehenden Engine-FX-Stack.

Modelldaten:

1. object.userData.gqVfxEmitters[]
2. object.userData.gqWeaponFx[]

Runtime-Ziele:

1. Keine Sonderfälle pro Fraktion im Renderer-Code.
2. Datengetriebene Effekte fuer Triebwerke, Muzzle-Flash, Laser/Beam.
3. Einheitliches Verhalten in WebGPU und Fallback-Pfaden.

---

## 2. Mapping-UEbersicht

| Model-Feld | Runtime-Komponente | Datei |
|---|---|---|
| gqVfxEmitters[].* | ParticleEmitter + ParticleSystem/GPUParticleSystem | js/engine/fx/ParticleEmitter.js, js/engine/fx/ParticleSystem.js, js/engine/fx/GPUParticleSystem.js |
| gqWeaponFx[].kind=beam | BeamEffect + CombatFX | js/engine/fx/BeamEffect.js, js/engine/fx/CombatFX.js |
| Light-Nodes im Object JSON | Scene Light + optional DynamicLight-Ansteuerung | js/engine/scene/Light.js, js/engine/fx/CombatFX.js |

### 2.1 Aktueller Implementationsstand (2026-04-02)

Bereits aktiv:

1. `ModelRegistry` resolved `gqVfxEmitters` und `gqWeaponFx` pro Instanz (`resolvedVfx` Payload).
2. Renderer-Bridge via `ModelRegistry.setVfxBridge(...)` ist registriert.
3. Installation-Partikel im System-View lesen Emitter-Hints (`count`, `spread`, `colorStart`, `sizeStart`, `speed`, `position`) aus `resolvedVfx.emitters`.
4. `gqWeaponFx(kind=beam)` wird im System-View als Runtime-Beam-Linie visualisiert (alert-zustandsgebunden, Ziel aus feindlichen Flottenpositionen).
5. `gqVfxEmitters(mode=burst, kind in muzzle|impact|debris|trail)` werden im System-View als kurzlebige Burst-Impulswolken gespawnt (State-Trigger + Cooldown).
6. `gqWeaponFx.kind` wird im System-View fuer alle Typen differenziert visualisiert:
- `beam`: kontinuierliche Beam-Linie
- `plasma`: reisender Leuchtkopf mit Trail
- `rail`: hochfrequenter Strobe-Impact-Strahl
- `missile`: langsamerer Leuchtkopf mit Trail

Noch offen:


Neu aktiv (2026-04-02):

7. `CombatVfxBridge` (`js/engine/CombatVfxBridge.js`) ist als Event-Producer integriert:
- Lauscht auf `gq:fleet-arrived`, `gq:fleet-incoming-attack`, `gq:fleet-returning` (CustomEvents).
- Dispatcht `gq:combat:weapon-fire` Impulse waehrend des Kampffensters (8 s, alle 380 ms).
- Registriert `combat-vfx-bridge`-Adapter in `window.GQGalaxyEngineBridge`.
- game.js SSE-Handler senden die Fleet-Lifecycle-Events in die Browser-Event-Pipeline.

8. **Phase FX-3: BeamEffect Pool Integration** (`js/engine/fx/BeamEffect.js`):
- Instanced capsule beam rendering (128-beam pool, GPU buffer).
- Galaxy3DRenderer nutzt `BeamEffect.addBeam()` in `_triggerInstallationWeaponFire()`.
- `BeamEffect.update(dt)` wird pro Frame in `_syncInstallationWeaponFx()` aufgerufen.
- `BeamEffect.uploadToGPU()` nach Sync, vor Render-Pass.
- Fallback: Bestehende THREE.Line Geometrie als Backup, wenn BeamEffect nicht verfuegbar.
- Geladen in `index.html` Loader (`js/engine/fx/BeamEffect.js?v=20260402p1`).
  
Noch offen:

1. Volle Anbindung Weapon-FX auf non-installation Entitaeten (Schiffe, Trümmer, Wormholes).
2. Debris emitter lifecycle management (separate impact spawns).
3. Priorisierte Pool-Drosselung über mehrere gleichzeitige Kampfszenen.

---

## 3. gqVfxEmitters -> ParticleEmitter

### 3.1 Feldzuordnung

| gqVfxEmitters-Feld | ParticleEmitter-Option |
|---|---|
| id | interne Emitter-ID (Registry-Key) |
| kind | Tag fuer Lifecycle/Trigger-Regeln |
| mode | mode (`continuous` oder `burst`) |
| attachTo | Resolve auf Scene-Node (name bevorzugt, fallback uuid) |
| position | opts.position (lokal relativ zu attachTo) |
| direction | opts.direction |
| count | opts.count |
| lifetime | opts.lifetime |
| lifetimeVariance | opts.lifetimeVariance |
| speed | opts.speed |
| speedVariance | opts.speedVariance |
| spread | opts.spread |
| colorStart | opts.colorStart |
| colorEnd | opts.colorEnd |
| sizeStart | opts.sizeStart |
| sizeEnd | opts.sizeEnd |
| gravity | opts.gravity |
| drag | opts.drag |
| duration | opts.duration |

### 3.2 Mode-Mapping

1. `continuous`:
- persistenter Emitter, Tick in jedem Frame
- deaktivierbar ueber Objektzustand (z. B. ship idle/offline)

2. `burst`:
- einmaliges Emission-Event
- Trigger ueber EventBus (z. B. weapon fired, impact, alert pulse)

### 3.3 Coordinate- und Attach-Regeln

1. `attachTo` wird gegen `object.children[].name` aufgeloest.
2. Falls nicht gefunden: Suche gegen `uuid`.
3. Falls weiterhin nicht gefunden: Fallback auf Model-Root + Warning-Log.
4. `position` ist lokaler Offset relativ zum Attach-Node.
5. `direction` wird normalisiert, falls Betrag > 0; bei 0-Vektor Fallback `[0,1,0]`.

---

## 4. gqWeaponFx -> BeamEffect / CombatFX

### 4.1 Beam-Feldzuordnung

| gqWeaponFx-Feld | BeamEffect-Instanzdaten |
|---|---|
| id | Beam-Record-ID |
| kind=beam | Beam-Pfad aktiv |
| from | Startpunkt-Resolver (Node oder Emitter-ID) |
| to | Zielpunkt (`target` oder konkreter Node) |
| coreColor | FB_CORE_R/G/B |
| glowColor | FB_GLOW_R/G/B |
| glowRadius | FB_GLOW_RAD |
| alpha | FB_ALPHA |

### 4.2 Resolver-Regeln fuer from/to

1. `from`:
- zuerst Node-Name suchen
- falls nicht vorhanden: Emitter-ID (gqVfxEmitters.id) suchen und dessen Position verwenden

2. `to`:
- `target`: aktuelles Combat-Ziel aus Mission/Targeting
- sonst Node-Name/UUID im selben Objekt
- fallback: forward ray aus `from` mit Standarddistanz

### 4.3 Aktuelles Runtime-Verhalten im System-View

1. Aktivierung erfolgt ereignisgetrieben ueber Fire-Cycles (Cadence + Shot-Duration) sobald ein feindliches Ziel vorhanden ist und der Installationszustand nicht `idle` ist.
2. Zielpunkt wird aus feindlichen Flottenpositionen (Mission `attack|spy`) bestimmt.
3. Renderingprofil je `kind`:
- `beam`: statischer, gepulster Vollstrahl von `from` nach `to`
- `plasma`: zyklischer Projektilkopf auf Segment `from->to`, mit sichtbarer Trail-Linie
- `rail`: stroboskopischer Kurzimpulsstrahl fuer kinetisches Treffergefuehl
- `missile`: langsamere Projektilbewegung mit staerkerem Head-Glow und Trail
4. Bei jedem Fire-Event werden vorhandene Burst-Emitter (z. B. `muzzle`) zusaetzlich getriggert; deren Cooldown bleibt aktiv.

---

## 5. Trigger-Regeln (empfohlen)

### 5.1 thruster

1. Aktiv bei `ship moving` oder `active` state.
2. Optional reduzierte Rate in `idle`.
3. Deaktiviert bei `destroyed` oder `docked`.

### 5.2 muzzle

1. Trigger pro Waffenabgabe (CombatFX Event).
2. Bei Burst-Waffen mehrfach innerhalb einer Salve.

Derzeitige Runtime-Umsetzung (System-View Installationen):

1. Burst-Emitter werden beim Wechsel in `alert` sofort getriggert.
2. Solange `alert` aktiv bleibt, erfolgt ein Re-Trigger ueber emitterbasierten Cooldown (ca. 0.7-1.2 s).
3. Darstellung erfolgt als additive kurzlebige Point-Cloud (Fade + Growth), mit Parametern aus `count`, `spread`, `lifetime`, `sizeStart`, `colorStart`.

### 5.3 beam

1. Trigger synchron zu Weapon-Fire Event.
2. Lebensdauer an Waffentyp koppeln (laser kurz, sustained beam laenger).

---

## 6. Performance-Budget (Runtime)

Pro sichtbarer Instanz als Richtwert:

1. max 3 aktive Emitter gleichzeitig
2. max 120 Partikel/s je `continuous` Emitter
3. max 4 gleichzeitige Beam-Instanzen pro Objekt
4. Light-Nodes aus Modell: max 3 (bereits Designregel)

Systemweit (weiche Caps):

1. ParticleSystem Pool default: 4096
2. Beam Pool default: 128

Wenn Cap erreicht:

1. Prioritaet: muzzle > beam > thruster ambient
2. Niedrige Prioritaet wird gedrosselt statt harter Fehler

### 6.1 Colony Surface Building Ambient VFX

Fuer die Zoom-Ebene `colonySurface` (ThreeJS-Levelrenderer) gelten folgende
zusatzliche Budgets fuer rein ambienten Gebaeude-VFX-Staub/Funken:

1. quality `low`: bis 10 Emitter, 8 Partikel je Emitter
2. quality `medium`: bis 20 Emitter, 10 Partikel je Emitter
3. quality `high`: bis 36 Emitter, 14 Partikel je Emitter
4. globaler harter Cap: 900 Partikel fuer das gesamte Colony-Surface-Bild

Aufloesung von `quality`:

1. explizit ueber `sceneData.vfx_quality` (`low|medium|high`) falls gesetzt
2. sonst automatisch ueber Slot-Anzahl (adaptive Degradation)

Implementationsstatus:

1. ThreeJS fallback: aktiv in `ColonySurfaceLevelThreeJS`
2. WebGPU: aktiv in `ColonySurfaceLevelWebGPU` als leichter additive-Spark-Pass
3. Beide Pfade nutzen dieselben `quality`-Stufen und denselben globalen Partikel-Cap

Zustandsprofile (datengetrieben ueber Slotfelder wie `type`, `building_type`,
`category`, `state`, `status`, `activity`, `upgrade_end`):

1. Construction/Upgrade (`upgrade_end` oder running/building/construction):
- mehr Partikel, groesser, waermerer Tint (orange)
2. Industry (mine/factory/refinery/smelter/...):
- dichteres Ambientfeld, leicht warm
3. Power (reactor/fusion/energy/...):
- blauer/kuehler Tint, moderat dichter
4. Research (lab/science/...):
- feineres, ruhigeres Feld

Event-Peaks (transient):

1. Bei Zustandswechsel von `upgrade_end` (start/finish) wird ein kurzer
  Boost-Impuls ausgeloest (ca. 1.6s).
2. Der Impuls erhoeht temporär Partikel-Opacity und Partikel-Quad/Point-Groesse.
3. Umsetzung in beiden Colony-Pfaden (ThreeJS + WebGPU) ohne zusaetzliche
  API-Events, rein aus Slot-Diff zwischen aufeinanderfolgenden Scene-Updates.

Explizite Steuerung (optional, pro Slot):

1. `vfx_profile` (oder `fx_profile`):
- erlaubte Werte: `construction`, `upgrade`, `industry`, `smelter`, `refinery`,
  `power`, `reactor`, `research`, `science`, `quiet`, `minimal`
2. `vfx_intensity` (oder `fx_intensity`):
- Multiplikator fuer Effektstaerke, geklemmt auf 0.4 bis 2.2
3. Wenn `vfx_profile` gesetzt ist, wird dieses Profil priorisiert; andernfalls
  greift die automatische Heuristik ueber Typ-/State-Felder.

Runtime-Client Mapper (aktuell):

1. In `js/runtime/game.js` wird aus `API.buildings()` + `layout` ein
  Colony-Surface-Slotset fuer den Zoom-Levelrenderer aufgebaut.
2. Der Mapper weist pro Building-Slot automatisch `vfx_profile`/
  `vfx_intensity` zu und propagiert `upgrade_end`.
3. Ueber `SeamlessZoomOrchestrator.setSceneData(COLONY_SURFACE, payload)`
  werden die Renderer (ThreeJS/WebGPU) laufend mit aktualisierten VFX-Slotdaten versorgt.
4. Mapper-Telemetrie liegt in `payload.vfx_mapper_stats` und zusaetzlich in
   `window.__GQ_COLONY_VFX_MAPPER` (mappedSlots + profileCounts).
5. Renderer-Telemetrie liegt in `window.__GQ_COLONY_VFX_STATS`
   (backend, quality, emitters, particles, profileCounts, burstActive).
- Hook wird pro `instantiate()` mit `resolvedVfx` aufgerufen.
4. `gqVfxEmitters` registrieren:
- attach node resolve
- ParticleEmitter erstellen
- in FX-Registry speichern
5. `gqWeaponFx` registrieren:
- Resolver + Beam-Template erzeugen
6. Bei Runtime-Events (fire/impact/state-change):
- passende Emitter/Beam spawnen oder toggeln

### 7.1 Implementierte Event-Hooks (System-View)

Der Renderer akzeptiert externe Weapon-Fire-Impulse ueber zwei Pfade:

1. Browser-Events:

2. Engine-Bridge-Adapter (`window.GQGalaxyEngineBridge`):
  - `emitWeaponFire(payload)`
  - `emitWeaponFireBatch(payload[])`

Payload-Felder (alle optional, aber mindestens eines sinnvoll):

1. `sourcePosition` (Installations-Slot)
2. `sourceOwner`
3. `sourceType` (z. B. `stargate`)
4. `weaponKind` (`beam|plasma|rail|missile`)

Verarbeitung:

1. Payloads werden in eine Renderer-Queue geschrieben.
2. Queue wird im Frame-Tick vor Weapon-FX-Sync abgearbeitet.
3. Treffende Weapon-FX-Eintraege erhalten sofort einen Fire-Cycle-Trigger (Cadence-Bypass / priorisiert).

### 7.2 CombatVfxBridge — Event-Producer (game.js → Renderer)
---
`js/engine/CombatVfxBridge.js` schließt die Kette von Spielereignissen bis zum
Renderer.  Singleton bei Start: `window.GQCombatVfxBridge`.

**Abonnierte Browser-Events (von game.js SSE-Handlern emittiert):**
## 8. Pseudocode
| CustomEvent | Quelle | Aktion |
|---|---|---|
| `gq:fleet-arrived` (mission=attack) | SSE `fleet_arrived` | Sofortiger Eröffnungssalvo + 8 s Kampffenster |
| `gq:fleet-arrived` (mission=spy) | SSE `fleet_arrived` | Einzel-Beam-Puls |
| `gq:fleet-incoming-attack` | SSE `incoming_attack` | 3 × Alarm-Puls (260 ms Abstand) |
| `gq:fleet-returning` (mission=attack) | SSE `fleet_returning` | Kampffenster beenden |

**Produzierte Events:**
```javascript
```
window.dispatchEvent(new CustomEvent('gq:combat:weapon-fire', { detail: {
  sourceOwner: null,   // null = alle Installationen im aktuellen System
  sourceType:  null,
  weaponKind:  null,   // null = alle Waffenarten
  ts: Date.now(),
}}));
```
function registerModelVfx(modelRoot, modelUserData, fxRuntime) {
**Kampffenster-Lifecycle:**
  const emitters = Array.isArray(modelUserData.gqVfxEmitters) ? modelUserData.gqVfxEmitters : [];
1. `_startBattleFx(attacker, target, 8000)` startet `setInterval` (alle 380 ms).
2. Nach 8 s beendet `setTimeout` den Interval automatisch.
3. `_stopBattleFx(key)` beendet manuell (z. B. durch `fleet_returning`).
4. Bridge-Adapter `combat-vfx-bridge` in `GQGalaxyEngineBridge` erlaubt direkten
   API-Zugriff: `startBattleFx`, `stopBattleFx`, `dispatchWpnFire`.
  const weapons = Array.isArray(modelUserData.gqWeaponFx) ? modelUserData.gqWeaponFx : [];
---

  for (const e of emitters) {
    const attachNode = resolveNode(modelRoot, e.attachTo) || modelRoot;
    fxRuntime.registerEmitter({
      id: e.id,
      kind: e.kind,
      mode: e.mode,
      attachNode,
      localPosition: e.position,
      localDirection: e.direction,
      emitterOptions: {
        mode: e.mode,
        count: e.count,
        lifetime: e.lifetime,
        lifetimeVariance: e.lifetimeVariance,
        speed: e.speed,
        speedVariance: e.speedVariance,
        spread: e.spread,
        colorStart: e.colorStart,
        colorEnd: e.colorEnd,
        sizeStart: e.sizeStart,
        sizeEnd: e.sizeEnd,
        gravity: e.gravity,
        drag: e.drag,
        duration: e.duration
      }
    });
  }

  for (const w of weapons) {
    fxRuntime.registerWeaponFx(w);
  }
}

// optional: global bridge hook in boot phase
window.__GQ_ModelRegistry.setVfxBridge((instance, payload) => {
  // payload.emitters / payload.weapons bereits gegen Node-Namen/UUID aufgeloest
  // hier an CombatFX/ParticleSystem-Registry anbinden
});
```

---

## 9. Testfaelle

1. `faction_lit_reference.json` laden und auf fire-event:
- `muzzle_primary` burst sichtbar
- `beam_primary` sichtbar
- `thruster_main` dauerhaft aktiv

2. Starterset Smoke:
- alle Dateien unter models/faction_starter/
- keine Resolver-Fehler fuer attachTo/from/to

3. Lasttest:
- 50 gleichzeitige Instanzen
- keine Hard-Drops unter Budgetgrenze

---

## 10. Definition of Done

1. VFX-Felder werden ohne Sonderfall-Code pro Fraktion verarbeitet.
2. Triebwerk, Muzzle und Beam laufen datengetrieben aus Model-JSON.
3. Strict-Validator bleibt gruen.
4. Sichtbarer Unterschied zwischen Fraktionen bleibt erhalten, ohne Performance-Budget zu sprengen.
