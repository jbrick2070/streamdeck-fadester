# Feature audit, Fadester for OBS (2026-10-28, before 0.3.0)

Ranked by impact on an operator with an APC40 mkII and a Stream Deck +. Each row says what the Midi
Fadester API allows, what the plugin did at 0.2.0, and what 0.3.0 does about it.

| # | Area | API allows | 0.2.0 | 0.3.0 |
|---|---|---|---|---|
| 1 | Slot assignment from the Property Inspector | `set_slot` + `get_catalog` (scenes, layers, audio sources, filter hosts, filters, numeric properties) | Not possible; assignment only in the OBS dialog | **Done.** "Slot assignment in OBS" editor: what it does (T-bar, mix two layers, show/hide a layer, volume, filter setting), pickers filled from the live catalog, feel (curve), also-fade-audio, filter range and bypass-at-0%. Apply calls `set_slot`; the error sentence is shown verbatim. |
| 2 | Controller and profile visibility | `get_state.profile/_display_name/_tier`, `device{name,connected,error}`, `load_profile` | Profile ignored in the PI; MIDI device state never shown | **Done.** Controller panel shows the active desk, its tier (Verified / Beta, untested / Custom), MIDI connected or the device error sentence, and a guarded profile switch that says it resets slot defaults. Only the active profile is treated as hardware truth; the switch list is from the contract and labelled so. |
| 3 | Password handling | n/a | Plain password echoed to every PI on every state broadcast | **Done.** PI receives `passwordSet` only; password leaves the PI only when the operator types one. Diagnostics never include it. |
| 4 | Reconnect behaviour | n/a | Every PI `change` event and every dial tick while offline forced an immediate reconnect, dropping a healthy socket or defeating backoff; Test dropped a live connection | **Done.** Settings reconnect only when host, port or password changed; dial and key actions use a 2 s throttled nudge; Test re-reads `get_state` when already connected. |
| 5 | Honest offline slot list | n/a | Hard-coded 10 slots shown as "available" when OBS is offline | **Done.** Offline group is labelled as contract defaults and the saved slot is kept; live names and availability replace it on connect. |
| 6 | Dial display options | n/a | Label from engine only; readout always engine value | **Done.** Per-action label override, readout style (engine value or percent), finer 0.5 % and coarser 10 % steps. |
| 7 | Unavailable slot guard | `available`, `reason` | Rotate on an unavailable slot sent a request, got a vendor error, triggered a resync | **Done.** Actions alert locally and send nothing when the slot reports unavailable. |
| 8 | PI live refresh | `state_changed` | Dropdown rebuilt on every broadcast, including while the operator had it open | **Done.** Rebuild only when the option set changed and the control is not focused. |
| 9 | Per-action vs shared settings | n/a | One "(Global)" heading | **Done.** Sections: "This action", "Slot assignment in OBS (shared by all surfaces)", "Controller (shared)", "OBS connection (shared)". |
| 10 | All FX key | `reset_fx` | "Fade To" shown for All FX although ignored | **Done.** Hidden for All FX; duration help text explains 0 ms = instant. |
| 11 | Mixer layers / banks | Not in the API: 18 flat slots, no bank or layer concept | n/a | **Blocked by API.** Closest: the Faders and FX & Knobs groups. A `bank` field would need a contract change on the Midi Fadester side. |
| 12 | Auto-fade easing | `auto_fade {slot,to,ms}` has no easing; the slot's `curve` shapes the fade | n/a | **Blocked by API.** The editor exposes the slot curve, which is what shapes a fade. |
| 13 | Profile discovery | No `list_profiles`; the known list exists only in the `load_profile` error text and the contract | Hard-coded | **Partially blocked.** List comes from the contract constant and is labelled as such; the active profile is read live. A `list_profiles` request is the right fix and is proposed in NOTE-FOR-MIDI-FADESTER.md. |
| 14 | Hardware claims | n/a | README said hardware-verified | **Kept honest.** Only APC40 mkII + Stream Deck + are claimed; other profiles stay "Beta, untested" in the UI. |

Deferred (lower impact or needs hardware): configurable hold threshold, dial-screen meters, scene keys, and anything on the IDEAS.md list.
