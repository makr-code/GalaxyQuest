# Motion: Integration und Faehigkeiten

**Stand:** 14.11.2026  
**Status:** Startmenue, Slide-Uebergaenge, Kometenverfolgung und Shuttle-Regie integriert

## Zweck und Bibliothekswahl

GalaxyQuest verwendet [Motion](https://motion.dev/) fuer animierte
HTML/CSS-Bedienelemente ueber der bestehenden Galaxieansicht.
Das Paket ist MIT-lizenziert und wird ueber npm und Vite lokal gebuendelt.
Es gibt keinen CDN-Aufruf und keine React-Anbindung im Anwendungscode.

Die Abhaengigkeit steht als `motion: ^14.14.0` in
[package.json](../../package.json); die konkrete Aufloesung steht in
[package-lock.json](../../package-lock.json).
Importiert wird nur die kleine DOM-Variante:

```js
import { animate } from 'motion/mini';
```

Diese Variante verwendet native Browseranimationen. Die Paketinstallation
allein bedeutet nicht, dass saemtliche Motion-Faehigkeiten im Frontend
aktiviert oder in die Spielengine integriert sind.

## Aktuell implementierter Ablauf

Der Controller liegt in
[start-screen-motion.js](../../js/network/start-screen-motion.js).
[start-screen.js](../../js/network/start-screen.js) verbindet ihn mit
Startmenue, Einstellungen und Registrierungsprolog.

| Gruppe | Eintritt und Austritt |
|---|---|
| Kennzeile `.start-eyebrow` | Von oben / nach oben |
| Titel und Untertitel | Von links / nach links |
| Direkte Kinder der Startnavigation | Von links / nach links, gestaffelt |
| Musikplayer | Von rechts / nach rechts |
| Sessionstatus, Galaxiequelle und Credits | Von unten / nach unten |
| Systemlog `#boot-terminal` | Von unten / nach unten |

Eintritt kombiniert Bewegung mit `opacity: 0 -> 1`; Austritt kombiniert
Bewegung mit Ausblendung auf `0`. Die Zielposition liegt ausserhalb des
Viewports mit 32 Pixeln Reserve. Bereits vorhandene Translationen werden
bei der Berechnung beruecksichtigt.

Pro Element gelten:

| Einstellung | Eintritt | Austritt |
|---|---|---|
| Dauer | 0,8 Sekunden | 0,5 Sekunden |
| Verzoegerung | Index x 0,045 Sekunden | Index x 0,018 Sekunden |
| Cubic-Bezier-Easing | `[0.16, 1, 0.3, 1]` | `[0.7, 0, 0.84, 0]` |

Die Gesamtdauer haengt von der Anzahl sichtbarer Ziele ab; sie ist nicht
identisch mit der Dauer eines einzelnen Elements.
Die Ziele werden bei Controller-Erstellung erfasst. Versteckte Ziele
werden beim jeweiligen Animationsstart ausgelassen.

Beim Klick auf **Begin a new campaign**:

1. Offene Startpanels schliessen; die aktuelle Galaxieansicht wird erfasst
   und eine aktive automatische Flugtour pausiert.
2. Menue und Log werden `inert`; das Menue erhaelt `aria-busy="true"`.
   Weitere Kampagnenklicks werden ignoriert.
3. Der Controller wartet auf den Abschluss aller Austrittsanimationen.
4. Erst danach beginnt die Kometenverfolgung mit dem dreiteiligen Vorspann.
   Es folgen die oeffentlichen Heimatwelten, Herkunft/Name, Shuttle-Reise,
   Zielpruefung und die separat bestaetigte Landung.

**Escape waehrend des Austritts** bricht den Uebergang ab, stellt die
gespeicherte Ansicht soweit verfuegbar wieder her und laesst das Menue
einfliegen. Auch beim Abbruch des Prologs erscheint es erneut.
Der Fokus kehrt zum Kampagnenbutton zurueck; die nachgelagerte
Fokuswiederherstellung ueberschreibt keine zwischenzeitliche andere Auswahl.

## Controller-Vertrag

```js
import { createStartScreenMotion } from './start-screen-motion.js';

const motion = createStartScreenMotion({
  menu: document.getElementById('start-menu'),
  isReduced: () => document.body.dataset.startReducedMotion === 'true',
});

await motion.enter();
const completed = await motion.exit();
if (completed) {
  // Hier darf der nachfolgende UI-Zustand beginnen.
}
```

| Methode | Bedeutung |
|---|---|
| `enter(): Promise<boolean>` | Eintritt abspielen; `true` bei Abschluss, `false` bei Abloesung durch einen neuen Lauf |
| `exit(): Promise<boolean>` | Austritt mit demselben Abschlussvertrag |
| `finish(): void` | Laufende Animationen unmittelbar zum Ende setzen; kein Abbruch |

Ein neuer Lauf stoppt den vorherigen. Eine Revisionsnummer verhindert,
dass verspaetete Abschluesse dessen Zustand wiederherstellen.
Nach erfolgreichem Eintritt werden die vom Controller gesetzten
Inline-Eigenschaften `opacity` und `transform` entfernt.
Diese Eigenschaften sollten deshalb nicht zugleich von anderem Code
auf denselben Elementen verwaltet werden.

Animationsfehler werden von der Startscreen-Anbindung ueber den sichtbaren
Sessionstatus und `GQLog` als Warnung gemeldet. Eine fehlgeschlagene
Menueanimation soll den Einstieg in den Prolog nicht blockieren.

## Faehigkeiten und Grenzen

| Faehigkeit | Einordnung |
|---|---|
| HTML-/SVG-Styleanimationen, Keyframes, Dauer, Delay und Easing | Mit `motion/mini` verfuegbar |
| Ein-/Ausblenden und CSS-Translationen | Im Startmenue integriert |
| Gestaffelte Gruppen und gemeinsames Warten auf Abschluss | Im eigenen Controller ueber Delay und Promises umgesetzt |
| Wiedergabesteuerung wie Pause, Play, Stop und Complete | Bibliotheksseitig vorhanden; der Menuecontroller exponiert nur die drei oben genannten Methoden |
| Unabhaengige Achsen wie `x`, `y`, `rotateZ` | Faehigkeit des Hybrid-Imports `motion`, nicht des hier genutzten Mini-Vertrags |
| Sequenz-Timelines, SVG-Pfadzeichnen und Animation beliebiger JS-Objekte | Zusaetzliche Hybrid-Faehigkeiten; nicht integriert |
| Scroll-, Hover- oder In-View-Choreografie | Moegliche Erweiterung, derzeit kein allgemeiner Projektmechanismus |
| Three.js-Kamerafahrten und Schiffsbewegung | Weiterhin Aufgabe der bestehenden 3D-Engine, nicht dieses Controllers |

### Motion-Uebergaenge der Slides

[registration-slide-motion.js](../../js/network/registration-slide-motion.js)
animiert Kapitelzeile, Titel und Erzaehltext des Prologs mit `motion/mini`.
Der vorherige Text blendet in 0,2 Sekunden mit 8 Pixeln Bewegung nach oben
aus. Der neue Text blendet in 0,5 Sekunden aus 10 Pixeln unterhalb seiner
Ruheposition ein, mit 0,05 Sekunden Staffelung.
Der GalaxyQuest-Titelshot verwendet stattdessen eine 2,4 Sekunden lange
Perspektiv-/Tiefenanimation samt Laufweite.

Der fachliche Slide-Wechsel erfolgt sofort. Fuer den ausgehenden Text
werden kurzlebige visuelle Kopien verwendet: ohne IDs, `inert`,
`aria-hidden` und ohne Pointerinteraktion. Navigation, echte Inhalte,
Narration und Draft-Logik muessen nicht auf die Animation warten.
Ein neuer Wechsel stoppt den vorherigen Lauf; Abschlussrevisionen,
Entfernen der Kopien und Zuruecksetzen der Inline-Styles verhindern
ueberholte Darstellung nach schnellen Wechseln oder Abbruch.

Der Slide-Controller bietet `capture()`, `play({ titleShot })`, `pause()`,
`resume()`, `finish()` und `reset()`. `capture()` sichert die ausgehende
Darstellung vor der Textaenderung; `play()` startet die neue Darstellung.
Die Anbindung startet sie nach den synchronen Kapitel-/Layoutaenderungen.
**Pause/Fortsetzen** haelt sowohl Lesetimer als auch Motion-Animationen an.
Ein versteckter Tab pausiert den Vorspann ebenfalls. Reduzierte Bewegung
ueberspringt die Effekte; Aktivieren waehrend eines Laufs beendet sie.
Schliessen entfernt die visuellen Kopien und Animationen.

Die Galaxie, Bedienelemente und Kamerafahrt werden durch diese
Textanimationen nicht bewegt oder abgedunkelt. Die bisherigen
CSS-Text-Reveal- und Titel-Keyframes sind entfernt. Es existiert weiterhin
keine gemeinsame Timeline fuer DOM, Kamera, Sprachclips und Musik.

### Slide-Regie und Zugriff auf die 3D-Engine

Die Slide-Regie in `registration-prologue.js` steuert zwei getrennte Adapter:
Motion animiert den Text; `onCamera` steuert die Kamera des vorhandenen
WebGPU-Renderers. Die Verbindung lautet:

`registration-prologue -> start-screen -> auth -> GQAuthGalaxyBackgroundControl -> StarfieldWebGPU -> PerspectiveSpaceFlight`.

Die `camera`-Eintraege unter `opening` und `teaser` in
[onboarding_prologue.json](../../config/onboarding_prologue.json) bilden das
Shot-Skript. Es wird kein zweiter Renderer und kein weiterer Animationsloop
gestartet. Die bestehenden Engine-Frames bewegen die echte Three.js-Kamera.

| Shot | Vertrag |
|---|---|
| `galaxy` | `position` und `lookAt` als drei Zahlen in Galaxieradien, `fov` in Grad (20 bis 90), positive `duration_ms`; interpoliert Position, Orientierung und Bildwinkel aus der aktuellen Pose |
| `follow` | `target.id` eines vorhandenen Schiffs, `distance` (4 bis 30), `height` (1 bis 20), `side` (-10 bis 10) in Schiffsradien, positive `duration_ms` fuer die Uebernahme der Verfolgung |
| `target` | `target` gemaess `PerspectiveSpaceFlight.resolveTarget()`, positive `duration_ms`, optional `orbit_ms`; nutzt die vorhandene kollisionsbewusste Navigation |
| `comet` | Gleiche Abstandsparameter wie `follow`; erstellt einmalig den Kometenkern und verfolgt dieselbe bewegte Entity durch alle Opening-Slides |
| `comet-world` | `destination` ist eine oeffentliche Heimatweltszene; der vorhandene Komet fliegt von seiner aktuellen Position zum naechsten System und passiert dessen Planeten in einer nahen, sonnenzugewandten Hemisphaerenansicht. Die regulaere Fahrt dauert 45 Sekunden; Textwechsel waehrenddessen unterbrechen weder Flug noch Kamera |
| `journey` | `origin` und `destination` als Registrierungsszenen, positive `duration_ms`; startet das Shuttle auf der Heimatwelt und endet im Orbit der privaten Startwelt |
| `landing` | Dieselben Szenen und das bereits angekommene Shuttle; eigener Auftrag zum vorhandenen Kolonie-Anker, erst nach ausdruecklicher Zielbestaetigung |

Der produktive Einstieg (`open({ campaign: true })`) verfolgt einen echten
3D-Kometenkern aus der bestehenden Special-Bodies-Mesh-Factory. Im gemeinsamen
Renderpass bilden eine diffuse Leuchthuelle und 96 dezente Partikel die Koma.
Ein breiter, warmer Staubschweif aus 384 Partikeln und ein schmalerer blauer
Ionenschweif aus 192 Partikeln sind getrennt modelliert.
Der Kern nutzt eine deterministische, fein deformierte Geometrie mit
Gesteins- und Eisfarbvariationen pro Vertex.
Die Kamera blickt aus dessen Innerem zum Kern; Slidewechsel aendern
die Verfolgungsperspektive, nicht den Kometen oder dessen Route.
Partikel sind Billboards, keine undurchsichtigen Kugeln: ihre Projektion
bleibt auch beim Durchfliegen endlich.

Im geladenen Sternsystem bestimmt die echte Sternposition die
sonnenabgewandte Schweifachse. Der Staub wird zusaetzlich entgegen der
Bewegungsrichtung seitlich gekruemmt; der Ionenschweif bleibt naeher an
der Sternachse. Zwischen Sternsystemen gibt es hier keine physikalisch
bestimmte antreibende Sonne: dort wird die Gegenrichtung der Kometenbewegung
als filmische Ersatzrichtung verwendet. Zwischen 100 und 50 AE Entfernung
zum geladenen Stern geht die Richtung stetig in die Sternachse ueber.
Aktivitaet, Groessen und Geschwindigkeiten sind dabei kuenstlerisch skaliert,
kein physikalisches Kometenmodell. Eine Wasserstoffhuelle wird nicht im
sichtbaren Bild dargestellt: neutrales H ist in diesem Zusammenhang vor allem
im UV nachweisbar, nicht als dritter sichtbarer Schweif.
Grundlagen: [NASA: What Is a Comet?](https://spaceplace.nasa.gov/comets/en/)
und [ESA: Structure of a comet](https://www.esa.int/ga/media/structure-of-a-comet-en-270391).
Die Billboard-Effekte nutzen den vorhandenen gemeinsamen Transparenzpass;
eine vollstaendige tiefensortierte Volumen-/Partikelokklusion ist nicht
implementiert.

Danach liefert `register_catalog.species[].homeworld_scene` oeffentliche
Szenen der sechs Spezies-Heimatwelten; `npc_homeworlds` ergaenzt die
konfigurierten NPC-Stationen Erde, Helion Prime und Verath. Fehlende
NPC-Szenen werden als `null` ausgegeben und im Ablauf sichtbar gemeldet.
Die Szenen enthalten Zieladresse, Koordinaten, Sonne und Planeten. Der `scene_key` ersetzt hier den privaten `prolog_token`;
dieser Lesezugriff reserviert keine Drafts. Derselbe Komet fliegt zwischen
den Weltkoordinaten; am Ziel passiert er den Planeten sichtbar als Besucher
und bewegt sich waehrend der Vorstellung weiter; die Kamera bleibt dabei
raeumlich an ihn gebunden. Die Nahansicht projiziert den Zielplaneten und
seine Atmosphaere anhand der Kugelkontur, damit die sichtbare Kruemmung mit
den 3D-Ankern uebereinstimmt. Prozedurale Oberflaechen und zwei als Vorschau
markierte Boden-/Orbitalobjekte sind rein kosmetisch; sie stellen keine
persistierten Anlagen oder authentische Erdgeografie dar. Die Fluege sind filmisch
skaliert, keine physikalische Simulation. Erst nach Tour/Skip werden die
bestehenden privaten Herkunfts-Drafts vorbereitet. Die Herkunftswahl zeigt
weiterhin die oeffentliche Heimatwelt, nicht vorzeitig die Startwelt.

Nach Speichern des Commanders starten Komet und Shuttle ihre Begegnung ueber
der gewaehlten Heimatwelt: ihre Bahnen kreuzen sich mit Abstand, die Kamera
wechselt im Vorbeiflug kontinuierlich vom Kometen auf das Shuttle. Das ist
ein perspektivischer Uebergang, keine Darstellung eines koerperlichen Sprungs.
War die Fahrt zur gewaehlten Welt noch nicht abgeschlossen, setzt der Komet
sie zuerst fort. Danach steuert `RegistrationVoyage` im vorhandenen
Frame-Loop Transit und Ankunft. Die Planetenpositionen stammen aus
derselben `SystemVisualizationLayer` wie die Darstellung. Der galaktische
Transit ist bewusst stilisiert: das Shuttle wird unterwegs vergroessert,
nicht physikalisch massstabsgetreu simuliert. Triebwerkspartikel skalieren
mit dem Schiff, auch auf Planetenmassstab. Die Landung richtet den Anflug
zuerst ausserhalb des Planeten auf den echten Kolonie-Anker aus und sinkt
dann entlang seiner Oberflaechennormale; sie durchquert nicht den Planetenkern.
Erst **Bestaetigen und landen**
startet den separaten Landeauftrag; anschliessend uebernimmt das bestehende
private Draft-Spiel/Tutorial. Eine aktive Kolonie entsteht dadurch nicht.
Es wird das vorhandene private Startsystem verwendet; Neuauswahl oder
Neugenerierung sind noch nicht implementiert.

Direkte Prolog-Aufrufe ohne `campaign: true` behalten den bisherigen
Teaser-/Tutorialpfad. Dort wird `registration-transfer` auf die aktuelle
Transferschiff-Entity aufgeloest.

System-/Planetenschritte adressieren das ausgewaehlte private Draft-System.
Der Oberflaechenschritt adressiert den vorhandenen Kolonie-Anker des
ausgewaehlten Planeten, nicht nur dessen Mittelpunkt. Das ist eine kosmetische
Kolonie-/Landeplatz-Vorschau, kein Zugriff auf eine aktive Spielerwelt.
Asteroiden sind mit `target: { kind: 'asteroid', position: ... }`
adressierbar, sofern sie im geladenen Szenengraph vorhanden sind; der
aktuelle Vorspann erfindet dafuer keine Objekte oder oeffentlichen Drafts.
Der Asteroid-Shot ist damit ein verfuegbarer Baustein, kein bereits
geschriebener Bestandteil des Vorspanns. `follow` verfolgt derzeit Schiffe;
eine dynamische Asteroidenverfolgung ist damit nicht gleichzusetzen.

`onCamera` bietet `play(shot)`, `pause(paused)`, `finish()` und `cancel()`.
Bei `galaxy`, `follow`, `target` und `comet` liefert `play` `true`, sobald
die Kamera den Shot uebernommen hat. Bei `journey` und `landing` bedeutet
`comet-world`, `journey` und `landing` bedeutet `true` dagegen tatsaechliche
Ankunft; Cancel liefert `false`. Vorbereitung und spaete Antworten sind
revisionsgeschuetzt; die Vorbereitung ist auf zehn Sekunden begrenzt und
ein Abbruch beendet ihr Warten sofort. Ein Wechsel verwirft den vorherigen Shot; Pause haelt
Lesetimer, Textanimation und Kamerabewegung einschliesslich Verfolgung an.
Reduzierte Bewegung setzt die Zielpose unmittelbar. Schliessen beendet die
Regie und stellt die separat gespeicherte Menueansicht wieder her.
`finish()` kann auch waehrend des Modellladens angefordert werden und setzt
die Reise nach erfolgreicher Vorbereitung an ihr Ziel. Ein Kamerafehler
beendet keine Landung erfolgreich: die UI zeigt stattdessen einen
ausdruecklichen Fortsetzungsbutton ohne Kameradarstellung.

Fehlende GPU, Szenen oder Ziele werden sichtbar und ueber `GQLog` gemeldet;
die Navigation bleibt bedienbar. `data-camera-state` zeigt `idle`, `preparing`,
`ready`, `paused` oder `unavailable`. Eine absolute, framegenaue Timeline
fuer Sprachclips und Musik ist weiterhin nicht implementiert.

Motion startet keinen zweiten Renderer und keinen eigenen Spielsimulationsloop.
Die Menueanimation benoetigt selbst kein WebGPU; die Galaxiedarstellung
bleibt davon unabhaengig. Draft-Erzeugung, Registrierung und serverseitige
Spielregeln werden durch den Animationscontroller nicht ausgefuehrt.

## Barrierefreiheit, Darstellung und Erweiterung

- **Reduce motion:** Die bestehende Einstellung wird beim Laden aus
  gespeichertem Wert oder `prefers-reduced-motion` initialisiert.
  Bei aktivierter Reduktion werden die Zustaende ohne Fahrt und
  Animationswartezeit gesetzt. Aktivieren ueber die Einstellung waehrend
  eines Laufs ruft `finish()` auf.
- **Viewport:** `overflow: clip` an Auth- und Terminalbereich verhindert,
  dass ausgeflogene Elemente die Seite verbreitern.
- **Browser:** Der Integrationspfad verwendet unter anderem Web Animations
  API, `DOMMatrixReadOnly`, `inert` und CSS `overflow: clip`.
  Alte Browser ohne diese Faehigkeiten sind nicht durch einen eigenen
  Animationspolyfill abgedeckt.
- **Neue Ziele:** Vorhandene Gruppen in `groups` erweitern und
  Eintrittsrichtung festlegen. Dynamisch spaeter erzeugte Elemente werden
  nicht automatisch in die anfangs erfasste Zielliste aufgenommen.
- **Eigenschaftskonflikte:** Moeglichst einen Container animieren, wenn das
  darin liegende Bedienelement bereits einen Hover-Transform besitzt.
  Die Navigation animiert daher ueberwiegend ihre Panel-Wrapper.
- **Erweiterte Regie:** Hybrid-Timelines oder weitere Motion-Helfer erst bei
  konkretem Bedarf importieren. Dann Bundle-Auswirkungen, Unterbrechung,
  reduzierte Bewegung und Zusammenarbeit mit dem Kameralebenszyklus pruefen.

## Diagnose und gezielte Pruefung

Am Startmenue zeigt `data-motion-state` die Zustaende `entering`, `visible`,
`exiting` und `hidden`. Animierte Ziele erhalten `data-motion-direction`
mit `left`, `right`, `top` oder `bottom`.
Diese Attribute beschreiben den Controller, nicht den Zustand der 3D-Engine.

Unit-Tests:

```powershell
npx vitest run tests\js\start-screen-motion.test.js tests\js\registration-slide-motion.test.js tests\js\start-screen.test.js tests\js\registration-prologue.test.js
```

Browserpruefung gegen einen vorhandenen lokalen Server, nach aktualisiertem
Frontend-Build und mit installiertem Playwright-Browser:

```powershell
npm run vite:build
$env:GQ_BASE_URL = 'http://127.0.0.1:8081'
npx playwright test tests\e2e\start-screen.spec.js --grep 'menu controls fly|new campaign opens' --workers=1 --reporter=line
```

Die Tests decken unter anderem Richtungen, gemeinsame Abschlussbarriere,
Unterbrechung, Mehrfachklicks, Escape, reduzierte Bewegung, Rueckkehrfokus
und den Desktop-/Mobil-Uebergang zum Vorspann ab.

## Weiterfuehrende Quellen

- [Motion: animate, Mini und Hybrid](https://motion.dev/docs/animate)
- [Motion: Installation und Einstieg](https://motion.dev/docs/quick-start)
- [Motion: MIT-Lizenz](https://github.com/motiondivision/motion/blob/main/LICENSE.md)
- [Onboarding-Prolog und Inszenierungsablauf](../gamedesign/ONBOARDING_PROLOGUE_DESIGN.md)
- [Startscreen-CSS](../../css/start-screen.css)
- [Prolog-CSS](../../css/registration-prologue.css)
