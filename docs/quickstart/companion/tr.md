*Bu, İngilizce hızlı başlangıçların bir yapay zekâ modeliyle yapılmış ve ikinci bir modelce kontrol edilmiş çevirisidir; henüz ana dili Türkçe olan biri tarafından gözden geçirilmedi.*

# Hızlı başlangıç: Fadester Companion ve VJster

[Fadester Companion](#companion) · [Oyun kumandası](#gamepad) · [VJster](#vjster) · [VJster: kurulum](#vjster-install) · [TourBox ile VJster](#vjster-tourbox)

<a id="companion"></a>

## Fadester Companion: OBS Studio için oyun kumandası veya TourBox

Fadester Companion, Windows'ta OBS Studio sahnelerini Xbox veya başka bir XInput oyun kumandasıyla, tam boy bir TourBox'la ya da ikisiyle birden karıştırmanızı sağlar. Kumandanın sağ tetiği veya TourBox'ın düz Dial'ı, OBS Stüdyo Modu'nun T-bar'ını hareket ettirir.

<img src="../../../tourbox/companion-steps.svg" alt="Üç adımda Fadester Companion: 1, kurun ve açın; 2, OBS'te WebSocket sunucusunu açın, Fadester Companion'daki OBS ışığı yeşile döner; 3, sonraki sahneyi önizlemeye alın ve sağ tetiği çekin ya da TourBox'ın Dial'ını çevirin: OBS'in T-bar'ı onu izler." width="900">

1. **Kurun ve açın.** **Fadester Companion**'ı [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4)'dan alın ve Başlat menüsünden açın. (ZIP'ten: hepsini saklayacağınız bir klasöre çıkarın ve **Fadester Companion.exe**'yi açın.)
2. **OBS'e bağlayın.** OBS'te **Araçlar → WebSocket Sunucu Ayarları**'nı açın, **WebSocket sunucusunu etkinleştir**'i işaretleyin, **Kimlik Doğrulamayı Etkinleştir**'i açık bırakın ve **Tamam**'a tıklayın. Fadester Companion'ın üstündeki **OBS** ışığı yeşile döner. Turuncu mu? Yanındaki düğmeye tıklayın: **Aç** Stüdyo Modu'nu açar, **Göster** OBS'teki tıklamaları gösterir.
3. **Kumandanızı seçin ve geçiş yapın.** **Kurulum** sekmesinde, **2 Kumandanızı seçin** altında **Xbox veya XInput oyun kumandası kullan**'ı işaretleyin (**Kolay mod** açık kalsın), sonra sol alttaki **Durdur**'a ve ardından **Başlat**'a tıklayın. TourBox kullanıyorsanız bunun yerine [TourBox bağlama](../../../tourbox/README.md#connect-a-tourbox) (İngilizce) adımlarını izleyin. Sonraki sahneyi Önizleme'ye almak için yön tuşunun aşağısına basın (TourBox: **Scroll**'u çevirin), sonra sağ tetiği çekin (TourBox: düz **Dial**'ı çevirin): OBS'in T-bar'ı onu izler; sonuna kadar çekince Önizleme Program'a geçer.

Hepsi bu kadar.

[Tam kılavuz (İngilizce)](../../../tourbox/README.md)

<a id="gamepad"></a>

## Oyun kumandası

OBS'i bir Xbox kumandasıyla (veya XInput uyumlu herhangi bir kumandayla) yönetin: sağ tetik gerçek bir T-bar'dır, düğmeler bir sahneyi Önizleme'ye alır ve Önizleme'yi Program'a gönderir. Windows'ta Fadester Companion içinde çalışır.

<img src="../../gamepad/controller-map.svg" alt="XInput kumandasının varsayılan atamaları: sağ tetik T-bar'dır, A Önizleme'yi Program'a gönderir, B keser, yön tuşu yukarı ve aşağı üstteki veya alttaki sahneyi Önizleme'ye alır, sol ve sağ müziği ayarlar, sol tetik müziği kısar, View elle yapılan geçişi iptal eder, Menu Program sahnesini Önizleme'ye alır." width="900">

1. **Takın ve OBS'in bağlantısını açın.** Kumandayı takın (USB veya Xbox Wireless; Windows'un başka bir sürücüye ihtiyacı yoktur). OBS'te **Araçlar → WebSocket Sunucu Ayarları**'nı açın, **WebSocket sunucusunu etkinleştir**'i işaretleyin, **Kimlik Doğrulamayı Etkinleştir**'i işaretli bırakın ve **Tamam**'a tıklayın.
2. **Fadester Companion'ı açın** ([Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4), sonra Başlat menüsü; [kurulum kılavuzu (İngilizce)](../../../tourbox/README.md)). Üstteki **OBS** ışığı yeşile döner (turuncuysa yanındaki **Göster**'e tıklayın). **Kumanda** ışığı kumandanın takılı olduğunu ama kullanılmadığını söylüyorsa **Kullan**'a tıklayın. Aksi hâlde **Kurulum** sekmesinde, **2 Kumandanızı seçin** altında **Xbox veya XInput oyun kumandası kullan**'ı işaretleyin, **Kolay mod**'u işaretli bırakın ve **Kontroller** ışığı yeşil değilse **Başlat**'a tıklayın.
3. **Geçiş yapın.** OBS 33'te **Stüdyo Modu**'nu açın, **Solma** (Fade) geçişini seçin ve sonraki sahneyi Önizleme'ye almak için yön tuşunun aşağısına basın. Sağ tetiği yarıya kadar çekin: OBS'in T-bar'ı onu izler. Bırakın: geri döner. Sonuna kadar çekin: Önizleme Program'a geçer.

