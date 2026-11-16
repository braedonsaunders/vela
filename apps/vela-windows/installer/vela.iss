; Vela for Windows installer (Inno Setup 6). Build from a published folder:
;   iscc /DVersion=0.2.7 /DSource=<publish dir> /DOutput=<dir> vela.iss
; Per-user install (no administrator prompt) to %LOCALAPPDATA%\Programs\Vela. Updates run this
; same installer silently, then reopen Vela.

#ifndef Version
  #error Pass /DVersion=<x.y.z>
#endif
#ifndef Source
  #error Pass /DSource=<published folder>
#endif
#ifndef Output
  #define Output "."
#endif

[Setup]
AppId={{6E2B4C1A-9C3F-4E0B-9F1D-7A5E2C8B4D10}
AppName=Vela
AppVersion={#Version}
AppVerName=Vela {#Version}
AppPublisher=Braedon Saunders
AppPublisherURL=https://github.com/braedonsaunders/vela
AppSupportURL=https://github.com/braedonsaunders/vela/issues
AppUpdatesURL=https://github.com/braedonsaunders/vela/releases
DefaultDirName={localappdata}\Programs\Vela
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#Output}
OutputBaseFilename=Vela-Setup-{#Version}-x64
SetupIconFile=..\vela.ico
UninstallDisplayIcon={app}\Vela.exe
UninstallDisplayName=Vela
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile=..\..\..\LICENSE

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; A new release replaces the bundled UI wholesale, so files a release dropped never linger.
Type: filesandordirs; Name: "{app}\ui"

[Icons]
Name: "{autoprograms}\Vela"; Filename: "{app}\Vela.exe"
Name: "{autodesktop}\Vela"; Filename: "{app}\Vela.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Vela.exe"; Description: "Open Vela"; Flags: nowait postinstall

[Code]
// Vela draws its interface with Microsoft Edge WebView2, part of Windows 11 and current Windows 10.
function WebView2Installed(): Boolean;
var
  Version: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')
    or RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function InitializeSetup(): Boolean;
var
  ErrorCode: Integer;
begin
  Result := True;
  if not WebView2Installed() then
  begin
    if WizardSilent() then Exit;
    if MsgBox('Vela needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC.' + #13#10#13#10 +
      'Open Microsoft''s download page now? Run Vela''s installer again afterwards.', mbConfirmation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/#download', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
    Result := False;
  end;
end;
