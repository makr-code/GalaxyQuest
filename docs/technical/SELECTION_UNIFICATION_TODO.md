# Selection Unification TODO (Galaxy / System / Approach / Colony)

> **Historical implementation snapshot:** Source paths below point to the current tree, but line numbers and the status assessment have not been revalidated. Treat this as a design TODO, not a current inventory or release status.

## Kurzbefund (Best-Practice + Usability)

1. Selection-Logik ist verteilt auf mehrere Systeme statt zentralen Selection-Store.
- Three.js Pfad: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)
- WebGPU Sternfeld: [Galaxy3DRendererWebGPU.js](../../js/rendering/Galaxy3DRendererWebGPU.js)
- UI-Adapter: [game-galaxy.js](../../js/ui/game-galaxy.js)

2. Ein Marker existiert, ist aber semantisch ein kombinierter Hover/Selection-Marker.
- Hover-Marker-Build: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)
- Marker-Update (mischt Hover und Selection): [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)

3. Group Selection ist teilweise vorhanden (Cluster), aber nicht als generisches Konzept.
- Cluster Hover/Select Indizes: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)
- Cluster Picking: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)

4. Dynamic Object Selection (Fleets, Installationen, FTL) ist implementiert, aber ebenfalls getrennt von Stern/Planet-Selection.
- System dynamic selection: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)
- Galaxy dynamic selection: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)

5. Kolonisierte Welten haben bereits visuelle Merkmale, aber nicht konsistent in allen Views.
- System-View Aura-Ring pro Kolonie: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)
- Einfärbung von Sternen nach Empire/Faction (WebGPU): [Galaxy3DRendererWebGPU.js](../../js/rendering/Galaxy3DRendererWebGPU.js)

6. Hover-Usability ist gut (magnetisch, slow-pointer bias), aber unabhängiger Hover gegenüber persistenter Selection ist im Marker visuell nicht sauber getrennt.
- Magnet-Hover-Logik: [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js)

---

## Zielbild

1. Einheitliches Interaction Model für alle 3D-Objekte.
- Stern
- Planet/Mond
- Cluster
- Fleet
- Installation
- FTL-Objekte
- Colony-Slots (Approach/Surface)

2. Zwei klar getrennte Zustände.
- Persistente Selection (immer sichtbar)
- Temporärer Hover (immer unabhängig von Selection)

3. Konsistente Ownership-Visuals in allen Zoom-Levels.
- Faction-Farbcode
- Ring/Badge/Halo-System
- gleiche Semantik in Galaxy, System, Approach, Colony

---

## Priorisierte TODO

## Phase 1: Selection State vereinheitlichen (hoch)

1. Central Selection Store einführen.
- Neue zentrale Struktur in Runtime, z. B. uiState.selectionState.
- Felder: active, hover, multiSelection, mode, sourceView.
- Akzeptanz: Kein Renderer verwaltet den finalen Selection-State exklusiv lokal.

2. Einheitlichen Selection-Key definieren.
- Format: kind + ids + scope.
- Beispiele: star:g:s, planet:g:s:p, cluster:id, fleet:id.
- Akzeptanz: Gleiches Objekt hat in jeder View denselben Schlüssel.

3. Selection/hover Event Contract standardisieren.
- onHover, onClick, onDoubleClick liefern immer dieselbe Payload-Struktur.
- Akzeptanz: UI-Layer braucht keine objekttyp-spezifischen Sonderfälle mehr.

## Phase 2: Marker-System trennen (hoch)

1. Persistenten Selection Marker hinzufügen.
- Eigener Marker statt Wiederverwendung des Hover-Markers.
- In [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js) Update in 2 Marker aufteilen.
- Akzeptanz: Selection bleibt sichtbar, auch wenn Hover auf anderem Objekt liegt.

2. Unabhängigen Hover Marker beibehalten.
- Hover Marker nur für Pointer-Fokus.
- Akzeptanz: Hover verschwindet beim Pointer-Out, Selection Marker bleibt.

