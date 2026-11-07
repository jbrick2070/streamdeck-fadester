# VJster: install

VJster has three parts. The Stream Deck plugin holds the keys and dials and serves the OBS page. The Chrome extension controls the video in a Chrome tab. The OBS page is a browser source for OBS. They talk over one local socket on this computer (port 48150 by default); nothing goes to the internet except what YouTube's own player loads. What VJster is and what each control does: [README.md](README.md).

## What a release holds

| File | What it is |
|---|---|
| `com.jbrick2070.vjster.streamDeckPlugin` | The Stream Deck plugin, with the OBS page and four bundled profiles inside |
| `vjster-chrome-extension-<version>.zip` | The Chrome extension, to unzip and load unpacked |

There is no Elgato Marketplace listing and no Chrome Web Store listing yet, so the extension is loaded unpacked for now. The TourBox package (`tourbox/`, OBS Fadester for TourBox) hosts the same link, so the extension also works from a TourBox without any deck software; see `tourbox/README.md`.

## Install

**1. The Stream Deck plugin.** Needs Stream Deck 7.1 or later on Windows 10 or later. Double-click `com.jbrick2070.vjster.streamDeckPlugin`; Stream Deck asks to install it. The VJster category then lists seven actions. Stream Deck may also ask whether to install the bundled profiles; say yes and they appear in your profile list without switching to them: **VJster Live +** and **VJster Dual +** for the Stream Deck +, **VJster Live** for the 15-key Stream Deck, **VJster Mini** for the Mini. A profile may only appear once a deck of its kind is connected.

**2. The Chrome extension.** Needs Chrome 116 or later. Unzip `vjster-chrome-extension-<version>.zip` into a folder that stays put. In Chrome open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and pick that folder. The extension asks for access to YouTube and to a socket on this computer (`ws://127.0.0.1`), and for the storage, alarms and scripting permissions; Chrome may also warn about extensions in developer mode. Its options page has an all-sites option, which Chrome asks you about before adding every site. The Chrome Web Store version has the id `daohboebokfmamkblejcpbblfnaijgnb`; an unpacked copy has its own id. Either way, the extension's options page shows the id it has: to let only that extension connect, paste it into the plugin's **Only this extension** field.

**3. First check.** Switch to a VJster profile (or put a VJster action on the deck) and play a YouTube video in Chrome. Within a few seconds the SPEED strip (Stream Deck +) or the 1x key (other decks) shows the video playing. Turn the dial: the video follows.

**4. The OBS page (optional).** This plays a YouTube video inside OBS at the speed the deck sets.

1. Open any VJster action's settings in Stream Deck and find **OBS page**. Paste a YouTube link and press **Copy address**.
2. In OBS add a **Browser** source, untick **Local file**, and paste the address as its URL.
3. Set an action's **Target** to **OBS page**, or **Both** to drive Chrome and OBS together (the deck then shows Chrome's state). The **VJster Dual +** profile has keys for each side by side.

Good to know about the OBS page:

- The address carries this computer's OBS page key: keep it out of screenshots and chat.
- The page comes from the plugin, so Stream Deck must be running when OBS loads the source. **Keep the link on** (ticked by itself the first time an OBS page connects) keeps it available. If OBS shows an error page, start Stream Deck and refresh the source.
- In OBS the player goes from 0.25x to 2x, and its quality cannot be set.
- The address holds the port: after a port change, copy the new address into OBS.

## When something is off

| The strip or key says | What to do |
|---|---|
| **EXTENSION OFF** | Check that Chrome is open with the extension loaded; that the extension's options page and the plugin's settings page name the same port; and that the plugin's **Only this extension** field is empty or holds the id the extension's options page shows. |
| **PORT IN USE** | Port 48150 is taken by another program. Choose another port on the plugin's settings page and the same port in the extension's options. |
| **NO PAGE** | The target is the OBS page but none is connected. Check that the browser source's URL is the address you copied and that Stream Deck is running; refresh the source. |
| **N/A** on the quality dial | That video or target offers no quality control (the OBS page never does). |
| **AD PLAYING** | An ad is playing; your turns are held and applied when the video resumes. |
| **NO VIDEO** | Play a video in Chrome (YouTube, or a site you allowed on the options page), or pin the tab with **Pin Tab**. |

## Languages

VJster's plugin, its keys and dials and its settings page come in nine languages: English, German, Spanish, French, Japanese, Korean, Simplified Chinese, Traditional Chinese and Dutch. Choose under **Language** on the settings page; **Automatic** follows Stream Deck's language. The choice applies to all VJster controls and survives restarts. Stream Deck's own menus, action list, tooltips and dial hints stay in Stream Deck's language.

The Chrome extension follows Chrome's language. The OBS page's address carries Stream Deck's language (`&hl=de`, for example); without it the page uses OBS's language. The page shows text only when its address is incomplete or YouTube's player does not load. With no translation for a word, the English text is shown.

| Part | Languages | Files |
|---|---|---|
| Stream Deck plugin and its settings page | English, German, Spanish, French, Japanese, Korean, Chinese (Simplified), Chinese (Traditional), Dutch | `com.jbrick2070.vjster.sdPlugin/<lang>.json` |
| Chrome extension (description, options page) | English, German, Spanish, French, Japanese, Korean, Dutch, Portuguese (Brazil), Russian, Turkish, Chinese (Simplified), Chinese (Traditional) | `vjster-extension/_locales/<lang>/messages.json` |
| OBS page (its setup notes) | English, German, Spanish, French, Japanese, Korean, Portuguese (Brazil), Russian, Turkish, Chinese (Simplified), Chinese (Traditional) | `vjster-page/src/page-text.ts` |

The English texts were written with Claude Opus 5.5, an AI model. Every other language was drafted by Claude and reviewed by a second AI model, Gemini 4 Argon, whose corrections were taken; no native speaker has checked them yet. Chrome's `messages.json` format has no room for a comment, so this note stands for those files. Corrections are welcome as a GitHub issue or pull request on `jbrick2070/streamdeck-fadester`: name the file, the text and your suggested wording. Words drawn on keys must stay short (a test checks they fit).

## Uninstall

Uninstall the plugin from the Plugins page of Stream Deck's preferences, and delete the VJster profiles you do not want. Remove the extension on `chrome://extensions` and delete the folder it was unzipped into. Delete the OBS browser source. What is left is the release files you downloaded.

## For developers: building a release

From the repository root, in a clean `git worktree` of the commit to release, with Node 24 and the repository's packages (`npm ci`):

```
npx tsc --noEmit
npx tsc --noEmit -p vjster-extension
npx tsc --noEmit -p vjster-page
npm test
npx rollup -c vjster-extension/rollup.config.mjs
npm run build:vjster
node --import tsx scripts/vjster/build-profiles.ts
npx streamdeck validate com.jbrick2070.vjster.sdPlugin
npx streamdeck pack com.jbrick2070.vjster.sdPlugin --output release --force
node --import tsx scripts/vjster/pack-extension.ts
```

The two release files land in `release/`, which git ignores. The mutation runner (`node --import tsx scripts/vjster/run-mutation-checks.ts`) runs in that worktree before a release, and `TESTING.md` section 4 checks the packed files. The plugin's version is in `com.jbrick2070.vjster.sdPlugin/manifest.json` (four parts), the extension's in `vjster-extension/manifest.json`. The engineering record is `PLAN.md`, `REQUIREMENTS.md` and `TESTING.md` in this folder.
