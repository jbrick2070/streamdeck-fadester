# Fadester for OBS：クイックスタート

*これは英語のクイックスタートの翻訳です。AI モデルで作成し、別の AI モデルで確認しました。ネイティブスピーカーによる確認はまだです。*

[Fadester for OBS](#fadester-for-obs) · [はじめに](#start-here) · [既製のレイアウト](#layouts) · [OpenDeck](#opendeck) · [VJster を含む 1 つのプラグイン](#suite) · [レイアウトファイルを手動で](#profiles)

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS は OBS Studio を Stream Deck に載せます。シーン、トランジション、ソース、フィルター、音声をキーとダイヤルで操作できます。

<img src="../../docs/images/first-key-steps.svg" alt="最初のキーまで 3 ステップ：1、.streamDeckPlugin ファイルをダブルクリックしてインストール。2、OBS のツール → WebSocket サーバー設定でサーバーをオンにする。3、Stream Deck でシーンをキーにドラッグして押すと、OBS が次のシーンに切り替わる。" width="900">

1. **プラグインをインストールします。** [リリースページ](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)から `.streamDeckPlugin` で終わるファイルをダウンロードし、ダブルクリックします。Stream Deck でインストールを確定します。
2. **OBS の WebSocket サーバーをオンにします。** OBS で **ツール → WebSocket サーバー設定** を開き、サーバーをオンにして **OK** を押します。認証の設定はそのままで構いません。コピーするものはありません。
3. **シーンをキーにドラッグします。** Stream Deck のアクション一覧のカテゴリ *Fadester for OBS* から **シーン** をキーにドラッグします。最初は **次のシーン** です。押すと OBS が次のシーンに切り替わります。

これで完了です。OBS が同じコンピューターにあれば、プラグインは自動でサインインします。OBS に接続していない間は、キーが **OBS WebSocket をオンに** や **OBS を起動** のように対処方法を表示します。

[完全なガイド（英語）](../../README.md)

<a id="start-here"></a>
## Fadester Suite：はじめに

お使いのハードウェアに必要な Fadester Suite の構成と、OBS の初回設定です。多くの方は Stream Deck をお使いです。

<img src="../../docs/images/first-key-steps.svg" alt="最初のキーまで 3 ステップ：プラグインをインストール、OBS で WebSocket サーバーをオン、シーンをキーにドラッグ。" width="900">

1. **Fadester for OBS をインストールします。** [リリースページ](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)から `.streamDeckPlugin` ファイルをダウンロードし、ダブルクリックして Stream Deck にインストールします。
2. **OBS の WebSocket サーバーをオンにします。** OBS Studio 33 で **ツール → WebSocket サーバー設定** を開き、サーバーをオンにして **OK**。ポートとパスワードはプラグインが OBS の保存内容から読み取ります。
3. **シーンをキーにドラッグ** して押すと、OBS が次のシーンに切り替わります。デッキ全体を埋めるには、キーをクリックし、設定ページ下部の行をクリックして **既製のレイアウト** を開きます。

これで完了です。ほかのコントローラーや追加の構成は、完全なガイドの表をご覧ください。

[完全なガイド（英語）](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS：既製のレイアウト

Stream Deck +、15 キーの Stream Deck、Stream Deck Mini 用の 14 のレイアウトです。どれも編集できるプロファイルとして開きます。

<img src="../../docs/images/open-layout-steps.svg" alt="既製レイアウトを 3 ステップで：1、Fadester for OBS のキーをクリック。2、ページ下部の行をクリックし、既製のレイアウトを開く。3、レイアウトを選び、このレイアウトを開くを押す。" width="900">

1. Stream Deck で **Fadester for OBS のキー** をクリックすると、その設定が開きます。
2. **ページ下部の行**（バージョンと接続状態を表示）をクリックし、**既製のレイアウト** を開きます。
3. **レイアウトを選び、このレイアウトを開く を押します。** デッキがそのレイアウトに切り替わります。

これで完了です。OBS が同じコンピューターで WebSocket サーバーをオンにしていれば、プラグインは自動で接続し、すべてのレイアウトがその接続を使います。

[完全なガイド（英語）](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## OpenDeck で Fadester for OBS と VJster を使う

[OpenDeck](https://github.com/nekename/OpenDeck) は、Elgato の Stream Deck ソフトウェアなしで Stream Deck プラグインを動かす無料のオープンソースプログラムです。Fadester for OBS はそのまま動作します。

<img src="../../docs/images/opendeck-steps.svg" alt="OpenDeck で Fadester for OBS を 3 ステップで：1、デッキを接続し、Stream Deck ソフトウェアを閉じて OpenDeck を起動。2、プラグインマネージャーから Fadester for OBS をインストール。3、デッキ名の下のプロファイル一覧でレイアウトを選ぶ。" width="900">

1. **OpenDeck を起動します。** デッキを接続し、Stream Deck ソフトウェアを閉じて [OpenDeck](https://github.com/nekename/OpenDeck/releases) を起動します。このプラグインには [Node.js](https://nodejs.org/) 24 以降が必要です。
2. **Fadester をインストールします。** OpenDeck のプラグインマネージャーに **Fadester for OBS** があればインストールします。なければ、ファイルからインストールするボタンで [Fadester のダウンロード](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin) を選びます。
3. デッキ名の下のプロファイル一覧で **レイアウトを選びます**：Plus は **Scene Desk + (Regular Mode)**、15 キーは **Scene Desk 15 Keys (Regular Mode)**、Mini は **Source Desk Mini (Either Mode)**。ほかの機種では **シーン** をキーにドラッグします。

OBS の WebSocket サーバー（**ツール → WebSocket サーバー設定**）がオンなら、これで完了です。OBS が同じコンピューターにあれば、Fadester は保存されたパスワードでサインインします。

[完全なガイド（英語）](../../docs/OPENDECK.md)

<a id="suite"></a>
## Fadester for OBS と VJster を 1 つのプラグインで

Fadester for OBS は 19 のアクションを持つ 1 つのプラグインです。Fadester の 12 と VJster の 7 です。

1. **Fadester for OBS を一度インストールします。** Stream Deck でも OpenDeck でも構いません（上記参照）。
2. **VJster のアクションは同じ一覧にあります。** カテゴリ *Fadester for OBS* の **VJster 速度**、**VJster 画質** などです。
3. **Chrome 拡張機能を追加します：** [Chrome Web Store の VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb)。ポート 48150 でプラグインと通信します。

これで完了です。VJster を動かすのは 1 つのプログラムだけにしてください：このプラグイン、単体の VJster プラグイン、または Fadester Companion のいずれかです。

[完全なガイド（英語）](../../docs/SUITE.md)

<a id="profiles"></a>
## Fadester レイアウトライブラリ：ファイルを手動でインポート

いちばん簡単なのは **既製のレイアウト** から開く方法です（上記参照）。ファイルを手動でインポートするには：

1. **ファイルをダブルクリックします。** お使いのデッキ用の `.streamDeckProfile` を選ぶと、Stream Deck が新しいプロファイルとして取り込みます。
2. **OBS に接続します（通常は何もしなくて構いません）。** OBS が同じコンピューターにあれば、Fadester は自動でサインインします。そうでなければ、Fadester のキーの設定を開き、ページ下部の行をクリックして **別のコンピューターの OBS、または別のポート** を開き、ホスト、ポート、パスワードを入力して **すべての操作に保存してテスト** を押します。
3. **キーを押します。** シーンキーは OBS のシーン一覧に従い、音楽、マイク、Aux の操作は音声入力を見つけています。

これで完了です。

[完全なガイド（英語）](../../profiles/README.md)
