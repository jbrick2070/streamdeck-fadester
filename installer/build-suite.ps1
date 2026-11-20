# Builds the Fadester Suite Setup for Windows x64.
#
#   .\installer\build-suite.ps1 -CompanionBuild "<...>\build-<id>\Fadester Companion" [-OutDir dist] [-Manifest components.json]
#                               [-LocalArtifacts <folder>] [-Candidate <folder>] [-DownloadOnly] [-Define NAME=VALUE ...]
#
# 1. Every pinned input in components.json is taken from -LocalArtifacts (when a file of that name is there) or
#    downloaded, then checked against its SHA-256. Any mismatch stops the build before anything is compiled.
# 2. The Fadester Companion must come from a finished tourbox\build.ps1 run (build-complete.txt beside its folder).
#    It is wrapped in its own installer (FadesterCompanion.iss) with its own uninstall entry.
#    With -Candidate (the folder scripts\suite\package-candidate.ts writes, release\candidates\windows-macos),
#    Fadester for OBS and the VJster extension are this commit's own build as well, checked against the hashes
#    in its CANDIDATE.json; without it they are the pinned published files. A release build uses -Candidate, so
#    the setup attached to a release carries that release's plugin, not the one before it.
# 3. FadesterSuite.iss chains the three plugins' own standalone installers, so each keeps its own AppId, version,
#    upgrade and uninstall entry in Windows Installed apps.
# Optional signing: set FADESTER_SIGN_CMD to a command that signs the file named by $f (for example
#   signtool sign /fd SHA256 /tr http://timestamp.example /td SHA256 /n "Publisher" $f). Without it the build is unsigned.
param(
  [string]$CompanionBuild,
  [string]$OutDir = (Join-Path $PSScriptRoot 'dist'),
  [string]$Manifest = (Join-Path $PSScriptRoot 'components.json'),
  [string]$LocalArtifacts,
  [string]$Candidate,
  [switch]$DownloadOnly,
  [string[]]$Define = @(),
  [string]$Iscc
)
$ErrorActionPreference = 'Stop'
$m = Get-Content -Raw -Encoding UTF8 -LiteralPath $Manifest | ConvertFrom-Json
$out = [IO.Path]::GetFullPath($OutDir)
$stage = Join-Path $out 'stage'
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
$null = New-Item -ItemType Directory -Force -Path $stage

function Get-Pinned([string]$key) {
  $c = $m.components.$key
  if (-not $c.file -or $c.file -match '[\\/]' -or $c.sha256 -notmatch '^[0-9a-f]{64}$') { throw "Manifest entry '$key' needs a plain file name and a 64-digit lowercase sha256." }
  $dest = Join-Path $stage $c.file
  $local = if ($LocalArtifacts) { Join-Path $LocalArtifacts $c.file } else { $null }
  if ($local -and (Test-Path -LiteralPath $local -PathType Leaf)) { Copy-Item -LiteralPath $local -Destination $dest }
  else {
    if ($c.url -notmatch '^https://github\.com/jbrick2070/') { throw "Manifest entry '$key' must download from github.com/jbrick2070." }
    Invoke-WebRequest -Uri $c.url -OutFile $dest -UseBasicParsing
  }
  $hash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($hash -ne $c.sha256) {
    Remove-Item -LiteralPath $dest -Force
    throw "SHA-256 mismatch for $($c.file): expected $($c.sha256), got $hash. Nothing was built."
  }
  Write-Host "verified $($c.file) $hash"
  return $dest
}

# This commit's own Fadester for OBS package and VJster extension, as package-candidate.ts built and hashed them.
function Get-FromCandidate([string]$folder) {
  $dir = [IO.Path]::GetFullPath($folder)
  $record = Join-Path $dir 'CANDIDATE.json'
  if (-not (Test-Path -LiteralPath $record -PathType Leaf)) { throw "$dir has no CANDIDATE.json. Run: node --import tsx scripts/suite/package-candidate.ts" }
  $cand = Get-Content -Raw -Encoding UTF8 -LiteralPath $record | ConvertFrom-Json
  $found = @{}
  foreach ($a in $cand.artifacts) {
    if ($a.name -match '[\\/]' -or $a.sha256 -notmatch '^[0-9a-f]{64}$') { throw "CANDIDATE.json names an unusable artifact: $($a.name)" }
    $file = Join-Path $dir $a.name
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $a.sha256) { throw "SHA-256 mismatch for $($a.name): CANDIDATE.json says $($a.sha256), the file is $hash. Nothing was built." }
    Write-Host "verified $($a.name) $hash (this commit's candidate)"
    if ($a.name -like '*.streamDeckPlugin') { $found.plugin = $file }
    elseif ($a.name -match '^vjster-chrome-extension-(\d+\.\d+\.\d+)\.zip$') { $found.extension = $file; $found.extensionVersion = $Matches[1] }
  }
  if (-not $found.plugin -or -not $found.extension) { throw 'The candidate needs one .streamDeckPlugin and one vjster-chrome-extension-<version>.zip.' }
  if ("$($cand.version)" -notmatch '^(\d+\.\d+\.\d+)(\.\d+)?$') { throw "CANDIDATE.json has no usable version: $($cand.version)" }
  $found.pluginVersion = $Matches[1]
  return $found
}

