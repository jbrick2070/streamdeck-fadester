# Suite Demo Kit 1.0

One scene collection, a few small media files and a Stream Deck profile that show what Playlister,
Visual Sidechain, Fadester for OBS and VJster do together. Import it, switch to it, press the keys.
The keys are already bound to the kit's sources and filters, so nothing needs picking first.

**For now the kit is for its author and the demo reel.** Fadester for OBS and VJster have no public
release yet, so others cannot install everything it needs. This note goes when they do.

Windows only (10 or later), OBS Studio 33, and a 1920x1080 canvas.

## What is in the zip

| File | What it is |
|---|---|
| `Suite Demo Kit.json` | the scene collection, to import into OBS |
| `media/` | three 8 s motion loops, a 16 s beat, the title image and three 8 s stock clips, about 15 MB |
| `vjster-setup.html` | the setup card the Speed Page shows until you give it your VJster address |
| `Suite Demo Kit +.streamDeckProfile` | the Stream Deck + profile for the kit's Fadester keys |
| `Suite Demo Kit Speed +.streamDeckProfile` | the Stream Deck + profile for the Speed Page's VJster keys |
| `README.md`, `CREDITS.md` | this file; who made every clip, under which licence, and what was changed |

## The five scenes

| # | Scene | What it shows |
|---|---|---|
| 1 | Kit Welcome | the title, how the deck works and the clip credits |
| 2 | Kit Visuals | a motion loop with three Visual Sidechain looks and an Audio Modulator, all following the beat |
| 3 | Kit Layers | two layers to fade, toggle and mix |
| 4 | Kit Playlister | the same Playlister clips at 100 % (left) and at 50 % (right) |
| 5 | Kit Speed Page | a YouTube video in a browser source whose speed the deck sets live with VJster |

Each page of the deck drives one scene: its first key cuts to that scene.

**About speed.** Playlister speed is a setting (Properties > Speed); changing it restarts the clip,
which is why scene 4 shows two Playlisters side by side instead of a speed dial. Live speed is
VJster's: in OBS it plays the video at 0.25x to 2x, set from the deck while it plays.

## Install and import

1. Install the plugins:
   - Playlister 0.5.0 or later, and Visual Sidechain 0.6.0 or later (Panic and Restore need 0.6.0),
     both for OBS 33.
   - Fadester for OBS 0.7.7 or later, in Stream Deck 7.1 or later.
   - VJster 0.1.0 or later, for the Speed Page.
2. Unzip the kit to a short folder of its own, such as `C:\SuiteDemoKit`. Not directly in a drive
   root (`D:\`), not inside the zip, and not in a folder whose path is long: OBS only turns the
   kit's `./media/...` paths into real ones when the result fits in 260 characters. Do not copy the
   JSON into OBS's scenes folder by hand either: only Import fixes the paths.
3. In OBS, set Settings > Video > Base (Canvas) Resolution to 1920x1080. Then choose
   Scene Collection > Import, pick `Suite Demo Kit.json`, press Import, and choose
   Scene Collection > Suite Demo Kit.
4. Tools > WebSocket Server Settings: tick Enable WebSocket server. Put the address and password into
   one Fadester key's settings in Stream Deck; the other keys use the same connection.
5. Double-click `Suite Demo Kit +.streamDeckProfile`, then switch to it in Stream Deck. Do the same
   for `Suite Demo Kit Speed +.streamDeckProfile` if you use the Speed Page.
6. Speed Page: open scene 5 and follow its card. In short: in a VJster action's settings, under OBS
   page, tick Keep the link on, paste a YouTube link and press Copy address; in OBS open the Speed
   Page source's Properties, untick Local file and paste the address as the URL. From then on the
   collection holds this computer's OBS page key, so do not share or export it, and keep the Speed
   Page's Properties out of screenshots.
7. Press the keys.

> **Do not rename these.** The keys and the looks find them by name:
> `Kit Beat`, `Look Prism`, `Look Kaleido`, `Look Pulse`, `Layer Fade`, and the `Color Correction`
> filter on `Kit Motion` (the Audio Modulator drives it by name).
> Keep the scene names too: the layer keys find their scene by name. Renaming `Kit Clips`,
> `Kit Motion`, `Layer A` or `Layer B` is fine: the keys find those by their fixed ids.

## The beat

`Kit Beat` is a beat made for the kit. It plays to your monitor and to the stream at -12 dB, and
every look follows it. Mute it in the Audio Mixer and the looks still follow it (React When Source Is
Muted), so you can demo in silence.

To make the looks follow your own music instead: on `Kit Motion`, open Filters, and in each of
Look Prism, Look Kaleido, Look Pulse and Audio Modulator set Audio Input to Track 1 (Main Mix).

## When something is off

| What you see | Why, and what to do |
|---|---|
| OBS lists missing files after the import | The kit was imported from a drive root, from inside the zip, from a long path, or copied by hand. Unzip to a short folder (step 2) and import again; or use Search Directory... in that list and pick the kit's `media` folder. |
| The collection is called "Suite Demo Kit 2" | An earlier import is still there. Either works; the keys find the sources by id. |
| Keys show "Playlister missing" or "Filter not found" | Another scene collection is active: switch to Suite Demo Kit. If you renamed a filter, rename it back. |
| The looks do not move | `Kit Beat` was renamed, or its file is missing. Rename it back, or check its Properties. |
| The Speed Page shows an error page | Stream Deck was not running when OBS loaded the page. Start Stream Deck, then select the Speed Page source and press Refresh in the bar under the preview. |
| Items sit in odd places | The canvas is not 1920x1080 (step 3). |

## Credits and licences

Every clip, who made it, its licence and what was changed are in `CREDITS.md`; the same credits are
on screen in scenes 1, 4 and 5. The scene collection, the profiles and the setup card are
GPL-2.0-or-later; the media made for the kit are CC BY 4.0; the stock clips keep their own
Creative Commons licences.

## Building the kit (for the repository)

The kit is built in `demo-kit/` of the streamdeck-fadester repository; nothing here touches an
installed OBS.

```
python demo-kit/build-kit.py media          # the media, into demo-kit/build/media
python demo-kit/build-kit.py roundtrip --obs <fresh folder>   # the collection, through a portable OBS 33
python demo-kit/build-kit.py check-collection
python demo-kit/build-kit.py credits        # CREDITS.md from the stock list
node --import tsx scripts/build-kit-profiles.ts   # the two profiles, into demo-kit/build/profiles
python demo-kit/build-kit.py zip --out <folder>     # Suite-Demo-Kit-1.0.zip from all of the above
python demo-kit/check-kit.py run --zip <zip> --dir <new folder>   # the install-check (TESTING.md)
```

`kit-ids.json` holds every name and fixed id the profiles bind to; `kit-template.json` is the
collection that ships as `Suite Demo Kit.json`; `kit-layouts.json` holds the two profiles' keys.
