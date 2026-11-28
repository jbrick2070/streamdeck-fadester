# Fadester Companion: Store listings in twelve more languages

The same listing as [LISTING.md](LISTING.md), for version 1.5.2. In Partner Center, in the submission, add each language under Store listings → Add/remove languages (Additional Store listing languages), and paste its blocks. Reuse the English screenshots and images from `listing/`. Copyright, license terms and "Developed by" stay as in [LISTING.md](LISTING.md). Product features are one per box; keywords are seven, entered one at a time.

Who has read these texts: a model wrote them, and a second model (Antigravity) read all twelve against the English and against the app's own window texts (`tourbox/panel/PanelText.cs`, `PanelExtraText.cs`) on 21 November 2026, in three rounds, until it had nothing left to report. Its corrections are in. The What's new lines for 1.5.2 were written on 27 November 2026, from the changelog and the window's own words (`PanelText.cs`, `PanelExtraText.cs`), and no second model has read them yet. No native speaker has read them yet.

## Deutsch (de)

**Description**

Fadester Companion macht die Controller, die Sie schon besitzen, zu einem Bildmischer zum Anfassen für OBS Studio.

Ziehen Sie den rechten Trigger eines Xbox- oder anderen XInput-Controllers wie einen echten T-Bar, und der T-Bar von OBS folgt. Halten Sie A, um die Überblendung voranzuschieben, und lassen Sie los, um sie auf halbem Weg stehen zu lassen. Mit dem Steuerkreuz nach oben und unten gehen Sie Ihre Szenenliste durch, der linke Trigger senkt die Musik, solange Sie ihn halten, und die Sticks regeln Deckkraft und Mischmodus einer Ebene sowie das Tempo des Videos, das in Chrome über die kostenlose VJster-Erweiterung läuft. Jede Taste lässt sich neu belegen, mit einer zweiten Belegung bei gehaltenem LB, und im einfachen Modus brauchen Umschaltungen auf Sendung ein kurzes Gedrückthalten, damit ein versehentlich angestoßenes Bedienelement nichts bewirkt.

Sie haben eine TourBox? Die steuert derselbe Companion auch: Das Dial ist Ihr T-Bar, Scroll lädt Szenen in die Vorschau, und der Knob stellt das Videotempo ein.

Er arbeitet weiter, während OBS im Vordergrund ist, spricht nur mit OBS und der VJster-Erweiterung auf Ihrem eigenen Computer und sendet nichts ins Internet.

Benötigt OBS Studio mit eingeschaltetem WebSocket-Server (Werkzeuge → WebSocket-Servereinstellungen). Der T-Bar benötigt OBS Studio 33 im Studiomodus. Kostenlos und quelloffen (GPL-2.0-or-later).

**Short description:** Ihr Gamecontroller als Bildmischer für OBS Studio: ein echter T-Bar am rechten Trigger, Szenen auf dem Steuerkreuz, Musik am linken Trigger.

**What's new:** Version 1.5.2:

- T-Bar: Wenn OBS das Ende einer Überblendung bestätigt hatte, die Prüfung seines Schiebereglers danach aber fehlschlug, konnte die App zur alten Szene zurückschalten oder die Vorschau auf Sendung bringen. Sie behält jetzt, was OBS getan hat, und „Aktivität“ sagt es.
- „OBS-Browserquellen-URL kopieren“ baut den Link aus Ihren gespeicherten Einstellungen und sagt, wann die Steuerung gestoppt und wieder gestartet werden muss.
- VJster mit beiden Zielen: Tempo- und Qualitätsschritte gehen nur dorthin, wo ein Video ihnen folgen kann, und die OBS-Seite meldet nicht mehr bei jedem Qualitätsschritt einen Fehler.
- Wenn die VJster-Aktionen in Stream Deck den VJster-Port belegen, sagen „Aktivität“ und „So geht’s“ jetzt, was ihn freigibt: in den Einstellungen einer VJster-Aktion unter „OBS-Seite“ das Kästchen „Verbindung aktiv halten“ deaktivieren und dann die Aktionen entfernen, oder Stream Deck beenden.
- Die VJster-Seite in OBS funktioniert weiter, nachdem OBS sie neu geladen hat.

**Product features**

- Der rechte Trigger ist ein echter T-Bar für den Studiomodus von OBS
- A halten, um die Überblendung zu schieben; Loslassen lässt sie halb stehen
- Steuerkreuz hoch und runter geht Ihre Szenenliste durch
- Der linke Trigger senkt die Musik, solange Sie ihn halten
- Jede Taste neu belegbar, mit zweiter Belegung bei gehaltenem LB
- Einfacher Modus: Umschaltungen auf Sendung brauchen kurzes Gedrückthalten
- Videotempo für VJster in Chrome mit dem rechten Stick
- Steuert auch eine TourBox: Das Dial ist Ihr T-Bar
- Arbeitet, während OBS im Vordergrund ist; nichts verlässt Ihren PC

**Keywords:** OBS · VJ · Bildmischer · Gamecontroller · Xbox-Controller · TourBox · Livestreaming

## Español (es)

**Description**

Fadester Companion convierte los mandos que ya tienes en un mezclador de vídeo manual para OBS Studio.

