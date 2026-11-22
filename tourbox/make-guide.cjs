const fs = require('node:fs');
const path = require('node:path');

const map = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets', 'map.json'), 'utf8'));
// node make-guide.cjs [OUTPUT.html] [VERSION]: build.ps1 passes the version, and the guide's last line shows it.
const guideVersion = /^[0-9A-Za-z.-]+$/.test(process.argv[3] || '') ? ' ' + process.argv[3] : '';
const locales = JSON.parse(fs.readFileSync(path.join(__dirname, 'presets', 'locales.json'), 'utf8'));
const languageNames = {
  de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano', ja: '日本語', ko: '한국어',
  nl: 'Nederlands', 'pt-BR': 'Português (Brasil)', ru: 'Русский', tr: 'Türkçe', 'zh-CN': '简体中文', 'zh-TW': '繁體中文',
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
.pick{display:grid;grid-template-columns:repeat(auto-fit,minmax(10.5rem,1fr));gap:.75rem;margin:1rem 0 1.5rem;padding:0;list-style:none}.pick li{margin:0}.pick a{display:block;text-align:center;padding:.75rem .5rem;border:2px solid #cfe0d5;border-radius:12px;text-decoration:none;color:inherit;background:#fff}.pick a:hover,.pick a:focus-visible{border-color:#236044}.pick svg{display:block;margin:0 auto .4rem;max-width:100%;height:auto}.pick b{display:block}.pick span{font-size:.9em;color:#3d5a4c}
.pick{margin:24px clamp(20px,4vw,58px) 8px}
`;

const master = reference('master', '03', 'Put a scene in Preview with Scroll, mix it onto Program with the flat Dial, and ride the speed of the YouTube video in Chrome with the raised Knob. Hold Side for Music on the Dial; hold Top for the two VJ layers.', 'T-bar left means turn the Dial counterclockwise; T-bar right means clockwise. These names describe the control direction. Clockwise always throws towards Preview, also for the next throw. OBS parks its native handle at the start after a completed throw. During a partial mix, either Tall or Top finishes that mix. From rest, Tall uses the selected transition and Top cuts.');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fadester Companion · Quick guide</title><style>${css}</style></head><body>
<a class="skip" href="#gamepad">Skip to the first steps</a><main>
<header><p class="eyebrow">Quick guide <span>/</span> Windows x64</p><h1>Fadester Companion</h1>
<p>Choose, mix, fade and cut OBS Studio scenes with a game controller or a TourBox.</p></header>
<ul class="pick" aria-label="Which controller do you have?"><li><a href="#gamepad"><svg viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">
<path d="M30 30 Q42 18 62 22 L98 22 Q118 18 130 30 Q152 58 146 80 Q140 94 126 88 L108 70 L52 70 L34 88 Q20 94 14 80 Q8 58 30 30 Z" fill="#eef4ef" stroke="#236044" stroke-width="3"/>
<rect x="34" y="12" width="22" height="8" rx="4" fill="#e9a84a" stroke="#236044" stroke-width="2"/><rect x="104" y="12" width="22" height="8" rx="4" fill="#e9a84a" stroke="#236044" stroke-width="2"/>
<circle cx="50" cy="42" r="9" fill="#fff" stroke="#236044" stroke-width="2.5"/><circle cx="96" cy="58" r="9" fill="#fff" stroke="#236044" stroke-width="2.5"/>
<path d="M60 52 h6 v-6 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 z" fill="#507363"/>
<circle cx="114" cy="34" r="4.5" fill="#507363"/><circle cx="114" cy="50" r="4.5" fill="#507363"/><circle cx="106" cy="42" r="4.5" fill="#507363"/><circle cx="122" cy="42" r="4.5" fill="#507363"/></svg><b>Game controller</b><span>Xbox or other XInput</span></a></li><li><a href="#surface"><svg viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">
<path d="M22 20 Q26 8 44 8 L118 8 Q140 8 146 26 L150 70 Q150 92 128 92 L40 92 Q14 92 12 66 Z" fill="#eef4ef" stroke="#236044" stroke-width="3"/>
<circle cx="46" cy="64" r="20" fill="#fff" stroke="#236044" stroke-width="3"/><circle cx="46" cy="64" r="13" fill="none" stroke="#507363" stroke-width="1.5" stroke-dasharray="3 3"/>
<circle cx="92" cy="44" r="12" fill="#e9a84a" stroke="#236044" stroke-width="2.5"/>
<rect x="30" y="16" width="12" height="26" rx="6" fill="#fff" stroke="#236044" stroke-width="2.5"/>
<rect x="112" y="20" width="22" height="10" rx="4" fill="#507363"/><rect x="118" y="38" width="20" height="16" rx="5" fill="#507363"/><rect x="118" y="60" width="20" height="10" rx="4" fill="#507363"/>
<path d="M86 74 h6 v-6 h6 v6 h6 v6 h-6 v6 h-6 v-6 h-6 z" fill="#507363"/></svg><b>TourBox</b><span>Elite, NEO, Elite Plus</span></a></li><li><a href="#midi"><svg viewBox="0 0 160 100" width="160" height="100" aria-hidden="true" focusable="false">
<rect x="6" y="6" width="148" height="88" rx="8" fill="#eef4ef" stroke="#236044" stroke-width="3"/><rect x="18" y="14" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><rect x="33" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="48" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="63" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="78" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="93" y="14" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><rect x="108" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="123" y="14" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="18" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="33" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="48" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="63" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="78" y="24" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><rect x="93" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="108" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="123" y="24" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="18" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="33" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="48" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="63" y="34" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><rect x="78" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="93" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="108" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="123" y="34" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="18" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="33" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="48" y="44" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><rect x="63" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="78" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="93" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="108" y="44" width="11" height="7" rx="1.5" fill="#fff" stroke="#507363" stroke-width="1.2"/><rect x="123" y="44" width="11" height="7" rx="1.5" fill="#e9a84a" stroke="#507363" stroke-width="1.2"/><line x1="23" y1="60" x2="23" y2="84" stroke="#507363" stroke-width="2"/><rect x="18" y="66" width="10" height="5" rx="1" fill="#236044"/><line x1="38" y1="60" x2="38" y2="84" stroke="#507363" stroke-width="2"/><rect x="33" y="73" width="10" height="5" rx="1" fill="#236044"/><line x1="53" y1="60" x2="53" y2="84" stroke="#507363" stroke-width="2"/><rect x="48" y="66" width="10" height="5" rx="1" fill="#236044"/><line x1="68" y1="60" x2="68" y2="84" stroke="#507363" stroke-width="2"/><rect x="63" y="73" width="10" height="5" rx="1" fill="#236044"/><line x1="83" y1="60" x2="83" y2="84" stroke="#507363" stroke-width="2"/><rect x="78" y="66" width="10" height="5" rx="1" fill="#236044"/><line x1="98" y1="60" x2="98" y2="84" stroke="#507363" stroke-width="2"/><rect x="93" y="73" width="10" height="5" rx="1" fill="#236044"/><line x1="113" y1="60" x2="113" y2="84" stroke="#507363" stroke-width="2"/><rect x="108" y="66" width="10" height="5" rx="1" fill="#236044"/><line x1="128" y1="60" x2="128" y2="84" stroke="#507363" stroke-width="2"/><rect x="123" y="73" width="10" height="5" rx="1" fill="#236044"/>
<line x1="140" y1="16" x2="140" y2="84" stroke="#507363" stroke-width="2"/><rect x="134" y="44" width="12" height="6" rx="1" fill="#236044"/>
<line x1="70" y1="90" x2="100" y2="90" stroke="#507363" stroke-width="2"/><rect x="82" y="86" width="6" height="8" rx="1" fill="#e9a84a" stroke="#236044" stroke-width="1"/></svg><b>MIDI controller</b><span>APC40 mkII and others</span></a></li></ul>
<nav aria-label="Guide sections"><a href="#gamepad">Game controller</a><a href="#midi">MIDI controller</a><a href="#surface">TourBox layout</a><a href="#setup">First minute</a><a href="#master">All controls</a><a href="#vj">YouTube and VJ layers</a><a href="#recovery">At the desk</a></nav>
<nav aria-label="Quick starts in other languages">${languageLinks}</nav>
<section class="sheet" id="gamepad" aria-labelledby="gamepad-title"><p class="eyebrow">Game controller</p><h2 id="gamepad-title">Start with a game controller</h2>
<ol class="step-list">
<li>Open OBS. In <b>Tools → WebSocket Server Settings</b>, turn on <b>Enable WebSocket server</b> and keep authentication on. Then open <b>Fadester Companion</b> from the Start menu: it connects by itself, and its window says what to do if it cannot. The T-bar needs OBS 33, with the main OBS window open and its T-bar visible.</li>
<li>On the <b>Setup</b> tab, tick <b>Use an Xbox or XInput game controller</b> and keep <b>Easy mode</b> ticked. The controls start by themselves the first time, without the controller: click <b>Stop</b> and then <b>Start</b>, at the bottom left of the window, so they start again with it (or click <b>Use it</b> beside the <b>Controller</b> light at the top). You can skip the preset import. Closing the window does not stop the controls: Fadester Companion stays in the notification area beside the clock, and <b>Quit Fadester Companion</b> in that icon's right-click menu stops them.</li>
<li>Turn on <b>Studio Mode</b>: when it is off, the <b>OBS</b> light at the top of the Fadester Companion window says so and has a <b>Turn on</b> button. Keep a <b>Fade</b> among OBS's scene transitions. Press D-pad down to put the next scene in OBS's list in Preview, D-pad up for the one above.</li>
<li>Pull the right trigger: OBS's T-bar follows, and pulling it all the way puts Preview on Program. Or hold <b>A</b>: after 0.15 s the T-bar moves while you hold it and Preview is on Program at the end. Let go to leave it part-way; hold A again to carry on.</li>
<li><b>B</b> cuts, <b>View</b> goes back to Program, the left trigger ducks Music while you hold it, and D-pad left and right ride Music. Change any button on the <b>Game controller</b> tab.</li></ol>
<p class="note">Every control, easy mode and the safety rules: <a href="https://github.com/jbrick2070/streamdeck-fadester/blob/main/docs/gamepad/README.md">the game controller guide</a>.</p></section>
<section class="sheet" id="midi" aria-labelledby="midi-title"><p class="eyebrow">MIDI controller</p><h2 id="midi-title">Got an APC40 mkII or another MIDI controller?</h2>
<p>A MIDI controller is run by <b>Midi Fadester</b>, a free plugin inside OBS, not by Fadester Companion. Install Midi Fadester, plug in the controller and open <b>Tools → Midi Fadester</b> in OBS.</p>
<ul>
<li><b>Akai APC40 mkII:</b> it sets itself up the first time. The crossfader fades Preview onto Program, faders 1 to 8 follow the layers of the scene on air, and the <b>Fadester Desk</b> dock shows the whole desk on screen.</li>
<li><b>Akai APC mini mk2, Akai MIDImix, Korg nanoKONTROL2 and Novation Launch Control XL:</b> each gets a ready-made layout when you pick its port under <b>Change controller</b>. These are marked Beta: they have not been checked on a real desk yet.</li>
<li><b>Any other MIDI controller:</b> it gets the Generic layout. Give each of the 18 strips a job with <b>Set up</b>, then press <b>Learn</b> and move a fader or knob to choose which one drives it.</li>
</ul>
<p class="note">Every desk, layout and setting: <a href="https://github.com/jbrick2070/midi-fadester#readme">the Midi Fadester guide</a>.</p></section>
<section class="sheet" id="surface" aria-labelledby="surface-heading"><p class="eyebrow">Orientation <span>/</span> 01</p>
<h2 id="surface-heading">Find the controls by touch</h2>
<div class="surface"><figure>${surfaceDiagram()}<figcaption>Full-size TourBox, top view. The small Tour button sits between the flat Dial and the raised Knob.</figcaption></figure>
<dl class="roles"><dt>Scroll wheel · choose the shot</dt><dd>Turn to browse Preview. Press to read the Program and Preview names.</dd>
<dt>Flat Dial · mix the shot</dt><dd>The large, low wheel at lower left drives the native T-bar between the two OBS panes. Stop turning to hold a blend.</dd>
<dt>Raised Knob · ride the video</dt><dd>The smaller central Knob changes the speed of the YouTube video playing in Chrome, through the free VJster extension. Press it to play or pause the video; tap Side (or hold Side and press the Knob) to return to 1x, or hold Side and press D-pad Up to read the video’s title, speed and quality. Music is on Side + Dial.</dd></dl></div>
<h3 class="subhead">Three gestures on the same control</h3>
<p><strong>Turn</strong> for a normal step. <strong>Press and release</strong> for the tap action. <strong>Press and keep the rotary down as you turn</strong> for its second action. The Dial moves in quarter steps this way, the Knob in 0.05 speed steps. Pressing and turning Scroll steps through the video’s quality levels.</p>
<h3 class="subhead">Hold one modifier for another control</h3>
<p><b>Side</b> gives whole-mix level on the Knob, media on Scroll and Music on the Dial. <b>Tall</b> gives Content, transition type and fine fade. <b>Short</b> gives fine Music, Preview and fine fade. <b>Top</b> gives the VJ layers: Layer 1’s blend mode on the Knob, Layer 2’s blend mode on Scroll and Layer 2’s opacity on the Dial. The complete gesture tables below include these alternate grips and the direct production buttons.</p>
<p>The bare <b>Side, Tall, Short and Top</b> buttons use Console’s <b>UP</b> mode, so their individual actions run on release: a tap on Side returns the video to 1x, a tap on Short reads the recording status, Tall sends Preview to Program and Top cuts. Hold the modifier before operating the second control. These combinations need a physical hold/release check on the actual device; follow the <a href="source/tourbox/REHEARSAL.md">master rehearsal checks</a>. <a href="https://www.tourboxtech.com/en/news/up-mode-and-rep-mode.html">TourBox UP mode instructions</a>.</p>
<p class="rule"><strong>Tour and Side + Tour.</strong> Both open the same menu at the pointer. Scroll to a choice and press <b>Tall</b> to run it. Press <b>Short</b> to dismiss. Transition type and timing, overlays and capture tools are available in this menu.</p>
</section>
<section class="sheet" id="setup" aria-labelledby="setup-title"><p class="eyebrow">Setup and rehearsal <span>/</span> 02</p><h2 id="setup-title">Your first minute at the desk</h2>
<h3>Set up once</h3><ol class="step-list">
<li>Open <strong>Fadester Companion</strong> from the Start menu. If you use the ZIP, extract all of it and open <strong>Fadester Companion.exe</strong>. Keep its files together.</li>
<li>Open OBS. In TourBox Console, use <b>Import</b> beside <b>Preset List</b> to add <b>OBS Fadester for TourBox.tb</b> from <b>presets</b>. Turn <b>Auto Switch</b> off and select <b>OBS Fadester for TourBox</b>: one preset then works whichever application is in front (OBS, Chrome or anything else). Only if you keep Auto Switch on, link the preset to <b>obs64</b>, and to Google Chrome too to control videos with Chrome in front. For later updates, select this preset and use its own menu’s <b>Import</b> to replace its contents.</li>
<li>In OBS, enable <b>Tools → WebSocket Server Settings</b> with authentication. Turn on <b>Studio Mode</b>, keep a <b>Fade</b> among OBS's scene transitions, and keep the main OBS window and its T-bar visible. The manual control targets OBS 33.</li>
<li>Fadester Companion reads OBS's port and password from OBS and starts the controls by itself. When the <b>Controls</b> light at the top of its window is green, the TourBox works; if it says <b>off</b>, click <b>Start</b> beside it. You can try the fader before assigning audio. Closing the window does not stop the controls: the app stays in the notification area beside the clock.</li></ol>
<h3>Rehearse with two different pictures</h3>
<div class="practice"><div><h3>1 · Preview and hold</h3><p>Note the scene on <b>Program</b>. Turn <b>Scroll</b> one step until <b>Preview</b> shows a different picture. Turn the <b>flat Dial</b> clockwise a few steps. Watch the white handle travel and the pictures blend. Stop halfway and the mix holds.</p></div>
<div><h3>2 · Back out or finish</h3><p>Reverse the Dial to the starting end, or hold <b>Side</b> and press the <b>Dial</b> to cancel. Try again and finish the throw. Preview goes live once. OBS parks its handle at the start. Pause a moment, then turn the Dial clockwise again for the next throw: clockwise always moves the T-bar towards Preview, and clicks right after a finished throw are ignored as overshoot.</p></div></div>
<h3 class="subhead">Assign your own sources</h3><p>In <b>Assignments</b>, choose <b>Music / bed</b>, <b>Content / guest</b>, and any mic, media, overlay or D-pad scenes by name. A D-pad anchor nobody chose uses the scene at that place in OBS's scene list (anchor 1 = the first scene). Overlay needs both a scene and an item in it, and so do <b>Layer 1</b> and <b>Layer 2</b>, the two items in your mix scene that the Top grips drive; layers nobody chose fill themselves in from the live scene the first time you use a Top grip. Unused assignments can stay empty. <b>Save</b> applies assignments, inputs, anchors and steps at once while the controls run; the port, VJster, game controller, mixer mode and fade step still need Stop and Start. Adjust <b>Ticks per full fade</b> if you want a longer or shorter throw.</p>
<p class="note">The <b>Setup</b> tab shows the last scan. Watch the OBS picture, native slider and mixer for live changes. The <b>Activity</b> tab reports actions and explains a refused command. For an on-screen assignment card, open <b>General HUD</b> at the top right of TourBox Console. It starts hidden and shows a curated set of controls for the current preset.</p></section>
<section class="sheet mixguide" aria-labelledby="mix-title"><p class="eyebrow">Audio / optional</p><h2 id="mix-title">Ride the whole mix</h2>
<p>Enable <b>All OBS mixer inputs</b> in Setup, then click <b>Stop</b> and <b>Start</b>. Hold <b>Side</b> and turn the <b>raised Knob</b> to ride the group. The Tour menu reads its level. Open Tour for <b>Fade whole mix to silence</b> or <b>Restore whole mix</b>. Set the step and fade time in Setup.</p>
<p>Music and Content still have their own controls. The group preserves their relative levels and includes other public mixer inputs. Late arrivals are picked up on the next scan; mute new sources before adding them if they must start silent. A hand-adjusted source stays with the operator. <b>Restore mix</b> (<b>Restore whole mix</b> in Tour) returns the other faders to their saved settings. It affects every track and monitor that uses these inputs; it is not a stream-only master.</p>
<p>For other compatible controllers only, tick <b>Use only Stream Deck, OpenDeck or MIDI (no TourBox, no game controller, no VJster)</b> in Setup. Fadester Companion then registers no TourBox shortcuts and leaves the game controller and VJster off. The Stream Deck, OpenDeck and MIDI controls share the same group through OBS.</p></section>
<section class="sheet mixguide" id="vj" aria-labelledby="vj-title"><p class="eyebrow">Video / optional</p><h2 id="vj-title">Drive YouTube and the VJ layers</h2>
<p>To control a YouTube video directly in OBS, enter it under <b>Setup</b>, click <b>Copy OBS Browser Source URL</b> and paste the address into a browser source in OBS. The other way is to play it in Chrome: add a <b>Window Capture</b> of the Chrome window and keep that window open; add an <b>Application Audio Capture</b> of Chrome for its sound.</p>
  <p>Install the free <b>VJster</b> extension in Chrome from the <a href="https://chromewebstore.google.com/detail/daohboebokfmamkblejcpbblfnaijgnb">Chrome Web Store</a> and play a YouTube video. The extension connects to Fadester Companion on your own computer; OBS can be closed. Turn the <b>raised Knob</b> for the speed, press and turn it for 0.05 steps, tap it to read the video, and tap <b>Side</b> (or hold Side and press the Knob) to return to 1x. Press and turn <b>Scroll</b> for the quality; <b>Side + D-pad Up</b> plays or pauses. The <b>Tour</b> menu has quality back to Auto.</p>
  <p>With several videos playing, the extension picks the active tab of the focused Chrome window, else the one that started last, so pause the others; the TourBox has no pin. In a YouTube playlist the speed carries to the next video, quality returns to Auto, and there is no next or previous.</p>
<p>In <b>Assignments</b>, set <b>Layer 1</b> and <b>Layer 2</b> to two items in your mix scene, each appearing once in it. Left empty, they fill themselves in from the live scene the first time you use a layer control (Layer 1 = the topmost visible picture, Layer 2 = the next one down; sound-only and hidden sources are skipped) and are saved to the Assignments tab. Opacity uses a filter on the source, so it also changes that source anywhere else it appears, Program included. Hold <b>Top</b> and turn the <b>Knob</b> to cycle Layer 1’s blend mode, <b>Scroll</b> for Layer 2’s, and the <b>Dial</b> to ride Layer 2’s opacity (through a Color Correction filter, added when the source has none). Tour has both blend modes back to Normal. The <b>Activity</b> tab reads back the video and each layer after every move, since the TourBox has no display.</p></section>
${master}
<section class="sheet" id="recovery" aria-labelledby="ops-title"><p class="eyebrow">Operating notes <span>/</span> 04</p><h2 id="ops-title">At the desk</h2>
<div class="two-col"><div class="example"><h3>Bring a guest in over music</h3><p>Ride the bed with <b>Side + flat Dial</b>. Press <b>C1</b> to duck. Hold <b>Tall</b> and turn the <b>Knob</b> to trim the guest. Press <b>C2</b> to restore the saved bed level. Duck and restore last about 450 ms. An outside mixer move can disarm the saved restore.</p></div>
<div class="example"><h3>Roll a clip and add a lower third</h3><p>With media assigned, press <b>Tour</b> and select <b>Play or pause media</b>; <b>Side + D-pad Up</b> plays or pauses the YouTube video instead. Press <b>Tour</b> and select <b>Show overlay</b> or <b>Hide overlay</b> for the assigned item.</p></div></div>
<h3 class="subhead">If a control feels wrong</h3>
<dl class="problems"><dt>The Knob does nothing to the video</dt><dd>Open <b>Activity</b>: it says whether the VJster extension is connected and on which port. Install the free extension from the project page and keep the YouTube tab open in Chrome: a YouTube browser source in OBS cannot be controlled. With several videos playing, pause the others. If the port is in use by the VJster actions in your Stream Deck or OpenDeck software, remove them from the deck or choose another port in both places.</dd>
<dt>A turn changes the wrong thing</dt><dd>Check the active preset in TourBox Console. Select <b>OBS Fadester for TourBox</b> so the Dial controls the scene mix; with Auto Switch on, bring OBS forward or turn Auto Switch off. Release Side or the rotary if you intended a plain turn.</dd>
<dt>Preview moves but the Dial will not mix</dt><dd>Check for two distinct scenes, Studio Mode and a Fade among OBS's scene transitions; the Dial mixes with it even while Cut is selected. Clear a conflicting Preview scene transition override. Keep the main OBS window open with the T-bar visible. If someone moved the handle, finish or cancel that gesture in OBS, check both scenes, then hold Side and press Dial to reset.</dd>
<dt>A meter, overlay or clip does not respond</dt><dd>Read scenes and inputs again after renaming a source. Check the role under Assignments and click Save. <b>Undo last audio change</b> in the Tour menu undoes the last supported audio adjustment. Observe the actual mixer if a restore was interrupted.</dd>
<dt>No actions arrive</dt><dd>Open Activity. Check the OBS server, port and password, start one listener, and clear any shortcut conflict it identifies. Focus OBS and press Scroll for a read-only scene check.</dd></dl>
<p class="note">Full-size desktop TourBox with three pushable rotaries, Side, Tour, C1/C2 and D-pad. This control reference uses the same map as the shipped preset and the <b>Control map</b> tab.</p></section>
<footer><p>Fadester Companion${guideVersion} · Community project by Jeffrey Brick · Offline quick guide</p></footer></main></body></html>`;

const outputPath = process.argv[2] || path.join(__dirname, 'dist', 'START-HERE.html');
fs.writeFileSync(outputPath, page, 'utf8');
