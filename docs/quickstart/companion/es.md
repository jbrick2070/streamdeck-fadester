*Esta es una traducción de los inicios rápidos en inglés, hecha con un modelo de IA y revisada por un segundo modelo; todavía no la ha revisado ningún hablante nativo.*

# Inicio rápido: Fadester Companion y VJster

[Fadester Companion](#companion) · [Mando de juego](#gamepad) · [VJster](#vjster) · [VJster: instalación](#vjster-install) · [VJster con TourBox](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: un mando de juego o un TourBox para OBS Studio

Fadester Companion te permite mezclar escenas de OBS Studio en Windows con un mando de Xbox u otro mando XInput, un TourBox de tamaño completo, o ambos. El gatillo derecho del mando, o el Dial plano del TourBox, mueve el T-bar del Modo estudio de OBS.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion en tres pasos: 1, instálalo y ábrelo; 2, en OBS activa el servidor WebSocket y la luz OBS de Fadester Companion se pone verde; 3, prepara la siguiente escena en vista previa y aprieta el gatillo derecho o gira el Dial del TourBox: el T-bar de OBS lo sigue." width="900">

1. **Instala y abre.** Descarga **Fadester Companion** de [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) y ábrelo desde el menú Inicio. (Desde el ZIP: extrae todo en una carpeta que vayas a conservar y abre **Fadester Companion.exe**.)
2. **Conéctalo con OBS.** En OBS, abre **Herramientas → Ajustes del servidor WebSocket**, marca **Habilitar servidor WebSocket**, deja activado **Habilitar autenticación** y haz clic en **Aceptar**. La luz **OBS** de la parte superior de Fadester Companion se pone verde. ¿Ámbar? Haz clic en el botón de al lado: **Activar** activa el Modo estudio y **Muéstramelo** reproduce los clics en OBS.
3. **Elige tu mando y haz la transición.** En la pestaña **Configuración**, bajo **2 Elige tu controlador**, marca **Usar un mando de Xbox o XInput** (deja el **Modo fácil**) y haz clic en **Detener** y luego en **Iniciar**, abajo a la izquierda. Con un TourBox, sigue en su lugar [Conectar un TourBox](../../../tourbox/README.md#connect-a-tourbox) (en inglés). Pulsa abajo en la cruceta (TourBox: gira **Scroll**) para preparar la siguiente escena en vista previa y aprieta el gatillo derecho (TourBox: gira el **Dial** plano): el T-bar de OBS lo sigue y, a fondo, la vista previa pasa a programa.

Eso es todo.

[Guía completa (en inglés)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Mando de juego

Controla OBS con un mando de Xbox (o cualquier mando compatible con XInput): el gatillo derecho es un T-bar de verdad y los botones preparan una escena en vista previa y pasan la vista previa a programa. Funciona dentro de Fadester Companion en Windows.

<img src="../../gamepad/controller-map.svg" alt="Los controles por defecto de un mando XInput: el gatillo derecho es el T-bar, A pasa la vista previa a programa, B corta, arriba y abajo en la cruceta preparan la escena anterior o siguiente en vista previa, izquierda y derecha ajustan la música, el gatillo izquierdo baja la música, View cancela una transición manual y Menu pone en vista previa la escena de programa." width="900">

1. **Conecta el mando y permite la conexión de OBS.** Conecta el mando (USB o Xbox Wireless; Windows no necesita otro controlador). En OBS, abre **Herramientas → Ajustes del servidor WebSocket**, marca **Habilitar servidor WebSocket**, deja marcado **Habilitar autenticación** y haz clic en **Aceptar**.
2. **Abre Fadester Companion** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) y luego el menú Inicio; [guía de configuración (en inglés)](../../../tourbox/README.md)). La luz **OBS** de arriba se pone verde (ámbar: haz clic en **Muéstramelo** a su lado). Si la luz **Mando** dice que está conectado pero sin usar, haz clic en **Usarlo**. Si no, en la pestaña **Configuración**, bajo **2 Elige tu controlador**, marca **Usar un mando de Xbox o XInput**, deja marcado el **Modo fácil** y haz clic en **Iniciar** si la luz **Controles** no está en verde.
3. **Haz la transición.** En OBS 33 activa el **Modo estudio**, elige la transición **Desvanecimiento** (Fade) y pulsa abajo en la cruceta para preparar la siguiente escena en vista previa. Aprieta el gatillo derecho hasta la mitad: el T-bar de OBS lo sigue. Suéltalo: vuelve atrás. Apriétalo a fondo: la vista previa pasa a programa.

Eso es todo. Las luces de arriba muestran *Mando: conectado* y *Controles: activos*.

[Guía completa (en inglés)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** controla la velocidad de un vídeo de YouTube desde tu Stream Deck: gira un dial y el vídeo se acelera o se frena mientras se reproduce; una tecla pone 0.5x, 1x o 2x. Funciona en una pestaña de Chrome, en una fuente de navegador de OBS o en ambas; nada sale de este equipo.

<img src="../../vjster/install-steps.svg" alt="VJster en tres pasos: 1, consigue las teclas (Fadester for OBS en Stream Deck, o Fadester Companion); 2, añade la extensión VJster desde Chrome Web Store; 3, reproduce un vídeo de YouTube y gira el dial: la velocidad lo sigue." width="900">

1. **Consigue las teclas.** ¿Tienes **Fadester for OBS 0.9.0 o posterior**? Ya incluye las siete acciones de VJster: sáltate este paso. Si no, haz doble clic en `com.jbrick2070.vjster.streamDeckPlugin` y acepta los perfiles incluidos (**VJster Live +** y **VJster Dual +** para Stream Deck +, **VJster Live** para 15 teclas, **VJster Mini**).
2. **Añade la extensión de Chrome.** Añade [VJster desde Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Su página de opciones se abre una vez.
3. **Pruébalo.** Arrastra **VJster Velocidad** a un dial o **VJster Velocidad fija** a una tecla (en el plugin VJster se llaman **Velocidad** y **Velocidad fija**, o cambia a un perfil de VJster). Reproduce un vídeo de YouTube en Chrome. En pocos segundos la tira VELOCIDAD (o la tecla 1x) muestra que se reproduce. Gira el dial.

Eso es todo. Si la tira dice **SIN EXTENSIÓN**, consulta *When something is off* en [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) (en inglés).

[Guía completa (en inglés)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: instalación

VJster permite que tu Stream Deck, tu TourBox o tu mando de juego cambien la velocidad y la calidad de un vídeo de YouTube en Chrome.

<img src="../../vjster/install-steps.svg" alt="VJster en tres pasos: 1, consigue las teclas (Fadester for OBS en Stream Deck, o Fadester Companion); 2, añade la extensión VJster desde Chrome Web Store; 3, reproduce un vídeo de YouTube y gira el dial: la velocidad lo sigue." width="900">

1. **Consigue las teclas.** Instala [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) en Stream Deck: su lista de acciones ya tiene las siete acciones de **VJster**. (¿Usas un TourBox o un mando de juego? Instala [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) e inicia sus controles.)
2. **Añade la extensión de Chrome.** Añade [VJster desde Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) (Chrome 116 o posterior).
3. **Pruébalo.** Pon **VJster Velocidad** en una tecla o un dial y reproduce un vídeo de YouTube en Chrome. En pocos segundos la tecla muestra el vídeo en reproducción; gira el dial y el vídeo lo sigue. Si la pestaña ya estaba abierta, recárgala una vez.

Eso es todo. OBS no tiene que estar abierto.

[Guía completa (en inglés)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## VJster con TourBox

La única extensión de Chrome de VJster funciona desde Stream Deck, OpenDeck y TourBox. Con un TourBox, Fadester Companion aloja él mismo la conexión de la extensión.

1. **Prepara el TourBox.** Instala Fadester Companion e importa su preset: [Conectar un TourBox](../../../tourbox/README.md#connect-a-tourbox) (en inglés).
2. **Añade la extensión de Chrome.** Añade [VJster desde Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) y reproduce un vídeo de YouTube en Chrome.
3. **Gira el Knob elevado.** La velocidad del vídeo lo sigue. Toca **Side** para volver a 1x.

Eso es todo. OBS puede estar cerrado.

[Guía completa (en inglés)](../../vjster/TOURBOX.md)