Aprieta el gatillo derecho de un mando de Xbox u otro mando XInput como si fuera un T-bar de verdad, y el T-bar de OBS lo sigue. Mantén pulsado A para avanzar la mezcla y suéltalo para dejarla a medio camino. Arriba y abajo en la cruceta recorren tu lista de escenas, el gatillo izquierdo baja la música mientras lo mantienes, y los sticks ajustan la opacidad y el modo de fusión de una capa y la velocidad del vídeo que se reproduce en Chrome con la extensión gratuita VJster. Puedes reasignar todos los botones, con una segunda asignación mientras mantienes LB, y el Modo fácil exige mantener pulsado un momento para los cambios en emisión, así que un golpe accidental no hace nada.

¿Tienes una TourBox? El mismo companion también la controla: el Dial es tu T-bar, Scroll pone escenas en Vista previa y el Knob ajusta la velocidad del vídeo.

Sigue funcionando con OBS en primer plano, solo se comunica con OBS y con la extensión VJster en tu propio ordenador y no envía nada a internet.

Necesita OBS Studio con su servidor WebSocket activado (Herramientas → Ajustes del servidor WebSocket). El T-bar necesita OBS Studio 33 en modo Estudio. Gratuito y de código abierto (GPL-2.0-or-later).

**Short description:** Tu mando de juego, ahora un mezclador de vídeo para OBS Studio: un T-bar de verdad en el gatillo derecho, escenas en la cruceta y música en el gatillo izquierdo.

**What's new:** Versión 1.5.2:

- T-bar: cuando OBS aceptaba el final de una transición pero luego fallaba la comprobación de su control deslizante, la aplicación podía volver a la escena anterior o poner Vista previa en emisión. Ahora conserva lo que hizo OBS, y Actividad lo indica.
- Copiar URL para fuente de navegador de OBS crea el enlace con tus ajustes guardados e indica cuándo hay que detener e iniciar los controles.
- VJster con los dos destinos: los pasos de velocidad y de calidad van solo adonde un vídeo puede seguirlos, así que la página de OBS ya no informa de un error en cada paso de calidad.
- Cuando las acciones de VJster de Stream Deck ocupan el puerto de VJster, Actividad y Muéstramelo indican ahora qué lo libera: desmarca Mantener la conexión activa en Página de OBS, en los ajustes de una acción de VJster, y luego quita las acciones; o cierra Stream Deck.
- La página de VJster en OBS sigue funcionando después de que OBS la actualice.

**Product features**

- El gatillo derecho es un T-bar de verdad para el modo Estudio de OBS
- Mantén A para avanzar la mezcla; suéltalo para dejarla a medio camino
- Arriba y abajo en la cruceta recorren tu lista de escenas
- El gatillo izquierdo baja la música mientras lo mantienes
- Reasigna cualquier botón, con una segunda asignación al mantener LB
- Modo fácil: los cambios en emisión requieren mantener pulsado un momento
- Velocidad del vídeo de VJster en Chrome con el stick derecho
- También controla una TourBox: el Dial es tu T-bar
- Funciona con OBS en primer plano; nada sale de tu PC

**Keywords:** OBS · VJ · mezclador de vídeo · mando de juego · mando de Xbox · TourBox · streaming en directo

## Français (fr)

**Description**

Fadester Companion transforme les manettes que vous possédez déjà en mélangeur vidéo manuel pour OBS Studio.

Tirez la gâchette droite d’une manette Xbox ou d’une autre manette XInput comme un vrai T-bar, et le T-bar d’OBS suit. Maintenez A pour pousser le mélange et relâchez pour le laisser à mi-chemin. Le haut et le bas du pavé directionnel parcourent votre liste de scènes, la gâchette gauche baisse la musique tant que vous la tenez, et les sticks règlent l’opacité et le mode de fusion d’un calque ainsi que la vitesse de la vidéo lue dans Chrome grâce à l’extension gratuite VJster. Chaque bouton peut être réaffecté, avec un second jeu d’actions tant que LB est maintenu, et le Mode facile exige un bref maintien pour les changements à l’antenne : une commande heurtée par mégarde ne fait rien.

Vous avez une TourBox ? Le même companion la pilote aussi : le Dial est votre T-bar, Scroll place les scènes dans l’aperçu et le Knob règle la vitesse de la vidéo.

Il continue de fonctionner quand OBS est au premier plan, ne communique qu’avec OBS et l’extension VJster sur votre propre ordinateur, et n’envoie rien sur Internet.

Nécessite OBS Studio avec son serveur WebSocket activé (Outils → Paramètres du serveur WebSocket). Le T-bar nécessite OBS Studio 33 en mode Studio. Gratuit et open source (GPL-2.0-or-later).

**Short description:** Votre manette de jeu devient un mélangeur vidéo pour OBS Studio : un vrai T-bar sur la gâchette droite, les scènes sur le pavé directionnel, la musique sur la gâchette gauche.

**What's new:** Version 1.5.2 :

