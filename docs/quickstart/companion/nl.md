*Dit is een vertaling van de Engelse snelstarts, gemaakt met een AI-model en gecontroleerd door een tweede model; er heeft nog geen moedertaalspreker naar gekeken.*

# Snelstart: Fadester Companion en VJster

[Fadester Companion](#companion) · [Gamecontroller](#gamepad) · [VJster](#vjster) · [VJster: installatie](#vjster-install) · [VJster met de TourBox](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: een gamecontroller of een TourBox voor OBS Studio

Met Fadester Companion mix je scènes in OBS Studio op Windows met een Xbox- of andere XInput-gamecontroller, een TourBox van volledige grootte, of allebei. De rechtertrigger van de controller, of de platte Dial van de TourBox, bedient de T-bar van de Studiomodus van OBS.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion in drie stappen: 1, installeren en openen; 2, in OBS de WebSocket-server aanzetten, en het lampje OBS in Fadester Companion wordt groen; 3, de volgende scène in Voorvertoning zetten en aan de rechtertrigger trekken of de Dial van de TourBox draaien: de T-bar van OBS volgt." width="900">

1. **Installeren en openen.** Haal **Fadester Companion** uit de [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) en open het via het Startmenu. (Uit de ZIP: pak alles uit in een map die je bewaart en open **Fadester Companion.exe**.)
2. **Verbinden met OBS.** Open in OBS **Tools → WebSocket-serverinstellingen**, vink **WebSocket-server inschakelen** aan, laat **Authenticatie inschakelen** aan en klik op **OK**. Het lampje **OBS** boven in Fadester Companion wordt groen. Oranje? Klik op de knop ernaast: **Aanzetten** zet de Studiomodus aan, **Laat zien** toont de klikken in OBS.
3. **Kies je controller en fade.** Vink op het tabblad **Instellen** onder **2 Kies je controller** de optie **Een Xbox- of XInput-gamecontroller gebruiken** aan (laat **Eenvoudige modus** aan) en klik linksonder op **Stoppen** en dan **Starten**. Met een TourBox volg je in plaats daarvan [Een TourBox verbinden](../../../tourbox/README.md#connect-a-tourbox) (Engels). Druk de D-pad omlaag (TourBox: draai **Scroll**) om de volgende scène in Voorvertoning te zetten en trek dan aan de rechtertrigger (TourBox: draai de platte **Dial**): de T-bar van OBS volgt, en helemaal doorgetrokken staat Voorvertoning op Programma.

Dat is alles.

[Volledige handleiding (Engels)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Gamecontroller

Bedien OBS met een Xbox-controller (of elke XInput-compatibele pad): de rechtertrigger is een echte T-bar, de knoppen zetten een scène in Voorvertoning en sturen Voorvertoning naar Programma. Het draait in Fadester Companion op Windows.

<img src="../../gamepad/controller-map.svg" alt="De standaardbediening van een XInput-controller: de rechtertrigger is de T-bar, A stuurt Voorvertoning naar Programma, B maakt een cut, D-pad omhoog en omlaag zet de scène erboven of eronder in Voorvertoning, links en rechts regelen de muziek, de linkertrigger dempt de muziek, View breekt een handmatige fade af en Menu zet de Programma-scène in Voorvertoning." width="900">

1. **Aansluiten en de OBS-verbinding aanzetten.** Sluit de controller aan (USB of Xbox Wireless; Windows heeft geen extra driver nodig). Open in OBS **Tools → WebSocket-serverinstellingen**, vink **WebSocket-server inschakelen** aan, laat **Authenticatie inschakelen** aangevinkt en klik op **OK**.
2. **Open Fadester Companion** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), daarna het Startmenu; [installatiegids (Engels)](../../../tourbox/README.md)). Het lampje **OBS** bovenaan wordt groen (oranje: klik op **Laat zien** ernaast). Zegt het lampje **Controller** dat hij aangesloten maar niet in gebruik is, klik dan op **Gebruiken**. Anders vink je op het tabblad **Instellen** onder **2 Kies je controller** de optie **Een Xbox- of XInput-gamecontroller gebruiken** aan, laat je **Eenvoudige modus** aangevinkt en klik je op **Starten** als het lampje **Bediening** niet groen is.
3. **Fade.** Zet in OBS 33 de **Studiomodus** aan, kies de overgang **Vervagen** (Fade) en druk de D-pad omlaag om de volgende scène in Voorvertoning te zetten. Trek de rechtertrigger half door: de T-bar van OBS volgt. Loslaten: hij gaat terug. Helemaal doortrekken: Voorvertoning gaat naar Programma.

Dat is alles. De lampjes bovenaan tonen *Controller: verbonden* en *Bediening: aan*.

[Volledige handleiding (Engels)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** regelt het tempo van een YouTube-video vanaf je Stream Deck: draai aan een draaiknop en de video gaat sneller of langzamer terwijl hij speelt; een toets zet 0.5x, 1x of 2x. Het werkt in een Chrome-tabblad, in een OBS-browserbron of in allebei; er gaat niets van deze computer af.

<img src="../../vjster/install-steps.svg" alt="VJster in drie stappen: 1, zorg voor de toetsen (Fadester for OBS in Stream Deck, of Fadester Companion); 2, voeg de VJster-extensie toe uit de Chrome Web Store; 3, speel een YouTube-video af en draai aan de draaiknop: het tempo volgt." width="900">

1. **Zorg voor de toetsen.** Heb je **Fadester for OBS 0.9.0 of nieuwer**? Dan heb je de zeven VJster-acties al: sla deze stap over. Dubbelklik anders op `com.jbrick2070.vjster.streamDeckPlugin` en accepteer de meegeleverde profielen (**VJster Live +** en **VJster Dual +** voor Stream Deck +, **VJster Live** voor 15 toetsen, **VJster Mini**).
2. **Voeg de Chrome-extensie toe.** Voeg [VJster uit de Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) toe. De optiepagina gaat één keer open.
3. **Probeer het.** Sleep **VJster Speed** op een draaiknop of **VJster Speed Preset** op een toets (Stream Deck toont de actienamen in het Engels; in de VJster-plugin heten ze **Speed** en **Speed Preset**, of schakel over naar een VJster-profiel). Speel een YouTube-video af in Chrome. Binnen een paar seconden laat de strook TEMPO (SPEED in het Engels) of de toets 1x zien dat hij speelt. Draai aan de draaiknop.

Dat is alles. Staat er **EXTENSIE UIT** (EXTENSION OFF in het Engels) op de strook, zie dan *When something is off* in [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) (Engels).

[Volledige handleiding (Engels)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: installatie

Met VJster verandert je Stream Deck, TourBox of gamecontroller het tempo en de kwaliteit van een YouTube-video in Chrome.

<img src="../../vjster/install-steps.svg" alt="VJster in drie stappen: 1, zorg voor de toetsen (Fadester for OBS in Stream Deck, of Fadester Companion); 2, voeg de VJster-extensie toe uit de Chrome Web Store; 3, speel een YouTube-video af en draai aan de draaiknop: het tempo volgt." width="900">

1. **Zorg voor de toetsen.** Installeer [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) in Stream Deck: de actielijst heeft de zeven **VJster**-acties al. (Gebruik je een TourBox of een gamecontroller? Installeer [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) en start de bediening.)
2. **Voeg de Chrome-extensie toe.** Voeg [VJster uit de Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) toe (Chrome 116 of nieuwer).
3. **Probeer het.** Zet **VJster Speed** op een toets of draaiknop en speel een YouTube-video af in Chrome. Binnen een paar seconden toont de toets de spelende video; draai aan de draaiknop en de video volgt. Een tabblad dat al open was: één keer herladen.

Dat is alles. OBS hoeft niet open te zijn.

[Volledige handleiding (Engels)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## VJster met de TourBox

De ene VJster-extensie voor Chrome werkt vanaf Stream Deck, OpenDeck en de TourBox. Met een TourBox host Fadester Companion zelf de verbinding met de extensie.

1. **Richt de TourBox in.** Installeer Fadester Companion en importeer de preset: [Een TourBox verbinden](../../../tourbox/README.md#connect-a-tourbox) (Engels).
2. **Voeg de Chrome-extensie toe.** Voeg [VJster uit de Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) toe en speel een YouTube-video af in Chrome.
3. **Draai aan de verhoogde Knob.** Het tempo van de video volgt. Tik op **Side** voor 1x.

Dat is alles. OBS mag dicht zijn.

[Volledige handleiding (Engels)](../../vjster/TOURBOX.md)
