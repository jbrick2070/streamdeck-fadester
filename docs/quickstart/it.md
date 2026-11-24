# Fadester for OBS: guide rapide

*Questa è una traduzione delle guide rapide inglesi, fatta con un modello di IA e controllata da un secondo modello di IA; nessun madrelingua l’ha ancora rivista.*

[Fadester for OBS](#fadester-for-obs) · [Inizia da qui](#start-here) · [Layout pronti](#layouts) · [OpenDeck](#opendeck) · [Un plugin con VJster](#suite) · [File di layout a mano](#profiles)

Stream Deck non è in italiano: la sua lista delle azioni mostra i nomi inglesi (per esempio **Scene**). Tasti e pagine delle impostazioni di Fadester for OBS sono in italiano quando scegli l’italiano in **Lingua**.

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS porta OBS Studio sul tuo Stream Deck: scene, transizioni, fonti, filtri e audio su tasti e manopole.

<img src="../../docs/images/first-key-steps.svg" alt="Il primo tasto in tre passi: 1, fai doppio clic sul file .streamDeckPlugin e installalo; 2, in OBS, Strumenti → Impostazioni del server WebSocket, abilita il server; 3, trascina Scene su un tasto in Stream Deck e premilo: OBS passa alla scena successiva." width="900">

1. **Installa il plugin.** Nella [pagina delle versioni](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), scarica il file che finisce con `.streamDeckPlugin` e fai doppio clic. Conferma l’installazione in Stream Deck.
2. **Attiva il server WebSocket di OBS.** In OBS: **Strumenti → Impostazioni del server WebSocket**, abilita il server, premi **OK**. Lascia l’autenticazione com’è: non c’è niente da copiare.
3. **Trascina Scene su un tasto.** Nella lista delle azioni di Stream Deck, categoria *Fadester for OBS*, trascina **Scene** su un tasto. Parte come **Scena successiva**: premilo e OBS passa alla scena successiva.

Fatto. Con OBS sullo stesso computer, il plugin si collega da solo. Finché OBS non è collegato, il tasto dice cosa fare, per esempio **Attiva WebSocket OBS** o **Avvia OBS**.

[Guida completa (in inglese)](../../README.md)

<a id="start-here"></a>
## Fadester Suite: inizia da qui

Quali parti della Fadester Suite installare per il tuo hardware, e come configurare OBS una volta. Quasi tutti usano uno Stream Deck:

<img src="../../docs/images/first-key-steps.svg" alt="Il primo tasto in tre passi: installa il plugin, attiva il server WebSocket in OBS, trascina Scene su un tasto." width="900">

1. **Installa Fadester for OBS.** Scarica il file `.streamDeckPlugin` dalla [pagina delle versioni](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), fai doppio clic e installalo in Stream Deck.
2. **Attiva il server WebSocket di OBS.** In OBS Studio 33: **Strumenti → Impostazioni del server WebSocket**, abilita il server, **OK**. Il plugin legge la porta e la password salvate da OBS.
3. **Trascina Scene su un tasto** e premilo: OBS passa alla scena successiva. Per riempire il deck, fai clic sul tasto, poi sulla riga in fondo alla sua pagina delle impostazioni, e apri **Layout pronti**.

Fatto. Un altro controller, o altre parti? La tabella è nella guida completa.

[Guida completa (in inglese)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS: layout pronti

Quattordici layout per Stream Deck +, lo Stream Deck a 15 tasti e Stream Deck Mini. Ognuno si apre come un profilo che puoi modificare.

<img src="../../docs/images/open-layout-steps.svg" alt="Un layout pronto in tre passi: 1, fai clic su un tasto di Fadester for OBS; 2, fai clic sulla riga in fondo alla pagina, poi su Layout pronti; 3, scegline uno e premi Apri questo layout." width="900">

1. **Fai clic su un tasto di Fadester for OBS** in Stream Deck: si aprono le sue impostazioni.
2. **Fai clic sulla riga in fondo alla pagina** (mostra la versione e la connessione) e apri **Layout pronti**.
3. **Scegli un layout e premi Apri questo layout.** Il tuo deck passa a quel layout.

Fatto. Con OBS sullo stesso computer e il server WebSocket attivo, il plugin si collega da solo; tutti i layout usano quella connessione.

[Guida completa (in inglese)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## Fadester for OBS e VJster con OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) è un programma libero e open source che fa funzionare i plugin per Stream Deck senza il software Stream Deck di Elgato. Fadester for OBS ci funziona così com’è.

<img src="../../docs/images/opendeck-steps.svg" alt="Fadester for OBS in OpenDeck in tre passi: 1, avvia OpenDeck con il deck collegato e il software Stream Deck chiuso; 2, installa Fadester for OBS dal gestore dei plugin; 3, scegli il layout nella lista dei profili sotto il nome del deck." width="900">

1. **Avvia OpenDeck.** Collega il deck, chiudi il software Stream Deck e avvia [OpenDeck](https://github.com/nekename/OpenDeck/releases). Per questo plugin serve [Node.js](https://nodejs.org/) 24 o successivo.
2. **Installa Fadester.** Nel gestore dei plugin di OpenDeck, installa **Fadester for OBS** se è in elenco, oppure usa il suo pulsante di installazione da file con il [download di Fadester](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin).
3. **Scegli il layout** nella lista dei profili sotto il nome del deck: **Scene Desk + (Regular Mode)** per il Plus, **Scene Desk 15 Keys (Regular Mode)** per 15 tasti, **Source Desk Mini (Either Mode)** per il Mini. Su altri modelli, trascina **Scene** su un tasto.

Fatto, una volta attivo il server WebSocket di OBS (**Strumenti → Impostazioni del server WebSocket**). Con OBS sullo stesso computer, Fadester si collega con la password salvata.

[Guida completa (in inglese)](../../docs/OPENDECK.md)

<a id="suite"></a>
## Fadester for OBS e VJster in un solo plugin

Fadester for OBS è un plugin con diciannove azioni: dodici di Fadester e sette di VJster.

1. **Installa Fadester for OBS una volta**, in Stream Deck o in OpenDeck (vedi sopra).
2. **Le azioni di VJster sono nella stessa lista**, categoria *Fadester for OBS*: **VJster Speed**, **VJster Quality** e così via.
3. **Aggiungi l’estensione per Chrome:** [VJster nel Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Parla con il plugin sulla porta 48150.

Fatto. Tieni VJster attivo in un solo programma: questo plugin, il plugin VJster separato o Fadester Companion.

[Guida completa (in inglese)](../../docs/SUITE.md)

<a id="profiles"></a>
## La libreria di layout di Fadester: importare un file a mano

Il modo più facile è aprire un layout da **Layout pronti** (vedi sopra). Per importare un file a mano:

1. **Fai doppio clic sul file.** Scegli il `.streamDeckProfile` per il tuo deck; Stream Deck lo importa come nuovo profilo.
2. **Collega OBS (di solito non c’è niente da fare).** Con OBS sullo stesso computer, Fadester si collega da solo. Altrimenti apri le impostazioni di un tasto di Fadester, fai clic sulla riga in fondo alla pagina, apri **OBS su un altro computer, o un'altra porta**, inserisci host, porta e password e premi **Salva per tutti i controlli e prova**.
3. **Premi i tasti.** I tasti delle scene seguono la tua lista di scene di OBS; i controlli di musica, microfono e Aux hanno trovato i tuoi ingressi audio.

Fatto.

[Guida completa (in inglese)](../../profiles/README.md)
