*本文是英文快速入門的翻譯，由 AI 模型完成並經第二個模型檢查，尚未經過母語人士審閱。*

# 快速入門：Fadester Companion 與 VJster

[Fadester Companion](#companion) · [遊戲控制器](#gamepad) · [VJster](#vjster) · [VJster：安裝](#vjster-install) · [用 TourBox 控制 VJster](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion：用遊戲控制器或 TourBox 操作 OBS Studio

Fadester Companion 讓你在 Windows 上用 Xbox 或其他 XInput 遊戲控制器、全尺寸 TourBox，或兩者並用，混合 OBS Studio 的場景。控制器的右扳機或 TourBox 的平面 Dial 會推動 OBS 工作室模式內建的 T-bar。

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion 三步驟：1，安裝並開啟；2，在 OBS 啟用 WebSocket 伺服器，Fadester Companion 的 OBS 指示燈變綠；3，把下一個場景放入預覽，然後扣右扳機或轉動 TourBox 的 Dial：OBS 的 T-bar 會跟著移動。" width="900">

1. **安裝並開啟。** 從 [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) 取得 **Fadester Companion**，再從開始功能表開啟。（使用 ZIP：把全部內容解壓縮到會保留的資料夾，然後開啟 **Fadester Companion.exe**。）
2. **連接 OBS。** 在 OBS 開啟 **工具 → WebSocket 伺服器設定**，勾選 **啟用 WebSocket 伺服器**，保持 **啟用身分驗證** 開啟，然後按一下 **確定**。Fadester Companion 頂端的 **OBS** 指示燈會變綠。是琥珀色？按一下旁邊的按鈕：**開啟** 會打開工作室模式，**示範給我看** 會示範在 OBS 要按哪裡。
3. **選擇控制器並轉場。** 在 **設定** 分頁的 **2 選擇控制器** 下，勾選 **使用 Xbox 或 XInput 遊戲控制器**（保持 **簡易模式**），然後按一下左下角的 **停止**，再按一下 **啟動**。使用 TourBox 時，請改照 [連接 TourBox](../../../tourbox/README.md#connect-a-tourbox)（英文）操作。按十字鍵下（TourBox：轉動 **Scroll**）把下一個場景放入預覽，然後扣右扳機（TourBox：轉動平面 **Dial**）：OBS 的 T-bar 會跟著移動，扣到底時預覽切換到節目。

就這樣。

[完整指南（英文）](../../../tourbox/README.md)

<a id="gamepad"></a>

## 遊戲控制器

用 Xbox 控制器（或任何相容 XInput 的控制器）操作 OBS：右扳機就是真正的 T-bar，按鈕可把場景放入預覽，並把預覽切換到節目。它在 Windows 的 Fadester Companion 中執行。

<img src="../../gamepad/controller-map.svg" alt="XInput 控制器的預設按鍵：右扳機是 T-bar，A 把預覽切換到節目，B 直接切換，十字鍵上下把上一個或下一個場景放入預覽，左右調整音樂，左扳機壓低音樂，View 取消手動淡變，Menu 把節目場景設為預覽。" width="900">

1. **接上控制器並開啟 OBS 的連線。** 接上控制器（USB 或 Xbox 無線；Windows 不需要額外驅動程式）。在 OBS 開啟 **工具 → WebSocket 伺服器設定**，勾選 **啟用 WebSocket 伺服器**，保持勾選 **啟用身分驗證**，然後按一下 **確定**。
2. **開啟 Fadester Companion**（從 [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) 取得，再從開始功能表開啟；[設定指南（英文）](../../../tourbox/README.md)）。頂端的 **OBS** 指示燈會變綠（琥珀色：按一下旁邊的 **示範給我看**）。如果 **控制器** 指示燈顯示已插入但未使用，請按一下 **使用**。否則在 **設定** 分頁的 **2 選擇控制器** 下勾選 **使用 Xbox 或 XInput 遊戲控制器**，保持勾選 **簡易模式**，若 **控制** 指示燈不是綠色，就按一下 **啟動**。
3. **轉場。** 在 OBS 33 開啟 **工作室模式**，選擇 **淡出**（Fade）轉場，然後按十字鍵下把下一個場景放入預覽。把右扳機扣到一半：OBS 的 T-bar 會跟著移動。放開：它會退回。扣到底：預覽切換到節目。

就這樣。頂端的指示燈會顯示 *控制器：已連線* 和 *控制：已開啟*。

[完整指南（英文）](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** 讓你用 Stream Deck 控制 YouTube 影片的速度：轉動旋鈕，影片會在播放中加快或放慢；按一個鍵即可設為 0.5x、1x 或 2x。它可用於 Chrome 分頁、OBS 瀏覽器來源或兩者；任何資料都不會離開這台電腦。

<img src="../../vjster/install-steps.svg" alt="VJster 三步驟：1，取得按鍵（Stream Deck 中的 Fadester for OBS，或 Fadester Companion）；2，從 Chrome Web Store 加入 VJster 擴充功能；3，播放 YouTube 影片並轉動旋鈕：速度會跟著變化。" width="900">

1. **取得按鍵。** 已有 **Fadester for OBS 0.9.0 或更新版本**？其中已包含七個 VJster 動作，可略過這一步。否則按兩下 `com.jbrick2070.vjster.streamDeckPlugin`，並同意安裝隨附的設定檔（適用於 Stream Deck + 的 **VJster Live +** 和 **VJster Dual +**，適用於 15 鍵的 **VJster Live**，以及 **VJster Mini**）。
2. **加入 Chrome 擴充功能。** 加入 [Chrome Web Store 中的 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)。它的選項頁面會開啟一次。
3. **試試看。** 把 **VJster 速度** 拖到旋鈕上，或把 **VJster 速度預設** 拖到按鍵上（在 VJster 外掛程式中名為 **速度** 和 **速度預設**，也可以切換到某個 VJster 設定檔）。在 Chrome 播放一個 YouTube 影片。幾秒內，速度 條（或 1x 鍵）會顯示正在播放。轉動旋鈕。

就這樣。如果條上顯示 **擴充功能未開啟**，請參閱 [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) 中的 *When something is off*（英文）。

[完整指南（英文）](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster：安裝

有了 VJster，你的 Stream Deck、TourBox 或遊戲控制器就能改變 Chrome 中 YouTube 影片的速度和畫質。

<img src="../../vjster/install-steps.svg" alt="VJster 三步驟：1，取得按鍵（Stream Deck 中的 Fadester for OBS，或 Fadester Companion）；2，從 Chrome Web Store 加入 VJster 擴充功能；3，播放 YouTube 影片並轉動旋鈕：速度會跟著變化。" width="900">

1. **取得按鍵。** 在 Stream Deck 安裝 [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)：它的動作清單中已經有七個 **VJster** 動作。（使用 TourBox 或遊戲控制器？請安裝 [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) 並啟動其控制。）
2. **加入 Chrome 擴充功能。** 加入 [Chrome Web Store 中的 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)（Chrome 116 或更新版本）。
3. **試試看。** 把 **VJster 速度** 放到按鍵或旋鈕上，然後在 Chrome 播放一個 YouTube 影片。幾秒內按鍵會顯示正在播放的影片；轉動旋鈕，影片就會跟著變化。已開啟的分頁請重新整理一次。

就這樣。OBS 不需要開啟。

[完整指南（英文）](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## 用 TourBox 控制 VJster

同一個 VJster Chrome 擴充功能可用於 Stream Deck、OpenDeck 和 TourBox。使用 TourBox 時，由 Fadester Companion 自己負責與擴充功能的連線。

1. **設定 TourBox。** 安裝 Fadester Companion 並匯入其預設：[連接 TourBox](../../../tourbox/README.md#connect-a-tourbox)（英文）。
2. **加入 Chrome 擴充功能。** 加入 [Chrome Web Store 中的 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)，然後在 Chrome 播放一個 YouTube 影片。
3. **轉動凸起的 Knob。** 影片速度會跟著變化。輕按 **Side** 回到 1x。

就這樣。OBS 可以關閉。

[完整指南（英文）](../../vjster/TOURBOX.md)
