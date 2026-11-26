# VJster privacy policy

VJster is a Chrome extension that lets the VJster controls on your Stream Deck, OpenDeck or TourBox change the speed and picture quality of a YouTube video.

**VJster collects nothing and sends nothing to anyone.** It has no server, no account, no analytics and no advertising.

## What it reads, and where it goes

- **On YouTube pages**, it reads the state of the video player: whether it is playing, its speed and quality level, the speeds and qualities it offers, whether an ad is playing, its title and the page's host name. It reads nothing else on the page.
- **On other sites, while "Control videos on every site" is on**: the copy you load unpacked asks Chrome for every site when you install it, and this option is on until you untick it on the options page (the Chrome Web Store copy is YouTube only and has no such option). With it on, on a page that plays a video, VJster reads whether it is playing, its speed, the page's title and its host name. When you turn the option off, VJster stops using it at once: a page already open may keep VJster's script until it is reloaded, but VJster ignores what that script reports.
- **It sends that state only to your own computer**, to the VJster companion listening on `127.0.0.1` (this computer, port 48150 unless you change it): Fadester for OBS, the VJster plugin, or Fadester Companion. The plugins draw the title and speed on your deck's keys and dials; Fadester Companion shows them in its own window. Nothing leaves your computer.
- **It sends your deck's commands to the player**: change the speed, change the quality, play or pause.
- **Keyboard hotkeys, only if you turn them on.** They are off until you tick **Keyboard hotkeys** on the options page. While they are on, VJster sees each key you press on a page, and acts only on `[`, `]` and `\` (with no Ctrl, Alt or Command), only when you are not typing in a text box, and only on a page that has a video. Every other key is left to the page and is not looked at again. A key that VJster acts on becomes a speed change on that page's video and goes nowhere else: no key is saved, logged or sent anywhere, and the hotkeys need no other program.

## What it stores

On your computer only, in Chrome's extension storage: the port number (saved), whether you ticked "Keyboard hotkeys" (saved; off until you do), whether you unticked "Control videos on every site" (saved; only the copy you load unpacked has this option), and which tab you pinned as the target (kept only until the browser closes). Removing the extension removes them.

## What it does not do

It does not read your browsing history, your accounts, your passwords or other tabs' contents, and with "Control videos on every site" unticked, or in the Chrome Web Store copy, it reads no site other than YouTube. It does not load code from the internet. It does not share anything with third parties.

## Contact and changes

Questions: open an issue at https://github.com/jbrick2070/streamdeck-fadester/issues. A change to this policy appears in this file's history, and the extension's version notes name it.
