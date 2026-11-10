# Fadester Companion: Microsoft Store listing (English)

Paste each block into the matching field in Partner Center (Submission → Store listings → English). Images are in `listing/`.

## Description

Fadester Companion turns the controllers you already own into a hands-on vision mixer for OBS Studio.

Pull the right trigger of an Xbox or other XInput game controller like a real T-bar, and OBS's own T-bar follows. Hold A to push the mix and let go to leave it part-way. D-pad up and down walk your scene list, the left trigger ducks your music while you hold it, and the sticks ride a layer's opacity and blend mode and the speed of the video playing in Chrome through the free VJster extension. Every button can be remapped, with a second layer while LB is held, and Easy mode makes on-air switches need a short hold, so a bumped control does nothing.

Got a TourBox? The same companion runs it too: the Dial is your T-bar, Scroll cues scenes and the Knob sets the video speed.

It keeps working while OBS is in front, talks only to OBS and the VJster extension on your own computer, and sends nothing to the internet.

Needs OBS Studio with its WebSocket server turned on (Tools → WebSocket Server Settings). The T-bar needs OBS Studio 33.0.0 or 33.0.1 in Studio Mode. Free and open source (GPL-2.0-or-later).

## Short description

Your game controller, now a vision mixer for OBS Studio: a real T-bar on the right trigger, scenes on the D-pad, music on the left trigger.

## What's new in this version

First release in the Microsoft Store.

## Product features

- The right trigger is a real T-bar for OBS Studio Mode
- Hold A to push the mix; let go to leave it part-way
- D-pad up and down walk your scene list
- The left trigger ducks your music while you hold it
- Remap every button, with a second layer while LB is held
- Easy mode: on-air switches need a short hold
- Video speed for VJster in Chrome from the right stick
- Runs a TourBox too: the Dial is your T-bar
- Works while OBS is in front; nothing leaves your PC

## Search terms

OBS · VJ · vision mixer · game controller · Xbox controller · TourBox · live streaming

## Additional system requirements

OBS Studio with its WebSocket server on (the T-bar needs OBS Studio 33.0.0 or 33.0.1 in Studio Mode). An Xbox or XInput game controller, a TourBox, or both.

## Copyright and trademark info

© 2026 Fluxxuuss. OBS Studio is a project of the OBS Project. Xbox is a trademark of the Microsoft group of companies. TourBox is a trademark of TourBox Tech Inc. Fadester Companion is not affiliated with or endorsed by them.

## Support

- Website: https://github.com/jbrick2070/streamdeck-fadester
- Support: https://github.com/jbrick2070/streamdeck-fadester/issues
- Privacy policy: https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/PRIVACY.md

## Notes for certification (Submission options)

Fadester Companion controls OBS Studio, which must run on the same PC. To test:

1. Install OBS Studio 33.0.1 (free, https://obsproject.com). In OBS open Tools → WebSocket Server Settings, tick Enable WebSocket server, keep authentication on and note the password. Turn on Studio Mode, select the Fade transition, and add two scenes.
2. Open Fadester Companion. Type the WebSocket password in Password override and click Read scenes and inputs from OBS: the header says it is connected and how many scenes it found.
3. On the Setup tab, tick Use an Xbox or XInput game controller, then click Save & start controls. With an Xbox controller connected, press D-pad down to cue a scene and pull the right trigger: OBS's T-bar follows; pulled all the way, the scene goes to Program. Holding A also pushes the T-bar.

Without OBS running, the app opens and says it is looking for OBS; the controls do nothing. No account or sign-in is needed, and the app makes no internet connection.

## Restricted capability: runFullTrust (justification, 500 characters at most)

Fadester Companion is a Win32 desktop app (.NET WinForms panel, .NET 8 background process, small C++ helper) packaged as MSIX. Full trust lets it read an Xbox/XInput controller while OBS Studio is in front, register global hotkeys for a TourBox, drive OBS Studio's T-bar through a helper that moves OBS's own slider, and connect to OBS's WebSocket server on the same PC. No internet connection, no data collected. Source: https://github.com/jbrick2070/streamdeck-fadester
