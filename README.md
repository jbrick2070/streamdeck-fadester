# Fadester for OBS

**Fadester for OBS 0.7.6** makes a Stream Deck or Stream Deck + a simple, direct control surface for normal OBS Studio. It connects to OBS’s built-in WebSocket server on port `4455`; you do **not** need an APC40, a MIDI controller, or Midi Fadester to use the main actions.

The default look uses deep black backgrounds, punchy purple controls, and bright yellow accents. Distinct action symbols make scene navigation, source controls, and audio fades easier to tell apart; the scene mixer keeps red Live and green Next labels.

The starter Scene Desks load your current OBS scene list dynamically. Previous, Next, and Random work without assigning scene names; numbered shortcuts follow positions in the OBS Scenes list. Opening a Studio layout offers to enable Studio Mode and prepare a different Preview scene.

The first setup is intentionally small:

1. In OBS, open **Tools → WebSocket Server Settings**, enable the server, and leave password authentication on.
2. In Stream Deck, add a direct action and enter that password locally in its Property Inspector. The plugin never sends a saved password back to the inspector.
3. The presets follow your current OBS scenes, sources, and audio automatically. Newly added scene keys start with Next Scene; audio keys and dials start with Main Audio. Choose a fixed target in the inspector when you want a saved manual assignment. Controls act when you press or turn them.

## Direct OBS actions

| Action | What it does | Needs |
|---|---|---|
| **Source & Layer** | Browse existing scene sources using a dial or Previous/Next keys. Show/hide the deck-selected source. Optional creative controls cycle blend modes or reorder layers. | Any Stream Deck; works in Studio and regular mode. Reordering needs an explicit setting. |
| **OBS Fader** | Adjust an audio source, or **Blend Live into Next scene**. The scene mixer keeps the original colorful track and orange handle, with LIVE/NEXT scene names. Press to take Next live. | Stream Deck + for a dial; scene blending needs two different scenes in OBS Studio Mode. |
| **Scene & Transition** | Select a fixed scene, **Next scene**, **Previous scene**, or **Current Preview**; Cut or use a chosen transition. | Cut/Transition work in both modes. Preview selection and Current Preview need Studio Mode. |
| **OBS Fade** | Fade one OBS mixer input up or down over a chosen time, or instantly. A later volume move cancels that input’s running fade. | Any Stream Deck key. |

Source selection is shared across Fadester controls for each scene and lasts until the plugin restarts or the scene collection changes. To save an assignment across restarts, choose a non-browsing Source & Layer action and select **A fixed source** for that action. A fixed action keeps its own assignment; it does not pin the shared selection used by a fader's press. Browsing selects a control target; Show/hide changes its visibility and keeps your stack order. A visible source may still be covered by an opaque layer above it. The list handles top-level sources and treats groups as one layer.

Everyday Source Desk layouts keep layer order fixed. The separate Creative Layer Lab explicitly enables order changes and discrete Normal/Additive/Subtract/Screen/Multiply/Lighten/Darken blend modes. These compositing modes are separate from transitions or a continuous A/B crossfade; generic layer opacity and A/B crossfading remain outside native OBS WebSocket capabilities.

By default, layer controls follow Preview in Studio Mode and Program in regular mode. A scene's content is shared: when Preview and Program use the same scene, layer edits also affect the live output. The dial and inspector label that scene LIVE.

Use **Cut** for an immediate switch or **Transition** for a scene transition in either mode. Choose **Use OBS current transition**, **Cut**, **Fade**, **Fade to Black**, or any transition installed in OBS. A chosen per-key transition applies to that press and preserves the scene's saved transition settings afterward. Audio fades run independently of scene-transition duration.

On the manual scene mixer, **Scene loop → Queue the next scene after each transition** is optional. Turn the dial toward NEXT; reaching the end completes the transition. Only after OBS confirms completion does the following scene become NEXT, wrapping from the last scene to the first. You control each fade; the option does not start unattended transitions. It needs Studio Mode and at least two scenes.

**Dial press** is configurable: take Next live, cycle the selected source's blend mode, restore Normal blend, show/hide that source, or do nothing. **Next blend mode, then take Next live** is a two-step press: change the chosen source in Preview, then finish the scene transition. Choose the source in the inspector or through a Source & Layer control. Scene-loop queuing can follow this combined press too.

## Starting deck layouts

Eleven importable full, compact, buttons-only, scene, and creative profiles are in [DECK-LAYOUTS.md](DECK-LAYOUTS.md). Every layout name says **Studio Mode**, **Regular Mode**, or **Either Mode**. In a direct action's inspector, expand **Ready-made layouts** and open a compatible current starter layout. Studio layouts offer an explicit setup step to enable Studio Mode and prepare Preview. Scene buttons follow the current OBS list; audio controls automatically select matching Main audio and Microphone inputs. Aux chooses another mixer input, keeping it distinct from Main and Microphone. A missing role or numbered scene stays unavailable until that target exists. You can override any binding in the inspector. The current starter revision opens as an editable profile and preserves older customized profiles. You can also import the `.streamDeckProfile` files yourself. Half-deck layouts leave room for the specialist OBS plugins you already use.

## Optional Midi Fadester integration

The two actions explicitly labelled **Midi Fadester … (optional)** keep the older enhanced shared-slot workflow for people who use Midi Fadester with an APC40 or another MIDI controller. They provide fixed slots, shared controller profiles, advanced filter bindings, and Midi Fadester’s A/B mixing behavior.

That integration is separate from the normal direct OBS controls:

- Direct actions never require a MIDI controller or probe for Midi Fadester.
- Existing saved Midi Fadester actions keep their original slots and behavior.
- The direct inspectors show the integration only as an optional note, so a new Stream Deck user is not sent into MIDI setup.

## Connection and safety

Set up the OBS connection once for all Fadester keys, dials, and layouts. After setup the inspector says **Password saved for all Fadester buttons and dials**; host, port, and password stay under **Edit shared connection**. **Save for all controls & test** updates that shared connection. A saved password is never echoed back to the browser Property Inspector. Other plugins manage their own connection settings separately.

When OBS is unavailable, an action alerts and performs at most one reconnect nudge every two seconds. Wrong-password status tells you exactly where to correct it in OBS without exposing the password.

## Development

```powershell
npm test
npm run build
npm run validate
npm run pack
```

`npm run pi:harness [-- --page auto-fade-key]` serves the legacy optional Midi Fadester inspectors against the fake OBS server for development. Direct OBS controls are covered by the raw WebSocket client and action tests.

## Documentation

- [DECK-LAYOUTS.md](DECK-LAYOUTS.md) — recommended full, compact, and all-button layouts.
- [API-CONTRACT.md](API-CONTRACT.md) — optional `midi-fadester` vendor API contract.
- [FEATURE-AUDIT.md](FEATURE-AUDIT.md) — feature tradeoffs and constraints.
- [PUBLISHING.md](PUBLISHING.md) — packaging and Marketplace checklist.
- [LICENSE](LICENSE) — GNU General Public License v2.0.

> **Disclaimer:** Fadester for OBS is an independent third-party plugin and is not made, endorsed, or supported by the OBS Project or Elgato.
