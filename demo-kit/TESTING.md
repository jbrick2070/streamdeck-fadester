# Suite Demo Kit: testing

Two halves. The scripted install-check (`check-kit.py`) proves the zip on a fresh portable OBS 33
over obs-websocket, with no hardware. The operator's half below is what a script cannot do: the
real Import through OBS's menu, the real Stream Deck +, and listening.

## 1. Scripted install-check

```
python demo-kit/build-kit.py media
node --import tsx scripts/build-kit-profiles.ts
npx rollup -c vjster-page/rollup.config.mjs          # the VJster OBS page, for the speed run
python demo-kit/build-kit.py zip --out <kit-build folder>
python demo-kit/check-kit.py run --zip <kit-build folder>\Suite-Demo-Kit-1.0.zip --dir <new check folder>
```

It refuses to start while any `obs64` runs, and takes the OBS lock (`C:\Users\jeffr\obs-run.lock`)
like every other OBS run on this machine. It never touches an installed OBS, the shared test
portable or the demo reel's OBS. It unzips into `<dir>\kit`, assembles a fresh portable in
`<dir>\obs` (bin, data and core copied read-only from `C:\Users\jeffr\OBS-Studio-33-Portable` and
hashed, with Playlister and Visual Sidechain from their build folders), imports the collection by
OBS's own Import rules, starts that OBS, runs the rows, puts back what it changed, closes OBS with
WM_CLOSE and checks the file OBS saved. Results go to `<dir>\results.jsonl`, screenshots to
`<dir>\shots\`. Nothing is played aloud: `Kit Beat` and the Speed Page are muted for the run
(and unmuted at the end only if they were not muted before). If the plugins row fails, the rows
after it are not run (each is recorded as failed, "not run"). After OBS closes, the SHA-256 of
every file in the portable's config goes into `<dir>\events.json`. The check folder is kept.

| Row | What passes |
|---|---|
| zip | the zip holds exactly the files the README's table names |
| import (scripted) | every `./` path became a path inside the unzip folder that exists |
| plugins | OBS 33 or later; Playlister and Visual Sidechain at least the versions in `kit-ids.json` ("plugins"); no kit plugin or source failed in the OBS log |
| scenes | the five scenes in the kit's order with the kit's UUIDs; every item id and source UUID |
| inputs | every input with the kit's name, kind and UUID; no other input |
| paths | every local path (media, the title, the card, each Playlister row) absolute, inside the unzip folder and present; no `./` left |
| filters | every filter in order with its kind; the looks and the Audio Modulator tap `Kit Beat` (tap_mode 7) with React When Source Is Muted on |
| monitoring | `Kit Beat` on Monitor and Output at -12 dB |
| quiet | `Kit Beat` muted for the rest of the run |
| beat-signals | Visual Sidechain's `get_signals` shows the beat while `Kit Beat` plays (muted) and nothing when it is paused |
| reacts: each look, the Audio Modulator | with `Kit Motion` paused and that filter alone, the picture moves with the beat and stands still without it (Look Kaleido: rotation held at 0, and "without" is its Reactivity at 0, since its beat phase keeps turning) |
| panic-restore | Visual Sidechain's Panic and Restore hotkeys are logged; Panic changes the filters; Restore puts every setting back |
| playlister-previous-next | Next, Next, Previous on `Kit Clips` by UUID move hurdles, sprint, train, sprint; the picture changes; Pause then Play give the paused and playing media states; `Kit Clips 50%` stays put |
| playlister-speed | over 4 s of wall time `Kit Clips` plays at about 1x and `Kit Clips 50%` at about 0.5x; both report the same duration |
| profile-bindings | every action in both profiles finds its scene position, input, filter (with kind and setting), layer, fader or Panic hotkey in the live OBS |
| rename: Kit Clips | renamed, its Playlister keys still resolve by UUID |
| rename: Look Prism | renamed, its keys find no filter (the key's "Filter not found"); renamed back, they resolve |
| shot: each scene, speed-page-card | each scene and the Speed Page's setup card render (not blank) |
| speed-run | the real VJster plugin under the deck simulator with the kit's Speed + layout drives the Speed Page in OBS (Big Buck Bunny from YouTube): dial +1 notch 1.25x, 0.5x, +0.25 to 0.75x, 2x, -0.25 to 1.75x, 1x, pause, play; the strip shows each rate the page reports back. Needs the network; `--no-speed-run` leaves it out |
| put-back | every change undone (the first scene, the mutes, the Speed Page's settings), each step on its own |
| saved | the collection OBS saved on exit, with the unzip folder as `./`, is the kit's template: no value changed, every UUID the kit's |

Last run: 2026-11-01, OBS 33.0.1 portable, Playlister 0.5.0, Visual Sidechain 0.6.0: all 28 rows
passed (see section 3).

## 2. The operator's checklist

Do these once per release, on this machine. Close every OBS first; another agent may hold the
OBS lock (`C:\Users\jeffr\obs-run.lock`): wait until it is gone. For 2.1, which starts OBS by
hand, then take the lock yourself so no agent starts an OBS meanwhile, from the repository
folder:

```
python -c "import sys; sys.path.insert(0, 'demo-kit'); import kit_obs; print(kit_obs.take_lock(kit_obs.DEFAULT_LOCK, 'operator 2.1'))"
```

It refuses while any `obs64` runs or the lock exists. Delete the lock file when 2.1 is done.

### 2.1 The real Import (plan 8.3 b)

1. Run the scripted check first (section 1) into a new folder, say `C:\kit-check`. Its portable,
   `C:\kit-check\obs`, then already has the collection; the real Import adds a second one.
2. Unzip `Suite-Demo-Kit-1.0.zip` to `C:\SuiteDemoKit` with Explorer (Extract All).
3. Start `C:\kit-check\obs\bin\64bit\obs64.exe --portable --disable-updater --multi`.
4. Scene Collection > Import, pick `C:\SuiteDemoKit\Suite Demo Kit.json`, press Import. With the
   scripted one already there it may be called "Suite Demo Kit 2": that is fine.
5. Scene Collection > the imported one. Check: no missing-files dialog; scene 1 shows the title;
   scene 2 moves.
6. Close OBS (File > Exit).
7. Compare it with the scripted import:

   ```
   python demo-kit/check-kit.py compare-import --file "C:\kit-check\obs\config\obs-studio\basic\scenes\<the new file>.json" --kit-dir C:\SuiteDemoKit
   ```

   It must print `PASS compare-import`: the file passes the same template check as the scripted
   run's "saved" row, so every value and UUID the template fixes is the kit's, with
   `C:\SuiteDemoKit` as `./`. It is not a key-by-key diff with the scripted import. It writes
   nothing into `C:\SuiteDemoKit`; `--out <file>` also writes the row to a file.
8. Delete the lock file.

### 2.2 The Stream Deck + (hardware)

With Fadester for OBS 0.7.7 and VJster 0.1.0 installed in Stream Deck 7.1 or later, OBS running
the imported collection with the WebSocket server on, and one Fadester key given its address and
password:

1. Double-click `Suite Demo Kit +.streamDeckProfile` and switch to it.
2. Visuals page: Scene 2 cuts to Kit Visuals; Look 1, 2, 3 toggle Look Prism, Kaleido, Pulse;
   the Kit Beat dial changes the beat's volume; Effect mix, Reactivity and Mix B move the looks
   (a press drops and returns); Scene 1 cuts to Kit Welcome.
3. PANIC (on every page) sets the looks to pass-through; Restore (on the first two pages) brings
   them back.
4. Layers page: Scene 3; Show / hide on Layer A and Layer B; Still holds Look Prism's reactivity
   at 0 for 2 s; the Layer A fade and Layer B fade dials; Mix C; Scene 5.
5. Clips page: Scene 4; Previous, Play / pause and Next move the left (100 %) clips only;
   Restart restarts the right (50 %) clip; Status shows the left clip's state; the dials are
   Kit Beat, Effect mix and the two layer fades.
6. The next-page key (bottom left) steps through the three pages.

### 2.3 The Speed Page by hand (VJster)

1. Double-click `Suite Demo Kit Speed +.streamDeckProfile` and switch to it.
2. Follow the card in scene 5: in a VJster action's settings tick Keep the link on, paste
   `https://youtu.be/aqz-KE-bpKQ`, press Copy address; in OBS open Speed Page's Properties, untick
   Local file, paste the address as the URL.
3. Close OBS and start it again while Stream Deck runs: the page loads and plays.
4. The SPEED dial and the 0.5x, 1x, 2x and +/-0.25 keys change the video's speed; the strip shows
   the rate; Play / pause pauses and plays.
5. Do not keep this collection for sharing: it now holds this computer's page key.

### 2.4 Listening

1. Scene 2 with headphones: `Kit Beat` is heard at a moderate level (-12 dB) and the looks pulse
   with it.
2. Mute `Kit Beat` in the Audio Mixer: silence, and the looks still pulse.

## 3. Results

| Date | Check | Result |
|---|---|---|
| 2026-11-01 | scripted, `check-kit.py run` | all 28 rows passed |
| | 2.1 real Import | operator |
| | 2.2 Stream Deck + | operator |
| | 2.3 Speed Page by hand | operator |
| | 2.4 listening | operator |
