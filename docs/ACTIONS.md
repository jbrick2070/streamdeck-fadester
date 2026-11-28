# Fadester for OBS: every action

The full reference for each control in the plugin: what it does, its settings and how the dials behave. Getting started is in the [README](../README.md#three-steps-to-the-first-working-key); what to do when a key shows a message is in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

![Photo of a Stream Deck + running an earlier version of Fadester for OBS in Dutch, before OBS was set up: scene keys, two Playlister keys, the red PANIEK (Panic) key, a T-bar strip and a Desktop Audio dial on the touch strip. Several keys still ask for Studio Mode or a Playlister to be picked.](images/streamdeck-fadester-hero.jpg)

Every control is in the *Fadester for OBS* category of Stream Deck's action list, in this order. Drag one onto a key or dial and click it to open its settings.

## Scene

Key. **Next scene**, **Previous scene**, **Random scene**, a numbered scene, a scene by name, or **The scene in Preview (to Program)**. Under **When pressed**: **Transition to it** (OBS's current transition, or one you choose: Fade, Fade to Black, or any transition installed in OBS), **Cut to it**, or **Put it in Preview**.

- Cut and transitions work in both modes; Preview needs Studio Mode. Length in beats and a start on the beat are under **Timing**.
- Numbered scene keys follow positions in your OBS scene list, so they work without setup.
- A key whose scene is on Program has a red frame and the word PROGRAM; in Preview, a green frame and PREVIEW. The key names the transition it will use, for example **Next · Fade**.

## Volume & T-bar

Dial on a Stream Deck +. Turn to ride one audio input, or choose **Switch scenes (T-bar)** under **Control**: the strip shows the PROGRAM and PREVIEW scenes and the dial fades Preview into Program, as the APC40's crossfader does.

- Turn right all the way to finish the fade; let the dial rest a moment, then turn right again for the next one. A press sends Preview to Program at any point. The T-bar needs Studio Mode and two different scenes.
- **Dial press** is yours to choose: Preview to Program, next blend mode on the selected source, Normal blend, show or hide, or nothing. **Scene loop** can queue the next scene after each transition you finish, so one dial walks through your scenes.
- **No flash** when the dial can reach OBS's own on-screen T-bar slider: OBS 33 on the same computer, the Fade transition selected, and OBS's main window not minimised and not running as administrator (Windows) or Accessibility granted (macOS, experimental, full endpoints not yet verified on Mac hardware).
- **Otherwise** (over the network, another transition, OBS minimised or elevated, no Accessibility) the dial ends a fade by leaving and re-entering Studio Mode: OBS's own window flashes white for a moment, while the picture OBS sends out stays clean. The **Midi Fadester Fader** dial, with Midi Fadester installed, has none of these window or permission requirements.

## Audio Fade

Key. Fade one audio input to 0 % or to 100 % over a chosen time, or instantly. A later move of that input cancels its running fade.

## Whole-show fade (All OBS mixer inputs)

Choose **All OBS mixer inputs** under **Control** on **Audio Fade** or **Volume & T-bar**. This needs [Fadester Companion](../tourbox/README.md) (Windows, from the [Microsoft Store](https://apps.microsoft.com/detail/9PN7D3P2X7F4) or the release ZIP; Mac, from the release's `Fadester-Companion-macOS-*.zip`): turn on **All OBS mixer inputs** there, choose mix-only mode if you do not use a TourBox, and start its controls. The key fades out or restores the Whole mix; the dial adjusts it in the steps set in Fadester Companion. Restore mix returns each managed input to its own level. Normal source controls do not need Fadester Companion.

## Source & Layer

Key or dial. Browse the sources of the current scene with a dial or Previous/Next keys, and show or hide the selected one.

- The selection is shared by every Fadester for OBS control on that scene. It follows Preview in Studio Mode, otherwise Program; you can pin it to a fixed scene. A key that edits the scene on Program is framed red and says so.
- Optional creative controls cycle blend modes (Normal, Additive, Subtract, Screen, Multiply, Lighten, Darken) and move a layer up or down; reordering stays off until you turn it on.
- To fade a layer, put a Color Correction filter on it and ride its opacity with **Filter**.

## Filter

Key or dial. On a dial, ride one filter setting: a Visual Sidechain Shader Filter's Effect mix or Reactivity, a Color Correction's opacity, or most numeric settings you give a range (not modes, file paths, colours and a few safety settings). Press the dial to drop the value while held. On a key: turn a filter on or off, glide a setting to a value over a time, or step it. Choose the source and its filter once in the settings page. Changes are smoothed and never touch a setting an Audio Modulator or a fader already drives.

## Playlister

Key. **Previous**, **Next**, **Play / pause**, **Stop**, **Restart** or **Status** for one [Playlister](https://github.com/jbrick2070/obs-playlister) source, chosen in the key's settings page. Needs Playlister 0.5 or later in OBS.

- The key shows what OBS reports (Playing, Paused, Stopped, with the time), not just that a press was sent.
- With Playlister 1.5.0 or newer (the first that says what it plays, through its `get_now_next` request over obs-websocket), **Status** and **Play / pause** show the playing item's name instead of their own word, and **Next** names the item that follows (not with Shuffle on, where Playlister chooses the next item only as it starts). A key with a label of its own keeps it. Names only: never a folder or an address. With an older Playlister (0.5.x) the keys show their own words; there is nothing to set.

## Tape Deck

Key or dial. Drives one [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md) **Tape Deck** filter on an OBS Browser Source (`25% to 800% (0.25x to 8x)` live speed).

- Turning a dial steps along the 11-rung speed ladder. A press runs **Play / pause**, **Cue to start**, **Normal speed (100% / 1x)**, **Speed up** or **Speed down**.
- The face shows speed in both units (`"150% (1.5x)"`), playing or paused, and the plain states **NOT LOADED** (Visual Sidechain absent) and **NO DECK** (no deck found). It redraws on `decks_changed`, with no polling, at most 10 times a second per key.
- Tape Decks stay outside Visual Sidechain's Panic and Restore visuals. *(Direct Fadester Companion / TourBox Tape Deck preset bindings are a planned follow-up.)*

## Visual Panic

Key. [Visual Sidechain](https://github.com/jbrick2070/midi-fadester/blob/main/docs/VISUAL-SIDECHAIN.md)'s own **Panic** (instant) and **Restore visuals** (hold 0.8 s), sent through OBS's hotkeys. After Panic the key reads **PANIC SENT** until Restore visuals is accepted or the OBS connection drops; meanwhile no Visual Sidechain filter is written from the deck. Needs Visual Sidechain in OBS (it comes with Midi Fadester 0.9.0 or newer), and the key looks the same without it: so before the show, hold **Restore visuals** once (it changes nothing when no Panic is on). If the key then says **Needs Midi Fadester**, OBS has no Visual Sidechain.

## Visual Sidechain Meter

Key or dial. Visual Sidechain's BPM and the beat. Press to tap the tempo, lock the BPM or resync beat 1; on a dial, a turn changes the BPM by 1 per click. Needs Visual Sidechain in OBS.

## Scene Info Bar

Stream Deck Neo. Shows the connection, the Program scene and, in Studio Mode, the Preview scene. Display only.

## Midi Fadester Fader and Auto-fade (optional)

**Midi Fadester Fader (optional)** and **Midi Fadester Auto-fade (optional)**: a dial and a key for one slot of [Midi Fadester](https://github.com/jbrick2070/midi-fadester), for people who use it with an APC40 or another MIDI controller. Everything else in this plugin works without Midi Fadester.

## VJster's seven actions

**VJster Speed**, **VJster Quality** and the other VJster actions are in the same list. What each does: [vjster/README.md](vjster/README.md); setup: [vjster/INSTALL.md](vjster/INSTALL.md).

## The plugin's own settings

The line at the foot of every settings page (for example `Fadester for OBS 1.5.2 · Connected to OBS 33.0.1 · Settings`) opens **Language**, **OBS connection**, **Setup checklist** and **Ready-made layouts**. They apply to every Fadester for OBS key and dial.

- **OBS on another computer, or another port:** fill in the host, the port and OBS's password (in OBS: **Tools > WebSocket Server Settings > Show Connect Info**) and press **Save for all controls & test**. You type it once for all keys and dials.
- **Setup checklist:** red marks what must be fixed (OBS reachable, password accepted). Studio Mode, the Fade transition, the OBS version and the T-bar rows are notes: they matter only for the controls that name them.

## Languages

Fadester for OBS speaks thirteen languages: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese.

- **Choose:** open any control's settings page, click the line at its foot and choose under **Language**. The choice applies at once to every Fadester for OBS key, dial and settings page (the VJster ones and the two Midi Fadester pages included) and survives restarts. A VJster key's settings page has the same **Language** box: it is the one setting, shown in both places.
- **Automatic** follows Stream Deck's language. Stream Deck itself offers eight of the thirteen (English, German, Spanish, French, Japanese, Korean and the two Chinese), so Dutch, Italian, Brazilian Portuguese, Russian and Turkish are chosen by hand under **Language**. Stream Deck's own menus, action list, tooltips and dial hints stay in Stream Deck's language.
- **OBS's own words** (Studio Mode, Preview, Program, Scene, Source, Transition) use OBS's translation, so the deck matches OBS; where a key or strip is too small for the whole word it is cut short (Dutch **Voorvert.** for Voorvertoning, Brazilian Portuguese **Pré-vis.** for Pré-visualização). Your scene, source and filter names are shown as they are.
- **Who translated:** the translations were drafted by an AI model (Claude); eight of them were reviewed by a second one (Gemini), while Italian, Brazilian Portuguese, Russian and Turkish have had no second review yet. No native speaker has checked any of them. If something reads wrong, please open an issue or a pull request: the files are `io.github.jbrick2070.fadester-for-obs.sdPlugin/<language>.json`, with `en.json` as the English source. VJster's languages are in [vjster/INSTALL.md](vjster/INSTALL.md).
