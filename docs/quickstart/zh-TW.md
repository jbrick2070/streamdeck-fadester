# Fadester for OBS：快速入門

*本文是英文快速入門的譯文，由一個 AI 模型翻譯，並由另一個 AI 模型檢查；尚未經過母語人士審閱。*

[Fadester for OBS](#fadester-for-obs) · [從這裡開始](#start-here) · [現成版面](#layouts) · [OpenDeck](#opendeck) · [內含 VJster 的同一個外掛](#suite) · [手動匯入版面檔案](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS 把 OBS Studio 放到你的 Stream Deck 上：場景、轉場、來源、濾鏡與音訊都在按鍵和旋鈕上。

<img src="../../docs/images/first-key-steps.svg" alt="三步做出第一個按鍵：1，按兩下 .streamDeckPlugin 檔案並安裝；2，在 OBS 的工具 → WebSocket 伺服器設定中啟用伺服器；3，在 Stream Deck 中把場景拖到一個按鍵上並按下：OBS 切換到下一場景。" width="900">

1. **安裝外掛。** 在[發行頁面](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)下載名稱以 `.streamDeckPlugin` 結尾的檔案，然後按兩下。在 Stream Deck 中確認安裝。
2. **開啟 OBS 的 WebSocket 伺服器。** 在 OBS 中：**工具 → WebSocket 伺服器設定**，啟用伺服器，按 **確定**。驗證保持原樣即可：不需要複製任何內容。
3. **把場景拖到按鍵上。** 在 Stream Deck 的動作清單中，從 *Fadester for OBS* 類別把 **場景** 拖到一個按鍵上。它預設是 **下一場景**：按下它，OBS 就切換到下一場景。

完成。OBS 在同一台電腦上時，外掛會自動登入。OBS 未連線時，按鍵會提示該怎麼做，例如 **開啟 OBS WebSocket** 或 **啟動 OBS**。

[完整指南（英文）](../../README.md)

<a id="start-here"></a>
## Fadester Suite：從這裡開始

依你的硬體該安裝 Fadester Suite 的哪些部分，以及如何一次設定好 OBS。大多數人用的是 Stream Deck：

<img src="../../docs/images/first-key-steps.svg" alt="三步做出第一個按鍵：安裝外掛，在 OBS 開啟 WebSocket 伺服器，把場景拖到按鍵上。" width="900">

1. **安裝 Fadester for OBS。** 從[發行頁面](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)下載 `.streamDeckPlugin` 檔案，按兩下後在 Stream Deck 中安裝。
2. **開啟 OBS 的 WebSocket 伺服器。** 在 OBS Studio 33 中：**工具 → WebSocket 伺服器設定**，啟用伺服器，**確定**。外掛會讀取 OBS 儲存的連接埠與密碼。
3. **把場景拖到按鍵上** 並按下：OBS 切換到下一場景。要填滿整個 Deck，按一下該按鍵，再按一下其設定頁面底部那一行，開啟 **現成版面**。

完成。其他控制器或更多元件？請查看完整指南中的表格。

[完整指南（英文）](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS：現成版面

為 Stream Deck +、15 鍵 Stream Deck 與 Stream Deck Mini 準備的十四個版面。每個都會以可編輯的設定檔開啟。

<img src="../../docs/images/open-layout-steps.svg" alt="三步開啟現成版面：1，按一下 Fadester for OBS 按鍵；2，按一下頁面底部那一行，再開啟現成版面；3，選擇一個版面並按開啟此版面。" width="900">

1. 在 Stream Deck 中 **按一下 Fadester for OBS 按鍵**：它的設定會開啟。
2. **按一下頁面底部那一行**（顯示版本與連線狀態），開啟 **現成版面**。
3. **選擇一個版面，按 開啟此版面。** 你的 Deck 會切換過去。

完成。OBS 在同一台電腦上且已開啟 WebSocket 伺服器時，外掛會自動連線；所有版面共用這一個連線。

[完整指南（英文）](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## 在 OpenDeck 中使用 Fadester for OBS 與 VJster

[OpenDeck](https://github.com/nekename/OpenDeck) 是一個免費的開放原始碼程式，不需要 Elgato 的 Stream Deck 軟體就能執行 Stream Deck 外掛。Fadester for OBS 可直接在其中執行。

<img src="../../docs/images/opendeck-steps.svg" alt="三步在 OpenDeck 中使用 Fadester for OBS：1，連接 Deck、關閉 Stream Deck 軟體後啟動 OpenDeck；2，從外掛管理員安裝 Fadester for OBS；3，在 Deck 名稱下方的設定檔清單中選擇版面。" width="900">

1. **啟動 OpenDeck。** 連接 Deck，關閉 Stream Deck 軟體，然後啟動 [OpenDeck](https://github.com/nekename/OpenDeck/releases)。本外掛需要 [Node.js](https://nodejs.org/) 24 或更新版本。
2. **安裝 Fadester。** 如果 OpenDeck 的外掛管理員中列有 **Fadester for OBS**，直接安裝；否則用從檔案安裝的按鈕選擇 [Fadester 下載檔](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin)。
3. 在 Deck 名稱下方的設定檔清單中 **選擇版面**：Plus 選 **Scene Desk + (Regular Mode)**，15 鍵選 **Scene Desk 15 Keys (Regular Mode)**，Mini 選 **Source Desk Mini (Either Mode)**。其他型號請把 **場景** 拖到一個按鍵上。

只要 OBS 的 WebSocket 伺服器已開啟（**工具 → WebSocket 伺服器設定**），就完成了。OBS 在同一台電腦上時，Fadester 會用儲存的密碼登入。

[完整指南（英文）](../../docs/OPENDECK.md)

<a id="suite"></a>
## 同一個外掛中的 Fadester for OBS 與 VJster

Fadester for OBS 是一個包含十九個動作的外掛：十二個來自 Fadester，七個來自 VJster。

1. **只需安裝一次 Fadester for OBS**，裝在 Stream Deck 或 OpenDeck 中（見上文）。
2. **VJster 的動作在同一個清單中**，位於 *Fadester for OBS* 類別：**VJster 速度**、**VJster 畫質** 等。
3. **加入 Chrome 擴充功能：**[Chrome Web Store 上的 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)。它透過連接埠 48150 與外掛通訊。

完成。VJster 只在一個程式中執行即可：本外掛、獨立的 VJster 外掛或 Fadester Companion 三者之一。

[完整指南（英文）](../../docs/SUITE.md)

<a id="profiles"></a>
## Fadester 版面庫：手動匯入檔案

最簡單的方法是從 **現成版面** 開啟（見上文）。要手動匯入檔案：

1. **按兩下檔案。** 選擇適合你的 Deck 的 `.streamDeckProfile`；Stream Deck 會把它匯入為新的設定檔。
2. **連接 OBS（通常不需操作）。** OBS 在同一台電腦上時，Fadester 會自動登入。否則，開啟一個 Fadester 按鍵的設定，按一下頁面底部那一行，開啟 **另一台電腦上的 OBS，或其他連接埠**，填寫主機、連接埠與密碼，然後按 **為所有控制儲存並測試**。
3. **按下按鍵。** 場景按鍵會跟隨你在 OBS 中的場景清單；音樂、麥克風與 Aux 控制已找到你的音訊輸入。

完成。

[完整指南（英文）](../../profiles/README.md)