- T-bar : quand OBS avait accepté la fin d’un fondu mais que la vérification de son curseur échouait ensuite, l’application pouvait revenir à l’ancienne scène ou mettre l’aperçu à l’antenne. Elle garde désormais ce qu’OBS a fait, et Activité le signale.
- Copier l’URL pour la source navigateur OBS construit le lien à partir de vos réglages enregistrés et indique quand arrêter et redémarrer les commandes.
- VJster avec les deux cibles : les pas de vitesse et de qualité ne vont que là où une vidéo peut les suivre ; la page OBS ne signale donc plus d’erreur à chaque pas de qualité.
- Quand les actions VJster de Stream Deck occupent le port VJster, Activité et Montrez-moi disent maintenant ce qui le libère : décochez Garder la liaison active sous Page OBS dans les réglages d’une action VJster, puis retirez les actions ; ou quittez Stream Deck.
- La page VJster dans OBS continue de fonctionner après qu’OBS l’a actualisée.

**Product features**

- La gâchette droite est un vrai T-bar pour le mode Studio d’OBS
- Maintenez A pour pousser le mélange ; relâchez pour le laisser à mi-chemin
- Le haut et le bas du pavé directionnel parcourent votre liste de scènes
- La gâchette gauche baisse la musique tant que vous la tenez
- Réaffectez chaque bouton, avec un second jeu d’actions sous LB
- Mode facile : les changements à l’antenne demandent un bref maintien
- Vitesse de la vidéo VJster dans Chrome au stick droit
- Pilote aussi une TourBox : le Dial est votre T-bar
- Fonctionne avec OBS au premier plan ; rien ne quitte votre PC

**Keywords:** OBS · VJ · mélangeur vidéo · manette de jeu · manette Xbox · TourBox · streaming en direct

## Italiano (it)

**Description**

Fadester Companion trasforma i controller che hai già in un mixer video manuale per OBS Studio.

Tira il grilletto destro di un controller Xbox o di un altro controller XInput come un vero T-bar, e il T-bar di OBS lo segue. Tieni premuto A per spingere il mix e rilascialo per lasciarlo a metà. Su e giù sul D-pad scorrono l’elenco delle scene, il grilletto sinistro abbassa la musica finché lo tieni premuto e gli stick regolano l’opacità e il metodo di fusione di un livello e la velocità del video in riproduzione in Chrome con l’estensione gratuita VJster. Ogni pulsante si può riassegnare, con una seconda serie di azioni tenendo premuto LB, e la Modalità facile richiede di tenere premuto per un istante per i cambi in onda, così un urto accidentale non fa nulla.

Hai una TourBox? Lo stesso companion la controlla: il Dial è il tuo T-bar, Scroll mette le scene in Anteprima e il Knob regola la velocità del video.

Continua a funzionare con OBS in primo piano, comunica solo con OBS e con l’estensione VJster sul tuo computer e non invia nulla su Internet.

Richiede OBS Studio con il server WebSocket attivo (Strumenti → Impostazioni del server WebSocket). Il T-bar richiede OBS Studio 33 in Modalità studio. Gratuito e open source (GPL-2.0-or-later).

**Short description:** Il tuo controller di gioco diventa un mixer video per OBS Studio: un vero T-bar sul grilletto destro, le scene sul D-pad, la musica sul grilletto sinistro.

**What's new:** Versione 1.5.2:

- T-bar: quando OBS aveva accettato la fine di una dissolvenza ma poi il controllo del suo cursore falliva, l’app poteva tornare alla scena precedente o mandare in onda l’Anteprima. Ora mantiene ciò che OBS ha fatto, e Attività lo dice.
- Copia URL per la sorgente browser di OBS crea il link dalle impostazioni salvate e dice quando fermare e riavviare i controlli.
- VJster con entrambe le destinazioni: i passi di velocità e di qualità vanno solo dove un video può seguirli, così la pagina OBS non segnala più un errore a ogni passo di qualità.
- Quando le azioni VJster di Stream Deck occupano la porta di VJster, Attività e Mostrami ora dicono cosa la libera: togli la spunta a Tieni attivo il collegamento sotto Pagina OBS nelle impostazioni di un’azione VJster, poi rimuovi le azioni; oppure chiudi Stream Deck.
- La pagina VJster in OBS continua a funzionare dopo che OBS l’ha aggiornata.

**Product features**

- Il grilletto destro è un vero T-bar per la Modalità studio di OBS
- Tieni premuto A per spingere il mix; rilascia per lasciarlo a metà
- Su e giù sul D-pad scorrono l’elenco delle scene
- Il grilletto sinistro abbassa la musica finché lo tieni premuto
- Riassegna ogni pulsante, con una seconda serie di azioni su LB
- Modalità facile: i cambi in onda richiedono di tenere premuto per un istante
- Velocità del video VJster in Chrome con lo stick destro
- Controlla anche una TourBox: il Dial è il tuo T-bar
- Funziona con OBS in primo piano; nulla esce dal tuo PC

**Keywords:** OBS · VJ · mixer video · controller di gioco · controller Xbox · TourBox · live streaming

## 日本語 (ja)

**Description**

Fadester Companion は、手持ちのコントローラーを OBS Studio 用の手で操作するビデオスイッチャーに変えます。

Xbox などの XInput 対応コントローラーの右トリガーを本物の T バーのように引くと、OBS の T バーが追従します。A を押し続けるとミックスが進み、離すと途中で止まります。十字キーの上下でシーン一覧を移動し、左トリガーを押している間は音楽を下げ、スティックでレイヤーの不透明度とブレンドモード、そして無料の VJster 拡張機能を通じて Chrome で再生中の動画の速度を調整します。すべてのボタンを割り当て直せるほか、LB を押している間は 2 つ目の割り当てが使えます。かんたんモードでは放送中の切り替えに短い長押しが必要なので、うっかり触れても何も起きません。

