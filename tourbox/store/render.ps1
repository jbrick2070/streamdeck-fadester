# SPDX-License-Identifier: GPL-2.0-or-later
# Renders one of the Store art SVGs in this folder to a PNG of an exact size with headless Chrome or Edge.
#   .\render.ps1 -Svg icon.svg -Width 300 -Height 300 -Out out\StoreTile-300.png
param(
  [Parameter(Mandatory)][string]$Svg,
  [Parameter(Mandatory)][int]$Width,
  [Parameter(Mandatory)][int]$Height,
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { throw 'Chrome or Edge is needed to render the Store art.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('fadester-store-render-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
  $svgUri = ([Uri](Resolve-Path -LiteralPath $Svg).Path).AbsoluteUri
  $page = Join-Path $work 'page.html'
  $html = "<!doctype html><html><body style=""margin:0;background:transparent""><img src=""$svgUri"" style=""display:block;width:${Width}px;height:${Height}px""></body></html>"
  [IO.File]::WriteAllText($page, $html, (New-Object Text.UTF8Encoding($false)))
  # Relative to PowerShell's location (Set-Location), not the process's working folder.
  $target = if ([IO.Path]::IsPathRooted($Out)) { $Out } else { Join-Path (Get-Location).Path $Out }
  $target = [IO.Path]::GetFullPath($target)
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  # Windows PowerShell joins ArgumentList with spaces and quotes nothing: quote the paths, which may contain spaces.
  $arguments = @('--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--default-background-color=00000000',
    '--force-device-scale-factor=1', "--user-data-dir=""$work\profile""", "--window-size=$Width,$Height", "--screenshot=""$target""",
    ([Uri]$page).AbsoluteUri)
  Start-Process -FilePath $browser -ArgumentList $arguments -Wait -WindowStyle Hidden
  if (-not (Test-Path $target)) { throw "The browser did not write $target." }
  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($target)
  try { if ($image.Width -ne $Width -or $image.Height -ne $Height) { throw "Rendered $($image.Width)x$($image.Height), wanted ${Width}x$Height." } }
  finally { $image.Dispose() }
  Write-Host "Wrote $target (${Width}x$Height)"
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
