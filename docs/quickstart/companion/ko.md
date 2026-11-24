*이 문서는 영어 빠른 시작을 번역한 것으로, AI 모델로 만들고 두 번째 모델이 검토했습니다. 아직 원어민 검토는 받지 않았습니다.*

# 빠른 시작: Fadester Companion과 VJster

[Fadester Companion](#companion) · [게임 컨트롤러](#gamepad) · [VJster](#vjster) · [VJster: 설치](#vjster-install) · [TourBox로 VJster 쓰기](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: OBS Studio용 게임 컨트롤러 또는 TourBox

Fadester Companion을 쓰면 Windows에서 Xbox 또는 기타 XInput 게임 컨트롤러, 풀사이즈 TourBox, 또는 둘 다로 OBS Studio 장면을 믹스할 수 있습니다. 컨트롤러의 오른쪽 트리거나 TourBox의 납작한 Dial이 OBS 스튜디오 모드의 T바를 움직입니다.

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion 3단계: 1, 설치하고 엽니다. 2, OBS에서 WebSocket 서버를 켜면 Fadester Companion의 OBS 표시등이 초록색이 됩니다. 3, 다음 장면을 미리보기에 올리고 오른쪽 트리거를 당기거나 TourBox의 Dial을 돌리면 OBS의 T바가 따라 움직입니다." width="900">

1. **설치하고 엽니다.** [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4)에서 **Fadester Companion**을 받아 시작 메뉴에서 여세요. (ZIP을 쓰는 경우: 계속 둘 폴더에 전부 압축을 풀고 **Fadester Companion.exe**를 여세요.)
2. **OBS와 연결합니다.** OBS에서 **도구 → WebSocket 서버 설정**을 열고 **WebSocket 서버 활성화**를 켜고, **인증 활성화**는 켠 채로 두고 **확인**을 클릭하세요. Fadester Companion 위쪽의 **OBS** 표시등이 초록색이 됩니다. 주황색이면 옆의 버튼을 클릭하세요. **켜기**는 스튜디오 모드를 켜고, **방법 보기**는 OBS에서 클릭할 곳을 보여 줍니다.
3. **컨트롤러를 고르고 전환합니다.** **설정** 탭의 **2 컨트롤러 선택**에서 **Xbox 또는 XInput 컨트롤러 사용**을 켜고(**쉬운 모드**는 그대로), 왼쪽 아래의 **중지**를 클릭한 다음 **시작**을 클릭하세요. TourBox를 쓴다면 대신 [TourBox 연결](../../../tourbox/README.md#connect-a-tourbox)(영어)을 따르세요. 십자키 아래(TourBox: **Scroll** 돌리기)로 다음 장면을 미리보기에 올린 뒤 오른쪽 트리거를 당기세요(TourBox: 납작한 **Dial** 돌리기). OBS의 T바가 따라 움직이고, 끝까지 당기면 미리보기가 프로그램으로 전환됩니다.

이게 전부입니다.

[전체 가이드(영어)](../../../tourbox/README.md)

<a id="gamepad"></a>

## 게임 컨트롤러

Xbox 컨트롤러(또는 XInput 호환 패드)로 OBS를 조작하세요. 오른쪽 트리거는 진짜 T바이고, 버튼으로 장면을 미리보기에 올리고 미리보기를 프로그램으로 보냅니다. Windows의 Fadester Companion 안에서 동작합니다.

<img src="../../gamepad/controller-map.svg" alt="XInput 컨트롤러의 기본 조작: 오른쪽 트리거는 T바, A는 미리보기를 프로그램으로, B는 컷, 십자키 위아래는 위나 아래 장면을 미리보기로, 좌우는 음악 조절, 왼쪽 트리거는 음악 줄이기, View는 수동 페이드 취소, Menu는 프로그램 장면을 미리보기로 설정." width="900">

1. **연결하고 OBS의 WebSocket을 켭니다.** 컨트롤러를 연결하세요(USB 또는 Xbox 무선, 별도 드라이버 불필요). OBS에서 **도구 → WebSocket 서버 설정**을 열고 **WebSocket 서버 활성화**를 켜고, **인증 활성화**는 켠 채로 두고 **확인**을 클릭하세요.
2. **Fadester Companion을 엽니다**([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4)에서 받은 뒤 시작 메뉴에서, [설정 가이드(영어)](../../../tourbox/README.md)). 위쪽의 **OBS** 표시등이 초록색이 됩니다(주황색이면 옆의 **방법 보기** 클릭). **컨트롤러** 표시등이 연결됐지만 사용하지 않는다고 하면 **사용**을 클릭하세요. 그렇지 않으면 **설정** 탭의 **2 컨트롤러 선택**에서 **Xbox 또는 XInput 컨트롤러 사용**을 켜고, **쉬운 모드**는 켠 채로 두고, **컨트롤** 표시등이 초록색이 아니면 **시작**을 클릭하세요.
3. **전환합니다.** OBS 33에서 **스튜디오 모드**를 켜고 **페이드**(Fade) 전환을 선택한 뒤, 십자키 아래로 다음 장면을 미리보기에 올리세요. 오른쪽 트리거를 반쯤 당기면 OBS의 T바가 따라 움직입니다. 놓으면 돌아갑니다. 끝까지 당기면 미리보기가 프로그램으로 전환됩니다.

이게 전부입니다. 위쪽 표시등에 *컨트롤러: 연결됨*과 *컨트롤: 켜짐*이 표시됩니다.

[전체 가이드(영어)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0**은 Stream Deck으로 YouTube 동영상의 속도를 조절합니다. 다이얼을 돌리면 재생 중인 동영상이 빨라지거나 느려지고, 키로 0.5x, 1x, 2x를 고를 수 있습니다. Chrome 탭, OBS 브라우저 소스, 또는 둘 다에서 동작하며, 이 컴퓨터 밖으로는 아무것도 나가지 않습니다.

<img src="../../vjster/install-steps.svg" alt="VJster 3단계: 1, 키 준비(Stream Deck의 Fadester for OBS 또는 Fadester Companion). 2, Chrome Web Store에서 VJster 확장 프로그램 추가. 3, YouTube 동영상을 재생하고 다이얼을 돌리면 속도가 따라옵니다." width="900">

1. **키를 준비합니다.** **Fadester for OBS 0.9.0 이상**이 있나요? 그렇다면 VJster 동작 일곱 개가 이미 들어 있으니 이 단계는 건너뛰세요. 없다면 `com.jbrick2070.vjster.streamDeckPlugin`을 더블클릭하고 함께 들어 있는 프로필(Stream Deck +용 **VJster Live +**와 **VJster Dual +**, 15키용 **VJster Live**, **VJster Mini**) 설치를 수락하세요.
2. **Chrome 확장 프로그램을 추가합니다.** [Chrome Web Store에서 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)를 추가하세요. 옵션 페이지가 한 번 열립니다.
3. **사용해 봅니다.** **VJster 속도**를 다이얼에, 또는 **VJster 속도 프리셋**을 키에 끌어 놓으세요(VJster 플러그인에서는 **속도**와 **속도 프리셋**이며, VJster 프로필로 바꿔도 됩니다). Chrome에서 YouTube 동영상을 재생하세요. 몇 초 안에 속도 스트립(또는 1x 키)에 재생 중으로 표시됩니다. 다이얼을 돌리세요.

이게 전부입니다. 스트립에 **확장 꺼짐**이 표시되면 [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off)의 *When something is off*(영어)를 보세요.

[전체 가이드(영어)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: 설치

VJster를 쓰면 Stream Deck, TourBox, 게임 컨트롤러로 Chrome의 YouTube 동영상 속도와 화질을 바꿀 수 있습니다.

<img src="../../vjster/install-steps.svg" alt="VJster 3단계: 1, 키 준비(Stream Deck의 Fadester for OBS 또는 Fadester Companion). 2, Chrome Web Store에서 VJster 확장 프로그램 추가. 3, YouTube 동영상을 재생하고 다이얼을 돌리면 속도가 따라옵니다." width="900">

1. **키를 준비합니다.** Stream Deck에 [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)를 설치하세요. 동작 목록에 **VJster** 동작 일곱 개가 이미 있습니다. (TourBox나 게임 컨트롤러를 쓰나요? [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4)을 설치하고 컨트롤을 시작하세요.)
2. **Chrome 확장 프로그램을 추가합니다.** [Chrome Web Store에서 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)를 추가하세요(Chrome 116 이상).
3. **사용해 봅니다.** **VJster 속도**를 키나 다이얼에 놓고 Chrome에서 YouTube 동영상을 재생하세요. 몇 초 안에 키에 재생 중인 동영상이 표시되고, 다이얼을 돌리면 동영상이 따라옵니다. 이미 열려 있던 탭은 한 번 새로 고치세요.

이게 전부입니다. OBS는 열려 있지 않아도 됩니다.

[전체 가이드(영어)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## TourBox로 VJster 쓰기

VJster Chrome 확장 프로그램 하나로 Stream Deck, OpenDeck, TourBox 어디서든 쓸 수 있습니다. TourBox에서는 Fadester Companion이 직접 확장 프로그램과의 연결을 맡습니다.

1. **TourBox를 준비합니다.** Fadester Companion을 설치하고 프리셋을 가져오세요: [TourBox 연결](../../../tourbox/README.md#connect-a-tourbox)(영어).
2. **Chrome 확장 프로그램을 추가합니다.** [Chrome Web Store에서 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)를 추가하고 Chrome에서 YouTube 동영상을 재생하세요.
3. **튀어나온 Knob을 돌립니다.** 동영상 속도가 따라옵니다. **Side**를 가볍게 누르면 1x로 돌아갑니다.

이게 전부입니다. OBS는 닫혀 있어도 됩니다.

[전체 가이드(영어)](../../vjster/TOURBOX.md)
