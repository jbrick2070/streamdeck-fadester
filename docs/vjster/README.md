# VJster

**VJster 0.2.0** rides the speed of a YouTube video from your Stream Deck. Turn a dial, the video speeds up or slows down while it plays; press a key for 0.5x, 1x or 2x; nudge in 0.05 steps to match a beat. It works on a video in a Chrome tab, or on a video inside an OBS browser source, or both at once. Nothing leaves this computer.

**Do you have Fadester for OBS 0.9.0 or later?** Then you already have the seven VJster actions (**VJster Speed** and the rest). Install only the Chrome extension. Do not install the VJster plugin too: both would want the same link port.

VJster needs no OBS connection. It has three parts:

| Part | What it does |
|---|---|
| The keys and dials | In Fadester for OBS 0.9.0 or later, or in the VJster plugin for decks without Fadester. They also serve the OBS page. |
| The Chrome extension | Controls the video in a Chrome tab. |
| The OBS page | A browser source for OBS that plays one YouTube video at the speed the deck sets (0.25x to 2x). |

Install steps, the OBS page, languages and uninstall: [INSTALL.md](INSTALL.md).

## First five minutes

1. **Get the keys.** With Fadester for OBS 0.9.0 or later, skip this step. Otherwise double-click `com.jbrick2070.vjster.streamDeckPlugin`. When Stream Deck asks whether to install the bundled profiles, say yes: **VJster Live +** and **VJster Dual +** (Stream Deck +), **VJster Live** (15 keys) and **VJster Mini** appear in your profile list.
2. **Add the Chrome extension.** Add [VJster from the Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb). Its options page opens once.
3. **Try it.** Drag **VJster Speed** onto a dial or **VJster Speed Preset** onto a key (in the VJster plugin they are named **Speed** and **Speed Preset**, or switch to a VJster profile). Play a YouTube video in Chrome. Within a few seconds the SPEED strip (or the 1x key) shows it playing. Turn the dial.

If the strip says **EXTENSION OFF**, see *When something is off* in [INSTALL.md](INSTALL.md).

## The controls

- **Speed** (dial): turn for speed, hold and turn for fine steps, press for 1x, tap the strip to play or pause.
- **Quality** (dial): step through the video's quality levels; press or tap for Auto. YouTube only.
- **Speed Preset** (key): one fixed speed. Lights up while it is the speed playing.
- **Speed Step** (key): faster or slower by one step.
- **Quality Preset** (key): one fixed quality level, or Auto.
- **Pin Tab** (key): keep controlling the current Chrome tab whatever else plays. Press again to let go.
- **Play / Pause** (key).

Each action's **Control** setting picks what it drives: **Chrome tab**, **OBS page**, or **Both**. Both sends every turn and press to both and shows Chrome's state.

## Languages

The plugin, its keys and its settings page come in nine languages: English, German, Spanish, French, Japanese, Korean, Simplified Chinese, Traditional Chinese and Dutch, chosen under **Language** on the settings page (Automatic follows Stream Deck's language). The Chrome extension follows Chrome's language and the OBS page uses the language in its address. Details and how to send corrections: [INSTALL.md](INSTALL.md).

## Licence

GPL-2.0-or-later, like Fadester for OBS. VJster is an independent project and is not made, endorsed or supported by Google, YouTube, the OBS Project or Elgato.
