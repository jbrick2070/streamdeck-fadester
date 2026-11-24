# Fadester for OBS: Schnellstarts

*Dies ist eine Übersetzung der englischen Schnellstarts, erstellt mit einem KI-Modell und von einem zweiten KI-Modell geprüft; eine Durchsicht durch Muttersprachler steht noch aus.*

[Fadester for OBS](#fadester-for-obs) · [Start hier](#start-here) · [Fertige Layouts](#layouts) · [OpenDeck](#opendeck) · [Ein Plugin mit VJster](#suite) · [Layout-Dateien von Hand](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS bringt OBS Studio auf Ihr Stream Deck: Szenen, Übergänge, Quellen, Filter und Audio auf Tasten und Drehreglern.

<img src="../../docs/images/first-key-steps.svg" alt="Die erste Taste in drei Schritten: 1, die .streamDeckPlugin-Datei doppelklicken und installieren; 2, in OBS unter Werkzeuge → WebSocket-Servereinstellungen den Server aktivieren; 3, in Stream Deck Szene auf eine Taste ziehen und drücken: OBS wechselt zur nächsten Szene." width="900">

1. **Plugin installieren.** Laden Sie auf der [Releases-Seite](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) die Datei mit der Endung `.streamDeckPlugin` herunter und doppelklicken Sie darauf. Bestätigen Sie die Installation in Stream Deck.
2. **WebSocket-Server von OBS einschalten.** In OBS: **Werkzeuge → WebSocket-Servereinstellungen**, den Server aktivieren, mit **OK** bestätigen. Die Authentifizierung bleibt, wie sie ist: Es gibt nichts abzuschreiben.
3. **Szene auf eine Taste ziehen.** Ziehen Sie in der Aktionsliste von Stream Deck, Kategorie *Fadester for OBS*, die Aktion **Szene** auf eine Taste. Sie beginnt als **Nächste Szene**: Drücken Sie sie, und OBS wechselt zur nächsten Szene.

Das war's. Läuft OBS auf demselben Computer, meldet sich das Plugin von selbst an. Solange OBS nicht verbunden ist, sagt die Taste, was zu tun ist, zum Beispiel **OBS: WebSocket an** oder **OBS starten**.

[Vollständige Anleitung (Englisch)](../../README.md)

<a id="start-here"></a>
## Fadester Suite: Start hier

Welche Teile der Fadester Suite Sie für Ihre Hardware brauchen und wie Sie OBS einmal einrichten. Die meisten nutzen ein Stream Deck:

<img src="../../docs/images/first-key-steps.svg" alt="Die erste Taste in drei Schritten: Plugin installieren, WebSocket-Server in OBS aktivieren, Szene auf eine Taste ziehen." width="900">

1. **Fadester for OBS installieren.** Die `.streamDeckPlugin`-Datei von der [Releases-Seite](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) herunterladen, doppelklicken und in Stream Deck installieren.
2. **WebSocket-Server von OBS einschalten.** In OBS Studio 33: **Werkzeuge → WebSocket-Servereinstellungen**, den Server aktivieren, **OK**. Das Plugin liest Port und Passwort, die OBS gespeichert hat.
3. **Szene auf eine Taste ziehen** und drücken: OBS wechselt zur nächsten Szene. Für ein volles Deck klicken Sie die Taste an, dann die Zeile am Fuß ihrer Einstellungsseite, und öffnen Sie **Fertige Layouts**.

Das war's. Ein anderer Controller oder mehr Teile? Die Tabelle steht in der vollständigen Anleitung.

[Vollständige Anleitung (Englisch)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS: fertige Layouts

Vierzehn Layouts für Stream Deck +, das Stream Deck mit 15 Tasten und das Stream Deck Mini. Jedes öffnet sich als Profil, das Sie bearbeiten können.

<img src="../../docs/images/open-layout-steps.svg" alt="Ein fertiges Layout in drei Schritten: 1, eine Fadester for OBS-Taste anklicken; 2, die Zeile am Fuß der Seite anklicken, dann Fertige Layouts; 3, ein Layout wählen und Dieses Layout öffnen drücken." width="900">

1. **Eine Fadester for OBS-Taste** in Stream Deck anklicken: Ihre Einstellungen öffnen sich.
2. **Die Zeile am Fuß der Seite** anklicken (sie zeigt Version und Verbindung) und **Fertige Layouts** öffnen.
3. **Ein Layout wählen und Dieses Layout öffnen drücken.** Ihr Deck wechselt dorthin.

Das war's. Läuft OBS auf demselben Computer mit eingeschaltetem WebSocket-Server, verbindet sich das Plugin von selbst; alle Layouts nutzen diese eine Verbindung.

[Vollständige Anleitung (Englisch)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## Fadester for OBS und VJster mit OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) ist ein freies Open-Source-Programm, das Stream-Deck-Plugins ohne die Stream-Deck-Software von Elgato ausführt. Fadester for OBS läuft darin unverändert.

<img src="../../docs/images/opendeck-steps.svg" alt="Fadester for OBS in OpenDeck in drei Schritten: 1, OpenDeck starten, Deck angeschlossen, Stream-Deck-Software geschlossen; 2, Fadester for OBS im Plugin-Manager installieren; 3, das Layout in der Profilliste unter dem Namen des Decks wählen." width="900">

1. **OpenDeck starten.** Deck anschließen, die Stream-Deck-Software schließen und [OpenDeck](https://github.com/nekename/OpenDeck/releases) starten. Für dieses Plugin braucht es [Node.js](https://nodejs.org/) 24 oder neuer.
2. **Fadester installieren.** Im Plugin-Manager von OpenDeck **Fadester for OBS** installieren, falls aufgeführt, oder die Schaltfläche zum Installieren aus einer Datei mit dem [Fadester-Download](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin) verwenden.
3. **Layout wählen** in der Profilliste unter dem Namen des Decks: **Scene Desk + (Regular Mode)** für das Plus, **Scene Desk 15 Keys (Regular Mode)** für 15 Tasten, **Source Desk Mini (Either Mode)** für das Mini. Bei anderen Modellen **Szene** auf eine Taste ziehen.

Das war's, sobald der WebSocket-Server von OBS läuft (**Werkzeuge → WebSocket-Servereinstellungen**). Läuft OBS auf demselben Computer, meldet sich Fadester mit dem gespeicherten Passwort an.

[Vollständige Anleitung (Englisch)](../../docs/OPENDECK.md)

<a id="suite"></a>
## Fadester for OBS und VJster in einem Plugin

Fadester for OBS ist ein Plugin mit neunzehn Aktionen: zwölf von Fadester und sieben von VJster.

1. **Fadester for OBS einmal installieren**, in Stream Deck oder in OpenDeck (siehe oben).
2. **Die VJster-Aktionen stehen in derselben Liste**, Kategorie *Fadester for OBS*: **VJster Tempo**, **VJster Qualität** und so weiter.
3. **Die Chrome-Erweiterung hinzufügen:** [VJster im Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Sie spricht über Port 48150 mit dem Plugin.

Das war's. Lassen Sie VJster nur in einem Programm laufen: in diesem Plugin, im eigenständigen VJster-Plugin oder in Fadester Companion.

[Vollständige Anleitung (Englisch)](../../docs/SUITE.md)

<a id="profiles"></a>
## Die Fadester-Layoutbibliothek: Datei von Hand importieren

Am einfachsten öffnen Sie ein Layout über **Fertige Layouts** (siehe oben). So importieren Sie eine Datei von Hand:

1. **Die Datei doppelklicken.** Wählen Sie die `.streamDeckProfile`-Datei für Ihr Deck; Stream Deck importiert sie als neues Profil.
2. **OBS verbinden (meist nichts zu tun).** Läuft OBS auf demselben Computer, meldet sich Fadester von selbst an. Sonst: die Einstellungen einer Fadester-Taste öffnen, die Zeile am Fuß der Seite anklicken, **OBS auf einem anderen Computer oder an einem anderen Port** öffnen, Host, Port und Passwort eintragen und **Für alle Steuerungen speichern & testen** drücken.
3. **Die Tasten drücken.** Szenentasten folgen Ihrer Szenenliste in OBS; Musik-, Mikrofon- und Aux-Steuerungen haben Ihre Audioeingänge gefunden.

Das war's.

[Vollständige Anleitung (Englisch)](../../profiles/README.md)
