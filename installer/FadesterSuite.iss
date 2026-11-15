; Fadester Suite Setup (Windows x64): one guided pass for any mix of the suite's plugins and apps.
; Built by installer\build-suite.ps1; see installer\README.md and docs\COMBINED-INSTALLER-DESIGN.md (Option B).
;
; Every OBS plugin and Fadester Companion is installed by running its own standalone installer silently, so each keeps
; its own AppId, real version, upgrade path and entry in Windows Installed apps. This setup's own uninstall entry
; ("Fadester Suite shared files") removes only the files it placed in ProgramData\Fadester Suite.
;
; Safety rules: never closes OBS or Fadester Companion (asks you to), never replaces a newer installed component
; (unless /ALLOWDOWNGRADE), leaves the Microsoft Store edition of Fadester Companion alone, warns when the standalone
; VJster plugin would fight Fadester for OBS over port 48150, and never deletes settings, scene collections or profiles.
; Log markers (for tests and support): OBS-RUNNING, COMPANION-RUNNING, OPENDECK-RUNNING, SKIP-NEWER, STORE-EDITION,
; VJSTER-CLASH, INSTALLED, FAILED.

#ifndef SuiteVersion
  #error Build with installer\build-suite.ps1, which passes the component defines.
#endif

[Setup]
AppId={{{#SuiteAppId}}
AppName=Fadester Suite
AppVersion={#SuiteVersion}
AppVerName=Fadester Suite Setup {#SuiteVersion}
UninstallDisplayName=Fadester Suite shared files
AppPublisher=Jeffrey Brick
AppPublisherURL=https://github.com/jbrick2070/streamdeck-fadester
DefaultDirName={commonappdata}\Fadester Suite
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no
SetupLogging=yes
; The OpenDeck task writes to the signed-in user's own OpenDeck folder on purpose.
UsedUserAreasWarning=no
#ifdef SIGN
SignTool=fadester
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Everything"
Name: "custom"; Description: "Choose components"; Flags: iscustom

[Components]
Name: "obs"; Description: "OBS Studio 33 plugins (each keeps its own uninstall entry)"; Types: full
Name: "obs\mf"; Description: "Midi Fadester {#MfVersion}"; Types: full
Name: "obs\vs"; Description: "Visual Sidechain {#VsVersion}"; Types: full
Name: "obs\pl"; Description: "Playlister {#PlVersion}"; Types: full
Name: "companion"; Description: "Fadester Companion {#CoVersion} (game controller, TourBox, whole-mix audio)"; Types: full
Name: "streamdeck"; Description: "Fadester for OBS {#SdVersion} for Stream Deck and OpenDeck (includes VJster)"; Types: full
Name: "vjsterext"; Description: "VJster Chrome extension {#ExtVersion} (unpacked, for Load unpacked)"; Types: full

[Tasks]
Name: "opendeck"; Description: "Add Fadester for OBS to OpenDeck"; Components: streamdeck; Check: OpenDeckPresent

[Files]
; Standalone installers, extracted and run one by one during "Preparing to install".
Source: "{#Stage}\{#MfFile}"; Flags: dontcopy
Source: "{#Stage}\{#VsFile}"; Flags: dontcopy
Source: "{#Stage}\{#PlFile}"; Flags: dontcopy
Source: "{#Stage}\{#CoFile}"; Flags: dontcopy
; Fadester for OBS package: Stream Deck imports it with its own installer when it is opened.
Source: "{#Stage}\{#SdFile}"; DestDir: "{app}\packages"; Components: streamdeck; Flags: ignoreversion
Source: "{#Stage}\sdplugin\*"; DestDir: "{userappdata}\opendeck\plugins"; Tasks: opendeck; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall
Source: "{#Stage}\vjster-extension\*"; DestDir: "{app}\vjster-extension"; Components: vjsterext; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
const
  UninstallRoot = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\';
  PackagesKey = 'Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages';

var
  Notes: String;
  Summary: String;

procedure Note(const Marker, Text: String);
begin
  Log(Marker + ': ' + Text);
  Notes := Notes + Text + #13#10;
end;

{ ---------- version helpers ---------- }

function NextNumber(var S: String): Integer;
var
  P: Integer;
  Part: String;
begin
  P := Pos('.', S);
  if P = 0 then begin Part := S; S := ''; end
  else begin Part := Copy(S, 1, P - 1); Delete(S, 1, P); end;
  Result := StrToIntDef(Trim(Part), 0);
end;

{ Compares dotted versions numerically; anything after '-' or '+' (pre-release, build) is ignored. }
function CompareVersions(A, B: String): Integer;
var
  P, I, X, Y: Integer;
begin
  P := Pos('-', A); if P > 0 then A := Copy(A, 1, P - 1);
  P := Pos('+', A); if P > 0 then A := Copy(A, 1, P - 1);
  P := Pos('-', B); if P > 0 then B := Copy(B, 1, P - 1);
  P := Pos('+', B); if P > 0 then B := Copy(B, 1, P - 1);
  Result := 0;
  for I := 1 to 4 do
  begin
    X := NextNumber(A); Y := NextNumber(B);
    if X > Y then begin Result := 1; Exit; end;
    if X < Y then begin Result := -1; Exit; end;
  end;
end;

function InstalledVersion(const AppId: String): String;
var
  Key: String;
begin
  Result := '';
  Key := UninstallRoot + '{' + AppId + '}_is1';
  if not RegQueryStringValue(HKLM32, Key, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM64, Key, 'DisplayVersion', Result) then
      if not RegQueryStringValue(HKCU, Key, 'DisplayVersion', Result) then
        Result := '';
end;

{ True when a newer copy than the bundled one is already installed (so it must not be replaced). }
function NewerInstalled(const Name, AppId, Bundled: String): Boolean;
var
  Have: String;
begin
  Have := InstalledVersion(AppId);
  Result := (Have <> '') and (CompareVersions(Have, Bundled) > 0);
#ifdef BREAK_DOWNGRADE_GUARD
  Result := False;
#endif
  if Result and (Pos('/ALLOWDOWNGRADE', Uppercase(GetCmdTail)) > 0) then
  begin
    Log('Downgrade of ' + Name + ' allowed by /ALLOWDOWNGRADE.');
    Result := False;
  end;
end;

{ ---------- environment checks ---------- }

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

function StoreEditionInstalled(): Boolean;
var
  Names: TArrayOfString;
  I: Integer;
begin
  Result := False;
  if RegGetSubkeyNames(HKCU, PackagesKey, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('{#StorePrefix}', Names[I]) = 1 then Result := True;
#ifdef BREAK_STORE_GUARD
  Result := False;
#endif
end;

function StandaloneVjsterPresent(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\Elgato\StreamDeck\Plugins\com.jbrick2070.vjster.sdPlugin')) or
            DirExists(ExpandConstant('{userappdata}\opendeck\plugins\com.jbrick2070.vjster.sdPlugin'));
#ifdef BREAK_VJSTER_GUARD
  Result := False;
#endif
end;

function OpenDeckPresent(): Boolean;
begin
  Result := DirExists(ExpandConstant('{userappdata}\opendeck'));
end;

function StreamDeckExe(): String;
begin
  Result := ExpandConstant('{commonpf64}\Elgato\StreamDeck\StreamDeck.exe');
  if not FileExists(Result) then Result := '';
end;

function AnyPluginSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('obs\mf') or WizardIsComponentSelected('obs\vs') or WizardIsComponentSelected('obs\pl');
end;

{ ---------- wizard ---------- }

procedure InitializeWizard();
begin
  Notes := '';
  if NewerInstalled('Midi Fadester', '{#MfAppId}', '{#MfVersion}') then
  begin
    WizardSelectComponents('!obs\mf');
    Note('SKIP-NEWER', 'Midi Fadester ' + InstalledVersion('{#MfAppId}') + ' is already installed; setup carries {#MfVersion}, so it is left as it is.');
  end;
  if NewerInstalled('Visual Sidechain', '{#VsAppId}', '{#VsVersion}') then
  begin
    WizardSelectComponents('!obs\vs');
    Note('SKIP-NEWER', 'Visual Sidechain ' + InstalledVersion('{#VsAppId}') + ' is already installed; setup carries {#VsVersion}, so it is left as it is.');
  end;
  if NewerInstalled('Playlister', '{#PlAppId}', '{#PlVersion}') then
  begin
    WizardSelectComponents('!obs\pl');
    Note('SKIP-NEWER', 'Playlister ' + InstalledVersion('{#PlAppId}') + ' is already installed; setup carries {#PlVersion}, so it is left as it is.');
  end;
  if StoreEditionInstalled() then
  begin
    WizardSelectComponents('!companion');
    Note('STORE-EDITION', 'The Microsoft Store edition of Fadester Companion is already installed, so the standalone copy is unticked: two copies would fight over the OBS connection and VJster port 48150.');
  end
  else if NewerInstalled('Fadester Companion', '{#CoAppId}', '{#CoVersion}') then
  begin
    WizardSelectComponents('!companion');
    Note('SKIP-NEWER', 'Fadester Companion ' + InstalledVersion('{#CoAppId}') + ' is already installed; setup carries {#CoVersion}, so it is left as it is.');
  end;
  if StandaloneVjsterPresent() then
    Note('VJSTER-CLASH', 'The standalone VJster plugin is installed. Fadester for OBS already includes VJster; keeping both makes them fight over port 48150, so remove the standalone VJster plugin in Stream Deck or OpenDeck.');
  if Notes <> '' then
    CreateOutputMsgMemoPage(wpWelcome, 'Before you choose', 'Setup checked what is already on this PC.',
      'Components that are already newer, or would clash, start unticked:', Notes);
end;

{ ---------- chaining ---------- }

function RunInstaller(const Name, FileName: String): String;
var
  Code: Integer;
begin
  Result := '';
  ExtractTemporaryFile(FileName);
  Log('Running ' + FileName);
  if not Exec(ExpandConstant('{tmp}\' + FileName), '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-', '', SW_HIDE, ewWaitUntilTerminated, Code) then
    Code := -1;
  if Code = 0 then
  begin
    Log('INSTALLED: ' + Name);
    Summary := Summary + Name + ' installed.' + #13#10;
  end
  else
  begin
    Log('FAILED: ' + Name + ' exit code ' + IntToStr(Code));
    Result := Name + ' did not install (exit code ' + IntToStr(Code) + '). Nothing after it was changed. Run setup again, or install ' + Name + ' on its own.';
  end;
end;

function ChainOne(const Component, Name, AppId, Version, FileName: String): String;
begin
  Result := '';
  if not WizardIsComponentSelected(Component) then Exit;
  if NewerInstalled(Name, AppId, Version) then
  begin
    Log('SKIP-NEWER: ' + Name + ' ' + InstalledVersion(AppId) + ' kept; bundled ' + Version + '.');
    Summary := Summary + Name + ' ' + InstalledVersion(AppId) + ' kept (newer than ' + Version + ').' + #13#10;
    Exit;
  end;
  Result := RunInstaller(Name, FileName);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Running: Boolean;
begin
  Result := '';
  Summary := '';
#ifndef BREAK_OBS_GUARD
  Running := AnyPluginSelected() and (ProcessRunning('obs64.exe') or ProcessRunning('obs32.exe'));
#else
  Running := False;
#endif
  if Running then
  begin
    Log('OBS-RUNNING: setup stopped before changing anything.');
    Result := 'OBS Studio is open. Close OBS Studio (File > Exit), then run setup again. Setup never closes OBS for you, so a live show is never cut.';
    Exit;
  end;
  // Today's names, and the ones the app had up to 0.1.3.
  if WizardIsComponentSelected('companion') and (ProcessRunning('FadesterCompanionBridge.exe') or ProcessRunning('Fadester Companion.exe')
    or ProcessRunning('FadesterTourBoxBridge.exe') or ProcessRunning('Fadester for TourBox.exe')) then
  begin
    Log('COMPANION-RUNNING: setup stopped before changing anything.');
    Result := 'Fadester Companion is running. Click Stop in Fadester Companion, close its window, and run setup again.';
    Exit;
  end;
  if WizardIsTaskSelected('opendeck') and ProcessRunning('opendeck.exe') then
  begin
    Log('OPENDECK-RUNNING: setup stopped before changing anything.');
    Result := 'OpenDeck is open. Close OpenDeck, then run setup again.';
    Exit;
  end;
  Result := ChainOne('obs\mf', 'Midi Fadester', '{#MfAppId}', '{#MfVersion}', '{#MfFile}'); if Result <> '' then Exit;
  Result := ChainOne('obs\vs', 'Visual Sidechain', '{#VsAppId}', '{#VsVersion}', '{#VsFile}'); if Result <> '' then Exit;
  Result := ChainOne('obs\pl', 'Playlister', '{#PlAppId}', '{#PlVersion}', '{#PlFile}'); if Result <> '' then Exit;
  Result := ChainOne('companion', 'Fadester Companion', '{#CoAppId}', '{#CoVersion}', '{#CoFile}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Package, Deck: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if WizardIsComponentSelected('streamdeck') then
  begin
    Package := ExpandConstant('{app}\packages\{#SdFile}');
    Deck := StreamDeckExe();
    if StandaloneVjsterPresent() then
      Log('VJSTER-CLASH: standalone VJster plugin still installed alongside Fadester for OBS.');
    if (Deck <> '') and not WizardSilent() then
    begin
      { Stream Deck installs the plugin itself, as the signed-in user, so its own files are never written behind its back. }
      if ShellExecAsOriginalUser('open', Package, '', '', SW_SHOWNORMAL, ewNoWait, Code) then
        Summary := Summary + 'Stream Deck is importing Fadester for OBS: confirm in Stream Deck.' + #13#10
      else
        Summary := Summary + 'Open ' + Package + ' to add Fadester for OBS to Stream Deck.' + #13#10;
    end
    else
      Summary := Summary + 'Fadester for OBS is ready at ' + Package + '. Open it once Stream Deck is installed.' + #13#10;
    if WizardIsTaskSelected('opendeck') then
      Summary := Summary + 'Fadester for OBS was added to OpenDeck. Start OpenDeck to use it.' + #13#10;
  end;
  if WizardIsComponentSelected('vjsterext') then
    Summary := Summary + 'VJster extension: in Chrome open chrome://extensions, turn on Developer mode, click Load unpacked and pick ' + ExpandConstant('{app}\vjster-extension') + '.' + #13#10;
  Log('Summary: ' + Summary);
  if (Summary <> '') and not WizardSilent() then
    MsgBox(Summary, mbInformation, MB_OK);
end;
