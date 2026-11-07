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
        "OBS Fadester for TourBox is already open. Check the taskbar.",
        "OBS Fadester for TourBox ya está abierto. Comprueba la barra de tareas.",
        "OBS Fadester for TourBox est déjà ouvert. Vérifiez la barre des tâches.",
        "OBS Fadester for TourBox 已打开。请查看任务栏。" } },
      { "lookingForObs", new[] { "Looking for OBS on this PC…", "Buscando OBS en este equipo…", "Recherche d’OBS sur ce PC…", "正在此电脑上查找 OBS…" } },
      { "setup", new[] { "Setup", "Configuración", "Configuration", "设置" } },
      { "importTitle", new[] { "1   Import the preset", "1   Importa el preajuste", "1   Importer le préréglage", "1   导入预设" } },
      { "importHint", new[] {
        "In TourBox Console, import OBS Fadester for TourBox.tb from the folder below. Link this preset to OBS Studio. Press Tour to open the production menu.",
        "En TourBox Console, importa OBS Fadester for TourBox.tb desde la carpeta de abajo. Vincula el preajuste a OBS Studio. Pulsa Tour para abrir el menú de producción.",
        "Dans TourBox Console, importez OBS Fadester for TourBox.tb depuis le dossier ci-dessous. Associez le préréglage à OBS Studio. Appuyez sur Tour pour ouvrir le menu de production.",
        "在 TourBox Console 中，从下方文件夹导入 OBS Fadester for TourBox.tb，并将预设关联到 OBS Studio。按 Tour 键可打开制作菜单。" } },
      { "openPreset", new[] { "Open preset folder", "Abrir carpeta del preajuste", "Ouvrir le dossier du préréglage", "打开预设文件夹" } },
      { "connectTitle", new[] { "2   Connect to OBS", "2   Conecta con OBS", "2   Se connecter à OBS", "2   连接 OBS" } },
      { "connectHint", new[] {
        "In OBS, open Tools → WebSocket Server Settings and enable the server. Keep authentication on. For the manual crossfader, turn on Studio Mode and choose Fade.",
        "En OBS, abre Herramientas → Ajustes del servidor WebSocket y actívalo. Mantén activa la autenticación. Para la transición manual, activa el modo Estudio y elige Desvanecimiento.",
        "Dans OBS, ouvrez Outils → Paramètres du serveur WebSocket et activez le serveur. Laissez l’authentification activée. Pour le fondu manuel, activez le mode Studio et choisissez Fondu.",
        "在 OBS 中，打开「工具 → WebSocket 服务器设置」并启用服务器。保持身份验证开启。若要手动淡入淡出，请启用工作室模式并选择淡入淡出转场。" } },
      { "port", new[] { "Local port", "Puerto local", "Port local", "本地端口" } },
      { "password", new[] { "Password override", "Otra contraseña", "Autre mot de passe", "覆盖密码" } },
      { "passwordHint", new[] {
        "On this PC the bridge can use OBS’s saved password. A password typed here lasts only until you close this window.",
        "El puente puede usar la contraseña que OBS guarda en este equipo. Si escribes otra aquí, se usará solo hasta que cierres esta ventana.",
        "Le pont peut utiliser le mot de passe enregistré par OBS sur ce PC. Tout mot de passe saisi ici est oublié à la fermeture de cette fenêtre.",
        "桥接程序可以使用这台电脑上 OBS 保存的密码。在此处输入的密码只在本窗口打开期间有效。" } },
      { "discover", new[] { "Read scenes and inputs from OBS", "Leer escenas y entradas de OBS", "Lire les scènes et entrées d’OBS", "从 OBS 读取场景和输入" } },
      { "cueTitle", new[] { "3   Try a cue", "3   Prueba una escena", "3   Essayer une scène", "3   试切一个场景" } },
      { "cueHint", new[] {
        "Start controls below. Select OBS Fadester for TourBox in Console and focus OBS. Turn Scroll one step: Preview should change and Program should stay put. Use the Dial to fade between them.",
        "Inicia los controles abajo. Selecciona OBS Fadester for TourBox en Console y vuelve a OBS. Gira Scroll un paso. La vista previa debería cambiar mientras la salida permanece igual. Usa Dial para hacer la transición.",
        "Démarrez les commandes ci-dessous. Sélectionnez OBS Fadester for TourBox dans Console, puis revenez dans OBS. Tournez Scroll d’un cran. L’aperçu doit changer et le programme rester fixe. Utilisez Dial pour faire un fondu.",
        "在下方启动控制。在 Console 中选择 OBS Fadester for TourBox，然后切回 OBS。将 Scroll 转动一格，预览应切换而节目画面保持不变。转动 Dial 可在两者之间淡入淡出。" } },
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
      { "mixOnly", new[] { "Use only Stream Deck, OpenDeck or MIDI (no TourBox shortcuts)", "Usar solo Stream Deck, OpenDeck o MIDI (sin atajos de TourBox)", "Utiliser Stream Deck, OpenDeck ou MIDI seuls (sans raccourcis TourBox)", "仅使用 Stream Deck、OpenDeck 或 MIDI（不启用 TourBox 快捷键）" } },
      { "mixStep", new[] { "Group step (dB)", "Paso del grupo (dB)", "Pas du groupe (dB)", "组音量步长 (dB)" } },
      { "mixFade", new[] { "Group fade (ms)", "Fundido del grupo (ms)", "Fondu du groupe (ms)", "组渐变时长 (ms)" } },
      { "vjsterTitle", new[] { "Optional   VJster: YouTube from the TourBox", "Opcional   VJster: YouTube desde el TourBox", "Facultatif   VJster : YouTube depuis le TourBox", "可选   VJster：用 TourBox 控制 YouTube" } },
      { "enableVjster", new[] { "Enable VJster (the Chrome extension connects to the companion)", "Activar VJster (la extensión de Chrome se conecta al puente)", "Activer VJster (l’extension Chrome se connecte au compagnon)", "启用 VJster（Chrome 扩展程序连接到此伴侣程序）" } },
      { "vjsterHint", new[] { "The raised Knob changes the speed of the YouTube video playing in Chrome: press and turn for fine steps, hold Side and press it to return to 1x. Press and turn Scroll for the quality; Side + D-pad Up plays or pauses. Needs the free VJster Chrome extension, which talks only to this computer. OBS can be closed.", "El mando elevado cambia la velocidad del vídeo de YouTube que se reproduce en Chrome: púlsalo y gíralo para pasos finos; mantén Side y púlsalo para volver a 1x. Pulsa y gira Scroll para la calidad; Side + cruceta ↑ reproduce o pausa. Necesita la extensión gratuita VJster para Chrome, que solo habla con este equipo. OBS puede estar cerrado.", "Le bouton surélevé change la vitesse de la vidéo YouTube lue dans Chrome : appuyez et tournez pour des pas fins ; maintenez Side et appuyez pour revenir à 1x. Appuyez et tournez Scroll pour la qualité ; Side + pavé ↑ lance ou met en pause. Nécessite l’extension Chrome gratuite VJster, qui ne parle qu’à cet ordinateur. OBS peut être fermé.", "凸起旋钮调整 Chrome 中正在播放的 YouTube 视频速度：按住旋钮转动可微调，按住 Side 再按旋钮恢复 1 倍速。按住 Scroll 转动调整画质；Side + 方向键 ↑ 播放或暂停。需要免费的 VJster Chrome 扩展程序，它只与这台电脑通信。OBS 可以关闭。" } },
      { "vjsterPort", new[] { "VJster port", "Puerto de VJster", "Port VJster", "VJster 端口" } },
      { "vjsterExtensionId", new[] { "Only this extension", "Solo esta extensión", "Seulement cette extension", "仅限此扩展程序" } },
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
      { "assignFirstFour", new[] { "Assign first four OBS scenes to D-pad", "Asignar las primeras cuatro escenas a la cruceta", "Affecter les quatre premières scènes au pavé", "将 OBS 的前四个场景分配给方向键" } },
      { "discoverFirst", new[] { "Read the scene list from OBS first.", "Primero lee la lista de escenas de OBS.", "Lisez d’abord la liste des scènes d’OBS.", "请先从 OBS 读取场景列表。" } },
      { "assignPreviewed", new[] { "D-pad assignments previewed. Save to keep them.", "Asignaciones de la cruceta listas. Guárdalas para conservarlas.", "Affectations du pavé préparées. Enregistrez-les pour les conserver.", "方向键分配已预填。保存后即可保留。" } },
      { "adjust", new[] { "Adjust the feel", "Ajusta la respuesta", "Ajuster la réponse", "调整控制手感" } },
      { "musicStep", new[] { "Music step (dB)", "Paso de música (dB)", "Pas de la musique (dB)", "音乐音量步长 (dB)" } },
      { "duckCeiling", new[] { "Duck ceiling (dB)", "Límite de atenuación (dB)", "Plafond d’atténuation (dB)", "闪避音量上限 (dB)" } },
      { "fadeTicks", new[] { "Ticks per full fade", "Pasos del fundido", "Crans du fondu complet", "完整淡变所需格数" } },
      { "timingStep", new[] { "Timing step (ms)", "Paso de tiempo (ms)", "Pas de durée (ms)", "时长步长 (ms)" } },
      { "adjustHint", new[] {
        "Press and turn Music or Fade for a quarter step. Duck never raises a quiet input.",
        "Pulsa y gira el mando de música o de fundido para avanzar un cuarto de paso. Atenuar nunca sube el volumen de una entrada baja.",
        "Appuyez et tournez la commande de musique ou de fondu pour avancer d’un quart de cran. L’atténuation ne relève pas le niveau d’une entrée déjà faible.",
        "按住音乐或淡变旋钮转动，可按四分之一格微调。闪避不会提高原本较低的输入音量。" } },
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
      { "mapUnreadable", new[] {
        "Could not read the control map. Extract the entire ZIP before running Fadester.",
        "No se pudo leer el mapa de controles. Extrae todo el archivo ZIP antes de ejecutar Fadester.",
        "Impossible de lire le plan des commandes. Extrayez tout le fichier ZIP avant de lancer Fadester.",
        "无法读取控制映射。请解压整个 ZIP 文件后再运行 Fadester。" } },
      { "cannotWrite", new[] { "Existing config could not be read.", "No se pudo leer la configuración existente.", "Impossible de lire la configuration existante.", "无法读取现有配置。" } },
      { "saved", new[] { "Assignments saved.", "Asignaciones guardadas.", "Affectations enregistrées.", "分配已保存。" } },
      { "savedRestart", new[] {
        "Assignments saved. Stop and restart controls to apply.",
        "Asignaciones guardadas. Detén y reinicia los controles para aplicarlas.",
        "Affectations enregistrées. Arrêtez puis redémarrez les commandes pour les appliquer.",
        "分配已保存。请停止并重启控制以应用更改。" } },
      { "bridgeMissing", new[] {
        "Extract the whole ZIP: FadesterTourBoxBridge.exe is missing.",
        "Extrae todo el archivo ZIP. Falta FadesterTourBoxBridge.exe.",
        "Extrayez tout le fichier ZIP. FadesterTourBoxBridge.exe est introuvable.",
        "请解压整个 ZIP 文件。未找到 FadesterTourBoxBridge.exe。" } },
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
      { "starting", new[] { "Starting controller…", "Iniciando el controlador…", "Démarrage du contrôleur…", "正在启动控制器…" } },
      { "finishing", new[] { "Bridge is still finishing its current action.", "El puente aún está terminando la acción actual.", "Le pont termine encore l’action en cours.", "桥接程序仍在完成当前操作。" } },
      { "lastAction", new[] { "Fadester · last action", "Fadester · última acción", "Fadester · dernière action", "Fadester · 最近操作" } },
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
