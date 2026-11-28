# Fadester for OBS: when something is off

A key or dial that cannot do its job says why, in a few words. Find the words below. The first line of the key's settings page names the cause in full, and the **Setup checklist** (click the line at the foot of any settings page) checks the usual causes for you.

When OBS goes away, the plugin reconnects by itself and every key shows the same short reason, with a broken-link picture.

## The key or dial says

| The key or dial says | What to do |
|---|---|
| **Turn on OBS WebSocket** | In OBS: **Tools > WebSocket Server Settings**, tick **Enable WebSocket server**. |
| **Start OBS** | OBS is not running on this computer. Start it; the plugin connects by itself. |
| **OBS not connected** | OBS is on another computer, or has never saved its WebSocket settings; the plugin cannot tell which. Start OBS and tick **Enable WebSocket server**, or check the host and port under **OBS on another computer, or another port** at the foot of the settings page. The settings page's first line names the cause in full. |
| **Wrong password** | A password you typed wins over the one OBS saved. With OBS on this computer, open the line at the foot of the settings page and press **Use OBS's own password**. For OBS on another computer, copy the password from OBS's **Tools > WebSocket Server Settings > Show Connect Info** into **OBS on another computer, or another port** and press **Save for all controls & test**. Meanwhile the plugin tries again every 30 seconds and says so. |
| **Scene T-bar needs OBS Studio Mode**, **Preview selection needs OBS Studio Mode** | Turn on Studio Mode in OBS (**View > Studio Mode**), or open the layout again with **Turn on Studio Mode and open**. The Regular Mode layouts have no Preview or T-bar. |
| **Choose a different Preview** | The T-bar needs Preview and Program to be two different scenes. Pick another scene in Preview. |
| **Not set up**, **Choose a source**, **Choose a filter**, **Choose a Playlister** | That key or dial is not bound yet. Click it in Stream Deck to open its settings and pick the control, source, filter or Playlister. VJ Rig and Playlister Transport keys ship unbound on purpose. |
| **Needs Midi Fadester**, **Playlister missing** | Install that OBS plugin (Visual Sidechain comes with Midi Fadester 0.9.0 or newer), or switch to the scene collection that has the source. |
| **Companion offline**, **Whole mix is off** | An **All OBS mixer inputs** key or dial needs Fadester Companion. Start it, connect it to the same OBS, and turn on **All OBS mixer inputs** there. |
| **PANIC SENT** | Visual Sidechain's Panic is on. Hold **Restore visuals** for 0.8 s to bring the effects back. |
| **NOT LOADED**, **NO DECK** (Tape Deck) | Visual Sidechain is not in OBS, or no Tape Deck filter was found. See [ACTIONS.md](ACTIONS.md#tape-deck). |

## Other things

| What happens | What to do |
|---|---|
| A key changed the picture on Program in Studio Mode | A scene's content is shared: when Preview and Program show the same scene, layer edits change both. The control is framed red and labels that scene PROGRAM. |
| A numbered scene key does nothing | OBS has fewer scenes than the number. Add a scene, or pin the key to a named scene in its settings page. |
| *Fadester for OBS* is listed twice in Stream Deck's actions | A copy from before 0.10 is still installed beside the current one: up to 0.9.x the plugin had another ID, and Stream Deck holds the two IDs as two plugins. In Stream Deck, open **Preferences > Plugins**, right-click the *Fadester for OBS* with the lower version number and choose **Uninstall**. Keys and dials placed from it then show a question mark: place them again from the current copy. |
| The T-bar dial makes OBS's window flash white | The dial cannot reach OBS's own slider (over the network, another transition than Fade, OBS minimised or elevated, or no Accessibility on macOS). The picture OBS sends out stays clean. See [ACTIONS.md](ACTIONS.md#volume--t-bar). |

VJster keys (**EXTENSION OFF**, **PORT IN USE** and so on): [vjster/INSTALL.md](vjster/INSTALL.md#when-something-is-off). OpenDeck: [OPENDECK.md](OPENDECK.md#when-something-is-off).
