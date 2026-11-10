# Privacy: Fadester Companion

Fadester Companion (the Fadester for TourBox companion and its game controller support) runs on your own computer and works with OBS Studio there. It has no account, sends nothing to its maker or to anyone else, and contains no analytics, advertising or tracking.

## What it keeps on your computer

In `%LOCALAPPDATA%\FadesterTourBox` (or, when installed from the Microsoft Store, the app's own storage that Windows keeps for it):

- **`config.json`:** your settings, including the address, port and password of OBS's WebSocket server, the scene and source names you assign, your controller layout, and the VJster port.
- **`panel.log`:** a short log of what the control panel did, for troubleshooting. It does not contain your password.

If you use the screenshot action, pictures of OBS's Program output are saved in your Pictures folder, under `Fadester TourBox`, and nowhere else.

These files stay on your computer. Uninstalling the app or deleting the folder removes the settings and the log; screenshots stay in Pictures until you delete them.

## What it sends, and where

- **To OBS Studio:** the companion connects to OBS's WebSocket server at the address you enter (on the same computer unless you choose another) and signs in with your password the way OBS requires. It then sends OBS the commands you give with your controller, TourBox or Stream Deck: scenes, transitions, the T-bar, volume, media and filters.
- **To the VJster extension:** if you turn on VJster, the companion accepts a connection from the VJster extension in Chrome on this computer only (`127.0.0.1`), to set the speed and quality of the video playing there.

It makes no connection to the internet. Microsoft may collect data about installs and crashes through Windows and the Microsoft Store under Microsoft's own privacy statement; the companion itself does not.

## Children

The app is a tool for live video production and does not knowingly collect information from anyone, children included.

## Changes and contact

If this policy changes, the new version will be published here, with the date below. Questions: open an issue at <https://github.com/jbrick2070/streamdeck-fadester/issues>.

Last updated: 2026-11-09
