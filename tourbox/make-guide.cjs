const fs = require('node:fs');
const path = require('node:path');

const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets', 'map.json'), 'utf8'));
const locales = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets', 'locales.json'), 'utf8'));
const languageNames = {
  de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', ja: '日本語', ko: '한국어',
  ru: 'Русский', 'zh-CN': '简体中文', 'zh-TW': '繁體中文',
};
const languageLinks = Object.keys(locales).sort().map(locale =>
  `<a href="guide/${locale}.html" hreflang="${locale}" lang="${locale}">${languageNames[locale] || locale}</a>`).join(' ');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[char]);

const controlNames = {
  knob: 'Raised Knob', dial: 'Flat Dial', scroll: 'Scroll wheel', up: 'D-pad Up',
  right: 'D-pad Right', down: 'D-pad Down', left: 'D-pad Left', side: 'Side',
  tour: 'Tour', c1: 'C1', c2: 'C2', top: 'Top', tall: 'Tall', short: 'Short'
};

function controlLabel(control, turning) {
  const parts = control.split('+');
  if (parts[1] === 'press') return 'Press and turn ' + controlNames[parts[0]];
  if (parts.length > 1) return 'Hold ' + parts.slice(0, -1).map(key => controlNames[key] || key).join(' + ')
    + ' + ' + (turning ? 'turn ' : 'press ') + (controlNames[parts.at(-1)] || parts.at(-1));
  return controlNames[control] || control;
}

