*Ceci est une traduction des prises en main anglaises, faite avec un modèle d’IA et vérifiée par un second modèle ; aucun locuteur natif ne l’a encore relue.*

# Prise en main : Fadester Companion et VJster

[Fadester Companion](#companion) · [Manette de jeu](#gamepad) · [VJster](#vjster) · [VJster : installation](#vjster-install) · [VJster avec la TourBox](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion : une manette de jeu ou une TourBox pour OBS Studio

Fadester Companion vous permet de mixer les scènes d’OBS Studio sous Windows avec une manette Xbox ou une autre manette XInput, une TourBox grand format, ou les deux. La gâchette droite de la manette, ou le Dial plat de la TourBox, pilote le T-bar du Mode studio d’OBS.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion en trois étapes : 1, l’installer et l’ouvrir ; 2, dans OBS, activer le serveur WebSocket, et le voyant OBS de Fadester Companion passe au vert ; 3, préparer la scène suivante dans l’aperçu puis tirer la gâchette droite ou tourner le Dial de la TourBox : le T-bar d’OBS suit." width="900">

1. **Installez et ouvrez.** Obtenez **Fadester Companion** sur le [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) et ouvrez-le depuis le menu Démarrer. (Depuis le ZIP : extrayez tout dans un dossier que vous gardez et ouvrez **Fadester Companion.exe**.)
2. **Reliez-le à OBS.** Dans OBS, ouvrez **Outils → Paramètres du serveur WebSocket**, cochez **Activer le serveur WebSocket**, laissez **Activer l’authentification** coché et cliquez sur **OK**. Le voyant **OBS** en haut de Fadester Companion passe au vert. Orange ? Cliquez sur le bouton à côté : **Activer** active le Mode studio, **Montrez-moi** montre les clics dans OBS.
3. **Choisissez votre manette et faites le fondu.** Dans l’onglet **Configuration**, sous **2 Choisir un contrôleur**, cochez **Utiliser une manette Xbox ou XInput** (laissez **Mode facile**), puis cliquez sur **Arrêter** et **Démarrer**, en bas à gauche. Avec une TourBox, suivez plutôt [Connecter une TourBox](../../../tourbox/README.md#connect-a-tourbox) (en anglais). Appuyez sur le bas du pavé directionnel (TourBox : tournez **Scroll**) pour préparer la scène suivante dans l’aperçu, puis tirez la gâchette droite (TourBox : tournez le **Dial** plat) : le T-bar d’OBS suit, et une fois au bout, l’aperçu passe au programme.

C’est tout.

[Guide complet (en anglais)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Manette de jeu

Pilotez OBS avec une manette Xbox (ou toute manette compatible XInput) : la gâchette droite est un vrai T-bar, les boutons préparent une scène dans l’aperçu et envoient l’aperçu au programme. Cela fonctionne dans Fadester Companion sous Windows.

<img src="../../gamepad/controller-map.svg" alt="Les commandes par défaut d’une manette XInput : la gâchette droite est le T-bar, A envoie l’aperçu au programme, B coupe, haut et bas du pavé directionnel mettent la scène précédente ou suivante dans l’aperçu, gauche et droite règlent la musique, la gâchette gauche baisse la musique, View annule un fondu manuel et Menu met la scène du programme dans l’aperçu." width="900">

1. **Branchez la manette et autorisez la connexion d’OBS.** Branchez la manette (USB ou Xbox Wireless ; Windows n’a besoin d’aucun autre pilote). Dans OBS, ouvrez **Outils → Paramètres du serveur WebSocket**, cochez **Activer le serveur WebSocket**, laissez **Activer l’authentification** coché et cliquez sur **OK**.
2. **Ouvrez Fadester Companion** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), puis le menu Démarrer ; [guide de configuration (en anglais)](../../../tourbox/README.md)). Le voyant **OBS** en haut passe au vert (orange : cliquez sur **Montrez-moi** à côté). Si le voyant **Manette** indique qu’elle est branchée mais non utilisée, cliquez sur **L’utiliser**. Sinon, dans l’onglet **Configuration**, sous **2 Choisir un contrôleur**, cochez **Utiliser une manette Xbox ou XInput**, laissez **Mode facile** coché et cliquez sur **Démarrer** si le voyant **Commandes** n’est pas vert.
3. **Faites le fondu.** Dans OBS 33, activez le **Mode studio**, choisissez la transition **Fondu** (Fade) et appuyez sur le bas du pavé directionnel pour préparer la scène suivante dans l’aperçu. Tirez la gâchette droite à moitié : le T-bar d’OBS suit. Relâchez : il revient. Tirez jusqu’au bout : l’aperçu passe au programme.

C’est tout. Les voyants en haut affichent *Manette : connectée* et *Commandes : actives*.

[Guide complet (en anglais)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** règle la vitesse d’une vidéo YouTube depuis votre Stream Deck : tournez une molette et la vidéo accélère ou ralentit pendant la lecture ; une touche met 0.5x, 1x ou 2x. Cela fonctionne dans un onglet Chrome, dans une source navigateur d’OBS, ou les deux ; rien ne quitte cet ordinateur.

<img src="../../vjster/install-steps.svg" alt="VJster en trois étapes : 1, obtenir les touches (Fadester for OBS dans Stream Deck, ou Fadester Companion) ; 2, ajouter l’extension VJster depuis le Chrome Web Store ; 3, lire une vidéo YouTube et tourner la molette : la vitesse suit." width="900">

1. **Obtenez les touches.** Vous avez **Fadester for OBS 0.9.0 ou plus récent** ? Il contient déjà les sept actions VJster : passez cette étape. Sinon, double-cliquez sur `com.jbrick2070.vjster.streamDeckPlugin` et acceptez les profils fournis (**VJster Live +** et **VJster Dual +** pour Stream Deck +, **VJster Live** pour 15 touches, **VJster Mini**).
2. **Ajoutez l’extension Chrome.** Ajoutez [VJster depuis le Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Sa page d’options s’ouvre une fois.
3. **Essayez.** Glissez **VJster Vitesse** sur une molette ou **VJster Vitesse fixe** sur une touche (dans le plugin VJster : **Vitesse** et **Vitesse fixe**, ou passez à un profil VJster). Lisez une vidéo YouTube dans Chrome. En quelques secondes, la bande VITESSE (ou la touche 1x) montre la lecture. Tournez la molette.

C’est tout. Si la bande affiche **EXTENSION INACTIVE**, voyez *When something is off* dans [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) (en anglais).

[Guide complet (en anglais)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster : installation

VJster permet à votre Stream Deck, votre TourBox ou votre manette de jeu de changer la vitesse et la qualité d’une vidéo YouTube dans Chrome.

<img src="../../vjster/install-steps.svg" alt="VJster en trois étapes : 1, obtenir les touches (Fadester for OBS dans Stream Deck, ou Fadester Companion) ; 2, ajouter l’extension VJster depuis le Chrome Web Store ; 3, lire une vidéo YouTube et tourner la molette : la vitesse suit." width="900">

1. **Obtenez les touches.** Installez [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) dans Stream Deck : sa liste d’actions contient déjà les sept actions **VJster**. (Une TourBox ou une manette ? Installez [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) et démarrez ses commandes.)
2. **Ajoutez l’extension Chrome.** Ajoutez [VJster depuis le Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) (Chrome 116 ou plus récent).
3. **Essayez.** Placez **VJster Vitesse** sur une touche ou une molette et lisez une vidéo YouTube dans Chrome. En quelques secondes, la touche montre la vidéo en lecture ; tournez la molette et la vidéo suit. Un onglet déjà ouvert : rechargez-le une fois.

C’est tout. OBS n’a pas besoin d’être ouvert.

[Guide complet (en anglais)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## VJster avec la TourBox

L’unique extension Chrome VJster fonctionne depuis Stream Deck, OpenDeck et la TourBox. Avec une TourBox, Fadester Companion héberge lui-même la liaison de l’extension.

1. **Configurez la TourBox.** Installez Fadester Companion et importez son préréglage : [Connecter une TourBox](../../../tourbox/README.md#connect-a-tourbox) (en anglais).
2. **Ajoutez l’extension Chrome.** Ajoutez [VJster depuis le Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) et lisez une vidéo YouTube dans Chrome.
3. **Tournez le Knob en relief.** La vitesse de la vidéo suit. Appuyez brièvement sur **Side** pour revenir à 1x.

C’est tout. OBS peut rester fermé.

[Guide complet (en anglais)](../../vjster/TOURBOX.md)
