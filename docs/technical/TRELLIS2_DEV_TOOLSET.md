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

Fuer den direkten Shuttle-Texturplan wurde am 2026-11-14 der von
`encode_shape_slat` verwendete CPU-Aufruf `mesh_to_flexible_dual_grid`
separat verglichen: Der installierte Python-Wrapper lief jeweils mit dem
installierten nativen Modul und mit dem aus dem `sm_86`-Wheel extrahierten
Modul. Bei einem geschlossenen, asymmetrischen Testquader und Grid 16
lieferten beide nach Sortierung der Koordinaten bitgleiche Ergebnisse:
522 Koordinaten (`int32`), Dual-Vertices (`float32`) und Schnittflags
(`bool`), jeweils mit drei Werten pro Eintrag. Der Test verwendete die
Gewichte und AABB des Texturpfads; CUDA blieb deaktiviert. Das Wheel hatte
SHA-256 `741b37e8e0f2b6d80277ff3b673a04aeffe849a3df5e1193f3a9e0b8e3d1b2fa`.
Der Wrapper wurde ohne den regulaeren Paketimport geladen, der bereits
beim Import eine GPU abfragt. Dies belegt nur diesen kleinen CPU-Test,
nicht die Paketinitialisierung oder den CUDA-, Modell- und UV-Bake-Pfad.
Das Wheel enthaelt zudem einen abweichenden `flexible_dual_grid`-Wrapper;
insbesondere fehlt dort die installierte gekachelte Dekodierfunktion. Das
gesamte Wheel darf daher nicht als austauschbar vorausgesetzt werden.
Im Texturpfad normalisiert `preprocess_mesh` die Bounds und dreht die
Achsen vor der Voxelisierung; die spaetere Ruecktransformation und
Orientierung des exportierten Shuttle-GLB sind weiterhin zu pruefen.

Am 2026-11-14 wurde ausserdem `postprocess_mesh` in einem separaten
Python-Prozess im laufenden ComfyUI-Container mit dem vorhandenen
`sm_86`-Overlay und synthetischen PBR-Voxeln getestet. Der Prozess lud
die nativen Overlay-Module, ohne die Installation oder den Dienst zu
aendern. Fuer einen Quader mit Grid 16 und 64x64-Bake liefen CuMesh-
UV-Unwrap, `nvdiffrast`-Rasterisierung und FlexGEMM-Sampling zusammen
durch; Basisfarb- und Metallic/Roughness-Textur enthielten Nicht-Null-Werte.
Der maximale von PyTorch reservierte GPU-Speicher lag bei etwa 0,252 GiB.
Dies ist ein Test des Bake-Pfads, keine Modellinferenz und kein Nachweis
fuer die Texturqualitaet oder den vollstaendigen Shuttle-Workflow. Der
aktive ComfyUI-Prozess verwendet weiterhin seine bisherige Erweiterung;
das Overlay aendert dessen CUDA-209-Fehler nicht.

Die 512er und 1024er Texturgewichte lagen bei dieser Pruefung nicht im
lokalen TRELLIS-Modellordner, aber im Hugging-Face-Cache des Containers.
Der Loader kann bei fehlender lokaler Datei auf diesen Cache zurueckfallen.
Ein separater Container benoetigt daher ausdruecklichen Zugriff auf die
geprueften Gewichte; ein vorhandenes Modellverzeichnis allein belegt dies
nicht. Das Image des laufenden ComfyUI-Containers war lokal nicht fuer
einen weiteren Container verfuegbar. Ein vollstaendiger Lauf bleibt bis
zu einer isolierten Umgebung und ausreichender, koordinierter GPU-Kapazitaet
offen; die Submit-Sperre des Texturplans bleibt bestehen.

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

