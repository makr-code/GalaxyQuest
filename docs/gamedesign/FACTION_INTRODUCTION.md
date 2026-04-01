# 🌌 Fraktionseinführung – Spielerstart & Aufstieg in der Kalytherion-Konvergenz

**Version:** 1.3  
**Status:** Konzept & LORE – Blaupause für Spieldesign & Erzählung  
**Zugehörig zu:** [GAMEDESIGN.md](GAMEDESIGN.md) → [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md)  
**Entscheidungen (kanonisch):** Rasse bei Spielstart wählen · Isolationspfad vollständig spezifiziert · Legacy-NPC-Fraktionen Hard-Replace (ALTER + UPDATE) · Spieler-Startmitgliedschaft · Gilde-Gründung möglich (Spieler-eigene Organisationen)

---

## Inhaltsverzeichnis

1. [Die Ausgangslage: Eine Randwelt am Rand der Geschichte](#1-die-ausgangslage-eine-randwelt-am-rand-der-geschichte)
2. [LORE-Prolog: Das Erwachen von Khal'Vethis](#2-lore-prolog-das-erwachen-von-khalvethis)
3. [Der Spielercharakter: Gouverneur der Randwelt](#3-der-spielercharakter-gouverneur-der-randwelt)
4. [Das Erstkontakt-Ereignis: Die Sechs Herolde](#4-das-erstkontakt-ereignis-die-sechs-herolde)
5. [Die Säulen des Aufstiegs](#5-die-säulen-des-aufstiegs)
   - 5.1 Agitieren · 5.2 Handeln · 5.3 Wirtschaft · 5.4 Militärische Macht
   - 5.5 Wissen & Forschung · 5.6 Information & Nachrichtendienst
   - 5.7 Kulturelle Brücke & Mediation · 5.8 Bevölkerungspolitik & Migration
6. [Das Fraktionsruf-System: Stufenaufstieg](#6-das-fraktionsruf-system-stufenaufstieg)
7. [Fraktionsspezifische Wege & Belohnungen](#7-fraktionsspezifische-wege--belohnungen)
8. [Spannungsfelder: Wenn Fraktionen sich widersprechen](#8-spannungsfelder-wenn-fraktionen-sich-widersprechen)
9. [Die Tutorial-Klimax: Die Erste Krise von Khal'Vethis](#9-die-tutorial-klimax-die-erste-krise-von-khalvethis)
10. [Langzeit-Einfluss: Macht im Konvergenzrat](#10-langzeit-einfluss-macht-im-konvergenzrat)
11. [Alternative Systemmodelle: Die Abkehr vom Rufpfad](#11-alternative-systemmodelle-die-abkehr-vom-rufpfad)
    - 11.1 Die eigene Bevölkerung als siebte Fraktion
    - 11.2 Einfluss statt Ruf: Das Schuldensystem
    - 11.3 Der Isolationspfad: Khal'Vethis als Freistaat (vollständig)
      - 11.3.1 Aktivierungsbedingungen
      - 11.3.2 Souveränitäts-Score
      - 11.3.3 Spielphasen-Verlauf
      - 11.3.4 Exklusive Mechaniken
      - 11.3.5 Endgame-Bedingung
      - 11.3.6 Hard-Replace: Legacy NPC-Fraktionen in DB
12. [Zuckerbrot & Peitsche: Hoher Einfluss verpflichtet](#12-zuckerbrot--peitsche-hoher-einfluss-verpflichtet)
    - 12.1 Einfluss-Schwellen und Einbindungsstufen (Tier 4 = Erster Berater)
    - 12.1a Staatsgebilde: Demokratie/Autokratie/Oligarchie/Theokratie/Meritokratie/Netzwerk
    - 12.2 Fraktionsmandat: Ressourcen-Mandat vs. Beratungs-Mandat (Einflüstern)
    - 12.3 Zuckerbrot: Belohnungen (inkl. Staatsgebilde-Multiplikator + advisor_trust)
    - 12.4 Peitsche: neglect_count, Staatsgebilde-Modifikator, Multiplayer-Ripple, Grace-Period
    - 12.5 Mandats-Typen nach Fraktionscharakter
    - 12.6 Balancing-Parameter (revidiert)
    - 12.7 DB-Schema & API (erweitert: advisory-Felder, galactic_events)
    - 12.8 Implementierungs-Phasen (revidiert)
    - 12.9 Multiplayer-Ripple: Spezifikation
13. [Spieler-Fraktionszugehörigkeit & Gilden](#13-spieler-fraktionszugehörigkeit--gilden)
    - 13.1 Konzept: Mitgliedschaft vs. Ruf (Abgrenzung zu §6/§12)
    - 13.2 Startmitgliedschaft: Rasse → interne Fraktionsstelle
    - 13.3 Was Mitgliedschaft bedeutet (Boni, Pflichten, interne Quests)
    - 13.4 Fraktionswechsel via Quest & Diplomatie
    - 13.5 Eintreten und Austreten
    - 13.6 Eigene Gilde gründen
    - 13.7 DB-Schema & API
    - 13.8 Implementierungsphasen

---

## 1. Die Ausgangslage: Eine Randwelt am Rand der Geschichte

### Was ist Khal'Vethis?

**Khal'Vethis** (im Volksmund: *„Die Wegscheide"*, im Vel'Ar-Slang: *„Das Ungeschriebene"*) ist der siebenundzwanzigste eingetragene Siedlungsposten an der galaktischen Außengrenze der Kalytherion-Konvergenz. Die Welt wurde vor achtzehn Standardjahren von einer Expedition des Kernrats notiert – nicht wegen besonderer Ressourcen oder strategischer Bedeutung, sondern weil sie schlicht *auf dem Weg* zu einer interessanteren Destination lag.

**Planetare Eckdaten:**

| Eigenschaft | Wert |
|---|---|
| Typ | Felsige Randwelt (Kategorie III-B) |
| Masse | 0,72 Erdäquivalente |
| Atmosphäre | Dünn, atembar mit Atemhilfe |
| Ressourcen | Bescheiden – Erze, geringe Methanvorkommen, ein instabiles Mineral namens **Vethisit** |
| Besonderheit | Gravitationsknoten: Khal'Vethis liegt exakt im Schnittpunkt dreier stabiler **FTL-Transitkorridore** |
| Bevölkerung | ~4.200 Siedler (gemischte Abstammung, von den 6 Fraktionen eingeschlossene Familien, Nichtangepasste, Abenteurer) |
| Status | Unklassifiziert – kein vollwertiges Konvergenzmitglied |

### Die strategische Lage

Khal'Vethis liegt am Schnittpunkt der **Drei Alten Korridore**:

```
         [Drak'Thuun – Vor'Tak Kernreich]
                    |
                    |  Korridor Khal-Alpha
                    |
  [Oon'Vareth]----[KHAL'VETHIS]----[Sol'Ryaan]
  Syl'Nar            |               Aereth
                     |  Korridor Khal-Beta
                     |
              [Zyr'Mekar – Kryl'Tha]
```

Diese Position macht Khal'Vethis de facto zu einem **galaktischen Transitknoten** – wer hier eine Station, ein Sprungtor oder einen Flottenstützpunkt errichtet, kontrolliert die schnellsten Verbindungen zwischen vier Fraktionshomeworlds. Die Welt war bisher zu klein und zu bedeutungslos, um Aufmerksamkeit zu erregen. Doch das ändert sich.

### Das Vethisit-Problem und die Gelegenheit

Vor zwei Standardjahren entdeckten lokale Bergarbeiter tiefe Vorkommen eines bisher unbekannten Minerals – **Vethisit** –, das bei Kontakt mit FTL-Feld-Emissionen resoniert. Die Aereth-Wissenschaftler nennen es *„einen lebenden Leiter für Raum-Krümmungsenergie"*. Was das genau bedeutet, weiß niemand – aber alle sechs Fraktionen haben es mitbekommen.

---

## 2. LORE-Prolog: Das Erwachen von Khal'Vethis

*In-Universe Erzählung – Perspektive des Konvergenzrats*

---

*Aus den Archiven der Zhareen, Fragment 7.441.329-B:*

> Der Rat der Konvergenz behandelte die Randwelt Khal'Vethis über sieben Standardjahre hinweg als das, was sie war: eine Notiz in einem Katalog ohne Index. Kein Ratsmitglied hatte je Zeit verschwendet, den Namen auszusprechen.
>
> Das änderte sich an jenem Tag, als Archiv-Sonde YR-14 ihre Messdaten übermittelte. Die Vethisit-Resonanzwerte waren nicht nur ungewöhnlich – sie waren *unmöglich*. Das Mineral schien auf FTL-Transition-Energie zu reagieren wie ein Spiegel auf Licht: gebündelt, verstärkt, zurückgeworfen. In einem Knotenpunkt dreier Transitkorridore.
>
> General Drak'Mol ließ die Messdaten dreimal prüfen, bevor er sprach:
> *„Eine Welt, die Sprungfelder bündeln kann, an einem Punkt, durch den vier unserer Kernwelten verbunden sind. Wir haben zu lange geschlafen."*
>
> Hohepriesterin Vela'Thii schwieg lange. Dann: *„Die Welt war ungeschrieben, damit sie von uns geschrieben werden kann. Oder von unseren Feinden."*
>
> Schattenzirkel-Agentin Shy'Nira hatte – wie immer – das letzte Wort. Sie sprach es so leise, dass die meisten Ratsmitglieder nicht hörten:
> *„Die Siedler dort... haben bereits ihren eigenen Gouverneur gewählt."*

---

*Aus dem persönlichen Tagebuch von Lix Carrath, erste Siedlerin der Gründungskolonie, Jahr 3 nach Ankunft:*

> Wir kamen wegen nichts. Manche flohen vor dem Schildzirkel, manche vor den Steuern auf Oon'Vareth, manche hatten einfach nirgendwo anders hin. Khal'Vethis nahm uns auf – stumm und felsig und karg, aber *unseres*. Wir bauten Unterkunftsmodule aus Schiffswandplatten. Wir aßen, was wir anbauen konnten. Wir hatten keine Flotte, keine Akademie, keine Tempel.
>
> Und dann kamen die Herolde.

---

## 3. Der Spielercharakter: Gouverneur der Randwelt

### 3.1 Rasse bei Spielstart wählen *(kanonische Entscheidung)*

**Entscheidung:** Der Spieler wählt **bei der Kontoerstellung** eine der sechs Hauptrassen der Kalytherion-Konvergenz. Die Wahl ist **dauerhaft** und prägt Startwerte, FTL-Antrieb, passive Boni sowie die **initiale Fraktionsmitgliedschaft**.

> **Designbegründung (OD-1 aus FTL_DRIVE_DESIGN.md §8):** Rasse ≡ FTL-Antrieb für mehr Kohärenz. Wahl *nach* dem Tutorial verwässert die First-Impressions; eine frühe Entscheidung erzeugt stärkere Identifikation mit der Spielwelt.

**UI-Flow:**
```
Registrierung → Benutzername/Passwort → [Rasse wählen – 6 Karten mit Lore-Blurb + FTL-Vorschau] → Startkolonie-Generierung
```

**Rassenboni und Startmitgliedschaft:**

| Rasse | Passiver Startbonus | FTL-Antrieb | Startmitgliedschaft |
|---|---|---|---|
| 🦎 **Vor'Tak** | `military_readiness` +10 | Kearny-Fuchida Sprung | Vor'Tak (Rang: *Neubürger*) |
| 🐙 **Syl'Nar** | `trade_income_mult` +0.08 | Resonanz-Gate-Netz | Syl'Nar (Rang: *Neubürger*) |
| 🔥 **Aereth** | `research_speed_mult` +0.08 | Alcubierre-Warp | Aereth (Rang: *Neubürger*) |
| 🦗 **Kryl'Tha** | `pop_growth_mult` +0.06 | Schwarmtunnel | Kryl'Tha (Rang: *Neubürger*) |
| 💎 **Zhareen** | `colony_stability_flat` +5 | Kristall-Resonanz | Zhareen (Rang: *Neubürger*) |
| 🌫️ **Vel'Ar** | `spy_detection_flat` +8 | Blinder Quantensprung | Vel'Ar (Rang: *Neubürger*) |

**DB-Abbildung:** `users.race ENUM('vortak','sylnar','aereth','kryltha','zhareen','velar') NOT NULL` — Hard-Replace der bisherigen Nullwerte via Migration (siehe §11.4).

**Mitgliedschaft ≠ Ruf:** Die Startmitgliedschaft setzt `user_faction_membership.status = 'member'` für die Heimatfraktion und gibt +10 Standing als Startwert. Mitgliedschaft und Ruf sind zwei *parallele* Systeme (→ §13 für vollständige Spezifikation).

**Neutraler Modus entfällt:** Es gibt keine „keine Rasse"-Option mehr. Wer den Isolationspfad spielen will, startet trotzdem mit einer Rasse und Mitgliedschaft – er löst die Mitgliedschaft dann aktiv auf (→ §13.5) und nutzt bewusst *nicht* die Fraktionsbindung (→ §11.3).

---

### 3.2 Wer spielt der Spieler?

Der Spieler übernimmt die Rolle des **neu gewählten Gouverneurs von Khal'Vethis** – eines Angehörigen seiner gewählten Rasse, der entweder aus der Kolonie selbst stammt (jemand, dem die Gemeinschaft vertraut) oder kürzlich von der Konvergenz als Verwaltungspersönlichkeit entsandt wurde.

**Wichtig für das Spielgefühl:** Die Rasse ist der *kulturelle Hintergrund*, die Fraktionsmitgliedschaft ist die *politische Herkunft*, und die *politische Gegenwart* ist das, was der Spieler daraus macht. Als Mitglied der Heimatfraktion hat er interne Loyalitätspflichten – aber er kann die Mitgliedschaft kündigen, wechseln oder eine eigene Gilde aufbauen (→ §13). Das gibt dem Spieler eine echte Entscheidung: *Heimatfraktion vertiefen, wechseln, oder ganz eigenständig werden?*

### Ausgangswerte

| Parameter | Startwert |
|---|---|
| Koloniegröße | Klein (4.200 Einwohner) |
| Wirtschaftsstufe | Subsistenz (kein Handelsüberschuss) |
| Flottenstärke | 2 ältere Patrouillen-Corvetten, 1 Frachter |
| Ruf bei Heimatfraktion | Stufe 1 – *„Bekannt"* (Startbonus durch Rasse) |
| Mitgliedschaft | Heimatfraktion: Rang *Neubürger* (`member`, Rang 1/5) |
| Ruf bei den anderen 5 Fraktionen | Stufe 0 – *„Unbekannt"* |
| Vethisit-Produktion | Gering, aber wachstumsfähig |
| Besonderheit | Lage im Dreifach-Korridor + Vethisit-Vorkommen |

### Die Hauptmotivation

Khal'Vethis hat *Potenzial*, aber keine *Macht*. Der Gouverneur muss entscheiden:

- Ob er die Mitgliedschaft in der Heimatfraktion vertieft, zu einer anderen wechselt oder austritt
- Ob er eine eigene Gilde aufbaut (→ §13.6)
- Welchen Fraktionen er sich nähert und welche er als Erster Berater berät (→ §12)
- Womit er sich bezahlt macht
- Welchen Preis er bereit ist zu zahlen
- Wem er vertraut – und wem nicht

---

## 4. Das Erstkontakt-Ereignis: Die Sechs Herolde

### Das auslösende Ereignis: „Der Ruf der Wegscheide"

Zwei Standardwochen nach Bekanntwerden der Vethisit-Messdaten landen innerhalb von drei Tagen sechs unangekündigte Shuttles auf Khal'Vethis. Jedes bringt einen **Herold** – einen offiziellen Gesandten einer der sechs Hauptfraktionen. Sie kommen nicht mit Kriegsschiffen. Noch nicht. Sie kommen mit Angeboten.

Dies ist das **Tutorial-Einführungsereignis** des Spiels. Jeder Herold stellt sich vor, beschreibt seine Fraktion aus deren Perspektive und macht ein erstes, niedrigschwelliges Angebot. Der Spieler ist nicht verpflichtet, sich sofort zu entscheiden.

---

### Die sechs Herolde

#### 🦎 Herold des Schildzirkels – Vor'Tak
**Name:** *Sharr'Keth* (weiblich, taktische Analystin, Mittlerin zwischen Militär und Diplomatie)  
**Erscheinung:** Schlanke Vor'Tak-Kriegerin in smaragdgrüner Zeremonienrüstung mit goldenen Akzenten. Bewegt sich mit der Ökonomie jemandes, der Bewegungen nie verschwendet.  
**Erste Worte:** *„Wir bieten keine Freundschaft. Wir bieten Verlässlichkeit. Wenn deine Welt stark ist, werden wir sie respektieren. Wenn sie schwach ist, werden andere sie verschlingen."*  
**Erstes Angebot:** Einen kleinen Vor'Tak-Militärberater als Berater für den Kolonieschutz + zwei veraltete Schiffsblaupausen.  
**Was sie wirklich will:** Den Dreifach-Korridor für Vor'Tak-Truppentransporte sichern. Und herausfinden, ob Vethisit militärische Anwendungen hat.

---

#### 🐙 Herold des Lichtbunds – Syl'Nar
**Name:** *Tael'Mii* (männlich, junger Priester im Außendienst)  
**Erscheinung:** Blassblaue cephalopode Gestalt in fließendem Gewand aus biolumineszierendem Stoff. Kommuniziert teils über subtile Farbveränderungen seiner Haut.  
**Erste Worte:** *„Khal'Vethis ist eine Welt ohne Geschichte – und das ist ein Geschenk. Ihr könnt entscheiden, wer ihr seid, bevor andere es für euch entscheiden."*  
**Erstes Angebot:** Drei Syl'Nar-Händler mit Handelskapital + Saat von drei Nahrungspflanzen, die in dünner Atmosphäre gedeihen.  
**Was er wirklich will:** Eine spirituell unabhängige Welt als Ausgleichsgewicht gegen den wachsenden Militarismus des Schildzirkels. Und Kontakt zu den Vethisit-Resonanzeigenschaften – er glaubt, das Mineral könnte mit dem kosmischen Fluss der Konvergenz verbunden sein.

---

#### 🔥 Herold des Kernrats – Aereth
**Name:** *Vel'Saar* (geschlechtsneutral, Energie-Manifestation in einer artifiziellen Körperhülle)  
**Erscheinung:** Schimmernde weiß-blaue Silhouette in einem biomechanischen Trägeranzug. Bewegungen sind zu präzise für biologisches Wesen.  
**Erste Worte:** *„Das Mineral auf eurer Welt verändert, wie Raum sich faltet. Wir wollen es verstehen. Ihr wollt Ressourcen. Das ist ein Tausch."*  
**Erstes Angebot:** Technologischer Daten-Cluster mit Produktionseffizienz-Upgrades im Wert von 6 Standardmonaten Kolonieentwicklung.  
**Was sie wirklich wollen:** Exklusivzugang zu Vethisit-Proben für Sol'Kaars Forschungsprogramm. Zu welchem Programm genau – das sagen sie nicht.

---

#### 🦗 Herold der Schwarmkommandatur – Kryl'Tha
**Name:** *Zhaa'Kirr* (weiblich, Brutkammer-Gesandte, spricht im pluralen Wir)  
**Erscheinung:** Kompakte Kryl'Tha-Kriegerin mit goldturquoisem Chitinmuster – die Färbung einer Offizierin. Bewegt sich in kleinen, ruckartigen Bewegungen.  
**Erste Worte:** *„Wir sprechen kurz: Eure Welt liegt zwischen Wegen. Wege brauchen Bewachung. Wir bewachen Wege. Gebt uns Land für einen Brutposten. Wir geben euch Schutz."*  
**Erstes Angebot:** Vier Kryl'Tha-Sicherheitskräfte als sofortige Verteidigungseinheit.  
**Was sie wirklich will:** Einen Außenposten mit Brutkapazitäten – Kryl'Tha-Bevölkerung dehnt sich aus, und Transit-Knotenpunkte sind ideal für Schwarmlogistik. Außerdem: die Welt liegt nahe an einem Raumbereich, in dem die Eisenflotte zuletzt gesichtet wurde.

---

#### 💎 Herold des Archivrats – Zhareen
**Name:** *Kael'Thin* (männlich, sehr alt – fast 800 Jahre – Wandernd-Archivar)  
**Erscheinung:** Zhareen-Archivar in kristallgrauem Gewand, durchsetzt mit winzigen Speicherkristallen, die sanft leuchten. Spricht langsam, als würde jedes Wort gewogen.  
**Erste Worte:** *„Eure Welt ist jung. Eure Geschichte... klein. Aber Vethisit ist etwas, das wir noch nie aufgezeichnet haben. Das macht es... wertvoll. Lasst uns es aufschreiben, bevor andere es verbrauchen."*  
**Erstes Angebot:** Archiv-Zugang zu Zhareen-Wissensdatenbanken (enorm nützlich für Forschung und Diplomatie).  
**Was er wirklich will:** Kael'Thin vertritt auch die Perspektive von Archivar Kaelor – er sucht auf geheimer Mission nach Hinweisen, ob Vethisit eine Verbindung zum Riss-Ereignis hat, das Aeryth'Luun zerstört. Er ist der erste, der dem Spieler andeutet: *Die Leerenbrut könnte auf diese Welt aufmerksam werden.*

---

#### 🌫️ Herold des Schattenzirkels – Vel'Ar
**Name:** *Nira'Vel* (Geschlecht unbekannt – wechselnd je nach Kontext, trägt eine Maske)  
**Erscheinung:** Eine nebelartige Gestalt in einer menschenähnlichen Biomaske mit mischweiß-lavendelartigem Körpernebel. Erscheint immer dann, wenn man nicht aufpasst.  
**Erste Worte:** *„Die anderen fünf haben dir gerade alle erzählt, was sie wollen. Ich sage dir, was du wirklich brauchst: jemanden, der weiß, was die anderen fünf wirklich wollen."*  
**Erstes Angebot:** Eine einmalige Geheimdienstinformation über einen der anderen fünf Herolde.  
**Was sie wirklich will:** Einen nicht nachverfolgbaren Stützpunkt auf einer unregistrierten Welt. Khal'Vethis ist ideal. Aber das wird erst in Stufe 3 gesagt.

---

## 5. Die Säulen des Aufstiegs

Der Ruf bei den Fraktionen wächst nicht automatisch – der Spieler muss aktiv Entscheidungen treffen. Es gibt **acht Grundmechanismen**, durch die Ruf erworben werden kann. Die ersten vier (5.1–5.4) sind ressourcenbasiert; die vier weiteren (5.5–5.8) beruhen auf anderen Machtlogiken und eröffnen alternative Spielidentitäten.

---

### 5.1 🗣️ Agitieren (Politisches Manövrieren)

**Definition:** Aktive politische Positionierung – öffentliche Erklärungen, Rat-Abstimmungen, Propaganda, Lobbyarbeit, Demonstrationen des Wertesystems.

**Funktionsweise im Spiel:**
- Der Spieler kann sich bei Schlüsselereignissen öffentlich zu einer Fraktion bekennen (z. B. „Ich unterstütze die militärische Position des Schildzirkels im Transitkorridor-Streit")
- Agitation erzeugt schnell hohe Sympathie bei *einer* Fraktion, auf Kosten von Reputation bei anderen
- Agitation hat Dauerwirkung: Ein gemachtes Statement kann nicht leicht zurückgenommen werden
- Besonders wirksam bei: **Vor'Tak** (Stärke zeigen), **Vel'Ar** (Informationshandel), **Syl'Nar** (spirituelle Ausrichtung bekennen)

**Beispiel-Aktionen:**

| Aktion | Ruhendes Ergebnis |
|---|---|
| Öffentliche Rede zur Stärke der Konvergenz-Allianz | +Schildzirkel, +Lichtbund, −Vel'Ar (Transparenz störend) |
| Unterstützung von Schildzirkel im Kornrat-Konflikt | +Vor'Tak +Kryl'Tha, −Aereth |
| Agitation gegen Menschenexpansion | +alle 6, aber nur schwach |
| Neutralitätserklärung in Fraktionskonflikt | +Vel'Ar (Unberechenbarkeit), −Schildzirkel |

---

### 5.2 🚢 Handeln (Wirtschaftliche Beziehungen)

**Definition:** Aufbau von Handelsrouten, Ressourcentausch, bevorzugte Handelskonditionen, Exklusivverträge.

**Funktionsweise im Spiel:**
- Der Spieler kann Ressourcen, Produkte oder Dienstleistungen anbieten
- Handelsbeziehungen bringen **passive Rufgewinne** über Zeit – langsam, aber stetig
- Exklusiv-Handelsabkommen mit einer Fraktion können andere verstimmen
- Vethisit ist die wertvollste Handelsware – jede Fraktion will Zugang; der Spieler entscheidet, wer bekommt wie viel

**Beispiel-Aktionen:**

| Aktion | Ergebnis |
|---|---|
| Vethisit-Liefervertrag mit Aereth | +Kernrat +Aereth, −Zhareen (wollen selbst forschen) |
| Syl'Nar als Haupthandelspartner | +Lichtbund, moderate +Wirtschaft, −Kryl'Tha (Syl'Nar-Einfluss wächst) |
| Freier Handelshafen (alle dürfen) | +etwas bei allen, keine Exklusivboni |
| Versorgung von Vor'Tak-Grenzposten | +Schildzirkel, militärische Ausrüstungsrabatte |
| Waffenhandel mit Kryl'Tha | +Schwarmmacht, diplomatische Spannung mit Syl'Nar |

---

### 5.3 🏗️ Wirtschaft (Kolonie-Entwicklung)

**Definition:** Interne Entwicklung der Kolonie – Produktionskapazitäten, Bevölkerungswachstum, Infrastruktur, Technologiestand, Stabilität.

**Funktionsweise im Spiel:**
- Eine prosperierende Kolonie zieht automatisch Aufmerksamkeit und Respekt an
- Bestimmte Entwicklungspfade (z. B. Tempel, Forschungsstation, Festung) signalisieren automatisch Affinität zu einer Fraktion
- Wirtschaft ist der *langsamste* Weg, generiert aber den stabilsten Ruf ohne Verluste bei anderen

**Entwicklungspfade und Fraktionsaffinitäten:**

| Entwicklung | Affinität |
|---|---|
| Militärfestung + Garnison | Vor'Tak, Kryl'Tha |
| Forschungsstation | Aereth, Zhareen |
| Spirituelles Zentrum / Tempel | Syl'Nar |
| Handels- und Hafenanlage | Syl'Nar, Vel'Ar |
| Geheimdienstbunker + Kommunikationsstörung | Vel'Ar |
| Kristall-Archivstation | Zhareen |
| Bevölkerungswachstum & Wohlstand | Alle moderat |
| Ökologische Integrität der Welt | Syl'Nar, Zhareen |

---

### 5.4 ⚔️ Militärische Macht

**Definition:** Aufbau, Einsatz und Demonstration von militärischer Stärke – Flotte, Garnison, Kampf-Reputation.

**Funktionsweise im Spiel:**
- Militärische Stärke ist direkte Sprache für Vor'Tak und Kryl'Tha
- Piratenjagd, Schutz von Handelsschiffen und Teilnahme an Fraktions-Militäroperationen erhöhen Ruf
- Zu viel militärische Entwicklung kann Syl'Nar und Zhareen verunsichern
- Militärmacht ist der *schnellste* Ruferwerber, hat aber das höchste Konfliktpotenzial

**Beispiel-Aktionen:**

| Aktion | Ergebnis |
|---|---|
| Piratenangriff auf Handelsroute abwehren | +Schildzirkel, +Lichtbund, +Vel'Ar (schätzen Sicherheit) |
| Khar'Morr-Syndikat aus Korridor vertreiben | +alle Fraktionen (moderate) |
| An Vor'Tak-Militärübung teilnehmen | ++Schildzirkel, −Lichtbund |
| Eigene Flotte demonstrieren (Parade) ohne Anlass | +Schildzirkel, misstrauisch: Vel'Ar |
| Eisenflotten-Schiff abfangen und zerstören | ++alle (starker Ruf-Boost für alle) |
| Verbündeter Kryl'Tha-Angriff auf unklaren Feind | ++Kryl'Tha, −Syl'Nar, diplomatischer Druck |

---

### 5.5 🔬 Wissen & Forschung

**Definition:** Aktive Erforschung der Welt, ihrer Anomalien, des Vethisits und der galaktischen Geschichte – und gezielte Weitergabe dieser Erkenntnisse.

**Abgrenzung zu „Wirtschaft" (5.3):** Wirtschaft misst *was du baust*; Wissen misst *was du entdeckst und an wen du es weitergibst*.

**Funktionsweise im Spiel:**
- Expeditionen auf Khal'Vethis und in den Dreifach-Korridor fördern Forschungsergebnisse zutage
- Jede Entdeckung (Vethisit-Datensatz, Raumanomalie, historisches Artefakt) kann nur *einmal* exklusiv geteilt werden
- Der Empfänger entscheidet anschließend: bleibt die Entdeckung vertraulich, oder wird sie publiziert?
- Besonders wirksam bei: **Aereth** (Wissenschaft), **Zhareen** (Archivierung); beim Zurückhalten: **Vel'Ar** (Informationsmonopol)

**Beispiel-Aktionen:**

| Aktion | Ergebnis |
|---|---|
| Vethisit-Resonanzanalyse exklusiv an Aereth übergeben | ++Kernrat, −Zhareen (wollen selbst forschen) |
| Ergebnisse frei veröffentlichen | +moderat alle, kein Exklusivbonus |
| Anomalie-Daten geheim halten | +Vel'Ar (Informationsasymmetrie), −Aereth |
| Khal'Vethis-Gründungsartefakt sichern und archivieren | ++Zhareen, +Syl'Nar |
| Forschungsdaten nachträglich an rivalisierende Fraktion weitergeben | −Aereth (Exklusivitätsbruch), +Zhareen |

**Spielmechanische Besonderheit:** Forschungsergebnisse sind *nicht reproduzierbar*. Derselbe Datensatz kann nicht zweimal exklusiv weitergegeben werden. Dies erzeugt echte Opportunitätskosten – ein fundamentaler Unterschied zu den ressourcenbasierten Säulen.

---

### 5.6 🕵️ Information & Nachrichtendienst

**Definition:** Systematische Sammlung, Auswertung und selektive Weitergabe von Informationen über Fraktionsbewegungen, Schiffsverkehr und persönliche Geheimnisse.

**Abgrenzung zu „Agitieren" (5.1):** Agitation ist *was du öffentlich sagst*; Information ist *was du heimlich weißt und wann du es teilst*.

**Funktionsweise im Spiel:**
- Khal'Vethis als Transitknoten registriert automatisch Schiffsbewegungen und Kommunikation
- Der Spieler entscheidet, wer Zugang zu diesen Daten bekommt
- Informationen können auch *zurückgehalten* werden – Passivität als Machtinstrument
- Vel'Ar schätzt jeden Austausch; andere Fraktionen schätzen nur für sie relevante Informationen
- **Einzige Säule ohne Ressourcenkosten:** Ruf kann durch das entstehen, was man *nicht* tut

**Beispiel-Aktionen:**

| Aktion | Ergebnis |
|---|---|
| Vor'Tak-Flottenbewegungen an Vel'Ar weitergeben | ++Vel'Ar, −Vor'Tak (bei Entdeckung) |
| Khar'Morr-Syndikat-Routen an alle teilen | +moderat alle (Gemeinschaftsnutzen) |
| Wissen, wer der Verräter ist – und schweigen | +Vel'Ar, Zeitgewinn zum Manövrieren |
| Syl'Nar-Geheimmission enttarnen – und Syl'Nar warnen | ++Syl'Nar, −Vel'Ar (Geheimhaltungsbruch) |
| Doppelspiel: zwei Fraktionen widersprüchliche Infos geben | ++Vel'Ar kurzfristig, drastische Folgen bei Entdeckung |

**Spielmechanische Besonderheit:** Information ist die einzige Säule, die **Ruf durch Passivität** aufbaut. Wer Informationen sammelt und zurückhält, wird für andere Akteure unberechenbar – und Unberechenbarkeit ist Vel'Ars wichtigste Währung.

---

### 5.7 🌐 Kulturelle Brücke & Mediation

**Definition:** Khal'Vethis als neutraler Ort für Fraktionsgipfel, Kulturveranstaltungen, Konfliktschlichtung und interplanetaren Austausch.

**Abgrenzung zu „Agitieren" (5.1):** Agitation bedeutet, *für eine Seite Position zu beziehen*; Mediation bedeutet, *zwischen Seiten zu vermitteln, ohne eigene Position*.

**Funktionsweise im Spiel:**
- Der Spieler kann Konferenzen, Ausstellungen und Kulturfestivals ausrichten
- Jedes Mediations-Event erhöht den Ruf bei *allen beteiligten Fraktionen* moderat
- Echter Bonus nur, wenn der Spieler tatsächlich neutral bleibt: bestehende einseitige Allianzen (Stufe 4+) untergraben die Glaubwürdigkeit als Mediator
- Besonders relevant für den **Isolationspfad** (siehe Abschnitt 11.3)

**Beispiel-Aktionen:**

| Aktion | Ergebnis |
|---|---|
| Vor'Tak–Syl'Nar-Gipfel auf Khal'Vethis ausrichten | +beide, Khal'Vethis als anerkannter Begegnungsort |
| Interkulturelles Fest (alle 6 Fraktionen eingeladen) | +moderat alle, +Kolonial-Ruf |
| Kryl'Tha–Aereth-Forschungskonflikt schlichten | ++beide, spezifischer Quest-Fortschritt |
| Als Mediator positionieren, aber heimlich Vor'Tak bevorzugen | +Vor'Tak, Glaubwürdigkeitsverlust bei Entdeckung |

**Spielmechanische Besonderheit:** Mediation ist der einzige **Anti-Optimierungs-Pfad**. Je ausgewogener die Rufwerte bei allen Fraktionen bleiben, desto stärker wirkt diese Säule. Wer einseitig min-maxiert, verliert die Mediationsboni. Belohnt Spieler, die bewusst auf Exklusiv-Allianzen verzichten.

---

### 5.8 🌱 Bevölkerungspolitik & Migration

**Definition:** Aktive oder passive Steuerung, wer auf Khal'Vethis siedelt – und damit, welche Fraktionskultur organisch in die Kolonie einwächst.

**Abgrenzung zu allen anderen Säulen:** Andere Säulen basieren auf aktiven Entscheidungen; diese Säule akkumuliert *langsam und passiv* aus Migrationsentscheidungen über viele Spielzyklen.

**Funktionsweise im Spiel:**
- Jede Fraktions-Einwanderungswelle verändert die demografische Zusammensetzung der Kolonie
- Bevölkerungsgruppen bringen passiven Ruf bei ihrer Heimatfraktion ein, aber auch interne Spannungen
- Bevölkerungsstruktur ist schwer umzukehren – Entscheidungen früher Spielphasen haben dauerhaften Einfluss
- Die eigene Bevölkerung wird zu einem eigenständigen Machtfaktor (Vorschau auf Abschnitt 11.1)

**Migrationsentscheidungen und Fraktionsaffinitäten:**

| Einwanderer-Gruppe | Passiver Ruf | Koloniale Konsequenz |
|---|---|---|
| Vor'Tak-Veteranen | +Vor'Tak/Zyklus | Militärische Stärke, interne Disziplin |
| Syl'Nar-Händler | +Syl'Nar/Zyklus | Wirtschaftswachstum, Spiritualität steigt |
| Aereth-Forscher | +Aereth/Zyklus | Forschungsboni, hohe Ressourcenanforderungen |
| Kryl'Tha-Familien | +Kryl'Tha/Zyklus | Sicherheit, kulturelle Spannungen mit anderen Gruppen |
| Vel'Ar-Flüchtlinge | +Vel'Ar (Diskretion) | Schattenwirtschaft entsteht, schwer kontrollierbar |
| Fraktionslose Siedler | +Kolonial-Ruf | Loyalität zum Gouverneur, keine Fraktion profitiert extern |

**Spielmechanische Besonderheit:** Migration ist die einzige **völlig passive Säule** – keine aktiven Aktionen erforderlich. Die Kolonie entwickelt sich demografisch aufgrund früher Migrationspolitik. Dies erzeugt einen echten Langzeit-Gedächtniseffekt: Die Kolonie *erinnert sich* an die Entscheidungen des Gouverneurs.

---

## 6. Das Fraktionsruf-System: Stufenaufstieg

Jede der sechs Fraktionen bewertet den Spieler auf einer **7-stufigen Ruf-Skala**:

| Stufe | Name | Beschreibung |
|---|---|---|
| -1 | **Feind** | Aktiver Konflikt – Fraktion versucht aktiv zu schaden |
| 0 | **Unbekannt** | Startposition – keine Beziehung |
| 1 | **Wahrgenommen** | Fraktion hat die Welt registriert, kein aktives Interesse |
| 2 | **Anerkannt** | Erste offizielle Kontakte, kleine Handelsoptionen freigeschaltet |
| 3 | **Geschätzt** | Vertrauenswürdiger Kontakt; Technologie- und Ressourcentausch möglich |
| 4 | **Verbündet** | Aktiver Partner; militärische Kooperation, Diplomatie-Privilegien |
| 5 | **Vertrauter** | Innerer Kreis-Zugang; einzigartiges LORE, geheime Angebote, politischer Einfluss |

### Ruf-Mechanik

- **Rufgewinn:** Aktionen, Quests, Handelsvolumen, politische Statements
- **Rufverlust:** Widersprüchliche Handlungen, Vertragsbruch, Unterstützung von Fraktionsfeinden
- **Ruf-Zerfall:** Ruf oberhalb Stufe 2 beginnt ohne aktive Pflege langsam zu sinken (−0,5/Zyklus)
- **Fraktionskonflikt-Malus:** Bestimmte Rufstiegen bei einer Fraktion kosten automatisch Ruf bei Antagonisten (z. B. Vor'Tak-Alliiertenstatus kostet Syl'Nar-Punkte)
- **Maximale Parallelallianzen:** Bis zu 4 Fraktionen können gleichzeitig auf Stufe 3+ gehalten werden; 5 oder 6 gleichzeitig erfordert außergewöhnlich hohe Spielerfähigkeit (Master-Pfad)

---

## 7. Fraktionsspezifische Wege & Belohnungen

### 🦎 Vor'Tak – Der Schildzirkel

**Rufrelevante Aktionen:**
- Militärische Stärke demonstrieren (Flottengröße, Kampfsiege)
- Agitation für Konvergenz-Verteidigung
- Bereitstellung von Khal'Vethis als Transitposten für Vor'Tak-Flotten

**Dinge, die Ruf zerstören:**
- Kapitulation vor Feinden
- Bündnisse mit der Eisenflotte
- Öffentliche Pazifismus-Erklärungen

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Vor'Tak-Verteidigungsberater; Zugang zu Basisschiffsblaupausen |
| 3 – Geschätzt | Militärischer Ausrüstungshandel; Vor'Tak-Schutztruppe (25 Mann) |
| 4 – Verbündet | Gemeinsame Flottenoperationen; Zugang zu Drak'Morr-Zerstörer-Klasse |
| 5 – Vertrauter | LORE-Zugang: Zugang zu General Drak'Mols persönlicher Kampfstrategie-Bibliothek; Sonderauftrag: *„Die Ehre der Drak'Thuun"* |

---

### 🐙 Syl'Nar – Der Lichtbund

**Rufrelevante Aktionen:**
- Handelsbeziehungen aufbauen (besonders Nahrung, Wasser, organische Waren)
- Spirituelles Zentrum auf Khal'Vethis errichten
- Diplomatische Lösungen gegenüber militärischen bevorzugen
- Vethisit-Resonanz-Daten mit Syl'Nar teilen (sie glauben: kosmische Verbindung)

**Dinge, die Ruf zerstören:**
- Rüstungsgeschäfte mit Kryl'Tha
- Umweltzerstörung auf Khal'Vethis
- Angriff auf neutrale Parteien

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Syl'Nar-Händlernetzwerk auf Khal'Vethis; Biolumineszenz-Technologie |
| 3 – Geschätzt | Diplomatische Immunität in Syl'Nar-Territorium; Handels-Bonusboni |
| 4 – Verbündet | Syl'Nar-Mediatorenstatus: Kann Konflikte zwischen anderen Fraktionen schlichten |
| 5 – Vertrauter | LORE-Zugang: Hohepriesterin Vela'Thiis Geheimnis – telepathische Leerenbrut-Verbindung; Nebenquest: *„Die Stimme unter dem Wasser"* |

---

### 🔥 Aereth – Der Kernrat

**Rufrelevante Aktionen:**
- Vethisit-Proben für Forschung bereitstellen
- Forschungsstation auf Khal'Vethis bauen
- Technologische Projekte finanzieren / unterstützen
- Aereth-Forscher auf Khal'Vethis willkommen heißen

**Dinge, die Ruf zerstören:**
- Vethisit exklusiv an Konkurrenz-Fraktionen geben
- Wissenschaftliche Erkenntnisse zurückhalten
- Forschungssabotage

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Produktionseffizienz-Upgrades; Basis-Technologiedaten-Cluster |
| 3 – Geschätzt | Dimensionale Sensorik für die Kolonie; Zugang zu FTL-Optimierungstechnologie |
| 4 – Verbündet | Phasenshift-Waffensysteme; gemeinsame Forschungsprojekte |
| 5 – Vertrauter | LORE-Enthüllung: Sol'Kaars Verbindung zur Leerenbrut (erster Hinweis); Nebenquest: *„Das Experiment, das nicht aufgehört hat"* |

---

### 🦗 Kryl'Tha – Die Schwarmkommandatur

**Rufrelevante Aktionen:**
- Land für Kryl'Tha-Brut-Außenposten bereitstellen
- Gemeinsame Verteidigungsoperationen
- Logistik-Unterstützung für Kryl'Tha-Patrouillen
- Eisenflotten-Aggressionen melden und bekämpfen

**Dinge, die Ruf zerstören:**
- Kryl'Tha-Lebewesen gefangen halten oder untersuchen
- Eisenflotten-Kontakte herstellen
- Brutposten-Anfragen ablehnen

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Kryl'Tha-Sicherheitskräfte (4 Mann); Organisches Reparatursystem |
| 3 – Geschätzt | Schwarm-Drohnen-Patrouille; Selbstheilende Chitin-Panzerung für Flotte |
| 4 – Verbündet | Kryl'Tha-Verstärkung bei militärischen Operationen; Schwarm-Taktik-Upgrades |
| 5 – Vertrauter | LORE-Enthüllung: Kommandantin Zha'Miras Trauma durch menschliche Experimente; Nebenquest: *„Die gestohlene Brutkammer"* |

---

### 💎 Zhareen – Der Archivrat

**Rufrelevante Aktionen:**
- Archiv-Station auf Khal'Vethis errichten
- Historische Artefakte melden und sichern
- Forschungsdaten teilen (nicht an Konkurrenten geben)
- Vethisit-Herkunftsgeschichte erforschen lassen

**Dinge, die Ruf zerstören:**
- Wissensverlust durch Fahrlässigkeit
- Entscheidungen die Zerstörung von Geschichte in Kauf nehmen
- Ignoranz gegenüber Warnsignalen (besonders bzgl. Leerenbrut)

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Zhareen-Wissensdatenbank-Zugang; historische Karten des Dreifach-Korridors |
| 3 – Geschätzt | Kristall-Datenknoten für Kolonie (massive Forschungsboni); Bewusstseins-Upload-Technologie (NFT für Gründercharakter) |
| 4 – Verbündet | Prismatische Lichtwaffen-Systeme; einzigartiger Diplomatie-Bonus durch historisches Wissen |
| 5 – Vertrauter | LORE-Enthüllung: Archivar Kaelors Zweifel an der Konvergenz; Nebenquest: *„Die Kristall-Erinnerungen von Aeryth'Luun"*; Hinweis auf Leerenbrut-Ursprung |

---

### 🌫️ Vel'Ar – Der Schattenzirkel

**Rufrelevante Aktionen:**
- Informationen beschaffen und teilen (auch über andere Fraktionen)
- Neutrale oder mehrdeutige politische Haltungen
- Geheime Treffen zulassen
- Khal'Vethis als informelle Kommunikationsstation nutzen lassen

**Dinge, die Ruf zerstören:**
- Transparenz, die Vel'Ar-Agenten gefährdet
- Absolute Allianz mit einer anderen Fraktion (macht Spieler unbrauchbar als neutralen Aktor)
- Vel'Ar-Agenten enttarnen

**Stufenbelohnungen:**

| Stufe | Belohnung |
|---|---|
| 2 – Anerkannt | Nachrichtendienst-Berichte über andere Fraktionen; Tarnfeld-Upgrade für Schiffe |
| 3 – Geschätzt | Vel'Ar-Agenten für Spionageaufgaben verfügbar; erweiterte Sensorik |
| 4 – Verbündet | Zugang zu Fraktionsgeheimnissen (spielmechanisch: Insider-Informationen über alle anderen Fraktionen); Gas-Nanowolk-Waffen |
| 5 – Vertrauter | LORE-Enthüllung: Shy'Niras vollständiges Wissensnetz inkl. Sol'Kaars Geheimnis; Nebenquest: *„Die Maske der Ewigkeit"*; politische Blackmail-Mechaniken |

---

## 8. Spannungsfelder: Wenn Fraktionen sich widersprechen

Nicht alle Fraktionsbeziehungen lassen sich gleichzeitig maximieren. Die folgende Matrix zeigt, welche Allianzen sich besonders gut oder schlecht vertragen:

### Kompatibilitäts-Matrix (Gleichzeitige Hochruf-Kombinationen)

| Kombination | Kompatibilität | Konfliktgrund |
|---|---|---|
| Vor'Tak + Kryl'Tha | ✅ Sehr gut | Beide militärorientiert |
| Syl'Nar + Zhareen | ✅ Gut | Beide wissens-/kulturorientiert |
| Aereth + Zhareen | ✅ Gut | Wissenschaft + Archivierung |
| Vel'Ar + Jede | ⚠️ Möglich, instabil | Vel'Ar destabilisiert Allianzen |
| Vor'Tak + Syl'Nar | ⚠️ Schwierig | Militarismus vs. Pazifismus |
| Aereth + Kryl'Tha | ⚠️ Schwierig | Forschungsethik-Konflikte |
| Syl'Nar + Kryl'Tha | ❌ Konfliktreich | Waffenhandel-Differenzen |
| Vel'Ar + Vor'Tak | ❌ Schwierig | Transparenz vs. Geheimnis |

### Beispiel-Dilemma: Das Vethisit-Monopol

Sobald der Spieler Vethisit in nennenswerter Menge produziert, wollen es alle sechs Fraktionen. Mögliche Entscheidungen:

1. **Freier Markt:** Kleiner Rufsgewinn bei allen, kein Exklusivbonus
2. **Aereth-Exklusiv:** Starker Kernrat-Ruf, Zhareen-Verlust, Syl'Nar-Misstrauen
3. **Militärallianz (Vor'Tak + Kryl'Tha):** Starke Verteidigung, schlechte Syl'Nar-Beziehung
4. **Heimliche Verteilung:** Hohes Vel'Ar-Ruf, riskant bei Entdeckung durch andere

---

## 9. Die Tutorial-Klimax: Die Erste Krise von Khal'Vethis

### Das Ereignis: „Der Khar'Morr-Angriff"

Vier Standardwochen nach Ankunft der Herolde nähert sich eine Flotte des **Khar'Morr-Syndikats** (Piratenfraktion) dem Dreifach-Korridor. Ihr Ziel: Khal'Vethis plündern und Vethisit stehlen.

Der Spieler hat begrenzte eigene Militärkräfte. Nun muss er entscheiden, bei wem er um Hilfe bittet:

**Optionen:**

| Reaktion | Sofort-Effekt | Langzeitkonsequenz |
|---|---|---|
| **Vor'Tak um Flottenhilfe bitten** | Schildzirkel kommt mit Zerstörern, Piraten vernichtet | Starke +Vor'Tak, Vor'Tak fühlt sich verpflichtet mitzureden |
| **Kryl'Tha-Schwarmpfad abwehren lassen** | Kryl'Tha-Patrouillen retten die Kolonie | +Kryl'Tha, kleiner Kryl'Tha-Außenposten entsteht dauerhaft |
| **Diplomatisch: Syl'Nar vermitteln lassen** | Khar'Morr tritt zurück (gegen Bezahlung) | +Syl'Nar, Khar'Morr kommen wieder |
| **Aereth-Technologie nutzen (FTL-Korridor sperren)** | Piraten gefangen in Feldsphäre | +Aereth, technische Schulden |
| **Vel'Ar informieren (Geheimtipp über Piraten-Boss)** | Khar'Morr dreht um (sie wissen, es gibt Konsequenzen) | +Vel'Ar, Ruf als jemand mit gefährlichen Kontakten |
| **Selbst kämpfen (ohne Hilfe)** | Riskant aber möglich – Teilsieg | +alle moderat, Beweise echter Unabhängigkeit |
| **Kapitulieren** | Verluste, aber Überleben | -alle Fraktionen, besonders Vor'Tak |

### Das Ergebnis der Klimax

Unabhängig vom Ausgang enthüllt die Krise dem Spieler das **Kerndilemma der Randwelt**: Jede Hilfe hat einen Preis, und dieser Preis ist immer ein Stück Autonomie oder ein Stück Vertrauen bei einem anderen.

Am Ende der Krise erscheinen alle sechs Herolde erneut – diesmal nicht nacheinander, sondern simultan in einer angespannten Zusammenkunft. Jeder kommentiert die Entscheidung des Spielers. Dies ist der erste Moment, in dem die Spielfigur spürt:

> *„Khal'Vethis ist nicht mehr unbedeutend. Es ist ein Brennglas."*

---

## 10. Langzeit-Einfluss: Macht im Konvergenzrat

### Von der Randwelt zum Ratssitz

Mit zunehmendem Ruf bei mehreren Fraktionen verändert sich nicht nur die lokale Situation auf Khal'Vethis – der Spieler beginnt, **reale politische Macht in der Kalytherion-Konvergenz** zu entwickeln.

**Meilensteine:**

| Bedingung | Ereignis | Auswirkung |
|---|---|---|
| 3 Fraktionen auf Stufe 3+ | **„Die Randwelt wird gehört"** – Einladung zu einer Ratssitzung als Beobachter | Erste politische Abstimmungsmöglichkeit |
| 4 Fraktionen auf Stufe 3+ | **„Der Knoten"** – Khal'Vethis wird offiziell als Konvergenzmitglied anerkannt | Vollwertiger Ratssitz, Kolonie wächst |
| 5+ Fraktionen auf Stufe 4+ | **„Die Vermittlerwelt"** – Spieler wird aktiver politischer Broker | Einfluss auf Konvergenzkonflikte (direkter Akt-1-Einstieg) |
| Alle 6 auf Stufe 4+ | **„Schüssel aller Fraktionen"** – Khal'Vethis wird zum galaktischen Versammlungsort | Master-Pfad: Spieler kann die Konvergenz *von innen* lenken |

### Einfluss auf Hauptkampagne-Akte

Der Ruf-Stand bei Fraktionen verändert die Optionen in den **6 Hauptakten der Kampagne**:

- **Akt 1 (Der Riss):** Höherer Aereth-Ruf → mehr Information über den Riss; höherer Schildzirkel-Ruf → mehr Militäroptionen
- **Akt 2 (Der Verrat):** Höherer Vel'Ar-Ruf → Schattenzirkel teilt Informationen über Doppelagenten-Option
- **Akt 3 (Die verlorene Welt):** Höherer Zhareen-Ruf → mehr Rettungszeit-Fenster durch vorzeitige Evakuierungs-Koordination
- **Akt 4 (Ursprung der Leerenbrut):** Höherer Aereth-Ruf → Sol'Kaars Geständnis kommt früher; Vel'Ar-Ruf → Informationen über Zusammenhang
- **Akt 5 (Die Spaltung):** Spieler mit breiter Fraktionsbasis kann als Mediator agieren und Spaltung verhindern
- **Akt 6 (Kern der Leere):** Breite Allianz-Basis öffnet das *echte gute Ending* (Konvergenz gerettet und gestärkt)

### Das finale Versprechen

> Die Welt, auf der niemand beginnen wollte, wird zur Welt, auf der alles entschieden wird.  
> Nicht weil Khal'Vethis besonders war – sondern weil du daraus etwas besonderes gemacht hast.

---

## 11. Alternative Systemmodelle: Die Abkehr vom Rufpfad

### Strukturelles Problem der Aufstiegssäulen

Die acht Säulen (Abschnitte 5.1–5.8) teilen ein gemeinsames Paradigma: Alle sind im Kern *Investitionen* – der Spieler gibt Ressourcen, Zeit oder politisches Kapital aus und erhält Ruf zurück. Das System ist transparent und planbar, kann bei konsequenter Optimierung jedoch mechanisch wirken.

Die folgenden drei Modelle brechen dieses Paradigma auf unterschiedliche Weise auf. Sie können als eigenständige Hauptpfade, als ergänzende Layer über dem Rufmeter oder als emergente Late-Game-Optionen implementiert werden.

---

### 11.1 🏛️ Die eigene Bevölkerung als siebte Fraktion

**Kernidee:** Die 4.200 Siedler von Khal'Vethis sind keine Kulisse – sie sind eine eigenständige Machtbasis. Neben dem *externen* Fraktionsruf (gegenüber den sechs Hauptfraktionen) existiert ein **Kolonialruf**: Wie sehr vertrauen die eigenen Leute dem Gouverneur?

**Mechanik:**
- **Hoher Kolonialruf:** Die Bevölkerung folgt dem Gouverneur, verweigert Fraktionsforderungen, die gegen lokale Interessen gehen → echte Autonomie
- **Niedriger Kolonialruf:** Bevölkerungsgruppen orientieren sich an den Fraktionsgesandten → der Gouverneur verliert die eigene Basis
- **Strukturelle Spannung:** Was Fraktionen wollen, schadet oft der Kolonie. Vor'Tak-Militarisierung macht die Zivilbevölkerung unglücklich; Syl'Nar-Offenheit bringt Vel'Ar-Misstrauen. Es gibt keine Lösung, die beides maximiert.

**Spielmechanisch:** Der Kolonialruf verändert, *was möglich ist*. Bei hohem Kolonialruf kann der Gouverneur Fraktionsforderungen ablehnen, ohne Krisen auszulösen. Bei niedrigem Kolonialruf verliert er schrittweise die Kontrolle – Fraktionsagenten beginnen, direkt mit der Bevölkerung zu kommunizieren.

**Warum es das System bereichert:** Es gibt dem Spieler ein Eigeninteresse, das *nicht* von den sechs Fraktionen definiert wird. „Gouverneur der Bevölkerung" versus „Klient der Mächtigen" wird zur echten Spielidentitätsfrage.

---

### 11.2 💸 Einfluss statt Ruf: Das Schuldensystem

**Kernidee:** Statt Ruf als numerische Skala (0–5) wird *gegenseitige Abhängigkeit* gemessen – wer schuldet wem was?

**Mechanik:**
- Jede Fraktion führt intern eine Liste: *Was hat der Gouverneur für uns getan? Was haben wir gegeben? Was schulden wir? Was schuldet er uns?*
- Ein Gefallen in der Not wiegt schwerer als zehn routinemäßige Handelslieferungen
- **Schulden können auch negativ eingesetzt werden:** „Du schuldest uns noch – oder wir machen das öffentlich."
- Ruf entsteht nicht durch Bar-Meter, sondern durch narrative Ereignisse und Erinnerungen

**Verhältnis zum bestehenden Rufmeter:** Das Schuldensystem läuft *parallel* zum Rufmeter – das Rufmeter ist die sichtbare, spielerseitige Vereinfachung; das Schuldensystem ist die komplexere Realität dahinter. Fraktionen mit hohem Rufmeter, aber negativem Schuldensaldo (der Spieler hat viel genommen, wenig gegeben), werden irgendwann Rückzahlung fordern.

**Spielmechanisch:** Weniger explizit als der Rufbalken – informiert Dialoge, Ereignisse, Angebotskonditionen. Für den Spieler erst sichtbar, wenn Fraktionen Schulden einfordern.

**Warum es das System bereichert:** Es entfernt die Gamification-Schicht an kritischen Momenten. Fraktionen verhalten sich wie echte politische Akteure, die Gefallen tracken – nicht wie Reputations-Dispensarien.

---

### 11.3 🌑 Der Isolationspfad: Khal'Vethis als Freistaat *(vollständig spezifiziert)*

**Kernidee:** Was, wenn der Spieler bewusst *allen* Hauptfraktionen den Rücken kehrt? Anstatt sich in das Rufmeter-System einzufügen, baut der Spieler Khal'Vethis als eigenständige Macht auf. Der Isolationspfad ist kein Scheitern – er ist ein eigener, vollwertiger Siegpfad.

---

#### 11.3.1 Aktivierungsbedingungen

Der Pfad gilt als **aktiv**, wenn gleichzeitig gilt:

| Bedingung | Konkrete Schwelle |
|---|---|
| Kein aktives Bündnis mit einer Hauptfraktion | Ruf ≤ Stufe 2 bei *allen* sechs Hauptfraktionen |
| Eigenständige Handelsrouten | ≥ 3 aktive Handelsrouten zu Helion-Konföderation, Nomaden des Rifts oder fraktionslosen Randwelten |
| Vethisit-Kontrolle | Kein aktiver Exklusivvertrag mit einer Hauptfraktion (`vethisit_contract = NULL`) |
| Souveränitäts-Score | `sovereignty_score ≥ 40` (siehe §11.3.2) |

Das System prüft diese Bedingungen einmal pro Stunde im `npc_ai`-Tick. Bei Aktivierung wird `users.isolation_path_active = 1` gesetzt und das Journal-Event `isolation_path_activated` gefeuert.

---

#### 11.3.2 Souveränitäts-Score (`sovereignty_score`)

Ein neuer Empire-Score (0–100), der ausschließlich durch den Isolationspfad relevant ist:

```
sovereignty_score = CLAMP(
    (unabhängige_handelsrouten × 8)
  + (verbündete_randwelten × 12)
  + (vethisit_export_selbstvermarktung_anteil × 30)
  + (turns_ohne_hauptfraktionskontakt × 0.05)
  − (hauptfraktions_quests_abgeschlossen × 5)
  , 0, 100
)
```

| Score-Band | Bedeutung | Effekt |
|---|---|---|
| 0–39 | Abhängig | Kein Isolationspfad |
| 40–59 | Eigenständig | Pfad aktiv; erste Randwelten schließen sich an |
| 60–79 | Bewegung | Khal'Vethis gilt als Anführer; Druckkampagnen der Hauptfraktionen beginnen |
| 80–99 | Freistaat | Handelsembargo-Versuche der Hauptfraktionen; starke Synergieboni |
| 100 | Konvergenz-Faktor | Endgame-Bedingung erfüllt (siehe §11.3.5) |

**DB-Feld:** `users.sovereignty_score TINYINT UNSIGNED NOT NULL DEFAULT 0` – wird via `scripts/project_user_overview.php` jede Stunde neu berechnet.

---

#### 11.3.3 Spielphasen-Verlauf

**Phase 1 – Stille Abkehr (Stunden 1–15)**
- Spieler lehnt Angebote der Hauptfraktionen ab oder ignoriert sie
- Keine unmittelbaren Konsequenzen; `sovereignty_score` steigt langsam
- *Journal-Events:* „Gerüchte über Khal'Vethis' Unabhängigkeitswillen" (Fraktionen informieren sich)

**Phase 2 – Erste Konsequenzen (Stunden 15–35)**
- Hauptfraktionen senden Drohbotschaften und reduzierten Handelszugang
- Erste Randwelten nehmen Kontakt auf (`isolation_path_ally_request`-Event)
- Spieler kann Allianzen mit bis zu 8 Randwelten eingehen (eigenes Netz)
- *Journal-Events:* „Khal'Vethis als Hoffnungsträger", „Vor'Tak verhängt Transitsperre"

**Phase 3 – Aktive Bedrohung (Stunden 35–60)**
- Mindestens zwei Hauptfraktionen deklarieren `status = 'hostile'`
- Militärische Überfälle möglich (gesteuert via `npc_ai`-Angriffswahrscheinlichkeit × `sovereignty_score / 100`)
- Khal'Vethis erhält Zugang zu exklusiven Randwelt-Technologien (Forschungsboni)
- *Journal-Events:* „Die Konvergenz diskutiert Khal'Vethis im Rat", „Dreieinigkeit der Randwelten"

**Phase 4 – Freistaat-Etablierung (Stunden 60–100)**
- `sovereignty_score ≥ 80`
- Khal'Vethis hat ein eigenes diplomatisches Netz aus ≥ 5 Randwelten
- Alle sechs Hauptfraktionen reagieren mit Druck (Handelsembargo, Spionage)
- Spieler kann einen **Randwelt-Rat** gründen: eigene politische Fraktion

**Phase 5 – Endgame (ab Stunde 100+)**
- `sovereignty_score = 100` aktiviert den Siegpfad (§11.3.5)

---

#### 11.3.4 Exklusive Mechaniken des Isolationspfads

| Mechanik | Beschreibung | DB / Code |
|---|---|---|
| **Randwelt-Allianz** | Bündnisse mit fraktionslosen Systemen; jedes gibt +12 `sovereignty_score` | `isolation_allies`-Tabelle |
| **Vethisit-Selbstvermarktung** | Spieler steuert Export-Preis direkt am Galaktischen Markt (+20% Marge) | `GalacticMarket.setDirectExport()` |
| **Technologie-Sharing** | Randwelt-Verbündete teilen einzigartige Schiffshull-Varianten frei | `vessel_hulls.source = 'isolation_network'` |
| **Konvergenz-Ratsstimme** | Ab `sovereignty_score ≥ 60`: 1 permanente neutrale Stimme im Rat (blockiert einseitige Entscheidungen gegen Randwelten) | `council_votes`-Tabelle |
| **Informationsnetz** | Randwelt-Spionagenetz (ohne eigene Agenten) – passive Bedrohungsvorwarnung | `intel_feed`-Tabelle |

---

#### 11.3.5 Endgame-Bedingung: „Khal'Vethis – Siebter Ratssitz"

**Aktivierung:** `sovereignty_score = 100` + mind. 5 Randwelt-Verbündete + Vethisit unter lokaler Kontrolle

**Spielmechanisch:**
1. Khal'Vethis bewirbt sich um einen Ratssitz im Konvergenzrat (Quest: *„Die Stimme der Vergessenen"*)
2. Die sechs Hauptfraktionen stimmen ab — Ergebnis hängt vom Standing und von Schulden ab
3. **Erfolgsbedingung:** mind. 3 Stimmen (kann durch Schuldensystem aus §11.2 beeinflusst werden)
4. **Bei Erfolg:** Spieler hält den einzigen neutralen Ratssitz — permanente Vetomacht gegen Beschlüsse, die Randwelten schaden

**Thematische Bedeutung:** Der Isolationspfad kehrt die Tutorial-Prämisse um. Der Spieler wird eingeführt als jemand, den die sechs Fraktionen formen wollen – doch wer das System erkennt und sich entzieht, schreibt eine fundamental andere Geschichte. Khal'Vethis war als Werkzeug geplant; es wird stattdessen zum Spiegel.

---

#### 11.3.6 Hard-Replace: Legacy NPC-Fraktionen in DB *(kanonische Entscheidung)*

**Entscheidung: ALTER + UPDATE (Hard-Replace, kein Soft-Rename).**

Begründung: Soft-Rename würde `ENUM`-Werte und `type`-Spalten inkonsistent lassen. Hard-Replace via Migration ist sauberer und vermeidet doppelte Code-Pfade.

```sql
-- Migration: migrate_npc_factions_hardreplace_v1.sql

-- 1. Neue Spalten hinzufügen (neue kanonische Namen)
ALTER TABLE npc_factions
    MODIFY COLUMN type ENUM(
        'military','trade','science','pirate','ancient',
        'spiritual','espionage','archival','metamorphic',
        'primal_ai','post_organic_ai','void_entity',
        'schismatic','cult','military_human','eternal_brood',
        'default'
    ) NOT NULL DEFAULT 'default';

-- 2. Legacy-Code-Werte auf kanonische Werte umschreiben
UPDATE npc_factions SET code = 'aethernox'       WHERE code IN ('ancient_watchers','alte_waechter');
UPDATE npc_factions SET code = 'kharmorr'        WHERE code IN ('pirate_syndicate','piratensyndikate');
UPDATE npc_factions SET code = 'helion'          WHERE code IN ('trade_confed','handelskonfoed');
UPDATE npc_factions SET code = 'iron_fleet'      WHERE code IN ('human_fleet','eisenflotte_alt');
UPDATE npc_factions SET code = 'omniscienta'     WHERE code IN ('ai_collective','ki_kollektiv');
UPDATE npc_factions SET code = 'myrketh'         WHERE code IN ('metal_swarm','metallschwarm');
UPDATE npc_factions SET code = 'void_echoes'     WHERE code IN ('void_fragments','leerenbrut_fragmente');
UPDATE npc_factions SET code = 'verath_heretics' WHERE code IN ('schismatics','ketzer_alt');
UPDATE npc_factions SET code = 'light_architects'WHERE code IN ('light_cult','lichtarchitekten_alt');
UPDATE npc_factions SET code = 'rift_nomads'     WHERE code IN ('nomads','nomaden_alt');
UPDATE npc_factions SET code = 'eternal_brood'   WHERE code IN ('brood_eternal','brut_alt');
-- Neue Fraktionen 12 + 13 (Hard-Insert falls nicht vorhanden)
INSERT IGNORE INTO npc_factions (code, name, type, power_level, aggression, trade_willingness)
    VALUES
    ('shadow_compact', 'Das Schattenkompakt', 'espionage', 5, 4, 3),
    ('genesis_collective', 'Das Genesis-Kollektiv', 'metamorphic', 6, 2, 7);
```

**Referenz-Entscheidung:** Hard-Replace statt Soft-Rename, weil:
- Keine aktiven Produktionsdaten betroffen (Pre-Launch)
- `ENUM`-Sauberkeit wichtiger als Migrationseinfachheit
- Code-Pfade in `api/factions.php` und `npc_ai.php` nutzen `code`-Werte direkt

---

### Implementierungsempfehlung

| Systemelement | Implementierungsphase | Priorität |
|---|---|---|
| 🌱 Bevölkerungspolitik (5.8) | Phase 1 – passives System, wenig Aufwand | Hoch |
| 🔬 Wissen & Forschung (5.5) | Phase 1 – Expeditions-Quest-Layer | Hoch |
| 🏛️ Kolonialruf als 7. Fraktion (11.1) | Phase 2 – eigene Ruf-Skala | Hoch |
| 🕵️ Information & Nachrichtendienst (5.6) | Phase 2 – Informationsdaten-System | Mittel |
| 🌐 Mediation (5.7) | Phase 2 – Event-basiert | Mittel |
| 💸 Schuldensystem (11.2) | Phase 3 – paralleles System | Mittel |
| 🌑 Isolationspfad §11.3.1–11.3.4 | Phase 3 – Sovereignty-Score + Randwelt-Allianzen | Mittel |
| 🏆 Isolationspfad §11.3.5 Endgame | Phase 4 – Ratsstimme + Siegpfad | Niedrig |
| 🗄️ Hard-Replace §11.3.6 Migration | Pre-Phase-1 – vor erstem Produktionsdaten | Hoch |
| 🥕 Zuckerbrot & Peitsche §12 – Mandats-System | Phase 2 – parallel zu BONUS_MALUS §13 Phase 4–5 | Hoch |

---

## 12. Zuckerbrot & Peitsche: Hoher Einfluss verpflichtet

> **Designprinzip:** Wer viel von einer Fraktion genommen hat, dem nimmt die Fraktion auch etwas.
> Hoher Einfluss ist keine passive Statuszahl – er ist eine *Bringschuld*. Die Fraktion investiert
> in den Spieler, weil sie eine Gegenleistung erwartet. Wer dauerhaft nicht liefert, verliert
> beides: Ruf und die Früchte des Einflusses.
>
> **Kanonische Grenze (2026-04-01):** Der Spieler wird **niemals zum Anführer oder Mitglied** einer
> NPC-Fraktion. Die höchste erreichbare Position ist **Erster Berater** – ein externer Vertrauensträger,
> der Entscheidungen *einflüstert*, aber nie selbst trifft. Die NPC-Fraktion entscheidet eigenständig;
> der Einfluss des Spielers bestimmt, wie stark seine Empfehlung gewichtet wird.

---

### 12.1 Einfluss-Schwellen und Einbindungsstufen

Ab bestimmten **Ruf-Stufen** (§6) wird der Spieler aktiv in Fraktionsangelegenheiten eingebunden.
Der Übergang ist graduell: zuerst Einladungen, dann Erwartungen, schließlich die Rolle des Beraters.

| Ruf-Stufe | Einbindungsstufe | Titel (intern) | Was passiert? |
|---|---|---|---|
| Stufe 0–1 | **Unbeteiligt** | — | Fraktion sendet gelegentlich Anfragen; Ablehnung folgenlos |
| Stufe 2 | **Beachtet** | Kontaktperson | Fraktion informiert den Spieler über Ereignisse; Anfragen häufiger |
| Stufe 3 | **Eingebunden** | Vertrauensträger | Fraktion übersendet regelmäßige **Mandate** (§12.2); Nicht-Entscheiden kostet Ruf |
| Stufe 4 | **Erster Berater** | *Erster Berater* | Spieler „flüstert ein": erhält Zugang zu internen Fraktionsentscheidungen und kann *Empfehlungen* abgeben; NPC-KI entscheidet eigenständig, gewichtet Empfehlung aber stark |

> **Warum keine höhere Stufe?** NPC-Fraktionen sind eigenständige politische Entitäten mit
> Hunderttausenden von Mitgliedern, langer Geschichte und einer internen Machtstruktur.
> Ein externer Gouverneur einer Randwelt *kann* kein Anführer werden – das wäre narrativ
> unglaubwürdig und spielmechanisch übermächtig. Die Berater-Rolle ist die authentische Grenze:
> man ist wichtig genug, dass man gehört wird, aber nie so wichtig, dass die Fraktion sich
> blind ergibt.

**Technische Abbildung:** `diplomacy.influence_tier TINYINT` (0–4, parallel zu `current_tier`).
Wird jede Stunde im `npc_ai`-Tick auf Basis von `standing` + kumulierter Interaktionshistorie
berechnet. **Zusätzlich:** `diplomacy.advisor_accepted TINYINT(1) DEFAULT 0` – Fraktion muss
den Berater-Status formal akzeptieren (Trigger: 3. ACCEPTED-Mandat auf Stufe 3 = Einberufung).

---

### 12.1a Staatsgebilde: Wie Regierungsform das Einflüstern modifiziert

Jede NPC-Fraktion hat ein `npc_factions.government_type` — dieses bestimmt, **wie stark**
eine Empfehlung des Ersten Beraters tatsächlich umgesetzt wird und **wie oft** Mandate gesendet
werden.

| Staatsgebilde | `government_type` | Berater-Gewichtung | Mandatsverhalten |
|---|---|---|---|
| 🗳️ **Demokratie** | `democracy` | 40–60% | Mandat braucht Mehrheit im Rat; Spieler-Empfehlung = 1 Stimme von mehreren. Ablehnung durch Rat möglich trotz Empfehlung | 
| 👑 **Autokratie** | `autocracy` | 70–90% | Anführer entscheidet allein; Empfehlung des Beraters hat direkten Einfluss. Mandate sind dringlicher, Ablehnung hat härtere Konsequenzen |
| 🏛️ **Oligarchie** | `oligarchy` | 50–70% | Kleine Elite entscheidet; Spieler muss Mehrheit unter den Elitevertretern gewinnen. Mandate von mehreren Eliten gleichzeitig möglich |
| ✝️ **Theokratie** | `theocracy` | 30–50% | Dogma begrenzt Empfehlungen stark. Empfehlungen, die dem Dogma widersprechen, werden immer abgelehnt; Konformität mit Glaubenssätzen erhöht die Gewichtung |
| 🔬 **Meritokratie** | `meritocracy` | 60–80% | Empfehlung wird an konkreten Ergebnissen gemessen. Nachgewiesene Erfolge (abgeschlossene Quests, Handelsergebnisse) erhöhen die Gewichtung dauerhaft |
| 🕸️ **Netzwerk** | `network` | 25–45% | Dezentrale Struktur (z.B. Schattenkompakt, Nomaden). Keine Einzelentscheidung; Empfehlung verbreitet sich als Konsens – oder nicht. Sehr unvorhersehbar |

**DB-Erweiterung:**
```sql
ALTER TABLE npc_factions
    ADD COLUMN IF NOT EXISTS government_type ENUM(
        'democracy','autocracy','oligarchy',
        'theocracy','meritocracy','network'
    ) NOT NULL DEFAULT 'democracy',
    ADD COLUMN IF NOT EXISTS advisor_weight_min TINYINT UNSIGNED NOT NULL DEFAULT 40
        COMMENT 'Minimale Empfehlungsgewichtung in %',
    ADD COLUMN IF NOT EXISTS advisor_weight_max TINYINT UNSIGNED NOT NULL DEFAULT 60
        COMMENT 'Maximale Empfehlungsgewichtung in %';
```

**Berater-Gewichtungs-Formel:**
```
effective_weight = advisor_weight_min
    + ROUND((advisor_weight_max - advisor_weight_min)
        × (standing - 61) / 39)          -- standing 61–100 → linearer Skalierung
    × government_conformity_bonus         -- +0.1 wenn Empfehlung zum Staatsgebilde passt
    × neglect_penalty                     -- ×0.7 wenn neglect_count ≥ 3
```

**Konsequenz für Gameplay:**
- In einer Demokratie (40–60%) kann der Spieler eine Empfehlung abgeben und trotzdem verlieren
  → Frustration UND Spannung gleichzeitig (echter politischer Betrieb)
- In einer Autokratie (70–90%) ist die Empfehlung fast sicher umgesetzt
  → Schneller, direkter, aber auch mehr Verantwortung (Scheitern fällt auf den Spieler zurück)
- Regierende dürfen Berater entlassen: Bei `neglect_count ≥ 5` verliert der Spieler den
  Berater-Status und muss ihn neu erarbeiten (`advisor_accepted` → 0)

---

### 12.2 Fraktionsmandat: Entscheidungen unter Druck

Ein **Mandat** ist eine zeitlich befristete Anfrage einer Fraktion an den Spieler.
Es erscheint als Journal-Event mit Countdown-Timer.

**Zwei Mandat-Typen:**
- **Ressourcen-Mandat** (Stufe 3): direkte Anfrage an den Spieler, eine Ressource bereitzustellen oder eine Aktion auszuführen
- **Beratungs-Mandat** (Stufe 4 / Erster Berater): Spieler erhält Einblick in eine interne Fraktionsentscheidung und soll eine *Empfehlung* abgeben – die Fraktion entscheidet danach eigenständig

**Anatomie eines Ressourcen-Mandats (Stufe 3):**

```
Mandat: „Syl'Nar – Handelsprimat im Dreifach-Korridor"
─────────────────────────────────────────────────────────
Typ:            Ressourcen-Mandat
Fraktion:       Syl'Nar (Ruf-Stufe 3 / Vertrauensträger)
Forderung:      Genehmige exklusiven Syl'Nar-Handelsvertrag für Vethisit-Routen
Frist:          72 Stunden Echtzeit
Belohnung:      +8 Standing, +15% trade_income_mult (30 Tage), 500 DM
Konsequenz:     −12 Standing, Mandat zählt als „ignoriert" (Peitsche-Zähler +1)
Gegner-Info:    Vor'Tak beobachtet – Zustimmung kostet −5 Vor'Tak-Standing
Multiplayer:    Alle Spieler im selben Sternensystem-Cluster erhalten +3% Vethisit-Marktpreis
                falls ACCEPTED (oder −5% falls EXPIRED, wegen Marktverunsicherung)
```

**Anatomie eines Beratungs-Mandats (Stufe 4 – Erster Berater):**

```
Beratungs-Mandat: „Syl'Nar – Expansionsentscheidung Sektor Korridor-7"
──────────────────────────────────────────────────────────────────────────
Typ:            Beratungs-Mandat (Erster Berater)
Fraktion:       Syl'Nar (Ruf-Stufe 4 / Erster Berater)
Interne Frage:  Syl'Nar erwägt, Sektor Korridor-7 militärisch zu sichern.
                Anführerin Tael'Mii bittet um Empfehlung des Beraters.
Empfehlungen:   A) „Sichern – die Ressourcen sind es wert"
                B) „Abwarten – Provokation anderer Mächte vermeiden"
                C) „Verhandeln – Neutralitätspakt mit Vor'Tak vorschlagen"
Frist:          48 Stunden Echtzeit
Effektive Gewichtung: 55% (Demokratie; steht in UI sichtbar)
Ergebnis:       NPC-KI trifft eigenständige Entscheidung; Empfehlung A/B/C wird mit
                55% Gewicht berücksichtigt; Zufallselement ±15% (interne Fraktionsdynamik)
Multiplayer-Auswirkung:
  → WENN Syl'Nar sichert (Ergebnis A): Flottenpräsenz in Korridor-7 steigt;
    alle Spieler dort spüren +10% Piratenschutz aber −5 Standing bei Vor'Tak
  → WENN Syl'Nar abwartet (Ergebnis B): Korridor-7 bleibt neutral; keine Effekte
  → WENN Syl'Nar verhandelt (Ergebnis C): Handelsboom +8% für alle Spieler 30 Tage
Berater-Belohnung (wenn Empfehlung übernommen):
  +15 Standing, exklusive Lore-Information über interne Syl'Nar-Struktur
Berater-Belohnung (wenn Empfehlung NICHT übernommen):
  +5 Standing (Prozess-Belohnung), keine Lore-Info
Konsequenz (Nicht-Entscheiden):
  −15 Standing, neglect_count +1; Fraktion fragt sich ob Berater noch geeignet ist
```

**Mandats-Status-Maschine:**

```
PENDING ──[Zustimmen/Empfehlen]──► ACCEPTED   → Zuckerbrot sofort; bei Beratungsmandat: NPC entscheidet
        ──[Ablehnen]─────────────► DECLINED   → Ruf −5, begründbare Ablehnung (kein Peitsche-Zähler)
        ──[Ablaufen]─────────────► EXPIRED    → Peitsche-Zähler +1, Ruf −12 nach Grace-Period
        ──[Teilerfüllt]──────────► PARTIAL    → Ruf +3, Zuckerbrot abgeschwächt (50%)
```

**DB-Feld für Typ und Status:**
```sql
faction_mandates.mandate_class ENUM('resource','advisory') NOT NULL DEFAULT 'resource'
faction_mandates.status        ENUM('pending','accepted','declined','expired','partial')
faction_mandates.advice_choice TINYINT        -- Gewählte Empfehlung (A=1, B=2, C=3)
faction_mandates.npc_decision  TINYINT        -- Tatsächliche NPC-Entscheidung (nach Gewichtung)
faction_mandates.advice_weight DECIMAL(5,2)   -- Effektive Gewichtung zum Zeitpunkt der Empfehlung
```

---

### 12.3 Zuckerbrot: Belohnungen für aktive Beteiligung

Aktive Beteiligung (ACCEPTED, PARTIAL) bringt gestaffelte Belohnungen. **Beratungs-Mandate**
(Stufe 4) haben zwei Belohnungsspuren: eine für die Empfehlung selbst (Prozess) und eine davon
unabhängige für das tatsächliche Ergebnis der NPC-Entscheidung.

**Ressourcen-Mandat (Stufe 3):**

| Kategorie | Belohnungsart | Beispiel |
|---|---|---|
| **Sofort-Bonus** | Standing-Gewinn | +8 Standing |
| **Temp-Modifier** | Zeitlich begrenzte Empire-Modifier | +15% `trade_income_mult` für 30 Tage |
| **Ressourcen** | Dark Matter, Metalleinheiten, Flottenverstärkung | 500 DM oder 2 Zerstörer-Leihschiffe (14 Tage) |
| **Erzählung** | LORE-Fortschritt, neue NPC-Dialoge, Aktzugang | Vel'Ar teilt Syl'Nar-Geheimnis (Akt-2-Info) |

**Beratungs-Mandat (Stufe 4 – Erster Berater):**

| Bedingung | Belohnung |
|---|---|
| Empfehlung abgegeben (egal ob übernommen) | +5 Standing (Prozess-Bonus); gilt immer |
| Empfehlung übernommen (NPC folgt Rat) | +15 Standing + exklusive Lore-Info + `advisor_trust` +1 |
| Empfehlung nicht übernommen, Ergebnis trotzdem gut | +8 Standing (Fraktion dankt für Beitrag) |
| Empfehlung nicht übernommen, Ergebnis schlecht | +5 Standing; Fraktion denkt über Berater-Qualität nach |

**Multiplikator-Mechanik durch Staatsgebilde:**

| Staatsgebilde | Bonus wenn Empfehlung übernommen | Malus wenn Ergebnis schlecht |
|---|---|---|
| `democracy` | ×1.0 (Standardbelohnung) | Öffentliche Kritik: −3 `happiness_flat` (7 Tage) |
| `autocracy` | ×1.3 (Anführer belohnt Loyalität großzügig) | Anführer-Enttäuschung: −10 Standing zusätzlich |
| `oligarchy` | ×1.1 (Elite teilt Belohnung) | Elite-Misstrauen: `neglect_count` +0.5 extra |
| `theocracy` | ×0.8 (spirituell, kein Materialismus) | Dogma-Verletzung: Mandat-Frequenz −50% für 30 Tage |
| `meritocracy` | ×1.5 (Leistung wird stark belohnt) | Leistungs-Dossier: `advisor_trust` −2 |
| `network` | ×0.7 (diffuse Belohnungsstruktur) | Raunen im Netz: zufällige Effekte |

**Zuckerbrot-Kumulationsbonus:** Werden 3 Mandate in Folge akzeptiert (ohne Ablehnung dazwischen),
erhält der Spieler einen **Loyalitätsbonus**: einmaliger +5 Standing-Aufwuchs und eine seltene Belohnung
(z.B. Prototyp-Modul, exklusive Quest). Dieser Bonus erscheint als Journal-Event `faction_loyalty_streak`.

**Langzeit-Freischaltung** (ab 5× ACCEPTED bei einer Fraktion, Stufe 3+):
- Exklusiver Schiffshull dieser Fraktion (nur baubar, solange `influence_tier ≥ 3`)
- Einzigartiger Koloniegebäude-Slot (passiver Ertrag, nur für diese Fraktion)

**`advisor_trust`-Wert:** Ein neuer Unterparameter (0–10) in `diplomacy.advisor_trust`.
Steigt mit jeder überommenen Empfehlung. Bestimmt: Wie wahrscheinlich ist es, dass die
Fraktion dem Berater beim nächsten Mal folgt (±5% auf `effective_weight` pro Punkt).

---

### 12.4 Peitsche: Konsequenzen des Nicht-Entscheidens

Läuft ein Mandat ab (`EXPIRED`), ohne dass der Spieler reagiert hat, greift ein gestuftes Strafsystem.
Die Stärke der Konsequenzen hängt zusätzlich vom Staatsgebilde der Fraktion ab.

#### 12.4.1 Peitsche-Zähler (`neglect_count`)

Pro Fraktion wird `diplomacy.neglect_count INT` verwaltet.
Jedes EXPIRED-Mandat erhöht den Zähler um 1. Jedes ACCEPTED-Mandat reduziert ihn um 1 (Mindest: 0).

| neglect_count | Basiskonsequenz (alle Staatsgebilde) | Berater-Spezifisch (Stufe 4) |
|---|---|---|
| **1** | Standing −10 + Journal-Event „[Fraktion] zeigt Enttäuschung" | `advisor_trust` −1 |
| **2** | Standing −10 + `influence_tier` −1 + Modifier-Malus (−5% Hauptbonus, 7 Tage) | `advisor_trust` −2; Fraktion fragt sich öffentlich, ob Berater noch aktiv ist |
| **3** | Standing −18 + `influence_tier` −1 + formale **Warnung** | `advisor_trust` −3; Gerücht im Mehrspielersystem (§12.4.4) |
| **4** | Standing −18 + `influence_tier` −2 + fraktionsspezifischer Strafmechanismus (§12.4.2) | Berater-Status auf Bewährung: NPC bewertet nächste Empfehlung mit −20% Gewichtung |
| **5+** | Jedes weitere: −22 Standing; keine neuen Stufe-4-Mandate bis neglect_count < 3 | `advisor_accepted` → 0: Berater-Status entzogen; Neustart nötig |

> **Balancing-Anmerkung:** Die Strafen sind gegenüber der ersten Version leicht reduziert (−12→−10,
> −20→−18), weil der Spieler als Berater *nicht* das letzte Wort hat. Es wäre unfair, ihn hart zu
> bestrafen wenn die NPC-KI eine andere Entscheidung trifft als empfohlen.

#### 12.4.2 Staatsgebilde-Modifikator auf Peitsche

Das Staatsgebilde beeinflusst Stil und Intensität der Konsequenzen:

| Staatsgebilde | Peitsche-Modifikator | Charakteristik |
|---|---|---|
| `democracy` | ×0.85 auf Standing-Abzug | Öffentliche Debatte puffert; aber Ruf-Verlust ist *öffentlich* sichtbar für andere Spieler |
| `autocracy` | ×1.30 auf Standing-Abzug | Anführer verzeiht nicht; Strafen schneller und härter |
| `oligarchy` | ×1.10 auf Standing-Abzug | Elite-Netzwerk merkt sich alles; zusätzliche Handelseinschränkungen |
| `theocracy` | ×0.90 auf Standing-Abzug | Religiöse Geduld; aber ab neglect_count = 3 öffentlicher Bannfluch (globaler Malus) |
| `meritocracy` | ×1.20 auf Standing-Abzug | Leistung zählt; Fehler werden statistisch dokumentiert und gegen Belohnungen verrechnet |
| `network` | ×0.70 auf Standing-Abzug | Diffuse Struktur; dafür sind Konsequenzen unvorhersehbar (zufälliger Effekt aus Malus-Pool) |

#### 12.4.3 Fraktionsspezifische Strafmechanismen (neglect_count ≥ 4)

| Fraktion | Staatsgebilde | Strafe bei 4× Ignorieren |
|---|---|---|
| 🦎 **Vor'Tak** | `autocracy` | Entzug einer Flottenhilfe-Option; Gegner-Verstärkung +20% in nächster Militär-Quest |
| 🐙 **Syl'Nar** | `theocracy` | Handelsroute gesperrt (3 Tage); Vethisit-Marktpreis sinkt −15% |
| 🔥 **Aereth** | `meritocracy` | Forschungs-Kooperation pausiert; `research_speed_mult` −0.08 für 14 Tage |
| 🦗 **Kryl'Tha** | `network` | Kryl'Tha-Außenposten inaktiv; Pop-Wachstum −0.05 für 7 Tage |
| 💎 **Zhareen** | `oligarchy` | Archivzugang entzogen; laufende Quests +50% Zeitaufwand |
| 🌫️ **Vel'Ar** | `network` | Informationsnetz schließt aus; `spy_detection_flat` −15 für 14 Tage; Agenten abgezogen |

#### 12.4.4 Multiplayer-Peitsche: Reputationsripple

**Neu:** Konsequenzen des Nicht-Entscheidens können auf andere Spieler ausstrahlen.
Das simuliert, dass NPC-Entscheidungen (die der Berater hätte beeinflussen können) das
galaktische Gleichgewicht verändern.

**Mechanismus:**
```
Wenn neglect_count ≥ 3 UND Beratungs-Mandat EXPIRED:
  → NPC-Fraktion trifft eine Zufalls-Entscheidung (ohne Berater-Input)
  → Diese Entscheidung hat eine chance_of_world_event = 40%
  → Falls world_event: Alle Spieler im betroffenen Sternensystem-Cluster
    erhalten galactic_event = 'faction_unchecked_action' mit zufälligem
    positiven oder negativen Modifier für 48h
```

**Beispiel:**
Spieler A ist Erster Berater bei Vor'Tak und ignoriert 3 Mandate über Grenzkonflikt.
Vor'Tak entscheidet allein → startet militärische Expansion.
Alle Spieler in den betroffenen Systemen bekommen: `fleet_readiness_mult` −0.05 (48h),
weil Transitrouten blockiert. Spieler A erhält −18 Standing. Andere Spieler sehen im Journal:
*„Vor'Tak-Expansion – ein Berater hat versagt"* (Spieler-A-Reputation wird öffentlich).

**Privacy-Option:** Spieler können in den Einstellungen `advisor_anonymous = 1` setzen —
dann erscheint ihr Name in solchen Events nicht öffentlich, aber der Malus bleibt.

```sql
ALTER TABLE diplomacy
    ADD COLUMN IF NOT EXISTS advisor_anonymous TINYINT(1) NOT NULL DEFAULT 0;
```

#### 12.4.5 Grace-Period

Zwischen EXPIRED-Status und Peitsche-Aktivierung gibt es **6 Stunden Grace-Period**.
In dieser Zeit kann der Spieler das Mandat nachträglich als PARTIAL erfüllen:
- Strafe wird auf 50% reduziert
- `neglect_count` erhöht sich nur um 0.5 (gerundet auf 1 wenn ≥ 0.5)
- Kein Multiplayer-Ripple-Event (§12.4.4) wird ausgelöst

```sql
-- Grace-Period-Check im npc_ai-Tick:
SELECT id FROM faction_mandates
WHERE status = 'expired'
  AND expired_at > NOW() - INTERVAL 6 HOUR
  AND grace_partial_submitted = 0;
```

---

### 12.5 Mandats-Typen nach Fraktionscharakter

Jede Fraktion stellt **charakteristisch unterschiedliche** Mandate. Das verhindert Eintönigkeit
und verstärkt die LORE-Identität der Fraktionen:

| Fraktion | Typische Mandats-Kategorie | Beispiel-Mandat |
|---|---|---|
| 🦎 **Vor'Tak** | Militärisch / Territorialverteidigung | „Stationiere 5 Kampfschiffe im Dreifach-Korridor für 48h" |
| 🐙 **Syl'Nar** | Handel / Spiritualität | „Gewähre Syl'Nar-Händlern zollfreien Vethisit-Transit" |
| 🔥 **Aereth** | Forschung / Experiment | „Teile Khal'Vethis-Bodendaten für Sol'Kaars Projekt" |
| 🦗 **Kryl'Tha** | Expansion / Logistik | „Erlaube Kryl'Tha temporären Brutposten auf Randmond" |
| 💎 **Zhareen** | Archivierung / Schutz | „Übergib Vethisit-Artefakte an Zhareen-Forscher (nicht zerstören)" |
| 🌫️ **Vel'Ar** | Geheimdienstlich / Informationsfluss | „Übermittle Bewegungsdaten einer fremden Flotte im Korridor" |

**Mandats-Frequenz** (abhängig von `influence_tier`):

| influence_tier | Durchschnittliche Frequenz |
|---|---|
| 2 (Beachtet) | 1 Mandat / 96h |
| 3 (Eingebunden) | 1 Mandat / 48h |
| 4 (Strategischer Partner) | 1–2 Mandate / 48h (teils dringlich) |

---

### 12.6 Balancing-Parameter *(revidiert)*

Diese Werte sind in `config/config.php` als Konstanten zu definieren.
Gegenüber der Erstversion reduzierte Strafen (Spieler ist Berater, nicht Entscheider):

| Konstante | Standardwert | Änderung | Begründung |
|---|---|---|---|
| `MANDATE_BASE_DURATION_H` | 72 | = | Standardlaufzeit |
| `MANDATE_ADVISORY_DURATION_H` | 48 | **neu** | Beratungs-Mandate sind dringlicher |
| `MANDATE_GRACE_PERIOD_H` | 6 | = | Grace-Period |
| `MANDATE_NEGLECT_STANDING_1` | −10 | **−12→−10** | Berater-Fairness |
| `MANDATE_NEGLECT_STANDING_2` | −10 | **−12→−10** | Berater-Fairness |
| `MANDATE_NEGLECT_STANDING_3` | −18 | **−20→−18** | Berater-Fairness |
| `MANDATE_NEGLECT_STANDING_4` | −18 | **−20→−18** | Berater-Fairness |
| `MANDATE_NEGLECT_STANDING_5PLUS` | −22 | **−25→−22** | Berater-Fairness |
| `MANDATE_LOYALTY_STREAK` | 3 | = | Anzahl ACCEPTED in Folge für Loyalitätsbonus |
| `MANDATE_INFLUENCE_TIER3_INTERVAL_H` | 48 | = | Ressourcen-Mandats-Frequenz |
| `MANDATE_INFLUENCE_TIER4_INTERVAL_H` | 48 | **24→48** | Beratungs-Mandate sind komplexer; weniger ist mehr |
| `MANDATE_ADVISOR_BASE_WEIGHT_DELTA` | 5 | **neu** | `advisor_trust` × 5% = Bonus auf `effective_weight` |
| `MANDATE_RIPPLE_CHANCE` | 40 | **neu** | Wahrscheinlichkeit (%) für Multiplayer-Ripple-Event bei neglect_count ≥ 3 |
| `MANDATE_RIPPLE_DURATION_H` | 48 | **neu** | Dauer des Ripple-Effekts auf andere Spieler |

**Anti-Overwhelm-Regel:** Pro Fraktion kann maximal **1 Mandat gleichzeitig PENDING** sein.
Über alle Fraktionen hinweg können maximal **4 Mandate gleichzeitig PENDING** sein.
Neue Mandate werden erst erzeugt, wenn alte abgehandelt wurden. Dies verhindert Entscheidungs-Paralyse.

**Staatsgebilde-Puffer:** Demokratien dürfen nie mehr als **2 Mandate gleichzeitig** haben
(Ratsverfahren dauern). Autokratien können bis zu **3 gleichzeitig** senden.

---

### 12.7 DB-Schema & API

#### Neue Tabelle: `faction_mandates`

```sql
CREATE TABLE IF NOT EXISTS faction_mandates (
    id                      INT AUTO_INCREMENT PRIMARY KEY,
    user_id                 INT NOT NULL,
    faction_id              INT NOT NULL,
    mandate_class           ENUM('resource','advisory') NOT NULL DEFAULT 'resource',
    mandate_type            VARCHAR(64) NOT NULL
        COMMENT 'z.B. military_deployment, trade_concession, research_share, advisory_expansion',
    title                   VARCHAR(128) NOT NULL,
    description             TEXT,
    -- Ressourcen-Mandat-Felder
    reward_standing         TINYINT NOT NULL DEFAULT 8,
    reward_modifier_key     VARCHAR(64),
    reward_modifier_value   DECIMAL(9,4),
    reward_modifier_days    TINYINT,
    reward_dm               SMALLINT NOT NULL DEFAULT 0,
    penalty_standing        TINYINT NOT NULL DEFAULT 10,
    -- Beratungs-Mandat-Felder
    advice_options_json     JSON COMMENT 'Array mit A/B/C Empfehlungen + Folgeeffekten',
    advice_choice           TINYINT COMMENT 'Gewählte Empfehlung (1=A, 2=B, 3=C)',
    npc_decision            TINYINT COMMENT 'Tatsächliche NPC-Entscheidung nach Gewichtung',
    advice_weight           DECIMAL(5,2) COMMENT 'Effektive Gewichtung zum Empfehlungszeitpunkt',
    ripple_event_fired      TINYINT(1) NOT NULL DEFAULT 0,
    -- Status
    status                  ENUM('pending','accepted','declined','expired','partial')
                            NOT NULL DEFAULT 'pending',
    issued_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deadline_at             DATETIME NOT NULL,
    resolved_at             DATETIME,
    grace_partial_submitted TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_fm_user_faction (user_id, faction_id),
    INDEX idx_fm_status_deadline (status, deadline_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### Erweiterung `diplomacy`

```sql
ALTER TABLE diplomacy
    ADD COLUMN IF NOT EXISTS influence_tier    TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT '0=unbeteiligt … 4=erster_berater',
    ADD COLUMN IF NOT EXISTS neglect_count     TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT 'Anzahl abgelaufener Mandate ohne Reaktion',
    ADD COLUMN IF NOT EXISTS advisor_accepted  TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 = Fraktion hat Berater-Status formal akzeptiert',
    ADD COLUMN IF NOT EXISTS advisor_trust     TINYINT UNSIGNED NOT NULL DEFAULT 0
        COMMENT '0–10; steigt mit übernommenen Empfehlungen; bestimmt effective_weight-Bonus',
    ADD COLUMN IF NOT EXISTS advisor_anonymous TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '1 = Berater-Name erscheint nicht in öffentlichen Ripple-Events';
```

#### API-Endpunkte (`api/factions.php`)

```
GET  factions.php?action=list_mandates
     → Alle PENDING-Mandate; inkl. Fraktionsname, Deadline, Typ (resource/advisory),
       Reward, Penalty, advice_options (für Beratungs-Mandate), aktueller advisor_trust

POST factions.php?action=resolve_mandate
     → { mandate_id, resolution: 'accept'|'decline'|'partial', advice_choice: 1|2|3 }
     → Führt Belohnung oder Peitsche aus; bei advisory: speichert advice_choice,
       berechnet npc_decision, feuert ggf. ripple_event

GET  factions.php?action=mandate_history
     → Letzten 30 abgeschlossenen Mandate mit Status + Auswirkung + NPC-Entscheidung

GET  factions.php?action=advisor_status
     → { faction_id, influence_tier, advisor_accepted, advisor_trust,
         effective_weight, government_type, neglect_count }
```

---

### 12.8 Implementierungs-Phasen *(revidiert)*

| Phase | Inhalt | Aufwand |
|---|---|---|
| **Pre** | Migration: `faction_mandates` (erweitert), `diplomacy`-Spalten, `npc_factions.government_type` | Klein |
| **1** | `npc_ai.php`: Mandats-Generierung (`resource` für Tier 3, `advisory` für Tier 4) + `advisor_accepted`-Logik | Mittel |
| **2** | `api/factions.php`: `list_mandates` + `resolve_mandate` + `mandate_history` + `advisor_status` | Mittel |
| **3** | Berater-Gewichtungs-Formel in `game_engine.php`: `effective_weight` aus `government_type` + `advisor_trust` | Mittel |
| **4** | Zuckerbrot/Peitsche-Staatsgebilde-Modifikatoren in `game_engine.php` | Mittel |
| **5** | Multiplayer-Ripple: `faction_mandates.ripple_event_fired` + `galactic_event`-Tabelle + Verteiler in `npc_ai.php` | Groß |
| **6** | `EventSystem.js`: Journal-Events für Mandatseingang / Ablauf / Berater-Ernennung / Berater-Verlust / Ripple | Klein |
| **7** | `js/game.js`: Mandats-Panel (Liste, Countdown, Accept/Decline/Partial, Empfehlungs-UI, advisor_trust-Anzeige) | Groß |
| **8** | `config/config.php`: Balancing-Konstanten §12.6 + Tuning-Pass nach erstem Playtesting | Klein |

---

### 12.9 Multiplayer-Ripple: Spezifikation

Beratungs-Mandate auf Stufe 4 haben potenzielle galaktische Auswirkungen. Wenn ein Erster
Berater ein Mandat ignoriert, trifft die NPC-Fraktion eine unkontrollierte Entscheidung –
und die Konsequenzen davon breiten sich im Mehrspielersystem aus.

#### 12.9.1 Galaktisches Ereignis (`galactic_event`-Tabelle)

```sql
CREATE TABLE IF NOT EXISTS galactic_events (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    event_type      VARCHAR(64) NOT NULL
        COMMENT 'z.B. faction_unchecked_action, faction_advisor_success',
    faction_id      INT NOT NULL,
    source_user_id  INT COMMENT 'Berater, der ausgelöst hat (NULL wenn anonym)',
    description     TEXT,
    modifier_key    VARCHAR(64),
    modifier_value  DECIMAL(9,4),
    affected_scope  ENUM('cluster','sector','galaxy') NOT NULL DEFAULT 'cluster',
    starts_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at         DATETIME NOT NULL,
    is_visible      TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_ge_faction (faction_id),
    INDEX idx_ge_scope_time (affected_scope, ends_at),
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### 12.9.2 Ripple-Ereignistypen

| Ereignis | Auslöser | Betroffene Spieler | Modifier |
|---|---|---|---|
| `faction_unchecked_expansion` | EXPIRED bei militärischem Beratungsmandat | Alle Spieler im Cluster | `fleet_readiness_mult` −0.05 / 48h |
| `faction_trade_disruption` | EXPIRED bei Handels-Beratungsmandat | Alle Spieler auf betroffenen Routen | `trade_income_mult` −0.08 / 24h |
| `faction_research_lockout` | EXPIRED bei Forschungs-Beratungsmandat | Alle Spieler mit dieser Fraktion auf Tier 2+ | `research_speed_mult` −0.05 / 24h |
| `faction_advisor_success` | ACCEPTED + Empfehlung übernommen + gutes Ergebnis | Alle Spieler im Cluster | `trade_income_mult` +0.05 / 72h |
| `faction_diplomatic_breakthrough` | ACCEPTED + Empfehlung C (Verhandeln) übernommen | Alle Spieler mit NPC-Kontakt | `colony_stability_flat` +3 / 48h |

#### 12.9.3 Sichtbarkeit und Fairness

- **Ankündigung:** 30 Minuten vor Aktivierung erscheint im Journal aller betroffenen Spieler
  ein Vorab-Hinweis: *„Diplomatische Lage verändert sich"* (ohne Schuldigen zu nennen)
- **Anonymität:** Wenn `advisor_anonymous = 1`, wird der Spieler in der Ereignisbeschreibung
  nicht namentlich erwähnt; andere Spieler sehen nur die Fraktion
- **Frequenz-Cap:** Maximal 1 Ripple-Event pro Fraktion pro 24h — verhindert Spam bei
  wiederholten Ignorierungen
- **Spieler-Schutz für Rookies:** Ripple-Events treffen nie Spieler, die weniger als 48h
  im Spiel sind (`users.created_at > NOW() - INTERVAL 48 HOUR`)

---

## 13. Spieler-Fraktionszugehörigkeit & Gilden

> **Designprinzip:** Der Spieler ist kein freier Agent – er kommt von irgendwoher. Die Rasse
> gibt ihm eine Heimat, aber keine Kette. Er kann diese Heimat tief erkunden, verlassen, wechseln,
> oder eine eigene Organisation aufbauen. Die Bewegungsfreiheit zwischen Fraktionen und die
> Möglichkeit, eine eigene Gilde zu gründen, ist der soziale Motor des Mehrspielersystems.

> **Abgrenzung zu §12 (Erster Berater):** Mitgliedschaft und Ruf sind *parallele* Systeme.
> Ein Spieler kann gleichzeitig Mitglied von Fraktion A *und* Erster Berater von Fraktion B
> (extern-diplomatisch) sein. Die Erster-Berater-Rolle (§12) ist die externe diplomatische
> Spitze; die Fraktionsmitgliedschaft ist die interne organisatorische Zugehörigkeit.

---

### 13.1 Konzept: Mitgliedschaft vs. Ruf

| Aspekt | Ruf (§6 / §12) | Mitgliedschaft (§13) |
|---|---|---|
| **Was es ist** | Externe diplomatische Beziehung (Skala 0–5, Tier 0–4) | Interne Organisationszugehörigkeit (Member/Kein Member/Rang) |
| **Wo gespeichert** | `diplomacy.standing` / `influence_tier` | `user_faction_membership.faction_id` / `rank` |
| **Wie erreicht** | Quests, Handel, Mandate, Diplomatie | Bewerbung + Aufnahmeritual; automatisch durch Rasse beim Start |
| **Gleichzeitig mehrere?** | Ja – Ruf bei allen 6 Fraktionen parallel | Nein – maximal 1 NPC-Fraktion gleichzeitig (+ ggf. 1 eigene Gilde) |
| **Höchste Stufe** | Tier 4 = Erster Berater (externer Berater) | Rang 5 = Leutnant der Fraktion (interne Rolle) |
| **Verlierbar?** | Ja (Standing sinkt durch Neglect / Feindschaft) | Ja (Ausschluss bei Verrat, freiwilliger Austritt, Wechsel) |
| **Isolationspfad** | Ruf verfällt langsam | Mitgliedschaft wird explizit aufgelöst (→ §13.5) |

**Zusammenspiel:** Hoher Ruf bei der eigenen Fraktion entsperrt höhere **interne Ränge** (Aufstieg von Rang 1 auf 5). Hoher Ruf bei einer *fremden* Fraktion entsperrt die Möglichkeit, **dieser Fraktion beizutreten** (Einladung ab Standing ≥ +30) oder den Erster-Berater-Status (ab Tier 4).

---

### 13.2 Startmitgliedschaft: Rasse → interne Fraktionsstelle

Der Spieler beginnt als **Neubürger (Rang 1)** seiner Heimatfraktion. Diese Startmitgliedschaft
ist automatisch und bedarf keiner Quest-Aktivierung.

**Mitglieds-Ränge (interne Hierarchie):**

| Rang | Titel | Standing-Schwelle | Aktiv seit |
|---|---|---|---|
| 1 | Neubürger | Start (Rasse) | Spielstart |
| 2 | Bekannter | Standing ≥ +20 | Quest-Kette Tier I |
| 3 | Vertrauensperson | Standing ≥ +40 | Quest-Kette Tier II |
| 4 | Innerer Kreis | Standing ≥ +55 | Quest-Kette Tier III + Einladung |
| 5 | Leutnant | Standing ≥ +70 | Quest-Kette Tier IV + Fraktion bestätigt |

> **Abgrenzung Leutnant vs. Erster Berater:** Rang 5 (Leutnant) ist eine *interne* Rolle –
> der Spieler sitzt in internen Meetings, bekommt interne Quests und hat Stimme in Innenangelegenheiten.
> Erster Berater (§12) ist eine *externe* Beraterfunktion bei einer Fraktion, der man ggf.
> nicht angehört. Beides gleichzeitig bei der gleichen Fraktion ist unmöglich: ein Leutnant
> wird nicht als externer Berater behandelt.

**DB-Abbildung:** Neuer Eintrag in `user_faction_membership` bei Spielstart (→ §13.7).

---

### 13.3 Was Mitgliedschaft bedeutet

**Mitglieds-Boni (kumulativ mit steigendem Rang):**

| Rang | Bonus |
|---|---|
| 1 Neubürger | +10 Starting Standing; Zugang zu internen Handelspreisen (−5%) |
| 2 Bekannter | Interne Missionen (höherer Lohn als externe Quests); Fraktions-Schutzpatrouillen |
| 3 Vertrauensperson | Frühwarnung bei Fraktionsereignissen (Journal 6h vor anderen); Zugang zu Fraktionsschiffen (Leih) |
| 4 Innerer Kreis | Interner Rat-Chat; Einsicht in Fraktionsstrategie (Verhaltenshinweis für nächste 48h) |
| 5 Leutnant | Stimmrecht in internen Abstimmungen; Zugang zu Leutnants-Quests; einzigartiges Cosmetic-Item |

**Mitglieds-Pflichten:**

| Pflicht | Konsequenz bei Verstoß |
|---|---|
| Keine aktive Mitgliedschaft bei einer Feind-Fraktion | Automatischer Ausschluss |
| Keine Quests gegen eigene Fraktion annehmen | Standing −20 + Verwarnung; Rang-Abstieg um 1 |
| Mandate (§12) der eigenen Fraktion vorrangig behandeln | Neglect-Zähler steigt (§12.4); Rang-Abstieg bei neglect_count ≥ 3 |
| Keine offene Feindschaft mit Fraktionsführung | Ausschluss-Prozess bei schweren Vertrauensbrüchen |

**Interne Quests (nur für Mitglieder):**

Jede Fraktion hat eine **Quest-Kette** von Rang 1 → 5, die tiefe Einblicke in die interne
Fraktionsstruktur und LORE gibt. Diese Quests sind nicht von Externen erreichbar.

| Fraktion | Rang-Ketten-Thema |
|---|---|
| 🦎 Vor'Tak | Militärische Bewährung: Grenzpatrouillen → Strategiemeetings → Kriegsrat |
| 🐙 Syl'Nar | Spirituelle Initiation: Handelspilger → Lichtpriester → Innerer Zirkel des Lichtbunds |
| 🔥 Aereth | Wissenschaftliche Überprüfung: Datenpraktikant → Projektleiter → Kernrats-Laborberater |
| 🦗 Kryl'Tha | Schwarm-Integration: Außenposten → Brutkoordinator → Schwarmoberst |
| 💎 Zhareen | Archivprüfung: Leser → Hüter → Archon des Gedächtnisses |
| 🌫️ Vel'Ar | Geheimdienstliche Loyalität: Informant → Schatten-Kurier → Innerer Schatten |

---

### 13.4 Fraktionswechsel via Quest & Diplomatie

Der Spieler kann seine Mitgliedschaft wechseln – das ist narrativ gravierend und mechanisch
kostspielig, aber möglich.

**Wechsel-Voraussetzungen:**

```
1. Aktuelles Standing bei Zielfraktion ≥ +30 (Tier 3 = VERBÜNDET)
2. Abschluss eines Übertritts-Ereignisses (Quest oder diplomatischer Akt)
3. Bestätigung durch die Zielfraktion (NPC-Entscheidung; bei Demokratie: Ratsvoting)
4. Cooldown-Periode verstrichen (kein Wechsel in den letzten 30 Echtzeit-Tagen)
```

**Wechselkosten:**

| Effekt | Wert |
|---|---|
| Standing bei alter Fraktion | −25 (sofort); weiterer Verfall über 14 Tage (−1/Tag) |
| Mitglieds-Rang in alter Fraktion | Auf 0 gesetzt; alle Rang-Boni verloren |
| Mitglieds-Rang in neuer Fraktion | Startet bei Rang 1 (Neubürger) — keine Mitnahme |
| Erster-Berater-Status bei alter Fraktion | `advisor_accepted` → 0; Neuaufbau nötig |
| Interne Quests der alten Fraktion | Alle PENDING-Quests abgebrochen (keine Strafe, aber kein Lohn) |

**Überläufer-Stigma:** Fraktionen mit `government_type = autocracy` oder `theocracy` vergeben
nie den Rang 4+ an ehemalige Mitglieder anderer Fraktionen. Demokratien und Meritokratien
sind offener (Rang 3 erreichbar ohne Zusatzbedingung).

**Spezialfall – Diplomatischer Übertritt:** Wenn der Wechsel durch eine fraktionsübergreifende
Quest-Kette ausgelöst wird (z.B. „Doppelter Agent"), kann das Standing bei der alten Fraktion
auf −10 begrenzt werden (Quest-Schutz). Der Spieler behält diplomatischen Zugang.

---

### 13.5 Eintreten und Austreten

#### 13.5.1 Eintreten (Aufnahme in eine fremde Fraktion)

Voraussetzungen für den Beitritt zu einer Fraktion, der man **nicht** durch Rasse angehört:

```
Standing ≥ +30 bei Zielfraktion
→ Fraktion sendet Einladung (Journal-Event)
→ Spieler akzeptiert → Aufnahme-Quest (fraktionsspezifisch, Rang-1-Kette)
→ Abschluss → Mitglied (Rang 1)
```

**Offen für Beitritt ohne Einladung?** Nein: Alle 6 NPC-Fraktionen verlangen eine Einladung
(Standing-Schwelle + Quest). Es gibt keine „Walk-in"-Mitgliedschaft.

**Einschränkung:** Solange eine bestehende Mitgliedschaft aktiv ist, kann keine neue
beigetreten werden. Der Spieler muss zuerst austreten (→ §13.5.2) oder die alte Mitgliedschaft
endet durch Ausschluss.

#### 13.5.2 Freiwilliger Austritt

Der Spieler kann jederzeit aus seiner Fraktion austreten:

| Effekt | Wert |
|---|---|
| Standing-Verlust | −10 (freundliche Trennung möglich) |
| Mitgliedschaft | `status = 'left'`; Rang auf 0 |
| Cooldown | 14 Tage kein erneuter Beitritt zur selben Fraktion |
| Interne Quests | PENDING-Quests abgebrochen |
| Erster-Berater | `advisor_accepted` bleibt — externe Beraterfunktion ist unabhängig von Mitgliedschaft |

**Fraktionslos (Freischaffender):** Wer ausgetreten ist und keiner neuen Fraktion beitritt,
verliert die Mitglieds-Boni. Erhält dafür: +5% auf alle Handelspreise (kein Fraktionsbias)
und Zugang zu Söldner-Quests (keine Fraktionsverpflichtungen).

#### 13.5.3 Ausschluss (erzwungener Austritt)

Die Fraktion kann den Spieler ausschließen:

| Ausschluss-Trigger | Konsequenz |
|---|---|
| Aktiv gegen Fraktion gehandelt (Verrat-Quest) | Standing −40 + Ausschluss; 90-Tage-Sperrfrist für Wiederbeitritt |
| neglect_count ≥ 5 (§12.4) | Berater-Status entzogen + Rang-Abstieg auf 1; kein Ausschluss, aber Warnung |
| Mitglied einer Feind-Fraktion geworden | Automatischer Ausschluss; −20 Standing |
| Wiederholte Mandatsverletzungen (neglect_count ≥ 7) | Ausschluss-Verfahren: Fraktion sendet formale Kündigung via Journal-Event |

---

### 13.6 Eigene Gilde gründen

> **Kanonische Grenze (§12 + §13):** Der Spieler kann kein Anführer einer der sechs
> NPC-Hauptfraktionen werden. Er kann aber **eine eigene Gilde** gründen – eine kleinere,
> spielergeführte Organisation ohne NPC-Fraktionsstatus, aber mit echter politischer Wirkung.

**Was ist eine Gilde?**
- Eine Spieler-gegründete Organisation (1 Gründer + 1–49 Mitglieder)
- Keine NPC-Kontrollstruktur; Spieler führen sie vollständig
- Kann mit NPC-Fraktionen diplomieren (eigene `diplomacy`-Einträge)
- Kann Mandate von NPC-Fraktionen erhalten (kollektiv)
- Ersetzt nicht die NPC-Fraktionen und hat keine Ratssitz-Berechtigung

#### 13.6.1 Gilde gründen – Voraussetzungen

```
Spieler ist fraktionslos (kein aktives NPC-Fraktionsmitglied) ODER
    hat Rang 3+ in einer NPC-Fraktion UND Fraktion gewährt Erlaubnis (Quest)
Mindestressourcen: 2.000 DM + 500 Metalleinheiten
Kein laufendes Gründungs-Cooldown (kein Gründer einer anderen Gilde in den letzten 60 Tagen)
```

**Gründer-Privileg:** Der Gründer ist der einzige Spieler in GalaxyQuest, der eine interne
Führungsrolle trägt (`guild_rank = 'founder'`). Dies ist die Antwort auf die Frage nach der
„höchsten erreichbaren Spielerstellung": NPC-Fraktion max = Erster Berater (§12);
Gilde = echter Anführer. Die eigene Gilde ist der einzige Ort, wo ein Spieler
vollständige Entscheidungsautonomie hat.

#### 13.6.2 Gildentypen

| Typ | `guild_type` | Spezialisierung | NPC-Fraktion: bevorzugt |
|---|---|---|---|
| ⚔️ **Kriegskompanie** | `military` | Flottenstärke, Söldnerverträge | Vor'Tak |
| 🏪 **Handelskonsortium** | `trade` | Handelsrouten, Marktpreise, Marktplatz-Boni | Syl'Nar |
| 🔬 **Forscherkollektiv** | `research` | Forschungsgeschwindigkeit, Wissensaustausch | Aereth, Zhareen |
| 🕵️ **Schattennetz** | `intelligence` | Spionage, Information, Geheimdienstquests | Vel'Ar |
| 🌱 **Siedlerbund** | `colonization` | Kolonieentwicklung, Pop-Wachstum | Kryl'Tha |
| ⚖️ **Freier Rat** | `diplomatic` | Neutrale Mediation, multi-fraktionale Quests | Alle |

#### 13.6.3 Gilde & NPC-Fraktionen – Interaktionen

Gilden sind keine Fraktionen, aber sie können in das galaktische Machtgefüge eintreten:

**Diplomatische Anerkennung:**
```
Gilde erreicht Mitgliederzahl ≥ 5 UND Ressourcenmacht (Schiffe ≥ 10)
→ NPC-Fraktionen erkennen Gilde als "externer Akteur" an
→ Gilde erhält eigene diplomacy-Einträge (Standing 0 zu jeder NPC-Fraktion)
→ Gilde kann Mandate erhalten (gesendet an Gründer)
```

**Gilde als kollektiver Erster Berater:**
```
Gilde-Standing bei einer NPC-Fraktion ≥ +61 UND Gilde-Typ passt zu Fraktion
→ Fraktion bietet der Gilde (nicht nur dem Gründer) Erster-Berater-Status
→ Beratungs-Mandate gehen an Gründer; interne Abstimmung innerhalb der Gilde möglich
```

**Gilden-Rivalitäten:**
Wenn zwei Gilden unterschiedliche NPC-Fraktionen als Hauptpartner haben und dieselben
Handelssysteme kontrollieren, entsteht automatisch eine Rivalität (→ PvP-Event-Trigger).

#### 13.6.4 Gilde verlassen / auflösen

- **Mitglied verlässt:** 3-Tage-Cooldown; Standing innerhalb der Gilde verloren
- **Gründer verlässt:** Gründer muss einen Nachfolger ernennen ODER Gilde auflösen
- **Auflösung:** Gilde-Ressourcen werden 50/50 unter Gründer und Mitglieder aufgeteilt;
  Gilde-Standing bei NPC-Fraktionen wird in individuelles Standing umgerechnet (÷ 2)
- **Natürlicher Tod:** Gilde mit 0 aktiven Mitgliedern (>14 Tage) wird automatisch aufgelöst

---

### 13.7 DB-Schema & API

#### Neue Tabelle: `user_faction_membership`

```sql
CREATE TABLE IF NOT EXISTS user_faction_membership (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    user_id         INT NOT NULL,
    faction_id      INT NOT NULL          COMMENT 'NULL wenn Gilde',
    guild_id        INT                   COMMENT 'NULL wenn NPC-Fraktion',
    membership_type ENUM('npc_faction','guild') NOT NULL DEFAULT 'npc_faction',
    status          ENUM('member','left','expelled','pending_invite') NOT NULL DEFAULT 'member',
    rank            TINYINT UNSIGNED NOT NULL DEFAULT 1
        COMMENT '1=Neubürger … 5=Leutnant; für Gilden: 1=Mitglied, 10=Gründer',
    guild_rank      ENUM('member','officer','founder') DEFAULT NULL,
    joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at         DATETIME,
    rejoin_blocked_until DATETIME         COMMENT 'Cooldown nach Austritt/Ausschluss',
    UNIQUE KEY uq_ufm_user_npc (user_id, faction_id),
    INDEX idx_ufm_user (user_id),
    INDEX idx_ufm_faction (faction_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (faction_id) REFERENCES npc_factions(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

#### Neue Tabelle: `guilds`

```sql
CREATE TABLE IF NOT EXISTS guilds (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    name            VARCHAR(64) NOT NULL UNIQUE,
    tag             VARCHAR(8) NOT NULL UNIQUE    COMMENT 'Kurzname [GLD]',
    guild_type      ENUM('military','trade','research','intelligence','colonization','diplomatic')
                    NOT NULL DEFAULT 'diplomatic',
    founder_user_id INT NOT NULL,
    description     TEXT,
    member_count    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    founded_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    dissolved_at    DATETIME,
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_guilds_founder (founder_user_id),
    FOREIGN KEY (founder_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
```

#### Erweiterung `diplomacy` für Gilden

```sql
ALTER TABLE diplomacy
    ADD COLUMN IF NOT EXISTS guild_id INT DEFAULT NULL
        COMMENT 'NULL = Spieler-Diplomatie; gesetzt = Gilde-Diplomatie',
    ADD INDEX IF NOT EXISTS idx_diplomacy_guild (guild_id);
```

#### API-Endpunkte (`api/factions.php`)

```
GET  factions.php?action=my_membership
     → { faction_id, faction_name, membership_type, status, rank, guild_rank,
         rank_title, rank_benefits[], joined_at }

POST factions.php?action=leave_faction
     → { faction_id } → Führt Austritt aus; applied standing penalty; sets cooldown

POST factions.php?action=accept_invite
     → { faction_id } → Nimmt Einladung an; startet Aufnahme-Quest

GET  factions.php?action=list_guilds
     → Paginierte Gildenliste mit name/tag/type/member_count/standing_summary

POST factions.php?action=found_guild
     → { name, tag, guild_type, description } → Prüft Voraussetzungen; INSERT guilds;
       INSERT user_faction_membership (guild)

POST factions.php?action=join_guild
     → { guild_id } → Beitrittsantrag; Gründer muss annehmen

POST factions.php?action=leave_guild
     → { guild_id } → Austritt; bei Gründer: Nachfolger-Prüfung

GET  factions.php?action=guild_detail
     → { guild_id } → Mitglieder, Standing, Typ, aktive Mandate
```

---

### 13.8 Implementierungsphasen

| Phase | Inhalt | Aufwand |
|---|---|---|
| **Pre** | Migration: `user_faction_membership` (NPC + Gilde) + `guilds` + `diplomacy.guild_id` | Klein |
| **1** | Startmitgliedschaft: Bei Registrierung INSERT in `user_faction_membership` (Rang 1, NPC, Rasse) | Klein |
| **2** | `api/factions.php`: `my_membership` + `leave_faction` + `accept_invite` | Mittel |
| **3** | Rang-Aufstiegs-Logik: Standing-Check → Rang-Update in `npc_ai`-Tick oder Quest-Trigger | Mittel |
| **4** | Fraktionswechsel-Quest-Kette (1 pro Fraktion; Überläufer-Mechanik) | Groß |
| **5** | Gilde-Gründung: `found_guild` + `join_guild` + `leave_guild` API | Mittel |
| **6** | Gilde-Diplomatie: `diplomacy`-Einträge für Gilden; NPC-Anerkennung ab 5 Mitglieder | Mittel |
| **7** | `js/game.js`: Mitgliedschafts-Panel (Rang, Boni, Austritts-Button, Einladungs-Overlay) | Groß |
| **8** | `js/game.js`: Gilden-Panel (Gründen, Beitreten, Mitglieder, Gilde-Standing) | Groß |
| **9** | `config/config.php`: Balancing-Konstanten (Wechsel-Cooldown, Austritts-Standing, etc.) | Klein |

---

## Anhang A: LORE-Fragment – „Das erste Jahr der Gesandten"

*Aus dem nicht-klassifizierten Teil der Zhareen-Archive, Eintrag 7.441.330:*

> Was in jenem ersten Jahr auf Khal'Vethis geschah, war kein diplomatisches Kunststück. Es war Überlebensinstinkt. Der Gouverneur – jung, unbekannt, von keiner der alten Linien gesegnet – spielte keine ausgeklügelte Strategie. Er hörte zu.
>
> Er hörte Sharr'Keth zu, wenn sie von Ehre sprach, und verstand, dass Vor'Tak Respekt vor allem anderen schätzte.
> Er hörte Tael'Mii zu, wenn er von der Konvergenz als lebendem Wesen sprach, und verstand, dass Syl'Nar nicht Alliierte suchten, sondern Gläubige.
> Er hörte Vel'Saar zu und verstand, dass hinter jedem Aereth-Angebot eine Frage steckte, die sie selbst nicht stellen konnten.
>
> Und Nira'Vel – den undurchschaubarsten aller Gesandten – hörte er am genauesten zu.
> *„Du hörst uns alle,"* sagte Nira'Vel an jenem letzten Abend, als alle anderen Herolde gegangen waren. *„Das macht dich entweder sehr klug oder sehr gefährlich."*
>
> Der Gouverneur schwieg.
>
> Nira'Vel zog die Maske herunter – eine Geste, die kein Vel'Ar gegenüber einem Fremden macht. Für einen Atemzug lang war die nebelartige Gestalt einfach... ein Lebewesen, das zuhörte.
>
> *„Gut,"* sagte sie. *„Gefährlich können wir gebrauchen."*

---

## Anhang B: Kurzreferenz – Fraktionsziele gegenüber Khal'Vethis

| Fraktion | Kurzfristiges Ziel | Langfristiges Ziel | Verdecktes Ziel |
|---|---|---|---|
| 🦎 Vor'Tak | Transitmilitarisierung | Frontposten im Dreifach-Korridor | Vethisit für Schockwaffenforschung |
| 🐙 Syl'Nar | Handels- und Spiritualbeziehung | Lichtbund-neutrales Ausgleichsgewicht | Vethisit-Resonanz als kosmisches Signal |
| 🔥 Aereth | Vethisit-Forschung | Wissenschaftliches Außenlabor | Sol'Kaars Experimente ohne Aufsicht fortsetzen |
| 🦗 Kryl'Tha | Brutposten-Expansion | Logistik-Knotenpunkt für Schwarmoperationen | Vorbereitung auf Eisenflotten-Konfrontation |
| 💎 Zhareen | Vethisit-Geschichtsforschung | Präventiver Archivposten vor Leerenbrut | Suche nach Zusammenhang Vethisit–Riss |
| 🌫️ Vel'Ar | Unkontrollierter Informationsknoten | Operativer Schattenstützpunkt | Khal'Vethis als Off-Grid-Schaltpunkt für das gesamte Wissensnetz |

---

*Dokument-Status: Konzept vollständig. Für Gameplay-Implementierung siehe [GAMEPLAY_DATA_MODEL.md](GAMEPLAY_DATA_MODEL.md) (Diplomatie, Wirtschaft, Militär-Mechaniken) und [GAMEDESIGN.md](GAMEDESIGN.md) (Fraktions-LORE Vollreferenz).*