3. Marker-Style-System definieren.
- Selection: stärker, stabil, Fraktionsfarbe + Puls optional.
- Hover: leichter, kurzlebig, neutral.
- Akzeptanz: visuelle Verwechslung zwischen Hover und Selection ausgeschlossen.

## Phase 3: Gruppen-Selektion erweitern (mittel)

1. Cluster Selection zu Group Selection generalisieren.
- Auswahlmenge statt nur selectedClusterIndex.
- Vorbereitung für Fraktions-Selektion und Mehrfachauswahl.

2. Fraktions-Selektion implementieren.
- Klick auf Faction-Legende/Filter wählt alle passenden Systeme/Planeten.
- Akzeptanz: Group Marker zeigt Umfang der Gruppe (Hull/Heat/Outline).

3. Multi-Select UX (Ctrl/Shift) für Desktop.
- additive/subtraktive Auswahl.
- Akzeptanz: klare Tastatur-/Maus-Regeln + sichtbare Selektion-Liste.

## Phase 4: Ownership-Visuals in allen Views (hoch)

1. Ownership Visual Token definieren.
- Farben, Ringdicke, Halo-Stärke, optional Emblem.

2. Galaxy-View angleichen.
- Sternfarbe/zusätzlicher Ring konsistent mit System-View Ownership.
- Referenz: [Galaxy3DRendererWebGPU.js](../../js/rendering/Galaxy3DRendererWebGPU.js)

3. System-View angleichen.
- Bestehende Aura in [galaxy-renderer-core.js](../../js/rendering/galaxy-renderer-core.js) auf Monde/Stationen/Fleets erweitern.

4. Approach-/Colony-View angleichen.
- Ownership-Badge/Halo für Objekt- und Colony-Surface-Darstellung.
- Akzeptanz: Spieler erkennt Besitzstatus ohne Kontextwechsel.

## Phase 5: Accessibility und Usability (mittel)

1. Farbblinde Alternativen ergänzen.
- nicht nur Farbe: Form, Muster, Strichart.

2. Tastatur- und Screenreader-Hooks.
- Selection-Wechsel per Tastatur.
- aria-live Meldungen bei Selection-Änderung.

3. Tooltip-/Info-Panel Entkopplung.
- Hover zeigt Kurzinfo.
- Selection zeigt persistente Detailkarte.

4. Interaction-Latency Budget setzen.
- Ziel: Hover < 50 ms, Selection-Feedback < 100 ms.

## Phase 6: Technische Qualität (hoch)

1. Selection Logic Tests ergänzen.
- Unit-Tests für Selection-Key, State-Reducer, Group-Selection.

2. E2E-Testmatrix erweitern.
- Star/Planet/Cluster/Fleet/Installation/FTL auswählen.
- Marker-Zustände prüfen: hover-only, selection-only, beide.

3. Telemetrie für Fehlklicks und Undo-Rate.
- Misclick-Rate und Umschalt-Häufigkeit messen.

4. Performance-Gates für Raycasting/Picking.
- Regression-Warnung bei steigender Interaktionslatenz.

---

## Konkrete Startreihenfolge (empfohlen)

1. Selection Store + Event Contract
2. Zweites Marker-System (persistente Selection + unabhängiger Hover)
3. Ownership Token + View-übergreifende Anwendung
4. Group Selection (Cluster zuerst, dann Faction)
5. Tests + Telemetrie

---

## Definition of Done

1. Ein Objekt kann in jeder View eindeutig selektiert werden.
2. Selection bleibt persistent sichtbar bei Hover auf anderen Objekten.
3. Hover bleibt unabhängig und nicht-blockierend.
4. Kolonisierte Welten sind in allen Views konsistent erkennbar.
5. Group Selection für Cluster und Fraktionen ist nutzbar.
6. E2E-Checks decken alle Objektklassen und Markerzustände ab.
