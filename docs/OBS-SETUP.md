# Fadester Suite: first-run OBS settings, in full

The short list is in [START-HERE.md, section 3](START-HERE.md#3-first-run-steps-every-setup). This page has the details behind each step.

**Shortcut on Stream Deck or OpenDeck:** open any **Fadester for OBS** key's settings, click the line at the foot of the page and open **Setup checklist**. It checks every step below by itself and gives a one-sentence fix for anything still off. Red there must be fixed; Studio Mode, the Fade transition and the OBS version are notes, needed only for the T-bar and Preview controls.

## 1. Enable obs-websocket

Open OBS Studio 33.x, click **Tools > WebSocket Server Settings**, tick **Enable WebSocket server** and click **Apply**. Leave the port and **Enable Authentication** as they are.

- **Fadester Companion** reads OBS's saved password from OBS's local config automatically.
- **Fadester for OBS** (Stream Deck / OpenDeck) also reads the password and the port by itself when OBS runs on the same computer (from `%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json` on Windows, `~/Library/Application Support/obs-studio/plugin_config/obs-websocket/config.json` on macOS). There is nothing to fill in.
- **OBS on another computer:** click the line at the foot of any key's settings page, open **OBS on another computer, or another port**, fill in host, port and password and click **Save for all controls & test**.

## 2. Turn on Studio Mode

In OBS click **Studio Mode** (or **View > Studio Mode**) so **Preview** sits on the left and **Program** on the right. T-bar and Preview controls need it.

## 3. Select the Fade transition

In OBS's **Scene Transitions** dock, set the active transition to **Fade**. OBS's manual T-bar mixes scenes smoothly only with **Fade**.

## 4. Keep OBS un-elevated and visible (Windows native T-bar)

- Do **not** start OBS with **Run as administrator** while Stream Deck or Fadester Companion runs as your normal Windows user: Windows UIPI blocks a normal-user process from driving an elevated OBS window's Studio Mode slider.
- Keep OBS's main window open on the desktop (behind other windows is fine, just **not minimised** to the taskbar) when driving OBS's built-in Studio Mode T-bar without Midi Fadester. (If **Midi Fadester** owns the T-bar in-process, OBS may be minimised.)

## 5. TourBox users: import the preset and turn off Auto Switch

- Open **TourBox Console**, click **Import into TourBox Console** in Fadester Companion (it copies the preset's path) and paste it in Console's import window.
- Turn **Auto Switch** off and select **OBS Fadester for TourBox**, so the one preset works whichever application is in front. (Keeping Auto Switch on instead? Link the preset to OBS, `obs64.exe` on Windows or `OBS.app` on macOS, and to Google Chrome to control videos with Chrome in front.)

## 6. macOS: Accessibility per host app (not yet verified on hardware)

macOS grants Accessibility per application. In **System Settings > Privacy & Security > Accessibility**, enable the app that actually drives OBS's native T-bar (`Elgato Stream Deck.app`, `OpenDeck.app`, or **Fadester Companion.app**, whose bundled helpers appear as **Fadester Companion T-bar** and **Fadester Companion Shortcuts**).