TourBox をお持ちですか？同じコンパニオンで操作できます。Dial が T バー、Scroll でシーンをプレビューに入れ、Knob で動画の速度を調整します。

OBS が前面にあっても動作し続け、通信するのは同じコンピューター上の OBS と VJster 拡張機能だけで、インターネットには何も送りません。

WebSocket サーバーを有効にした OBS Studio が必要です（ツール → WebSocket サーバー設定）。T バーには、スタジオモードの OBS Studio 33 が必要です。無料のオープンソース（GPL-2.0-or-later）です。

**Short description:** ゲームコントローラーが OBS Studio のビデオスイッチャーに。右トリガーは本物の T バー、十字キーでシーン、左トリガーで音楽。

**What's new:** バージョン 1.5.2：

- T バー：OBS がフェードの終わりを受け付けたのに、その後のスライダーの確認だけが失敗したとき、アプリが前のシーンに戻したり、プレビューをオンエアにしたりすることがありました。今は OBS が行った結果をそのまま保ち、「アクティビティ」にそう表示します。
- 「OBS ブラウザソース URL をコピー」は保存済みの設定からリンクを作り、コントロールの停止と開始が必要なときはそう伝えます。
- 両方を対象にした VJster：速度と画質のステップは、動画が従える先にだけ送られます。OBS ページが画質のステップごとにエラーを報告することはなくなりました。
- Stream Deck の VJster アクションが VJster ポートを使っているとき、「アクティビティ」と「やり方を見る」がポートを空ける方法を示すようになりました：VJster アクションの設定の「OBS ページ」で「接続を常にオンにする」のチェックを外してからアクションを外すか、Stream Deck を終了します。
- OBS が VJster ページを再読み込みした後も、ページは動き続けます。

**Product features**

- 右トリガーは OBS のスタジオモード用の本物の T バー
- A を押し続けてミックスを進め、離すと途中で停止
- 十字キーの上下でシーン一覧を移動
- 左トリガーを押している間は音楽を下げる
- すべてのボタンを割り当て可能、LB で 2 つ目の割り当て
- かんたんモード：放送中の切り替えには短い長押しが必要
- 右スティックで Chrome の VJster の動画速度を調整
- TourBox にも対応：Dial が T バーに
- OBS が前面でも動作、PC の外には何も送信しない

**Keywords:** OBS · VJ · ビデオスイッチャー · ゲームコントローラー · Xbox コントローラー · TourBox · ライブ配信

## 한국어 (ko)

**Description**

Fadester Companion은 이미 가지고 있는 컨트롤러를 OBS Studio용 손으로 다루는 비디오 스위처로 바꿔 줍니다.

Xbox나 다른 XInput 게임 컨트롤러의 오른쪽 트리거를 진짜 T바처럼 당기면 OBS의 T바가 따라 움직입니다. A를 누르고 있으면 믹스가 진행되고, 놓으면 중간에 멈춥니다. 십자키 위아래로 장면 목록을 이동하고, 왼쪽 트리거를 누르는 동안 음악이 줄어들며, 스틱으로 레이어의 불투명도와 혼합 모드, 그리고 무료 VJster 확장 프로그램을 통해 Chrome에서 재생 중인 동영상의 속도를 조절합니다. 모든 버튼을 다시 지정할 수 있고, LB를 누르고 있는 동안에는 두 번째 지정이 적용됩니다. 쉬운 모드에서는 방송 중 전환을 하려면 잠깐 누르고 있어야 하므로 실수로 건드려도 아무 일도 일어나지 않습니다.

TourBox가 있으십니까? 같은 컴패니언으로 조작할 수 있습니다. Dial은 T바, Scroll은 미리보기 장면 선택, Knob은 동영상 속도 조절입니다.

OBS가 앞에 있어도 계속 작동하며, 같은 컴퓨터의 OBS와 VJster 확장 프로그램하고만 통신하고 인터넷으로는 아무것도 보내지 않습니다.

WebSocket 서버가 켜진 OBS Studio가 필요합니다(도구 → WebSocket 서버 설정). T바를 쓰려면 스튜디오 모드의 OBS Studio 33이 필요합니다. 무료 오픈 소스입니다(GPL-2.0-or-later).

**Short description:** 게임 컨트롤러가 OBS Studio용 비디오 스위처로: 오른쪽 트리거는 진짜 T바, 십자키는 장면, 왼쪽 트리거는 음악.

**What's new:** 버전 1.5.2:

- T바: OBS가 페이드의 끝을 받아들였지만 그 뒤 슬라이더 확인만 실패했을 때, 앱이 이전 장면으로 되돌리거나 미리보기를 송출할 수 있었습니다. 이제 OBS가 한 결과를 그대로 두고, '활동 로그'에 그렇게 표시합니다.
- 'OBS 브라우저 소스 URL 복사'는 저장된 설정으로 링크를 만들고, 컨트롤을 중지했다가 다시 시작해야 할 때 알려 줍니다.
- 두 대상 모두로 설정한 VJster: 속도와 화질 단계는 동영상이 따를 수 있는 곳으로만 보내므로, OBS 페이지가 화질 단계마다 오류를 보고하지 않습니다.
- Stream Deck의 VJster 동작이 VJster 포트를 쓰고 있을 때, '활동 로그'와 '방법 보기'가 포트를 비우는 방법을 알려 줍니다: VJster 동작 설정의 'OBS 페이지'에서 '연결 계속 켜 두기'를 해제한 뒤 동작을 제거하거나, Stream Deck을 종료하세요.
- OBS가 VJster 페이지를 새로 고친 뒤에도 페이지가 계속 작동합니다.

