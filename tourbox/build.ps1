param([string]$DotNet, [string]$OutDir=(Join-Path $PSScriptRoot 'dist'), [string]$Version='0.1.0-rc6')
$ErrorActionPreference='Stop'
if ($Version -notmatch '^[a-zA-Z0-9.-]+$') { throw 'Invalid version.' }
if (!$DotNet) {
  $dot=Get-Command dotnet -ErrorAction SilentlyContinue
  if ($dot) {$DotNet=$dot.Source} else {$DotNet=Join-Path $env:LOCALAPPDATA 'FadesterBuildTools\dotnet\dotnet.exe'}
}
if (!(Test-Path -LiteralPath $DotNet)) {throw 'Build requires the .NET 8 SDK; pass -DotNet with its path.'}
$out=[IO.Path]::GetFullPath($OutDir)
$null=New-Item -ItemType Directory -Force -Path $out
$stage=Join-Path $out ("build-"+[Guid]::NewGuid().ToString('N'))
$bundle=Join-Path $stage 'Fadester for TourBox'
$sources=Join-Path $bundle 'source\tourbox'
$null=New-Item -ItemType Directory -Force -Path $sources
$presetDir=Join-Path $PSScriptRoot 'presets'
$presets=Join-Path $bundle 'presets'
$guideDir=Join-Path $PSScriptRoot 'guide'
$python=Get-Command python -ErrorAction SilentlyContinue
if (!$python) {throw 'Rebuilding from source requires Python 3 to validate the native presets. The distributed apps do not.'}
& $python.Source (Join-Path $presetDir 'build.py') --check --localized-out $presets
if($LASTEXITCODE){throw 'Native preset bytes do not match the control map.'}
$translations=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $presetDir 'locales.json') | ConvertFrom-Json
foreach($locale in $translations.PSObject.Properties.Name){
  if (!(Test-Path -LiteralPath (Join-Path $guideDir "$locale.html") -PathType Leaf)) {throw "Missing quick start for $locale"}
}
if (!(Test-Path -LiteralPath (Join-Path $guideDir 'quickstart.css') -PathType Leaf)) {throw 'Missing quick start stylesheet.'}
$map=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $presetDir 'map.json') | ConvertFrom-Json
foreach($bank in $map.presets.PSObject.Properties.Value){if (!(Test-Path -LiteralPath (Join-Path $presetDir $bank.file))) {throw "Missing preset: $($bank.file)"}}
$csproj=Join-Path $PSScriptRoot 'bridge\FadesterTourBoxBridge.csproj'
& $DotNet publish $csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:DebugType=None -p:IncludeNativeLibrariesForSelfExtract=true -o (Join-Path $stage 'publish') --nologo
if($LASTEXITCODE){throw 'Bridge publish failed.'}
Copy-Item -LiteralPath (Join-Path $stage 'publish\FadesterTourBoxBridge.exe') -Destination $bundle
$panel=Join-Path $bundle 'Fadester for TourBox.exe'
$csc=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& (Join-Path $PSScriptRoot 'native/build.ps1') -OutputPath (Join-Path $bundle 'FadesterNativeSlider.exe')
$panelSources=@(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'panel') -Filter '*.cs' -File | Select-Object -ExpandProperty FullName)
& $csc /nologo /target:winexe /optimize+ /codepage:65001 "/win32icon:$(Join-Path $PSScriptRoot 'panel\fadester.ico')" "/out:$panel" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll @panelSources
if($LASTEXITCODE){throw 'Panel build failed.'}
$paneltest=Start-Process -WindowStyle Hidden -FilePath $panel -ArgumentList '--self-test' -PassThru -Wait
if($paneltest.ExitCode){throw 'Panel self-test failed.'}
$null=New-Item -ItemType Directory -Force $presets
Copy-Item -LiteralPath (Join-Path $presetDir 'map.json') -Destination $presets
Copy-Item -LiteralPath (Join-Path $presetDir 'gamepad.json') -Destination $presets
foreach($bank in $map.presets.PSObject.Properties.Value){Copy-Item -LiteralPath (Join-Path $presetDir $bank.file) -Destination $presets}
& (Join-Path $bundle 'FadesterTourBoxBridge.exe') --self-test --map (Join-Path $presets 'map.json')
if($LASTEXITCODE){throw 'Packaged bridge self-test failed.'}
& node (Join-Path $PSScriptRoot 'make-guide.cjs') (Join-Path $bundle 'START-HERE.html')
if($LASTEXITCODE){throw 'Quick-guide generation failed.'}
Copy-Item -LiteralPath $guideDir -Destination (Join-Path $bundle 'guide') -Recurse
Copy-Item -LiteralPath $guideDir -Destination (Join-Path $sources 'guide') -Recurse
$art=Join-Path $PSScriptRoot 'artwork'
foreach($bank in $map.presets.PSObject.Properties.Name){foreach($ext in 'svg','png'){if(!(Test-Path -LiteralPath (Join-Path $art "$bank-cover.$ext"))){throw "Missing $bank cover ($ext)."}}}
foreach($id in 'scenes','fade','audio','media','overlay','capture','transition','diagnostics'){if(!(Test-Path -LiteralPath (Join-Path $art "icons/$id.png"))){throw "Missing action icon $id."}}
Copy-Item -LiteralPath $art -Destination (Join-Path $bundle 'artwork') -Recurse
Copy-Item -LiteralPath $art -Destination (Join-Path $sources 'artwork') -Recurse
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'GALLERY.txt') -Destination $bundle
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination $bundle
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'REHEARSAL.md') -Destination $bundle
$license=Join-Path (Split-Path $PSScriptRoot) 'LICENSE'
Copy-Item -LiteralPath $license -Destination $bundle
Copy-Item -LiteralPath $license -Destination (Join-Path $bundle 'source\LICENSE')
$sdkroot=Split-Path ([IO.Path]::GetFullPath($DotNet))
$notices=Join-Path $bundle 'runtime-notices'; $null=New-Item -ItemType Directory -Force $notices
foreach($doc in 'LICENSE.txt','ThirdPartyNotices.txt'){Copy-Item -LiteralPath (Join-Path $sdkroot $doc) -Destination $notices}
# Include human-editable corresponding source, excluding any SDK output or machine config.
foreach($file in Get-ChildItem -LiteralPath $PSScriptRoot -File) {if($file.Extension -in '.ps1','.md','.cjs','.txt') {Copy-Item -LiteralPath $file.FullName -Destination $sources}}
foreach($sub in 'presets','bridge','panel','tests','native'){
  $src=Join-Path $PSScriptRoot $sub; $dest=Join-Path $sources $sub
  $null=New-Item -ItemType Directory -Force $dest
  foreach($file in Get-ChildItem -LiteralPath $src -File){if($file.Extension -in '.tb','.json','.py','.cjs','.mjs','.cs','.csproj','.cpp','.vcxproj','.md','.ps1','.txt','.js','.xml','.ico'){Copy-Item -LiteralPath $file.FullName -Destination $dest}}
}
$zip=Join-Path $out ("Fadester-for-TourBox-Windows-x64-"+$Version+'.zip')
Add-Type -AssemblyName System.IO.Compression.FileSystem
$tmpZip=Join-Path $stage 'candidate.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($bundle,$tmpZip,[IO.Compression.CompressionLevel]::Optimal,$true)
[IO.File]::Copy($tmpZip,$zip,$true)
$hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($zip+'.sha256',"$hash  $([IO.Path]::GetFileName($zip))"+[Environment]::NewLine,[Text.UTF8Encoding]::new($false))
Write-Host "ZIP: $zip"
Write-Host "Runnable: $panel"
Write-Host "SHA256: $hash"
