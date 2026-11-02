# Fadester for OBS -- Manual checks

Numbered checks that need a real Stream Deck, the Stream Deck app or a real OBS, with the expected result.
Automated tests cover everything else (PLAN.md). Each release lists which items were run, by whom and on what
versions. VJster's own checks are in `docs/vjster/TESTING.md`.

## 1. Language choice (PLAN.md section 11, step L.5)

The device check that comes before the reel is filmed (R-LANG-10). Both plugins are checked together, because
the reel shows both; VJster's items are `docs/vjster/TESTING.md` section 6. The same flow already ran in a
simulator, with Stream Deck's language English and the plugins' own setting Nederlands or 日本語 (images and
how they were made: `C:\midi-fadester\docs\demo-reel\production\v2\captures\deck-lang\LOG.md`); what the
simulator cannot show is the real device: fonts, fit on the hardware, the Info Bar as Stream Deck draws it,
the app's own menus, and a real restart.

Leave the Stream Deck app in its own language (English) for the whole check: the point is that the plugins
change language without it.

1.1 **Install the two builds.** The release files built from branch `sd-language` at b20bd27 (step L.4, the
parent of the L.5 commit; L.5 changed docs only) for this check: `com.jbrick2070.fadester-for-obs.streamDeckPlugin` and
`com.jbrick2070.vjster.streamDeckPlugin`, left in the build session's scratchpad folder
`C:\Users\jeffr\AppData\Local\Temp\claude\C--Users-jeffr-Documents-obs-playlister\8f128e4d-248a-4661-8b45-ed4e10bd7d5d\scratchpad\lang-builds`.
That folder is temporary: copy the two files somewhere of your own before installing. If it is gone, check out
b20bd27, run `npm run build`, and pack each plugin folder without its `logs` with `npx streamdeck pack <folder>`.
If either plugin is linked for development, unlink it first
(`npx streamdeck unlink <uuid>`). Double-click each file. Expected: Stream Deck installs Fadester for OBS
0.7.7.0 and VJster 0.1.0.0 (the versions change only after this check, D-L10); the existing profiles and keys
stay.

1.2 **Fadester in Dutch.** With OBS running and the VJ Rig + profile on the Stream Deck +, open the settings
of any Fadester for OBS control, find the **Language** section ("all Fadester controls") and pick
**Nederlands**. Expected:
- the settings page changes to Dutch in place (TAAL, OBS-VERBINDING, "Verbonden: OBS ..."); a host or port
  typed and not yet saved stays, and open sections stay open;
- every Fadester key and dial redraws in Dutch at once, on every page of the profile. Perform: Overnemen ·
  Overgang, Vorige · Voorbeeld, Willekeurige scène, Afspelen / pauzeren, PANIEK with "Strobe en flits uit",
  dials LIVE / VOLGENDE with "Druk: Volgende live", Effectmix, Reactiviteit, Hoofdaudio. Layers: Vorige bron,
  Tonen / verbergen, Blend Normaal, Dekking. Visuals: AAN / UIT, Herstellen with "Houd 0,8 s vast" (a decimal
  comma). Scenes: Overnemen · Cut ("Cut" stays English), Scène 1 · Voorbeeld;
- every word sits inside its key or strip on the hardware, nothing cut off or overlapping; only OBS's own names
  (scenes, sources, filters), LIVE and Cut stay as they are;
- Stream Deck's own action list, tooltips, dial hints and menus stay English, as the page's note says.

1.3 **The Info Bar (only with a Stream Deck Neo at hand).** With the OBS Scene Info Bar action on the Neo and
Nederlands chosen. Expected: "OBS verbonden", "LIVE <program scene>" and, in Studio Mode, "VOORBEELD <preview
scene>"; with OBS closed, "OBS niet verbonden". The words fit the bar.

1.4 **Another page opens in Dutch.** Close the settings and open another Fadester control's settings.
Expected: the page is Dutch from its first paint (no English flash), with Nederlands in the Language select.

1.5 **The choice is kept over a restart.** Quit the Stream Deck app (from the tray) and start it again.
Expected: the Fadester keys and dials come back in Dutch without opening any settings; the Language select
still shows Nederlands. Then do the same for VJster (`docs/vjster/TESTING.md` 6.3).

1.6 **Back to Automatic.** Pick **Automatic (Stream Deck's language)** in the Language section. Expected:
every Fadester key, dial and the page go back to English at once; the OBS connection is unchanged (still
connected, host, port and password kept).

1.7 **Japanese on an English Stream Deck app (risk RL-10).** Pick **日本語** and look at the VJ Rig + pages
and the transport keys. Expected: kana and kanji render in a Japanese font (no boxes, no question marks, no
Chinese-looking glyph forms) and fit their keys and strips (パニック, 復元 with "0.8 秒長押し", エフェクトミックス ·
<filter>). Then pick Automatic again.

1.8 **Judgement calls to look at on the device** (they pass the fit test; say if they read badly):
"HOUDEN 3 s: FADE" on a Midi Fadester fader cell (only with Midi Fadester actions placed), and the Dutch on the
keys overall, which no native speaker has reviewed yet.

Record here and in PLAN.md 11.5: the date, who ran it, the Stream Deck app version, the device models, the OBS
version, and each item passed or the words that failed.

**Result (2026-11-01).** Run by the operator on a Stream Deck + (device 4057/132), Stream Deck app 7.6.0.23012,
OBS 33.0.1 with obs-websocket 5.7.6, Windows 11; the builds from b20bd27 installed by double-click.

- 1.1 PASSED: both installed, the existing profiles kept. Note: Fadester kept its last saved connection port, 4466,
  from an earlier portable-OBS capture run; the operator set it back to 4455 and saved. That is the saved setting
  surviving an update, as designed.
- 1.2 PASSED: all pages of VJ Rig +: Filter aan/uit, Kies een filter, Herstellen with Houd 0,8 s vast, Reactiviteit,
  PANIEK with Strobe en flits uit, Vorige/Volgende bron, Tonen / verbergen, Blend Normaal, Voorbeeld overnemen,
  Vorige/Volgende/Willekeurige scène, Afspelen / pauzeren, Scène 1-4 (automatisch), the LIVE / VOLGENDE strip,
  Kies OBS-bediening / Open de instellingen. Every word fits on the hardware; OBS's own names, LIVE and Cut
  unchanged.
- 1.3 NOT RUN: no Neo at hand.
- 1.4 PASSED: other controls' pages opened in Dutch, no English flash seen.
- 1.5 PASSED: app restarted at 15:03:40, the keys back in Dutch with no page opened.
- 1.6 PASSED: Automatic gave English at once, OBS still connected.
- 1.7 PASSED: 日本語: プレビューを送出, シーン 1 (自動), パニック with ストロボとフラッシュ停止, the page in Japanese; a real
  Japanese font, fits, small but readable on the keys.
- 1.8: no complaint reported.

Found on the way, fixed in step L.6 (PLAN.md 11.5): the static key images Stream Deck draws inside VJster's dial
circles and in its action list carried English words ("1x SPEED", "AUTO QUALITY"); they are now a number or a symbol
only (Fadester's images never had words). And VJster's pack lacked its OBS page (`bin/obs`), see
`docs/vjster/TESTING.md` section 6. The re-packed files (both plugins; Fadester's bytes unchanged) are in
`C:\Users\jeffr\Documents\StreamDeck-builds\2026-11-01-language-choice\` (`BUILT-FROM.txt` says what they were built
from) and in the scratchpad `lang-builds` folder of 1.1; the operator re-installs VJster from there.
