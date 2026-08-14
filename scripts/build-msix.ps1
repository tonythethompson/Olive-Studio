<#
.SYNOPSIS
  Packages the Tauri Windows build output into an MSIX for Microsoft Store submission.

.DESCRIPTION
  Tauri's bundler does not produce MSIX directly (only msi/nsis). This script stages
  the compiled app binary + resources next to the required Store icon assets and an
  appxmanifest, then invokes makeappx.exe (from the Windows SDK, preinstalled on
  windows-latest GitHub runners) to build the .msix package.

.PARAMETER ReleaseDir
  Path to the Cargo release output directory containing olive-studio.exe and bundled
  resources (e.g. src-tauri/target/release or src-tauri/target/<triple>/release).

.PARAMETER Version
  App version (e.g. 0.5.0). Written into the manifest as a 4-part MSIX version.

.PARAMETER OutFile
  Output .msix path.
#>
param(
    [Parameter(Mandatory = $true)][string]$ReleaseDir,
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$msixSrc = Join-Path $repoRoot "src-tauri\msix"
$iconsSrc = Join-Path $repoRoot "src-tauri\icons"
$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("olive-studio-msix-" + [guid]::NewGuid())

New-Item -ItemType Directory -Path $stage | Out-Null
New-Item -ItemType Directory -Path (Join-Path $stage "assets") | Out-Null

$exe = Join-Path $ReleaseDir "olive-studio.exe"
if (-not (Test-Path $exe)) {
    throw "Release binary not found at $exe. Build the Tauri app first."
}
Copy-Item $exe -Destination $stage

# Resource dirs bundled by Tauri (dist, scripts, olive-mcp-server) live alongside the exe.
foreach ($dir in @("dist", "scripts", "olive-mcp-server")) {
    $src = Join-Path $ReleaseDir $dir
    if (Test-Path $src) {
        Copy-Item $src -Destination (Join-Path $stage $dir) -Recurse
    }
}

foreach ($asset in @("Square44x44Logo.png", "Square150x150Logo.png", "StoreLogo.png")) {
    Copy-Item (Join-Path $iconsSrc $asset) -Destination (Join-Path $stage "assets\$asset")
}

# MSIX requires a strict 4-part numeric version (Major.Minor.Build.Revision).
$versionParts = $Version -split "\."
while ($versionParts.Count -lt 4) { $versionParts += "0" }
$msixVersion = ($versionParts[0..3] -join ".")

$manifest = Get-Content (Join-Path $msixSrc "Package.appxmanifest") -Raw
$manifest = $manifest.Replace("__VERSION__", $msixVersion)
Set-Content -Path (Join-Path $stage "AppxManifest.xml") -Value $manifest -Encoding UTF8

$sdkRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
$makeappx = Get-ChildItem -Path $sdkRoot -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "x64" } |
    Sort-Object FullName -Descending |
    Select-Object -First 1
if (-not $makeappx) {
    throw "makeappx.exe not found under $sdkRoot. Install the Windows SDK."
}

$outDir = Split-Path -Parent $OutFile
if ($outDir -and -not (Test-Path $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

& $makeappx.FullName pack /d $stage /p $OutFile /o
if ($LASTEXITCODE -ne 0) {
    throw "makeappx failed with exit code $LASTEXITCODE"
}

Remove-Item $stage -Recurse -Force
Write-Host "MSIX package written to $OutFile"
