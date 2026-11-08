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
python demo-kit/check-kit.py run --zip <kit-build folder>\Suite-Demo-Kit-1.1.zip --dir <new check folder>
```

It refuses to start while any `obs64` runs, and takes the OBS lock (`--lock <lock file>`, by default
the operator's `kit_obs.DEFAULT_LOCK`) like every other OBS run on this machine. It never touches an installed OBS, the shared test
portable or the demo reel's OBS. It unzips into `<dir>\kit`, assembles a fresh portable in
`<dir>\obs` (bin, data and core copied read-only from `--core <the OBS 33 portable>`, by default the
operator's `kit_obs.DEFAULT_CORE`, and hashed, with Playlister and Visual Sidechain from their build folders), imports the collection by
OBS's own Import rules, starts that OBS, runs the rows, puts back what it changed, closes OBS with
WM_CLOSE and checks the file OBS saved. Results go to `<dir>\results.jsonl`, screenshots to
`<dir>\shots\`. Nothing is played aloud: `Kit Beat` and the Speed Page are muted for the run
(and unmuted at the end only if they were not muted before). The kit profile is a Studio Mode
layout (K.6), so the check turns Studio Mode on for the run and off again at the end if it was
off. If the plugins row fails, the rows after it are not run (each is recorded as failed, "not
run"). After OBS closes, the SHA-256 of every file in the portable's config goes into
`<dir>\events.json`. The check folder is kept.

The committed script produces 35 rows: `reacts` is four (Look Prism, Look Kaleido, Look Pulse, the Audio
Modulator) and `shot` six (one per scene); every other line of the table is one row.

| Row | What passes |
|---|---|
| zip | the zip holds exactly the files the README's table names |
| fresh portable | a fresh portable assembled in `<dir>\obs`: bin, data and core copied from the OBS 33 tree and hashed, Playlister and Visual Sidechain from their build folders |
| import (scripted) | every `./` path became a path inside the unzip folder that exists |
| plugins | OBS 33 or later; Playlister and Visual Sidechain at least the versions in `kit-ids.json` ("plugins"); no kit plugin or source failed in the OBS log |
| scenes | the six scenes in the kit's order with the kit's UUIDs; every item id and source UUID |
| inputs | every input with the kit's name, kind and UUID; no other input |
| paths | every local path (media, the title, the card, each Playlister row) absolute, inside the unzip folder and present; no `./` left |
| full-frame | K.6: every real-footage source and Playlister item fills the 1920x1080 canvas in every scene that holds it; `Kit Motion`, `Layer A` and `Layer B` play the train, the sprint and the hurdles, muted |
| filters | every filter in order with its kind; the looks and the Audio Modulator tap `Kit Beat` (tap_mode 7) with React When Source Is Muted on |
| monitoring | `Kit Beat` on Monitor and Output at -12 dB |
| quiet | `Kit Beat` muted for the rest of the run |
| studio-mode | K.6: Studio Mode on for the run (turned on if it was off, off again at the end) |
| preview-cues | K.6: every scene cued in Preview by UUID, as the profile's scene keys do; then `Kit Visuals` cued and the T-bar at 0.25, 0.5, 0.75 blends it into Program (OBS logs the manual transition), as turning the scene mixer dial does |
| mixer-take | K.6, with Fadester's fix for OBS 33.0.1 (PLAN 12, `R-ACT-4`): the scene mixer's press sent as Fadester now sends it (`DirectObsClient.takeTbar`): `SetTBarPosition` 1.0 **without** release (a release always cancels on OBS 33.0.1, because `obs_frontend_set_tbar_position` never moves the T-bar widget that `TBarReleased` reads), then Studio Mode off and on again; the press takes Next live: Program must be `Kit Visuals` by `GetCurrentProgramScene`, Studio Mode on, and the OBS log must show "Switched to regular Preview mode" then "Switched to Preview/Program mode" and no "Manual transition cancelled". Preview then gets the previous Live, as Fadester sets it |
| beat-signals | Visual Sidechain's `get_signals` shows the beat while `Kit Beat` plays (muted) and nothing when it is paused |
| reacts: each look, the Audio Modulator | with `Kit Motion` (the train clip) paused and that filter alone, the picture moves with the beat and stands still without it (Look Kaleido: rotation held at 0, and "without" is its Reactivity at 0, since its beat phase keeps turning) |
| panic-restore | Visual Sidechain's Panic and Restore hotkeys are logged; Panic changes the filters; Restore puts every setting back |
| playlister-previous-next | Next, Next, Previous on `Kit Clips` by UUID move hurdles, sprint, train, sprint; the picture changes; Pause then Play give the paused and playing media states; `Kit Clips 50%` (in its own scene) does not move |
| playlister-speed | each Playlister with its scene in Program, over 4 s of wall time: `Kit Clips` plays at about 1x and `Kit Clips 50%` at about 0.5x; both report the same duration |
| profile-bindings | every action in both profiles finds its scene position, input, filter (with kind and setting), layer, fader or Panic hotkey in the live OBS; the scene mixer finds Studio Mode on |
| rename: Kit Clips | renamed, its Playlister keys still resolve by UUID |
| rename: Look Prism | renamed, its keys find no filter (the key's "Filter not found"); renamed back, they resolve |
| shot: each scene, speed-page-card | each scene and the Speed Page's setup card render (not blank) |
| speed-run | the real VJster plugin under the deck simulator with the kit's Speed + layout drives the Speed Page in OBS (Big Buck Bunny from YouTube): dial +1 notch 1.25x, 0.5x, +0.25 to 0.75x, 2x, -0.25 to 1.75x, 1x, pause, play; the strip shows each rate the page reports back. Needs the network; `--no-speed-run` leaves it out |
| put-back | every change undone (the first scene in Program and Preview, Studio Mode, the mutes, the Speed Page's settings), each step on its own |
| saved | the collection OBS saved on exit, with the unzip folder as `./`, is the kit's template: no value changed, every UUID the kit's |

Last recorded run: see section 3.

## 2. The operator's checklist

Do these once per release, on this machine. Close every OBS first; another agent may hold the
OBS lock (<lock file>, `kit_obs.DEFAULT_LOCK`): wait until it is gone. For 2.1, which starts OBS by
hand, then take the lock yourself so no agent starts an OBS meanwhile, from the repository
folder:

```
python -c "import sys; sys.path.insert(0, 'demo-kit'); import kit_obs; print(kit_obs.take_lock(kit_obs.DEFAULT_LOCK, 'operator 2.1'))"
```

It refuses while any `obs64` runs or the lock exists. Delete the lock file when 2.1 is done.

### 2.1 The real Import (plan 8.3 b)

1. Run the scripted check first (section 1) into a new folder, say `C:\kit-check`. Its portable,
   `C:\kit-check\obs`, then already has the collection; the real Import adds a second one.
2. Unzip `Suite-Demo-Kit-1.1.zip` to `C:\SuiteDemoKit` with Explorer (Extract All).
3. Start `C:\kit-check\obs\bin\64bit\obs64.exe --portable --disable-updater --multi`.
4. Scene Collection > Import, pick `C:\SuiteDemoKit\Suite Demo Kit.json`, press Import. With the
   scripted one already there it may be called "Suite Demo Kit 2": that is fine.
5. Scene Collection > the imported one. Check: no missing-files dialog; scene 1 shows the title;
   scene 2 moves (the train under Look Prism).
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
the imported collection in Studio Mode with the WebSocket server on, and one Fadester key given
its address and password:

1. Double-click `Suite Demo Kit +.streamDeckProfile` and switch to it.
2. Visuals page: Scene 2 cues Kit Visuals in Preview; the Scene blend dial (dial 1) fades it into
   Program, a press takes it live; Look 1, 2, 3 toggle Look Prism, Kaleido, Pulse on the train
   clip; Effect mix, Reactivity and Mix B move the looks (a press drops and returns); Scene 1
   cues Kit Welcome.
3. PANIC (on every page) sets the looks to pass-through; Restore (on the first two pages) brings
   them back.
4. Layers page: Scene 3 cues Kit Layers; Show / hide on Layer A (the sprint) and Layer B (the
   hurdles); Still takes Look Prism's reactivity to 0 over 2 s and leaves it there; the Layer A
   fade and Layer B fade dials; the Kit Beat dial changes the beat's volume; Scene 6 cues the
   Speed Page.
5. Clips page: Scene 4 cues Kit Playlister; Previous, Play / pause and Next move its clips;
   Scene 5 cues Kit Playlister 50%; Restart restarts the 50 % clip; the dials are Scene blend,
   Effect mix, Layer A fade and Kit Beat.
6. The next-page key (bottom left) steps through the three pages. With Studio Mode off, a scene
   key refuses and the Scene blend dial says so.

### 2.3 The Speed Page by hand (VJster)

1. Double-click `Suite Demo Kit Speed +.streamDeckProfile` and switch to it.
2. Follow the card in scene 6: in a VJster action's settings tick Keep the link on, paste
   `https://youtu.be/aqz-KE-bpKQ`, press Copy address; in OBS open Speed Page's Properties, untick
   Local file, paste the address as the URL.