function turnTable(bindings) {
  const pairs = new Map();
  for (const binding of bindings.filter(binding => ['ccw', 'cw'].includes(binding.gesture))) {
    if (!pairs.has(binding.control)) pairs.set(binding.control, {});
    pairs.get(binding.control)[binding.gesture] = binding.label;
  }
  const rows = Array.from(pairs, ([control, pair]) =>
    `<tr><th scope="row">${escapeHtml(controlLabel(control, true))}</th><td>${escapeHtml(pair.ccw || '—')}</td><td>${escapeHtml(pair.cw || '—')}</td></tr>`
  ).join('');
  return `<table><caption>Turn controls</caption><thead><tr><th scope="col">Gesture</th><th scope="col">First direction / CCW</th><th scope="col">Opposite / CW</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function pressTable(title, bindings) {
  const rows = bindings.map(binding => {
    const result = escapeHtml(binding.label) + (binding.mode === 'release' ? ' <small>(on release)</small>' : '');
    return `<tr><th scope="row">${escapeHtml(controlLabel(binding.control, false))}</th><td>${result}</td></tr>`;
  }).join('');
  return `<table class="press"><caption>${title}</caption><thead><tr><th scope="col">Control</th><th scope="col">Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function reference(key, index, lead, note) {
  const preset = map.presets[key];
  const presses = [...preset.bindings, ...preset.nativeBindings].filter(binding => binding.gesture === 'press');
  const menuRows = preset.tourMenu.actions.map(id => {
    const entry = [...preset.bindings, ...(preset.menuBindings || [])].find(binding => binding.action === id);
    if (!entry) throw new Error('Tour menu action missing from ' + key + ' bindings: ' + id);
    return '<li>' + escapeHtml(entry.label) + '</li>';
  }).join('');
  return `<section class="sheet reference" id="${key}" aria-labelledby="${key}-title">
    <p class="eyebrow">Control reference <span>/</span> ${index}</p>
    <h2 id="${key}-title">${escapeHtml(preset.name)}</h2><p class="lead">${lead}</p>
    <a class="preset-art" href="artwork/${key}-cover.png"><img src="artwork/${key}-cover.svg" loading="lazy" width="1600" height="900" alt="OBS Fadester for TourBox: scene, audio, media and capture controls"></a>
    ${turnTable(preset.bindings)}
    <div class="press-grid">
      ${pressTable('Single presses', presses.filter(binding => !binding.control.includes('+')))}
      ${pressTable('Hold a modifier and press', presses.filter(binding => binding.control.includes('+')))}
    </div>
    <aside class="menu"><h3>Tour menu · ${escapeHtml(preset.tourMenu.name)}</h3>
      <p>Press Tour or Side + Tour to open the same menu at the pointer. Scroll to an entry and press Tall to run it, or click the entry. Press Short to dismiss.</p>
      <ol class="menu-choices">${menuRows}</ol></aside>
    <p class="note">${note}</p></section>`;
}

function surfaceDiagram() {
  const labels = [
    ['Scroll', 20, 62, '77,57 145,57 188,93'],
    ['Side', 18, 156, '63,151 121,151 140,145'],
    ['Tour', 18, 211, '64,206 108,206 231,185'],
    ['Flat Dial', 18, 280, '88,275 145,275 186,237'],
    ['Top', 252, 29, '267,37 267,75'],
    ['C1', 357, 29, '364,36 341,88'],
    ['C2', 409, 29, '415,36 366,90'],
    ['Raised Knob', 449, 133, '445,127 372,127 301,158'],
    ['Tall', 450, 214, '443,208 385,208 349,220'],
    ['Short', 450, 259, '443,253 402,253 378,240'],
    ['D-pad', 269, 326, '287,307 287,284 283,246']
  ];
  const leaders = labels.map(([label, x, y, points]) =>
    `<polyline points="${points}" fill="none" stroke="#507363" stroke-width="1.6"/><text x="${x}" y="${y}">${label}</text>`
  ).join('');
  return `<svg viewBox="0 0 570 344" role="img" aria-labelledby="surface-title surface-desc" xmlns="http://www.w3.org/2000/svg">
    <title id="surface-title">TourBox full-size control layout, viewed from above</title>
    <desc id="surface-desc">Scroll is at upper left; Top is above the raised central Knob. C1 and C2 are at upper right. Side is on the left edge. Tour sits above and right of the flat Dial. The D-pad is below the Knob. Tall and Short are on the right.</desc>
    <defs><pattern id="knurl" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 7L7 0M5 9L9 5" stroke="#678579"/></pattern></defs>
    <path d="M146 89Q149 56 191 54L356 58Q389 59 397 87L422 248Q426 276 398 283L177 289Q144 289 137 262L127 196Q125 175 135 148Z" fill="#334b45" stroke="#182d29" stroke-width="4"/>
    <path d="M158 86Q165 68 192 66L351 70Q376 71 384 89" fill="none" stroke="#678378" stroke-width="3"/>
    <g fill="#213831" stroke="#93aa9d" stroke-width="2">
      <rect x="174" y="80" width="28" height="65" rx="11"/><rect x="180" y="87" width="16" height="50" rx="6" fill="#486759"/>
      <rect x="232" y="71" width="76" height="21" rx="8"/><circle cx="340" cy="92" r="10"/><circle cx="364" cy="94" r="10"/>
      <rect x="130" y="127" width="12" height="39" rx="5"/><circle cx="237" cy="183" r="9"/>
      <circle cx="277" cy="154" r="28"/><circle cx="277" cy="150" r="24" fill="url(#knurl)"/>
      <circle cx="188" cy="225" r="38"/><circle cx="188" cy="223" r="31" fill="#405d51"/>
      <path d="M275 205h15v14h14v15h-14v14h-15v-14h-14v-15h14z"/>
      <rect x="335" y="182" width="23" height="66" rx="7"/><rect x="365" y="204" width="24" height="44" rx="7"/>
    </g>
    <g fill="none" stroke="#93aa9d" stroke-width="1.6"><path d="M181 99h14m-14 7h14m-14 7h14m-14 7h14m-14 7h14"/>
      <path d="M188 197v8m-21-3 6 7m-11 15h9m-2 17 6-7m14 16v-9m20-8-7-3m9-17-8 4m-7-19-3 8"/>
    </g><g fill="#203c32" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="700">${leaders}</g>
  </svg>`;
}

const css = `
:root{color-scheme:light;--ink:#182c26;--muted:#425c50;--line:#b9c9be;--paper:#fffefa;--tint:#eef3eb;--gold:#f1cb78;--accent:#23543e}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:10px}
body{margin:0;background:#e7ede6;color:var(--ink);font:16px/1.52 system-ui,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;background:var(--paper);border-inline:1px solid var(--line)}
.sheet{padding:36px clamp(20px,4vw,58px) 42px}.sheet+.sheet{border-top:2px solid var(--line)}
header{background:#1b382d;color:#fff;padding:30px clamp(20px,4vw,58px) 33px}
.eyebrow{font-size:.74rem;text-transform:uppercase;font-weight:750;letter-spacing:.15em;margin:0 0 7px;color:var(--accent)}
header .eyebrow{color:var(--gold)}.eyebrow span{padding:0 5px;color:inherit}
h1,h2,h3,p{margin-top:0}h1{font-size:clamp(2.2rem,6vw,3.75rem);line-height:1.05;margin-bottom:12px;letter-spacing:-.047em}
h2{font-size:clamp(1.65rem,4vw,2.35rem);line-height:1.14;letter-spacing:-.035em;margin-bottom:10px}
h3,caption{font-size:1.07rem;line-height:1.3;font-weight:750;margin-bottom:7px}
header p:last-child{max-width:62ch;margin:0;color:#e1eade;font-size:1.13rem}
.lead{max-width:76ch;color:var(--muted)} a{color:#20593c;text-underline-offset:.15em}a:focus-visible{outline:3px solid #b66e00;outline-offset:3px}
.skip{position:absolute;left:-9999px}.skip:focus{z-index:5;left:10px;top:8px;background:white;padding:8px}
nav{background:#e2ebe0;padding:11px clamp(20px,4vw,58px);display:flex;gap:10px 25px;flex-wrap:wrap;font-weight:650;font-size:.92rem}
figure{margin:0}svg{display:block;width:100%;height:auto}figcaption{font-size:.85rem;color:var(--muted);margin:4px 0 0}
.preset-art{display:block;max-width:450px}.preset-art img{display:block;width:100%;height:auto;border-radius:8px}
.surface{display:grid;grid-template-columns:1.25fr 1fr;align-items:center;gap:26px}
.surface figure{background:var(--tint);border:1px solid var(--line);padding:9px 12px 12px;border-radius:6px}
.roles,.problems{margin:0}.roles dt,.problems dt{font-weight:750;margin-bottom:1px}.roles dd,.problems dd{margin:0 0 11px}
.roles dd:last-child,.problems dd:last-child{margin-bottom:0}.key{font-weight:750}
.rule{margin:17px 0 0;padding:12px 15px;border-left:4px solid #bf8d32;background:#fbf2dc}
.step-list{padding-left:1.52rem;margin:10px 0 18px}.step-list li{padding-left:4px;margin:.4em 0}.step-list li::marker{font-weight:750;color:var(--accent)}
.practice,.press-grid,.two-col{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.practice>div,.example{padding:13px 15px;border:1px solid var(--line);border-radius:5px;background:var(--tint)}
.practice p,.example p{margin:0}.menu{margin:15px 0 0;padding:12px 15px;background:var(--tint);border:1px solid var(--line);border-radius:5px}.menu p,.menu ol{font-size:.92rem;margin:0}.menu ol{padding-left:1.4em;margin-top:6px}.menu-choices{columns:2;column-gap:30px}.menu-choices li{break-inside:avoid}.subhead{margin-top:23px}.note{margin:13px 0 0;padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:.95rem}
table{border-collapse:collapse;width:100%;table-layout:fixed;align-self:start;margin:10px 0 0;font-size:.94rem}
caption{text-align:left;padding:5px 0;color:var(--ink)}td,th{text-align:left;vertical-align:top;padding:5px 8px;overflow-wrap:anywhere;border-bottom:1px solid var(--line)}thead{background:#e1ebe0}thead th{font-size:.85rem;color:#344b3f}
tbody th{font-weight:650}.press-grid{grid-template-columns:1.06fr 1fr;margin-top:7px}.press th:first-child{width:44%}td small{font-size:.85em}
footer{padding:17px clamp(20px,4vw,58px);background:#e1e9de;color:var(--muted);font-size:.86rem}footer p{margin:0}
@media(max-width:760px){.menu-choices{columns:1}.surface,.practice,.press-grid,.two-col{grid-template-columns:1fr;gap:12px}.sheet{padding-block:26px}table{font-size:.9rem}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
@page{margin:12mm;size:auto}
@media print{body,main{background:#fff;color:#111;border:0;max-width:none}body{font:10pt/1.32 Arial,sans-serif}html{scroll-behavior:auto}
header{color:#111;background:#fff;border-bottom:2px solid #49694f;padding:0 0 8pt}header p:last-child,header .eyebrow{color:#222}h1{font-size:26pt}h2{font-size:19pt}h3,caption{font-size:11pt}.sheet{padding:8pt 0}
.sheet+.sheet{break-before:page;border:0}.surface{grid-template-columns:1.2fr 1fr;gap:12pt}.practice,.two-col,.press-grid{grid-template-columns:1fr 1fr;gap:10pt}
nav,.skip,footer{display:none}figcaption,.note,table,thead th,.lead{font-size:9pt}.subhead{margin-top:12pt}td,th{padding:3pt 4pt}tr,figure,.example,.practice>div{break-inside:avoid}
caption,h2,h3{break-after:avoid}thead{display:table-header-group}.rule,.example,.practice>div{background:white}a{color:inherit}
.preset-art{display:none}.sheet.mixguide{break-before:auto}.reference td,.reference th{padding:2pt 3pt}.reference .menu{padding:5pt 7pt;margin-top:6pt}.reference .menu ol,.reference .menu p{font-size:9pt;line-height:1.2}.reference .note{margin-top:4pt}}
`;

const master = reference('master', '03', 'Cue a scene with Scroll, mix it onto Program with the flat Dial, and ride the speed of the YouTube video in Chrome with the raised Knob. Hold Side for Music on the Dial; hold Top for the two VJ layers.', 'T-bar left means turn the Dial counterclockwise; T-bar right means clockwise. These names describe the control direction. After each completed throw, turn the opposite way to take the next Preview live. OBS parks its native handle at the start after a completed throw. During a partial mix, either Tall or Top finishes that mix. From rest, Tall uses the selected transition and Top cuts.');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OBS Fadester for TourBox · Operator guide</title><style>${css}</style></head><body>
<a class="skip" href="#surface">Skip to controls</a><main>
<header><p class="eyebrow">Operator guide <span>/</span> Windows x64</p><h1>OBS Fadester for TourBox</h1>
<p>Cue, mix and take scenes with one preset. Open Tour for media, overlays, transition settings and capture tools.</p></header>
<nav aria-label="Guide sections"><a href="#surface">Desk layout</a><a href="#setup">First minute</a><a href="#master">All controls</a><a href="#vj">YouTube and VJ layers</a><a href="#recovery">At the desk</a></nav>
<nav aria-label="Quick starts in other languages">${languageLinks}</nav>
<section class="sheet" id="surface" aria-labelledby="surface-heading"><p class="eyebrow">Orientation <span>/</span> 01</p>
<h2 id="surface-heading">Find the controls by touch</h2>
<div class="surface"><figure>${surfaceDiagram()}<figcaption>Full-size TourBox, top view. The small Tour button sits between the flat Dial and the raised Knob.</figcaption></figure>
<dl class="roles"><dt>Scroll wheel · choose the shot</dt><dd>Turn to browse Preview. Press to read the Program and Preview names.</dd>
<dt>Flat Dial · mix the shot</dt><dd>The large, low wheel at lower left drives the native T-bar between the two OBS panes. Stop turning to hold a blend.</dd>
<dt>Raised Knob · ride the video</dt><dd>The smaller central Knob changes the speed of the YouTube video playing in Chrome, through the free VJster extension. Press it to read the video’s title, speed and quality; hold Side and press it to return to 1x. Music is on Side + Dial.</dd></dl></div>
<h3 class="subhead">Three gestures on the same control</h3>
<p><strong>Turn</strong> for a normal step. <strong>Press and release</strong> for the tap action. <strong>Press and keep the rotary down as you turn</strong> for its second action. The Dial moves in quarter steps this way, the Knob in 0.05 speed steps. Pressing and turning Scroll steps through the video’s quality levels.</p>
<h3 class="subhead">Hold one modifier for another control</h3>
<p><b>Side</b> gives whole-mix level on the Knob, media on Scroll and Music on the Dial. <b>Tall</b> gives Content, transition type and fine fade. <b>Short</b> gives fine Music, Preview and fine fade. <b>Top</b> gives the VJ layers: Layer 1’s blend mode on the Knob, Layer 2’s blend mode on Scroll and Layer 2’s opacity on the Dial. The complete gesture tables below include these alternate grips and the direct production buttons.</p>
<p>The bare <b>Side, Tall, Short and Top</b> buttons use Console’s <b>UP</b> mode, so their individual actions run on release. Hold the modifier before operating the second control. These combinations need a physical hold/release check on the actual device; follow the <a href="source/tourbox/REHEARSAL.md">master rehearsal checks</a>. <a href="https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html">TourBox UP mode instructions</a>.</p>
<p class="rule"><strong>Tour and Side + Tour.</strong> Both open the same menu at the pointer. Scroll to a choice and press <b>Tall</b> to run it. Press <b>Short</b> to dismiss. Transition type and timing, overlays and capture tools are available in this menu.</p>
</section>
<section class="sheet" id="setup" aria-labelledby="setup-title"><p class="eyebrow">Setup and rehearsal <span>/</span> 02</p><h2 id="setup-title">Your first minute at the desk</h2>
<h3>Set up once</h3><ol class="step-list">
<li>Extract the entire Windows ZIP and open <strong>Fadester for TourBox.exe</strong>. Keep its companion files together.</li>
<li>Open OBS. In TourBox Console, use <b>Import</b> beside <b>Preset List</b> to add <b>OBS Fadester for TourBox.tb</b> from <b>presets</b>. Link it to <b>obs64</b>, enable <b>Auto Switch</b>, and select <b>OBS Fadester for TourBox</b>. For later updates, select this preset and use its own menu’s <b>Import</b> to replace its contents.</li>
<li>In OBS, enable <b>Tools → WebSocket Server Settings</b> with authentication. Turn on <b>Studio Mode</b>, choose <b>Fade</b>, and keep the main OBS window and its T-bar visible. The manual control targets OBS 33.0.0 and 33.0.1.</li>
<li>In the Fadester panel, click <b>Read scenes and inputs from OBS</b>. OBS usually uses port 4455: if yours differs, set the <b>OBS port</b> field. Select <b>Save &amp; start controls</b>, keep the panel open, and bring OBS to the front. You can try the fader before assigning audio.</li></ol>
<h3>Rehearse with two different pictures</h3>
<div class="practice"><div><h3>1 · Cue and hold</h3><p>Note the scene on <b>Program</b>. Turn <b>Scroll</b> one step until <b>Preview</b> shows a different picture. Turn the <b>flat Dial</b> clockwise a few steps. Watch the white handle travel and the pictures blend. Stop halfway and the mix holds.</p></div>
<div><h3>2 · Back out or finish</h3><p>Reverse the Dial to the starting end, or hold <b>Side</b> and press the <b>Dial</b> to cancel. Try again and finish the throw. Preview goes live once. OBS parks its handle at the start. Turn the Dial the opposite way for the return throw.</p></div></div>
<h3 class="subhead">Assign your own sources</h3><p>In <b>Assignments</b>, choose <b>Music / bed</b>, <b>Content / guest</b>, and any mic, media, overlay or D-pad scenes by name. Overlay needs both a scene and an item in it, and so do <b>Layer 1</b> and <b>Layer 2</b>, the two items in your mix scene that the Top grips drive. Unused assignments can stay empty. Stop and restart controls to apply edits. Adjust <b>Ticks per full fade</b> if you want a longer or shorter throw.</p>
<p class="note">The <b>Setup</b> tab shows the last scan. Watch the OBS picture, native slider and mixer for live changes. The panel’s <b>Activity</b> tab reports actions and explains a refused command. For an on-screen assignment card, open <b>General HUD</b> at the top right of TourBox Console. It starts hidden and shows a curated set of controls for the current preset.</p></section>
<section class="sheet mixguide" aria-labelledby="mix-title"><p class="eyebrow">Audio / optional</p><h2 id="mix-title">Ride the whole mix</h2>
<p>Enable <b>All OBS mixer inputs</b> in Setup and restart controls. Hold <b>Side</b> and turn the <b>raised Knob</b> to ride the group. The Tour menu reads its level. Open Tour for <b>Fade whole mix to silence</b> or <b>Restore whole mix</b>. Set the step and fade time in Setup.</p>
<p>Music and Content still have their own controls. The group preserves their relative levels and includes other public mixer inputs. Late arrivals are picked up on the next scan; mute new sources before adding them if they must start silent. A hand-adjusted source stays with the operator. Restore returns the other faders to their saved settings. It affects every track and monitor that uses these inputs; it is not a stream-only master.</p>
<p>For other compatible controllers, start the companion in <b>mix-only</b> mode. It registers no TourBox shortcuts. The Stream Deck, OpenDeck and MIDI controls then share the same group through OBS.</p></section>
<section class="sheet mixguide" id="vj" aria-labelledby="vj-title"><p class="eyebrow">Video / optional</p><h2 id="vj-title">Drive YouTube and the VJ layers</h2>
<p>VJster controls YouTube in Chrome only. A YouTube browser source in OBS cannot be controlled. To show the video in OBS, add a <b>Window Capture</b> of the Chrome window and keep that window open; add an <b>Application Audio Capture</b> of Chrome for its sound.</p>
  <p>Install the free <b>VJster</b> extension in Chrome (from the project page: unzip it and load it unpacked) and play a YouTube video. The extension connects to this companion on your own computer; OBS can be closed. Turn the <b>raised Knob</b> for the speed, press and turn it for 0.05 steps, tap it to read the video, and hold <b>Side</b> and press it to return to 1x. Press and turn <b>Scroll</b> for the quality; <b>Side + D-pad Up</b> plays or pauses. The <b>Tour</b> menu has quality back to Auto.</p>
  <p>With several videos playing, the extension picks the active tab of the focused Chrome window, else the one that started last, so pause the others; the TourBox has no pin. In a YouTube playlist the speed carries to the next video, quality returns to Auto, and there is no next or previous.</p>
<p>In <b>Assignments</b>, set <b>Layer 1</b> and <b>Layer 2</b> to two items in your mix scene, each appearing once in it. Opacity uses a filter on the source, so it also changes that source anywhere else it appears, Program included. Hold <b>Top</b> and turn the <b>Knob</b> to cycle Layer 1’s blend mode, <b>Scroll</b> for Layer 2’s, and the <b>Dial</b> to ride Layer 2’s opacity (through a Color Correction filter, added when the source has none). Tour has both blend modes back to Normal. The <b>Activity</b> tab reads back the video and each layer after every move, since the TourBox has no display.</p></section>
${master}
<section class="sheet" id="recovery" aria-labelledby="ops-title"><p class="eyebrow">Operating notes <span>/</span> 04</p><h2 id="ops-title">At the desk</h2>
<div class="two-col"><div class="example"><h3>Bring a guest in over music</h3><p>Ride the bed with <b>Side + flat Dial</b>. Press <b>C1</b> to duck. Hold <b>Tall</b> and turn the <b>Knob</b> to trim the guest. Press <b>C2</b> to restore the saved bed level. Duck and restore take about 450 ms. An outside mixer move can disarm the saved restore.</p></div>
<div class="example"><h3>Roll a clip and add a lower third</h3><p>With media assigned, press <b>Tour</b> and select <b>Play or pause media</b>; <b>Side + D-pad Up</b> plays or pauses the YouTube video instead. Press <b>Tour</b> and select <b>Show overlay</b> or <b>Hide overlay</b> for the assigned item.</p></div></div>
<h3 class="subhead">If a control feels wrong</h3>
<dl class="problems"><dt>The Knob does nothing to the video</dt><dd>Open <b>Activity</b>: it says whether the VJster extension is connected and on which port. Install the free extension from the project page and keep the YouTube tab open in Chrome: a YouTube browser source in OBS cannot be controlled. With several videos playing, pause the others. If the port is in use by the VJster actions in your Stream Deck or OpenDeck software, remove them from the deck or choose another port in both places.</dd>
<dt>A turn changes the wrong thing</dt><dd>Bring OBS forward and check the active preset in TourBox Console. Select <b>OBS Fadester for TourBox</b> so the Dial controls the scene mix. Release Side or the rotary if you intended a plain turn.</dd>
<dt>Preview moves but the Dial will not mix</dt><dd>Check for two distinct scenes, Studio Mode and Fade. Clear a conflicting Preview scene transition override. Keep the main OBS window open with the T-bar visible. If someone moved the handle, finish or cancel that gesture in OBS, check both scenes, then hold Side and press Dial to reset.</dd>
<dt>A meter, overlay or clip does not respond</dt><dd>Read scenes and inputs again after renaming a source. Check the role under Assignments and restart controls. Short undoes the last supported audio adjustment. Observe the actual mixer if a restore was interrupted.</dd>
<dt>No actions arrive</dt><dd>Open Activity. Check the OBS server, port and password, start one listener, and clear any shortcut conflict it identifies. Focus OBS and press Scroll for a read-only scene check.</dd></dl>
<p class="note">Full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and D-pad. This control reference uses the same map as the shipped preset and control panel. <a href="presets/map.json">Open the bundled shortcut map</a>.</p></section>
<footer><p>OBS Fadester for TourBox · Community preset by Jeffrey Brick · Offline operator guide</p></footer></main></body></html>`;

const outputPath = process.argv[2] || path.join(__dirname, 'dist', 'START-HERE.html');
fs.writeFileSync(outputPath, page, 'utf8');