Hepsi bu kadar. Üstteki ışıklar *Kumanda: bağlı* ve *Kontroller: açık* gösterir.

[Tam kılavuz (İngilizce)](../../gamepad/README.md)

<a id="vjster"></a>

## VJster

**VJster 1.5.0**, Stream Deck'inizden bir YouTube videosunun hızını yönetir: bir kadranı çevirin, video oynarken hızlanır veya yavaşlar; bir tuş 0.5x, 1x ya da 2x yapar. Bir Chrome sekmesinde, bir OBS tarayıcı kaynağında veya ikisinde birden çalışır; bu bilgisayardan dışarı hiçbir şey çıkmaz.

<img src="../../vjster/install-steps.svg" alt="Üç adımda VJster: 1, tuşları edinin (Stream Deck'te Fadester for OBS ya da Fadester Companion); 2, VJster uzantısını Chrome Web Store'dan ekleyin; 3, bir YouTube videosu oynatın ve kadranı çevirin: hız onu izler." width="900">

1. **Tuşları edinin.** **Fadester for OBS 0.9.0 veya daha yenisi** sizde var mı? Yedi VJster eylemi zaten içinde: bu adımı atlayın. Yoksa `com.jbrick2070.vjster.streamDeckPlugin` dosyasına çift tıklayın ve birlikte gelen profilleri kabul edin (Stream Deck + için **VJster Live +** ve **VJster Dual +**, 15 tuş için **VJster Live**, **VJster Mini**).
2. **Chrome uzantısını ekleyin.** [VJster'i Chrome Web Store'dan](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) ekleyin. Seçenekler sayfası bir kez açılır.
3. **Deneyin.** **VJster Speed**'i bir kadrana veya **VJster Speed Preset**'i bir tuşa sürükleyin (Stream Deck eylem adlarını İngilizce gösterir; VJster eklentisinde adları **Speed** ve **Speed Preset**'tir, ya da bir VJster profiline geçin). Chrome'da bir YouTube videosu oynatın. Birkaç saniye içinde HIZ şeridi (İngilizcesi SPEED) veya 1x tuşu oynadığını gösterir. Kadranı çevirin.

Hepsi bu kadar. Şeritte **UZANTI KAPALI** (İngilizcesi EXTENSION OFF) yazıyorsa [INSTALL.md](../../vjster/INSTALL.md#when-something-is-off) içindeki *When something is off* (İngilizce) bölümüne bakın.

[Tam kılavuz (İngilizce)](../../vjster/README.md)

<a id="vjster-install"></a>

## VJster: kurulum

VJster ile Stream Deck'iniz, TourBox'ınız veya oyun kumandanız Chrome'daki bir YouTube videosunun hızını ve kalitesini değiştirir.

<img src="../../vjster/install-steps.svg" alt="Üç adımda VJster: 1, tuşları edinin (Stream Deck'te Fadester for OBS ya da Fadester Companion); 2, VJster uzantısını Chrome Web Store'dan ekleyin; 3, bir YouTube videosu oynatın ve kadranı çevirin: hız onu izler." width="900">

1. **Tuşları edinin.** [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest)'i Stream Deck'e kurun: eylem listesinde yedi **VJster** eylemi zaten vardır. (TourBox veya oyun kumandası mı kullanıyorsunuz? [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4)'ı kurun ve kontrollerini başlatın.)
2. **Chrome uzantısını ekleyin.** [VJster'i Chrome Web Store'dan](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) ekleyin (Chrome 116 veya daha yenisi).
3. **Deneyin.** **VJster Speed**'i bir tuşa veya kadrana koyun ve Chrome'da bir YouTube videosu oynatın. Birkaç saniye içinde tuş oynayan videoyu gösterir; kadranı çevirin, video onu izler. Zaten açık olan bir sekmeyi bir kez yenileyin.

Hepsi bu kadar. OBS'in açık olması gerekmez.

[Tam kılavuz (İngilizce)](../../vjster/INSTALL.md)

<a id="vjster-tourbox"></a>

## TourBox ile VJster

Tek VJster Chrome uzantısı Stream Deck, OpenDeck ve TourBox ile çalışır. TourBox'ta uzantının bağlantısını Fadester Companion'ın kendisi sağlar.

1. **TourBox'ı hazırlayın.** Fadester Companion'ı kurun ve hazır ayarını içe aktarın: [TourBox bağlama](../../../tourbox/README.md#connect-a-tourbox) (İngilizce).
2. **Chrome uzantısını ekleyin.** [VJster'i Chrome Web Store'dan](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) ekleyin ve Chrome'da bir YouTube videosu oynatın.
3. **Çıkıntılı Knob'u çevirin.** Videonun hızı onu izler. 1x için **Side**'a hafifçe dokunun.

Hepsi bu kadar. OBS kapalı olabilir.

[Tam kılavuz (İngilizce)](../../vjster/TOURBOX.md)
