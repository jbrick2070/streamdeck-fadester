*これは英語のクイックスタートの翻訳です。AI モデルで作成し、別のモデルが確認しました。ネイティブスピーカーによる確認はまだです。*

# クイックスタート: Fadester Companion と VJster

[Fadester Companion](#companion) · [ゲームコントローラー](#gamepad) · [VJster](#vjster) · [VJster: インストール](#vjster-install) · [TourBox で VJster](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: OBS Studio 用のゲームコントローラーまたは TourBox

Fadester Companion を使うと、Windows で Xbox などの XInput ゲームコントローラー、フルサイズの TourBox、またはその両方で OBS Studio のシーンをミックスできます。コントローラーの右トリガー、または TourBox の平たい Dial が、OBS のスタジオモードの T バーを動かします。

<img src="../../../tourbox/companion-steps.svg" alt="Fadester Companion の 3 ステップ: 1、インストールして開く。2、OBS で WebSocket サーバーをオンにすると、Fadester Companion の OBS ランプが緑になる。3、次のシーンをプレビューに送り、右トリガーを引くか TourBox の Dial を回すと、OBS の T バーが追従する。" width="900">

1. **インストールして開く。** [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) から **Fadester Companion** を入手し、スタート メニューから開きます。（ZIP の場合: 残しておくフォルダーにすべて展開し、**Fadester Companion.exe** を開きます。）
2. **OBS とつなぐ。** OBS で **ツール → WebSocket サーバー設定** を開き、**WebSocket サーバーを有効にする** にチェックを入れ、**認証を有効にする** はオンのままにして **OK** をクリックします。Fadester Companion の上部の **OBS** ランプが緑になります。黄色の場合は、横のボタンをクリックします: **オンにする** でスタジオモードがオンになり、**やり方を見る** で OBS でのクリック手順が表示されます。
3. **コントローラーを選んでフェードする。** **セットアップ** タブの **2 コントローラーの選択** で **Xbox または XInput 対応のコントローラーを使う** にチェックを入れ（**かんたんモード** はそのまま）、左下の **停止**、続いて **開始** をクリックします。TourBox の場合は、代わりに [TourBox を接続する](../../../tourbox/README.md#connect-a-tourbox)（英語）に従ってください。十字キーの下（TourBox: **Scroll** を回す）で次のシーンをプレビューに送り、右トリガーを引きます（TourBox: 平たい **Dial** を回す）。OBS の T バーが追従し、奥まで引くとプレビューがプログラムに切り替わります。

これで完了です。

[完全なガイド（英語）](../../../tourbox/README.md)

<a id="gamepad"></a>

## ゲームコントローラー

Xbox コントローラー（または XInput 対応のパッド）で OBS を操作します。右トリガーが本物の T バーになり、ボタンでシーンをプレビューに送り、プレビューをプログラムに切り替えます。Windows の Fadester Companion の中で動きます。

<img src="../../gamepad/controller-map.svg" alt="XInput コントローラーの標準の割り当て: 右トリガーは T バー、A はプレビューをプログラムへ、B はカット、十字キーの上下は上または下のシーンをプレビューへ、左右は音楽の調整、左トリガーは音楽を下げる、View は手動フェードの取り消し、Menu はプログラムのシーンをプレビューにする。" width="900">

1. **接続して OBS の WebSocket をオンにする。** コントローラーを接続します（USB または Xbox ワイヤレス。追加のドライバーは不要です）。OBS で **ツール → WebSocket サーバー設定** を開き、**WebSocket サーバーを有効にする** にチェックを入れ、**認証を有効にする** はチェックしたままにして **OK** をクリックします。
2. **Fadester Companion を開く**（[Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) から入手し、スタート メニューから。[セットアップガイド（英語）](../../../tourbox/README.md)）。上部の **OBS** ランプが緑になります（黄色なら横の **やり方を見る** をクリック）。**コントローラー** ランプが「接続済み・未使用」と表示していれば **使う** をクリックします。そうでなければ **セットアップ** タブの **2 コントローラーの選択** で **Xbox または XInput 対応のコントローラーを使う** にチェックを入れ、**かんたんモード** はオンのまま、**コントロール** ランプが緑でなければ **開始** をクリックします。
3. **フェードする。** OBS 33 で **スタジオモード** をオンにし、トランジション **フェード**（Fade）を選び、十字キーの下で次のシーンをプレビューに送ります。右トリガーを半分引くと OBS の T バーが追従します。離すと戻ります。奥まで引くとプレビューがプログラムに切り替わります。

これで完了です。上部のランプには *コントローラー: 接続済み* と *コントロール: オン* と表示されます。

[完全なガイド（英語）](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0** は、Stream Deck から YouTube 動画の速度を操作します。ダイヤルを回すと再生中の動画が速くも遅くもなり、キーで 0.5x、1x、2x にできます。Chrome のタブ、OBS のブラウザソース、またはその両方で使えます。このコンピューターの外には何も送られません。

<img src="../../vjster/install-steps.svg" alt="VJster の 3 ステップ: 1、キーを用意する（Stream Deck の Fadester for OBS、または Fadester Companion）。2、Chrome Web Store から VJster 拡張機能を追加する。3、YouTube 動画を再生してダイヤルを回すと、速度が追従する。" width="900">

1. **キーを用意する。** **Fadester for OBS 0.9.0 以降** をお持ちなら、7 つの VJster アクションがすでに入っているので、この手順は不要です。そうでなければ `com.jbrick2070.vjster.streamDeckPlugin` をダブルクリックし、同梱のプロファイル（Stream Deck + 用の **VJster Live +** と **VJster Dual +**、15 キー用の **VJster Live**、**VJster Mini**）のインストールを承認します。
2. **Chrome 拡張機能を追加する。** [Chrome Web Store から VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) を追加します。オプションページが一度開きます。
3. **試す。** **VJster 速度** をダイヤルに、または **VJster 速度プリセット** をキーにドラッグします（VJster プラグインでは **速度** と **速度プリセット**。VJster プロファイルに切り替えても構いません）。Chrome で YouTube 動画を再生します。数秒で 速度 のストリップ（または 1x のキー）に再生中と表示されます。ダイヤルを回します。

これで完了です。ストリップに **拡張機能オフ** と表示される場合は、[INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) の *When something is off*（英語）を参照してください。

[完全なガイド（英語）](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: インストール

VJster を使うと、Stream Deck、TourBox、またはゲームコントローラーで Chrome の YouTube 動画の速度と画質を変えられます。

<img src="../../vjster/install-steps.svg" alt="VJster の 3 ステップ: 1、キーを用意する（Stream Deck の Fadester for OBS、または Fadester Companion）。2、Chrome Web Store から VJster 拡張機能を追加する。3、YouTube 動画を再生してダイヤルを回すと、速度が追従する。" width="900">

1. **キーを用意する。** Stream Deck に [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) をインストールします。そのアクション一覧に 7 つの **VJster** アクションがすでにあります。（TourBox やゲームコントローラーを使う場合は、[Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) をインストールしてコントロールを開始します。）
2. **Chrome 拡張機能を追加する。** [Chrome Web Store から VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) を追加します（Chrome 116 以降）。
3. **試す。** **VJster 速度** をキーまたはダイヤルに置き、Chrome で YouTube 動画を再生します。数秒でキーに再生中の動画が表示され、ダイヤルを回すと動画が追従します。すでに開いていたタブは一度再読み込みしてください。

これで完了です。OBS を開いておく必要はありません。

[完全なガイド（英語）](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## TourBox で VJster

VJster の Chrome 拡張機能は一つだけで、Stream Deck、OpenDeck、TourBox のどれからでも使えます。TourBox の場合は、Fadester Companion 自身が拡張機能との接続を受け持ちます。

1. **TourBox を準備する。** Fadester Companion をインストールし、そのプリセットをインポートします: [TourBox を接続する](../../../tourbox/README.md#connect-a-tourbox)（英語）。
2. **Chrome 拡張機能を追加する。** [Chrome Web Store から VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) を追加し、Chrome で YouTube 動画を再生します。
3. **突き出た Knob を回す。** 動画の速度が追従します。**Side** を軽く押すと 1x に戻ります。

これで完了です。OBS は閉じていても構いません。

[完全なガイド（英語）](../../vjster/TOURBOX.md)
