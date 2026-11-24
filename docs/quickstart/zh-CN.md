# Fadester for OBS：快速入门

*本文是英文快速入门的译文，由一个 AI 模型翻译，并由另一个 AI 模型检查；尚未经过母语人士审校。*

[Fadester for OBS](#fadester-for-obs) · [从这里开始](#start-here) · [现成布局](#layouts) · [OpenDeck](#opendeck) · [包含 VJster 的同一个插件](#suite) · [手动导入布局文件](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS 把 OBS Studio 放到你的 Stream Deck 上：场景、转场、来源、滤镜和音频都在按键和旋钮上。

<img src="../../docs/images/first-key-steps.svg" alt="三步做出第一个按键：1，双击 .streamDeckPlugin 文件并安装；2，在 OBS 的工具 → WebSocket 服务器设置中启用服务器；3，在 Stream Deck 中把场景拖到一个按键上并按下：OBS 切换到下一场景。" width="900">

1. **安装插件。** 在[发布页面](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)下载名称以 `.streamDeckPlugin` 结尾的文件并双击它。在 Stream Deck 中确认安装。
2. **开启 OBS 的 WebSocket 服务器。** 在 OBS 中：**工具 → WebSocket 服务器设置**，启用服务器，点击 **确定**。身份验证保持原样即可：无需复制任何内容。
3. **把场景拖到按键上。** 在 Stream Deck 的操作列表中，从 *Fadester for OBS* 类别把 **场景** 拖到一个按键上。它默认是 **下一场景**：按下它，OBS 就切换到下一场景。

完成。OBS 在同一台电脑上时，插件会自动登录。OBS 未连接时，按键会提示该做什么，例如 **开启 OBS WebSocket** 或 **启动 OBS**。

[完整指南（英文）](../../README.md)

<a id="start-here"></a>
## Fadester Suite：从这里开始

根据你的硬件该安装 Fadester Suite 的哪些部分，以及如何一次性设置好 OBS。大多数人用的是 Stream Deck：

<img src="../../docs/images/first-key-steps.svg" alt="三步做出第一个按键：安装插件，在 OBS 中开启 WebSocket 服务器，把场景拖到按键上。" width="900">

1. **安装 Fadester for OBS。** 从[发布页面](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)下载 `.streamDeckPlugin` 文件，双击后在 Stream Deck 中安装。
2. **开启 OBS 的 WebSocket 服务器。** 在 OBS Studio 33 中：**工具 → WebSocket 服务器设置**，启用服务器，**确定**。插件会读取 OBS 保存的端口和密码。
3. **把场景拖到按键上** 并按下：OBS 切换到下一场景。要填满整个 Deck，点击该按键，再点击其设置页面底部的那一行，打开 **现成布局**。

完成。其他控制器或更多组件？请查看完整指南中的表格。

[完整指南（英文）](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS：现成布局

为 Stream Deck +、15 键 Stream Deck 和 Stream Deck Mini 准备的十四个布局。每个都以可编辑的配置文件打开。

<img src="../../docs/images/open-layout-steps.svg" alt="三步打开现成布局：1，点击一个 Fadester for OBS 按键；2，点击页面底部的那一行，再打开现成布局；3，选择一个布局并点击打开此布局。" width="900">

1. 在 Stream Deck 中 **点击一个 Fadester for OBS 按键**：它的设置会打开。
2. **点击页面底部的那一行**（显示版本和连接状态），打开 **现成布局**。
3. **选择一个布局，点击 打开此布局。** 你的 Deck 会切换过去。

完成。OBS 在同一台电脑上且已开启 WebSocket 服务器时，插件会自动连接；所有布局共用这一个连接。

[完整指南（英文）](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## 在 OpenDeck 中使用 Fadester for OBS 和 VJster

[OpenDeck](https://github.com/nekename/OpenDeck) 是一个免费的开源程序，无需 Elgato 的 Stream Deck 软件即可运行 Stream Deck 插件。Fadester for OBS 可以直接在其中运行。

<img src="../../docs/images/opendeck-steps.svg" alt="三步在 OpenDeck 中使用 Fadester for OBS：1，连接 Deck、关闭 Stream Deck 软件后启动 OpenDeck；2，从插件管理器安装 Fadester for OBS；3，在 Deck 名称下方的配置文件列表中选择布局。" width="900">

1. **启动 OpenDeck。** 连接 Deck，关闭 Stream Deck 软件，然后启动 [OpenDeck](https://github.com/nekename/OpenDeck/releases)。本插件需要 [Node.js](https://nodejs.org/) 24 或更高版本。
2. **安装 Fadester。** 如果 OpenDeck 的插件管理器中列有 **Fadester for OBS**，直接安装；否则用从文件安装的按钮选择 [Fadester 下载文件](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin)。
3. 在 Deck 名称下方的配置文件列表中 **选择布局**：Plus 选 **Scene Desk + (Regular Mode)**，15 键选 **Scene Desk 15 Keys (Regular Mode)**，Mini 选 **Source Desk Mini (Either Mode)**。其他型号请把 **场景** 拖到一个按键上。

只要 OBS 的 WebSocket 服务器已开启（**工具 → WebSocket 服务器设置**），就完成了。OBS 在同一台电脑上时，Fadester 会用保存的密码登录。

[完整指南（英文）](../../docs/OPENDECK.md)

<a id="suite"></a>
## 同一个插件中的 Fadester for OBS 和 VJster

Fadester for OBS 是一个包含十九个操作的插件：十二个来自 Fadester，七个来自 VJster。

1. **只需安装一次 Fadester for OBS**，装在 Stream Deck 或 OpenDeck 中（见上文）。
2. **VJster 的操作在同一个列表中**，位于 *Fadester for OBS* 类别：**VJster 速度**、**VJster 画质** 等。
3. **添加 Chrome 扩展程序：**[Chrome Web Store 中的 VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)。它通过端口 48150 与插件通信。

完成。VJster 只在一个程序中运行即可：本插件、独立的 VJster 插件或 Fadester Companion 三者之一。

[完整指南（英文）](../../docs/SUITE.md)

<a id="profiles"></a>
## Fadester 布局库：手动导入文件

最简单的方法是从 **现成布局** 打开（见上文）。要手动导入文件：

1. **双击文件。** 选择适合你的 Deck 的 `.streamDeckProfile`；Stream Deck 会把它导入为新的配置文件。
2. **连接 OBS（通常无需操作）。** OBS 在同一台电脑上时，Fadester 会自动登录。否则，打开一个 Fadester 按键的设置，点击页面底部的那一行，打开 **另一台电脑上的 OBS，或其他端口**，填写主机、端口和密码，然后点击 **为所有控制保存并测试**。
3. **按下按键。** 场景按键跟随你在 OBS 中的场景列表；音乐、麦克风和 Aux 控制已找到你的音频输入。

完成。

[完整指南（英文）](../../profiles/README.md)
