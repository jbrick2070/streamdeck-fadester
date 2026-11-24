*Esta é uma tradução dos inícios rápidos em inglês, feita com um modelo de IA e verificada por um segundo modelo; ainda não foi revisada por nenhum falante nativo.*

# Início rápido: Fadester Companion e VJster

[Fadester Companion](#companion) · [Controle de jogo](#gamepad) · [VJster](#vjster) · [VJster: instalação](#vjster-install) · [VJster com o TourBox](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: um controle de jogo ou um TourBox para o OBS Studio

O Fadester Companion permite mixar cenas do OBS Studio no Windows com um controle Xbox ou outro controle XInput, um TourBox de tamanho normal, ou os dois. O gatilho direito do controle, ou o Dial plano do TourBox, move o T-bar do Modo Estúdio do OBS.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion em três passos: 1, instale e abra; 2, no OBS ative o servidor WebSocket, e a luz OBS do Fadester Companion fica verde; 3, coloque a próxima cena na pré-visualização e puxe o gatilho direito ou gire o Dial do TourBox: o T-bar do OBS acompanha." width="900">

1. **Instale e abra.** Baixe o **Fadester Companion** na [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) e abra-o pelo menu Iniciar. (Pelo ZIP: extraia tudo numa pasta que você vai manter e abra **Fadester Companion.exe**.)
2. **Conecte ao OBS.** No OBS, abra **Ferramentas → Configurações do servidor WebSocket**, marque **Ativar servidor WebSocket**, mantenha **Ativar autenticação** ligado e clique em **OK**. A luz **OBS** no alto do Fadester Companion fica verde. Âmbar? Clique no botão ao lado: **Ativar** liga o Modo Estúdio, **Mostre-me** mostra os cliques no OBS.
3. **Escolha seu controle e faça a transição.** Na aba **Configuração**, em **2 Escolha seu controle**, marque **Usar um controle de jogo Xbox ou XInput** (mantenha o **Modo fácil**) e clique em **Parar** e depois em **Iniciar**, no canto inferior esquerdo. Com um TourBox, siga em vez disso [Conectar um TourBox](../../../tourbox/README.md#connect-a-tourbox) (em inglês). Pressione o direcional para baixo (TourBox: gire o **Scroll**) para colocar a próxima cena na Pré-visualização e puxe o gatilho direito (TourBox: gire o **Dial** plano): o T-bar do OBS acompanha e, puxado até o fim, a Pré-visualização vai para o Programa.

Pronto.

[Guia completo (em inglês)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Controle de jogo

Controle o OBS com um controle Xbox (ou qualquer controle compatível com XInput): o gatilho direito é um T-bar de verdade, e os botões colocam uma cena na Pré-visualização e mandam a Pré-visualização para o Programa. Funciona dentro do Fadester Companion no Windows.

<img src="../../gamepad/controller-map.svg" alt="Os comandos padrão de um controle XInput: o gatilho direito é o T-bar, A manda a Pré-visualização para o Programa, B corta, o direcional para cima e para baixo coloca a cena acima ou abaixo na Pré-visualização, esquerda e direita ajustam a música, o gatilho esquerdo abaixa a música, View cancela um fade manual e Menu coloca a cena do Programa na Pré-visualização." width="900">

1. **Conecte o controle e ative a conexão do OBS.** Conecte o controle (USB ou Xbox Wireless; o Windows não precisa de outro driver). No OBS, abra **Ferramentas → Configurações do servidor WebSocket**, marque **Ativar servidor WebSocket**, deixe **Ativar autenticação** marcado e clique em **OK**.
2. **Abra o Fadester Companion** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), depois o menu Iniciar; [guia de configuração (em inglês)](../../../tourbox/README.md)). A luz **OBS** no alto fica verde (âmbar: clique em **Mostre-me** ao lado). Se a luz **Controle** disser que ele está conectado, sem uso, clique em **Usar**. Senão, na aba **Configuração**, em **2 Escolha seu controle**, marque **Usar um controle de jogo Xbox ou XInput**, deixe o **Modo fácil** marcado e clique em **Iniciar** se a luz **Controles** não estiver verde.
3. **Faça a transição.** No OBS 33, ative o **Modo Estúdio**, escolha a transição **Esmaecer** (Fade) e pressione o direcional para baixo para colocar a próxima cena na Pré-visualização. Puxe o gatilho direito até a metade: o T-bar do OBS acompanha. Solte: ele volta. Puxe até o fim: a Pré-visualização vai para o Programa.

Pronto. As luzes no alto mostram *Controle: conectado* e *Controles: ligados*.

[Guia completo (em inglês)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

O **VJster 1.5.0** controla a velocidade de um vídeo do YouTube pelo seu Stream Deck: gire um dial e o vídeo acelera ou desacelera enquanto toca; uma tecla põe 0.5x, 1x ou 2x. Funciona numa aba do Chrome, numa fonte de navegador do OBS ou nas duas; nada sai deste computador.

<img src="../../vjster/install-steps.svg" alt="VJster em três passos: 1, pegue as teclas (Fadester for OBS no Stream Deck, ou Fadester Companion); 2, adicione a extensão VJster pela Chrome Web Store; 3, reproduza um vídeo do YouTube e gire o dial: a velocidade acompanha." width="900">

1. **Pegue as teclas.** Tem o **Fadester for OBS 0.9.0 ou mais recente**? Ele já tem as sete ações do VJster: pule este passo. Senão, clique duas vezes em `com.jbrick2070.vjster.streamDeckPlugin` e aceite os perfis incluídos (**VJster Live +** e **VJster Dual +** para o Stream Deck +, **VJster Live** para 15 teclas, **VJster Mini**).
2. **Adicione a extensão do Chrome.** Adicione o [VJster pela Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). A página de opções dele abre uma vez.
3. **Experimente.** Arraste **VJster Speed** para um dial ou **VJster Speed Preset** para uma tecla (o Stream Deck mostra os nomes das ações em inglês; no plugin VJster eles se chamam **Speed** e **Speed Preset**, ou mude para um perfil do VJster). Reproduza um vídeo do YouTube no Chrome. Em poucos segundos a faixa VELOCIDADE (SPEED em inglês) ou a tecla 1x mostra que ele está tocando. Gire o dial.

Pronto. Se a faixa disser **SEM EXTENSÃO** (EXTENSION OFF em inglês), veja *When something is off* no [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) (em inglês).

[Guia completo (em inglês)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: instalação

O VJster permite que seu Stream Deck, seu TourBox ou seu controle de jogo mudem a velocidade e a qualidade de um vídeo do YouTube no Chrome.

<img src="../../vjster/install-steps.svg" alt="VJster em três passos: 1, pegue as teclas (Fadester for OBS no Stream Deck, ou Fadester Companion); 2, adicione a extensão VJster pela Chrome Web Store; 3, reproduza um vídeo do YouTube e gire o dial: a velocidade acompanha." width="900">

1. **Pegue as teclas.** Instale o [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) no Stream Deck: a lista de ações dele já tem as sete ações do **VJster**. (Usa um TourBox ou um controle de jogo? Instale o [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) e inicie os controles dele.)
2. **Adicione a extensão do Chrome.** Adicione o [VJster pela Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) (Chrome 116 ou mais recente).
3. **Experimente.** Coloque **VJster Speed** numa tecla ou num dial e reproduza um vídeo do YouTube no Chrome. Em poucos segundos a tecla mostra o vídeo tocando; gire o dial e o vídeo acompanha. Uma aba que já estava aberta: recarregue-a uma vez.

Pronto. O OBS não precisa estar aberto.

[Guia completo (em inglês)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## VJster com o TourBox

A única extensão do Chrome do VJster funciona pelo Stream Deck, pelo OpenDeck e pelo TourBox. Com um TourBox, o próprio Fadester Companion cuida da conexão com a extensão.

1. **Prepare o TourBox.** Instale o Fadester Companion e importe o preset dele: [Conectar um TourBox](../../../tourbox/README.md#connect-a-tourbox) (em inglês).
2. **Adicione a extensão do Chrome.** Adicione o [VJster pela Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) e reproduza um vídeo do YouTube no Chrome.
3. **Gire o Knob elevado.** A velocidade do vídeo acompanha. Toque em **Side** para voltar a 1x.

Pronto. O OBS pode estar fechado.

[Guia completo (em inglês)](../../vjster/TOURBOX.md)
