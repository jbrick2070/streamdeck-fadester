# Fadester for OBS: 빠른 시작

*이 문서는 영어 빠른 시작을 번역한 것으로, AI 모델이 만들고 다른 AI 모델이 검토했습니다. 아직 원어민 검토는 받지 않았습니다.*

[Fadester for OBS](#fadester-for-obs) · [여기서 시작](#start-here) · [준비된 레이아웃](#layouts) · [OpenDeck](#opendeck) · [VJster가 들어 있는 하나의 플러그인](#suite) · [레이아웃 파일 직접 가져오기](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS는 OBS Studio를 Stream Deck에 올려 줍니다. 장면, 전환, 소스, 필터, 오디오를 키와 다이얼로 조작하세요.

<img src="../../docs/images/first-key-steps.svg" alt="첫 키까지 세 단계: 1, .streamDeckPlugin 파일을 더블클릭해 설치; 2, OBS의 도구 → WebSocket 서버 설정에서 서버 켜기; 3, Stream Deck에서 장면을 키로 끌어다 놓고 누르면 OBS가 다음 장면으로 넘어감." width="900">

1. **플러그인을 설치하세요.** [릴리스 페이지](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)에서 이름이 `.streamDeckPlugin`으로 끝나는 파일을 내려받아 더블클릭하세요. Stream Deck에서 설치를 확인하세요.
2. **OBS의 WebSocket 서버를 켜세요.** OBS에서 **도구 → WebSocket 서버 설정**을 열고 서버를 켠 뒤 **확인**을 누르세요. 인증은 그대로 두세요. 복사할 것은 없습니다.
3. **장면을 키로 끌어다 놓으세요.** Stream Deck의 동작 목록에서 *Fadester for OBS* 범주의 **장면**을 키로 끌어다 놓으세요. 처음에는 **다음 장면**입니다. 누르면 OBS가 다음 장면으로 넘어갑니다.

끝입니다. OBS가 같은 컴퓨터에 있으면 플러그인이 스스로 로그인합니다. OBS에 연결되지 않은 동안에는 키가 **OBS WebSocket 켜기**, **OBS 시작**처럼 해야 할 일을 알려 줍니다.

[전체 안내서(영어)](../../README.md)

<a id="start-here"></a>
## Fadester Suite: 여기서 시작

내 하드웨어에 맞게 Fadester Suite에서 무엇을 설치할지, OBS를 한 번 설정하는 방법입니다. 대부분은 Stream Deck을 씁니다.

<img src="../../docs/images/first-key-steps.svg" alt="첫 키까지 세 단계: 플러그인 설치, OBS에서 WebSocket 서버 켜기, 장면을 키로 끌어다 놓기." width="900">

1. **Fadester for OBS를 설치하세요.** [릴리스 페이지](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)에서 `.streamDeckPlugin` 파일을 내려받아 더블클릭하고 Stream Deck에 설치하세요.
2. **OBS의 WebSocket 서버를 켜세요.** OBS Studio 33에서 **도구 → WebSocket 서버 설정**, 서버 켜기, **확인**. 포트와 비밀번호는 플러그인이 OBS에 저장된 값을 읽습니다.
3. **장면을 키로 끌어다 놓고** 누르세요. OBS가 다음 장면으로 넘어갑니다. 덱을 채우려면 키를 클릭하고, 설정 페이지 아래쪽 줄을 클릭한 뒤 **준비된 레이아웃**을 여세요.

끝입니다. 다른 컨트롤러나 더 많은 구성 요소는 전체 안내서의 표를 보세요.

[전체 안내서(영어)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS: 준비된 레이아웃

Stream Deck +, 15키 Stream Deck, Stream Deck Mini용 레이아웃 14개입니다. 모두 편집할 수 있는 프로필로 열립니다.

<img src="../../docs/images/open-layout-steps.svg" alt="준비된 레이아웃을 세 단계로: 1, Fadester for OBS 키 클릭; 2, 페이지 아래쪽 줄을 클릭한 뒤 준비된 레이아웃; 3, 레이아웃을 고르고 이 레이아웃 열기 누르기." width="900">

1. Stream Deck에서 **Fadester for OBS 키**를 클릭하면 설정이 열립니다.
2. **페이지 아래쪽 줄**(버전과 연결 상태 표시)을 클릭하고 **준비된 레이아웃**을 여세요.
3. **레이아웃을 고르고 이 레이아웃 열기를 누르세요.** 덱이 그 레이아웃으로 바뀝니다.

끝입니다. OBS가 같은 컴퓨터에서 WebSocket 서버를 켜 두었다면 플러그인이 스스로 연결하고, 모든 레이아웃이 그 연결을 씁니다.

[전체 안내서(영어)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## OpenDeck에서 Fadester for OBS와 VJster 쓰기

[OpenDeck](https://github.com/nekename/OpenDeck)은 Elgato의 Stream Deck 소프트웨어 없이 Stream Deck 플러그인을 실행하는 무료 오픈 소스 프로그램입니다. Fadester for OBS는 그대로 작동합니다.

<img src="../../docs/images/opendeck-steps.svg" alt="OpenDeck에서 Fadester for OBS를 세 단계로: 1, 덱을 연결하고 Stream Deck 소프트웨어를 닫은 뒤 OpenDeck 시작; 2, 플러그인 관리자에서 Fadester for OBS 설치; 3, 덱 이름 아래 프로필 목록에서 레이아웃 고르기." width="900">

1. **OpenDeck을 시작하세요.** 덱을 연결하고 Stream Deck 소프트웨어를 닫은 뒤 [OpenDeck](https://github.com/nekename/OpenDeck/releases)을 시작하세요. 이 플러그인에는 [Node.js](https://nodejs.org/) 24 이상이 필요합니다.
2. **Fadester를 설치하세요.** OpenDeck의 플러그인 관리자에 **Fadester for OBS**가 있으면 설치하고, 없으면 파일에서 설치하는 버튼으로 [Fadester 다운로드](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin)를 고르세요.
3. 덱 이름 아래 프로필 목록에서 **레이아웃을 고르세요**: Plus는 **Scene Desk + (Regular Mode)**, 15키는 **Scene Desk 15 Keys (Regular Mode)**, Mini는 **Source Desk Mini (Either Mode)**. 다른 모델에서는 **장면**을 키로 끌어다 놓으세요.

OBS의 WebSocket 서버(**도구 → WebSocket 서버 설정**)가 켜져 있으면 끝입니다. OBS가 같은 컴퓨터에 있으면 Fadester가 저장된 비밀번호로 로그인합니다.

[전체 안내서(영어)](../../docs/OPENDECK.md)

<a id="suite"></a>
## 하나의 플러그인에 담긴 Fadester for OBS와 VJster

Fadester for OBS는 동작 19개가 들어 있는 플러그인 하나입니다. Fadester의 12개와 VJster의 7개입니다.

1. **Fadester for OBS를 한 번 설치하세요.** Stream Deck이나 OpenDeck에 설치합니다(위 참고).
2. **VJster 동작은 같은 목록에 있습니다.** *Fadester for OBS* 범주의 **VJster 속도**, **VJster 화질** 등입니다.
3. **Chrome 확장 프로그램을 추가하세요:** [Chrome Web Store의 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). 포트 48150으로 플러그인과 통신합니다.

끝입니다. VJster는 한 프로그램에서만 실행하세요: 이 플러그인, 별도의 VJster 플러그인, Fadester Companion 중 하나입니다.

[전체 안내서(영어)](../../docs/SUITE.md)

<a id="profiles"></a>
## Fadester 레이아웃 라이브러리: 파일 직접 가져오기

가장 쉬운 방법은 **준비된 레이아웃**에서 여는 것입니다(위 참고). 파일을 직접 가져오려면:

1. **파일을 더블클릭하세요.** 내 덱에 맞는 `.streamDeckProfile`을 고르면 Stream Deck이 새 프로필로 가져옵니다.
2. **OBS를 연결하세요(보통은 할 일이 없습니다).** OBS가 같은 컴퓨터에 있으면 Fadester가 스스로 로그인합니다. 그렇지 않으면 Fadester 키의 설정을 열고, 페이지 아래쪽 줄을 클릭한 뒤 **다른 컴퓨터의 OBS 또는 다른 포트**를 열어 호스트, 포트, 비밀번호를 입력하고 **모든 제어에 저장하고 테스트**를 누르세요.
3. **키를 누르세요.** 장면 키는 OBS의 장면 목록을 따르고, 음악, 마이크, Aux 제어는 오디오 입력을 찾아 두었습니다.

끝입니다.

[전체 안내서(영어)](../../profiles/README.md)