**Product features**

- 오른쪽 트리거는 OBS 스튜디오 모드용 진짜 T바
- A를 누르고 있으면 믹스 진행, 놓으면 중간에 정지
- 십자키 위아래로 장면 목록 이동
- 왼쪽 트리거를 누르는 동안 음악 줄이기
- 모든 버튼 재지정, LB를 누르고 있으면 두 번째 지정
- 쉬운 모드: 방송 중 전환은 잠깐 누르고 있어야 실행
- 오른쪽 스틱으로 Chrome의 VJster 동영상 속도 조절
- TourBox도 지원: Dial이 T바
- OBS가 앞에 있어도 작동, PC 밖으로 보내는 것 없음

**Keywords:** OBS · VJ · 비디오 스위처 · 게임 컨트롤러 · Xbox 컨트롤러 · TourBox · 라이브 스트리밍

## Русский (ru)

**Description**

Fadester Companion превращает контроллеры, которые у вас уже есть, в ручной видеомикшер для OBS Studio.

Нажимайте правый триггер геймпада Xbox или другого геймпада XInput, как настоящий T-bar, и T-bar в OBS следует за ним. Удерживайте A, чтобы продвигать переход, и отпустите, чтобы оставить его на полпути. Крестовина вверх и вниз листает список сцен, левый триггер приглушает музыку, пока вы его держите, а стики регулируют непрозрачность и режим наложения слоя, а также скорость видео, которое играет в Chrome через бесплатное расширение VJster. Любую кнопку можно переназначить, со вторым набором действий при удержании LB, а Простой режим требует короткого удержания для переключений в эфире, так что случайное нажатие ничего не делает.

Есть TourBox? Тот же companion управляет и им: Dial — ваш T-bar, Scroll выводит сцены в Предпросмотр, а Knob задаёт скорость видео.

Он продолжает работать, когда OBS на переднем плане, общается только с OBS и расширением VJster на вашем компьютере и ничего не отправляет в интернет.

Нужен OBS Studio с включённым сервером WebSocket (Сервис → Настройки сервера WebSocket). Для T-bar нужен OBS Studio 33 в Режиме студии. Бесплатно и с открытым исходным кодом (GPL-2.0-or-later).

**Short description:** Ваш геймпад — теперь видеомикшер для OBS Studio: настоящий T-bar на правом триггере, сцены на крестовине, музыка на левом триггере.

**What's new:** Версия 1.5.2:

- T-bar: если OBS принял конец перехода, но потом не удалась только проверка его ползунка, приложение могло вернуть старую сцену или вывести Предпросмотр в эфир. Теперь оно сохраняет то, что сделал OBS, и «Журнал» сообщает об этом.
- «Скопировать URL для источника „Браузер“ OBS» строит ссылку по сохранённым настройкам и говорит, когда управление нужно остановить и снова запустить.
- VJster с обеими целями: шаги скорости и качества идут только туда, где видео может их выполнить, поэтому страница OBS больше не сообщает об ошибке при каждом шаге качества.
- Когда действия VJster в Stream Deck держат порт VJster, «Журнал» и «Показать» теперь говорят, как его освободить: в настройках действия VJster в разделе «Страница OBS» снимите флажок «Не отключать связь», затем уберите действия; или закройте Stream Deck.
- Страница VJster в OBS продолжает работать после того, как OBS её обновит.

**Product features**

- Правый триггер — настоящий T-bar для Режима студии OBS
- Удерживайте A, чтобы вести переход; отпустите — он остановится
- Крестовина вверх и вниз листает список сцен
- Левый триггер приглушает музыку, пока вы его держите
- Любая кнопка переназначается, второй набор действий на LB
- Простой режим: переключения в эфире требуют короткого удержания
- Скорость видео VJster в Chrome правым стиком
- Управляет и TourBox: Dial — ваш T-bar
- Работает, когда OBS на переднем плане; ничто не покидает ваш ПК

**Keywords:** OBS · VJ · видеомикшер · геймпад · геймпад Xbox · TourBox · прямой эфир

## 简体中文 (zh-CN)

**Description**

Fadester Companion 把你已有的控制器变成 OBS Studio 的手动视频切换台。

像真正的 T-bar 一样扣下 Xbox 或其他 XInput 游戏手柄的右扳机，OBS 自己的 T-bar 就会跟着移动。按住 A 推进混合，松开则停在中途。方向键上下浏览场景列表，按住左扳机时音乐会压低，摇杆可调节图层的不透明度和混合模式，以及通过免费 VJster 扩展在 Chrome 中播放的视频速度。每个按钮都可以重新分配，按住 LB 时还有第二套操作；简易模式下，直播中的切换需要短暂按住，误碰不会生效。

有 TourBox？同一个 Companion 也能控制它：Dial 是你的 T-bar，Scroll 将场景放入预览，Knob 调节视频速度。

OBS 在前台时它照样工作，只与你电脑上的 OBS 和 VJster 扩展通信，不向互联网发送任何内容。

