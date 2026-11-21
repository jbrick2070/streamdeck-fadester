# Fadester Companion: Microsoft Store listing (English)

Paste each block into the matching field in Partner Center (Submission → Store listings → English). Images are in `listing/`. The same listing in twelve more languages is in [LISTING-translations.md](LISTING-translations.md).

## Description

Fadester Companion turns the controllers you already own into a hands-on vision mixer for OBS Studio.

Pull the right trigger of an Xbox or other XInput game controller like a real T-bar, and OBS's own T-bar follows. Hold A to push the mix and let go to leave it part-way. D-pad up and down walk your scene list, the left trigger ducks your music while you hold it, and the sticks ride a layer's opacity and blend mode and the speed of the video playing in Chrome through the free VJster extension. Every button can be remapped, with a second layer while LB is held, and Easy mode makes on-air switches need a short hold, so a bumped control does nothing.

Got a TourBox? The same companion runs it too: the Dial is your T-bar, Scroll puts scenes in Preview and the Knob sets the video speed.

It keeps working while OBS is in front, talks only to OBS and the VJster extension on your own computer, and sends nothing to the internet.

Needs OBS Studio with its WebSocket server turned on (Tools → WebSocket Server Settings). The T-bar needs OBS Studio 33 in Studio Mode. Free and open source (GPL-2.0-or-later).

## Short description

Your game controller, now a vision mixer for OBS Studio: a real T-bar on the right trigger, scenes on the D-pad, music on the left trigger.

## What's new in this version

Version 1.5.0:

- The controls start by themselves the first time you open the app. One button starts and stops them: Start or Stop.
- A shorter Setup page: each numbered step is one short line and its button. The OBS port and password and the optional parts sit behind Details and Show, and open by themselves when a light needs you.
- Status lights that say how things really are, each with the button that fixes it: Open OBS, Turn on for Studio Mode, and a TourBox light that is green only when TourBox Console has the preset. The OBS port fills itself in from OBS, as the password does.
- Open when I sign in: a tick box under the buttons, off until you tick it.
- Closing the window keeps the controls on: an icon in the notification area opens the window again, starts or stops the controls, and quits.
- A dark window when Windows is in dark mode.
- 13 languages: Dutch, Brazilian Portuguese and Turkish are new. The version is in the title of every window.
- Fixed: the game controller's fade still goes out when OBS's T-bar cannot be read, a cut no longer holds up the next press, and a password that OBS refused is tried again by itself.

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

OBS Studio with its WebSocket server on (the T-bar needs OBS Studio 33 in Studio Mode). An Xbox or XInput game controller, a TourBox, or both.

## Copyright and trademark info

© 2026 Fluxxuuss. OBS Studio is a project of the OBS Project. Xbox is a trademark of the Microsoft group of companies. TourBox is a trademark of TourBox Tech Inc. Fadester Companion is not affiliated with or endorsed by them.

## Support

- Website: https://github.com/jbrick2070/streamdeck-fadester
- Support: https://github.com/jbrick2070/streamdeck-fadester/issues
- Privacy policy: https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/PRIVACY.md

## Notes for certification (Submission options)

Fadester Companion controls OBS Studio, which must run on the same PC. To test:

1. Install OBS Studio 33 (free, https://obsproject.com). In OBS open Tools → WebSocket Server Settings, tick Enable WebSocket server, keep authentication on and note the password. Turn on Studio Mode and add two scenes. (OBS's own Fade must still be in its Scene Transitions list, as it is in a new OBS; it does not have to be the selected one.)
2. Open Fadester Companion. It connects by itself: the header says it is connected and how many scenes it found. If it does not connect, type the WebSocket password in OBS password (filled in from OBS), under Details in step 1 of the Setup tab (it opens by itself when OBS refuses the password), and click Read scenes and inputs from OBS.
3. On the Setup tab, tick Use an Xbox or XInput game controller, then click Stop and Start at the bottom left of the window (the controls start by themselves the first time, without the controller). With an Xbox controller connected, press D-pad down to put a scene in Preview and pull the right trigger: OBS's T-bar follows; pulled all the way, the scene goes to Program. Holding A also pushes the T-bar.

Without OBS running, the app opens and says that OBS is not running or not answering (its OBS light has an Open OBS button); the controls do nothing. No account or sign-in is needed, and the app makes no internet connection.

## Restricted capability: runFullTrust (justification, 500 characters at most)

Fadester Companion is a Win32 desktop app (.NET WinForms panel, .NET 8 background process, small C++ helper) packaged as MSIX. Full trust lets it read an Xbox/XInput controller while OBS Studio is in front, register global hotkeys for a TourBox, drive OBS Studio's T-bar through a helper that moves OBS's own slider, and connect to OBS's WebSocket server on the same PC. No internet connection, no data collected. Source: https://github.com/jbrick2070/streamdeck-fadester
