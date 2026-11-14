# GalaxyQuest: Erinnerungen eines geschwätzigen Kometen

**Status:** Bilinguale Untertitel- und TTS-Cues sind in die Kino-Tour eingebunden. Entwickler-Credits bleiben optionale Platzhalter und werden nicht automatisch gesprochen.
**Erzähler:** die fiktive GalaxyQuest-Personifikation von C/1995 O1 (Hale-Bopp).
**Ablauf:** [aktueller Kampagnenstart](../gamedesign/ONBOARDING_PROLOGUE_DESIGN.md#aktueller-kampagnenstart-komet-heimatwelten-und-shuttle).

## Stimme und Erzählvertrag

Ein alter Reisender: neugierig, warmherzig, gelegentlich eitel. Er kennt keine
Staatsgrenzen, hört aber sehr genau zu. Sein Humor richtet sich gegen
Machtansprüche und seine eigene Wichtigkeit, nicht gegen Körper oder Herkunft.
Bei bedrohten Welten wird er stiller. Keine Witze auf Kosten der Opfer.

Die Geschichte reicht vom frühen Universum bis zur Entscheidung des Spielers.
Der Komet hat den Urknall **nicht** erlebt: Er erzählt davon, unterscheidet
überliefertes Wissen von eigener Erinnerung und gehört zum viel jüngeren
Sonnensystem. Sein Bewusstsein, Gespräche und die interstellare Reiseroute sind
Spielfiktion; der reale Hale-Bopp folgt keiner Tour durch diese Heimatwelten.
Die wirkliche Entdeckung 1995 bleibt eine menschliche Beobachtung, kein
Geburtstag des Kometen. Es wird keine Verbindung zu einem realen Kult hergestellt.

Alle gesprochenen Texte sind neu verfasst. Wissenschaftliche Aussagen sind
paraphrasiert und unten belegt; außerirdische Biologie, Konvergenz, Leerenbrut
und Vethisit sind ausschließlich Lore. Quellencodes gehören nicht ins Filmbild.

Die Leitfrage „Was macht eine Welt zum Zuhause?“ verbindet die Stationen:
Neugier, Gemeinschaft, Verständigung, Vertrauen, Schutz und Erinnerung führen
über Konflikte und andere Perspektiven zur eigenen Herkunftswahl. Der Komet
spricht das Publikum direkt an, erklärt Begriffe im Zusammenhang und lässt
ernste Momente ohne Pointe stehen. Übergänge greifen den vorherigen Gedanken
auf, statt jede Station als neue Faktenliste zu beginnen.

Die Gesprächsnähe und thematischen Verbindungen sind von Googles
[NotebookLM Audio Overviews](https://blog.google/innovation-and-ai/products/notebooklm-audio-overviews/)
und [Audioforschung](https://deepmind.google/blog/pushing-the-frontiers-of-audio-generation/)
inspiriert. Die Erzählung bleibt jedoch ein eigener Monolog mit der gewählten
Kometenstimme, kein erzeugtes Zwei-Personen-Gespräch. Die Sprechregie verwendet
keine Google-API und behauptet nicht, deren Prosodie mit Piper nachzubilden.

## Schnitt, Untertitel und Zeitbasis

Die Galaxie bleibt Hauptdarsteller. Die Kamera folgt dem Kometen kontinuierlich,
auch wenn ein Untertitel wechselt. Ankunftstexte beginnen erst, wenn die Engine
die Ankunft meldet, niemals allein nach Ablauf eines Texttimers.

Eine Tabellenzeile ist eine große Untertitelkarte; sie darf auf schmalen
Displays über mehrere Zeilen umbrechen. Richtwert:
höchstens 18 Zeichen pro Sekunde, inklusive Leerzeichen. Bei schmalen Displays
Karten teilen oder die Text-/Ankunftspause verlängern, **nicht** die Reise
beschleunigen. Ein-/Ausblendungen liegen innerhalb des Kartenfensters.

Opening: mindestens 12 + 8,5 + 14 Sekunden. Pro Station fliegt die Kamera
45 Sekunden; die anschließende Vorstellung hat mindestens 12 Sekunden.
Ohne längere Sprache, Ladezeiten, Pausen oder Überspringen dauert die
öffentliche Tour ungefähr 9 Minuten 8 Sekunden.

| Cue | Lokales Fenster | Auslöser |
|---|---|---|
| T1 | 0–7 s | Tatsächlicher Beginn dieser Kometenstrecke |
| T2 | 7–14 s | Gleiche Strecke, Kamera unverändert |
| T3 | 14–20 s | Gedanke abschließen |
| Ruhe | 20–22,5 s | Nur Galaxie, Komet und Musik |
| T4 | 22,5–29,5 s | Zweite Hälfte derselben Strecke |
| T5 | 29,5–36,5 s | Gleiche Strecke |
| T6 | 36,5–42,5 s | Gleiche Strecke |
| Ruhe | 42,5 s bis Ankunft | Keine Behauptung einer bereits erreichten Welt |
| A1 | 0–6 s nach Freigabe | Bestätigte Ankunft, nahe Hemisphärenansicht |
| A2 | 6–12 s nach Freigabe | Welt bleibt im Bild |

Die Cue-Zeitpunkte und Texte liegen in
[`config/onboarding_narration.json`](../../config/onboarding_narration.json).
Die Fenster sind Mindestzeiten: Wird die Sprache noch erzeugt oder abgespielt,
bleibt die Karte bis zum Clip-Ende stehen. Bei längerer Vorbereitung erscheint
ein Hinweis. Die Kamera fliegt unabhängig weiter; nach ihrer Ankunft werden
verbleibende Transit-Cues gezeigt und zu Ende gesprochen, bevor A1 beginnt.
Auch nach dem Shuttle- oder Landeflug wartet die automatische Übergabe auf
laufende Sprache. Nach T3 gibt es eine zusätzliche Atempause von 2,5 Sekunden.
Bei Fehlern oder stummgeschalteter Sprache läuft der Text weiter.
Manuelles Weiter und Überspringen dürfen Sprache ausdrücklich abbrechen.
Pause hält die aktuelle Sprachwiedergabe und die Flug-/Text-Timer an.

Während ein Cue spricht, wird höchstens der nächste bekannte Cue für dieselbe
Stimme vorbereitet und beim Wechsel wiederverwendet. So entstehen bei einem
kalten Cache weniger Synthesepausen; lückenlose Wiedergabe ist dennoch nicht
garantiert. Bei Stummschaltung oder deaktivierter automatischer Sprachausgabe
erfolgt keine Vorbereitung. Ein Sprung, Stimmwechsel oder Abbruch verwirft
nicht mehr passende Vorbereitungen; eine bereits serverseitig gestartete
Synthese kann trotz Browser-Abbruch noch zu Ende laufen. Der PHP-Endpunkt
gibt die Sitzung vor der Synthese frei, damit Registrierungsschritte nicht
auf deren Abschluss warten müssen.

Für die Kometen-Cues nutzt Piper `length_scale: 1.02` und
`sentence_silence: 0.35`; die bisherigen Werte anderer Narrationen bleiben
unverändert. Kurze Sätze, Fragen und Satzzeichen geben dem Modell Raum für
Atempausen und natürliche Betonung. Die Pause gilt zwischen Sätzen, nicht
als exakt platzierter Inline-Break. Piper bietet hier weder SSML noch eine
verlässliche Tonhöhen- oder Emotionssteuerung; diese Eigenschaften werden
nicht vorgetäuscht. Text, Stimme und Prosodie bestimmen den Audio-Cache.

Im Startmenü stehen vier feste Profile zur Wahl: Deutsch (Kerstin, weiblich;
Thorsten, männlich) und US-Englisch (Lessac, weiblich; Ryan, männlich).
Deutsch-weiblich bleibt die Voreinstellung. Das Profil wählt Stimme **und**
Sprache, damit gesprochener Text und Untertitel zusammenpassen. Das allgemeine
TTS-Menü bleibt weiterhin für die übrige Spiel-Sprachausgabe zuständig.

## 0. Galaxie, Titel, Konvergenz

Menübedienungen fliegen aus. Die Galaxie bleibt sichtbar; die Kamera findet den
Kometen durch seinen Staubschweif. Kein separater Film, keine zweite Szene.

| Cue | Fenster | Untertitel | Grundlage |
|---|---|---|---|
| O1 | Galaxie, 0–6 s | Diese Galaxie hält Sterne, Gas und Staub mit ihrer Schwerkraft zusammen. Und Geschichten. | W1 |
| O2 | Galaxie, 6–12 s | Mich zum Beispiel. Ich bestehe aus Eis und Staub. Und bin besser im Reisen als im Bremsen. | Personifikation |
| O3 | Titel, 0–4,5 s | Die Menschen nennen mich Hale-Bopp. Ich bin ein Komet. | W5; Personifikation |
| O4 | Titel, 4,5–8,5 s | Kommt mit. Sitze habe ich keine, aber die Aussicht ist großartig. | Personifikation |
| O5 | Konvergenz, 0–7 s | Heute reisen wir in eine Geschichte: zur Kalytherion-Konvergenz, weit jenseits der Erde. | L1 |
| O6 | Konvergenz, 7–14 s | Sechs Völker, ein Bündnis. Was macht eine Welt für sie zum Zuhause? Sehen wir nach. | Überleitung |

Das Titelkapitel behält seine Kameraeinstellung; eine separate Titelfläche
überlagert die Galaxie nicht. Das Galaxiezentrum bleibt während der späteren
Auswahl zentriert.

## 01. Aereth / Sol'Ryaan

Erster Flug: vom kosmischen Anfang zur ersten Zivilisation.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Ganz am Anfang stand der Urknall. Das Universum ist ungefähr 13,8 Milliarden Jahre alt. | W2 |
| T2 | Unser Sonnensystem entstand viel später: vor rund 4,6 Milliarden Jahren. Erst danach kam ich dazu. | W6 |
| T3 | Den Urknall habe ich also verpasst. Für einen alten Reisenden ist das etwas peinlich. | W2, W6; Personifikation |
| T4 | Da vorne liegt Sol'Ryaan. Die Aereth bestehen aus Materie und Energie. | L1, L2 |
| T5 | Energie ist ihnen heilig. Sie erforschen sie, um ihre Welt und das Universum zu verstehen. | L1, L2 |
| T6 | Sol'Kaar führt ihren Kernrat. Seine Neugier ist gewaltig; seine Grenzen sind es manchmal weniger. | L1 |
| A1 | In ihren Geschichten schweben Kontinente. Städte aus Licht werden von Energiefeldern getragen. | L1 |
| A2 | Die Aereth zeigen mir: Ein Zuhause kann mit einer Frage beginnen. Ich mag gute Fragen. | Personifikation |

Bild: beleuchtete Krümmung, Atmosphäre, Oberflächen- und Orbitalanker. Die
Lichtstädte sind erzählte Lore, keine Zusicherung bereits gerenderter Stadtmodelle.

## 02. Kryl'Tha / Zyr'Mekar

Vom Leuchten der Energiewelt zur lebenden Gemeinschaft.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Apropos Fragen: Wie misst man Entfernungen zwischen Sternen? Mit Lichtjahren. | W3 |
| T2 | Ein Lichtjahr ist keine Zeit. So weit reist Licht im Vakuum in einem Jahr. | W3 |
| T3 | Das sind rund 9,46 Billionen Kilometer. Ich laufe sie lieber nicht zu Fuß. | W3; Personifikation |
| T4 | Auf Zyr'Mekar leben die Kryl'Tha. Sie denken im Schwarm, bleiben aber einzelne Persönlichkeiten. | L1, L2 |
| T5 | Ihre Städte wachsen mit dem Wald. Ihre Brutkammern sind für sie ein Heiligtum. | L1 |
| T6 | Kommandantin Zha'Mira schützt ihre Gemeinschaft. Zusammenhalt ist für sie mehr als ein Wort. | L1, L2 |
| A1 | Ein Zuhause kann heißen: füreinander da sein, auch wenn der Weg durch den Wald dunkel wird. | L1 |
| A2 | Und ich bleibe lieber über den Bäumen. Kometen sind keine besonders guten Gärtner. | L1; Personifikation |

Bild: ruhiger Anflug über die Hemisphäre. Wald-/Baumstadtbilder sind
Art-Direction, soweit nicht durch vorhandene Oberflächen darstellbar.

## 03. Syl'Nar / Oon'Vareth

Vom Schwarm zu einer Zivilisation, deren Sprache selbst Licht wird.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Vom Wald geht es zu den Ozeanen der Syl'Nar. Unterwegs zeige ich euch meinen Reisemantel. | L1; Personifikation |
| T2 | Sonnenwärme lässt Eis direkt zu Gas werden, ohne zu schmelzen. Das heißt Sublimation. | W4 |
| T3 | Das Gas nimmt Staub mit. So entsteht meine Koma, die Hülle um meinen Kern. | W4; Personifikation |
| T4 | Und da ist Oon'Vareth. Die Syl'Nar sprechen dort auch mit Farben. Gedanken können leuchten. | L1 |
| T5 | Vela'Thii vom Lichtbund sucht Verständigung. Denn Frieden fällt nicht einfach vom Himmel. | L1 |
| T6 | Das weiß ich. Vom Himmel fällt manches. Ich versuche allerdings, nicht dazuzugehören. | Personifikation |
| A1 | Ihre Heimat ist ein Ozeanplanet. In ihren Geschichten wachsen Städte aus lebenden Korallen. | L1; Personifikation |
| A2 | Hier kann Zuhause bedeuten, verstanden zu werden. Auch wenn man einmal keine Worte findet. | Personifikation |

Bild: Atmosphärenrand und Meer. Biolumineszenz der Syl'Nar und
erinnerungstragendes Wasser sind Lore, keine wissenschaftliche Behauptung.

## 04. Vel'Ar / Nira'Voss

Von sichtbarer Sprache zu verborgenen Absichten.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Meine Koma kennt ihr jetzt. Aber was ist der helle Streifen dahinter? | W4 |
| T2 | Mein Staubschweif leuchtet, weil seine Körnchen Sonnenlicht streuen. Er hat also kein eigenes Licht. | W4 |
| T3 | Strahlungsdruck und meine Bahn biegen ihn. Eine Frisur, die niemand bändigen muss. | W4; Personifikation |
| T4 | Erscheinungen sind auch auf Nira'Voss ein Thema: Die gasförmigen Vel'Ar tragen lebende Masken. | L1, L2 |
| T5 | Diese Masken sind Teil ihrer Identität. Was sich dahinter verbirgt, ist nicht immer leicht zu erkennen. | L1, L2 |
| T6 | Shy'Nira und ihr Schattenzirkel sammeln Informationen. Wissen kann schützen. Oder Macht verleihen. | L1 |
| A1 | In den Nebeln von Nira'Voss wird eine andere Frage wichtig: Wem kann man vertrauen? | L1, L2 |
| A2 | Ich wäre ein schlechter Spion. Mein Schweif verrät mich schon von Weitem. | Personifikation |

Bild: Atmosphäre und Silhouetten. Keine Behauptung, eine unsichtbare Flotte
oder konkrete Geheimdienstaktivität werde tatsächlich simuliert.

## 05. Vor'Tak / Drak'Thuun

Von unsichtbarer Kontrolle zu offenem Schutz.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Neben dem Staubschweif habe ich noch einen: den Ionenschweif. Der funktioniert anders. | W4 |
| T2 | Ultraviolettes Sonnenlicht ionisiert Gas aus meiner Koma. Dabei entstehen geladene Teilchen. | W4 |
| T3 | Der Sonnenwind trägt sie fort. Darum zeigt dieser Schweif ungefähr von der Sonne weg. | W4 |
| T4 | Unser nächstes Ziel ist Drak'Thuun. Hier leben die Vor'Tak, stolz und diszipliniert. | L1 |
| T5 | General Drak'Mol führt den Schildzirkel. Er will die Grenzen der Konvergenz schützen. | L1 |
| T6 | Doch Stärke wirft eine Frage auf: Wie verteidigt man, ohne alles andere zu verlieren? | L1 |
| A1 | Unter Savannen und vulkanischen Bergen liegt die Heimat der Vor'Tak, so erzählen ihre Chroniken. | L1 |
| A2 | Sicherheit ist ein Versprechen. Gut, wenn auch jemand fragt, wen es einschließen soll. | Personifikation |

Bild: Krümmung, sichtbarer Orbitalanker, ruhiger Vorbeiflug. Kein Kampf
ausgelöst, keine tatsächlichen Patrouillen als bereits vorhanden behauptet.

## 06. Zhareen / Aeryth'Luun

Der Wendepunkt: aus der Weltenvorstellung wird eine Geschichte mit Verlust.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Manches an mir seht ihr gar nicht. Zum Beispiel meine riesige Hülle aus Wasserstoff. | W4 |
| T2 | Sonnenlicht zerlegt Wasser aus meiner Koma. Dabei wird unter anderem Wasserstoff frei. | W4 |
| T3 | Die Hülle streut ultraviolettes Licht. Für eure Augen bleibt sie unsichtbar. | W4 |
| T4 | Auch die Zhareen bewahren Unsichtbares. Ihre Kristalle speichern Erinnerungen und Gefühle. | L1 |
| T5 | Doch die Leerenbrut bedroht Aeryth'Luun. Teile ihrer Welt und ihrer Archive sind verloren. | L1 |
| T6 | Archivar Kaelor versucht zu bewahren, was noch zu retten ist. Das ist keine leichte Aufgabe. | L1, L2 |
| A1 | Ein Zuhause besteht nicht nur aus Orten. Es lebt auch in denen weiter, die sich erinnern. | L1 |
| A2 | Für einen Moment fehlen selbst mir die Worte. Manche Geschichten brauchen einfach Zeit. | Personifikation |

Bild: längere ruhige Wahrnehmung der Welt statt Effekteskalation. Keine
sichtbare Wasserstoffspur ergänzen, nur um T1 zu illustrieren. Die Bedrohung
ist Erzählung; keine erfundene Echtzeit-Invasion oder persistierten Ruinen.

## 07. Menschen / Erde / Eisenflotte

Der Erzähler vertieft die Geschichte seines menschlichen Namens. Menschen sind
eine Spezies, die Eisenflotte eine politische Militärmacht; beides ist nicht
gleichzusetzen.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Nun fliegen wir zu denen, die mir meinen Namen gaben: den Menschen. | W5; Personifikation |
| T2 | 1995 entdeckten Alan Hale und Thomas Bopp mich, unabhängig voneinander. | W5 |
| T3 | Zwei Entdecker, zwei Nachnamen. Für einen Kometen ohne Ausweis ganz schön förmlich. | Personifikation |
| T4 | 1996 und 1997 konnten sie mich sogar ohne Teleskop sehen. Ich war wohl schwer zu übersehen. | W5; Personifikation |
| T5 | Auf der Erde leben viele verschiedene Menschen. Die Eisenflotte ist eine ihrer Militärmächte. | L1, L3 |
| T6 | Sie will expandieren und stößt mit der Konvergenz zusammen. Nicht alle Menschen wollen das. | L3, L4 |
| A1 | Die Erde ist mehr als eine Flotte. Eure Herkunft wählt ihr unter den sechs Völkern des Bündnisses. | L1, L3, L4; Erzählhaltung |
| A2 | Einige Menschen bewunderten mich. Andere berechneten meine Bahn. Ich mochte beides. | Personifikation |

Bild: heller Erdrand, Oberfläche, Orbitalanker. Kein Anspruch auf reale
Kontinente oder heutige irdische Bauwerke: die aktuelle Erde ist prozedural.
Die fiktive Eisenflotte wird keiner heutigen Nation zugeschrieben.

## 08. Helion-Konföderation / Helion Prime

Nach den militärischen Ansprüchen folgt Macht durch Verbindungen.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Eure Sonne hat acht Planeten. Zu ihrem System gehören auch Monde, Asteroiden und Kometen wie ich. | W6 |
| T2 | Wir sind nur einige von vielen Körpern im Sonnensystem. Platz zum Entdecken gibt es genug. | W6 |
| T3 | Für eine ordentliche Parkplatzverwaltung wäre es trotzdem eine Herausforderung. | Personifikation |
| T4 | Von den Planeten geht es nach Helion Prime. Die Konföderation verbindet Welten durch Handel. | L1, L3 |
| T5 | Wer Waren tauscht, tauscht oft auch Wissen. Doch Verträge können Abhängigkeiten schaffen. | L3 |
| T6 | Ihre Neutralität hält Wege offen. Das bedeutet nicht, dass alle Geschäfte uneigennützig sind. | L1, L3 |
| A1 | Auf Helion Prime treffen Hoffnungen, Interessen und Preise aufeinander. Manchmal im selben Satz. | L3 |
| A2 | Mein Rat: Lest das Kleingedruckte. Ich selbst kann nur darauf landen. Wenn es groß genug ist. | Personifikation |

Bild: nahe Hemisphäre und Orbitalanker als Handelsmotiv. Keine zusätzlichen
Frachter, Marktgebäude oder realen Handelsbewegungen voraussetzen.

## 09. Ketzer von Verath / Verath

Die letzte Welt stellt die Frage, die der Spieler anschließend selbst beantwortet.

| Cue | Untertitel | Grundlage |
|---|---|---|
| T1 | Von Verträgen zu Fragen. Die Menschen fragten einst, wann ich der Sonne am nächsten kam. | W5 |
| T2 | Das war am ersten April 1997. Ja, wirklich. Das Datum habe nicht ich ausgesucht. | W5 |
| T3 | Der sonnennächste Punkt einer Bahn heißt Perihel. Danach führt mein Weg wieder hinaus. | W5 |
| T4 | Fragen anderer Art stellen die abtrünnigen Syl'Nar auf Verath, jenseits der etablierten Lehren. | L3 |
| T5 | Sael-Vorath und seine Gemeinschaft sammeln Wissen, das anderswo nicht gern gehört wird. | L3 |
| T6 | Sie sind dieselbe Spezies wie die Syl'Nar von Oon'Vareth. Nur ihre Überzeugungen unterscheiden sich. | L3, L4 |
| A1 | Wer entscheidet, welche Frage erlaubt ist? Für die Ketzer von Verath ist das keine leichte Frage. | L3 |
| A2 | Damit sind wir zurück bei unserer ersten Frage: Was macht einen Ort zu einem Zuhause? | Personifikation |

Bild: ruhiger letzter Vorbeiflug. Das versteckte Kloster-Riff ist Lore,
nicht ein bereits vorhandenes detailliertes Bauwerksmodell.

## 10. Herkunft und Commander-Name

Keine feste Laufzeit. Der Komet schweigt nach jeder kurzen Karte; keine
Endlosschleife und kein Drängen während einer Entscheidung. Pflichtinformationen
bleiben als kompakte UI-Texte erhalten, auch wenn Untertitel ausgeblendet werden.

| Auslöser | Untertitel |
|---|---|
| Tour beendet oder übersprungen | Sechs Herkünfte stehen euch offen. Andere Mächte begegnen euch unterwegs. Und nun? |
| Herkunftswahl bereit | Welche Geschichte möchtet ihr weiterschreiben? Wählt eure Herkunft. Ich kann gut warten. |
| Herkunft geändert | {Spezies}. Dann führt unser Weg zur Heimatwelt {Heimatwelt}. |
| Auswahlflug noch unterwegs | Wir sind noch unterwegs. Ihr könnt eure Wahl trotzdem in Ruhe prüfen. |
| Commander-Eingabe bereit | Und wie darf ich euch nennen? Namen bleiben mir besser im Gedächtnis als Katalognummern. |
| Name bestätigt | {Commander}. Gut. Diesmal musste niemand ein Teleskop bemühen. |
| Private Akte / Entwurf prüfen | Noch ist das ein privater Entwurf. Ihr könnt eure Angaben ändern. |

Einblendungen mit variablen Namen nur als Text, nicht als HTML interpretieren.
Lange Namen nicht in eine kurze feste Karte zwingen. Die generische
„Wie darf ich euch nennen?“-Karte kann stehen bleiben, ohne den Namen zu wiederholen.

Falls die Tour übersprungen wurde, bedeutet die erste Karte keine Behauptung,
alle Welten seien besucht worden. Nur angebotene Auswahlmöglichkeiten benennen.

## 11. Rückflug und Shuttle-Rendezvous

Eine nötige Rückreise dauert weiterhin regulär 45 Sekunden. Keine Wiederholung
der kompletten Spezies-Vorstellung. Nach den Karten Raum für Musik und Flug.

| Auslöser | Untertitel |
|---|---|
| Rückflug erforderlich, 0–7 s | Wir nehmen Kurs auf eure gewählte Heimatwelt. Dort beginnt der nächste Teil eurer Reise. |
| Rückflug, 22,5–29,5 s | Ich begleite euch noch ein Stück. Aber euer nächstes Fahrzeug hat Sitze. |
| Heimatwelt tatsächlich erreicht | Da ist eure Heimatwelt. Das Shuttle kann euch von hier weitertragen. |
| Shuttleflug beginnt | Euer Shuttle kreuzt gleich meinen Kurs. Es hat Sitze. Ich bin ein bisschen neidisch. |

Diese Karten folgen Ereignissen, nicht einer geratenen Rendezvous-Sekunde.
Bei direktem Rendezvous entfallen die Rückflugkarten. Der Wechsel ist ein
Kameratransfer bei sicher gekreuzten Flugwegen, kein körperlicher Sprung ins Vakuum.
Ein Shuttle-Start darf nur kommentiert werden, wenn er tatsächlich sichtbar ist.

## 12. Shuttleflug zur privaten Randwelt

Der aktuelle Reise-Shot dauert 22 Sekunden; die genaue Aufteilung zwischen
Rendezvous und Flug kommt aus der Choreografie. Nach dem Kamerawechsel nur
Karten verwenden, für die noch mindestens sechs Sekunden bleiben. Bei zu
wenig Zeit gehen die übrigen Karten in die ruhende Zielansicht über.

| Cue nach Kamerawechsel | Untertitel | Grundlage |
|---|---|---|
| S1 | Am Rand der Konvergenz wartet eure neue Welt. Klein, aber voller Möglichkeiten. | L1, L5 |
| S2 | Unter ihrem Boden liegt Vethisit. In dieser Geschichte reagiert es auf Sprungfeldenergie. | L5 |
| S3 | Die Mächtigen interessieren sich dafür. Die Bewohner brauchen jemanden, der entscheidet. | L5 |

Der Komet spricht als filmischer Erzähler weiter, nicht als erfundener Funkkontakt.
Keine Aussage über konkrete Startressourcen, fertige Handelsnetze oder bereits
aktive Fraktionsboni. Kein Versprechen, ein anderes System werde sofort generiert.

## 13. Ziel prüfen, ausdrücklich bestätigen, landen

| Auslöser | Untertitel |
|---|---|
| Zielorbit tatsächlich erreicht | Da liegt eure neue Heimat. Nehmt euch Zeit und bestätigt die Landung erst, wenn ihr bereit seid. |
| Ruhende Zielprüfung | Prüft Welt, Herkunft und Akte. Noch müsst ihr nicht landen. |
| Explizite Bestätigung | Dann ist es entschieden. Das Shuttle setzt zur Landung an. Eure Geschichte beginnt hier. |
| Landung, 0–6,5 s | Meine Reise geht weiter. Eure Geschichte beginnt hier. |
| Draft-Spiel / Tutorial bereit | Willkommen, Commander. Der Kommandostand gehört jetzt euch. |

Auch nach dieser Landung bleibt es ein privater Draft. Dauerhaftes Konto und
aktive Kolonie erfordern den bestehenden verifizierten Registrierungsabschluss.
Der letzte Untertitel wird erst nach erfolgreicher Übergabe angezeigt.
Tutorialziele selbst kommen aus dem vorhandenen Tutorial, nicht aus diesem Skript.

### Fehlende Szenen und echte Fehler

Diese Meldungen sind sachliche UI, keine Pointe des Kometen:

| Zustand | Kompakter UI-Text |
|---|---|
| Öffentliche Welt fehlt | Diese Heimatwelt kann gerade nicht dargestellt werden. Du kannst ausdrücklich ohne Darstellung weiterlesen. |
| Kameraflug fehlgeschlagen | Der Kameraflug ist nicht verfügbar. Die Darstellung wird nicht als Ankunft gewertet. |
| Herkunfts-Drafts nicht bereit | Die privaten Herkunfts-Entwürfe sind noch nicht bereit. Bitte erneut versuchen. |
| Tutorialübergabe fehlgeschlagen | Die Übergabe an das private Spiel ist fehlgeschlagen. Bitte erneut versuchen. |

Keine Erfolgsuntertitel bei Fehlern und keine automatische Landebestätigung.

## Entwickler-Cast: kleine filmische Signaturen

Keine Namen oder Rollenbesetzungen erfinden. Die folgenden Platzhalter werden
nur mit freigegebenen tatsächlichen Credits ersetzt; sonst entfällt die Karte.
Der Spielcharakter-Cast ist nicht der Entwickler-Cast.

| Gelegenheit | Credit statt T3, 14–20 s |
|---|---|
| Flug 01, erste Weite | Eine Reise von / {freigegebener Teamname} |
| Flug 03, Koma im Licht | Engine und Kamera / {freigegebene Namen} |
| Flug 04, Partikelschleier | Welten und Gestaltung / {freigegebene Namen} |
| Flug 08, ruhige Verbindung | Geschichte und Klang / {freigegebene Namen} |

Maximal eine kleine Creditkarte pro Strecke. Wenn ein Credit T3 ersetzt, müssen
dessen notwendige Informationen an anderer Stelle erhalten bleiben.
Bei vielen Namen nicht die Schrift verkleinern: nur einen freigegebenen
Gruppencredit zeigen und die vollständige Liste außerhalb des Intros anbieten.
Ohne Tonaufnahme keinen Credit für eine tatsächlich noch nicht besetzte Stimme.

Motion blendet Credits ruhig ein und aus; keine weitere bewegte Dialogbox.
Eine freie Bildecke wählen, Komet, Planetenkontur und zentrale Titelanimation
nicht überdecken. Im reduzierten Bewegungsmodus keine Einflüge oder Parallaxe.
Alle Credits sind überspringbar, alle Entscheidungsinformationen bleiben bedienbar.

## Quellen und redaktionelle Grenzen

Erzählprinzipien: [Downs, wissenschaftliche Geschichten und verständliche
Kausalzusammenhänge](https://pmc.ncbi.nlm.nih.gov/articles/PMC4183172/).
Die Autorin betont zugleich Quellenprüfung und Evaluation statt einer
automatischen Garantie für Lernerfolg.

### Wikipedia: belegte reale Aussagen

| Code | Artikel / Abschnitt | Im Drehbuch verwendete Aussage |
|---|---|---|
| W1 | [Galaxie](https://de.wikipedia.org/wiki/Galaxie), Einleitung | Gravitation bindet Sterne, Gas und Staub; die Definition umfasst außerdem weitere Bestandteile, etwa Dunkle Materie. |
| W2 | [Universum](https://de.wikipedia.org/wiki/Universum), Infobox | Alter rund 13,8 Milliarden Jahre. Kein eigener Komet als Zeuge des Urknalls. |
| W3 | [Lichtjahr](https://de.wikipedia.org/wiki/Lichtjahr), Einleitung / Definition | Entfernung, die Licht im Vakuum in einem julianischen Jahr zurücklegt; keine Zeiteinheit. |
| W4 | [Komet](https://de.wikipedia.org/wiki/Komet#Aufbau), Kern / Koma / Schweif | Sublimation, mitgerissener Staub, Koma, Staub- und Ionenschweif, UV-Wasserstoffhülle. |
| W5 | [C/1995 O1 (Hale-Bopp)](https://de.wikipedia.org/wiki/C/1995_O1_(Hale-Bopp)), Infobox / Entdeckung und Beobachtung | Entdeckung am 23. Juli 1995 (UT) durch Alan Hale und Thomas Bopp; Beobachtungsnacht 22./23. Juli, kurz nach Mitternacht Ortszeit; Sichtbarkeit 1996/97; Perihel am 1. April 1997 (UT). |
| W6 | [Sonnensystem](https://de.wikipedia.org/wiki/Sonnensystem), Einleitung | Sonne, acht Planeten und weitere Körper, darunter Kometen und Asteroiden. |

Wissenschaftlicher Gegencheck: [NASA zum Sonnensystem und dessen Alter](https://science.nasa.gov/solar-system/solar-system-facts/),
[NASA zu Hale-Bopp](https://science.nasa.gov/solar-system/comets/c-1995-o1-hale-bopp/),
[ESA zur Wasserstoffhülle](https://www.esa.int/ESA_Multimedia/Images/1998/01/Comet_Hale-Bopp_hydrogen_cloud_seen_by_SOHO)
und [Rosetta-Messungen zur Ionisierung des Kometengases](https://academic.oup.com/mnras/article/462/Suppl_1/S331/2454752).

Wikipedia ist hier eine nachvollziehbare Sekundärquelle, keine Garantie für
jede Einzelzahl und keine Quelle für Spiel-Lore. Keine feste Kometen-Lebensdauer,
Kernabmessung oder unveränderliche Umlaufzeit wird behauptet. Die
Wasserstoffhülle ist kein dritter sichtbarer Partikelschweif.
Der Ionenschweif zeigt ungefähr antisolar; der Staubschweif ist gekrümmt,
nicht einfach eine Auspuffspur entgegen der Flugrichtung. In der
interstellaren Filmreise bleibt die Beleuchtung eine dokumentierte Näherung.

### Projekt-Lore und tatsächlicher Ablauf

| Code | Repository-Quelle | Verwendung |
|---|---|---|
| L1 | [GAMEDESIGN.md](../gamedesign/GAMEDESIGN.md), Spezies, Welten, Nebenfraktionen | Biologie, Kultur, Konvergenz, öffentlich bekannte Figuren, Bedrohungen. |
| L2 | [Spezies-Specs](../../fractions/): `aereth`, `kryl_tha`, `syl_nar`, `vel_ar`, `vor_tak`, `zhareen` | Abgleich von Heimatwelten und Speziescharakter. |
| L3 | [Eisenflotte](../../fractions/iron_fleet/spec.json), [Helion](../../fractions/helion_confederation/spec.json), [Verath](../../fractions/ketzer_von_verath/spec.json) | Kuratierte NPC-Stationen; Verath als abtrünnige Syl'Nar, nicht neue Spezies. |
| L4 | [Konfiguration](../../config/onboarding_prologue.json), [Cue-/Sprachkonfiguration](../../config/onboarding_narration.json), [Spielbare Codes](../../api/helpers.php), [Toursteuerung](../../js/network/registration-prologue.js) | Sechs spielbare Spezies in der Drehbuchreihenfolge, anschließend die drei konfigurierten NPC-Stationen; lokalisierte Cues, Zeiten und Entscheidungsablauf. |
| L5 | [FACTION_INTRODUCTION.md](../gamedesign/FACTION_INTRODUCTION.md), Spielerstart / Vethisit; [aktueller Prolog](../gamedesign/ONBOARDING_PROLOGUE_DESIGN.md) | Randwelt, Gesandte, privater Entwurf und ausdrücklich bestätigte Landung. |

Die Reihenfolge ist Aereth → Kryl'Tha → Syl'Nar → Vel'Ar → Vor'Tak → Zhareen
→ Erde/Eisenflotte → Helion Prime → Verath. Die vier politischen Strömungen
Kernrat, Lichtbund, Schattenzirkel und Schildzirkel sind keine vollständige
Liste der sechs Spezies und keine zusätzlichen Herkunftsoptionen.

**Widersprüche bewusst ausgelassen:** Ältere Lore nennt Admiral Thorne, die
Eisenflotten-Spec Admiral Kessler. Dieses Intro nennt keinen Admiral.
Personenalter und genaue fiktive Chronologien bleiben ebenfalls ungenannt.
Geheime Verantwortlichkeiten für die Leerenbrut und spätere Enthüllungen
werden nicht vorweggenommen.

**Darstellungsgrenze:** Oberfläche und Anlagen sind derzeit prozedurale,
kosmetische Vorschauen. Riffklöster, Baumstädte, Lichtkontinente und reale
Erdgeografie sind keine durch dieses Dokument hinzugefügten Engine-Fähigkeiten.
Die Texte erzählen davon, ohne „seht dort dieses Gebäude“ zu behaupten.
