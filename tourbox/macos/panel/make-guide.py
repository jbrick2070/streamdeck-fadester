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
<title>OBS Fadester for TourBox — Experimental Mac guide</title>
<style>body{font:17px/1.6 system-ui,sans-serif;max-width:920px;margin:40px auto;padding:0 24px;color:#18302b;background:#fffefa}h1{line-height:1.15}h2{margin-top:2em}.note{background:#edf3ee;padding:16px;border-left:4px solid #456d5b}table{width:100%;border-collapse:collapse;font-size:15px}th,td{text-align:left;padding:10px;border-bottom:1px solid #bacac0}th{background:#edf3ee}li{margin:.5em 0}code{overflow-wrap:anywhere}@media print{body{font-size:11pt;margin:0}tr{break-inside:avoid}h2{break-after:avoid}}</style>
<h1>OBS Fadester for TourBox</h1><p>Experimental Mac edition · One master preset</p>
<p class="note">This is a developer candidate. Native Mac import, Scroll press and Dial input were checked on one full-size TourBox through a remote USB connection. This does not establish every physical combination, every keyboard layout, or complete show readiness. Rehearse with your own idle test scenes before relying on it.</p>
<h2>Connect in five steps</h2><ol>
<li>Keep the complete application bundle together. Open the app. It does not connect, register shortcuts or start controls automatically.</li>
<li>Choose <b>Save Mac preset…</b>. In TourBox Console use <b>Import beside Preset List</b>, import that file, and link the one <b>OBS Fadester for TourBox</b> preset to OBS Studio with Auto Switch. Mac shortcuts use <b>Control + Option + Shift</b> for the OBS actions and <b>Control + Shift</b> or <b>Option + Shift</b> for the video and layer actions; Command is absent. Do not import the Windows file.</li>
<li>Enable authenticated OBS WebSocket in <b>Tools → WebSocket Server Settings</b>. The app can read the matching saved local password. An override lasts only for the open app session. Choose <b>Read scenes and inputs</b>; discovery is read-only. In Assignments select names, or leave unused roles unassigned.</li>
<li>Open the native slider permission window and grant its Accessibility permission through macOS System Settings. TourBox Console has separate permissions. A grant for another probe is not proof that this bundled helper is authorized.</li>
<li>Use OBS 33.0.0 or 33.0.1, Studio Mode, Fade, two different scenes and a visible T-bar at its starting end. Close OBS dialogs. Select <b>Save &amp; start controls</b>, wait for <b>Connected — controls armed</b>, then focus OBS and check the selected Console preset.</li></ol>
<h2>First rehearsal</h2><p>Press Scroll for the Program and Preview names in Activity. Turn Scroll to cue Preview. The flat Dial drives the native manual mix; Side + Dial rides Music. On the current map the raised Knob and the Top layer are the video speed and the VJ layers, which this experimental Mac edition does not host yet. Stop partway to hold the blend. Side + Dial press cancels. Complete a throw, then use the opposite direction for the return. T-bar left/right describe counterclockwise/clockwise control directions; they do not permanently identify either scene.</p>
<p>Tall takes Preview and Top cuts from rest; during a partial manual mix either finishes that mix. Short undoes the last supported audio adjustment. Side reads recording status. Side, Top, Tall and Short act on release. Rehearse each held combination and confirm there is no unwanted single-button action when released.</p>
<p>Tour opens the menu at the pointer. Scroll selects, Tall confirms, Short dismisses. Verify these menu gestures on your Console before using them live. General HUD in Console offers a compact assignment card.</p>
<h2>Optional whole mix</h2><p>Leave it off for initial rehearsal. When enabled, Side + Knob and compatible local clients can control all eligible public OBS audio inputs together. This affects their tracks and monitors. It preserves mute states; it is not a stream-only master. Newly added inputs may be heard before discovery. Stop does not restore levels. Use the same configuration and the explicit Restore whole mix action to recover an owned fade.</p>
<h2>Stop and recover</h2><p>Stop controls releases the owned shortcuts and closes the host. It does not finish or cancel a partial transition or raise audio. Check OBS after interruption; never assume a stopped app restored the show. Activity reports refusals. If a source is renamed, stop, read the current catalog, reassign it and restart. A missing saved target is retained as Unavailable, never silently replaced.</p>
<p>The app saves its assignments to <code>~/Library/Application Support/FadesterTourBox/panel-config.json</code>, without a password. It does not overwrite a malformed settings file. To uninstall, stop and quit the app, remove the preset in Console if desired, and delete the app. Keep settings and mix-state files until you have reviewed any pending audio recovery.</p>
<h2>Complete physical map</h2><table><thead><tr><th>Control</th><th>Gesture</th><th>Action</th></tr></thead><tbody>__ROWS__</tbody></table>
<h2>Tour menu</h2><ol>__MENU__</ol><p>English and a US/ABC keyboard layout are the initial test scope. Other languages and keyboard layouts remain unverified. The experimental app is ad-hoc signed, not notarized.</p></html>"""
Path(sys.argv[1]).write_text(document.replace("__ROWS__", "".join(rows)).replace("__MENU__", menu), encoding="utf-8")