3. Close OBS and start it again while Stream Deck runs: the page loads and plays.
4. The SPEED dial and the 0.5x, 1x, 2x and +/-0.25 keys change the video's speed; the strip shows
   the rate; Play / pause pauses and plays.
5. Do not keep this collection for sharing: it now holds this computer's page key.

### 2.4 Listening

1. Scene 2 with headphones: `Kit Beat` is heard at a moderate level (-12 dB) and the looks pulse
   with it; the train clip itself is silent.
2. Mute `Kit Beat` in the Audio Mixer: silence, and the looks still pulse.

## 3. Results

| Date | Check | Result |
|---|---|---|
| 2026-11-01 | scripted, `check-kit.py run` (kit 1.0) | all 28 rows of the script as it was then (before the `quiet` and `put-back` rows) passed |
| 2026-11-01 | scripted, `check-kit.py run` (kit 1.1, K.6) | 34 of 35 rows passed on a brand-new check folder (OBS 33.0.1 portable, obs-websocket 5.7.6, Playlister 0.5.0, Visual Sidechain 0.6.0; lock held, WM_CLOSE, exit 0, no taskkill; the speed run included). Failed: `mixer-take` (the release at 1.0 cancels the manual transition on OBS 33.0.1, see the row). Three runs that evening: the first failed `preview-cues` because the check read Preview back before OBS had applied it (the check now waits for the read-back); the second had `preview-cues` fail on the same release, which the third run split into its own row |
| 2026-11-01 | scripted, `check-kit.py run` (kit 1.1 with Fadester's T-bar take fix, branch `land-tbar-kit`) | 35 of 35 rows passed on a brand-new check folder (OBS 33.0.1 portable, obs-websocket 5.7.6, Playlister 0.5.0, Visual Sidechain 0.6.0; lock held, WM_CLOSE, exit 0, no taskkill; the speed run included). `mixer-take`, now sent as Fadester's press: Program `Kit Visuals` by `GetCurrentProgramScene`, Studio Mode on, both Studio Mode lines logged, no "Manual transition cancelled". The zip was byte-identical to the K.6 build (sha256 ae136cd7...41dd03). The operator's half (section 2) is still to do, including 2.2's press on the real deck |
| | 2.1 real Import | operator |
| | 2.2 Stream Deck + | operator |
| | 2.3 Speed Page by hand | operator |
| | 2.4 listening | operator |
