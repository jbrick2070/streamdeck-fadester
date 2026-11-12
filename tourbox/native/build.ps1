param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
$finder = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (!(Test-Path -LiteralPath $finder)) { throw 'Install Visual Studio 2022 or later Build Tools with Desktop development with C++ and a Windows SDK.' }
$msbuild = & $finder -latest -products '*' -version '[17.0,)' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'MSBuild\Current\Bin\MSBuild.exe' | Select-Object -First 1
if (!$msbuild) {
    $found = (& $finder -all -products '*' -property installationVersion) -join ', '
    throw "Visual Studio 2022 or later with the MSVC x64 build tools and a Windows SDK is required to build the native slider (found: $found)."
}
$destination = [IO.Path]::GetFullPath($OutputPath)
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$stage = Join-Path $tempRoot ('fadester-native-build-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $stage
try {
    & $msbuild (Join-Path $PSScriptRoot 'NativeSlider.vcxproj') /nologo /verbosity:minimal /p:Configuration=Release /p:Platform=x64 "/p:FadesterBuildRoot=$stage"
    if ($LASTEXITCODE) { throw "Native slider build failed ($LASTEXITCODE)." }
    $null = [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination))
    Copy-Item -LiteralPath (Join-Path $stage 'out\FadesterNativeSlider.exe') -Destination $destination -Force
} finally {
    $actual = (Resolve-Path -LiteralPath $stage).Path
    if ([IO.Path]::GetDirectoryName($actual) -ne $tempRoot -or [IO.Path]::GetFileName($actual) -notmatch '^fadester-native-build-[0-9a-f]{32}$') { throw 'Unexpected native build directory.' }
    Remove-Item -LiteralPath $actual -Recurse -Force
}
