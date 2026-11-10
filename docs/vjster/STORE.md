# Putting the VJster extension on the Chrome Web Store

This is for the person publishing. Players of VJster do not need it: once the extension is listed, [INSTALL.md](INSTALL.md) points to the store page.

## 1. Build the store zip

```bash
npx rollup -c vjster-extension/rollup.config.mjs
node --import tsx scripts/vjster/pack-extension.ts --store
```

This writes `release/vjster-chrome-extension-<version>-store.zip`. It is the same extension as the zip to load unpacked, with one difference: **YouTube only**. The optional "every site" permission and `scripting`, which only it uses, are left out, so the review is shorter. The options page hides the "every site" box when the permission is not in the manifest.

The zip has no `key`: the store refuses one on a first upload and gives the extension its own id.

## 2. Upload it

1. Open the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole) and choose **Add new item**.
2. Upload the store zip.
3. Fill in the listing from section 3 below.
4. Under **Distribution**, choose **Unlisted** (anyone with the link can install it; it is not searchable). Public can come later.
5. Submit for review.

## 3. What to paste

**Name:** VJster

**Short description** (the manifest's, in all 12 languages): the dashboard reads it from the zip.

**Detailed description:**

> VJster lets your own controls change the speed and picture quality of a YouTube video in Chrome: slow it for a beat-match, speed it up, nudge it in small steps, set the quality, play or pause. Use the dials and keys of a Stream Deck or OpenDeck, the knobs of a TourBox, or the sticks of an Xbox controller. A Stream Deck shows the video's title and speed.
>
> VJster needs one free program on this computer: Fadester for OBS (the Stream Deck and OpenDeck plugin, with VJster included) or Fadester Companion (for an Xbox controller or a TourBox). Both are at github.com/jbrick2070/streamdeck-fadester. On its own, this extension does nothing.
>
> It talks only to your own computer. No account, no tracking, nothing sent to any server.
>
> Made with the help of AI (Claude, by Anthropic); the code is open source (GPL-2.0-or-later).

**Category:** Productivity. **Language:** English (the listing; the extension itself has 12).

**Single purpose:** Let the user's Stream Deck, OpenDeck, TourBox or Xbox controller, through Fadester for OBS or Fadester Companion on the same computer, change the speed and quality of the YouTube video in a tab.

**Privacy policy URL:** https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/vjster/PRIVACY.md

**Permission justifications** (the dashboard asks for each):

| Permission | Why |
|---|---|
| `storage` | Keeps the port number, and the pinned tab until the browser closes. |
| `alarms` | Checks once a minute that the link to the companion is open, because Chrome stops an idle extension worker after 30 seconds. |
| Host `*://*.youtube.com/*` | The content scripts that read the player's state and change its speed and quality run on YouTube pages. |
| Host `ws://127.0.0.1/*` | The connection to the VJster companion on this computer. |
| Remote code | None. All code is in the package. |

**Data use form:** it collects no user data for transmission anywhere. Tick none of the collected data types; certify that data is not sold, not used for unrelated purposes and not used for creditworthiness.

**Screenshots** (1280x800): the options page; a YouTube tab with the deck simulator beside it. To be added before submission.

## 4. After it is listed

1. The dashboard shows the extension's **id**. Give it to the install steps in [INSTALL.md](INSTALL.md): paste it into the VJster settings on the deck so only this extension can connect (R-LNK-2).
2. Replace "loaded unpacked for now" in INSTALL.md with the store link, and keep the unpacked zip as the way to get the "every site" option.
3. Each new version: raise `version` in `vjster-extension/manifest.json`, build, pack with `--store`, upload.
