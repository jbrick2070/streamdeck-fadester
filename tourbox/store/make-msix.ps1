# SPDX-License-Identifier: GPL-2.0-or-later
# Builds the Microsoft Store package (MSIX) of the companion as Fadester Companion from a finished tourbox\build.ps1
# build. The package is unsigned: the Store signs it after certification. For a local try, -Register registers the
# unpacked layout with Windows instead (needs Developer Mode; remove it again with Remove-AppxPackage).
# The Store refuses a second package with the same version and different contents, even within one draft:
# raise -Version for every package you upload (0.1.1.0 was the first one submitted). An existing package of the same
# version is never replaced unless -Overwrite is given. Only a build that build.ps1 finished (build-complete.txt beside
# its 'Fadester for TourBox' folder) is used; a folder extracted from a release ZIP is refused.
#   .\make-msix.ps1 [-Build "...\dist\build-...\Fadester for TourBox"] [-Version 0.1.1.0] [-Register] [-Overwrite]
param([string]$Build, [string]$Version = '0.1.1.0', [string]$OutDir = (Join-Path $PSScriptRoot '..\dist'), [switch]$Register, [switch]$Overwrite)
$ErrorActionPreference = 'Stop'
# The Store wants Major.Minor.Build with the fourth number 0.
if ($Version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}\.0$' -or ($Version.Split('.') | Where-Object { [int]$_ -gt 65535 })) {
  throw "Version must look like 0.1.0.0 (each number up to 65535, the last 0), not $Version."
}
if (-not $Build) {
  $newest = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\dist') -Directory -Filter 'build-*' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $newest) { throw 'No build found: run tourbox\build.ps1 first, or pass -Build.' }
  $Build = Join-Path $newest.FullName 'Fadester for TourBox'
}
$Build = (Resolve-Path -LiteralPath $Build).Path
# build.ps1 writes this beside the bundle as its very last step; a run that failed part-way leaves a stage without it.
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $Build) 'build-complete.txt') -PathType Leaf)) {
  throw "$Build is not from a finished tourbox\build.ps1 run: its build folder has no build-complete.txt. Run tourbox\build.ps1, then run this script again without -Build (it takes the newest build in tourbox\dist), or pass the 'Fadester for TourBox' folder of that build. A folder extracted from a release ZIP is refused, because it has no build-complete.txt."
}
foreach ($need in 'Fadester for TourBox.exe', 'FadesterTourBoxBridge.exe', 'FadesterNativeSlider.exe', 'presets\gamepad.json') {
  if (-not (Test-Path -LiteralPath (Join-Path $Build $need))) { throw "$Build has no $need." }
}
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'x64\makeappx.exe') } |
  Sort-Object { [version]$_.Name } -Descending | Select-Object -First 1
if (-not $sdk) { throw 'The Windows SDK (makeappx.exe, makepri.exe) is needed.' }
$makeappx = Join-Path $sdk.FullName 'x64\makeappx.exe'; $makepri = Join-Path $sdk.FullName 'x64\makepri.exe'

$out = [IO.Path]::GetFullPath($OutDir)
New-Item -ItemType Directory -Force -Path $out | Out-Null
$msix = Join-Path $out "FadesterCompanion_${Version}_x64.msix"
# The Store refuses a second package with the same version, so an existing one is usually the one already uploaded.
if ((Test-Path -LiteralPath $msix) -and -not $Overwrite) {
  throw "$msix already exists. Raise -Version for a new upload, or pass -Overwrite to replace it."
}
$layout = Join-Path $out "msix-layout-$Version"
# The layout is this script's own output; a registered copy must not be in use while it is replaced.
if (Test-Path -LiteralPath $layout) {
  # Never delete through a link: only a plain folder this script made is removed.
  if ((Get-Item -LiteralPath $layout -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "$layout is a link, not this script's folder. Remove it by hand." }
  if (Get-AppxPackage -Name 'Fluxxuuss.FadesterCompanion' | Where-Object { $_.InstallLocation -eq $layout }) {
    throw "$layout is registered with Windows. Remove it first: Get-AppxPackage Fluxxuuss.FadesterCompanion | Remove-AppxPackage"
  }
  Remove-Item -LiteralPath $layout -Recurse -Force
}
New-Item -ItemType Directory -Path $layout | Out-Null
Copy-Item -Path (Join-Path $Build '*') -Destination $layout -Recurse
New-Item -ItemType Directory -Path (Join-Path $layout 'Assets') | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'assets\*.png') -Destination (Join-Path $layout 'Assets')
$manifest = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'AppxManifest.xml')).Replace('$VERSION$', $Version)
[IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object Text.UTF8Encoding($false)))

# resources.pri lets Windows pick the right logo size (scale-200, targetsize-24 and so on).
$priconfig = Join-Path $out "priconfig-$Version.xml"
& $makepri createconfig /cf $priconfig /dq en-US /pv 10.0.0 /o | Out-Null
if ($LASTEXITCODE) { throw 'makepri createconfig failed.' }
# One resources.pri: the default config splits scales and languages into resources.scale-*.pri and
# resources.language-*.pri, which only an app bundle uses; a single .msix would lose its larger logos.
[xml]$pri = [IO.File]::ReadAllText($priconfig)
foreach ($node in @($pri.SelectNodes('//packaging'))) { [void]$node.ParentNode.RemoveChild($node) }
$pri.Save($priconfig)
& $makepri new /pr $layout /cf $priconfig /mn (Join-Path $layout 'AppxManifest.xml') /of (Join-Path $layout 'resources.pri') /o | Out-Null
if ($LASTEXITCODE) { throw 'makepri new failed.' }
Remove-Item -LiteralPath $priconfig -Force
$extra = Get-ChildItem -LiteralPath $layout -Filter '*.pri' | Where-Object Name -ne 'resources.pri'
if ($extra) { throw "makepri split the resources ($($extra.Name -join ', ')); the package needs one resources.pri." }

& $makeappx pack /d $layout /p $msix /o /h SHA256 | Out-Null
if ($LASTEXITCODE) { throw 'makeappx pack failed (run it by hand to see why).' }
Write-Host "Package: $msix ($([math]::Round((Get-Item $msix).Length / 1MB, 1)) MB)"
Write-Host "Layout:  $layout"
if ($Register) {
  Add-AppxPackage -Register (Join-Path $layout 'AppxManifest.xml')
  $pkg = Get-AppxPackage -Name 'Fluxxuuss.FadesterCompanion'
  Write-Host "Registered $($pkg.PackageFullName). Start it from the Start menu (Fadester Companion), or: explorer.exe shell:AppsFolder\$($pkg.PackageFamilyName)!App"
}
