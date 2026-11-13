# TRELLIS2 Dev Toolset (GalaxyQuest)

Dieses Setup ist bewusst als **Entwickler-Toolset** gedacht, nicht als Produktions-Pipeline.

## Ziel

- TRELLIS2 lokal im Projekt verlinken unter `tools/trellis2`
- Per CLI schnell 3D-Modelle fuer GQ erzeugen
- Per WebApp iterativ prompten und Assets exportieren

## 1) Repo lokal als Link einbinden

Empfohlen (Git Submodule):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1 -UseSubmodule
```

Alternativ als normaler Clone:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1
```

Update:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_link.ps1 -Update
```

## 2) TRELLIS-Umgebung vorbereiten

Die Skripte erwarten standardmaessig eine Conda-Umgebung `trellis`.

- Standardaufruf nutzt: `conda run -n trellis python ...`
- Mit `-UseSystemPython` kann eine aktive Python-Umgebung genutzt werden.

Hinweis: TRELLIS ist primär fuer Linux + NVIDIA GPU getestet. Windows kann funktionieren, ist aber typischerweise aufwendiger in der Einrichtung.

## 3) CLI-Generierung fuer GQ

Text -> 3D (GLB + Preview):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_generate.ps1 \
  -Mode text \
  -Prompt "a modular hard-surface sci-fi cargo ship with armored hull"
```

Image -> 3D:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_generate.ps1 \
  -Mode image \
  -ImagePath "C:/path/to/concept.png" \
  -Prompt "industrial mining outpost"
