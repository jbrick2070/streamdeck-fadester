# Fadester Companion for Mac

Fadester Companion lets a full-size TourBox mix OBS Studio scenes on a Mac: the flat Dial drives OBS's own Studio Mode T-bar, Scroll picks the next scene, and the buttons fade, cut and ride the music. It also answers the whole-mix keys of a Stream Deck or a MIDI controller. The version is in the window's title and under **Fadester Companion → About Fadester Companion**.

## Install and open

1. Move **Fadester Companion.app** from this folder to **Applications**.
2. Open it. The app is not notarized by Apple yet, so macOS refuses the first time. Go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. (On macOS 14 and older you can instead Control-click the app and choose **Open**, then **Open** again.)
3. In OBS 33, open **Tools → WebSocket Server Settings**, turn on **Enable WebSocket server**, keep authentication on and click **OK**. Fadester Companion connects by itself with the password OBS saved on this Mac. The **OBS** light at the top of the window turns green; when it is amber, the button beside it says what to do (**Turn on** switches Studio Mode on for you).

## Set up your TourBox

1. On the **Setup** tab click **1. Save TourBox Preset (.tb)…** and save the file, for example in Downloads.
2. Click **2. Open TourBox Console**. In Console click the **Import** icon beside **Preset List** and open that file. **Show me where to click** plays these clicks.
3. In Console turn **Auto Switch** off and select **OBS Fadester for TourBox**, so the preset works whichever app is in front.
4. When the **Controls** light says *Accessibility: needed*, click **Grant…** beside it and turn on **Fadester Companion** in System Settings → Privacy & Security → Accessibility (and **Fadester Companion T-bar**, if macOS lists it too). The T-bar needs this permission. The controls then start by themselves.

Turn **Scroll** one step: Preview changes and Program stays. Turn the **Dial** to fade between them.

## While you work

Closing the window does not stop the controls: Fadester Companion stays in the menu bar, at the top right of the screen. Click that icon to open the window, to **Stop** or **Start** the controls, or to **Quit Fadester Companion**. Keep OBS's main window open with its T-bar visible.

## More help

- `START-HERE.html` in this folder: every control, a first rehearsal and what to do when something does not answer (English).
- `guide/<language>.html`: the quick start in 12 more languages. The **Quick guide** button in the window opens the one for your language.
- `presets/<language>/`: the same TourBox preset with labels in that language.

## Remove

Quit Fadester Companion from its menu-bar icon and move the app to the Trash. In TourBox Console, delete the **OBS Fadester for TourBox** preset. Your settings are in `~/Library/Application Support/FadesterTourBox`; delete that folder too if you do not want them kept. In System Settings → Privacy & Security → Accessibility you can remove the Fadester Companion entries.

Not yet checked on a real Mac: opening a downloaded copy, the Accessibility prompt, and control of OBS from a physical TourBox. Please report what you find, with your Mac (Apple silicon or Intel) and macOS version: https://github.com/jbrick2070/streamdeck-fadester/issues
