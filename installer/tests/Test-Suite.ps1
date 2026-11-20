# End-to-end tests for the Fadester Suite Setup. They really install and uninstall into C:\ProgramData and
# Program Files, so they run only on a disposable CI machine (the suite-installer workflow), never on a show PC.
#
#   .\installer\tests\Test-Suite.ps1 -Setup <Fadester-Suite-Setup-*.exe> -CompanionBuild <folder>     # all tests
#   .\installer\tests\Test-Suite.ps1 -Setup <broken setup> -Only <name> -ExpectFail                     # mutation check
#
# Every guard test is also run against a setup compiled with that guard switched off (BREAK_*), and must fail
# there: that proves the test can catch the regression it is meant to catch.
param(
  [Parameter(Mandatory)] [string]$Setup,
  [string]$CompanionBuild,
  [string]$Manifest = (Join-Path $PSScriptRoot '..\components.json'),
  [string]$Only,
  [switch]$ExpectFail
)
$ErrorActionPreference = 'Stop'
if ($env:CI -ne 'true' -and -not $env:FADESTER_ALLOW_DESTRUCTIVE_TESTS) {
  throw 'These tests install into C:\ProgramData and Program Files. Run them on a disposable CI machine (set CI=true).'
}
$m = Get-Content -Raw -Encoding UTF8 -LiteralPath $Manifest | ConvertFrom-Json
$c = $m.components
$work = Join-Path $env:RUNNER_TEMP ("suite-tests-" + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $work
$script:failures = @()
$script:passes = 0

function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  ok   $what"; $script:passes++ } else { Write-Host "  FAIL $what"; $script:failures += $what }
}
function Run-Setup([string]$exe, [string[]]$extra, [string]$name) {
  $log = Join-Path $work "$name.log"
  $argv = @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', "/LOG=`"$log`"") + $extra
  $p = Start-Process -FilePath $exe -ArgumentList $argv -Wait -PassThru
  $text = if (Test-Path -LiteralPath $log) { Get-Content -Raw -LiteralPath $log } else { '' }
  return [pscustomobject]@{ Code = $p.ExitCode; Log = $text }
}
function Uninstall-Key([string]$appId) {
  foreach ($root in 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall') {
    $key = Join-Path $root "{$appId}_is1"
    if (Test-Path -LiteralPath $key) { return $key }
  }
  return $null
}
function Installed([string]$appId) { return [bool](Uninstall-Key $appId) }
function Uninstall([string]$appId) {
  $key = Uninstall-Key $appId
  if (-not $key) { return }
  $cmd = (Get-ItemProperty -LiteralPath $key).UninstallString.Trim('"')
  Start-Process -FilePath $cmd -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait | Out-Null
  Start-Sleep -Seconds 2
}
$pluginDir = Join-Path $env:ProgramData 'obs-studio\plugins'
$suiteDir = Join-Path $env:ProgramData 'Fadester Suite'
$companionDir = Join-Path $env:ProgramFiles 'Fadester Companion'
$storeKey = 'HKCU:\Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages\' + $c.companion.storePackageFamilyPrefix + '0.1.2.0_x64__suitetest'
$vjsterDir = Join-Path $env:APPDATA 'Elgato\StreamDeck\Plugins\com.jbrick2070.vjster.sdPlugin'

function Test-Checksum {
  Write-Host 'checksum: a tampered pin stops the build'
  $bad = Join-Path $work 'bad-components.json'
  $j = Get-Content -Raw -LiteralPath $Manifest | ConvertFrom-Json
  $j.components.midiFadester.sha256 = ('0' * 64)
  $j | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $bad -Encoding utf8
  $threw = $false
  try { & (Join-Path $PSScriptRoot '..\build-suite.ps1') -Manifest $bad -OutDir (Join-Path $work 'bad') -DownloadOnly } catch { $threw = $_.Exception.Message -match 'SHA-256 mismatch' }
  Check $threw 'build refuses a SHA-256 mismatch'
  $ok = $true
  try { & (Join-Path $PSScriptRoot '..\build-suite.ps1') -Manifest $Manifest -OutDir (Join-Path $work 'good') -DownloadOnly } catch { $ok = $false }
  Check $ok 'build accepts the pinned inputs'
}

