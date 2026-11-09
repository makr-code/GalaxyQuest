# Schlacht- und WebGPU-Testaufnahmen

Die Videos liegen lokal im Repository unter
[`assets/hero-battles/`](./assets/hero-battles/). Die eingebetteten Player
benötigen eine Markdown-Vorschau, die HTML-Videoelemente unterstützt. Falls
die Vorschau sie nicht darstellt, öffnet der jeweilige Dateilink die Aufnahme
direkt. WebM-Aufnahmen enthalten auch Login und Navigation.

## Live-Journal: kontinuierlicher Worker

Ein isolierter Server-Worker berechnet und persistiert die Ticks; der Browser
liest sie über einen teilnehmergeschützten HTTP-Endpunkt und stellt sie in
WebGPU dar. Der Test leitet HTTP-Anfragen über einen Testtransport weiter und
verwendet einen vorgegebenen visuellen Anker und eine manuell gesetzte Kamera.
Eine zweite Fixture-Schlacht wurde nach dem Schließen der Browserseite vom
selben Worker abgeschlossen; sie ist nicht im Video zu sehen. Keine produktive
Flottenbegegnung oder Loot-Abrechnung.

<video controls preload="metadata" width="960" src="./assets/hero-battles/live-battle-continuous-webgpu-e2e.webm"></video>

[Video öffnen](./assets/hero-battles/live-battle-continuous-webgpu-e2e.webm) ·
[Test](../../tests/e2e/live-battle-server-webgpu.spec.js)

## Live-Journal: einzelne Worker-Batches

Die Ticks und das Journal stammen vom Server; der Test startete zwei einzelne
Worker-Batches. HTTP-Transport, visueller Anker und Kamera sind Testfixtures.
Dies ist keine produktive Schlacht.

<video controls preload="metadata" width="960" src="./assets/hero-battles/live-battle-server-webgpu-e2e.webm"></video>

[Video öffnen](./assets/hero-battles/live-battle-server-webgpu-e2e.webm)

## Live-Journal: simulierte Antworten

Der native WebGPU-Renderer verarbeitet eine simulierte Snapshot- und Tickfolge.
Es werden weder der Journal-Endpunkt noch ein Server-Worker aufgerufen.

<video controls preload="metadata" width="960" src="./assets/hero-battles/live-battle-journal-webgpu-e2e.webm"></video>

[Video öffnen](./assets/hero-battles/live-battle-journal-webgpu-e2e.webm) ·
[Test](../../tests/e2e/live-battle-webgpu.spec.js)

## Abgeschlossenes Encounter-Replay

Der Browser-E2E zeigt den Fleet-UI-Replay-Pfad mit einer simulierten
schreibgeschützten API-Antwort. Die Gruppendarstellung und Rundendruck-Cues
sind illustrativ; sie belegen keine einzelnen Schüsse oder Treffer.

<video controls preload="metadata" width="960" src="./assets/hero-battles/battle-encounter-replay-e2e-seed-465192520.webm"></video>

[Video öffnen](./assets/hero-battles/battle-encounter-replay-e2e-seed-465192520.webm)

## Hero-Battle-Browser-E2E

Seeded QA-Szene mit acht Schiffen und clientseitiger Timeline. Die Szene ist
eine visuelle Testfixture und kein autoritativer Kampf.

<video controls preload="metadata" width="960" src="./assets/hero-battles/hero-battle-e2e-seed-465192519.webm"></video>

[Video öffnen](./assets/hero-battles/hero-battle-e2e-seed-465192519.webm) ·
[Test](../../tests/e2e/battle-engine-video.spec.js)

## Weitere visuelle QA-Szenen

Die folgenden Aufnahmen verwenden geskriptete, nicht autoritative
QA-Szenarien. MP4 ist die abspielbereite Fassung; bei den ersten drei
Aufnahmen ist zusätzlich der ursprüngliche WebM-Stream verfügbar.

### Hero Battle: vier Schiffe

<video controls preload="metadata" width="960" src="./assets/hero-battles/hero-battle-full.mp4"></video>

[MP4 öffnen](./assets/hero-battles/hero-battle-full.mp4) ·
[WebM öffnen](./assets/hero-battles/hero-battle-full.webm)

### Gemischte Flotte

<video controls preload="metadata" width="960" src="./assets/hero-battles/hero-mixed-fleet-full.mp4"></video>

[MP4 öffnen](./assets/hero-battles/hero-mixed-fleet-full.mp4) ·
[WebM öffnen](./assets/hero-battles/hero-mixed-fleet-full.webm)

### Taktik mit Seed 465192519

<video controls preload="metadata" width="960" src="./assets/hero-battles/hero-tactics-465192519.mp4"></video>

[MP4 öffnen](./assets/hero-battles/hero-tactics-465192519.mp4) ·
[WebM öffnen](./assets/hero-battles/hero-tactics-465192519.webm)

### Fünfminütiger Konvoi-Durchbruch

Durchgehende, stumme 300-Sekunden-Aufnahme mit 48 Schiffen, geskripteten
Befehlen und Verstärkungswellen. Die Sequenz ist keine serverberechnete Schlacht.

<video controls preload="metadata" width="960" src="./assets/hero-battles/hero-convoy-five-minute.mp4"></video>

[MP4 öffnen](./assets/hero-battles/hero-convoy-five-minute.mp4)

Weitere Implementierungsdetails und die Grenzen der Aufnahmen stehen in der
[Hero-Battle-Dokumentation](./HERO_BATTLE_IMPLEMENTATION.md) und im
[Schlachtengine-Integrationsplan](./BATTLE_ENGINE_INTEGRATION_PLAN.md).
