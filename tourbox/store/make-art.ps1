# SPDX-License-Identifier: GPL-2.0-or-later
# Renders every Store and package image from the SVGs in this folder (needs Chrome or Edge; see render.ps1):
#   listing\  the Store listing's app tile icon and poster art, uploaded by hand in Partner Center
#   assets\   the MSIX package's logos, with the scale and target-size names Windows looks for
#   ..\panel\fadester.ico  the companion's own icon (PNG frames, Windows Vista or later)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function Render($svg, $w, $h, $out) { & (Join-Path $PSScriptRoot 'render.ps1') -Svg $svg -Width $w -Height $h -Out $out }

Render 'icon.svg' 300 300 'listing\AppTileIcon-300.png'
Render 'poster.svg' 1440 2160 'listing\PosterArt-1440x2160.png'

foreach ($s in @(@{ q = 'scale-100'; px = 44 }, @{ q = 'scale-200'; px = 88 }, @{ q = 'scale-400'; px = 176 })) {
  Render 'app-icon.svg' $s.px $s.px "assets\Square44x44Logo.$($s.q).png"
}
foreach ($t in 16, 24, 32, 48, 256) {
  $svg = if ($t -le 32) { 'app-icon-small.svg' } else { 'app-icon.svg' }
  Render $svg $t $t "assets\Square44x44Logo.targetsize-$t.png"
  Copy-Item "assets\Square44x44Logo.targetsize-$t.png" "assets\Square44x44Logo.targetsize-${t}_altform-unplated.png" -Force
}
Render 'app-icon.svg' 150 150 'assets\Square150x150Logo.scale-100.png'
Render 'app-icon.svg' 300 300 'assets\Square150x150Logo.scale-200.png'
Render 'app-icon.svg' 50 50 'assets\StoreLogo.scale-100.png'
Render 'app-icon.svg' 100 100 'assets\StoreLogo.scale-200.png'

# The icon file: one PNG frame per size.
$frames = foreach ($size in 16, 24, 32, 48, 64, 128, 256) {
  $svg = if ($size -le 32) { 'app-icon-small.svg' } else { 'app-icon.svg' }
  $png = Join-Path ([IO.Path]::GetTempPath()) "fadester-ico-$size-$([guid]::NewGuid().ToString('N')).png"
  try {
    Render $svg $size $size $png
    [pscustomobject]@{ Size = $size; Bytes = [IO.File]::ReadAllBytes($png) }
  }
  finally { Remove-Item -LiteralPath $png -Force -ErrorAction SilentlyContinue }
}
$stream = New-Object IO.MemoryStream
$writer = New-Object IO.BinaryWriter($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$frames.Count)
$offset = 6 + 16 * $frames.Count
foreach ($f in $frames) {
  $edge = if ($f.Size -ge 256) { 0 } else { $f.Size }
  $writer.Write([byte]$edge); $writer.Write([byte]$edge); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$f.Bytes.Length); $writer.Write([uint32]$offset)
  $offset += $f.Bytes.Length
}
foreach ($f in $frames) { $writer.Write($f.Bytes) }
$writer.Flush()
[IO.File]::WriteAllBytes((Join-Path $PSScriptRoot '..\panel\fadester.ico'), $stream.ToArray())
Write-Host 'Wrote ..\panel\fadester.ico'
