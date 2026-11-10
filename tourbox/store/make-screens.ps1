# SPDX-License-Identifier: GPL-2.0-or-later
# Frames the panel captures from capture-panel.ps1 into 1920x1080 Store screenshots: the window at its own size
# (sharp, never stretched) on the right, a caption on the left. Writes listing\Screenshot-<n>.png.
#   .\make-screens.ps1 -Captures <folder with panel-1.png ... panel-5.png>
param([Parameter(Mandatory)][string]$Captures)
$ErrorActionPreference = 'Stop'
$Captures = (Resolve-Path -LiteralPath $Captures).Path # before Set-Location, so a relative path means where you are
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.Drawing
$screens = @(
  @{ Panel = 3; Title = @('Your game controller,', 'now a vision mixer'); Lines = @(
      'The right trigger is a real T-bar.', 'Hold A to push the mix, let go to park it.',
      'D-pad up and down walk your scenes.', 'Set every button, with a second layer on LB.') },
  @{ Panel = 1; Title = @('Connected', 'in a minute'); Lines = @(
      "Turn on OBS Studio's WebSocket server,", 'read your scenes, and start the controls.',
      'Your password stays on this computer.') },
  @{ Panel = 2; Title = @('Music, media', 'and layers'); Lines = @(
      'Pick the sources to ride: duck the music', 'with the left trigger, step a playlist,',
      'blend two VJ layers.') },
  @{ Panel = 4; Title = @('Got a TourBox?', "It's in too."); Lines = @(
      'The same companion runs a TourBox:', 'the Dial is your T-bar, Scroll cues scenes,',
      'the Knob sets the video speed in VJster.') }
)
function DataUri($file) { 'data:image/png;base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) }
$logo = DataUri (Join-Path $PSScriptRoot 'assets\Square150x150Logo.scale-200.png')
$work = Join-Path ([IO.Path]::GetTempPath()) ('fadester-screens-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $n = 0
  foreach ($s in $screens) {
    $n++
    $capture = Join-Path $Captures "panel-$($s.Panel).png"
    $image = [Drawing.Image]::FromFile($capture); $w = $image.Width; $h = $image.Height; $image.Dispose()
    $x = 1920 - 110 - $w; $y = [int]((1080 - $h) / 2)
    $title = ($s.Title | ForEach-Object -Begin { $i = 0 } -Process {
        "<text x='110' y='$(330 + 78 * $i)' font-size='68' font-weight='700' fill='#FFFFFF'>$([Security.SecurityElement]::Escape($_))</text>"; $i++ }) -join ''
    $top = 330 + 78 * $s.Title.Count + 40
    $lines = ($s.Lines | ForEach-Object -Begin { $i = 0 } -Process {
        "<text x='110' y='$($top + 52 * $i)' font-size='34' fill='#A9B4D6'>$([Security.SecurityElement]::Escape($_))</text>"; $i++ }) -join ''
    $svg = @"
<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 1920 1080' width='1920' height='1080'>
  <defs>
    <linearGradient id='bg' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='#151E3A'/><stop offset='1' stop-color='#070B16'/></linearGradient>
    <filter id='shadow' x='-10%' y='-10%' width='120%' height='120%'><feDropShadow dx='0' dy='18' stdDeviation='22' flood-color='#000000' flood-opacity='0.55'/></filter>
  </defs>
  <rect width='1920' height='1080' fill='url(#bg)'/>
  <image x='110' y='150' width='96' height='96' href='$logo'/>
  <text x='226' y='212' font-family='Segoe UI Variable Display, Segoe UI, sans-serif' font-size='34' font-weight='600' fill='#F97316'>Fadester Companion</text>
  <g font-family='Segoe UI Variable Display, Segoe UI, sans-serif'>$title$lines</g>
  <rect x='$x' y='$y' width='$w' height='$h' rx='8' fill='#0B1020' filter='url(#shadow)'/>
  <image x='$x' y='$y' width='$w' height='$h' href='$(DataUri $capture)'/>
</svg>
"@
    $file = Join-Path $work "screen-$n.svg"
    [IO.File]::WriteAllText($file, $svg, (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $PSScriptRoot 'render.ps1') -Svg $file -Width 1920 -Height 1080 -Out "listing\Screenshot-$n.png"
  }
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
