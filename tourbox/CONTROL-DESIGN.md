# OBS Fadester for TourBox

The Windows package contains one native preset, **OBS Fadester for TourBox**, with a stable physical layout and one Tour menu. Both Tour and Side + Tour open that menu. The map entry is presets.master, and the guide generates its full control reference from that entry.

The flat Dial controls OBS’s native Studio Mode T-bar. Scroll cues Preview, and the raised Knob rides Music. Pressing a rotary reads status or levels. Pressing and turning Knob or Dial provides quarter steps; pressing and turning Scroll steps through media. Side + Dial rides Content, Side + Dial press cancels the manual mix, and Side + Scroll press synchronizes Preview to Program. Four D-pad anchors, music duck/restore and audio undo provide immediate access during a show.

The Tour menu adds transition selection and timing, overlay show/hide, mic mute, screenshot, recording status and chapters, replay saving and reconnect. It also gathers scene and audio readouts, whole-mix fade/restore and play/pause. Commands use the operator’s assigned source identities. OBS supplies live state, and TourBox Console displays the assignment labels. An optional General HUD starts hidden.

The selected modifier layout gives the prime buttons useful alternate grips. Side turns control whole mix, media and Content. Tall turns control Content, transition type and fine fade. Short turns control fine Music, Preview and fine fade. Top turns control Content, media and transition duration. Side, Tall, Short and Top use native UP mode for their bare actions. These actions execute on release. The master’s hardware verification must confirm the complete modifier gesture and release, especially for Tall and Top. [TourBox UP mode](https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html)

Whole-mix control is opt-in. Side + Knob rides its level and Side + Knob press reads it. Every controller shares the companion’s gain state through authenticated OBS WebSocket. Each eligible source retains its own baseline; an external mixer edit releases that source from the current group. Late inputs join on discovery, and muted inputs remain muted. The operator guide describes restoration and multi-track behavior.

The package supplies the native preset, companion runtime, setup panel, illustrated guide, category artwork and source. The generator validates menu links, labels and shortcuts against the map. Current master import and physical rehearsal results belong in REHEARSAL.md after observation.

The installed factory Windows Resolve preset provided concrete examples for the native TourMenu and optional HUD structures. Its vendor-specific workflow integration is documented by TourBox. [Resolve features](https://www.tourboxtech.com/en/news/tourbox-features-for-davinci-resolve.html), [TourMenu](https://www.tourboxtech.com/en/manual/tourmenu/), [General HUD](https://www.tourboxtech.com/en/news/how-to-use-hud-in-tourbox.html)
