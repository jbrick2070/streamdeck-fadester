# VJster -- Install and release

VJster has three parts. The Stream Deck plugin holds the deck actions and
serves the OBS page. The Chrome extension controls the video in a Chrome tab.
The OBS page is a browser source for OBS. The parts talk over one loopback
socket on this computer, port 48150 by default; nothing goes to the internet
except what YouTube's own player loads (docs/vjster/REQUIREMENTS.md R-ID-5).
File names here mean the files in `docs/vjster`.

## What a release holds

| File | What it is |
|------|------------|
| `com.jbrick2070.vjster.streamDeckPlugin` | The Stream Deck plugin, with the OBS page and four bundled profiles inside |
| `vjster-chrome-extension-<version>.zip` | The Chrome extension, to unzip and load unpacked |

No Elgato Marketplace listing and no Chrome Web Store listing yet (D-3, D-8).
Tagging and publishing a release are the operator's call.

## Install

1. **Stream Deck plugin.** Needs Stream Deck 7.1 or later on Windows 10 or
   later. Double-click `com.jbrick2070.vjster.streamDeckPlugin`; Stream Deck
   asks to install it. The VJster category then lists seven actions. Stream
   Deck may also ask to install the bundled profiles, and does not switch to
   them: VJster Live + and VJster Dual + for the Stream Deck +, VJster Live
   for the 15-key Stream Deck, VJster Mini for the Mini. A profile may only
   appear once a deck of its kind is connected.
2. **Chrome extension.** Needs Chrome 116 or later. Unzip
   `vjster-chrome-extension-<version>.zip` into a folder that stays put. In
   Chrome open `chrome://extensions`, turn on Developer mode, choose Load
   unpacked and pick that folder. It asks for access to YouTube and to a
   socket on this computer (`ws://127.0.0.1`), and for the storage, alarms
   and scripting permissions; Chrome may also warn about extensions in
   developer mode. The all-sites option on its options page adds every site,
   after Chrome asks you.
3. **First check.** Put a VJster action on the deck and play a YouTube video
   in Chrome. Within a few seconds the SPEED strip (Stream Deck +) or the 1x
   key (other decks) shows the video playing. If it says `EXTENSION OFF`,
   check that Chrome is open with the extension loaded, that the extension's
   options and the plugin's settings page name the same port, and that the
   plugin's "Only this extension" field is empty or holds the id the
   extension's options page shows (TESTING.md 2.2 and 2.12).
4. **OBS page (optional).** Open any VJster action's settings in Stream Deck,
   find OBS page, paste a YouTube link and press Copy address. In OBS add a
   Browser source, untick Local file, paste the address as its URL. Set an
   action's Control to OBS page, or Both. The address carries this
   computer's OBS page key: keep it out of screenshots and chat. Things to
   know:
   - The page comes from the plugin, so Stream Deck must be running when OBS
     loads the source. Keep the link on (ticked by itself the first time an
     OBS page connects) keeps it available; if OBS shows an error page,
     refresh the source.
   - The address holds the port: after a port change, copy the new address
     into OBS.
   - In OBS the embedded player plays at most 2x, and its quality cannot be
     set (PLAN.md section 2, V-8 and V-10).

If port 48150 is taken, the strips say `PORT IN USE`: choose another port on
the plugin's settings page and the same port in the extension's options.

## Uninstall

Uninstall the plugin from the Plugins page of Stream Deck's preferences, and
delete the VJster profiles you do not want. Remove the extension on
`chrome://extensions` and delete the folder it was unzipped into. Delete the
OBS browser source. Nothing else of VJster stays on the computer, apart from
the release files you downloaded.

## Building a release

From the repository root, in a clean `git worktree` of the commit to release,
with Node 24 and the repository's packages (`npm ci`):

```
npx tsc --noEmit
npx tsc --noEmit -p vjster-extension
npx tsc --noEmit -p vjster-page
npm test
npx rollup -c vjster-extension/rollup.config.mjs
npx rollup -c vjster-page/rollup.config.mjs
npx rollup -c vjster-plugin/rollup.config.mjs
node --import tsx scripts/vjster/build-profiles.ts
npx streamdeck validate com.jbrick2070.vjster.sdPlugin
npx streamdeck pack com.jbrick2070.vjster.sdPlugin --output release --force
node --import tsx scripts/vjster/pack-extension.ts
```

The two release files land in `release/`, which git ignores. The mutation
runner (`node --import tsx scripts/vjster/run-mutation-checks.ts`) runs in
that worktree before a release (PLAN.md section 5), and TESTING.md section 4
checks the packed files. The plugin's version is in
`com.jbrick2070.vjster.sdPlugin/manifest.json` (four parts), the extension's in
`vjster-extension/manifest.json` (R-STD-5).