需要开启 WebSocket 服务器的 OBS Studio（工具 → WebSocket 服务器设置）。T-bar 需要处于工作室模式的 OBS Studio 33。免费开源（GPL-2.0-or-later）。

**Short description:** 你的游戏手柄，变身 OBS Studio 视频切换台：右扳机是真正的 T-bar，方向键切换场景，左扳机控制音乐。

**What's new:** 版本 1.5.2：

- T-bar：OBS 已接受渐变结束，但之后对其滑块的检查失败时，应用可能切回旧场景，或把预览送上直播。现在它保留 OBS 已完成的结果，并在“活动”中说明。
- “复制 OBS 浏览器源 URL”现在根据已保存的设置生成链接，并在需要停止再启动控制时提示你。
- VJster 同时控制两个目标时：速度和画质步进只发送到视频能执行的地方，OBS 页面不再在每次画质步进时报错。
- 当 Stream Deck 中的 VJster 操作占用 VJster 端口时，“活动”和“演示给我看”现在会说明如何释放它：在某个 VJster 操作的设置中，于“OBS 页面”下取消勾选“保持连接开启”，然后移除这些操作；或退出 Stream Deck。
- OBS 刷新 VJster 页面后，页面仍能继续工作。

**Product features**

- 右扳机是用于 OBS 工作室模式的真正 T-bar
- 按住 A 推进混合，松开即停在中途
- 方向键上下浏览场景列表
- 按住左扳机时压低音乐
- 每个按钮均可重新分配，按住 LB 有第二套操作
- 简易模式：直播中的切换需要短暂按住
- 用右摇杆调节 Chrome 中 VJster 的视频速度
- 也支持 TourBox：Dial 就是你的 T-bar
- OBS 在前台也能工作，不会有数据离开你的电脑

**Keywords:** OBS · VJ · 视频切换台 · 游戏手柄 · Xbox 手柄 · TourBox · 直播

## 繁體中文 (zh-TW)

**Description**

Fadester Companion 把你手上的控制器變成 OBS Studio 的手動視訊切換台。

像真正的 T-bar 一樣扣下 Xbox 或其他 XInput 遊戲控制器的右扳機，OBS 自己的 T-bar 就會跟著移動。按住 A 推進混合，放開則停在中途。十字鍵上下瀏覽場景清單，按住左扳機時音樂會壓低，搖桿可調整圖層的不透明度與混合模式，以及透過免費 VJster 擴充功能在 Chrome 中播放的影片速度。每個按鈕都能重新指定，按住 LB 時還有第二組操作；簡易模式下，直播中的切換需要短暫按住，誤觸不會生效。

有 TourBox？同一個 Companion 也能控制它：Dial 是你的 T-bar，Scroll 將場景放入預覽，Knob 調整影片速度。

OBS 在前景時它照樣運作，只與你電腦上的 OBS 和 VJster 擴充功能通訊，不會傳送任何內容到網際網路。

需要開啟 WebSocket 伺服器的 OBS Studio（工具 → WebSocket 伺服器設定）。T-bar 需要處於工作室模式的 OBS Studio 33。免費且開放原始碼（GPL-2.0-or-later）。

**Short description:** 你的遊戲控制器，變身 OBS Studio 視訊切換台：右扳機是真正的 T-bar，十字鍵切換場景，左扳機控制音樂。

**What's new:** 版本 1.5.2：

- T-bar：OBS 已接受淡變結束，但之後對其滑桿的檢查失敗時，應用程式可能切回舊場景，或把預覽送上直播。現在它保留 OBS 已完成的結果，並在「活動紀錄」中說明。
- 「複製 OBS 瀏覽器來源 URL」現在依已儲存的設定產生連結，並在需要停止再啟動控制時提示你。
- VJster 同時控制兩個目標時：速度與畫質步進只送到影片能執行的地方，OBS 頁面不再於每次畫質步進時回報錯誤。
- 當 Stream Deck 中的 VJster 動作占用 VJster 連接埠時，「活動紀錄」與「示範給我看」現在會說明如何釋放它：在某個 VJster 動作的設定中，於「OBS 頁面」下取消勾選「保持連線開啟」，然後移除這些動作；或結束 Stream Deck。
- OBS 重新整理 VJster 頁面後，頁面仍能繼續運作。

**Product features**

- 右扳機是用於 OBS 工作室模式的真正 T-bar
- 按住 A 推進混合，放開即停在中途
- 十字鍵上下瀏覽場景清單
- 按住左扳機時壓低音樂
- 每個按鈕皆可重新指定，按住 LB 有第二組操作
- 簡易模式：直播中的切換需要短暫按住
- 用右搖桿調整 Chrome 中 VJster 的影片速度
- 也支援 TourBox：Dial 就是你的 T-bar
- OBS 在前景也能運作，不會有資料離開你的電腦

**Keywords:** OBS · VJ · 視訊切換台 · 遊戲控制器 · Xbox 控制器 · TourBox · 直播

## Nederlands (nl)

**Description**

Fadester Companion maakt van de controllers die je al hebt een beeldmixer voor OBS Studio die je met je handen bedient.