Fuer Schiffe stattdessen `--asset-type ship` bei Cleaner und Inspektor
angeben; `--facility-kind` ist ausschliesslich fuer Gebaeude zulaessig.
Optional exportiert der Cleaner mit `--with-normals` vorhandene oder aus
der Geometrie berechnete Vertex-Normalen. Diese muessen endlich und auf
Einheitslaenge normiert sein. Ohne diese Option bleibt das bisherige
Exportverhalten unveraendert. Ein Export mit Normalen ersetzt keine
Sichtpruefung auf geglaettete Kanten und Shading-Artefakte.

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
- Offene Randkanten und Kanten mit mehr als zwei anliegenden Flaechen:
  Die Analyse verbindet ausschliesslich exakt gleiche Positionen und
  ignoriert Nullflaechen. Die Werte sind Pruefhinweise, keine automatische
  Reparatur oder Aussage, ob eine Oeffnung beabsichtigt ist. Aeltere
  V2-Berichte enthalten diese zusaetzlichen Felder noch nicht.
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
`industry`, `nanotech`, `research`, `school`, `security`, `silo`, `solar`,
`tank` und `terraforming` an. Zusaetzlich gibt es zwei Industry-512-Varianten:
`industry_512` zeigt den frueheren Meshlib-Lauf aus
`building_industry_pilot_v1_00003__zero_area_cleaned.glb`,
`industry_512_no_meshlib` den neuen Bypass-Kandidaten aus
`building_industry_pilot_v1_00004__zero_area_cleaned.glb`. Der bisherige
`industry`-Eintrag bleibt auf `building_industry_pilot_v1_00002` gesetzt.
Damit koennen drei Industry-Varianten im Basisvergleich geladen werden. Sie
werden erst nach Aktivierung nachgeladen und bleiben unfreigegebene DEV_ONLY-
Kandidaten. Die Bypass-Variante wurde bei angenommener Breite 250 m geladen;
sie wirkt aus der 2-km-Ansicht wie eine niedrig-rechteckige Platte mit
inneren Strukturen und bleibt mangels bestaetigter Gebaeudesilhouette,
Orientierung und Bodenkontakt unfreigegeben. Das unbereinigte alte
Industry-Rohmodell mit 490.202 Dreiecken
bleibt wegen des fehlenden kontrollierten LOD ausserhalb der Vorschau; nur
der separate, bereinigte 15k-Export ist gelistet. Ein frueherer
Browserlauf zeigte Hospital sichtbar im Basisvergleich. Bei einer spaeteren
Browserpruefung war kein WebGPU-Adapter verfuegbar. In spaeteren WebGPU-
Sitzungen wurden alle dreizehn Facility-Klassenkandidaten im Basisvergleich
sichtbar geladen.
Die Sichtpruefung zeigt bei mehreren Meshes fragmentierte, stark facettierte
Geometrie, dunkle Dreiecksluecken oder shardartige Formen. Industry hat
zusaetzlich einen hohen, schmalen Auswuchs; Terraforming zeigt selbst bei
250 m angenommener Breite deutliche schwarze Luecken und eine duenne
Geometriespitze. Keiner der dreizehn Kandidaten ist visuell freigegeben;
Massstab, Relief-Bodenkontakt und Produktionsqualitaet bleiben offen.
Ein separater lokaler Delivery-Smoke-Test bestaetigte fuer alle dreizehn
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

`--shape-resolution 512` ist ein mesh-only-Fallback: Der Graph verwendet den
512er Shape-SLAT direkt aus `Trellis2ShapeGenerator`, laesst
`Trellis2ShapeCascadeGenerator` aus und dekodiert mit Aufloesung 512. Der
Standard bleibt der bisherige 512-zu-1024-Cascade-Pfad. Texturierte Laeufe
mit 512 werden abgewiesen, da der Texturierungszweig die Aufloesung 1024
voraussetzt. Fuer mesh-only 512 wird das Resultat der ersten Cumesh-
Simplifizierung direkt exportiert; die danach folgende Meshlib-Lochfuellung
und zweite Cumesh-Stufe werden ausgelassen. Texturierte und standardmaessige
1024er Graphen bleiben unveraendert. Der Direktpfad bestand Live-Preflight
und ComfyUI-Lauf:

```powershell
node scripts/trellis2_generate_facility.mjs --kind industry --seed 20261113 --shape-resolution 512 --preflight
node scripts/trellis2_generate_facility.mjs --kind industry --seed 20261113 --shape-resolution 512 --submit
```

