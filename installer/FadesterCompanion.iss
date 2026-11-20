; Fadester Companion standalone installer (Windows x64). Built by installer\build-suite.ps1 from a finished
; tourbox\build.ps1 run. Its own AppId gives it its own entry in Windows Installed apps, separate from the
; Microsoft Store edition (Fluxxuuss.FadesterCompanion) and from the Fadester Suite Setup.
; The app is "Fadester Companion.exe" with its engine "FadesterCompanionBridge.exe". Up to 0.1.3 they were named
; "Fadester for TourBox.exe" and "FadesterTourBoxBridge.exe": setup still looks for those when it checks that the app is
; closed, and removes them on an update, so one install never holds both names.
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
UninstallDisplayIcon={app}\Fadester Companion.exe
UninstallDisplayName=Fadester Companion
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; The panel holds this mutex while it is open, so setup asks to close it instead of replacing files in use.
AppMutex=Local\FadesterTourBoxPanel
CloseApplications=no
; The Windows display language when it is one of the suite's 13, else English: no language question at the start.
ShowLanguageDialog=auto
#ifdef SIGN
SignTool=fadester
#endif

[Languages]
#include "lang\languages.iss"

[CustomMessages]
; English. The other 12 languages are in installer\lang\<code>.isl, shared with FadesterSuite.iss.
OpenCompanion=Open Fadester Companion
IconGuide=Fadester Companion quick guide
StopCompanionRunning=Fadester Companion is running. Click Stop in Fadester Companion and close its window (or choose Quit from its icon beside the clock), then run setup again.
UninstallRunning=Fadester Companion is running. Quit it (Stop, then close its window), then uninstall again.

[Files]
Source: "{#CompanionSource}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Fadester Companion"; Filename: "{app}\Fadester Companion.exe"
Name: "{group}\{cm:IconGuide}"; Filename: "{app}\START-HERE.html"

[Run]
Filename: "{app}\Fadester Companion.exe"; Description: "{cm:OpenCompanion}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[InstallDelete]
; Files of an install made before the rename (0.1.3 and earlier).
Type: files; Name: "{app}\Fadester for TourBox.exe"
Type: files; Name: "{app}\FadesterTourBoxBridge.exe"
; The guide's shortcut had its English name in every language up to 0.1.17.
Type: files; Name: "{group}\Fadester Companion quick guide.lnk"; Check: GuideNameTranslated

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

function GuideNameTranslated(): Boolean;
begin
  Result := CustomMessage('IconGuide') <> 'Fadester Companion quick guide';
end;

// True while the app or its engine runs, under today's names or the ones used up to 0.1.3.
function CompanionRunning(): Boolean;
begin
  Result := ProcessRunning('FadesterCompanionBridge.exe') or ProcessRunning('Fadester Companion.exe')
    or ProcessRunning('FadesterTourBoxBridge.exe') or ProcessRunning('Fadester for TourBox.exe');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if CompanionRunning() then
    Result := CustomMessage('StopCompanionRunning');
end;

function InitializeUninstall(): Boolean;
begin
  Result := True;
  if CompanionRunning() then
  begin
    SuppressibleMsgBox(CustomMessage('UninstallRunning'), mbError, MB_OK, IDOK);
    Result := False;
  end;
end;