function Test-ObsRunning {
  Write-Host 'obs-running: setup refuses to touch plugins while OBS is open, and never closes it'
  $fake = Join-Path $work 'obs64.exe'
  Copy-Item -LiteralPath (Join-Path $env:WINDIR 'System32\ping.exe') -Destination $fake
  $obs = Start-Process -FilePath $fake -ArgumentList '-n', '600', '127.0.0.1' -WindowStyle Hidden -PassThru
  try {
    $r = Run-Setup $Setup @('/COMPONENTS="obs\mf"') 'obs-running'
    Check ($r.Code -ne 0) "setup exits with an error while obs64.exe runs (exit $($r.Code))"
    Check ($r.Log -cmatch 'OBS-RUNNING:') 'log says why'
    Check (-not (Installed $c.midiFadester.appId)) 'Midi Fadester was not installed'
    Check (-not $obs.HasExited) 'obs64.exe is still running'
  } finally { if (-not $obs.HasExited) { Stop-Process -Id $obs.Id -Force } }
}

function Test-FullInstallWithStoreEdition {
  Write-Host 'store-edition + full install: plugins install, standalone Companion is skipped when the Store edition exists,'
  Write-Host '  and an old separate Visual Sidechain is reported and removed by Midi Fadester (0.9.0 and later)'
  $null = New-Item -Path $storeKey -Force
  # A leftover standalone Visual Sidechain: its plugin folder and its uninstall entry (whose uninstaller is gone).
  $oldVsDir = Join-Path $pluginDir 'visual-sidechain'
  $oldVsKey = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{7C4A92E8-4B19-4F03-9A56-3D8E21B05C7F}_is1'
  $null = New-Item -ItemType Directory -Force -Path (Join-Path $oldVsDir 'bin\64bit')
  Set-Content -LiteralPath (Join-Path $oldVsDir 'bin\64bit\visual-sidechain.dll') -Value 'old'
  $null = New-Item -Path $oldVsKey -Force
  Set-ItemProperty -LiteralPath $oldVsKey -Name DisplayVersion -Value '0.8.0'
  Set-ItemProperty -LiteralPath $oldVsKey -Name UninstallString -Value '"C:\Program Files\visual-sidechain-gone\unins000.exe"'
  try {
    $r = Run-Setup $Setup @() 'full-store'
    Check ($r.Code -eq 0) "setup succeeds (exit $($r.Code))"
    Check ($r.Log -cmatch 'STORE-EDITION:') 'log notes the Store edition'
    Check ($r.Log -cmatch 'OLD-VS:') 'log notes the old separate Visual Sidechain'
    Check (-not (Test-Path -LiteralPath $oldVsDir)) 'Midi Fadester removed the old Visual Sidechain plugin folder'
    Check (-not (Installed $c.companion.appId)) 'standalone Fadester Companion not installed'
    foreach ($p in @(@($c.midiFadester, 'midi-fadester'), @($c.playlister, 'obs-playlister'))) {
      Check (Installed $p[0].appId) "$($p[0].name) has its own uninstall entry"
      Check ((Get-ItemProperty -LiteralPath (Uninstall-Key $p[0].appId)).DisplayVersion -eq $p[0].version) "$($p[0].name) shows its real version $($p[0].version)"
      Check (Test-Path -LiteralPath (Join-Path $pluginDir $p[1])) "$($p[0].name) files are in ProgramData\obs-studio\plugins\$($p[1])"
    }
    Check (Test-Path -LiteralPath (Join-Path $suiteDir "packages\$($c.fadesterForObs.file)")) 'Fadester for OBS package staged'
    Check (Test-Path -LiteralPath (Join-Path $suiteDir 'vjster-extension\manifest.json')) 'VJster extension unpacked'
    Check (Installed $m.suiteAppId) 'suite shared files have their own uninstall entry'
  } finally {
    Remove-Item -Path $storeKey -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $oldVsKey -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $oldVsDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

function Test-Companion {
  Write-Host 'companion: installs on its own entry with the exact executable names'
  $r = Run-Setup $Setup @('/COMPONENTS="companion"') 'companion'
  Check ($r.Code -eq 0) "setup succeeds (exit $($r.Code))"
  Check (Installed $c.companion.appId) 'Fadester Companion has its own uninstall entry'
  foreach ($exe in 'Fadester Companion.exe', 'FadesterCompanionBridge.exe', 'FadesterNativeSlider.exe') {
    Check (Test-Path -LiteralPath (Join-Path $companionDir $exe)) "$exe installed under its exact name"
  }
}

function Test-Downgrade {
  Write-Host 'downgrade: a newer installed plugin is never replaced'
  $key = Uninstall-Key $c.midiFadester.appId
  if (-not $key) { Check $false 'Midi Fadester must be installed before the downgrade test'; return }
  $old = (Get-ItemProperty -LiteralPath $key).DisplayVersion
  Set-ItemProperty -LiteralPath $key -Name DisplayVersion -Value '9.9.9'
  try {
    $r = Run-Setup $Setup @('/COMPONENTS="obs\mf"') 'downgrade'
    Check ($r.Code -eq 0) "setup succeeds (exit $($r.Code))"
    Check ($r.Log -cmatch 'SKIP-NEWER: Midi Fadester') 'log says the newer copy is kept'
    Check ($r.Log -cnotmatch 'INSTALLED: Midi Fadester') 'the bundled Midi Fadester was not run'
    Check ((Get-ItemProperty -LiteralPath $key).DisplayVersion -eq '9.9.9') 'installed version untouched'
  } finally { Set-ItemProperty -LiteralPath $key -Name DisplayVersion -Value $old }
}

function Test-VjsterClash {
  Write-Host 'vjster-clash: a standalone VJster plugin is reported'
  $null = New-Item -ItemType Directory -Force -Path $vjsterDir
  try {
    $r = Run-Setup $Setup @('/COMPONENTS="streamdeck"') 'vjster-clash'
    Check ($r.Code -eq 0) "setup succeeds (exit $($r.Code))"
    Check ($r.Log -cmatch 'VJSTER-CLASH:') 'log warns about port 48150'
    Check (Test-Path -LiteralPath $vjsterDir) 'the standalone VJster plugin is left for the user to remove'
  } finally { Remove-Item -LiteralPath $vjsterDir -Recurse -Force -ErrorAction SilentlyContinue }
}

function Test-KeepNewer {
  Write-Host 'keep-newer: a newer Fadester for OBS in OpenDeck and a newer unpacked VJster extension are not replaced; older ones are'
  $deckRoot = Join-Path $env:APPDATA 'opendeck'
  $hadDeck = Test-Path -LiteralPath $deckRoot
  $deckPlugin = Join-Path $deckRoot 'plugins\io.github.jbrick2070.fadester-for-obs.sdPlugin'
  $extDir = Join-Path $suiteDir 'vjster-extension'
  $deckManifest = Join-Path $deckPlugin 'manifest.json'
  $extManifest = Join-Path $extDir 'manifest.json'
  $null = New-Item -ItemType Directory -Force -Path $deckPlugin, $extDir
  Set-Content -LiteralPath $deckManifest -Value '{ "Name": "Fadester for OBS", "Version": "99.0.0.0", "Nodejs": { "Version": "24" } }' -Encoding ascii
  Set-Content -LiteralPath $extManifest -Value '{ "manifest_version": 3, "version": "99.0.0" }' -Encoding ascii
  try {
    $r = Run-Setup $Setup @('/COMPONENTS="streamdeck,vjsterext"', '/TASKS="opendeck"') 'keep-newer'
    Check ($r.Code -eq 0) "setup succeeds (exit $($r.Code))"
    Check ($r.Log -cmatch 'SKIP-NEWER: Fadester for OBS in OpenDeck 99\.0\.0\.0') 'log says the newer OpenDeck copy is kept'
    Check ($r.Log -cmatch 'SKIP-NEWER: The VJster Chrome extension 99\.0\.0') 'log says the newer extension is kept'
    Check ((Get-Content -Raw -LiteralPath $deckManifest) -match '99\.0\.0\.0') 'the newer OpenDeck plugin is untouched'
    Check (-not (Test-Path -LiteralPath (Join-Path $deckPlugin 'bin'))) 'no file of the older plugin was put beside the newer one'
    Check ((Get-Content -Raw -LiteralPath $extManifest) -match '"99\.0\.0"') 'the newer extension is untouched'
    Set-Content -LiteralPath $deckManifest -Value '{ "Version": "0.0.1.0" }' -Encoding ascii
    Set-Content -LiteralPath $extManifest -Value '{ "version": "0.0.1" }' -Encoding ascii
    $r = Run-Setup $Setup @('/COMPONENTS="streamdeck,vjsterext"', '/TASKS="opendeck"') 'replace-older'
    Check ($r.Code -eq 0) "setup succeeds over older copies (exit $($r.Code))"
    Check ((Get-Content -Raw -LiteralPath $deckManifest) -notmatch '"0\.0\.1\.0"') 'an older OpenDeck plugin is replaced'
    Check (Test-Path -LiteralPath (Join-Path $deckPlugin 'bin')) 'the plugin files are in OpenDeck''s folder'
    Check ((Get-Content -Raw -LiteralPath $extManifest) -notmatch '"0\.0\.1"') 'an older extension is replaced'
  } finally {
    # The OpenDeck copy is never uninstalled by setup (it is the user's): the test removes its own.
    if ($hadDeck) { Remove-Item -LiteralPath $deckPlugin -Recurse -Force -ErrorAction SilentlyContinue }
    else { Remove-Item -LiteralPath $deckRoot -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Test-Uninstall {
  Write-Host 'uninstall: each component removes only itself, and never user settings'
  $keep = @(
    (Join-Path $env:APPDATA 'obs-studio\plugin_config\midi-fadester\keep.json'),
    (Join-Path $env:APPDATA 'obs-studio\basic\scenes\keep.json'),
    (Join-Path $env:LOCALAPPDATA 'FadesterTourBox\config.json')
  )
  foreach ($f in $keep) { $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $f); Set-Content -LiteralPath $f -Value '{}' }
  Uninstall $c.midiFadester.appId
  Check (-not (Installed $c.midiFadester.appId)) 'Midi Fadester uninstall entry removed'
  Check (-not (Test-Path -LiteralPath (Join-Path $pluginDir 'midi-fadester\bin'))) 'Midi Fadester files removed'
  Check (Test-Path -LiteralPath (Join-Path $pluginDir 'obs-playlister')) 'Playlister untouched by Midi Fadester uninstall'
  Uninstall $c.playlister.appId; Uninstall $c.companion.appId; Uninstall $m.suiteAppId
  Check (-not (Installed $c.companion.appId)) 'Fadester Companion uninstall entry removed'
  Check (-not (Test-Path -LiteralPath (Join-Path $companionDir 'Fadester Companion.exe'))) 'Fadester Companion files removed'
  Check (-not (Test-Path -LiteralPath (Join-Path $suiteDir 'packages'))) 'suite shared files removed'
  foreach ($f in $keep) { Check (Test-Path -LiteralPath $f) "kept $f" }
}

$tests = [ordered]@{
  checksum = { Test-Checksum }; 'obs-running' = { Test-ObsRunning }; full = { Test-FullInstallWithStoreEdition }
  companion = { Test-Companion }; downgrade = { Test-Downgrade }; 'vjster-clash' = { Test-VjsterClash }; 'keep-newer' = { Test-KeepNewer }; uninstall = { Test-Uninstall }
}
# Mutation checks need their prerequisites in place first.
$prereq = @{ downgrade = @('full'); 'store-edition' = @() }
if ($Only) {
  $name = if ($Only -eq 'store-edition') { 'full' } else { $Only }
  foreach ($p in @($prereq[$Only])) { if ($p) { & $tests[$p]; $script:failures = @() } }
  & $tests[$name]
} else {
  foreach ($t in $tests.Values) { & $t }
}

Write-Host "`n$($script:passes) passed, $($script:failures.Count) failed"
if ($ExpectFail) {
  if ($script:failures.Count -eq 0) { Write-Host "MUTATION NOT CAUGHT: '$Only' passed against a setup with its guard switched off."; exit 1 }
  Write-Host "Mutation caught: '$Only' failed as it must when its guard is off."; exit 0
}
if ($script:failures.Count) { $script:failures | ForEach-Object { Write-Host "FAILED: $_" }; exit 1 }