Der Lauf mit Prompt `5637feed-9e1c-4eeb-bd7f-dbeca2182110` erzeugte
`building_industry_pilot_v1_00003_.glb` (542.364 Bytes,
SHA-256 `feac2709392ce920cdaab6216360f9a4c821a884d7c12a8472eac72fd5814bea`).
Die Offline-Inspektion fand 14.826 Dreiecke, 12.230 Nullflaechen und 11.835
Face-Komponenten; Normalenattribute, gueltige UVs und PBR-Materialien fehlen.
Der separate Cleaner entfernte nur die Nullflaechen. Die Kopie
`building_industry_pilot_v1_00003__zero_area_cleaned.glb` (52.812 Bytes,
SHA-256 `247a118aa16cadaa711794060c444d21fd81c124f0e2a7e06d3ce0d0f63e43e4`)
enthaelt noch 2.596 Dreiecke und 327 Komponenten. Beide Dateien bleiben
unimportierte DEV_ONLY-Kandidaten; die bereinigte Kopie ist nicht visuell
freigegeben. Die erste 512er Variante vermeidet den problematischen 1024-Cascade-Decode,
behebt aber nicht die Mesh-Qualitaetsprobleme. Die bereinigte Kopie wurde
zusaetzlich im isolierten Earth-DEV-WebGPU-Vergleich bei angenommener Breite
von 250 m geladen. Sie erscheint shard-artig mit dunklen Geometrie-Luecken,
ohne erkennbare Fabriksilhouette. Der bisherige 1024er Industry-Kandidat
wirkt ebenfalls fragmentiert; der Direkt-512-Export ist keine visuelle
Verbesserung. Beide Varianten bleiben unfreigegeben. Der neue Eintrag
`industry_512` ist ausschliesslich als Vergleich in der Earth-DEV-Vorschau
verfuegbar und wurde nicht in den Produktionsrenderer oder Facility-Plan
uebernommen.

Kontrollierte Zwischenmesh-Exporte mit derselben Referenz und demselben Seed
lokalisierten den starken Qualitaetsverlust in Node 250,
`Trellis2FillHolesNicelyWithMeshlib`. Der rohe 512er Decoder-Mesh hatte
3.130.900 Dreiecke, null Nullflaechen und eine Komponente. Nach Node 161
(`Trellis2ReconstructMeshWithQuad`, 1024) waren es 6.936.802 Dreiecke,
weiter null Nullflaechen und zwei Komponenten. Node 218 (erste Cumesh-
Vereinfachung auf 15.000) ergab 14.637 Dreiecke, 929 Nullflaechen und 148
Komponenten. Node 250 veraenderte diese zu 317.024 Dreiecken, 227.892
Nullflaechen und 286.503 Komponenten. Der alte Node-257-Finalexport hatte
14.826 Dreiecke, 12.230 Nullflaechen und 11.835 Komponenten.

Der mesh-only-512-Graph umgeht deshalb Node 250 und Node 257; keine
Komponenten werden zusaetzlich entfernt. Ein einzelner Lauf mit dem
angepassten Graphen erzeugte
`building_industry_pilot_v1_00004_.glb` (267.476 Bytes,
SHA-256 `884cfa8a6e94f471cfa99b20c4bb881dbdfd9bb9b7ed6a9866e53056c6b2aa4e`)
mit 14.637 Dreiecken, 929 Nullflaechen und 148 Komponenten. Die separate
Nullflaechen-Kopie `building_industry_pilot_v1_00004__zero_area_cleaned.glb`
(251.656 Bytes, SHA-256
`5f3f95b06934e01392be689c20c924baf796236fd8ffa6089445bffe3924b928`)
enthaelt 13.708 Dreiecke, null Nullflaechen und vier Komponenten. Beide
Dateien haben weiterhin keine Normalenattribute, gueltigen UVs oder PBR-
Materialien. Die bereinigte Meshlib-Bypass-Variante wurde im isolierten
Earth-DEV-WebGPU-Viewer bei 250 m angenommener Breite geladen. In der
2-km-Ansicht wirkt sie als deutlich zusammenhaengendere, niedrig-rechteckige
Platte mit inneren Strukturen statt als Shard; eine eindeutig freistehende
Fabriksilhouette oder Bodenkontakt ist damit nicht bestaetigt. Sie bleibt
unfreigegeben. Der Texturierungs- und 1024er Standardgraph ist unveraendert.

### Eingabebilder fuer TRELLIS.2

