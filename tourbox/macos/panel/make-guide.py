# SPDX-License-Identifier: GPL-2.0-or-later
"""Generate the Mac-only offline guide from the shared control map."""
import html
import json
from pathlib import Path
import sys

source = Path(__file__).resolve().parents[2] / "presets" / "map.json"
preset = json.loads(source.read_text(encoding="utf-8"))["presets"]["master"]
rows = []
for row in preset["bindings"] + preset["nativeBindings"]:
    control = row["control"].replace("+", " + ").title()
    gesture = {"cw": "Clockwise", "ccw": "Counterclockwise", "press": "Press"}[row["gesture"]]
    if row.get("mode") == "release":
        gesture += " (on release)"
    rows.append("<tr>" + "".join("<td>" + html.escape(value) + "</td>" for value in [control, gesture, row["label"]]) + "</tr>")
labels = {row["action"]: row["label"] for row in preset["bindings"] + preset["menuBindings"]}
menu = "".join("<li>" + html.escape(labels[action]) + "</li>" for action in preset["tourMenu"]["actions"])
document = """<!doctype html>
<!-- SPDX-License-Identifier: GPL-2.0-or-later -->
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fadester Companion — Mac quick guide</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#18302b;background:#fffefa}h1{line-height:1.15}h2{margin-top:2em}.note{background:#edf3ee;padding:16px;border-left:4px solid #456d5b}.twoway{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin:20px 0}.card{background:#f3f6fb;border:1px solid #cdd7e6;border-radius:8px;padding:16px}table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:10px;border-bottom:1px solid #bacac0}th{background:#edf3ee}li{margin:.5em 0}code{overflow-wrap:anywhere}@media print{body{font-size:11pt;margin:0}tr{break-inside:avoid}h2{break-after:avoid}}</style>
<h1>Fadester Companion</h1><p>Mac edition · OBS Fadester for TourBox</p>
<p class="note">This is a developer candidate. Native Mac import, Scroll press and Dial input were checked on one full-size TourBox through a remote USB connection. This does not establish every physical combination, every keyboard layout, or complete show readiness. Rehearse with your own idle test scenes before relying on it.</p>
<div class="twoway">
<div class="card"><b>Opened Fadester Companion first?</b><br>Click <b>1. Save TourBox Preset (.tb)…</b> to save <code>OBS Fadester for TourBox.tb</code> in Downloads, then click <b>2. Open TourBox Console</b> (or follow the animated <b>Show me where to click</b> window): click the middle <b>Import [↙]</b> icon beside Preset List, open the <code>.tb</code>, then click <b>Not Linked</b> → pick <b>OBS</b> (not Fadester) → click <b>Save</b>, with Auto Switch on.</div>
<div class="card"><b>Opened TourBox Console first?</b><br>TourBox’s <code>.tb</code> files do not embed machine-specific app paths (even presets from <a href="https://www.tourboxtech.com/en/presets/">TourBox Preset Square</a> import as <b>Not Linked</b>). Link the preset to <b>OBS</b> once in Console, and keep <b>Fadester Companion</b> open with <b>Controls: on</b> while OBS is in front. (<a href="https://www.tourboxtech.com/en/downloads/">TourBox Console download</a>)</div>
</div>
<h2>Connect in five steps</h2><ol>
<li>Keep the complete application bundle together. Open <b>Fadester Companion</b>. Its top status lights and live interactive setup diagram check whether OBS and TourBox Console are open, without registering shortcuts or starting controls automatically.</li>
<li>Click <b>1. Save TourBox Preset (.tb)…</b> to save the embedded <code>OBS Fadester for TourBox.tb</code> into a visible folder such as Downloads (Fadester Companion remembers the preset hash and tells you if a future app update includes a newer <code>.tb</code>), then click <b>2. Open TourBox Console</b> (or <b>Show me where to click</b>). In TourBox Console click the middle <b>Import [↙]</b> icon beside Preset List, open <code>OBS Fadester for TourBox.tb</code>, click <b>Not Linked</b> → pick <b>OBS</b> (not Fadester) → click <b>Save</b>, and keep Auto Switch on. Mac shortcuts use <b>Control + Option + Shift</b> for the OBS actions and <b>Control + Shift</b> or <b>Option + Shift</b> for the video and layer actions; Command is absent. Do not import the Windows file.</li>
<li>Enable authenticated OBS WebSocket in <b>Tools → WebSocket Server Settings</b>. Fadester Companion reads the matching saved local password automatically (an override lasts only for the open app session). Discovery is strictly read-only. In Assignments select names, or leave unused roles unassigned.</li>
<li>Open the native slider permission window and grant its Accessibility permission through macOS System Settings. TourBox Console has separate permissions. A grant for another probe is not proof that this bundled helper is authorized.</li>
<li>Use OBS 33, Studio Mode, Fade, two different scenes and a visible T-bar at its starting end. Close OBS dialogs. Click <b>Save &amp; start controls</b> (or <b>Start</b> in the top bar), wait for <b>Controls: on</b>, then focus OBS and check the selected Console preset.</li></ol>
<h2>First rehearsal</h2><p>Press Scroll for the Program and Preview names in Activity. Turn Scroll to cue Preview. The flat Dial drives the native manual mix; Side + Dial rides Music. The raised Knob steps VJster video speed (press + turn for fine 0.05x, Side + Knob press to return to 1x) in Chrome YouTube or an OBS Browser Source pointed at the copied <code>/obs</code> URL; press + turn Scroll steps quality and Side + D-pad Up toggles play/pause. Top + Dial rides Layer 2 opacity, Top + Knob steps Layer 1 blend modes, and Top + Scroll steps Layer 2 blend modes. Stop partway to hold the blend. Side + Dial press cancels. Complete a throw, then use the opposite direction for the return. T-bar left/right describe counterclockwise/clockwise control directions; they do not permanently identify either scene.</p>
<p>Tall takes Preview and Top cuts from rest; during a partial manual mix either finishes that mix. Short undoes the last supported audio adjustment. Side reads recording status. Side, Top, Tall and Short act on release. Rehearse each held combination and confirm there is no unwanted single-button action when released.</p>
<p>Tour opens the menu at the pointer. Scroll selects, Tall confirms, Short dismisses. Verify these menu gestures on your Console before using them live. General HUD in Console offers a compact assignment card.</p>
<h2>Optional whole mix</h2><p>Leave it off for initial rehearsal. When enabled, Side + Knob and compatible local clients can control all eligible public OBS audio inputs together. This affects their tracks and monitors. It preserves mute states; it is not a stream-only master. Newly added inputs may be heard before discovery. Stop does not restore levels. Use the same configuration and the explicit Restore whole mix action to recover an owned fade.</p>
<h2>Stop and recover</h2><p>Stop controls releases the owned shortcuts and closes the host. It does not finish or cancel a partial transition or raise audio. Check OBS after interruption; never assume a stopped app restored the show. Activity reports refusals. If a source is renamed, stop, read the current catalog, reassign it and restart. A missing saved target is retained as Unavailable, never silently replaced.</p>
<p>The app saves its assignments to <code>~/Library/Application Support/FadesterTourBox/panel-config.json</code>, without a password. It does not overwrite a malformed settings file. To uninstall, stop and quit the app, remove the preset in Console if desired, and delete the app. Keep settings and mix-state files until you have reviewed any pending audio recovery.</p>
<h2>Complete physical map</h2><table><thead><tr><th>Control</th><th>Gesture</th><th>Action</th></tr></thead><tbody>__ROWS__</tbody></table>
<h2>Tour menu</h2><ol>__MENU__</ol><p>English and a US/ABC keyboard layout are the initial test scope. Other languages and keyboard layouts remain unverified. The experimental app is ad-hoc signed, not notarized.</p></html>"""
Path(sys.argv[1]).write_text(document.replace("__ROWS__", "".join(rows)).replace("__MENU__", menu), encoding="utf-8")
