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
  [string]$Output = (Join-Path $PSScriptRoot "dist"),
  [string]$CertificateProfileName,
  [string]$SignTool = "signtool.exe",
  [string]$SigningDlib = $env:VELA_SIGNING_DLIB
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

# Install Microsoft.Trusted.Signing.Client (or Microsoft.ArtifactSigning.Client),
# set VELA_SIGNING_DLIB to its x64 Azure.CodeSigning.Dlib.dll, and authenticate
# with Azure CLI (az login). Account velasigning lives in resource group vela-signing.
if ($CertificateProfileName) {
  if (-not (Get-Command $SignTool -ErrorAction SilentlyContinue)) { throw "SignTool not found: $SignTool" }
  if (-not $SigningDlib -or -not (Test-Path $SigningDlib)) { throw "Set -SigningDlib to the x64 Azure.CodeSigning.Dlib.dll" }
}
function Sign-VelaFile([string]$File) {
  if (-not $CertificateProfileName) { return }
  & $SignTool sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 /dlib $SigningDlib /dmdf $metadata $File
  if ($LASTEXITCODE -ne 0) { throw "Signing failed: $File" }
  & $SignTool verify /pa /v $File
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed: $File" }
}

$work = Join-Path $PSScriptRoot "obj\package"
$publish = Join-Path $work "Vela"
Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $publish, $Output | Out-Null

$metadata = Join-Path $work "metadata.json"
if ($CertificateProfileName) {
  @{
    Endpoint = "https://eus.codesigning.azure.net/"
    CodeSigningAccountName = "velasigning"
    CertificateProfileName = $CertificateProfileName
  } | ConvertTo-Json | Set-Content -Encoding UTF8 $metadata
}

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

Sign-VelaFile (Join-Path $publish "Vela.exe")

$iscc = $null
$found = Get-Command iscc -ErrorAction SilentlyContinue
if ($found) { $iscc = $found.Source }
if (-not $iscc) { $iscc = Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe" }
if (-not (Test-Path $iscc)) { $iscc = Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe" }
if (-not (Test-Path $iscc)) { $iscc = Join-Path $env:LOCALAPPDATA "Programs\Inno\ISCC.exe" }
if (-not (Test-Path $iscc)) { throw "Inno Setup 6 not found; add ISCC.exe to PATH" }
& $iscc "/DVersion=$Version" "/DSource=$publish" "/DOutput=$Output" (Join-Path $PSScriptRoot "installer\vela.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed" }
Sign-VelaFile (Join-Path $Output "Vela-Setup-$Version-x64.exe")
Get-ChildItem $Output -Filter "Vela-Setup-$Version-x64.exe" | ForEach-Object { "$($_.FullName)  $((Get-FileHash $_.FullName -Algorithm SHA256).Hash)" }
