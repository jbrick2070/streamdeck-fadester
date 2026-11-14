using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace Fadester.TourBox {
  internal sealed class PanelText {
    static readonly string[] Locales = { "en", "es", "fr", "zh-CN" };
    const string PresetName = "OBS Fadester for TourBox.tb";
    static readonly Regex Placeholder = new Regex(@"\{\d+\}");
    readonly Dictionary<string,string> extra;

    // English, Spanish, French, Simplified Chinese. Keep OBS names, paths and
    // bridge protocol values outside the catalog; placeholders hold runtime values.
    static readonly Dictionary<string, string[]> Messages = new Dictionary<string, string[]> {
      { "alreadyOpen", new[] {
        "Fadester Companion is already open. Check the taskbar.",
        "Fadester Companion ya está abierto. Comprueba la barra de tareas.",
        "Fadester Companion est déjà ouvert. Vérifiez la barre des tâches.",
        "Fadester Companion 已打开。请查看任务栏。" } },
      { "lookingForObs", new[] { "Looking for OBS on this PC…", "Buscando OBS en este equipo…", "Recherche d’OBS sur ce PC…", "正在此电脑上查找 OBS…" } },
      { "setup", new[] { "Setup", "Configuración", "Configuration", "设置" } },
      { "importHint", new[] { "Skip this part if you have no TourBox. The button below copies the preset’s path and opens TourBox Console. Do not double-click the .tb file: Windows cannot open it. Link the preset to OBS Studio. Press Tour to open the production menu.", "Sin TourBox, omite esta parte. El botón de abajo copia la ruta del preajuste y abre TourBox Console. No hagas doble clic en el archivo .tb: Windows no puede abrirlo. Vincula el preajuste a OBS Studio. Pulsa Tour para abrir el menú de producción.", "Sans TourBox, passez cette partie. Le bouton ci-dessous copie le chemin du préréglage et ouvre TourBox Console. Ne double-cliquez pas sur le fichier .tb : Windows ne peut pas l’ouvrir. Associez le préréglage à OBS Studio. Appuyez sur Tour pour ouvrir le menu de production.", "没有 TourBox 可跳过这一部分。下方按钮会复制预设路径并打开 TourBox Console。不要双击 .tb 文件：Windows 无法打开它。将预设关联到 OBS Studio。按 Tour 键可打开制作菜单。" } },
      { "openPreset", new[] { "Import into TourBox Console", "Importar en TourBox Console", "Importer dans TourBox Console", "导入到 TourBox Console" } },
      { "importCopied", new[] { "Path copied. In TourBox Console, click Import at the top of Preset List, press Ctrl+V, then Enter, and link the preset to OBS Studio. To update a preset you already imported, select it and use Import in its own menu instead.", "Ruta copiada. En TourBox Console, haz clic en Import arriba de Preset List, pulsa Ctrl+V y luego Intro, y vincula el preajuste a OBS Studio. Para actualizar un preajuste ya importado, selecciónalo y usa Import en su propio menú.", "Chemin copié. Dans TourBox Console, cliquez sur Import en haut de Preset List, appuyez sur Ctrl+V, puis sur Entrée, et associez le préréglage à OBS Studio. Pour mettre à jour un préréglage déjà importé, sélectionnez-le et utilisez Import dans son propre menu.", "路径已复制。在 TourBox Console 中，点击 Preset List 顶部的 Import，按 Ctrl+V，再按 Enter，然后将预设关联到 OBS Studio。要更新已导入的预设，请选中它并使用其自身菜单中的 Import。" } },
      { "importManual", new[] { "The path could not be copied. In TourBox Console, click Import and open: {0}", "No se pudo copiar la ruta. En TourBox Console, haz clic en Import y abre: {0}", "Impossible de copier le chemin. Dans TourBox Console, cliquez sur Import et ouvrez : {0}", "无法复制路径。在 TourBox Console 中点击 Import 并打开：{0}" } },
      { "portsClash", new[] { "The OBS port and the VJster port cannot be the same. The OBS port is usually 4455: check it in OBS under Tools → WebSocket Server Settings.", "El puerto de OBS y el de VJster no pueden ser el mismo. El de OBS suele ser 4455: compruébalo en OBS, en Herramientas → Ajustes del servidor WebSocket.", "Le port OBS et le port VJster ne peuvent pas être identiques. Le port OBS est généralement 4455 : vérifiez-le dans OBS, sous Outils → Paramètres du serveur WebSocket.", "OBS 端口和 VJster 端口不能相同。OBS 端口通常是 4455：请在 OBS 的「工具 → WebSocket 服务器设置」中查看。" } },
      { "obsReady", new[] { "Connected to OBS. Scenes found: {0}. Your controller does nothing until you click Save & start controls.", "Conexión con OBS establecida. Escenas encontradas: {0}. Tu controlador no hará nada hasta que hagas clic en Guardar e iniciar.", "Connexion à OBS établie. Scènes trouvées : {0}. Votre contrôleur ne fera rien tant que vous n’aurez pas cliqué sur Enregistrer et démarrer.", "已连接 OBS。找到 {0} 个场景。点击「保存并启动控制」之前，控制器不会有任何反应。" } },
      { "vjsterChrome", new[] { "VJster controls YouTube in Chrome only. A YouTube browser source in OBS cannot be controlled. To show the video in OBS, add a Window Capture of the Chrome window and keep that window open. Add an Application Audio Capture of Chrome for its sound.", "VJster solo controla YouTube en Chrome. Una fuente de navegador con YouTube en OBS no se puede controlar. Para mostrar el vídeo en OBS, añade una captura de ventana de Chrome y mantén esa ventana abierta. Añade una captura de audio de aplicación de Chrome para el sonido.", "VJster ne contrôle YouTube que dans Chrome. Une source navigateur YouTube dans OBS ne peut pas être contrôlée. Pour afficher la vidéo dans OBS, ajoutez une capture de la fenêtre Chrome et gardez cette fenêtre ouverte. Ajoutez une capture audio d’application de Chrome pour le son.", "VJster 只能控制 Chrome 中的 YouTube。OBS 中的 YouTube 浏览器源无法控制。要在 OBS 中显示视频，请添加 Chrome 窗口的窗口采集，并保持该窗口打开。请添加 Chrome 的应用程序音频采集以获取声音。" } },
      { "connectTitle", new[] { "1   Connect to OBS", "1   Conecta con OBS", "1   Se connecter à OBS", "1   连接 OBS" } },
      { "controllerTitle", new[] { "2   Choose your controller", "2   Elige tu controlador", "2   Choisir un contrôleur", "2   选择控制器" } },
      { "connectHint", new[] { "In OBS, open Tools → WebSocket Server Settings and turn on Enable WebSocket server. Keep authentication on. The T-bar needs OBS 33. Turn on Studio Mode, choose the Fade transition, and keep the main OBS window open with its T-bar visible.", "En OBS, abre Herramientas → Ajustes del servidor WebSocket y activa Habilitar servidor WebSocket. Mantén activa la autenticación. El T-bar necesita OBS 33. Activa el modo Estudio, elige la transición Desvanecimiento y mantén abierta la ventana principal de OBS con su T-bar visible.", "Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket et cochez Activer le serveur WebSocket. Laissez l’authentification activée. Le T-bar nécessite OBS 33. Activez le mode Studio, choisissez la transition Fondu et gardez la fenêtre principale d’OBS ouverte avec son T-bar visible.", "在 OBS 中打开「工具 → WebSocket 服务器设置」，勾选「启用 WebSocket 服务器」。保持身份验证开启。T-bar 需要 OBS 33。请启用工作室模式，选择「淡入淡出」转场，并保持 OBS 主窗口打开且 T-bar 可见。" } },
      { "port", new[] { "OBS port", "Puerto de OBS", "Port OBS", "OBS 端口" } },
      { "password", new[] { "OBS password (optional)", "Contraseña de OBS (opcional)", "Mot de passe OBS (facultatif)", "OBS 密码（可选）" } },
      { "passwordHint", new[] { "Leave this empty. The app reads the password that OBS saved on this PC. Type a password here only if the connection fails. You find it in OBS under Tools → WebSocket Server Settings → Show Connect Info. A password typed here is not saved.", "Deja este campo vacío. La aplicación lee la contraseña que OBS guardó en este equipo. Escribe una contraseña aquí solo si la conexión falla. La encontrarás en OBS, en Herramientas → Ajustes del servidor WebSocket → Mostrar información de conexión. Una contraseña escrita aquí no se guarda.", "Laissez ce champ vide. L’application lit le mot de passe enregistré par OBS sur ce PC. Saisissez un mot de passe ici seulement si la connexion échoue. Vous le trouverez dans OBS sous Outils → Paramètres du serveur WebSocket → Afficher les informations de connexion. Un mot de passe saisi ici n’est pas enregistré.", "请留空。本应用会读取 OBS 在这台电脑上保存的密码。只有连接失败时才需要在此输入密码。密码可在 OBS 的「工具 → WebSocket 服务器设置 → 显示连接信息」中找到。在此输入的密码不会被保存。" } },
      { "discover", new[] { "Read scenes and inputs from OBS", "Leer escenas y entradas de OBS", "Lire les scènes et entrées d’OBS", "从 OBS 读取场景和输入" } },
      { "cueTitle", new[] { "3   Try a cue", "3   Prueba una escena", "3   Essayer une scène", "3   试切一个场景" } },
      { "cueHint", new[] {
        "Click Save & start controls below and bring OBS to the front. Press D-pad down on the controller, or select OBS Fadester for TourBox in Console and turn Scroll one step: Preview should change and Program should stay put. Pull the right trigger or turn the Dial to fade between them.",
        "Haz clic en Guardar e iniciar abajo y pon OBS en primer plano. Pulsa la cruceta hacia abajo en el mando, o selecciona OBS Fadester for TourBox en Console y gira Scroll un paso: la vista previa debería cambiar mientras el programa permanece igual. Tira del gatillo derecho o gira Dial para fundir entre ambos.",
        "Cliquez sur Enregistrer et démarrer ci-dessous, puis mettez OBS au premier plan. Appuyez sur le bas du pavé directionnel de la manette, ou sélectionnez OBS Fadester for TourBox dans Console et tournez Scroll d’un cran : l’aperçu doit changer et le programme rester fixe. Tirez la gâchette droite ou tournez Dial pour faire un fondu entre les deux.",
        "点击下方的「保存并启动控制」，然后将 OBS 置于前台。按手柄方向键的下键，或在 Console 中选择 OBS Fadester for TourBox 并将 Scroll 转动一格：预览应切换而节目保持不变。扣右扳机或转动 Dial 可在两者之间淡入淡出。" } },
      { "inputsTitle", new[] { "Optional   Assign your inputs", "Opcional   Asigna tus entradas", "Facultatif   Affecter les entrées", "可选   分配输入" } },
      { "inputsHint", new[] {
        "Open Assignments to pick Music, Content and your scene shortcuts. Empty assignments do nothing.",
        "Abre Asignaciones para elegir Música, Contenido y los atajos de escena. Las asignaciones vacías no hacen nada.",
        "Ouvrez Affectations pour choisir la musique, le contenu et les raccourcis de scènes. Une affectation vide reste inactive.",
        "打开「分配」，选择音乐、内容和场景快捷键。未分配的控制不会执行操作。" } },
      { "mixTitle", new[] { "Optional   Fade all OBS mixer inputs", "Opcional   Atenúa toda la mezcla de OBS", "Facultatif   Atténuer tout le mixage OBS", "可选   渐变 OBS 混音器的所有输入" } },
      { "enableMix", new[] { "Enable All OBS mixer inputs", "Controlar todas las entradas del mezclador de OBS", "Piloter toutes les entrées du mixeur OBS", "启用 OBS 混音器全部输入控制" } },
      { "mixHint", new[] {
        "One relative fade for the public audio inputs in this scene collection, including newly added inputs. Their balance is preserved. All tracks and monitors fed by these inputs follow the fade; mutes and routing stay as set.",
        "Aplica un fundido relativo a las entradas de audio de la colección de escenas, incluidas las nuevas, y conserva su equilibrio. Se ajustan todas las pistas y salidas de monitorización que reciben esas entradas. El silencio y el enrutamiento se mantienen.",
        "Un même fondu relatif pour les entrées audio publiques de cette collection de scènes, y compris les nouvelles. Leur équilibre est préservé. Les pistes et retours alimentés par ces entrées suivent le fondu. Les coupures et le routage restent tels quels.",
        "对场景集合中所有公开的音频输入（包括新添加的输入）应用同一相对音量渐变，保持原有平衡。由这些输入供给的音轨和监听都会随之渐变，静音状态和路由保持原样。" } },
      { "mixOnly", new[] { "Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)", "Usar solo Stream Deck, OpenDeck o MIDI (sin TourBox, sin mando de juego, sin VJster)", "Utiliser Stream Deck, OpenDeck ou MIDI seuls (sans TourBox, sans manette de jeu, sans VJster)", "仅使用 Stream Deck、OpenDeck 或 MIDI（不使用 TourBox、游戏手柄和 VJster）" } },
      { "mixStep", new[] { "Group step (dB)", "Paso del grupo (dB)", "Pas du groupe (dB)", "组音量步长 (dB)" } },
      { "mixFade", new[] { "Group fade (ms)", "Fundido del grupo (ms)", "Fondu du groupe (ms)", "组渐变时长 (ms)" } },
      { "vjsterTitle", new[] { "Optional   VJster: YouTube from the TourBox", "Opcional   VJster: YouTube desde el TourBox", "Facultatif   VJster : YouTube depuis le TourBox", "可选   VJster：用 TourBox 控制 YouTube" } },
      { "enableVjster", new[] { "Enable VJster (the Chrome extension connects to the companion)", "Activar VJster (la extensión de Chrome se conecta al puente)", "Activer VJster (l’extension Chrome se connecte au compagnon)", "启用 VJster（Chrome 扩展程序连接到此伴侣程序）" } },
      { "gamepadTitle", new[] { "Game controller", "Mando de juego", "Manette de jeu", "游戏手柄" } },
      { "enableGamepad", new[] { "Use an Xbox or XInput game controller", "Usar un mando de Xbox o XInput", "Utiliser une manette Xbox ou XInput", "使用 Xbox 或 XInput 游戏手柄" } },
      { "gamepadHint", new[] {
        "The right trigger is the T-bar: pull to mix, pull all the way to take, let go early to go back. A takes, B cuts, the D-pad cues Preview and rides Music, and the left trigger ducks Music while you hold it. View resets the T-bar after an error. The controller keeps working while OBS is in front.",
        "El gatillo derecho es el T-bar: tira para mezclar, tira hasta el fondo para pasar a programa y suelta antes para volver. A hace la transición, B corta, la cruceta elige la vista previa y ajusta la música, y el gatillo izquierdo baja la música mientras lo mantienes. View reinicia el T-bar tras un error. El mando sigue funcionando con OBS en primer plano.",
        "La gâchette droite est le T-bar : tirez pour mélanger, tirez jusqu’au bout pour passer au programme, relâchez avant pour revenir. A lance la transition, B coupe, le pavé directionnel choisit l’aperçu et règle la musique, et la gâchette gauche baisse la musique tant que vous la tenez. View réinitialise le T-bar après une erreur. La manette continue de fonctionner quand OBS est au premier plan.",
        "右扳机就是 T-bar：扣下即混合，扣到底即切换到节目，中途松开则返回。A 执行转场，B 直接切换，方向键选择预览场景并调节音乐，按住左扳机时音乐会压低。出错后按 View 重置 T-bar。OBS 在前台时手柄仍可使用。" } },
      { "vjsterHint", new[] { "The raised Knob changes the speed of the YouTube video playing in Chrome: press and turn for fine steps, hold Side and press it to return to 1x. Press and turn Scroll for the quality; Side + D-pad Up plays or pauses. Needs the free VJster Chrome extension, which talks only to this computer. OBS can be closed.", "El mando elevado cambia la velocidad del vídeo de YouTube que se reproduce en Chrome: púlsalo y gíralo para pasos finos; mantén Side y púlsalo para volver a 1x. Pulsa y gira Scroll para la calidad; Side + cruceta ↑ reproduce o pausa. Necesita la extensión gratuita VJster para Chrome, que solo habla con este equipo. OBS puede estar cerrado.", "Le bouton surélevé change la vitesse de la vidéo YouTube lue dans Chrome : appuyez et tournez pour des pas fins ; maintenez Side et appuyez pour revenir à 1x. Appuyez et tournez Scroll pour la qualité ; Side + pavé ↑ lance ou met en pause. Nécessite l’extension Chrome gratuite VJster, qui ne parle qu’à cet ordinateur. OBS peut être fermé.", "凸起旋钮调整 Chrome 中正在播放的 YouTube 视频速度：按住旋钮转动可微调，按住 Side 再按旋钮恢复 1 倍速。按住 Scroll 转动调整画质；Side + 方向键 ↑ 播放或暂停。需要免费的 VJster Chrome 扩展程序，它只与这台电脑通信。OBS 可以关闭。" } },
      { "vjsterPort", new[] { "VJster port", "Puerto de VJster", "Port VJster", "VJster 端口" } },
      { "vjsterExtensionId", new[] { "Only this extension", "Solo esta extensión", "Seulement cette extension", "仅限此扩展程序" } },
      { "gamepadEasy", new[] { "Easy mode: hold a button 0.4 s to take, cut or change what is on air (0.7 s to fade out or mute the mic; 0.15 s to start pushing the T-bar), so a stray press does nothing", "Modo fácil: mantén pulsado un botón 0,4 s para hacer la transición, cortar o cambiar lo que está en emisión (0,7 s para fundir a silencio o silenciar el micrófono; 0,15 s para empezar a empujar el T-bar), para que una pulsación accidental no haga nada", "Mode facile : maintenez un bouton 0,4 s pour lancer la transition, couper ou changer ce qui est à l’antenne (0,7 s pour faire un fondu au silence ou couper le micro ; 0,15 s pour commencer à pousser le T-bar), afin qu’un appui accidentel ne fasse rien", "简易模式：转场、切换或其他改变直播画面的操作需按住按钮 0.4 秒（淡出或麦克风静音需 0.7 秒；开始推动 T-bar 需 0.15 秒），误按不会生效" } },
      { "padMapTitle", new[] { "Controller map", "Mapa del mando", "Affectation de la manette", "手柄映射" } },
      { "padMapHint", new[] { "Choose what each control does. The right trigger is always the T-bar. Anything in the With LB held column makes LB a shift button, and LB then does nothing on its own. Changes apply the next time the controls start.", "Elige qué hace cada control. El gatillo derecho es siempre el T-bar. Cualquier acción en la columna «Con LB pulsado» convierte LB en un botón modificador, y entonces LB no hace nada por sí solo. Los cambios se aplican la próxima vez que se inicien los controles.", "Choisissez l’action de chaque commande. La gâchette droite est toujours le T-bar. Toute action dans la colonne « LB maintenu » fait de LB un bouton modificateur, et LB ne fait alors plus rien seul. Les changements s’appliquent au prochain démarrage des commandes.", "选择每个控制件的功能。右扳机始终是 T-bar。只要在「按住 LB 时」一列中设置了动作，LB 就会成为修饰键，单独按 LB 不再有任何作用。更改会在下次启动控制时生效。" } },
      { "padShift", new[] { "With LB held", "Con LB pulsado", "LB maintenu", "按住 LB 时" } },
      { "padFree", new[] { "(free)", "(libre)", "(libre)", "（无）" } },
      { "padReset", new[] { "Reset to defaults", "Restablecer valores predeterminados", "Rétablir les valeurs par défaut", "恢复默认" } },
      { "padResetDone", new[] { "Controller map back to the defaults. Save to keep it.", "Mapa del mando restablecido a los valores predeterminados. Guarda para conservarlo.", "Affectation de la manette revenue aux valeurs par défaut. Enregistrez pour la garder.", "手柄映射已恢复默认。请保存以保留。" } },
      { "padFast", new[] { "Fast speed preset", "Velocidad rápida predefinida", "Vitesse rapide prédéfinie", "快速播放预设" } },
      { "padSlow", new[] { "Slow speed preset", "Velocidad lenta predefinida", "Vitesse lente prédéfinie", "慢速播放预设" } },
      { "padRelease", new[] { "let go", "al soltar", "relâchement", "松开" } },
      { "speedFast", new[] { "Video speed: fast preset", "Velocidad del vídeo: rápida predefinida", "Vitesse vidéo : rapide prédéfinie", "视频速度：快速预设" } },
      { "speedSlow", new[] { "Video speed: slow preset", "Velocidad del vídeo: lenta predefinida", "Vitesse vidéo : lente prédéfinie", "视频速度：慢速预设" } },
      { "padMapMissing", new[] { "The controller map file is missing, so the Game controller tab is off. Reinstall Fadester Companion.", "Falta el archivo del mapa del mando, así que la pestaña Mando de juego está desactivada. Reinstala Fadester Companion.", "Le fichier d’affectation de la manette est introuvable : l’onglet Manette de jeu est désactivé. Réinstallez Fadester Companion.", "缺少手柄映射文件，「游戏手柄」标签页已停用。请重新安装 Fadester Companion。" } },
      { "vjsterIdHint", new[] { "Leave empty to accept any VJster extension. The extension's options page shows its id.", "Déjalo vacío para aceptar cualquier extensión VJster. La página de opciones de la extensión muestra su id.", "Laissez vide pour accepter toute extension VJster. La page d’options de l’extension affiche son identifiant.", "留空则接受任何 VJster 扩展程序。扩展程序的选项页面会显示其 ID。" } },
      { "layersTitle", new[] { "VJ layers: blend modes and opacity", "Capas VJ: modos de fusión y opacidad", "Calques VJ : modes de fusion et opacité", "VJ 图层：混合模式与不透明度" } },
      { "layersHint", new[] { "Two sources in your mix scene. Hold Top and turn the Knob to cycle Layer 1's blend mode, Scroll for Layer 2's, and the Dial to ride Layer 2's opacity through a Color Correction filter (added when the source has none).", "Dos fuentes de tu escena de mezcla. Mantén Top y gira el mando para recorrer el modo de fusión de la capa 1, Scroll para la capa 2 y Dial para la opacidad de la capa 2 mediante un filtro de corrección de color (se añade si la fuente no tiene).", "Deux sources de votre scène de mixage. Maintenez Top et tournez le bouton pour faire défiler le mode de fusion du calque 1, Scroll pour le calque 2 et Dial pour l’opacité du calque 2 via un filtre de correction colorimétrique (ajouté si la source n’en a pas).", "混合场景中的两个来源。按住 Top 转动旋钮可循环切换图层 1 的混合模式，转动 Scroll 切换图层 2 的混合模式，转动 Dial 通过色彩校正滤镜调整图层 2 的不透明度（来源没有该滤镜时会自动添加）。" } },
      { "layer1Scene", new[] { "Layer 1 scene", "Escena de la capa 1", "Scène du calque 1", "图层 1 场景" } },
      { "layer1Source", new[] { "Layer 1 source", "Fuente de la capa 1", "Source du calque 1", "图层 1 来源" } },
      { "layer2Scene", new[] { "Layer 2 scene", "Escena de la capa 2", "Scène du calque 2", "图层 2 场景" } },
      { "layer2Source", new[] { "Layer 2 source", "Fuente de la capa 2", "Source du calque 2", "图层 2 来源" } },
      { "opacityStep", new[] { "Opacity step (%)", "Paso de opacidad (%)", "Pas d’opacité (%)", "不透明度步长 (%)" } },
      { "assignments", new[] { "Assignments", "Asignaciones", "Affectations", "分配" } },
      { "assignTitle", new[] { "Choose the OBS sources you want to control", "Elige las fuentes de OBS que quieres controlar", "Choisir les sources OBS à piloter", "选择要控制的 OBS 来源" } },
      { "assignHint", new[] {
        "Assignments apply after Save & start, or after restarting the controls. Choose scenes by name; nothing is assigned based on its list position.",
        "Las asignaciones se aplican al guardar e iniciar o al reiniciar los controles. Elige las escenas por nombre; el orden de la lista no las asigna.",
        "Les affectations s’appliquent à l’enregistrement et au démarrage ou au redémarrage des commandes. Choisissez les scènes par leur nom, indépendamment de leur position dans la liste.",
        "保存并启动或重启控制后，分配才会生效。请按名称选择场景，列表顺序不会自动分配场景。" } },
      { "musicInput", new[] { "Music / bed", "Música / fondo", "Musique / fond", "音乐 / 背景音" } },
      { "contentInput", new[] { "Content / guest", "Contenido / invitado", "Contenu / invité", "内容 / 嘉宾" } },
      { "micInput", new[] { "Microphone", "Micrófono", "Microphone", "麦克风" } },
      { "mediaInput", new[] { "Media / Playlister", "Medios / Playlister", "Média / Playlister", "媒体 / Playlister" } },
      { "overlayScene", new[] { "Overlay scene", "Escena de superposición", "Scène de l’incrustation", "叠加层场景" } },
      { "overlaySource", new[] { "Overlay source", "Fuente de superposición", "Source de l’incrustation", "叠加层来源" } },
      { "up", new[] { "D-pad Up", "Cruceta ↑", "Pavé ↑", "方向键 ↑" } },
      { "right", new[] { "D-pad Right", "Cruceta →", "Pavé →", "方向键 →" } },
      { "down", new[] { "D-pad Down", "Cruceta ↓", "Pavé ↓", "方向键 ↓" } },
      { "left", new[] { "D-pad Left", "Cruceta ←", "Pavé ←", "方向键 ←" } },
      { "assignFirstFour", new[] { "Assign the first four OBS scenes to anchors 1 to 4", "Asignar las primeras cuatro escenas de OBS a las anclas 1 a 4", "Affecter les quatre premières scènes OBS aux ancres 1 à 4", "将 OBS 的前四个场景分配给锚点 1 至 4" } },
      { "discoverFirst", new[] { "Read the scene list from OBS first.", "Primero lee la lista de escenas de OBS.", "Lisez d’abord la liste des scènes d’OBS.", "请先从 OBS 读取场景列表。" } },
      { "assignPreviewed", new[] { "Anchors 1 to 4 are filled in. Save to keep them.", "Anclas 1 a 4 rellenadas. Guarda para conservarlas.", "Ancres 1 à 4 remplies. Enregistrez-les pour les conserver.", "锚点 1 至 4 已填入。保存后即可保留。" } },
      { "adjust", new[] { "Adjust the feel", "Ajusta la respuesta", "Ajuster la réponse", "调整控制手感" } },
      { "musicStep", new[] { "Music step (dB)", "Paso de música (dB)", "Pas de la musique (dB)", "音乐音量步长 (dB)" } },
      { "duckCeiling", new[] { "Duck ceiling (dB)", "Límite de atenuación (dB)", "Plafond d’atténuation (dB)", "闪避音量上限 (dB)" } },
      { "fadeTicks", new[] { "Ticks per full fade", "Pasos del fundido", "Crans du fondu complet", "完整淡变所需格数" } },
      { "timingStep", new[] { "Timing step (ms)", "Paso de tiempo (ms)", "Pas de durée (ms)", "时长步长 (ms)" } },
      { "adjustHint", new[] {
        "Press and turn the Dial for a quarter fade step; hold Short and turn the Knob for a quarter Music step. Duck never raises a quiet input.",
        "Mantén pulsado y gira el Dial para ajustar el fundido un cuarto de paso; mantén pulsado Short y gira el Knob para ajustar la música un cuarto de paso. Atenuar nunca sube el volumen de una entrada baja.",
        "Enfoncez et tournez le Dial pour un quart de pas de fondu ; maintenez Short et tournez le Knob pour un quart de pas de musique. L’atténuation ne relève pas le niveau d’une entrée déjà faible.",
        "按住 Dial 转动，可按四分之一格微调淡变；按住 Short 并转动 Knob，可按四分之一格微调音乐。闪避不会提高原本较低的输入音量。" } },
      { "controlMap", new[] { "Control map", "Mapa de controles", "Plan des commandes", "控制映射" } },
      { "control", new[] { "Control", "Control", "Commande", "控制件" } },
      { "gesture", new[] { "Gesture", "Gesto", "Geste", "操作" } },
      { "action", new[] { "Action", "Acción", "Action", "动作" } },
      { "menu", new[] { "Tour menu", "Menú Tour", "Menu Tour", "Tour 菜单" } },
      { "press", new[] { "Press", "Pulsar", "Appuyer", "按下" } },
      { "select", new[] { "Select", "Elegir", "Choisir", "选择" } },
      { "cw", new[] { "Clockwise", "Horario", "Horaire", "顺时针" } },
      { "ccw", new[] { "Counterclockwise", "Antihorario", "Antihoraire", "逆时针" } },
      { "activity", new[] { "Activity", "Actividad", "Activité", "活动" } },
      { "saveStart", new[] { "Save && start controls", "Guardar e iniciar", "Enregistrer et démarrer", "保存并启动控制" } },
      { "save", new[] { "Save assignments", "Guardar asignaciones", "Enregistrer les affectations", "保存分配" } },
      { "feedback", new[] { "Show / hide feedback", "Mostrar / ocultar avisos", "Afficher / masquer l’état", "显示 / 隐藏反馈" } },
      { "guide", new[] { "Quick guide", "Guía rápida", "Guide rapide", "快速指南" } },
      { "stillClosing", new[] {
        "The bridge is still completing its current action. Keep the panel open and try Close again.",
        "El puente aún está completando la acción actual. Deja el panel abierto e intenta cerrarlo de nuevo.",
        "Le pont termine encore l’action en cours. Laissez le panneau ouvert, puis réessayez de le fermer.",
        "桥接程序仍在完成当前操作。请保持面板打开，稍后再试关闭。" } },
      { "configUnreadable", new[] {
        "Cannot read config.json. Back up or repair the file in {0}.",
        "No se puede leer config.json. Haz una copia de seguridad o repara el archivo en {0}.",
        "Impossible de lire config.json. Sauvegardez ou réparez le fichier dans {0}.",
        "无法读取 config.json。请备份或修复 {0} 中的文件。" } },
      { "mapUnreadable", new[] { "Cannot read the control map. Install Fadester Companion again, or extract the whole ZIP again.", "No se puede leer el mapa de controles. Vuelve a instalar Fadester Companion o vuelve a extraer todo el archivo ZIP.", "Impossible de lire le plan des commandes. Réinstallez Fadester Companion ou extrayez à nouveau tout le fichier ZIP.", "无法读取控制映射。请重新安装 Fadester Companion，或重新解压整个 ZIP 文件。" } },
      { "cannotWrite", new[] { "Existing config could not be read.", "No se pudo leer la configuración existente.", "Impossible de lire la configuration existante.", "无法读取现有配置。" } },
      { "saved", new[] { "Assignments saved.", "Asignaciones guardadas.", "Affectations enregistrées.", "分配已保存。" } },
      { "savedRestart", new[] {
        "Assignments saved. Stop and restart controls to apply.",
        "Asignaciones guardadas. Detén y reinicia los controles para aplicarlas.",
        "Affectations enregistrées. Arrêtez puis redémarrez les commandes pour les appliquer.",
        "分配已保存。请停止并重启控制以应用更改。" } },
      { "bridgeMissing", new[] { "A file of the app is missing: FadesterTourBoxBridge.exe. Install Fadester Companion again, or extract the whole ZIP again.", "Falta un archivo de la aplicación: FadesterTourBoxBridge.exe. Vuelve a instalar Fadester Companion o vuelve a extraer todo el archivo ZIP.", "Un fichier de l’application est introuvable : FadesterTourBoxBridge.exe. Réinstallez Fadester Companion ou extrayez à nouveau tout le fichier ZIP.", "缺少应用文件：FadesterTourBoxBridge.exe。请重新安装 Fadester Companion，或重新解压整个 ZIP 文件。" } },
      { "obsTimeout", new[] {
        "OBS did not answer. Check the port and password.",
        "OBS no responde. Comprueba el puerto y la contraseña.",
        "OBS n’a pas répondu. Vérifiez le port et le mot de passe.",
        "OBS 没有响应。请检查端口和密码。" } },
      { "obsUnavailable", new[] {
        "Cannot connect to OBS. Check WebSocket settings.",
        "No se puede conectar con OBS. Comprueba los ajustes de WebSocket.",
        "Impossible de se connecter à OBS. Vérifiez les paramètres WebSocket.",
        "无法连接 OBS。请检查 WebSocket 设置。" } },
      { "noScenes", new[] { "Bridge returned no scene list.", "El puente no devolvió la lista de escenas.", "Le pont n’a pas renvoyé la liste des scènes.", "桥接程序未返回场景列表。" } },
      { "sceneSummary", new[] {
        "Program: {0}   •   Preview: {1}   •   Studio Mode: {2}",
        "Programa: {0}   •   Vista previa: {1}   •   Modo Estudio: {2}",
        "Programme : {0}   •   Aperçu : {1}   •   Mode Studio : {2}",
        "节目：{0}   •   预览：{1}   •   工作室模式：{2}" } },
      { "on", new[] { "On", "Activo", "Activé", "开启" } },
      { "off", new[] { "Off", "Inactivo", "Désactivé", "关闭" } },
      { "obsConnected", new[] { "Connected to OBS. Scenes found: {0}.", "Conexión con OBS establecida. Escenas encontradas: {0}.", "Connexion à OBS établie. Scènes trouvées : {0}.", "已连接 OBS。找到 {0} 个场景。" } },
      { "stopped", new[] { "Controls stopped.", "Controles detenidos.", "Commandes arrêtées.", "控制已停止。" } },
      { "bridgeFailed", new[] {
        "Could not start or continue controls. See Activity for the shortcut or connection error.",
        "No se pudieron iniciar o mantener los controles. Consulta Actividad para ver el error de atajo o conexión.",
        "Impossible de démarrer ou de maintenir les commandes. Consultez Activité pour voir l’erreur de raccourci ou de connexion.",
        "无法启动或继续控制。请在「活动」中查看快捷键或连接错误。" } },
      { "bridgeNotStarted", new[] { "Bridge did not start.", "El puente no se inició.", "Le pont n’a pas démarré.", "桥接程序未启动。" } },
      { "stop", new[] { "Stop controls", "Detener controles", "Arrêter les commandes", "停止控制" } },
      { "starting", new[] { "Starting the controls…", "Iniciando los controles…", "Démarrage des commandes…", "正在启动控制…" } },
      { "finishing", new[] {
        "The bridge is still finishing its current action. Click Stop controls again to end it.",
        "El puente aún está terminando la acción actual. Haz clic de nuevo en Detener controles para cerrarlo.",
        "Le pont termine encore l’action en cours. Cliquez de nouveau sur Arrêter les commandes pour le fermer.",
        "桥接程序仍在完成当前操作。再次点击「停止控制」即可结束它。" } },
      { "bridgeEnded", new[] {
        "The bridge did not stop in time, so the panel ended it. Check the T-bar and the selected transition in OBS.",
        "El puente no se detuvo a tiempo, así que el panel lo cerró. Comprueba en OBS el T-bar y la transición seleccionada.",
        "Le pont ne s’est pas arrêté à temps : le panneau l’a donc fermé. Vérifiez dans OBS le T-bar et la transition sélectionnée.",
        "桥接程序未能及时停止，面板已将其结束。请在 OBS 中检查 T-bar 和所选的转场。" } },
      { "openSettings", new[] { "Open settings folder", "Abrir la carpeta de configuración", "Ouvrir le dossier des paramètres", "打开设置文件夹" } },
      { "lastAction", new[] { "Fadester · last action", "Fadester · última acción", "Fadester · dernière action", "Fadester · 最近操作" } },
      { "obsNoAnswer", new[] { "OBS is not answering. Start OBS. In OBS, open Tools → WebSocket Server Settings and turn on Enable WebSocket server. Then click Read scenes and inputs from OBS.", "OBS no responde. Inicia OBS. En OBS, abre Herramientas → Ajustes del servidor WebSocket y activa Habilitar servidor WebSocket. Después haz clic en Leer escenas y entradas de OBS.", "OBS ne répond pas. Démarrez OBS. Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket et cochez Activer le serveur WebSocket. Cliquez ensuite sur Lire les scènes et entrées d’OBS.", "OBS 没有响应。请启动 OBS。在 OBS 中打开「工具 → WebSocket 服务器设置」，勾选「启用 WebSocket 服务器」。然后点击「从 OBS 读取场景和输入」。" } },
      { "obsNoPassword", new[] { "OBS has no WebSocket password yet. In OBS, open Tools → WebSocket Server Settings. Turn on Enable WebSocket server and Enable Authentication, then click OK. Then click Read scenes and inputs from OBS.", "OBS aún no tiene contraseña de WebSocket. En OBS, abre Herramientas → Ajustes del servidor WebSocket. Activa Habilitar servidor WebSocket y Habilitar autenticación, y haz clic en Aceptar. Después haz clic en Leer escenas y entradas de OBS.", "OBS n’a pas encore de mot de passe WebSocket. Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket. Cochez Activer le serveur WebSocket et Activer l’authentification, puis cliquez sur OK. Cliquez ensuite sur Lire les scènes et entrées d’OBS.", "OBS 还没有 WebSocket 密码。在 OBS 中打开「工具 → WebSocket 服务器设置」，勾选「启用 WebSocket 服务器」和「启用身份验证」，然后点击「确定」。再点击「从 OBS 读取场景和输入」。" } },
      { "obsAuthOff", new[] { "Authentication is off in OBS. In OBS, open Tools → WebSocket Server Settings and turn on Enable Authentication. Then click Read scenes and inputs from OBS.", "La autenticación está desactivada en OBS. En OBS, abre Herramientas → Ajustes del servidor WebSocket y activa Habilitar autenticación. Después haz clic en Leer escenas y entradas de OBS.", "L’authentification est désactivée dans OBS. Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket et cochez Activer l’authentification. Cliquez ensuite sur Lire les scènes et entrées d’OBS.", "OBS 中的身份验证已关闭。在 OBS 中打开「工具 → WebSocket 服务器设置」，勾选「启用身份验证」。然后点击「从 OBS 读取场景和输入」。" } },
      { "obsBadPassword", new[] { "OBS did not accept the password. In OBS, open Tools → WebSocket Server Settings and click Show Connect Info. Type that password in OBS password (optional) on the Setup tab.", "OBS no aceptó la contraseña. En OBS, abre Herramientas → Ajustes del servidor WebSocket y haz clic en Mostrar información de conexión. Escribe esa contraseña en Contraseña de OBS (opcional), en la pestaña Configuración.", "OBS n’a pas accepté le mot de passe. Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket et cliquez sur Afficher les informations de connexion. Saisissez ce mot de passe dans Mot de passe OBS (facultatif), dans l’onglet Configuration.", "OBS 不接受该密码。在 OBS 中打开「工具 → WebSocket 服务器设置」，点击「显示连接信息」。在「设置」标签页的「OBS 密码（可选）」中输入该密码。" } },
      { "keepOpen", new[] { "Keep this window open while you work. Closing it stops the controls.", "Mantén esta ventana abierta mientras trabajas. Si la cierras, los controles se detienen.", "Gardez cette fenêtre ouverte pendant que vous travaillez. La fermer arrête les commandes.", "工作时请保持此窗口打开。关闭窗口会停止控制。" } },
      { "liObsOn", new[] { "OBS: connected", "OBS: conectado", "OBS : connecté", "OBS：已连接" } },
      { "liObsLooking", new[] { "OBS: connecting…", "OBS: conectando…", "OBS : connexion…", "OBS：正在连接…" } },
      { "liObsClosed", new[] { "OBS: not running", "OBS: no está abierto", "OBS : non lancé", "OBS：未运行" } },
      { "liObsSetting", new[] { "OBS: one setting to turn on", "OBS: falta activar un ajuste", "OBS : un réglage à activer", "OBS：有一项设置需要开启" } },
      { "liObsPassword", new[] { "OBS: password not accepted", "OBS: contraseña no aceptada", "OBS : mot de passe refusé", "OBS：密码未被接受" } },
      { "liObsStudio", new[] { "OBS: turn on Studio Mode", "OBS: activa el modo Estudio", "OBS : activez le mode Studio", "OBS：请开启工作室模式" } },
      { "liPadOn", new[] { "Controller: connected", "Mando: conectado", "Manette : connectée", "手柄：已连接" } },
      { "liPadReady", new[] { "Controller: ready", "Mando: listo", "Manette : prête", "手柄：就绪" } },
      { "liPadMissing", new[] { "Controller: not found", "Mando: no encontrado", "Manette : introuvable", "手柄：未找到" } },
      { "liPadIdle", new[] { "Controller: plugged in, not in use", "Mando: conectado, sin usar", "Manette : branchée, non utilisée", "手柄：已插入，未启用" } },
      { "liPadOff", new[] { "Controller: off", "Mando: desactivado", "Manette : désactivée", "手柄：已关闭" } },
      { "liCtlOn", new[] { "Controls: on", "Controles: activos", "Commandes : actives", "控制：已开启" } },
      { "liCtlOff", new[] { "Controls: off", "Controles: detenidos", "Commandes : arrêtées", "控制：已关闭" } },
      { "btnShowMe", new[] { "Show me", "Muéstramelo", "Montrez-moi", "演示给我看" } },
      { "btnUseIt", new[] { "Use it", "Usarlo", "L’utiliser", "启用" } },
      { "btnStart", new[] { "Start", "Iniciar", "Démarrer", "启动" } },
      { "btnClose", new[] { "Close", "Cerrar", "Fermer", "关闭" } },
      { "remindObsOpen", new[] { "Keep the main OBS window open, not minimised: the T-bar needs it.", "Mantén abierta la ventana principal de OBS, sin minimizar: el T-bar la necesita.", "Gardez la fenêtre principale d’OBS ouverte, pas réduite : le T-bar en a besoin.", "请保持 OBS 主窗口打开，不要最小化：T-bar 需要它。" } },
      { "remindObsFront", new[] { "TourBox: bring OBS to the front. Its preset only works while OBS is the active window.", "TourBox: pon OBS en primer plano. Su preajuste solo funciona mientras OBS es la ventana activa.", "TourBox : mettez OBS au premier plan. Son préréglage ne fonctionne que lorsque OBS est la fenêtre active.", "TourBox：请将 OBS 置于前台。其预设只在 OBS 为活动窗口时生效。" } },
      { "showServerTitle", new[] { "Turn on OBS's WebSocket server", "Activa el servidor WebSocket de OBS", "Activer le serveur WebSocket d’OBS", "开启 OBS 的 WebSocket 服务器" } },
      { "showPasswordTitle", new[] { "Find OBS's WebSocket password", "Busca la contraseña WebSocket de OBS", "Trouver le mot de passe WebSocket d’OBS", "查找 OBS 的 WebSocket 密码" } },
      { "showStudioTitle", new[] { "Turn on Studio Mode", "Activa el modo Estudio", "Activer le mode Studio", "开启工作室模式" } },
      { "showStudioHint", new[] { "In OBS, click Studio Mode under Controls, at the bottom right of the main window, and choose the Fade transition beside it. Then click Read scenes and inputs from OBS.", "En OBS, haz clic en Modo estudio, en Controles, abajo a la derecha de la ventana principal, y elige la transición Desvanecimiento a su lado. Después haz clic en Leer escenas y entradas de OBS.", "Dans OBS, cliquez sur Mode studio dans Commandes, en bas à droite de la fenêtre principale, et choisissez la transition Fondu à côté. Cliquez ensuite sur Lire les scènes et entrées d’OBS.", "在 OBS 中，点击主窗口右下角「控件」中的「工作室模式」，并在旁边选择「淡入淡出」转场。然后点击「从 OBS 读取场景和输入」。" } },
      { "obsUiTools", new[] { "Tools", "Herramientas", "Outils", "工具" } },
      { "obsUiWsSettings", new[] { "WebSocket Server Settings", "Ajustes del servidor WebSocket", "Paramètres du serveur WebSocket", "WebSocket 服务器设置" } },
      { "obsUiEnable", new[] { "Enable WebSocket server", "Habilitar servidor WebSocket", "Activer le serveur WebSocket", "启用 WebSocket 服务器" } },
      { "obsUiAuth", new[] { "Enable Authentication", "Habilitar autenticación", "Activer l’authentification", "启用身份验证" } },
      { "obsUiConnectInfo", new[] { "Show Connect Info", "Mostrar información de conexión", "Afficher les informations de connexion", "显示连接信息" } },
      { "obsUiOk", new[] { "OK", "Aceptar", "OK", "确定" } },
      { "obsUiStudio", new[] { "Studio Mode", "Modo estudio", "Mode studio", "工作室模式" } },
      { "obsUiFade", new[] { "Fade", "Desvanecimiento", "Fondu", "淡入淡出" } },
      { "anchorField", new[] { "Preview anchor {0} (TourBox {1})", "Ancla vista previa {0} (TourBox {1})", "Ancre d’aperçu {0} (TourBox {1})", "预览锚点 {0}（TourBox {1}）" } },
      { "vsNotLoaded", new[] { "Visual Sidechain: NOT LOADED", "Visual Sidechain: NO CARGADO", "Visual Sidechain : NON CHARGÉ", "Visual Sidechain：未加载" } },
      { "vsPanic", new[] { "Visual Sidechain: PANIC", "Visual Sidechain: PÁNICO", "Visual Sidechain : PANIQUE", "Visual Sidechain：紧急停止" } },
      { "vsNoAudio", new[] { "Visual Sidechain: NO AUDIO", "Visual Sidechain: SIN AUDIO", "Visual Sidechain : SANS AUDIO", "Visual Sidechain：无音频" } },
      { "vsMeterActive", new[] { "Visual Sidechain: {0} BPM · Beat {1}/4 · {2}", "Visual Sidechain: {0} BPM · Pulso {1}/4 · {2}", "Visual Sidechain : {0} BPM · Temps {1}/4 · {2}", "Visual Sidechain：{0} BPM · 第 {1}/4 拍 · {2}" } },
      { "vsMeterLocked", new[] { "Visual Sidechain: {0} BPM [LOCK] · Beat {1}/4 · {2}", "Visual Sidechain: {0} BPM [FIJO] · Pulso {1}/4 · {2}", "Visual Sidechain : {0} BPM [FIXE] · Temps {1}/4 · {2}", "Visual Sidechain：{0} BPM [锁定] · 第 {1}/4 拍 · {2}" } },
    };

    internal PanelText(string requestedLocale) {
      Locale = Normalize(requestedLocale);
      PanelExtraText.Messages.TryGetValue(Locale, out extra);
    }

    static string Normalize(string locale) {
      string code = (locale ?? "").Trim().Replace('_', '-').ToLowerInvariant();
      if (code == "zh-tw" || code == "zh-hk" || code == "zh-mo" || code == "zh-cht" ||
          code == "zh-hant" || code.StartsWith("zh-hant-", StringComparison.Ordinal)) return "zh-TW";
      if (code == "zh" || code == "zh-cn" || code == "zh-sg" || code == "zh-chs" ||
          code == "zh-hans" || code.StartsWith("zh-hans-", StringComparison.Ordinal)) return "zh-CN";
      var primary = code.Split('-')[0];
      return Locales.Contains(primary) || PanelExtraText.Messages.ContainsKey(primary) ? primary : "en";
    }

    internal static PanelText FromArguments(string[] args, CultureInfo culture) {
      for (int i = 0; i < args.Length; i++) {
        if (args[i].Equals("--language", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
          return new PanelText(args[i + 1]);
        if (args[i].StartsWith("--language=", StringComparison.OrdinalIgnoreCase))
          return new PanelText(args[i].Substring("--language=".Length));
      }
      return new PanelText(culture.Name);
    }

    internal string Locale { get; private set; }

    internal string Get(string key, params object[] values) {
      var translations = Messages[key];
      var builtIn = Array.IndexOf(Locales, Locale);
      string text;
      if (builtIn >= 0) text = translations[builtIn];
      else if (extra == null || !extra.TryGetValue(key, out text)) text = translations[0];
      return values.Length == 0 ? text : String.Format(CultureInfo.CurrentCulture, text, values);
    }

    // The bridge ends the message of each way OBS can refuse a connection with its code (ObsSetupException).
    static readonly Regex ObsProblem = new Regex(@"\((obs-no-answer|obs-no-password|obs-auth-off|obs-bad-password)\)");
    static readonly Dictionary<string,string> ObsProblemKeys = new Dictionary<string,string> {
      { "obs-no-answer", "obsNoAnswer" }, { "obs-no-password", "obsNoPassword" },
      { "obs-auth-off", "obsAuthOff" }, { "obs-bad-password", "obsBadPassword" } };

    /** A bridge line in this language when it is one of the OBS connection problems; otherwise the line itself. */
    internal string Explain(string line) {
      var match = ObsProblem.Match(line ?? "");
      return match.Success ? Get(ObsProblemKeys[match.Groups[1].Value]) : line;
    }

    /** The OBS connection problem a bridge line names (obs-no-answer and so on), or null. */
    internal static string ProblemCode(string line) {
      var match = ObsProblem.Match(line ?? "");
      return match.Success ? match.Groups[1].Value : null;
    }

    internal string Control(string control) {
      if (control == "Tour menu") return Get("menu");
      return String.Join(" + ", control.Split('+').Select(part => {
        if (part == "press" || part == "up" || part == "right" || part == "down" || part == "left") return Get(part);
        if (part.Length == 0) return part;
        if (part == "c1" || part == "c2") return part.ToUpperInvariant();
        return Char.ToUpperInvariant(part[0]) + part.Substring(1);
      }));
    }

    internal string Gesture(string gesture) {
      switch (gesture) {
        case "press": case "select": case "cw": case "ccw": return Get(gesture);
        default: return gesture;
      }
    }

    internal string PresetFolder(string folder) {
      var root = Path.Combine(folder, "presets");
      var localized = Path.Combine(root, Locale);
      return Locale != "en" && File.Exists(Path.Combine(localized, PresetName)) ? localized : root;
    }

    internal string PresetPath(string folder) { return Path.Combine(PresetFolder(folder), PresetName); }

    internal string MapPath(string folder) {
      var localized = Path.Combine(PresetFolder(folder), "map.json");
      return File.Exists(localized) ? localized : Path.Combine(folder, "presets", "map.json");
    }

    internal string GuidePath(string folder) {
      var localized = Path.Combine(folder, "guide", Locale + ".html");
      return Locale != "en" && File.Exists(localized) ? localized : Path.Combine(folder, "START-HERE.html");
    }

    internal static void Test() {
      var english = FromArguments(new string[0], CultureInfo.GetCultureInfo("nl-NL"));
      var chinese = FromArguments(new[] { "--language", "zh-Hans" }, CultureInfo.GetCultureInfo("fr-CA"));
      if (english.Locale != "en" || chinese.Locale != "zh-CN" || chinese.Get("setup") != "设置" ||
          FromArguments(new string[0], CultureInfo.GetCultureInfo("fr-CA")).Locale != "fr" ||
          FromArguments(new[] { "--language=es-MX" }, CultureInfo.InvariantCulture).Locale != "es" ||
          new PanelText("de-DE").Locale != "de" || new PanelText("zh-Hant-HK").Locale != "zh-TW" ||
          !chinese.Get("obsConnected", 14).Contains("14"))
        throw new InvalidOperationException("Panel language selection failed.");
      if (chinese.Explain("ERROR: OBS did not accept the password. (obs-bad-password)") != chinese.Get("obsBadPassword") ||
          english.Explain("Offline: OBS is not answering on port 4455. (obs-no-answer)") != english.Get("obsNoAnswer") ||
          english.Explain("Offline: OBS disconnected.") != "Offline: OBS disconnected.")
        throw new InvalidOperationException("Panel OBS problem texts failed.");
      var folder = Path.Combine(Path.GetTempPath(), "fadester-panel-test-" + Guid.NewGuid().ToString("N"));
      if (chinese.PresetFolder(folder) != Path.Combine(folder, "presets") ||
          chinese.GuidePath(folder) != Path.Combine(folder, "START-HERE.html") ||
          chinese.MapPath(folder) != Path.Combine(folder, "presets", "map.json"))
        throw new InvalidOperationException("Panel asset fallback failed.");
      foreach (var row in Messages) {
        if (row.Value.Length != Locales.Length) throw new InvalidOperationException("Incomplete panel message: " + row.Key);
        foreach (var value in row.Value) CheckTranslation(row.Key, row.Value[0], value);
      }
      foreach (var locale in new[] { "de", "it", "ja", "ko", "ru", "zh-TW" }) {
        var translation = PanelExtraText.Messages[locale];
        if (translation.Count != Messages.Count) throw new InvalidOperationException("Incomplete panel language: " + locale);
        foreach (var row in Messages) CheckTranslation(locale + ":" + row.Key, row.Value[0], translation[row.Key]);
      }
    }

    static void CheckTranslation(string key, string english, string text) {
      if (String.IsNullOrWhiteSpace(text) || !Placeholders(english).SequenceEqual(Placeholders(text)))
        throw new InvalidOperationException("Invalid panel translation: " + key);
      // Reject unmatched format braces while permitting translators to reorder placeholders.
      if (Placeholder.IsMatch(english)) String.Format(CultureInfo.InvariantCulture, text, "1", "2", "3");
    }

    static IEnumerable<string> Placeholders(string text) {
      return Placeholder.Matches(text).Cast<Match>().Select(match => match.Value).OrderBy(value => value);
    }
  }
}
