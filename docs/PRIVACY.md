# Privacy: Fadester Companion

Fadester Companion (the game controller and TourBox app for OBS Studio) runs on your own computer and works with OBS Studio there. It has no account, sends nothing to its maker or to anyone else, and contains no analytics, advertising or tracking.

## What it keeps on your computer

In `%LOCALAPPDATA%\FadesterTourBox` (or, when installed from the Microsoft Store, the app's own storage that Windows keeps for it):

- **`config.json`:** your settings. It holds the port of OBS's WebSocket server (the address is always this computer, `127.0.0.1`), the scene and source names you assign, your controller layout, and the VJster port. It does not hold your OBS password.
- **`panel.log`:** a short log of what the control panel did, for troubleshooting. It does not contain your password.
- **`mix-state`:** only if you turn on control of all OBS mixer inputs. For each scene collection it keeps the collection's name and the volume levels of its audio inputs, so **Restore whole mix** can bring them back.

If you use the screenshot action, pictures of OBS's Program output are saved in your Pictures folder, under `Fadester TourBox`, and nowhere else.

These files stay on your computer. Uninstalling the Store app removes its own storage. A `%LOCALAPPDATA%\FadesterTourBox` folder (made by the ZIP version, which the Store app then keeps using) stays until you delete it. Screenshots stay in Pictures until you delete them.

## The OBS password

To sign in to OBS, the companion reads the WebSocket password that OBS saved in its own settings on this computer (`%APPDATA%\obs-studio\plugin_config\obs-websocket\config.json`). It uses that password only to sign in to OBS and never writes it anywhere. If you type a password in the panel instead, it is kept only in memory until you close the window.

## What it sends, and where

- **To OBS Studio:** the companion connects to OBS's WebSocket server on the same computer only. It refuses any other address. It signs in with the password the way OBS requires, then sends OBS the commands you give with your game controller, TourBox or Stream Deck: scenes, transitions, the T-bar, volume, media and filters.
- **To the VJster extension:** if you turn on VJster, the companion accepts a connection from the VJster extension in Chrome on this computer only (`127.0.0.1`), to set the speed and quality of the video playing there.

It makes no connection to the internet. Microsoft may collect data about installs and crashes through Windows and the Microsoft Store under Microsoft's own privacy statement; the companion itself does not.

## Children

The app is a tool for live video production and does not knowingly collect information from anyone, children included.

## Changes and contact

If this policy changes, the new version will be published here, with the date below. Questions: open an issue at <https://github.com/jbrick2070/streamdeck-fadester/issues>.

Last updated: 2026-11-10
