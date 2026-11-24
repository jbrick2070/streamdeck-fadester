# Fadester for OBS: hızlı başlangıçlar

*Bu, İngilizce hızlı başlangıçların bir yapay zekâ modeliyle yapılmış ve ikinci bir yapay zekâ modeliyle denetlenmiş çevirisidir; henüz ana dili Türkçe olan biri tarafından gözden geçirilmedi.*

[Fadester for OBS](#fadester-for-obs) · [Buradan başlayın](#start-here) · [Hazır düzenler](#layouts) · [OpenDeck](#opendeck) · [VJster ile tek eklenti](#suite) · [Düzen dosyalarını elle içe aktarma](#profiles)

Stream Deck'in Türkçesi yok: eylem listesinde İngilizce adlar görünür (örneğin **Scene**). Fadester for OBS'in tuşları ve ayar sayfaları, **Dil** altında seçtiğinizde Türkçe olur.

<a id="fadester-for-obs"></a>
## Fadester for OBS

Fadester for OBS, OBS Studio'yu Stream Deck'inize getirir: sahneler, geçişler, kaynaklar, filtreler ve ses, tuşlarda ve kadranlarda.

<img src="../../docs/images/first-key-steps.svg" alt="Üç adımda ilk tuş: 1, .streamDeckPlugin dosyasına çift tıklayıp kurun; 2, OBS'te Araçlar → WebSocket Sunucu Ayarları'nda sunucuyu açın; 3, Stream Deck'te Scene'i bir tuşa sürükleyip basın: OBS sonraki sahneye geçer." width="900">

1. **Eklentiyi kurun.** [Sürümler sayfasından](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) adı `.streamDeckPlugin` ile biten dosyayı indirip çift tıklayın. Kurulumu Stream Deck'te onaylayın.
2. **OBS'in WebSocket sunucusunu açın.** OBS'te: **Araçlar → WebSocket Sunucu Ayarları**, sunucuyu açın ve **Tamam**'a basın. Kimlik doğrulamayı olduğu gibi bırakın: kopyalanacak bir şey yok.
3. **Scene'i bir tuşa sürükleyin.** Stream Deck'in eylem listesinde, *Fadester for OBS* kategorisinden **Scene**'i bir tuşa sürükleyin. Başta **Sonraki sahne** olarak çalışır: basın, OBS sonraki sahneye geçer.

Bu kadar. OBS aynı bilgisayardaysa eklenti kendiliğinden bağlanır. OBS bağlı değilken tuş ne yapmanız gerektiğini söyler, örneğin **OBS WebSocket'i açın** ya da **OBS'i başlatın**.

[Tam kılavuz (İngilizce)](../../README.md)

<a id="start-here"></a>
## Fadester Suite: buradan başlayın

Donanımınız için Fadester Suite'in hangi parçalarını kuracağınız ve OBS'i bir kez nasıl ayarlayacağınız. Çoğu kişi Stream Deck kullanır:

<img src="../../docs/images/first-key-steps.svg" alt="Üç adımda ilk tuş: eklentiyi kurun, OBS'te WebSocket sunucusunu açın, Scene'i bir tuşa sürükleyin." width="900">

1. **Fadester for OBS'i kurun.** `.streamDeckPlugin` dosyasını [sürümler sayfasından](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) indirin, çift tıklayın ve Stream Deck'e kurun.
2. **OBS'in WebSocket sunucusunu açın.** OBS Studio 33'te: **Araçlar → WebSocket Sunucu Ayarları**, sunucuyu açın, **Tamam**. Eklenti, OBS'in kaydettiği bağlantı noktasını ve parolayı kendisi okur.
3. **Scene'i bir tuşa sürükleyip** basın: OBS sonraki sahneye geçer. Deck'i doldurmak için tuşa, sonra ayar sayfasının altındaki satıra tıklayın ve **Hazır düzenler**'i açın.

Bu kadar. Başka bir denetleyici ya da daha fazla parça mı? Tablo tam kılavuzda.

[Tam kılavuz (İngilizce)](../../docs/START-HERE.md)

<a id="layouts"></a>
## Fadester for OBS: hazır düzenler

Stream Deck +, 15 tuşlu Stream Deck ve Stream Deck Mini için on dört düzen. Her biri düzenleyebileceğiniz bir profil olarak açılır.

<img src="../../docs/images/open-layout-steps.svg" alt="Üç adımda hazır düzen: 1, bir Fadester for OBS tuşuna tıklayın; 2, sayfanın altındaki satıra, sonra Hazır düzenler'e tıklayın; 3, bir düzen seçin ve Bu düzeni aç'a basın." width="900">

1. Stream Deck'te **bir Fadester for OBS tuşuna** tıklayın: ayarları açılır.
2. **Sayfanın altındaki satıra** (sürümü ve bağlantıyı gösterir) tıklayın ve **Hazır düzenler**'i açın.
3. **Bir düzen seçin ve Bu düzeni aç'a basın.** Deck'iniz o düzene geçer.

Bu kadar. OBS aynı bilgisayarda ve WebSocket sunucusu açıksa eklenti kendiliğinden bağlanır; tüm düzenler bu tek bağlantıyı kullanır.

[Tam kılavuz (İngilizce)](../../DECK-LAYOUTS.md)

<a id="opendeck"></a>
## OpenDeck ile Fadester for OBS ve VJster

[OpenDeck](https://github.com/nekename/OpenDeck), Stream Deck eklentilerini Elgato'nun Stream Deck yazılımı olmadan çalıştıran ücretsiz, açık kaynaklı bir programdır. Fadester for OBS onda olduğu gibi çalışır.

<img src="../../docs/images/opendeck-steps.svg" alt="Üç adımda OpenDeck'te Fadester for OBS: 1, deck bağlıyken ve Stream Deck yazılımı kapalıyken OpenDeck'i başlatın; 2, Fadester for OBS'i eklenti yöneticisinden kurun; 3, düzeni deck adının altındaki profil listesinden seçin." width="900">

1. **OpenDeck'i başlatın.** Deck'i bağlayın, Stream Deck yazılımını kapatın ve [OpenDeck](https://github.com/nekename/OpenDeck/releases)'i başlatın. Bu eklenti için [Node.js](https://nodejs.org/) 24 veya üstü gerekir.
2. **Fadester'i kurun.** OpenDeck'in eklenti yöneticisinde **Fadester for OBS** listedeyse kurun, değilse dosyadan kurma düğmesiyle [Fadester indirmesini](https://github.com/jbrick2070/streamdeck-fadester/releases/latest/download/io.github.jbrick2070.fadester-for-obs.streamDeckPlugin) seçin.
3. Deck adının altındaki profil listesinden **düzeninizi seçin**: Plus için **Scene Desk + (Regular Mode)**, 15 tuş için **Scene Desk 15 Keys (Regular Mode)**, Mini için **Source Desk Mini (Either Mode)**. Diğer modellerde **Scene**'i bir tuşa sürükleyin.

OBS'in WebSocket sunucusu açıksa (**Araçlar → WebSocket Sunucu Ayarları**) bu kadar. OBS aynı bilgisayardaysa Fadester kayıtlı parolayla bağlanır.

[Tam kılavuz (İngilizce)](../../docs/OPENDECK.md)

<a id="suite"></a>
## Tek eklentide Fadester for OBS ve VJster

Fadester for OBS, on dokuz eylemli tek bir eklentidir: on ikisi Fadester'in, yedisi VJster'in.

1. **Fadester for OBS'i Stream Deck'e ya da OpenDeck'e bir kez kurun** (yukarıya bakın).
2. **VJster eylemleri aynı listede**, *Fadester for OBS* kategorisindedir: **VJster Speed**, **VJster Quality** ve diğerleri.
3. **Chrome uzantısını ekleyin:** [Chrome Web Store'da VJster](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Eklentiyle 48150 numaralı bağlantı noktası üzerinden konuşur.

Bu kadar. VJster'i yalnızca bir programda çalıştırın: bu eklentide, ayrı VJster eklentisinde ya da Fadester Companion'da.

[Tam kılavuz (İngilizce)](../../docs/SUITE.md)

<a id="profiles"></a>
## Fadester düzen kitaplığı: bir dosyayı elle içe aktarma

En kolayı, bir düzeni **Hazır düzenler**'den açmaktır (yukarıya bakın). Bir dosyayı elle içe aktarmak için:

1. **Dosyaya çift tıklayın.** Deck'inize uygun `.streamDeckProfile` dosyasını seçin; Stream Deck onu yeni bir profil olarak içe aktarır.
2. **OBS'i bağlayın (genellikle yapacak bir şey yoktur).** OBS aynı bilgisayardaysa Fadester kendiliğinden bağlanır. Değilse bir Fadester tuşunun ayarlarını açın, sayfanın altındaki satıra tıklayın, **Başka bir bilgisayardaki OBS ya da başka bir bağlantı noktası**'nı açın, ana bilgisayarı, bağlantı noktasını ve parolayı girin ve **Tüm kontroller için kaydet ve sına**'ya basın.
3. **Tuşlara basın.** Sahne tuşları OBS'teki sahne listenizi izler; müzik, mikrofon ve Aux denetimleri ses girişlerinizi bulmuştur.

Bu kadar.

[Tam kılavuz (İngilizce)](../../profiles/README.md)