Trek aan de rechtertrigger van een Xbox- of andere XInput-gamecontroller zoals aan een echte T-bar, en de T-bar van OBS zelf volgt. Houd A vast om de mix verder te duwen en laat los om hem halverwege te laten staan. Met de D-pad omhoog en omlaag loop je door je scènelijst, de linkertrigger dempt je muziek zolang je hem vasthoudt, en met de sticks regel je de dekking en de mengmodus van een laag en de snelheid van de video die in Chrome speelt via de gratis VJster-extensie. Elke knop kun je opnieuw toewijzen, met een tweede laag zolang je LB vasthoudt, en in de eenvoudige modus vraagt elke wissel on air om kort vasthouden, zodat een per ongeluk aangeraakte knop niets doet.

Heb je een TourBox? Dezelfde Companion bedient die ook: de Dial is je T-bar, met Scroll zet je scènes in Voorvertoning en de Knob regelt de videosnelheid.

De app blijft werken terwijl OBS op de voorgrond staat, praat alleen met OBS en de VJster-extensie op je eigen computer en stuurt niets naar internet.

Vereist OBS Studio met de WebSocket-server ingeschakeld (Tools → WebSocket-serverinstellingen). De T-bar heeft OBS Studio 33 in de Studiomodus nodig. Gratis en open source (GPL-2.0-or-later).

**Short description:** Je gamecontroller als beeldmixer voor OBS Studio: een echte T-bar op de rechtertrigger, scènes op de D-pad, muziek op de linkertrigger.

**What's new:** Versie 1.5.2:

- T-bar: als OBS het einde van een overgang had aanvaard maar de controle van zijn schuif daarna mislukte, kon de app terugschakelen naar de oude scène of Voorvertoning uitzenden. Nu houdt de app wat OBS gedaan heeft, en Activiteit meldt dat.
- URL voor OBS-browserbron kopiëren maakt de link uit je opgeslagen instellingen en zegt wanneer de bediening gestopt en opnieuw gestart moet worden.
- VJster met beide doelen: stappen voor snelheid en kwaliteit gaan alleen naar waar een video ze kan volgen, dus de OBS-pagina meldt niet meer bij elke kwaliteitsstap een fout.
- Als de VJster-acties in Stream Deck de VJster-poort bezet houden, zeggen Activiteit en Laat zien nu wat hem vrijmaakt: zet in de instellingen van een VJster-actie onder OBS-pagina het vinkje bij Verbinding aanhouden uit en verwijder daarna de acties; of sluit Stream Deck af.
- De VJster-pagina in OBS blijft werken nadat OBS haar heeft vernieuwd.

**Product features**

- De rechtertrigger is een echte T-bar voor de Studiomodus van OBS
- Houd A vast om de mix te duwen; laat los en hij blijft halverwege staan
- D-pad omhoog en omlaag loopt door je scènelijst
- De linkertrigger dempt je muziek zolang je hem vasthoudt
- Elke knop opnieuw toe te wijzen, met een tweede laag onder LB
- Eenvoudige modus: wissels on air vragen om kort vasthouden
- Videosnelheid voor VJster in Chrome met de rechterstick
- Bedient ook een TourBox: de Dial is je T-bar
- Werkt terwijl OBS op de voorgrond staat; niets verlaat je pc

**Keywords:** OBS · VJ · beeldmixer · gamecontroller · Xbox-controller · TourBox · livestreamen

## Português do Brasil (pt-BR)

**Description**

O Fadester Companion transforma os controles que você já tem em uma mesa de corte de vídeo para o OBS Studio que você opera com as mãos.

Puxe o gatilho direito de um controle Xbox ou de outro controle XInput como um T-bar de verdade, e o próprio T-bar do OBS acompanha. Segure A para empurrar a mixagem e solte para deixá-la no meio do caminho. O direcional para cima e para baixo percorre a sua lista de cenas, o gatilho esquerdo abaixa a música enquanto você o segura, e os analógicos ajustam a opacidade e o modo de mesclagem de uma camada e a velocidade do vídeo que toca no Chrome pela extensão gratuita VJster. Todos os botões podem ser reatribuídos, com uma segunda camada enquanto LB está pressionado, e o Modo fácil exige segurar um instante para trocar o que está no ar, de modo que um esbarrão não faz nada.

Tem um TourBox? O mesmo Companion também o opera: o Dial é o seu T-bar, o Scroll coloca cenas na Pré-visualização e o Knob ajusta a velocidade do vídeo.

Ele continua funcionando com o OBS na frente, conversa apenas com o OBS e com a extensão VJster no seu próprio computador e não envia nada para a internet.

Requer o OBS Studio com o servidor WebSocket ativado (Ferramentas → Configurações do servidor WebSocket). O T-bar precisa do OBS Studio 33 no Modo Estúdio. Gratuito e de código aberto (GPL-2.0-or-later).

**Short description:** Seu controle de jogo agora é uma mesa de corte para o OBS Studio: um T-bar de verdade no gatilho direito, cenas no direcional, música no gatilho esquerdo.

**What's new:** Versão 1.5.2:

