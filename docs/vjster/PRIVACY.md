# VJster privacy policy

VJster is a Chrome extension that lets the VJster controls on your Stream Deck, OpenDeck or TourBox change the speed and picture quality of a YouTube video.

**VJster collects nothing and sends nothing to anyone.** It has no server, no account, no analytics and no advertising.

## What it reads, and where it goes

- **On YouTube pages**, it reads the state of the video player: whether it is playing, its speed and quality level, the speeds and qualities it offers, whether an ad is playing, its title and the page's host name. It reads nothing else on the page.
- **On other sites, only if you turn on "Control videos on every site"**: the copy you load unpacked has this option on its options page (the Chrome Web Store copy does not), and Chrome asks you before it takes effect. With it on, on a page that plays a video, VJster reads whether it is playing, its speed, the page's title and its host name. When you turn the option off, VJster stops using it at once: a page already open may keep VJster's script until it is reloaded, but VJster ignores what that script reports.
- **It sends that state only to your own computer**, to the VJster companion listening on `127.0.0.1` (this computer, port 48150 unless you change it): the VJster plugin, or Fadester for TourBox. The plugin draws the title and speed on your deck's keys and dials; Fadester for TourBox shows them in its own window. Nothing leaves your computer.
- **It sends your deck's commands to the player**: change the speed, change the quality, play or pause.

## What it stores

On your computer only, in Chrome's extension storage: the port number (saved), whether you turned on "Control videos on every site" (saved; only the copy you load unpacked has this option), and which tab you pinned as the target (kept only until the browser closes). Removing the extension removes them.

## What it does not do

It does not read your browsing history, your accounts, your passwords or other tabs' contents, and it reads no site other than YouTube unless you turn on "Control videos on every site". It does not load code from the internet. It does not share anything with third parties.

## Contact and changes

Questions: open an issue at https://github.com/jbrick2070/streamdeck-fadester/issues. A change to this policy appears in this file's history, and the extension's version notes name it.
