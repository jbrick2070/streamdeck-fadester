# Fadester for OBS : démarrages rapides

*Ceci est une traduction des démarrages rapides anglais, réalisée avec un modèle d’IA et vérifiée par un second modèle d’IA ; aucun locuteur natif ne l’a encore relue.*

[Fadester for OBS](#fadester-for-obs) · [Commencez ici](#start-here) · [Dispositions prêtes](#layouts) · [OpenDeck](#opendeck) · [Un plugin avec VJster](#suite) · [Fichiers de disposition à la main](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS met OBS Studio sur votre Stream Deck : scènes, transitions, sources, filtres et audio sur des touches et des molettes.

<img src="../../docs/images/first-key-steps.svg" alt="La première touche en trois étapes : 1, double-cliquez sur le fichier .streamDeckPlugin et installez-le ; 2, dans OBS, Outils → Paramètres du serveur WebSocket, activez le serveur ; 3, faites glisser Scène sur une touche dans Stream Deck et appuyez : OBS passe à la scène suivante." width="900">

1. **Installez le plugin.** Sur la [page des versions](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), téléchargez le fichier qui se termine par `.streamDeckPlugin` et double-cliquez dessus. Confirmez l’installation dans Stream Deck.
2. **Activez le serveur WebSocket d’OBS.** Dans OBS : **Outils → Paramètres du serveur WebSocket**, activez le serveur, cliquez sur **OK**. Laissez l’authentification telle quelle : il n’y a rien à copier.
3. **Faites glisser Scène sur une touche.** Dans la liste des actions de Stream Deck, catégorie *Fadester for OBS*, faites glisser **Scène** sur une touche. Elle commence en **Scène suivante** : appuyez, et OBS passe à la scène suivante.

C’est tout. Avec OBS sur le même ordinateur, le plugin se connecte tout seul. Tant qu’OBS n’est pas connecté, la touche indique quoi faire, par exemple **Activer WebSocket OBS** ou **Lancez OBS**.

[Guide complet (en anglais)](../../README.md)

<a id="start-here"></a>
## Fadester Suite : commencez ici

Quelles parties de la Fadester Suite installer pour votre matériel, et comment configurer OBS une fois. La plupart des gens ont un Stream Deck :

<img src="../../docs/images/first-key-steps.svg" alt="La première touche en trois étapes : installer le plugin, activer le serveur WebSocket dans OBS, faire glisser Scène sur une touche." width="900">

1. **Installez Fadester for OBS.** Téléchargez le fichier `.streamDeckPlugin` sur la [page des versions](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), double-cliquez dessus et installez-le dans Stream Deck.
2. **Activez le serveur WebSocket d’OBS.** Dans OBS Studio 33 : **Outils → Paramètres du serveur WebSocket**, activez le serveur, **OK**. Le plugin lit le port et le mot de passe enregistrés par OBS.
3. **Faites glisser Scène sur une touche** et appuyez : OBS passe à la scène suivante. Pour remplir le deck, cliquez sur la touche, puis sur la ligne au bas de sa page de réglages, et ouvrez **Dispositions prêtes à l’emploi**.

C’est tout. Un autre contrôleur, ou d’autres éléments ? Le tableau est dans le guide complet.

[Guide complet (en anglais)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS : dispositions prêtes à l’emploi

Quatorze dispositions pour le Stream Deck +, le Stream Deck 15 touches et le Stream Deck Mini. Chacune s’ouvre comme un profil que vous pouvez modifier.

<img src="../../docs/images/open-layout-steps.svg" alt="Une disposition prête en trois étapes : 1, cliquez sur une touche Fadester for OBS ; 2, cliquez sur la ligne au bas de la page, puis Dispositions prêtes à l’emploi ; 3, choisissez-en une et cliquez sur Ouvrir cette disposition." width="900">

1. **Cliquez sur une touche Fadester for OBS** dans Stream Deck : ses réglages s’ouvrent.
2. **Cliquez sur la ligne au bas de la page** (elle affiche la version et la connexion) et ouvrez **Dispositions prêtes à l’emploi**.
3. **Choisissez une disposition et cliquez sur Ouvrir cette disposition.** Votre deck passe dessus.

C’est tout. Avec OBS sur le même ordinateur et son serveur WebSocket activé, le plugin se connecte tout seul ; toutes les dispositions utilisent cette connexion.

[Guide complet (en anglais)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## Fadester for OBS et VJster avec OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) est un programme libre et open source qui fait tourner les plugins Stream Deck sans le logiciel Stream Deck d’Elgato. Fadester for OBS y fonctionne tel quel.

<img src="../../docs/images/opendeck-steps.svg" alt="Fadester for OBS dans OpenDeck en trois étapes : 1, lancez OpenDeck, deck branché, logiciel Stream Deck fermé ; 2, installez Fadester for OBS depuis le gestionnaire de plugins ; 3, choisissez la disposition dans la liste des profils sous le nom du deck." width="900">

1. **Lancez OpenDeck.** Branchez le deck, fermez le logiciel Stream Deck et lancez [OpenDeck](https://github.com/nekename/OpenDeck/releases). Ce plugin demande [Node.js](https://nodejs.org/) 24 ou plus récent.
2. **Installez Fadester.** Dans le gestionnaire de plugins d’OpenDeck, installez **Fadester for OBS** s’il est listé, ou utilisez son bouton d’installation depuis un fichier avec le [téléchargement de Fadester](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin).
3. **Choisissez votre disposition** dans la liste des profils sous le nom du deck : **Scene Desk + (Regular Mode)** pour le Plus, **Scene Desk 15 Keys (Regular Mode)** pour 15 touches, **Source Desk Mini (Either Mode)** pour le Mini. Sur d’autres modèles, faites glisser **Scène** sur une touche.

C’est tout, une fois le serveur WebSocket d’OBS activé (**Outils → Paramètres du serveur WebSocket**). Avec OBS sur le même ordinateur, Fadester se connecte avec le mot de passe enregistré.

[Guide complet (en anglais)](../../docs/OPENDECK.md)

<a id="suite"></a>
## Fadester for OBS et VJster dans un seul plugin

Fadester for OBS est un plugin à dix-neuf actions : douze de Fadester et sept de VJster.

1. **Installez Fadester for OBS une fois**, dans Stream Deck ou dans OpenDeck (voir plus haut).
2. **Les actions VJster sont dans la même liste**, catégorie *Fadester for OBS* : **VJster Vitesse**, **VJster Qualité**, etc.
3. **Ajoutez l’extension Chrome :** [VJster sur le Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Elle parle au plugin sur le port 48150.

C’est tout. Ne faites tourner VJster que dans un seul programme : ce plugin, le plugin VJster autonome ou Fadester Companion.

[Guide complet (en anglais)](../../docs/SUITE.md)

<a id="profiles"></a>
## La bibliothèque de dispositions Fadester : importer un fichier à la main

Le plus simple est d’ouvrir une disposition depuis **Dispositions prêtes à l’emploi** (voir plus haut). Pour importer un fichier à la main :

1. **Double-cliquez sur le fichier.** Choisissez le `.streamDeckProfile` de votre deck ; Stream Deck l’importe comme nouveau profil.
2. **Connectez OBS (en général, rien à faire).** Avec OBS sur le même ordinateur, Fadester se connecte tout seul. Sinon, ouvrez les réglages d’une touche Fadester, cliquez sur la ligne au bas de la page, ouvrez **OBS sur un autre ordinateur, ou sur un autre port**, saisissez l’hôte, le port et le mot de passe et cliquez sur **Enregistrer pour tous les contrôles et tester**.
3. **Appuyez sur les touches.** Les touches de scène suivent votre liste de scènes OBS ; les contrôles musique, micro et Aux ont trouvé vos entrées audio.

C’est tout.

[Guide complet (en anglais)](../../profiles/README.md)