Die offizielle [TRELLIS.2-Demo](https://github.com/microsoft/TRELLIS.2/blob/main/app.py)
empfiehlt ausdruecklich ein Vordergrundobjekt mit Alpha-Maske. Die
offizielle
[`preprocess_image`-Implementierung](https://github.com/microsoft/TRELLIS.2/blob/main/trellis2/pipelines/trellis2_image_to_3d.py)
verwendet vorhandenes nicht-vollstaendig-opakes RGBA-Alpha direkt; ohne
Alpha wird der Hintergrund mit `rembg` entfernt. Sie verkleinert die laengste
Kante auf hoechstens 1024 Pixel, croppt anhand der Alpha-Bounding-Box und
multipliziert RGB mit Alpha. Das Modell erhaelt ein einzelnes Bild, keine
Mehransichten-Collage.

Der lokale ComfyUI-Loader gibt `image`, `mask` und `image_with_alpha` aus.
Der Generator verwendete bisher den ersten, bereits zu RGB konvertierten
Ausgang; zugleich war `remove_background` deaktiviert. Ein transparentes
PNG verlor dadurch seine Maske vor dem Preprocessing. Der Graph verwendet
jetzt den dritten Ausgang `image_with_alpha`, damit die Maske erhalten bleibt.
Die bestehende `industry_concept_v1.png` ist allerdings ein deckendes
1024x1024-RGB-Bild ohne Alpha; sie wird durch diese Aenderung nicht
freigestellt. Die lokale Vorverarbeitung entfernt bei deaktiviertem
`remove_background` keinen solchen Hintergrund.

Fuer den Industry-Pilot liegt deshalb zusaetzlich die nicht-destruktive
RGBA-Vorlage `industry_concept_v1_alpha.png` vor; die RGB-Quelle bleibt
unveraendert. Die Alpha-Maske wurde lokal mit `rembg 2.0.87`/`u2netp` auf
der CPU erzeugt und visuell kontrolliert. Das Manifest pinnt sie als
`trellis_input`; der Generator verwendet diese Variante, waehrend andere
Facility-Arten weiterhin ihre jeweiligen Originalbilder nutzen. Die Variante
ist nur eine Eingabevorlage und gibt kein erzeugtes Mesh frei.

Die gemeinsam genutzte ComfyUI-Instanz hat kein importierbares `rembg` und
meldet fuer `LoadBackgroundRemovalModel` keine verfuegbaren Modelle. Daher
`remove_background` dort nicht aktivieren und keine Wheels in den laufenden
Dienst installieren. Beim letzten Preflight war die Queue leer, aber nur
rund 3,76 GiB GPU-Speicher frei; ein neuer TRELLIS.2-Lauf wurde deshalb nicht
eingereiht und bleibt bis zu ausreichendem GPU-Speicher offen.

Abgeleitete Vorlage fuer weitere GQ-Laeufe: genau ein freigestelltes
Gebaeude, vollstaendige Silhouette einschliesslich Bodenplatte und
Schornstein/Mast, leicht erhobene Dreiviertelansicht mit sichtbarem Dach und
Fassaden; keine angeschnittenen Bauteile, Schrift oder Ansichten-Collage.
Das sind Qualitaetskriterien fuer unsere Vorlage, keine offizielle
TRELLIS.2-Garantie.

### Shuttle-Vorlagen fuer den Startbildschirm

Unter `generated/trellis2/references/shuttles/` liegen drei unabhaengige
Entwuerfe: `dock_mule` (gelber Lastentransporter), `rust_bucket`
(rundlicher weiss-tuerkiser Transporter) und `patchwork_tug` (roter,
kantiger Reparaturfall, bevorzugter Startbildschirm-Kandidat).
Die Entwuerfe sind keine Mehransichten desselben Schiffs.

Jeweils bleibt das Original als `*_concept_v1.png` unveraendert erhalten.
Die Generatorbilder enthalten bereits echtes Alpha; der scheinbare
Hintergrund in der Vorschau ist nicht durchgehend deckend. Eine weitere
`rembg`-Segmentierung ist deshalb unnoetig. Fuer `*_trellis_v1.png`
wurden nur Alpha-Rauschwerte bis 8 entfernt und Werte ab 250 auf 255
gesetzt; Zwischenwerte bleiben vor dem Resizing erhalten. Das ganze Bild
wird proportional mit LANCZOS in 896x896 eingepasst und ohne erneute
Alpha-Multiplikation auf einer transparenten 1024x1024-Flaeche zentriert.
Die vorbereiteten Silhouetten wurden visuell geprueft; mindestens 64 Pixel
transparenter Aussenrand bleiben erhalten.

Das separate `shuttles/manifest.json` pinnt Originale und TRELLIS-Eingaben
per SHA-256. Der Shuttle-Generator nutzt denselben Graphen wie der Facility-
Generator, aber ein eigenes Manifest und eigene eindeutige Exportpraefixe:

```powershell
node scripts/trellis2_generate_shuttle.mjs --id patchwork_tug --preflight
node scripts/trellis2_generate_shuttle.mjs --id patchwork_tug --submit
```

Ohne `--submit` wird kein Job gestartet. Der 512er Mesh-only-Pfad verwendet
den alpha-erhaltenden Loader-Ausgang, `remove_background: false` und den
Meshlib-Bypass. Vor Upload und Einreihung prueft der Generator Queue und
mindestens 10 GiB laut ComfyUI freien CUDA-Speicher; dies ist keine Garantie
gegen konkurrierende Arbeit oder Speichermangel. Ein Timeout nach Einreihung
kann einen weiterlaufenden Job bedeuten: Prompt-ID und Queue pruefen, nicht
blind erneut starten. Die erzeugten GLBs bleiben DEV_ONLY. Verdeckte Rueck-
und Unterseiten, Materialqualitaet, Orientierung und Massstab muessen am
Modell gesondert beurteilt werden; es gibt keine Startbildschirm-Integration.

Ein erster 512er Mesh-only-Lauf fuer `patchwork_tug` (Seed `20261112`,
Prompt `248e5a4a-ef3a-4732-9304-64f25a4c7e18`) erzeugte
`shuttle_patchwork_tug_6613380216584a3fa81741c2bd9cd3e6_00001_.glb`
mit SHA-256
`715259016af6107b3a3307159d5390e1fbe00d48835c10ac9b28f1e8c3d66e33`.
Die Offline-Inspektion meldet 14.266 Dreiecke, 180 Nullflaechen,
sechs Face-Komponenten und fehlende Normalenattribute, gueltige UVs und
PBR-Texturen. Die Hauptkomponente enthaelt 14.254 Dreiecke. Eine
vereinfachte orthografische Mesh-Vorschau zeigt einen zusammenhaengenden
kantigen Koerper mit Anbauten, ist jedoch keine Three.js-Sichtpruefung und
bestaetigt weder korrekte Orientierung noch Unterseite oder Material.
Der GLB ist ein unbereinigter, nicht freigegebener DEV_ONLY-Rohkandidat;
die rote Farbe der Vorlage ist in diesem Mesh-only-Export nicht enthalten.

Die separate Kopie
`shuttle_patchwork_tug_6613380216584a3fa81741c2bd9cd3e6_00001__zero_area_cleaned.glb`
(SHA-256 `3affd15c3261ea084f4bc1e58895c7ee93c3b4abacfb0224a6e57483f028ebfc`)
enthaelt 14.086 Dreiecke, keine Nullflaechen und eine Face-Komponente.
Die positiven Dreiecke, Bounds und Szenentransformation stimmen nach
Reimport exakt mit dem Rohmodell ueberein. Das Mesh ist laut Trimesh
nicht wasserdicht; Normalenattribute, UVs und PBR-Texturen fehlen weiterhin.
Eine isolierte Three.js-WebGL-Pruefung aus vier Achsrichtungen zeigt einen
kantigen Rumpf mit Anbauten und Stellflaechen, aber auch dunkle Bereiche
und deutliche Facettierung. Die dunkle -Y-Ansicht belegt fuer sich weder
fehlende Flaechen noch einen gueltigen Bodenabschluss. Orientierung,
Material und Qualitaet im Startbildschirm bleiben ungeprueft. Auch diese
Kopie ist DEV_ONLY und wurde nicht in die Laufzeit integriert.

Ein weiterer separater `--with-normals`-Export
`shuttle_patchwork_tug_6613380216584a3fa81741c2bd9cd3e6_00001__zero_area_cleaned_normals.glb`
(SHA-256 `e1b1f0ea331a9776b7fadbd949ebf28ac378d2ace1a48eac0b4cdb6a1c37ae77`)
behaelt alle 14.086 Dreiecke samt Orientierung, Bounds und Transformationen
unveraendert. Nach Reimport sind alle 7.129 Vertex-Normalen endlich und
innerhalb von `1e-5` einheitslang. UVs und PBR-Texturen fehlen weiterhin;
ein isolierter Three.js-WebGL-Vergleich unter identischem neutralem
Ersatzmaterial und Licht zeigt ein glatteres Shading als bei der
normalenlosen Kopie, aber auch weichgezeichnete Details und Kanten. Die
Pruefung verwendet vier festgelegte Achsrichtungen; weder das konkrete
Startbildschirm-Licht noch Material, Bodenkontakt oder verdeckte Flaechen
sind damit freigegeben. Der bekannte CUDA-209-Fehler im aktiven
ComfyUI-Texturpfad bleibt offen; ein neuer Texturjob wurde nicht gestartet.
Beide Kopien bleiben DEV_ONLY.

Die erneute Topologieinspektion der Normalen-Variante zaehlt 502 Randkanten
und keine Kante mit mehr als zwei angrenzenden Flaechen. Auch auf der
Analysekopie mit exakt vereinigten Positionen bleibt dieser Befund bestehen;
die Randkanten bilden 167 Gruppen, die groesste umfasst vier Kanten. Kleine
Oeffnungen werden nicht automatisch geschlossen, da deren Ursache und
Absicht ungeprueft sind. Ein separater, winziger Rastertest in der
unveraenderten ComfyUI-Containerumgebung scheiterte erneut bei
`RasterizeCudaContext` mit `Cuda error: 209` auf `sm_86`. Ein erfolgreicher
Test der separat gebauten Erweiterung ist kein Nachweis fuer den aktiven
Dienst oder den vollstaendigen Texturpfad.

Fuer spaetere isolierte Versuche kann ein **nicht einreihbarer** 512er
Texturgraph fuer das bestehende Patchwork-Tug-Mesh vorbereitet werden:

```powershell
node scripts\trellis2_generate_shuttle.mjs --id patchwork_tug --texture-plan
node scripts\trellis2_generate_shuttle.mjs --id patchwork_tug --texture-plan --preflight
```

Der Plan prueft die lokalen SHA-256-Werte von Vorlage und Normalen-GLB,
laedt im Graphen das gepinnte Mesh mit `Trellis2LoadMesh`, verwendet das
512er Texturmodell mit 1024x1024-Texturen und verzichtet auf eine erneute
Shape-Generierung. Die Dateiangabe setzt den Container-Mount
`/workspace/output/gq_trellis2` voraus. `--preflight` prueft nur Node-Schema,
Queue und freien Speicher; weder Mount noch CUDA-Kernel, Modellgewichte
oder Ergebnisqualitaet werden dadurch validiert. `--texture-plan --submit`
wird ausdruecklich abgewiesen. Der Graph ist noch kein erfolgreicher
Texturlauf; Orientierung, UV-Bake und PBR-Inhalt sind unbestaetigt.

Der improvisiert reparierte, zivile Shuttle-Entwurf passt als gestalterische
Interpretation zum Bild der Siedler, die in
`docs/gamedesign/FACTION_INTRODUCTION.md` Unterkunftsmodule aus
Schiffswandplatten bauen. Daraus folgt keine kanonische Zuordnung dieses
Shuttles zu einem bestimmten Herold oder einer Fraktion. Die
`docs/lore/COMET_NARRATED_INTRO.md` beschreibt ein sichtbares Rendezvous,
einen Flug und einen erst nach Bestaetigung beginnenden Landeanflug; der
Entwurf aendert weder diese Abfolge noch die Kamera- oder Cue-Logik.

Bei der zusaetzlichen Earth-DEV-Pruefung des 512er Bypass-Kandidaten bei
250 m angenommener Breite zeigt die Seitenansicht einen niedrigen,
rechteckigen Hallenkoerper mit hohem schmalem Auswuchs. Dachflaechen sind
stark facettiert und enthalten dunkle Luecken; die Unterseite erscheint
nahezu vollstaendig schwarz und flach. Diese Preview belegt weder korrekte
Unterseitengeometrie noch Relief-Bodenkontakt. Der Kandidat bleibt
unfreigegeben.

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
Der alte Export blieb wegen seines Umfangs unbereinigt und ausserhalb der
Vorschau. Ein erneuter Mesh-only-Lauf mit dem aktuellen 15.000er Ziel startete
mit Prompt `d566d53d-4377-4de3-9492-c85e1f73ab8e`, ueberschritt das
600-Sekunden-Wartefenster und wurde spaeter nach 1:23:12 erfolgreich
abgeschlossen. Der neue Roh-GLB `building_industry_pilot_v1_00002_.glb`
(297.816 Bytes) hat 14.958 Dreiecke, davon 9.712 Nullflaechen. Die separate
bereinigte Kopie hat 5.246 Dreiecke, 1.095 Komponenten und keine
Nullflaechen; gueltige UVs, Normalenattribute und PBR-Materialien fehlen
weiterhin. Nur diese neue Kopie kommt als unfreigegebener DEV_ONLY-Kandidat
in die Vorschau. Die WebGPU-Sichtpruefung lud diese Kopie, zeigte aber starke
Facettierung, dunkle Geometrie-Luecken und einen sehr hohen, schmalen
Geometrieauswuchs relativ zur angenommenen Breite von 100 m. Industry ist
damit nicht visuell freigegeben.

Ein einzelner texturierter Industry-Lauf am 2026-11-13 mit
`--textured --submit` scheiterte in `Trellis2MeshTexturing` bei
`nvdiffrast.RasterizeCudaContext` mit CUDA-Fehler 209; es entstand kein GLB.
Der anschliessende read-only Preflight bestaetigte eine leere Queue und einen
weiterhin gueltigen Workflow. Es wurde kein Retry gestartet. Vor einem
weiteren Texturjob muss die CUDA-/nvdiffrast-Kompatibilitaet der Umgebung
geklaert werden.

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
wiederholt; der neue Tanklauf blieb ein einzelner serieller Job. Ein spaeterer
separater Industry-Lauf mit dem 15.000er Ziel wurde abgeschlossen; dessen
bereinigte Kopie ist im Vorschauabschnitt dokumentiert.

Ein mesh-only-Lauf fuer `fusion` wurde am 2026-11-13 mit
`--kind fusion --submit` gestartet, endete nach 600 Sekunden aber ohne
vom Generator erkannte GLB-Ausgabe. Der ComfyUI-Prompt
`684b4808-9b13-4ee7-bf1c-95baa637a8fd` lief bei der anschliessenden
read-only-Pruefung weiter; die Queue enthielt einen laufenden und keinen
wartenden Job. Die RTX 3060 meldete dabei 5.503 MiB freien VRAM und 90 %
Auslastung. Der Dienst und Prompt wurden nicht unterbrochen oder neu
gestartet; bis zur Freigabe der Queue durfte kein weiterer Inferenzjob
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
dokumentierten Basis-Wheel, das nur `sm_120` statt der aktiven RTX-3060-
Architektur `sm_86` enthaelt. Eine separate Python-Probe im laufenden
ComfyUI-Container bestaetigte Python 3.12.14, PyTorch 2.9.1+cu128, CUDA 12.8
und `sm_86`; der importierte `_nvdiffrast_c` stammt weiterhin aus dem
Basisverzeichnis unter `/usr/local/lib`. Mit einem separaten Prozess und
`PYTHONPATH` auf das vorhandene `sm_86`-Overlay wurde dagegen der CUDA-
Rasterkontext erzeugt und ein 32x32-Dreieck mit 338 Pixeln gerastert.
Das bestaetigt nur den Kernel in einem isolierten Prozess, nicht den
vollstaendigen ComfyUI-Texturierungsworkflow. Der laufende Dienst wurde
nicht umgestellt oder neu gestartet; ein vollstaendiger PBR-Lauf bleibt
einem kontrollierten Wartungsfenster mit ausreichend GPU-Kapazitaet
vorbehalten.

Nur nach manueller Sichtpruefung und Bearbeitung offener Inspector-Befunde
den DEV-Import ausfuehren. Ein generierter oder erfolgreich inspizierter
GLB ist keine Produktionsfreigabe.