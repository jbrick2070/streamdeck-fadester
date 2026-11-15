; Fadester Companion standalone installer (Windows x64). Built by installer\build-suite.ps1 from a finished
; tourbox\build.ps1 run. Its own AppId gives it its own entry in Windows Installed apps, separate from the
; Microsoft Store edition (Fluxxuuss.FadesterCompanion) and from the Fadester Suite Setup.
; Executable names are kept exactly, so TourBox Console Auto Switch links to "Fadester for TourBox.exe" keep working.
; Settings live in %LOCALAPPDATA%\FadesterTourBox and are never removed by uninstall.

#ifndef CompanionVersion
  #error Pass /DCompanionVersion, /DCompanionAppId and /DCompanionSource (build-suite.ps1 does).
#endif

[Setup]
AppId={{{#CompanionAppId}}
AppName=Fadester Companion
AppVersion={#CompanionVersion}
AppVerName=Fadester Companion {#CompanionVersion}
AppPublisher=Jeffrey Brick
AppPublisherURL=https://github.com/jbrick2070/streamdeck-fadester
DefaultDirName={autopf}\Fadester Companion
DefaultGroupName=Fadester Companion
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\Fadester for TourBox.exe
UninstallDisplayName=Fadester Companion
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; The panel holds this mutex while it is open, so setup asks to close it instead of replacing files in use.
AppMutex=Local\FadesterTourBoxPanel
CloseApplications=no
#ifdef SIGN
SignTool=fadester
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#CompanionSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Fadester Companion"; Filename: "{app}\Fadester for TourBox.exe"
Name: "{group}\Fadester Companion quick guide"; Filename: "{app}\START-HERE.html"

[Run]
Filename: "{app}\Fadester for TourBox.exe"; Description: "Open Fadester Companion"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallDelete]
; Only files the app itself may leave in its own folder. %LOCALAPPDATA%\FadesterTourBox (settings, logs) is kept.
Type: filesandordirs; Name: "{app}\vjster"

[Code]
function ProcessRunning(const Name: String): Boolean;
var
  Locator, Service, Found: Variant;
begin
  Result := False;
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Found := Service.ExecQuery('SELECT ProcessId FROM Win32_Process WHERE Name = ''' + Name + '''');
    Result := Found.Count > 0;
  except
    Log('Could not check running processes: ' + GetExceptionMessage);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if ProcessRunning('FadesterTourBoxBridge.exe') or ProcessRunning('Fadester for TourBox.exe') then
    Result := 'Fadester Companion is running. Click Stop in Fadester Companion, close its window, and run setup again.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if ProcessRunning('FadesterTourBoxBridge.exe') or ProcessRunning('Fadester for TourBox.exe') then
  begin
    SuppressibleMsgBox('Fadester Companion is running. Close it, then uninstall again.', mbError, MB_OK, IDOK);
    Result := False;
  end;
end;
