# VJster: install

VJster lets your Stream Deck, TourBox or game controller change the speed and quality of a YouTube video in Chrome. What each control does: [README.md](README.md).

## Install

<img src="install-steps.svg" alt="VJster in three steps: 1, get the keys (Fadester for OBS in Stream Deck, or Fadester Companion); 2, add the VJster extension from the Chrome Web Store; 3, play a YouTube video and turn the dial: the speed follows." width="900">

1. **Get the keys.** Install [Fadester for OBS](https://github.com/jbrick2070/streamdeck-fadester/releases/latest) in Stream Deck: its action list already has the seven **VJster** actions. (Using a TourBox or a game controller instead? Install [Fadester Companion](https://apps.microsoft.com/detail/9PN7D3P2X7F4) and start its controls.)
2. **Add the Chrome extension.** Add [VJster from the Chrome Web Store](https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb) (Chrome 116 or later).
3. **Try it.** Put **VJster Speed** on a key or dial and play a YouTube video in Chrome. Within a few seconds the key shows the video playing; turn the dial and the video follows. A tab that was already open: reload it once.

That's it. OBS does not need to be open.

## Good to know

- **Install the extension only once.** Fadester for OBS and Fadester Companion already contain VJster's link. Do not also install the separate VJster plugin: both would want the same port (48150).
- **Everything stays on your computer.** The extension talks only to your own computer; nothing goes to the internet except what YouTube's player loads.
- **Lock it to this extension (optional):** the extension's options page shows its id (`daohboebokfmamkblejcpbblfnaijgnb`); paste it into **Only this extension** on VJster's settings page.

## Optional: play the video inside OBS

1. Open any VJster action's settings in Stream Deck, find **OBS page**, paste a YouTube link and press **Copy address**.
2. In OBS add a **Browser** source, untick **Local file** and paste the address as its URL.
3. Set an action's **Control** to **OBS page**, or **Both** for Chrome and OBS together.

Keep the address private (it holds this computer's page key). Stream Deck must be running when OBS loads the source; if OBS shows an error page, start Stream Deck and refresh the source. In OBS the speed goes from 0.25x to 2x, and the quality cannot be set. After a port change, copy the new address into OBS.

## When something is off

| The key says | What to do |
|---|---|
| **EXTENSION OFF** | Open Chrome with the extension added. Check that the extension's options page and VJster's settings page show the same port, and that **Only this extension** is empty or holds the extension's id. |
| **PORT IN USE** | Another program holds port 48150. The settings page names it when it is a Fadester app (`VJster link is held by <product> <version>`). Keep only one VJster host on that port, or pick another port in both VJster's settings and the extension's options. |
| **NO PAGE** | The target is the OBS page but none is connected: check the browser source's address, start Stream Deck, refresh the source. |
| **N/A** on the quality dial | That video offers no quality control (the OBS page never does). |
| **AD PLAYING** | Your turns wait and apply when the video resumes. |
| **NO VIDEO** | Play a video in Chrome, or pin its tab with **Pin Tab**. |

## No Fadester for OBS? The separate VJster plugin

For a deck without Fadester for OBS, the release also has `com.jbrick2070.vjster.streamDeckPlugin` (Stream Deck 7.1 or later; Windows 10 or later, macOS 13.5 or later). Double-click it and Stream Deck installs it with seven VJster actions and four profiles: **VJster Live +** and **VJster Dual +** (Stream Deck +), **VJster Live** (15 keys), **VJster Mini** (Mini). A profile may appear only once a deck of its kind is connected. It has no Elgato Marketplace listing.

With a TourBox and VJster's `/obs` page, Fadester Companion makes the page key itself, on Windows and on the Mac: in the VJster section of its **Setup** tab, choose the **Target** and click **Copy OBS Browser Source URL**, then paste that address into an OBS Browser Source (on Windows, a key made while the controls run works after **Stop** and **Start**). See `tourbox/README.md`.

## Languages

VJster comes in thirteen languages, the same as the rest of the Fadester suite: English, German, Spanish, French, Italian, Japanese, Korean, Dutch, Brazilian Portuguese, Russian, Turkish, Simplified Chinese and Traditional Chinese. Choose under **Language** on the settings page (**Automatic** follows Stream Deck, which offers only eight of them). The extension follows Chrome's language; the OBS page follows the language in its address, or OBS's.

| Part | Files |
|---|---|
| Stream Deck plugin and its settings page | `com.jbrick2070.vjster.sdPlugin/<lang>.json` |
| Chrome extension | `vjster-extension/_locales/<lang>/messages.json` |
| OBS page | `vjster-page/src/page-text.ts` |

The English texts were written with Claude Opus 5.5, an AI model, and every other language was drafted by Claude. A second AI model, Gemini 4 Argon, reviewed the earlier ones; the plugin's Italian, Brazilian Portuguese, Russian and Turkish, the extension's Italian and the OBS page's Italian and Dutch (drafted by Claude Fable 5.2) have had no second review yet. No native speaker has checked any of them. Corrections are welcome as an issue or pull request on `jbrick2070/streamdeck-fadester`: name the file, the text and your wording. Words on keys must stay short (a test checks they fit).

## Uninstall

Remove the extension on `chrome://extensions`. Remove the separate VJster plugin, if you installed it, from the Plugins page of Stream Deck's preferences, and delete the VJster profiles you do not want. Delete the OBS browser source.

## For developers

**The unpacked extension.** The release's `vjster-chrome-extension-<version>.zip` is the same extension plus one option: control videos on every site, not only YouTube (on from the start; untick **Control videos on every site** on its options page to keep it to YouTube). Remove the store version first. Unzip it into a folder that stays put, open `chrome://extensions`, turn on **Developer mode**, press **Load unpacked** and pick the folder. It also asks for the scripting permission, and it has its own id.

**Building a release.** From the repository root, in a clean `git worktree` of the commit, with Node 24 and `npm ci`:

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

The two release files land in `release/` (git ignores it). Run the mutation runner (`node --import tsx scripts/vjster/run-mutation-checks.ts`) in that worktree before a release; `TESTING.md` section 4 checks the packed files. Versions: `com.jbrick2070.vjster.sdPlugin/manifest.json` (four parts) and `vjster-extension/manifest.json`. Engineering record: `PLAN.md`, `REQUIREMENTS.md`, `TESTING.md` in this folder.
