<#
  Build the Vela for Windows installer.

    ./build.ps1 -Version 0.2.7 -Ui <web release folder> [-Output <dir>]

  -Ui is the root of a Vela web release (the folder tools/release/build.ts packs: index.html, _expo,
  assets, player, skins, routes.json, ...), so the desktop app ships the same UI bytes as the web.
  libmpv is shinchiro's mpv-winbuild-cmake build, pinned by SHA-256. Needs .NET 8 SDK, Inno Setup 6
  (iscc) and tar (bsdtar, which ships with Windows 10+ and reads .7z).
#>
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Ui,
  [string]$Output = (Join-Path $PSScriptRoot "dist")
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$MpvUrl = "https://github.com/shinchiro/mpv-winbuild-cmake/releases/download/20261111/mpv-dev-x86_64-20261111-git-bcde6b93cc.7z"
$MpvSha256 = "273c079b11ea5575822f972756f4c9a71149a5c10130353abeb8586738938452"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must be x.y.z" }
if (-not (Test-Path (Join-Path $Ui "index.html"))) { throw "$Ui is not a Vela web release (no index.html)" }
foreach ($required in @("_expo", "player", "skins", "routes.json")) {
  if (-not (Test-Path (Join-Path $Ui $required))) { throw "$Ui is missing $required" }
}

$work = Join-Path $PSScriptRoot "obj\package"
$publish = Join-Path $work "Vela"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $publish, $Output | Out-Null

dotnet publish (Join-Path $PSScriptRoot "Vela.Windows.csproj") -c Release -r win-x64 --self-contained true `
  -p:Version=$Version -p:DebugType=none -o $publish
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

$archive = Join-Path $work "mpv.7z"
Invoke-WebRequest -UseBasicParsing $MpvUrl -OutFile $archive
$hash = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($hash -ne $MpvSha256) { throw "libmpv archive hash mismatch: $hash" }
tar -xf $archive -C $work libmpv-2.dll
if ($LASTEXITCODE -ne 0) { throw "could not extract libmpv-2.dll" }
Copy-Item (Join-Path $work "libmpv-2.dll") $publish

Copy-Item -Recurse $Ui (Join-Path $publish "ui")

$iscc = $null
$found = Get-Command iscc -ErrorAction SilentlyContinue
if ($found) { $iscc = $found.Source }
if (-not $iscc) { $iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" }
if (-not (Test-Path $iscc)) { $iscc = Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe" }
& $iscc "/DVersion=$Version" "/DSource=$publish" "/DOutput=$Output" (Join-Path $PSScriptRoot "installer\vela.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Get-ChildItem $Output -Filter "Vela-Setup-$Version-x64.exe" | ForEach-Object { "$($_.FullName)  $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
