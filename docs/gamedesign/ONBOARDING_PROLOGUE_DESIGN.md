# 🌌 Narrativer Registrierungsprolog – Onboarding in die Kalytherion-Konvergenz

**Version:** 1.0  
**Status:** Konzept & Design – Blaupause für Implementierung  
**Zugehörig zu:** [FACTION_INTRODUCTION.md](FACTION_INTRODUCTION.md) → [GAMEDESIGN.md](GAMEDESIGN.md)  
**Letztes Update:** 2026-04-01

---

## Inhaltsverzeichnis

1. [Designziele & Philosophie](#1-designziele--philosophie)
2. [Gesamtstruktur: Die fünf Prologstufen](#2-gesamtstruktur-die-fünf-prologstufen)
3. [Stufe 1 – „Willkommen im Universum" (Cinematischer Einstieg)](#3-stufe-1--willkommen-im-universum-cinematischer-einstieg)
4. [Stufe 2 – Identitätseingabe: E-Mail & Name](#4-stufe-2--identitätseingabe-e-mail--name)
5. [Stufe 3 – Fraktionswahl: Die Sechs Herolde](#5-stufe-3--fraktionswahl-die-sechs-herolde)
6. [Stufe 4 – Fraktionsspezifischer Prolog](#6-stufe-4--fraktionsspezifischer-prolog)
   - 6.1 🦎 Vor'Tak – Der Schildkreis
   - 6.2 🐙 Syl'Nar – Der Lichtbund
   - 6.3 🔥 Aereth – Der Kernrat
   - 6.4 🦗 Kryl'Tha – Die Schwarmkommandantur
   - 6.5 💎 Zhareen – Der Archivrat
   - 6.6 🌫️ Vel'Ar – Der Schattenkreis
7. [Stufe 5 – Übergang zum Tutorial](#7-stufe-5--übergang-zum-tutorial)
8. [UX-Zustandsmaschine & Flussdiagramm](#8-ux-zustandsmaschine--flussdiagramm)
9. [Technische Implementierungshinweise](#9-technische-implementierungshinweise)
10. [Narrative Designregeln](#10-narrative-designregeln)
11. [Offene Fragen & Varianten](#11-offene-fragen--varianten)

---

## 1. Designziele & Philosophie

### Kernprinzip

Der Registrierungsprozess ist **kein Formular** – er ist die **erste Szene des Spiels**. Jeder Eingabefeld, jede Auswahl, jede Schaltfläche ist in die Erzählung der Kalytherion-Konvergenz eingebettet. Der Spieler nimmt ab der ersten Sekunde die Rolle des Gouverneurs von Khal'Vethis ein – auch wenn er noch gar nicht weiß, was das bedeutet.

### Ziele im Überblick

| Ziel | Beschreibung |
|---|---|
| **Immersion ab Sekunde 1** | Kein leeres „Benutzername / Passwort"-Formular. Jede UI-Komponente hat einen narrativen Rahmen. |
| **Fraktionsbindung vor Spielstart** | Die Fraktionswahl wird zu einem emotionalen, nicht mechanischen Akt. |
| **Neugier wecken, nicht überfordern** | Lore nur in Dosierungen. Details werden *nicht* erklärt, sondern *angedeutet*. |
| **Wiedererkennbarkeit** | Nach dem Tutorial weiß der Spieler, wer sein erster Gesprächspartner war – und warum. |
| **Skip-Möglichkeit** | Erfahrene Spieler oder Rückkehrer können den Prolog überspringen (→ direkter Login-Dialog). |

### Was der Prolog NICHT ist

- Kein vollständiges Lore-Infodump
- Kein erzwungener linearer Film ohne Interaktion
- Kein Tutorial-Ersatz (der folgt danach)

---

## 2. Gesamtstruktur: Die fünf Prologstufen

```
┌─────────────────────────────────────────────────────────────────┐
│  STUFE 1 │ STUFE 2 │    STUFE 3    │  STUFE 4  │   STUFE 5    │
│──────────┼─────────┼───────────────┼───────────┼──────────────│
│Willkommen│ E-Mail  │  Fraktions-   │Fraktions- │  Übergang    │
│im Univer-│ & Name  │     wahl      │spez.      │  zum         │
│   sum    │         │(Sechs Herolde)│  Prolog   │  Tutorial    │
└─────────────────────────────────────────────────────────────────┘
     ~30s       ~20s        ~60s          ~90s         ~20s
                                    ↑
                            Pro Fraktion unterschiedlich
```

**Gesamtdauer (ohne Skip):** ca. 3–4 Minuten  
**Mit schnellem Lesen / Überfliegen:** ca. 2 Minuten  
**Mit Skip-Button:** direkt zum Login-Dialog

---

## 3. Stufe 1 – „Willkommen im Universum" (Cinematischer Einstieg

### Visueller Kontext

- **Hintergrund:** Starfield-Animation (bestehende `StarfieldFX` mit BACKGROUND-Layer, langsamer Parallax)
- **Musik:** `Nebula_Overture.mp3` (bereits im Auth-Preload vorhanden)
- **UI-Element:** Zentrierter Textoverlay, kein Rahmen, keine Buttons – nur Lore-Text und ein subtiler Cursor

### Narrativer Text (Sequenz, auto-advancing)

Die Texte erscheinen mit **Typewriter-Effekt**, eine Zeile nach der anderen, mit kurzen Pausen zwischen Absätzen.

---

> *Es gibt keine neutrale Ecke im Universum.*

> *Jede Welt, jeder Lichtweg zwischen den Sternen, jede Atemluft unter einem fremden Himmel gehört jemandem – oder wird bald jemandem gehören.*

> *Du hast soeben eine Welt geerbt, die niemand haben wollte.*

> *Das wird sich ändern.*

---

**[Weiter-Button erscheint nach 5 Sekunden oder nach Klick:]**  
`→ Beginne deine Geschichte`  
*(Kleingedruckt darunter: „Bereits Gouverneur? [Anmelden]")*

### Technische Anforderungen

- `StarfieldFX` mit BACKGROUND-Modus und Warp-Faktor 0 (statisch, atmosphärisch)
- Typewriter-Animation via CSS `animation` oder JS `setInterval`
- Auto-Skip nach 30 Sekunden Inaktivität (verhindert Hängenbleiben beim Tab-Wechsel)
- `[Überspringen]`-Link oben rechts → springt direkt zu Stufe 2 ohne Lore-Text

---

## 4. Stufe 2 – Identitätseingabe: E-Mail & Name

### Konzept: Die „Konvergenz-Registrierungsbehörde"

Das Formular erscheint **nicht als nacktes Webformular**, sondern als **In-World-Terminal**:

```
╔════════════════════════════════════════════════════════════╗
║  KONVERGENZ-REGISTRIERUNGSBEHÖRDE  ·  TERMINAL KHAL-07    ║
║  Außengrenz-Prozessierung ·  Khal'Vethis ·  Sektor 27-B  ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  NEUE GOUVERNEURSZULASSUNG                                 ║
║  ─────────────────────────────────────────────────────    ║
║  Identifikationsadresse (Kommunikationskanal):            ║
║  ┌──────────────────────────────────────────────────┐    ║
║  │  _                                               │    ║
║  └──────────────────────────────────────────────────┘    ║
║  Anzeigename für Kolonistenregister:                      ║
║  ┌──────────────────────────────────────────────────┐    ║
║  │  _                                               │    ║
║  └──────────────────────────────────────────────────┘    ║
║  Zugangscode (min. 8 Zeichen):                            ║
║  ┌──────────────────────────────────────────────────┐    ║
║  │  _                                               │    ║
║  └──────────────────────────────────────────────────┘    ║
║                                                            ║
║  [ REGISTRIERUNG EINREICHEN ]                             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
```

### Feldbezeichnungen (narrativ → technisch)

| Narratives Label | Technisches Feld | Validierung |
|---|---|---|
| „Identifikationsadresse" | `email` | Standard E-Mail-Format |
| „Anzeigename für Kolonistenregister" | `username` | 3–24 Zeichen, alphanumerisch + `_-'` |
| „Zugangscode" | `password` | ≥ 8 Zeichen |

### Flavor-Texte bei Validierungsfehlern (immersiv)

| Fehler | Anzeige |
|---|---|
| Ungültige E-Mail | *„Kommunikationskanal nicht erkennbar. Format: name@sektor.convergence"* |
| Name zu kurz | *„Kolonistenregister akzeptiert keine Bezeichnungen unter 3 Zeichen."* |
| Passwort zu kurz | *„Zugangscode unzureichend gesichert. Mindestlänge: 8 Zeichen."* |
| E-Mail bereits vergeben | *„Diese Identifikationsadresse ist bereits einem aktiven Gouverneur zugeordnet."* |

### Übergang

Nach erfolgreicher Einreichung kurze Animationssequenz:

> *„Zulassung erfasst. Gouverneur [Name], Khal'Vethis wartet auf Sie."*

Dann automatischer Übergang zu Stufe 3.

---

## 5. Stufe 3 – Fraktionswahl: Die Sechs Herolde

### Konzept: Der Erste Kontakt

Das Spiel erklärt nicht „Wähle deine Fraktion". Stattdessen:

---

> *Noch bevor du deinen ersten Befehl erteilen kannst, stehen sechs Gestalten vor deiner Rathaustür.*  
> *Sie haben alle auf dich gewartet.*  
> *Sie wissen alle genau, was Khal'Vethis bedeutet.*  
> *Sie brauchen alle etwas von dir.*

---

### Die Auswahlkarte

Sechs Karten, horizontal oder im Hexagon-Layout angeordnet. Jede Karte zeigt:

- Fraktions-Emoji & Name
- Herold-Name und Bezeichnung
- Kurze **Verheißung** (was sie anbieten) + kurze **Forderung** (was sie wollen)
- Fraktionsfarbe als Kartenakzent

#### Karteninhalt

| Fraktion | Herold | Verheißung | Forderung |
|---|---|---|---|
| 🦎 **Vor'Tak** | Sharr'Keth, *Taktischer Diplomat* | *„Wir sichern deine Grenzen."* | *„Öffne uns den Korridor."* |
| 🐙 **Syl'Nar** | Tael'Mii, *Junger Priester* | *„Wir ernähren deine Bevölkerung."* | *„Bleib unabhängig von den Militärs."* |
| 🔥 **Aereth** | Vel'Saar, *Energiemanifest* | *„Wir verdoppeln deine Energieausbeute."* | *„Lass uns das Vethisit untersuchen."* |
| 🦗 **Kryl'Tha** | Zhaa'Kirr, *Schwarm-Delegierte* | *„Wir sichern deine Kolonie."* | *„Gib uns Raum für unsere Brut."* |
| 💎 **Zhareen** | Kael'Thin, *Uralter Archivar* | *„Wir öffnen dir unsere Archive."* | *„Hilf uns, das Riss-Ereignis zu verstehen."* |
| 🌫️ **Vel'Ar** | Nira'Vel, *Maskierte Agentin* | *„Wir zeigen dir, was die anderen verbergen."* | *„Frag nicht, woher wir das wissen."* |

### Hover / Tap-Expansion

Bei Hover (Desktop) oder Tap (Mobile) expandiert die Karte und zeigt:

- **Kurze Fraktionsbeschreibung** (2–3 Sätze, atmosphärisch)
- **Spielstilverweis** ohne Spielmechanik-Sprache (z.B. „Für Spieler, die Einfluss durch Stärke aufbauen")
- **Keine Stat-Vergleiche** – das würde die Immersion brechen

### Auswahlbestätigung

Klick auf eine Karte öffnet einen kurzen Bestätigungsdialog:

> *Sharr'Keth tritt vor. „Gouverneur", sagt er knapp, „ich hoffe, ihr seid ein vernünftiger Mensch." Er streckt die Hand aus.*

Zwei Optionen:
- **„Ich nehme seine Hand."** → Bestätigung, weiter zu Stufe 4
- **„Zurück"** → Zurück zur Auswahl

---

## 6. Stufe 4 – Fraktionsspezifischer Prolog

Jede Fraktion erhält einen **einzigartigen Prolog-Text** von ca. 150–200 Wörtern, der:

1. Die Ankunft des Herolds beschreibt (in Second-Person: „Du…")
2. Die Werte und den Ton der Fraktion vermittelt
3. Mit einem narrativen Hook endet, der direkt in das Tutorial überleitet
4. Einen **konkreten ersten Auftrag** ankündigt

---

### 6.1 🦎 Vor'Tak – Der Schildkreis

*Farbakzent: Tiefrot und Stahl*

---

> *Sharr'Keth betritt dein Büro wie eine Kaserne.*
>
> *Er wirft keine Dokumente auf den Tisch. Er stellt keine Fragen. Er legt eine einzige Datentafel hin, auf der drei Koordinaten leuchten – die drei FTL-Korridore, die durch Khal'Vethis laufen.*
>
> *„Vor sieben Zyklen", sagt er, „haben wir diese Position für unbedeutend gehalten. Das war ein Fehler." Er schenkt dir keinen Blick zu lang. „Ihr Vorgänger hat die Verteidigung dieser Welt vernachlässigt. Ich brauche zu wissen, ob Sie das auch tun werden."*
>
> *Du weißt instinktiv, dass es keine richtige Antwort gibt – nur eine, die er respektiert.*
>
> *Der Schildkreis bietet dir keine Freundschaft. Er bietet dir etwas Wertvolleres: **Schutz, solange du nützlich bist**.*
>
> *„Zeigen Sie mir Ihre Verteidigungsanlagen, Gouverneur. Dann reden wir weiter."*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Inspiziere die zwei Patrouillenkorvetten in deinem Orbit und melde Sharr'Keth den Zustand ihrer Waffensysteme."*

---

### 6.2 🐙 Syl'Nar – Der Lichtbund

*Farbakzent: Warmes Ocker und Cyanblau*

---

> *Tael'Mii erscheint nicht an der Tür – er wartet bereits auf dem Platz vor dem Rathaus, die Hände um einen dampfenden Behälter geschlossen.*
>
> *Er ist jünger, als du erwartet hättest. Er lächelt, als er dich sieht, aber sein Lächeln enthält mehr Kummer als Freude.*
>
> *„Ich habe mitgebracht, was wir haben", sagt er. „Es ist nicht viel. Aber für 4.200 Menschen reicht es für eine Woche." Er hält dir den Behälter hin – Nahrungskonzentrat, Syl'Nar-Standard. „Wir wissen, dass eure Vorräte knapp sind. Das ist keine Verhandlung. Das ist einfach... richtig."*
>
> *Der Lichtbund tauscht keine Güter. Er kultiviert **Vertrauen** – langsam, beständig, wie ein Baum, der Wurzeln schlägt, lange bevor er Früchte trägt.*
>
> *„Wenn ihr wollt, können wir morgen über die Hydroponik-Anlagen sprechen. Aber zuerst: Seid ihr gut hier angekommen?"*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Prüfe die Nahrungsmittelversorgung deiner Kolonie und finde heraus, wie viele Wochen euer aktueller Vorrat reicht."*

---

### 6.3 🔥 Aereth – Der Kernrat

*Farbakzent: Sonnengelb und Tiefblau*

---

> *Vel'Saar ist keine Person im üblichen Sinne. Was in dein Büro schwebt, ist ein Energiemuster in einer Containerhülle – pulsierend, ungeduldig, zu groß für den Raum.*
>
> *Noch bevor du sprechen kannst, beginnt es zu analysieren. Holographische Sensorlinien scannen die Wände, den Boden, deinen Schreibtisch.*
>
> *„Das Mineral unter eurer Erde ist in keinem unserer Kataloge. Unmöglich und dennoch real."* Die Stimme klingt wie Strom durch Metall. *„Ihr habt keine Ahnung, was ihr besitzt. Das ist akzeptabel – noch."*
>
> *Aereth respektiert keine Hierarchien. Es respektiert **Erkenntnisfortschritt**. Solange du dem Kernrat erlaubst zu forschen, wirst du ihre Werkzeuge nutzen dürfen. Hörst du auf, nützlich zu sein – wirst du irrelevant.*
>
> *„Zeig mir eure Abbauanlagen. Ich werde dir erklären, warum das Vethisit wichtiger ist, als ihr glaubt."*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Öffne die Bergbau-Übersicht und bestimme die aktuelle tägliche Vethisit-Förderrate."*

---

### 6.4 🦗 Kryl'Tha – Die Schwarmkommandantur

*Farbakzent: Grünlich-Schwarz und Insektenbraun*

---

> *Zhaa'Kirr kommt nicht allein. Hinter ihr stehen vier Sicherheitskräfte in voller Rüstung – lautlos, reglos, wie Statuen.*
>
> *Sie selbst ist kleiner als du erwartest, aber ihre Augen – sechsfach, facettiert – fixieren dich mit einer Präzision, die kein anderes Wesen erreicht. Sie klingt nicht feindlich. Sie klingt absolut sicher.*
>
> *„Drei Piratengruppen haben in den letzten zwei Monaten eure Außenposten sondiert. Euer Gouverneursvorgänger hat es ignoriert. Wir nicht."* Pause. *„Wir können das Problem lösen. Dafür brauchen wir Raum. Land. Nicht für immer. Nur für jetzt."*
>
> *Die Schwarmkommandantur verhandelt nicht mit Emotionen. Sie verhandelt mit **Realitäten**. Khal'Vethis hat Feinde. Du hast keine Armee. Sie haben beides.*
>
> *„Was sagt ihr?"*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Ruf die Sicherheitsprotokolle deiner Außenposten auf und bewerte die aktuelle Bedrohungslage."*

---

### 6.5 💎 Zhareen – Der Archivrat

*Farbakzent: Tiefviolett und Kristallweiß*

---

> *Kael'Thin ist alt – älter als jeder andere Bewohner dieser Welt, vielleicht älter als die Siedlung selbst.*
>
> *Er bewegt sich durch dein Büro, als würde er sich an einen Ort erinnern, an dem er schon einmal gewesen ist. Sein Blick gleitet über die Wände, die Karten, das Fenster zum Orbit – und bleibt schließlich auf dir ruhen.*
>
> *„Das Mineral, das ihr Vethisit nennt –"* Er pausiert, als suche er nach einem anderen Namen. *„Es existiert in unseren Archiven unter einer anderen Bezeichnung. Älter als die Konvergenz. Älter als Sprache."* Er hält inne. *„Ihr habt eine Anomalie unter euren Füßen, Gouverneur. Und ich bin der einzige, der euch sagen kann, was sie bedeutet. Falls ihr das wissen wollt."*
>
> *Der Archivrat gibt nichts umsonst. Aber er gibt ehrlich. **Wissen gegen Zugang.** Das ist sein Handel.*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Schalte das Archivdatenbank-Terminal im Gouverneursgebäude frei und rufe die ältesten verfügbaren Karten von Khal'Vethis auf."*

---

### 6.6 🌫️ Vel'Ar – Der Schattenkreis

*Farbakzent: Dunkelviolett und Silber*

---

> *Du hörst sie, bevor du sie siehst – ein leises Geräusch, das du zunächst für Wind hältst.*
>
> *Sie sitzt in der Ecke deines Büros. Du weißt nicht, wie lange sie dort war.*
>
> *„Keine Sorge", sagt Nira'Vel, ohne die Maske abzunehmen. „Ich bin die Einzige hier, die nicht versucht, dich zu kaufen."* Ein kurzes, trockenes Lachen. *„Die anderen haben euch alle Angebote gemacht. Schön, was? Schutz, Nahrung, Energie, Sicherheit, Wissen."* Pause. *„Ich zeige dir etwas anderes: Was sie euch verschwiegen haben."*
>
> *Sie legt eine Datentafel auf den Tisch – unverschlüsselt, sofort lesbar. Die ersten Zeilen lassen dich innehalten.*
>
> *Der Schattenkreis will keine Loyalität. Er will **ein Netzwerk**. Und du bist der nächste Knoten.*
>
> *„Lies das. Dann entscheide, ob du wissen willst, was als Nächstes kommt."*

**Erster Auftrag (Tutorial-Einstieg):**  
*„Öffne die Datentafel von Nira'Vel und analysiere, welche Informationen über die anderen Herolde sie enthält."*

---

## 7. Stufe 5 – Übergang zum Tutorial

### Das gemeinsame Element: Die Drohnenübersicht

Unabhängig von der gewählten Fraktion endet der Prolog mit derselben Szene:

---

> *Der Herold ist gegangen – oder zieht sich zurück, oder wartet draußen.*
>
> *Du stehst am Fenster des Gouverneursgebäudes und siehst Khal'Vethis zum ersten Mal wirklich: die Siedlung unter dir, die zwei Patrouillenkorvetten im niedrigen Orbit, die Berge am Horizont, die das Vethisit-Bergwerk bedecken.*
>
> *Irgendwo hinter diesem Horizont lauern Piraten. Irgendwo dort oben beobachten fünf weitere Gesandte deine Entscheidung.*
>
> *Dein Terminal blinkt. Eine Nachricht: „Gouverneur – die wöchentliche Lageübersicht steht bereit. Ihr erster Tag beginnt."*

---

**Button:** `→ Zur Lageübersicht` *(= Tutorial-Einstieg)*

### Übergangsanimation

- Kurzer **Warp-Strich-Effekt** via `WarpFX` (ENGAGE → kurz → DISENGAGE) als visueller Schnitt
- Fade zu Schwarz, dann Fade-in auf die erste Tutorial-Ansicht
- Dauer: ~2 Sekunden

---

## 8. UX-Zustandsmaschine & Flussdiagramm

```
[index.html geladen]
        │
        ▼
[Prüfung: eingeloggter User?]
  ├── JA → [Direkt zum Spiel] ──────────────────────────────┐
  └── NEIN                                                   │
        │                                                    │
        ▼                                                    │
[STUFE 1: Cinematic-Willkommen]                             │
  ├── [Skip-Button] ─────────────────────────────────────┐  │
  └── [Weiter / Klick nach 5s]                           │  │
        │                                                │  │
        ▼                                                │  │
[STUFE 2: E-Mail/Name/Passwort-Eingabe]                  │  │
  ├── [Validierungsfehler → Flavor-Fehlermeldung]        │  │
  └── [Erfolgreiche Einreichung]                         │  │
        │                                                │  │
        ▼                                                │  │
[STUFE 3: Fraktionswahl-Karten] ◄────────────────────────┘  │
  ├── [Hover/Tap → Expansion]                               │
  └── [Klick → Bestätigungsdialog]                         │
        ├── [Zurück]                                        │
        └── [Bestätigen]                                    │
              │                                            │
              ▼                                            │
[STUFE 4: Fraktionsspezifischer Prolog]                    │
  └── [Weiter / Klick nach 15s]                           │
        │                                                  │
        ▼                                                  │
[STUFE 5: Übergangssequenz + Tutorial-Start] ◄─────────────┘
```

### Zustandspeicherung

Der Prologfortschritt wird im `sessionStorage` gehalten (nicht `localStorage`), sodass ein Tab-Neustart den Prolog neu beginnt. Nach erfolgreichem Tutorial-Einstieg wird die Fraktion dauerhaft im Spielerprofil (DB) gespeichert.

| Schlüssel | Wert | Beschreibung |
|---|---|---|
| `gq_prolog_step` | `1`–`5` | Aktuelle Prologstufe |
| `gq_prolog_faction` | Fraktion-ID | Gewählte Fraktion (nach Stufe 3) |
| `gq_prolog_reg_email` | String | Vorausgefüllte E-Mail (nach Stufe 2) |

---

## 9. Technische Implementierungshinweise

### Integration in bestehende Auth-Shell

Das bestehende `auth.js` (`js/network/auth.js`) steuert bereits Login/Register-Tabs und die `auth-section` / `game-section`-Umschaltung. Der Prolog wird **vor** der Auth-Section eingeblendet und nutzt dasselbe DOM-Switching-Muster.

```
index.html:
  <section id="prolog-section">...</section>   ← NEU
  <section id="auth-section">...</section>      ← bestehend
  <section id="game-section">...</section>      ← bestehend
```

### Neue Komponenten

| Komponente | Beschreibung |
|---|---|
| `js/ui/prolog.js` | Zustandsmaschine für alle 5 Prologstufen |
| `js/ui/faction-select.js` | Fraktionskarten-Renderer + Interaktion |
| `css/prolog.css` | Terminal-Styling, Typewriter-Animation, Kartenlayout |

### Wiederverwendete Systeme

| System | Verwendung im Prolog |
|---|---|
| `StarfieldFX` | Hintergrundsterne in Stufe 1 |
| `WarpFX` | Übergangsanimation in Stufe 5 |
| `Nebula_Overture.mp3` | Musik in Stufe 1 (bereits im Auth-Preload) |
| `GQLog` | Prolog-Debug-Ausgaben |
| `auth.js` Spinner / Modal | Lade-Feedback bei Stufe 2 Einreichung |

### Fraktion-ID-Mapping

Die gewählte Fraktion wird als `home_faction_id` im `users`-Datenbankfeld gespeichert (das bestehende `resolvePlayerFactionThemeSeed()` in `game.js` nutzt dieses Feld bereits für UI-Themes).

| Fraktion | `home_faction_id` |
|---|---|
| 🦎 Vor'Tak | 1 |
| 🐙 Syl'Nar | 2 |
| 🔥 Aereth | 3 |
| 🦗 Kryl'Tha | 4 |
| 💎 Zhareen | 5 |
| 🌫️ Vel'Ar | 6 |

---

## 10. Narrative Designregeln

Diese Regeln gelten für alle Prolog-Texte und zukünftige Erweiterungen:

1. **Second Person, Präsens:** Alle Prolog-Texte verwenden „Du" / „Ihr" und Präsens. Der Spieler *ist* der Gouverneur.
2. **Kein Mechanik-Sprache:** Worte wie „Buff", „Bonus", „Skill", „Stat" kommen nicht vor.
3. **Zeigen statt Erklären:** Fraktion-Stärken werden durch Verhalten der Herolde demonstriert, nicht beschrieben.
4. **Asymmetrische Information:** Jeder Herold *verschweigt* etwas. Die Vel'Ar-Karte suggeriert dies explizit.
5. **Keine endgültige Bindung im Prolog:** Die Fraktionswahl bestimmt den Startvorteil, nicht den Spielpfad. Dies muss subtil kommuniziert werden (z.B. im Bestätigungsdialog: *„Eure erste Treue – sie muss nicht eure letzte sein."*)
6. **Konsistente Zeichen:** Kursiv für In-Universe-Sprache, `[Eckige Klammern]` für Systemaktionen, normaler Text für Erzählung.

---

## 11. Offene Fragen & Varianten

### Offene Entscheidungen

| Frage | Optionen | Empfehlung |
|---|---|---|
| Wird die Fraktionswahl nach dem Prolog noch änderbar sein? | (A) Nein, permanent; (B) Nur im Tutorial; (C) Jederzeit in den Settings | **(B)** – Flexibilität im Tutorial, dann fix |
| Wie wird der Prolog für Rückkehrer (Re-Login) gehandhabt? | (A) Immer überspringen; (B) Wählen; (C) Nur Stufe 1 anzeigen | **(B)** – Opt-in via Settings |
| Gibt es Prolog-Varianten für zukünftige Fraktionssympathangebote? | Derzeit nicht geplant | Platzhalter in `gq_prolog_faction` lassen |
| Sollen die Texte lokalisiert werden? | (A) Nur DE; (B) DE + EN; (C) Vollständige i18n | **(B)** mittelfristig |

### Variante: Kein Fraktions-Pick (Isolation Path)

Für Spieler, die den [Isolationspfad](FACTION_INTRODUCTION.md#11-alternative-systemmodelle-die-abkehr-vom-rufpfad) wählen möchten:

- Ein siebter „Karte" in der Fraktionsauswahl: **„Alle ablehnen"**
- Label: *„Khal'Vethis gehört Khal'Vethis."*
- Spezieller Prolog: Du schließt die Tür. Alle sechs Herolde draußen. Stille.
- Startbedingungen: Kein Startbonus, aber kein Faction-Debt

### Variante: Prolog-Replay

Im späteren Spielmenü (Einstellungen → Profil) ein Button:  
*„Einstiegsszene erneut ansehen"* – spielt alle Stufen ohne Registrierungsformular ab (rein cinematisch).

---

*Dieses Dokument ist Grundlage für Implementierungs-Issues in `docs/github-issues/`. Technische Detailspezifikationen (API-Endpunkte für Fraktion-Zuweisung, CSS-Animationsparameter) werden separat dokumentiert, sobald die Konzeptphase abgeschlossen ist.*

---

**Verwandte Dokumente:**
- [FACTION_INTRODUCTION.md](FACTION_INTRODUCTION.md) – Vollständige Fraktionslore & Tutorial-Klimax
- [GAMEDESIGN.md](GAMEDESIGN.md) – Universumsbeschreibung & Fraktionsübersicht
- [BONUS_MALUS_DESIGN.md](BONUS_MALUS_DESIGN.md) – Startvorteile je Fraktion (Tier-0-Boni)
- [TEMPLATE_SYSTEM_DESIGN.md](../technical/TEMPLATE_SYSTEM_DESIGN.md) – UI-Rendering-Architektur für neue UI-Komponenten