- T-bar: quando o OBS tinha aceitado o fim de uma transição, mas a verificação do controle deslizante falhava depois, o aplicativo podia voltar para a cena anterior ou colocar a Pré-visualização no ar. Agora ele mantém o que o OBS fez, e Atividade informa isso.
- Copiar URL da Fonte de navegador do OBS monta o link com as configurações salvas e avisa quando é preciso parar e iniciar os controles.
- VJster com os dois destinos: os passos de velocidade e de qualidade vão só para onde um vídeo pode segui-los, então a página do OBS não informa mais um erro a cada passo de qualidade.
- Quando as ações do VJster no Stream Deck ocupam a porta do VJster, Atividade e Mostre-me agora dizem o que a libera: desmarque Manter a conexão ligada em Página do OBS, nas configurações de uma ação do VJster, e depois remova as ações; ou feche o Stream Deck.
- A página do VJster no OBS continua funcionando depois que o OBS a atualiza.

**Product features**

- O gatilho direito é um T-bar de verdade para o Modo Estúdio do OBS
- Segure A para empurrar a mixagem; solte para deixá-la no meio
- O direcional para cima e para baixo percorre a sua lista de cenas
- O gatilho esquerdo abaixa a música enquanto você o segura
- Reatribua todos os botões, com uma segunda camada no LB
- Modo fácil: trocas no ar exigem segurar um instante
- Velocidade do vídeo do VJster no Chrome pelo analógico direito
- Também opera um TourBox: o Dial é o seu T-bar
- Funciona com o OBS na frente; nada sai do seu PC

**Keywords:** OBS · VJ · mesa de corte · controle de jogo · controle Xbox · TourBox · transmissão ao vivo

## Türkçe (tr)

**Description**

Fadester Companion, elinizdeki kumandaları OBS Studio için elle kullanılan bir görüntü mikserine dönüştürür.

Bir Xbox veya başka bir XInput oyun kumandasının sağ tetiğini gerçek bir T-bar gibi çekin; OBS'in kendi T-bar'ı onu izler. Miksi ilerletmek için A'yı basılı tutun, yarıda durdurmak için bırakın. D-pad yukarı ve aşağı sahne listenizde gezinir, sol tetik basılı tuttuğunuz sürece müziği kısar, çubuklar ise bir katmanın opaklığını ve karışım modunu ve ücretsiz VJster uzantısıyla Chrome'da oynatılan videonun hızını ayarlar. Her düğme, LB basılıyken ikinci bir katmanla birlikte yeniden atanabilir; Kolay mod ise yayındaki değişiklikler için kısa bir basılı tutma ister, böylece yanlışlıkla dokunulan bir düğme hiçbir şey yapmaz.

TourBox'ınız mı var? Aynı Companion onu da çalıştırır: Dial sizin T-bar'ınızdır, Scroll sahneleri Önizleme'ye koyar ve Knob video hızını ayarlar.

OBS öndeyken de çalışmaya devam eder, yalnızca kendi bilgisayarınızdaki OBS ve VJster uzantısıyla konuşur ve internete hiçbir şey göndermez.

WebSocket sunucusu açık OBS Studio gerekir (Araçlar → WebSocket Sunucu Ayarları). T-bar için Stüdyo Modu'nda OBS Studio 33 gerekir. Ücretsiz ve açık kaynak (GPL-2.0-or-later).

**Short description:** Oyun kumandanız artık OBS Studio için bir görüntü mikseri: sağ tetikte gerçek bir T-bar, D-pad'de sahneler, sol tetikte müzik.

**What's new:** Sürüm 1.5.2:

- T-bar: OBS bir geçişin sonunu kabul ettiği hâlde ardından yalnızca kaydırıcısının denetimi başarısız olduğunda, uygulama eski sahneye geri dönebiliyor veya Önizleme'yi yayına çıkarabiliyordu. Artık OBS'in yaptığını koruyor ve Etkinlik bunu bildiriyor.
- OBS Tarayıcı Kaynağı URL'sini kopyala, bağlantıyı kayıtlı ayarlarınızdan oluşturuyor ve kontrollerin ne zaman durdurulup yeniden başlatılması gerektiğini söylüyor.
- İki hedefli VJster: hız ve kalite adımları yalnızca bir videonun izleyebileceği yere gidiyor; böylece OBS sayfası artık her kalite adımında hata bildirmiyor.
- Stream Deck'teki VJster eylemleri VJster bağlantı noktasını tuttuğunda, Etkinlik ve Göster artık onu neyin boşaltacağını söylüyor: bir VJster eyleminin ayarlarında OBS sayfası altındaki Bağlantıyı açık tut kutusunun işaretini kaldırıp eylemleri kaldırın ya da Stream Deck'ten çıkın.
- OBS, VJster sayfasını yeniledikten sonra da sayfa çalışmaya devam ediyor.

**Product features**

- Sağ tetik, OBS Stüdyo Modu için gerçek bir T-bar'dır
- Miksi ilerletmek için A'yı basılı tutun; bırakınca yarıda kalır
- D-pad yukarı ve aşağı sahne listenizde gezinir
- Sol tetik, basılı tuttuğunuz sürece müziği kısar
- Her düğmeyi yeniden atayın; LB basılıyken ikinci katman
- Kolay mod: yayındaki değişiklikler kısa bir basılı tutma ister
- Chrome'daki VJster için video hızı sağ çubukta
- TourBox'ı da çalıştırır: Dial sizin T-bar'ınızdır
- OBS öndeyken çalışır; hiçbir şey bilgisayarınızdan çıkmaz

**Keywords:** OBS · VJ · görüntü mikseri · oyun kumandası · Xbox kumandası · TourBox · canlı yayın