```

Ausgabe standardmaessig:

- `generated/trellis2/*_text.glb` oder `*_image.glb`
- `generated/trellis2/*_preview.mp4`

## 4) WebApp starten

Image-conditioned WebApp (empfohlen):

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_webapp.ps1 -Mode image -Port 7860
```

Text-conditioned WebApp:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/trellis2_webapp.ps1 -Mode text -Port 7861
```

URLs:

- `http://127.0.0.1:7860` (Image -> 3D)
- `http://127.0.0.1:7861` (Text -> 3D)

## 5) VS Code Tasks

Es wurden folgende Tasks hinterlegt:

- `TRELLIS2: Link Repo (Submodule)`
- `TRELLIS2: Update Repo`
- `TRELLIS2: WebApp (Image->3D)`
- `TRELLIS2: WebApp (Text->3D)`
- `TRELLIS2: Generate Ship (Text CLI)`

## 6) Dev-Only Governance fuer GQ

Empfohlen fuer Team-Nutzung:

- Alle generierten Assets als **DEV_ONLY** kennzeichnen
- Uebernahme in Spiel-Content nur nach manueller Sichtung
- Keine Produktions-SLA auf Topologie/LOD/UV erwarten

So bleibt TRELLIS ein schnelles Entwickler-Werkzeug fuer Ideation, Prototyping und interne Tests.

## 7) ComfyUI-TRELLIS.2: CUDA-Architektur des Exports

Der ComfyUI-Image-to-3D-Workflow ist von den oben beschriebenen
TRELLIS-CLI-/WebApp-Skripten getrennt. TRELLIS.2 benoetigt ein Eingabebild;
ein Textprompt allein ist dort kein eigener Text-to-3D-Workflow. Generierte
Kolonie-Assets bleiben bis zur Geometrie-, Massstab-, Material- und
Sichtpruefung Entwicklungsartefakte.

Bei `no kernel image is available for execution on the device` oder
`Cuda error: 209` koennen einzelne CUDA-Erweiterungen fuer eine andere GPU
gebaut worden sein. Das kann erst beim Export auftreten, obwohl die
Modellinferenz funktioniert. Die Compute Capability laesst sich mit
`torch.cuda.get_device_capability()` pruefen; `cuobjdump --list-elf` und
`--list-ptx` zeigen die tatsaechlich enthaltenen GPU-Architekturen einer
Erweiterung. Ein Wheel muss zudem zu Python, PyTorch, CUDA und der
C++-Laufzeit passen; die richtige GPU-Architektur allein genuegt nicht.

Auf einer RTX 3060 (`sm_86`) mit Python 3.12 und PyTorch 2.9.1+cu128
enthielten die verwendeten Torch291-Wheels fuer `flex_gemm` und
`nvdiffrast` nur `sm_120`. Neu gebaute Erweiterungen fuer `sm_86` wurden
in einem getrennten Testprozess geprueft: ein Sparse-Grid-Sample und ein
Rasterisierungsdreieck waren erfolgreich. Auch ein TRELLIS.2-Lauf mit
Vertexfarben- und UV-/PBR-Export beendete sich ohne CUDA-Fehler, aber die
Dateien bestanden die Inhaltspruefung nicht: alle Vertexfarben waren
schwarz und beide PBR-Texturen enthielten ausschliesslich Nullwerte.
Vertexfarben sind ohnehin keine PBR-Texturen. Dies ist kein
Kompatibilitaetsnachweis fuer andere GPU-Modelle, Torch-Versionen oder
alle Nodes; die Testdateien sind keine freigegebenen Koloniegebaeude.

Am 2026-11-13 bestand das vorhandene `nvdiffrast`-Wheel fuer `sm_86`
zusaetzlich einen isolierten Test in einem kurzlebigen Python-3.12-Container
mit PyTorch 2.9.1+cu128 auf der RTX 3060: der CUDA-Rasterkontext wurde
erzeugt und ein Dreieck deckte 72 Pixel ab. Der Container nutzte das Wheel
read-only und wurde anschliessend entfernt. Dies bestaetigt nur den
Raster-Kernel in dieser Kombination, nicht den vollstaendigen
ComfyUI-Texturierungsworkflow oder die Qualitaet eines exportierten GLB.
Ein zweiter ComfyUI/TRELLIS-Prozess wurde nicht gestartet: Die laufende
ComfyUI-Instanz teilt dieselbe 12-GiB-GPU; bei der Pruefung waren laut
`nvidia-smi` nur 9.102 MiB frei. Die gemeinsam genutzte Instanz und ihre
installierten Wheels blieben unveraendert. Ein vollstaendiger PBR-Lauf
bleibt offen und erfordert einen isolierten Lauf mit ausreichender
GPU-Kapazitaet oder ein kontrolliertes Wartungsfenster.

Im verwendeten lokalen CPU-Mesh-Fallback war zusaetzlich der Ursprung
verschoben: Die rekonstruierten Vertices werden als `coords / resolution`
ausgegeben, der Textur-Sampler erwartet dagegen den Mesh-Ursprung
`[-0.5, -0.5, -0.5]`. Mit einer Korrektur allein erhielten im vollstaendigen
Stations-Test nur 3,2 % der vereinfachten Vertices Nicht-Schwarz. Der
Fallback ist damit nicht als texturierter Produktionsweg validiert.

Auch die installierte `o_voxel`-CUDA-Erweiterung enthielt nur `sm_120`.
Mit einem ebenfalls fuer `sm_86` gebauten nativen Modul konnte in einem
isolierten Testprozess die native, nicht gekachelte Dual-Grid-Rekonstruktion
anstelle des lokalen CPU-Fallbacks ausgefuehrt werden. Im Stations-Test
waren danach alle vereinfachten Vertexfarben ungleich Schwarz; Basisfarben-
und Metallic/Roughness-Textur enthielten ebenfalls Daten. Der Test verwendete
die vorhandenen Python-Wrapper mit dem neu gebauten nativen Modul, nicht
eine ungepruefte Installation des gesamten upstream-Wheels. Insbesondere
muss die API-Kompatibilitaet der Wrapper beim Umstieg gesondert geprueft
werden. Der lokale Fallback im veraenderten Submodul wurde nicht umgestellt.

Ein anschliessend erzeugtes Habitat-Testmodell aus einer schematischen
Einzelgebaeude-Vorlage zeigte im Three.js-Preview Fenster und Dach, aber
auch ein frei schwebendes dunkles Teil. Es ist kein freigegebenes Asset:
Vor dem Einsatz sind visuelle Kontrolle, Bereinigung von Artefakten,
Massstab, Orientierung, LOD und Tests beider Kolonieansichten erforderlich.
Diese Offline-Tests aendern weder die Produktionsrenderer noch deren
deterministische Platzierung.

Fuer diesen Habitat-Prototyp wurde das sichtbare schwebende Fragment in
einer separaten Kopie gezielt entfernt: 234 von 19.020 Dreiecken, rund
1,49 % der Oberflaeche. Fuer die Komponentenanalyse wurden Positionen
auf einer Analysekopie ueber UV- und Normalen-Naehten zusammengefuehrt;
die exportierte Geometrie wurde nicht verschmolzen. Die Auswahl wurde
anhand der konkreten Komponenten-Bounds und Flaechenzahl abgesichert.
Die verbleibenden Vertices und UVs entsprechen nach Reimport dem Original;
die Originalnormalen wurden explizit mitexportiert und bis auf
Float-Rundung verifiziert. Die Pixel der beiden 512 x 512 Basisfarben-
und Metallic/Roughness-Texturen blieben unveraendert. Die Bounds schrumpften
von etwa `1,001 x 0,628 x 0,503` auf `0,410 x 0,628 x 0,503`:
Vorher haette das Fragment also eine massstabsbezogene Ausrichtung
verfaelschen koennen.

Der bereinigte Export hat noch 18.786 Dreiecke und 16 nach obiger Methode
analysierte Face-Komponenten, darunter zwei grosse. Kleinere Komponenten
koennen legitime Gebaeudeteile sein; sie duerfen nicht pauschal entfernt
werden. Die Three.js-Pruefung von zwei Seiten zeigte weiterhin einen
dunklen Dachfleck und verzerrte Fassadendetails. Die Bereinigung ist
ein einmaliger Versuch, keine allgemeine automatische Freigabe. Ein
nichtschwarzes PBR-Ergebnis oder eine bestandene Fragmentkontrolle ersetzt
weder Material- und Topologiepruefung noch Bodenkontakt, Orientierung,
physikalischen Massstab, LOD und Tests beider Ansichten.

Fuer den reproduzierbaren Neubau muessen CUDA-12.8-Compiler und Header,
der zur Zielinstallation passende PyTorch-Build, `ninja`, `setuptools`
und `wheel` in einer **separaten Buildumgebung** vorhanden sein. Fuer
den genannten Test wurden folgende upstream-Quellstaende verwendet:

| Erweiterung | Repository | Commit |
|---|---|---|
| FlexGEMM | `https://github.com/JeffreyXiang/FlexGEMM.git` | `74c3f686260f648cbd054c0b143b783838884bbe` |
| nvdiffrast | `https://github.com/NVlabs/nvdiffrast.git` | `253ac4fcea7de5f396371124af597e6cc957bfae` |
| o-voxel | `https://github.com/microsoft/TRELLIS.2.git` | `75fbf0183001ed9876c8dbb35de6b68552ee08bd` |

Der FlexGEMM-Stand wurde anhand der vier im Test-Wheel enthaltenen
CUDA-/C++-Quelldateien abgeglichen; fuer o-voxel wurde der upstream-Stand
inklusive seines gepinnten Eigen-Submoduls verwendet. In der Buildumgebung setzt
`TORCH_CUDA_ARCH_LIST=8.6` das Testziel; `CUDA_HOME` muss auf das passende
Toolkit zeigen. Anschliessend lassen sich die jeweiligen ausgecheckten
Quellbaeume jeweils mit
`python -m pip wheel --no-build-isolation --no-deps --wheel-dir <ziel> .`
bauen. Bei fehlenden CUDA-Bibliotheks-
Headern muss der Include-Pfad zu den passenden CUDA-12-PyTorch-Abhaengigkeiten
gesetzt werden; CUDA-13-Header duerfen nicht versehentlich bevorzugt werden.

Wheels nicht ungeprueft in einen laufenden, gemeinsam genutzten Dienst
installieren. Erst in einer isolierten Umgebung gegen die konkrete
Zielversion und GPU testen und danach gegebenenfalls das Image gezielt
aktualisieren. Auch ein zweiter Testserver benoetigt eine eigene Datenbank
und kann erhebliche RAM- und GPU-Ressourcen belegen.

## 8) Wiederholbare Offline-Inspektion und DEV-Import

`scripts/trellis2_inspect.py` untersucht vorhandene GLBs ohne GPU oder
TRELLIS-Inferenz. Es aendert keine Geometrie, UVs, Normalen oder Materialien
und entfernt keine Komponenten. Eine separate Python-Umgebung vermeidet
Aenderungen am gemeinsam genutzten ComfyUI-Dienst:

```powershell
python -m venv .venv-trellis-inspect
.\.venv-trellis-inspect\Scripts\python.exe -m pip install -r scripts\requirements-trellis-inspect.txt
.\.venv-trellis-inspect\Scripts\python.exe scripts\trellis2_inspect.py generated\trellis2\hydroponics.glb --facility-kind hydroponics
pwsh -NoProfile -File scripts\trellis2_import.ps1 -SourceGlb generated\trellis2\hydroponics.glb -AssetType building -FacilityKind hydroponics -Variant hydroponics_pilot
```

Unterstuetzt werden GLB-2-Dreiecksszenen mit eingebetteten Puffern und
Bildern ohne erforderliche glTF-Erweiterungen. Externe Ressourcen, etwa
Textur-URLs, werden abgewiesen. Nicht unterstuetzte oder unlesbare Eingaben
beenden den CLI-Aufruf mit Exitcode 1 und einem strukturierten Fehler.
Exitcode 0 bedeutet nur, dass der Bericht geschrieben wurde, **nicht**,
dass das Asset die Sichtpruefung bestanden hat.

`scripts/trellis2_clean_mesh.py` erstellt eine neue GLB-Kopie und entfernt
ausschliesslich Dreiecke mit exakt null Flaeche. Die Quelldatei bleibt
unveraendert; existierende Ausgaben werden nicht ueberschrieben. Der Schritt
loescht keine getrennten Komponenten, repariert keine UVs, erzeugt keine
Normalen und erstellt keine PBR-Materialien. Jede bereinigte Datei muss erneut
mit `trellis2_inspect.py` geprueft werden und bleibt bis zur Sichtpruefung
DEV_ONLY:

```powershell
.\.venv-trellis-inspect\Scripts\python.exe scripts\trellis2_clean_mesh.py generated\comfyui\output\gq_trellis2\building_hospital_pilot_v1_00001_.glb --facility-kind hospital
.\.venv-trellis-inspect\Scripts\python.exe scripts\trellis2_inspect.py generated\comfyui\output\gq_trellis2\building_hospital_pilot_v1_00001__zero_area_cleaned.glb --facility-kind hospital
```

Der Bericht `<name>_inspection.json` enthaelt:

- Schema `gq.trellis-inspection.v2`, Asset-Typ, optionale Facility-Klasse,
  SHA-256 der untersuchten GLB-Bytes und unveraenderlich `status: DEV_ONLY`.
- Eine gesetzte Facility-Klasse muss beim Import uebereinstimmen. Berichte
  ohne oder mit einer anderen Klasse koennen nicht unter dem falschen Typ
  importiert werden. V1-Berichte ohne die Typfelder werden abgelehnt und
  muessen mit dem Inspektor neu erzeugt werden.
- Dateigroesse, Instanzzahl und Szenen-Bounds inklusive Node-Transformationen;
  Mesh-Dreiecke und Komponenten werden pro eindeutiger Geometrie gezaehlt,
  nicht pro Instanz.
- Komponenten mit Dreieckszahl, Flaechenanteil und lokalen Bounds.
  Nur exakt gleiche Positionen werden fuer die Analyse zusammengefuehrt;
  UV-Naehtenduplikate werden damit nicht als abgesetzte Teile fehlgedeutet,
  kleine echte Luecken bleiben erhalten. Auch getrennte legitime Bauteile
  erzeugen einen Pruefhinweis, keine automatische Loeschentscheidung.
- Nullflaechen, fehlende/ungueltige UVs, fehlende `NORMAL`-Attribute sowie
  fehlende PBR-Texturen, schwarze Basisfarbtexturen und schwarze Farbfaktoren.
  Das Vorhandensein eines Normalen-Attributs belegt noch keine korrekte
  Normalenrichtung.
- Texturdimensionen, RGB-Minima/Maxima und Nicht-Schwarz-Anteil der gesamten
  Textur. Letzterer ist **keine UV-Farbdeckungspruefung**; ungenutzte Texel
  sind enthalten. Fehlende Texturen koennen bei absichtlich untexturierten
  Materialien legitim sein.
- Weiterhin erforderliche manuelle Pruefungen: Optik/Material, physikalischer
  Massstab, Orientierung/Bodenkontakt, LOD/Renderbudget und beide
  Kolonieansichten.

Der PowerShell-DEV-Import kopiert einen vorhandenen Inspection-Sidecar nur
bei passendem Schema, DEV_ONLY-Status und Quellhash. Ein veralteter Bericht
bricht den Import vor dem Ueberschreiben des Zielmodells ab. Beim
Ueberschreiben ohne neuen Inspection-Bericht wird der alte Zielbericht
entfernt. Ein Import ohne Inspection bleibt aus Kompatibilitaetsgruenden
moeglich, gibt aber eine ausdrueckliche Warnung aus. Der bisherige
`_quality.json`-Bericht der TRELLIS-CLI bleibt davon getrennt und ist
ebenfalls keine Produktionsfreigabe. Die Facility-Klasse wird ausserdem
im JSONL-Importlog festgehalten; eine Klasse mit einem Nicht-Gebaeude-
Assettyp wird bereits vor dem Kopieren abgewiesen.

Am Habitat-Piloten wurden 17 Komponenten vor und 16 nach der gezielten
Fragmententfernung gemessen. Der bereinigte Export hat gueltige UVs,
vorhandene Normalen-Attribute und farbige PBR-Texturen, aber weiterhin eine
Nullflaeche sowie den manuellen Mehrkomponenten-Pruefhinweis. Dach- und
Fassadenartefakte bleiben eine Aufgabe der Sichtpruefung.

Regressionstests ohne GPU:

```powershell
.\.venv-trellis-inspect\Scripts\python.exe -m unittest discover -s tests\scripts -p test_trellis2_inspect.py
.\.venv-trellis-inspect\Scripts\python.exe -m unittest discover -s tests\scripts -p test_trellis2_clean_mesh.py
npx vitest run tests\js\trellis2-import.test.js
```

Die Importtests benoetigen `pwsh`; ohne dieses werden sie uebersprungen.

## 9) Kolonie-Gebaeudefamilien fuer TRELLIS-Prototypen

Die Produktionsplanung in `js/rendering/colony-surface-plan.js` kennt
16 eigenstaendige oberflaechengebundene Facility-Archetypen. Das Habitat
ist eine separate Wohn-/Siedlungsdarstellung und wird nicht in diese
16 Typen hineingerechnet. Die TRELLIS-Ausgabe enthaelt DEV_ONLY-Piloten fuer
`warehouse`, `drilling` und `hydroponics`; sie sind noch nicht in den
Produktionsrenderer oder den Facility-Planer eingebunden. Habitat-Konzeptbilder sind keine
Farm-, Minen- oder Fabrikreferenzen.

| Gruppe | Facility-Klassen | Bild-/Formziel fuer einen Einzelasset-Piloten |
|---|---|---|
| Landwirtschaft | `agriculture`, `hydroponics` | Freiland-Module mit Feldreihen und Scheune; separat ein Glas-Gewachshaus mit klar lesbaren Technikgaengen |
| Energie und Stoffe | `solar`, `fusion`, `terraforming`, `tank`, `silo` | Flache Solarpanel-Reihen plus Wechselrichter; Reaktorkern mit Kuehlung; Behandlungskern; klar getrennte Tanks bzw. Silos |
| Industrie und Gewinnung | `industry`, `nanotech`, `drilling`, `warehouse` | Fabrikhalle mit Schornstein; Reinraum-/Lufttechnik; Bohrturm auf Arbeitsplattform; Lagerhalle mit Ladetoren |
| Zivile Infrastruktur | `research`, `hospital`, `school`, `command`, `security` | Labor mit Instrument, Klinik mit Lande-/Dachmarkierung, Campus, Kommandohaus sowie eingezaeunte Sicherheitsstation |
| Wohnen | `habitat` | Mehrgeschossiger Wohnblock; bleibt als separater Typ gefuehrt |

Die 16 Oberflaechenklassen entsprechen dem produktiven Planer; insbesondere
`drilling` ist nicht das terrassierte Tagebaubecken. Der Tagebau bleibt das
separate, massstaeblich aus dem realen Gelaende generierte Mining-Landschafts-
Feature und sollte nicht durch ein aufgesetztes TRELLIS-Lochmodell ersetzt
werden.

Sechzehn getrennte Bildreferenzen liegen unter
`generated/trellis2/references/`, jeweils als `*_concept_v1.png` und
im Manifest per SHA-256 einer Facility-Klasse zugeordnet:
`agriculture`, `hydroponics`, `industry`, `warehouse`, `tank`, `silo`,
`solar`, `fusion`, `research`, `nanotech`, `hospital`, `school`, `command`,
`security`, `terraforming` und `drilling`. Damit besitzt jede der 16
Oberflaechenklassen aus dem Produktionsplaner ein eigenes Bildmotiv. Sie
decken Freilandkulturen, Glas/Innenstruktur, Fabrik und Lagerlogistik,
Fluessig- und Schuettgutlager, flache Solartechnik, Reaktorkuehlung,
Forschung, Reinraumtechnik, zivile Dienste und Rohstoffbohrung ab. Das
Habitat bleibt separat und wird nicht als Facility-Klasse gezaehlt.

Die Referenzen sind Designvorlagen, generisch und nicht massstabkalibriert.
Fuer `warehouse`, `drilling` und `hydroponics` wurden einzelne Bild-zu-3D-
Piloten auf derselben isolierten RTX-3060-Umgebung erzeugt. Die ausgewaehlten, mit
Normalen vervollstaendigten Varianten und ihre hashgebundenen
Inspection-Sidecars sind:

Ein lokaler `industry`-Erzeugungsversuch vom 2026-11-12 lief nach Wechsel
von `flex_gemm` auf `spconv` erfolgreich durch und erzeugte ein GLB-2 mit
8.848.412 Bytes. Die Offline-Inspektion fand 490.202 Dreiecke, 35.181
Nullflaechen, 39.535 Face-Komponenten, keine gueltigen UVs, keine
Normalenattribute und kein PBR-Material. Dieses unverarbeitete Ergebnis
bleibt ausserhalb des DEV-Imports und erweitert nicht die Zahl der
sichtgeprueften Pilot-Assets.

Ein mesh-only-Erzeugungsversuch fuer `agriculture` vom 2026-11-13 erzeugte
`building_agriculture_pilot_v1_00001_.glb` (8.683.252 Bytes). Die
Offline-Inspektion fand 480.326 Dreiecke, 101.025 Nullflaechen, 122.892
Face-Komponenten, ungueltige UVs, keine Normalenattribute und kein
PBR-Material. Auch dieses Ergebnis bleibt unimportiert und ist kein
Referenz-Pilot.

| Facility | DEV-Asset | Pruefergebnis |
|---|---|---|
| `warehouse` | `building_generic_warehouse_pilot_v2_normals_lod0_trellis2_dev.glb` | 15.000 Dreiecke, gueltige UVs, farbige 1024²-Basisfarbe und Metallic/Roughness; kein Normalenbefund. Ein separates 8-Dreiecke-Fragment bleibt zur manuellen Beurteilung erhalten. |
| `drilling` | `building_generic_drilling_pilot_v2_normals_lod0_trellis2_dev.glb` | 15.000 Dreiecke, gueltige UVs, farbige 1024²-PBR-Texturen; kein Normalenbefund. Zehn Face-Komponenten, davon eine mit 14.696 Dreiecken; kleine getrennte Komponenten bleiben ohne eindeutigen Artefaktnachweis erhalten. |
| `hydroponics` | `building_generic_hydroponics_pilot_v2_normals_lod0_trellis2_dev.glb` | 15.000 Dreiecke, 11.246 Vertices, gueltige UVs und farbige 1024²-PBR-Texturen; kein Normalenbefund. Drei Face-Komponenten (14.966, 28 und 6 Dreiecke); kleine Komponenten bleiben ohne eindeutigen Artefaktnachweis erhalten. |

Die `v2_normals`-Exporte ergaenzen aus der Mesh-Geometrie berechnete
Normalen. Dabei wurden Face-/Vertex-Geometrie, UV-Koordinaten und beide
PBR-Texturen pixelgenau gegen den jeweiligen `v1`-Export verifiziert; dies
gilt auch fuer den Hydroponik-Export.
Die Dateien bleiben **DEV_ONLY**: physikalischer Massstab,
Bodenkontakt, LOD/Renderbudget und Integration in beide Kolonieansichten
sind weiterhin offen. Fuer alle 13 Facility-Klassen ausserhalb der drei
akzeptierten Piloten gibt es nun Mesh-only-GLBs. Die Kandidaten bleiben
nicht akzeptiert und DEV_ONLY, bis ihre Inspector-Befunde, Optik,
physikalischer Massstab, Bodenkontakt, LOD/Renderbudget und beide
Kolonieansichten vollstaendig geprueft sind.

Manifest-Schema, eindeutige Klassen, PNG-Aufloesung und Bildhashes sind
lokal pruefbar. Weitere Bildlaeufe in einer isolierten Umgebung getrennt
ausfuehren, resultierende GLBs mit `--facility-kind` klassifizieren und
Sichtpruefung sowie offene Inspector-Befunde vor jedem DEV-Import
dokumentieren.
Das terrassierte Tagebaubecken bleibt ein separates, massstaeblich aus dem
realen Gelaende generiertes Feature; `drilling` ist lediglich eine Bohr-
und Extraktionsanlage, kein Ersatz dafuer.

### Browser-Vorschau der vorhandenen Gebaeude-Piloten

`tools/earth-reference.html` kann die drei vorhandenen `warehouse`-,
`drilling`- und `hydroponics`-DEV_ONLY-GLBs im Three.js-WebGPU-
Basisvergleich laden. Die Modelle werden nur bei Aktivierung nachgeladen,
auf eine frei gewaehlte Darstellungsbreite normiert und am synthetischen
Berlin-Referenzstandort auf der glatten Kugel gezeigt. Die Breite ist kein
Nachweis des realen Modellmassstabs; die Ansicht prueft weder Kontakt mit
ETOPO-Relief noch LOD, Produktionsbudget oder beide Kolonieansichten.
Eine Browserpruefung lud alle drei GLBs erfolgreich (HTTP 200) und zeigte sie
bei 250 m angenommener Breite im Viewport. Das bestaetigt nur Loader und
Darstellung der DEV-Vorschau, keine visuelle Assetfreigabe.

Die Vorschau ist absichtlich nicht mit `PersistentBodyPlanetApproachRenderer`
verbunden. Dieser bleibt beim bestehenden deterministischen, prozeduralen
Facility-Plan. Erst nach dokumentierter manueller Pruefung von Optik,
physikalischem Massstab, Orientierung/Bodenkontakt, LOD und beiden
Kolonieansichten kann ein einzelnes Asset separat fuer eine Produktions-
integration bewertet werden.

Die separate TRELLIS-Auswahl bietet neben den drei Inspektionspiloten auch
bereinigte Rohkandidaten fuer `agriculture`, `command`, `fusion`, `hospital`,
`nanotech`, `research`, `school`, `security`, `silo`, `solar`, `tank` und
`terraforming` an. Sie werden nur im Basisvergleich und erst nach Aktivierung
geladen; die Auswahl markiert sie als unfreigegebene DEV_ONLY-Kandidaten.
Das unbereinigte Industry-Rohmodell mit 490.202 Dreiecken bleibt wegen des
fehlenden kontrollierten LOD ausserhalb der Vorschau. Ein frueherer
Browserlauf zeigte Hospital sichtbar im Basisvergleich. Bei der spaeteren
Browserpruefung war kein WebGPU-Adapter verfuegbar; die elf Kandidaten
ausserhalb Hospital sind daher nicht visuell bestaetigt. Auch Optik,
Massstab und Produktionsqualitaet aller Rohkandidaten bleiben offen.
Ein separater lokaler Delivery-Smoke-Test bestaetigte fuer alle zwoelf
gelisteten Kandidaten HTTP 200 und einen `glTF`-Header; die Earth-Vorschau
startet und uebertraegt die Dateien, aber dies ist keine visuelle Abnahme.

### Einzelne Facility aus einer Referenz generieren

`scripts/trellis2_generate_facility.mjs` verwendet den verifizierten
Referenzmanifest-Eintrag und den aktiven ComfyUI-TRELLIS.2-Image-to-GLB-
Graphen aus `tools/comfyui-trellis2/example_workflows/MeshOnly.json`. Fuer
den RTX-3060-Container setzt der API-Graph `spconv` statt des Beispiel-
Workflows-Backends `flex_gemm`: dessen 1024-Cascade-Kernel endete mit
`no kernel image is available for execution on the device`; der installierte
`spconv`-CUDA-Pfad besteht einen lokalen SparseConv-Smoke-Test.
Der Standardaufruf ist ein Dry-Run:

```powershell
node scripts/trellis2_generate_facility.mjs --kind industry
node scripts/trellis2_generate_facility.mjs --kind industry --preflight
node scripts/trellis2_generate_facility.mjs --kind industry --textured --preflight
```

Eine GPU-Inferenz wird nur mit `--submit` gestartet. Das Skript prueft
Manifest- und Bildhash, die vorhandenen ComfyUI-Nodes und eine leere Queue,
laedt die Referenz mit einem hashgebundenen Dateinamen hoch und reiht genau
einen Job ein. Ergebnisse bleiben in `generated/comfyui/output/` und werden
nicht automatisch importiert:

```powershell
node scripts/trellis2_generate_facility.mjs --kind industry --submit
node scripts/trellis2_generate_facility.mjs --kind industry --textured --submit
python scripts/trellis2_inspect.py generated/comfyui/output/<relative-glb>.glb --facility-kind industry
```

`--textured` verwendet den Low-Poly-Zweig des vorhandenen ComfyUI-Beispiel-
Workflows: 5.000 Ziel-Dreiecke, Mesh-Texturierung mit 1024er Modellauflosung
und 2048er PBR-Texturen. Diese Werte wurden gegen die aktive ComfyUI-Node-
Schema geprueft. Der Export erhaelt den getrennten Namenszusatz
`_lowpoly_textured`. Mesh-only reduziert jetzt auf 15.000 Zieldreiecke,
passend zum Umfang der drei akzeptierten Piloten; der Texturierungspfad
behaelt sein 500.000er Zwischenmesh und das finale 5.000-Dreiecke-Ziel.

Mit dem 15.000er Mesh-only-Ziel wurden am 2026-11-13 zwei weitere
Referenzkandidaten erzeugt. `agriculture` (`building_agriculture_pilot_v1_00002_.glb`,
307.668 Bytes) hat 14.974 Dreiecke, aber 755 Nullflaechen und 237
Face-Komponenten. `solar` (`building_solar_pilot_v1_00001_.glb`, 364.952
Bytes) hat 14.958 Dreiecke, 2.505 Nullflaechen und 1.119 Komponenten.
Beide Exporte haben keine Normalenattribute, UVs oder PBR-Materialien und
bleiben daher unimportierte Roh-DEV_ONLY-Kandidaten.

Der Offline-Cleaner wurde auf separaten Agriculture- und Solar-Kopien
ausgefuehrt. `agriculture` hat danach 14.219 Dreiecke, 18 Komponenten und
keine Nullflaechen; `solar` 12.453 Dreiecke, 88 Komponenten und keine
Nullflaechen. Beide behalten ungueltige UVs, fehlende Normalenattribute und
fehlende PBR-Materialien. Die Quellen wurden nicht veraendert.

Die Offline-Inspektion des vorhandenen Industry-Rohmodells fand 490.202
Dreiecke und 35.181 Nullflaechen in einer 8.848.412 Bytes grossen GLB-Datei.
Nach Nullflaechenbereinigung verblieben voraussichtlich weiterhin ueber
455.000 Dreiecke; deshalb wurde kein Cleanup oder Vorschauimport
durchgefuehrt. Ein kontrollierter Low-Poly-/LOD-Export ist erforderlich.

Ein mesh-only-Tanklauf erzeugte
`building_tank_pilot_v1_00001_.glb`. Die Offline-Inspektion fand 14.912
Dreiecke, 8.470 Nullflaechen und 5.100 Face-Komponenten; UVs sind ungueltig,
Normalenattribute und PBR-Materialien fehlen. Die Datei bleibt ein
unimportierter Roh-DEV_ONLY-Kandidat. Die hohe Zahl an Nullflaechen und
Komponenten verhindert eine Freigabe ohne Geometriebereinigung und erneute
Inspektion.

Ein mesh-only-Hospitallauf erzeugte
`building_hospital_pilot_v1_00001_.glb`. Die Inspektion fand 14.962
Dreiecke, 8.898 Nullflaechen und 9.084 Face-Komponenten; UVs sind ungueltig,
ein Primitiv hat keine Normalenattribute und PBR-Materialien fehlen. Ein
Hauptmesh enthaelt 5.000 Dreiecke und rund 99,9 % der Flaeche, die Datei
bleibt dennoch ein unimportierter Roh-DEV_ONLY-Kandidat.

Der Offline-Cleaner wurde an separaten Tank- und Hospital-Kopien geprueft.
Er entfernte exakt die 8.470 bzw. 8.898 Nullflaechen; danach blieben 6.442
Tank-Dreiecke mit 283 Komponenten und 6.064 Hospital-Dreiecke mit 928
Komponenten. Beide bereinigten GLBs enthalten keine Nullflaechen mehr, aber
weiterhin keine gueltigen UVs, Normalenattribute oder PBR-Materialien. Die
Originale blieben hashidentisch; keine Komponente wurde automatisch entfernt.
Die Kandidaten bleiben deshalb unimportiert. Weitere Klassen koennen
weiterhin einzeln und seriell als Roh-DEV_ONLY-Ausgaben erzeugt werden; jede
Datei muss bereinigt, erneut inspiziert und visuell bewertet werden. Es gibt
weiterhin keine Produktionsrenderer- oder Engine-Integration.

Ein mesh-only-Silolauf erzeugte
`building_silo_pilot_v1_00001_.glb` mit 14.882 Dreiecken, davon 7.423
Nullflaechen. Die separate bereinigte Kopie
`building_silo_pilot_v1_00001__zero_area_cleaned.glb` hat 7.459 Dreiecke,
keine Nullflaechen und 1.056 Face-Komponenten. UVs, Normalenattribute und
PBR-Materialien fehlen weiterhin. Original und bereinigte Kopie bleiben
unimportierte DEV_ONLY-Kandidaten.

Ein erneuter Mesh-only-Lauf fuer `industry` mit dem 15.000er Ziel
ueberschritt am 2026-11-13 das 60-Minuten-Wartefenster ohne GLB-Ausgabe.
ComfyUI meldete den Prompt danach weiterhin als laufend, ohne wartende Jobs
und mit nur 68 MiB freiem GPU-Speicher; ein Interrupt-Aufruf beendete ihn
nicht. Bei der Fortsetzung wurde der spezifische Container
`galaxyquest-comfyui` gezielt neu gestartet; danach war der Dienst gesund,
die Queue leer und die GPU wieder verfuegbar. Der Industry-Lauf wurde nicht
wiederholt; der neue Tanklauf blieb ein einzelner serieller Job.

Ein mesh-only-Lauf fuer `fusion` wurde am 2026-11-13 mit
`--kind fusion --submit` gestartet, endete nach 600 Sekunden aber ohne
vom Generator erkannte GLB-Ausgabe. Der ComfyUI-Prompt
`684b4808-9b13-4ee7-bf1c-95baa637a8fd` lief bei der anschliessenden
read-only-Pruefung weiter; die Queue enthielt einen laufenden und keinen
wartenden Job. Die RTX 3060 meldete dabei 5.503 MiB freien VRAM und 90 %
Auslastung. Der Dienst und Prompt wurden nicht unterbrochen oder neu
gestartet; bis zur Freigabe der Queue darf kein weiterer Inferenzjob
gestartet werden. Nach spaeterem Queue-Leerlauf bestaetigte die History den
Prompt als erfolgreich, enthielt aber keine Output-Metadaten. Ein weiterer
einzelner Versuch mit Prompt
`3b875f40-8645-4ff2-b3f9-fc99374555d6` endete ebenfalls ohne vom Generator
erkannten Export; auch dessen History meldete spaeter `success` bei leerem
`outputs`-Objekt. Beide Jobs zeigten nur `execution_start`,
`execution_cached` und `execution_success`. Die Datei
`building_fusion_pilot_v1_00001_.glb` war dennoch vorhanden (335.504 Bytes,
14.990 Dreiecke), davon 13.100 Nullflaechen und 13.002 Komponenten; gueltige
UVs und PBR fehlten, bei einem Primitiv fehlten Normalenattribute. Der
separate Offline-Cleanup entfernte nur die Nullflaechen. Die bereinigte
Kopie hat 1.890 Dreiecke, null Nullflaechen und 559 Komponenten, aber
weiterhin keine gueltigen UVs, Normalenattribute oder PBR-Materialien.
Quelle und Kopie bleiben DEV_ONLY und unfreigegeben.

Ein mesh-only-Lauf fuer `research` wurde am 2026-11-13 gestartet. Die
ComfyUI-Queue meldete den Prompt `e88c8f01-c1e1-4cdb-8336-d7f0e9b20400`
18 Minuten spaeter als abgeschlossen; die History meldete `success`, aber
keine Output-Metadaten. Der GLB
`building_research_pilot_v1_00001_.glb` war vorhanden (326.864 Bytes,
14.972 Dreiecke und 12.900 Nullflaechen). Der separate Cleaner entfernte
ausschliesslich diese Faces. Die bereinigte Kopie hat 2.072 Dreiecke,
252 Komponenten und keine Nullflaechen; gueltige UVs, Normalenattribute und
PBR-Materialien fehlen weiterhin. Beide Dateien bleiben unimportierte
DEV_ONLY-Kandidaten.

Ein mesh-only-Lauf fuer `command` wurde am 2026-11-13 mit Prompt
`d84ec9d3-4762-4e21-b2e0-02904d64f6ef` gestartet und nach 13 Minuten
erfolgreich abgeschlossen. Die Rohdatei `building_command_pilot_v1_00001_.glb`
hat 14.994 Dreiecke, davon 12.956 Nullflaechen. Der separate Cleanup
entfernte ausschliesslich diese Faces. Die bereinigte Kopie hat 2.038
Dreiecke, 773 Komponenten und null Nullflaechen; gueltige UVs,
Normalenattribute und PBR-Materialien fehlen weiterhin. Quelle und Kopie
bleiben unimportierte DEV_ONLY-Kandidaten.

Ein mesh-only-Lauf fuer `security` wurde am 2026-11-13 mit Prompt
`e7275072-a273-4764-9351-4c856a375246` gestartet und nach 12 Minuten
24 Sekunden erfolgreich abgeschlossen. Die Rohdatei
`building_security_pilot_v1_00001_.glb` hat 14.978 Dreiecke, davon 13.025
Nullflaechen. Der separate Cleanup entfernte ausschliesslich diese Faces.
Die bereinigte Kopie hat 1.953 Dreiecke, 925 Komponenten und null
Nullflaechen; gueltige UVs, Normalenattribute und PBR-Materialien fehlen
weiterhin. Quelle und Kopie bleiben unimportierte DEV_ONLY-Kandidaten.

Ein mesh-only-Lauf fuer `terraforming` wurde am 2026-11-13 mit Prompt
`9d572826-1b6e-4542-b70c-e988e71706ee` gestartet und erfolgreich
abgeschlossen. Die Rohdatei hat 14.976 Dreiecke, 11.324 Nullflaechen und
10.674 Komponenten. Der separate Cleaner entfernte ausschliesslich die
Nullflaechen; die bereinigte Kopie hat 3.652 Dreiecke, 540 Komponenten und
keine Nullflaechen. Gueltige UVs, Normalenattribute und PBR-Materialien
fehlen weiterhin. Quelle und Kopie bleiben unimportierte DEV_ONLY-Kandidaten.

Ein mesh-only-Lauf fuer `school` wurde am 2026-11-13 mit Prompt
`45ed52ca-7d9e-4a18-a57e-004c88139847` gestartet. Nach dem 600-Sekunden-
Timeout des Generators blieb der Prompt in ComfyUI aktiv; er wurde nicht
unterbrochen oder neu gestartet. Die History bestaetigte spaeter den
erfolgreichen Abschluss nach 39 Minuten 15 Sekunden. Die Rohdatei
`building_school_pilot_v1_00001_.glb` hat 14.774 Dreiecke, davon 6.017
Nullflaechen. Der separate Cleanup entfernte ausschliesslich diese Faces.
Die bereinigte Kopie hat 8.757 Dreiecke, 569 Komponenten und null
Nullflaechen; gueltige UVs, Normalenattribute und PBR-Materialien fehlen
weiterhin. Quelle und Kopie bleiben unimportierte DEV_ONLY-Kandidaten.

Ein mesh-only-Lauf fuer `nanotech` startete am 2026-11-13 mit Prompt
`fb1d7d87-6ec8-4a43-b41f-cbde1cdc4226`. TRELLIS schloss Sampling und
Marching Cubes ab und begann die Mesh-Rekonstruktion; der Generator lief
nach seinem 60-Minuten-Wartefenster in den Timeout. Der Prompt blieb danach
zunaechst in ComfyUI `queue_running`, ohne wartende Jobs, History-Eintrag
oder GLB-Ausgabe; ComfyUI wurde nicht unterbrochen oder neu gestartet.
Spaeter meldete die History den Prompt als erfolgreich abgeschlossen; der
gesamte Lauf dauerte 1:28:32. `building_nanotech_pilot_v1_00001_.glb`
wurde mit 383.844 Bytes und 14.998 Dreiecken geschrieben, davon 11.866
Nullflaechen. Der Cleaner entfernte ausschliesslich diese Faces. Die
separate Kopie hat 3.132 Dreiecke, 744 Komponenten und keine Nullflaechen;
gueltige UVs, Normalenattribute und PBR-Materialien fehlen weiterhin.
Beide Dateien bleiben unimportierte DEV_ONLY-Kandidaten.

Der erste `--textured --submit`-Lauf am 2026-11-13 erreichte den
Texturierungs-Node mit einem Mesh aus 4.974 Dreiecken, scheiterte dort aber
in `nvdiffrast` beim Erzeugen des CUDA-Rasterkontexts (`Cuda error: 209`,
`fineRasterKernel`). Es wurde kein GLB exportiert. Das passt zum oben
dokumentierten Torch291-Wheel, das nur `sm_120` statt der aktiven RTX-3060-
Architektur `sm_86` enthaelt. Die vorhandenen `sm_86`-Test-Wheels duerfen
nicht ungeprueft in den gemeinsam genutzten ComfyUI-Dienst installiert
werden; sie muessen zuerst in einer isolierten Zielumgebung validiert
werden.

Nur nach manueller Sichtpruefung und Bearbeitung offener Inspector-Befunde
den DEV-Import ausfuehren. Ein generierter oder erfolgreich inspizierter
GLB ist keine Produktionsfreigabe.