# Fadester for OBS: inicios rápidos

*Esta es una traducción de los inicios rápidos en inglés, hecha con un modelo de IA y revisada por un segundo modelo de IA; todavía no la ha revisado ningún hablante nativo.*

[Fadester for OBS](#fadester-for-obs) · [Empieza aquí](#start-here) · [Disposiciones listas](#layouts) · [OpenDeck](#opendeck) · [Un plugin con VJster](#suite) · [Archivos de disposición a mano](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS lleva OBS Studio a tu Stream Deck: escenas, transiciones, fuentes, filtros y audio en teclas y diales.

<img src="../../docs/images/first-key-steps.svg" alt="La primera tecla en tres pasos: 1, haz doble clic en el archivo .streamDeckPlugin e instálalo; 2, en OBS, Herramientas → Ajustes del servidor WebSocket, activa el servidor; 3, arrastra Escena a una tecla en Stream Deck y púlsala: OBS pasa a la escena siguiente." width="900">

1. **Instala el plugin.** En la [página de versiones](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), descarga el archivo que termina en `.streamDeckPlugin` y haz doble clic en él. Confirma la instalación en Stream Deck.
2. **Activa el servidor WebSocket de OBS.** En OBS: **Herramientas → Ajustes del servidor WebSocket**, activa el servidor y pulsa **Aceptar**. Deja la autenticación como está: no hay nada que copiar.
3. **Arrastra Escena a una tecla.** En la lista de acciones de Stream Deck, categoría *Fadester for OBS*, arrastra **Escena** a una tecla. Empieza como **Escena siguiente**: púlsala y OBS pasa a la escena siguiente.

Eso es todo. Con OBS en el mismo ordenador, el plugin se conecta solo. Mientras OBS no esté conectado, la tecla dice qué hacer, por ejemplo **Activa WebSocket en OBS** o **Abre OBS**.

[Guía completa (en inglés)](../../README.md)

<a id="start-here"></a>
## Fadester Suite: empieza aquí

Qué partes de Fadester Suite instalar para tu hardware y cómo configurar OBS una sola vez. La mayoría usa un Stream Deck:

<img src="../../docs/images/first-key-steps.svg" alt="La primera tecla en tres pasos: instala el plugin, activa el servidor WebSocket en OBS, arrastra Escena a una tecla." width="900">

1. **Instala Fadester for OBS.** Descarga el archivo `.streamDeckPlugin` de la [página de versiones](https://github.com/jbrick2070/streamdeck-fadester/releases/latest), haz doble clic e instálalo en Stream Deck.
2. **Activa el servidor WebSocket de OBS.** En OBS Studio 33: **Herramientas → Ajustes del servidor WebSocket**, activa el servidor, **Aceptar**. El plugin lee el puerto y la contraseña que OBS guardó.
3. **Arrastra Escena a una tecla** y púlsala: OBS pasa a la escena siguiente. Para llenar el deck, haz clic en la tecla, luego en la línea al pie de su página de ajustes, y abre **Disposiciones listas para usar**.

Eso es todo. ¿Otro controlador o más partes? La tabla está en la guía completa.

[Guía completa (en inglés)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS: disposiciones listas para usar

Catorce disposiciones para Stream Deck +, el Stream Deck de 15 teclas y Stream Deck Mini. Cada una se abre como un perfil que puedes editar.

<img src="../../docs/images/open-layout-steps.svg" alt="Una disposición lista en tres pasos: 1, haz clic en una tecla de Fadester for OBS; 2, haz clic en la línea al pie de la página y luego en Disposiciones listas para usar; 3, elige una y pulsa Abrir este diseño." width="900">

1. **Haz clic en una tecla de Fadester for OBS** en Stream Deck: se abren sus ajustes.
2. **Haz clic en la línea al pie de la página** (muestra la versión y la conexión) y abre **Disposiciones listas para usar**.
3. **Elige una disposición y pulsa Abrir este diseño.** Tu deck cambia a ella.

Eso es todo. Con OBS en el mismo ordenador y su servidor WebSocket activo, el plugin se conecta solo; todas las disposiciones usan esa conexión.

[Guía completa (en inglés)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## Fadester for OBS y VJster con OpenDeck

[OpenDeck](https://github.com/nekename/OpenDeck) es un programa libre y de código abierto que ejecuta plugins de Stream Deck sin el software Stream Deck de Elgato. Fadester for OBS funciona en él tal cual.

<img src="../../docs/images/opendeck-steps.svg" alt="Fadester for OBS en OpenDeck en tres pasos: 1, inicia OpenDeck con el deck conectado y el software Stream Deck cerrado; 2, instala Fadester for OBS desde el gestor de plugins; 3, elige la disposición en la lista de perfiles bajo el nombre del deck." width="900">

1. **Inicia OpenDeck.** Conecta el deck, cierra el software Stream Deck e inicia [OpenDeck](https://github.com/nekename/OpenDeck/releases). Este plugin necesita [Node.js](https://nodejs.org/) 24 o posterior.
2. **Instala Fadester.** En el gestor de plugins de OpenDeck, instala **Fadester for OBS** si aparece, o usa su botón de instalar desde archivo con la [descarga de Fadester](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin).
3. **Elige tu disposición** en la lista de perfiles bajo el nombre del deck: **Scene Desk + (Regular Mode)** para el Plus, **Scene Desk 15 Keys (Regular Mode)** para 15 teclas, **Source Desk Mini (Either Mode)** para el Mini. En otros modelos, arrastra **Escena** a una tecla.

Eso es todo, una vez activo el servidor WebSocket de OBS (**Herramientas → Ajustes del servidor WebSocket**). Con OBS en el mismo ordenador, Fadester se conecta con la contraseña guardada.

[Guía completa (en inglés)](../../docs/OPENDECK.md)

<a id="suite"></a>
## Fadester for OBS y VJster en un solo plugin

Fadester for OBS es un plugin con diecinueve acciones: doce de Fadester y siete de VJster.

1. **Instala Fadester for OBS una vez**, en Stream Deck o en OpenDeck (ver arriba).
2. **Las acciones de VJster están en la misma lista**, categoría *Fadester for OBS*: **VJster Velocidad**, **VJster Calidad**, etc.
3. **Añade la extensión de Chrome:** [VJster en Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Habla con el plugin por el puerto 48150.

Eso es todo. Ten VJster activo en un solo programa: este plugin, el plugin VJster independiente o Fadester Companion.

[Guía completa (en inglés)](../../docs/SUITE.md)

<a id="profiles"></a>
## La biblioteca de disposiciones de Fadester: importar un archivo a mano

Lo más fácil es abrir una disposición desde **Disposiciones listas para usar** (ver arriba). Para importar un archivo a mano:

1. **Haz doble clic en el archivo.** Elige el `.streamDeckProfile` de tu deck; Stream Deck lo importa como un perfil nuevo.
2. **Conecta OBS (normalmente no hay nada que hacer).** Con OBS en el mismo ordenador, Fadester se conecta solo. Si no, abre los ajustes de una tecla de Fadester, haz clic en la línea al pie de la página, abre **OBS en otro ordenador o en otro puerto**, escribe el host, el puerto y la contraseña y pulsa **Guardar para todos los controles y probar**.
3. **Pulsa las teclas.** Las teclas de escena siguen tu lista de escenas de OBS; los controles de música, micrófono y Aux ya han encontrado tus entradas de audio.

Eso es todo.

[Guía completa (en inglés)](../../profiles/README.md)