$pinned = @{}
$pinnedKeys = if ($Candidate) { 'midiFadester', 'playlister' } else { 'midiFadester', 'playlister', 'fadesterForObs', 'vjsterExtension' }
foreach ($key in $pinnedKeys) { $pinned[$key] = Get-Pinned $key }
$sdVersion = $m.components.fadesterForObs.version
$extVersion = $m.components.vjsterExtension.version
if ($Candidate) {
  $own = Get-FromCandidate $Candidate
  # Under the pinned file's name, which is the package's own (<plugin UUID>.streamDeckPlugin): the setup and its tests name it so.
  $pinned.fadesterForObs = Join-Path $stage $m.components.fadesterForObs.file
  Copy-Item -LiteralPath $own.plugin -Destination $pinned.fadesterForObs
  $pinned.vjsterExtension = $own.extension
  $sdVersion = $own.pluginVersion
  $extVersion = $own.extensionVersion
  Write-Host "Fadester for OBS $sdVersion and VJster extension $extVersion come from this commit's candidate."
}
if ($DownloadOnly) { Write-Host 'All pinned inputs verified.'; return }

# The unpacked VJster extension, ready for Chrome's "Load unpacked".
$ext = Join-Path $stage 'vjster-extension'
Expand-Archive -LiteralPath $pinned.vjsterExtension -DestinationPath $ext -Force
if (-not (Get-ChildItem -LiteralPath $ext -Recurse -Filter 'manifest.json' | Select-Object -First 1)) { throw 'The VJster extension archive has no manifest.json.' }

# The Fadester for OBS package unpacked, for OpenDeck (its plugins folder takes the .sdPlugin folder itself).
$sd = Join-Path $stage 'sdplugin'
$sdZip = Join-Path $stage 'fadester-for-obs.zip'
Copy-Item -LiteralPath $pinned.fadesterForObs -Destination $sdZip
Expand-Archive -LiteralPath $sdZip -DestinationPath $sd -Force
Remove-Item -LiteralPath $sdZip -Force
if (-not (Test-Path -LiteralPath (Join-Path $sd 'io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json'))) { throw 'The Fadester for OBS package has no io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json.' }

# Fadester Companion: only a finished build.
if (-not $CompanionBuild) { throw 'Pass -CompanionBuild with the "Fadester Companion" folder of a finished tourbox\build.ps1 run.' }
$companion = [IO.Path]::GetFullPath($CompanionBuild)
if (-not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $companion) 'build-complete.txt') -PathType Leaf)) {
  throw "$companion is not from a finished tourbox\build.ps1 run (no build-complete.txt beside it)."
}
foreach ($exe in 'Fadester Companion.exe', 'FadesterCompanionBridge.exe', 'FadesterNativeSlider.exe') {
  if (-not (Test-Path -LiteralPath (Join-Path $companion $exe) -PathType Leaf)) { throw "Fadester Companion build is missing $exe." }
}

if (-not $Iscc) {
  $found = Get-Command iscc -ErrorAction SilentlyContinue
  $Iscc = if ($found) { $found.Source } else { Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe' }
}
if (-not (Test-Path -LiteralPath $Iscc)) { throw 'Inno Setup 6 (ISCC.exe) is required.' }

$signArgs = @()
if ($env:FADESTER_SIGN_CMD) {
  # Inno signs its own uninstaller and the setup with this command; $f is the file.
  $signArgs = @("/Sfadester=$($env:FADESTER_SIGN_CMD)", '/DSIGN')
  foreach ($exe in Get-ChildItem -LiteralPath $companion -Filter '*.exe' -File) {
    $f = $exe.FullName; Invoke-Expression $env:FADESTER_SIGN_CMD
    if ($LASTEXITCODE) { throw "Signing failed for $f." }
  }
}

$c = $m.components
$companionSetup = "FadesterCompanion-$($c.companion.version)-Setup.exe"
& $Iscc /Q "/O$stage" "/F$([IO.Path]::GetFileNameWithoutExtension($companionSetup))" `
  "/DCompanionVersion=$($c.companion.version)" "/DCompanionAppId=$($c.companion.appId)" "/DCompanionSource=$companion" `
  @signArgs @(foreach ($d in $Define) { "/D$d" }) (Join-Path $PSScriptRoot 'FadesterCompanion.iss')
if ($LASTEXITCODE) { throw 'Fadester Companion installer build failed.' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyy.MM.dd')
$name = "Fadester-Suite-Setup-$stamp-Windows-x64"
$defs = @(
  "/DSuiteVersion=$stamp", "/DSuiteAppId=$($m.suiteAppId)", "/DStage=$stage",
  "/DMfFile=$($c.midiFadester.file)", "/DMfVersion=$($c.midiFadester.version)", "/DMfAppId=$($c.midiFadester.appId)",
  "/DPlFile=$($c.playlister.file)", "/DPlVersion=$($c.playlister.version)", "/DPlAppId=$($c.playlister.appId)",
  "/DSdFile=$($c.fadesterForObs.file)", "/DSdVersion=$sdVersion",
  "/DExtVersion=$extVersion",
  "/DCoFile=$companionSetup", "/DCoVersion=$($c.companion.version)", "/DCoAppId=$($c.companion.appId)",
  "/DStorePrefix=$($c.companion.storePackageFamilyPrefix)"
)
& $Iscc /Q "/O$out" "/F$name" @defs @signArgs @(foreach ($d in $Define) { "/D$d" }) (Join-Path $PSScriptRoot 'FadesterSuite.iss')
if ($LASTEXITCODE) { throw 'Fadester Suite Setup build failed.' }
$setup = Join-Path $out "$name.exe"
$hash = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$setup.sha256" -Value "$hash  $name.exe" -Encoding ascii
Copy-Item -LiteralPath (Join-Path $stage $companionSetup) -Destination $out -Force
Write-Host "built $setup $hash"
