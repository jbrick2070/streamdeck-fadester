# Fadester Companion for Mac

Fadester Companion lets a full-size TourBox mix OBS Studio scenes on a Mac: the flat Dial drives OBS's own Studio Mode T-bar, Scroll picks the next scene, and the buttons fade, cut and ride the music. It also answers the whole-mix keys of a Stream Deck or a MIDI controller. The version is in the window's title and under **Fadester Companion → About Fadester Companion**.

## Quick start

1. **Install and open.** Move **Fadester Companion.app** from this folder to **Applications** and open it. The first time, macOS refuses (the app is not notarized yet): go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**.
2. **Let it reach OBS.** In OBS 33, open **Tools → WebSocket Server Settings**, turn on **Enable WebSocket server**, keep authentication on and click **OK**. The **OBS** light at the top of the window turns green; when it is amber, the button beside it says what to do (**Turn on** switches Studio Mode on).
3. **Import the preset.** On the **Setup** tab click **Import into TourBox Console**: it saves the preset to Downloads, copies its path and opens Console. In Console click the **Import** icon beside **Preset List**, press ⌘⇧G, then ⌘V and Return, and open the file. Turn **Auto Switch** off and select **OBS Fadester for TourBox**.
4. **Allow Accessibility.** When the **Controls** light says *Accessibility: needed*, click **Grant…** beside it and turn on **Fadester Companion** in System Settings → Privacy & Security → Accessibility (and **Fadester Companion T-bar**, if listed). The controls then start by themselves.

That's it. Turn **Scroll** one step: Preview changes and Program stays. Turn the **Dial** to fade between them.

## Good to know

- **macOS 14 and older:** instead of **Open Anyway** you can Control-click the app, choose **Open**, then **Open** again.
- **The preset file** is `OBS Fadester for TourBox.tb` in Downloads. If a different file of that name is already there, it is left alone and the new one is `OBS Fadester for TourBox 2.tb`: import the file the window names. If you refuse access to Downloads, a save window asks where to put it.
- **The file window** does not accept ⌘⇧G? Pick the file in Downloads by hand. **Show me where to click** plays these clicks.
- **The T-bar** needs the Accessibility permission, and OBS's main window open with its T-bar visible.
- **Closing the window does not stop the controls.** Fadester Companion stays in the menu bar, at the top right of the screen. Click that icon to open the window, to **Stop** or **Start** the controls, or to **Quit Fadester Companion**.

## More help

- `START-HERE.html` in this folder: every control, a first rehearsal and what to do when something does not answer (English).
- `guide/<language>.html`: the quick start in 12 more languages. The **Quick guide** button in the window opens the one for your language.
- `presets/<language>/`: the same TourBox preset with labels in that language.

## Remove

1. Quit Fadester Companion from its menu-bar icon and move the app to the Trash.
2. In TourBox Console, delete the **OBS Fadester for TourBox** preset.
3. Optional: delete your settings in `~/Library/Application Support/FadesterTourBox`, and remove the Fadester Companion entries in System Settings → Privacy & Security → Accessibility.

## Not yet checked on a real Mac

Opening a downloaded copy, the Accessibility prompt, and control of OBS from a physical TourBox. Please report what you find, with your Mac (Apple silicon or Intel) and macOS version: https://github.com/jbrick2070/streamdeck-fadester/issues
