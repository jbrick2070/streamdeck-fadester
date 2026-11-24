*Dies ist eine Übersetzung der englischen Schnellstarts, erstellt mit einem KI-Modell und von einem zweiten Modell geprüft; Muttersprachler haben sie noch nicht geprüft.*

# Schnellstart: Fadester Companion und VJster

[Fadester Companion](#companion) · [Gamecontroller](#gamepad) · [VJster](#vjster) · [VJster: Installation](#vjster-install) · [VJster mit der TourBox](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: ein Gamecontroller oder eine TourBox für OBS Studio

Mit Fadester Companion mischen Sie Szenen in OBS Studio unter Windows mit einem Xbox- oder anderen XInput-Controller, einer TourBox in voller Größe oder beidem. Der rechte Trigger des Controllers oder das flache Dial der TourBox bewegt den T-Bar des OBS-Studiomodus.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion in drei Schritten: 1, installieren und öffnen; 2, in OBS den WebSocket-Server einschalten, die Lampe OBS in Fadester Companion wird grün; 3, die nächste Szene in die Vorschau holen und den rechten Trigger ziehen oder das Dial der TourBox drehen: der T-Bar von OBS folgt." width="900">

1. **Installieren und öffnen.** Holen Sie **Fadester Companion** aus dem [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) und öffnen Sie es über das Startmenü. (Aus dem ZIP: alles in einen dauerhaften Ordner entpacken und **Fadester Companion.exe** öffnen.)
2. **Mit OBS verbinden.** Öffnen Sie in OBS **Werkzeuge → WebSocket-Servereinstellungen**, aktivieren Sie **WebSocket-Server aktivieren**, lassen Sie **Authentifizierung aktivieren** an und klicken Sie auf **OK**. Die Lampe **OBS** oben in Fadester Companion wird grün. Gelb? Klicken Sie auf die Schaltfläche daneben: **Einschalten** schaltet den Studiomodus ein, **So geht’s** zeigt die Klicks in OBS.
3. **Controller wählen und überblenden.** Aktivieren Sie auf der Registerkarte **Einrichtung** unter **2 Controller wählen** die Option **Einen Xbox- oder XInput-Controller verwenden** (lassen Sie **Einfacher Modus** an) und klicken Sie unten links auf **Stoppen** und dann **Starten**. Mit einer TourBox folgen Sie stattdessen [TourBox verbinden](../../../tourbox/README.md#connect-a-tourbox) (Englisch). Drücken Sie das Steuerkreuz nach unten (TourBox: **Scroll** drehen), um die nächste Szene in die Vorschau zu holen, und ziehen Sie dann den rechten Trigger (TourBox: das flache **Dial** drehen): Der T-Bar von OBS folgt, und ganz durchgezogen ist die Vorschau im Programm.

Das war's.

[Vollständige Anleitung (Englisch)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Gamecontroller

Steuern Sie OBS mit einem Xbox-Controller (oder jedem XInput-kompatiblen Pad): Der rechte Trigger ist ein echter T-Bar, die Tasten holen eine Szene in die Vorschau und schicken die Vorschau ins Programm. Das läuft in Fadester Companion unter Windows.

<img src="../../gamepad/controller-map.svg" alt="Die Standardbelegung eines XInput-Controllers: rechter Trigger ist der T-Bar, A schickt die Vorschau ins Programm, B schneidet hart, Steuerkreuz hoch und runter holt die Szene darüber oder darunter in die Vorschau, Steuerkreuz links und rechts regelt die Musik, der linke Trigger senkt die Musik ab, View bricht eine manuelle Überblendung ab und Menu setzt die Vorschau auf die Programmszene." width="900">

1. **Anschließen und OBS freigeben.** Schließen Sie den Controller an (USB oder Xbox Wireless; Windows braucht keinen weiteren Treiber). Öffnen Sie in OBS **Werkzeuge → WebSocket-Servereinstellungen**, aktivieren Sie **WebSocket-Server aktivieren**, lassen Sie **Authentifizierung aktivieren** an und klicken Sie auf **OK**.
2. **Fadester Companion öffnen** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), dann Startmenü; [Einrichtungsanleitung (Englisch)](../../../tourbox/README.md)). Die Lampe **OBS** oben wird grün (gelb: daneben auf **So geht’s** klicken). Meldet die Lampe **Controller**, dass er angeschlossen, aber nicht aktiv ist, klicken Sie auf **Verwenden**. Sonst aktivieren Sie auf der Registerkarte **Einrichtung** unter **2 Controller wählen** die Option **Einen Xbox- oder XInput-Controller verwenden**, lassen **Einfacher Modus** an und klicken auf **Starten**, wenn die Lampe **Steuerung** nicht grün ist.
3. **Überblenden.** Schalten Sie in OBS 33 den **Studiomodus** ein, wählen Sie den Übergang **Überblenden** (Fade) und drücken Sie das Steuerkreuz nach unten, um die nächste Szene in die Vorschau zu holen. Ziehen Sie den rechten Trigger halb: Der T-Bar von OBS folgt. Loslassen: Er geht zurück. Ganz durchziehen: Die Vorschau geht ins Programm.

Das war's. Die Lampen oben zeigen *Controller: verbunden* und *Steuerung: ein*.

[Vollständige Anleitung (Englisch)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** regelt das Tempo eines YouTube-Videos von Ihrem Stream Deck aus: Drehen Sie einen Drehregler, und das Video wird schneller oder langsamer, während es läuft; eine Taste setzt 0.5x, 1x oder 2x. Es funktioniert in einem Chrome-Tab, in einer OBS-Browserquelle oder in beiden; nichts verlässt diesen Computer.

<img src="../../vjster/install-steps.svg" alt="VJster in drei Schritten: 1, die Tasten holen (Fadester for OBS in Stream Deck oder Fadester Companion); 2, die VJster-Erweiterung aus dem Chrome Web Store hinzufügen; 3, ein YouTube-Video abspielen und den Drehregler drehen: das Tempo folgt." width="900">

1. **Die Tasten holen.** Sie haben **Fadester for OBS 0.9.0 oder neuer**? Dann sind die sieben VJster-Aktionen schon da: Überspringen Sie diesen Schritt. Sonst doppelklicken Sie auf `com.jbrick2070.vjster.streamDeckPlugin` und bestätigen die mitgelieferten Profile (**VJster Live +** und **VJster Dual +** für Stream Deck +, **VJster Live** für 15 Tasten, **VJster Mini**).
2. **Die Chrome-Erweiterung hinzufügen.** Fügen Sie [VJster aus dem Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) hinzu. Ihre Optionsseite öffnet sich einmal.
3. **Ausprobieren.** Ziehen Sie **VJster Tempo** auf einen Drehregler oder **VJster Tempo-Vorgabe** auf eine Taste (im VJster-Plugin heißen sie **Tempo** und **Tempo-Vorgabe**, oder wechseln Sie zu einem VJster-Profil). Spielen Sie ein YouTube-Video in Chrome ab. Nach wenigen Sekunden zeigt der Streifen TEMPO (oder die Taste 1x), dass es läuft. Drehen Sie den Drehregler.

Das war's. Steht auf dem Streifen **ERWEITERUNG AUS**, lesen Sie *When something is off* in [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) (Englisch).

[Vollständige Anleitung (Englisch)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: Installation

Mit VJster ändern Ihr Stream Deck, Ihre TourBox oder Ihr Gamecontroller Tempo und Qualität eines YouTube-Videos in Chrome.

<img src="../../vjster/install-steps.svg" alt="VJster in drei Schritten: 1, die Tasten holen (Fadester for OBS in Stream Deck oder Fadester Companion); 2, die VJster-Erweiterung aus dem Chrome Web Store hinzufügen; 3, ein YouTube-Video abspielen und den Drehregler drehen: das Tempo folgt." width="900">

1. **Die Tasten holen.** Installieren Sie [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) in Stream Deck: Seine Aktionsliste enthält bereits die sieben **VJster**-Aktionen. (Mit TourBox oder Gamecontroller? Installieren Sie [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) und starten Sie die Steuerung.)
2. **Die Chrome-Erweiterung hinzufügen.** Fügen Sie [VJster aus dem Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) hinzu (Chrome 116 oder neuer).
3. **Ausprobieren.** Legen Sie **VJster Tempo** auf eine Taste oder einen Drehregler und spielen Sie ein YouTube-Video in Chrome ab. Nach wenigen Sekunden zeigt die Taste das laufende Video; drehen Sie den Drehregler, und das Video folgt. Einen bereits offenen Tab laden Sie einmal neu.

Das war's. OBS muss nicht geöffnet sein.

[Vollständige Anleitung (Englisch)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## VJster mit der TourBox

Die eine VJster-Chrome-Erweiterung funktioniert mit Stream Deck, OpenDeck und der TourBox. Mit einer TourBox stellt Fadester Companion die Verbindung zur Erweiterung selbst bereit.

1. **Die TourBox einrichten.** Installieren Sie Fadester Companion und importieren Sie sein Preset: [TourBox verbinden](../../../tourbox/README.md#connect-a-tourbox) (Englisch).
2. **Die Chrome-Erweiterung hinzufügen.** Fügen Sie [VJster aus dem Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) hinzu und spielen Sie ein YouTube-Video in Chrome ab.
3. **Den erhöhten Knob drehen.** Das Tempo des Videos folgt. Tippen Sie auf **Side** für 1x.

Das war's. OBS darf geschlossen sein.

[Vollständige Anleitung (Englisch)](../../vjster/TOURBOX.md)
