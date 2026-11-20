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
; Visual Sidechain is part of Midi Fadester since 0.9.0: there is no separate component; Midi Fadester's own installer
; removes the old standalone plugin, and setup says so when Midi Fadester is not run (unticked or already newer).
; Setup runs as administrator. On a PC where the signed-in person is a standard user, that is another account: the
; per-user checks (the Store edition, the standalone VJster plugin, OpenDeck) and the OpenDeck copy use the signed-in
; person's own settings and folders, not the administrator's (FindSignedInUser).
; Fadester for OBS in OpenDeck and the unpacked VJster extension are never replaced by an older copy either.
; Log markers (for tests and support): OBS-RUNNING, COMPANION-RUNNING, OPENDECK-RUNNING, SKIP-NEWER, STORE-EDITION,
; VJSTER-CLASH, OLD-VS, ORIGINAL-USER, INSTALLED, FAILED.

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
; The OpenDeck task writes to the signed-in user's own OpenDeck folder on purpose ({code:OpenDeckPlugins}).
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
Name: "obs\mf"; Description: "Midi Fadester {#MfVersion}: for an APC40 or another MIDI controller (includes Visual Sidechain)"; Types: full
Name: "obs\pl"; Description: "Playlister {#PlVersion}: playlists of video and audio files as an OBS source"; Types: full
Name: "companion"; Description: "Fadester Companion {#CoVersion}: for a TourBox or a game controller (also whole-mix audio)"; Types: full
Name: "streamdeck"; Description: "Fadester for OBS {#SdVersion}: for a Stream Deck or OpenDeck (includes VJster)"; Types: full
Name: "vjsterext"; Description: "VJster Chrome extension {#ExtVersion}: YouTube speed and quality from your controller (unpacked, for Load unpacked)"; Types: full

[Tasks]
Name: "opendeck"; Description: "Add Fadester for OBS to OpenDeck"; Components: streamdeck; Check: OpenDeckPresent

[Files]
; Standalone installers, extracted and run one by one during "Preparing to install".
Source: "{#Stage}\{#MfFile}"; Flags: dontcopy
Source: "{#Stage}\{#PlFile}"; Flags: dontcopy
Source: "{#Stage}\{#CoFile}"; Flags: dontcopy
; Fadester for OBS package: Stream Deck imports it with its own installer when it is opened.
Source: "{#Stage}\{#SdFile}"; DestDir: "{app}\packages"; Components: streamdeck; Flags: ignoreversion
Source: "{#Stage}\sdplugin\*"; DestDir: "{code:OpenDeckPlugins}"; Tasks: opendeck; Check: OpenDeckCopyWanted; Flags: ignoreversion recursesubdirs createallsubdirs uninsneveruninstall
Source: "{#Stage}\vjster-extension\*"; DestDir: "{app}\vjster-extension"; Components: vjsterext; Check: ExtensionCopyWanted; Flags: ignoreversion recursesubdirs createallsubdirs

[Code]
const
  UninstallRoot = 'Software\Microsoft\Windows\CurrentVersion\Uninstall\';
  PackagesKey = 'Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppModel\Repository\Packages';

var
  Notes: String;
  Summary: String;
  { The person signed in at this PC, when setup was elevated with another account's credentials (FindSignedInUser). }
  SignedInChecked: Boolean;
  SignedInSid, SignedInAppData: String;
  { Decided once per setup run: 0 not yet, 1 copy, 2 keep the newer copy that is installed. }
  OpenDeckCopy, ExtensionCopy: Integer;

function ProcessIdToSessionId(ProcessId: DWORD; var SessionId: DWORD): BOOL;
  external 'ProcessIdToSessionId@kernel32.dll stdcall';
function GetCurrentProcessId(): DWORD;
  external 'GetCurrentProcessId@kernel32.dll stdcall';

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

{ ---------- the signed-in person ---------- }

{ Setup always runs as administrator. A standard user gets there by typing an administrator's name and password, and
  setup then runs as that administrator: HKCU and the user folders are the administrator's, not the person's who will
  use the suite. The person signed in is the one whose settings hive has this Windows session in it; their profile
  folder comes from the system's own list (HKLM ProfileList), which only an administrator can change. When that
  person and the elevated account are the same (the usual case), nothing differs. }
procedure FindSignedInUser();
var
  Names: TArrayOfString;
  I, Changed: Integer;
  Session: DWORD;
  Profile: String;
begin
  if SignedInChecked then Exit;
  SignedInChecked := True;
  SignedInSid := '';
  SignedInAppData := ExpandConstant('{userappdata}');
  Session := 0;
  Changed := 0;
  if not ProcessIdToSessionId(GetCurrentProcessId(), Session) then Exit;
  if not RegGetSubkeyNames(HKEY_USERS, '', Names) then Exit;
  for I := 0 to GetArrayLength(Names) - 1 do
    if ((Pos('S-1-5-21-', Names[I]) = 1) or (Pos('S-1-12-1-', Names[I]) = 1)) and (Pos('_Classes', Names[I]) = 0) then
      if (SignedInSid = '') and RegKeyExists(HKEY_USERS, Names[I] + '\Volatile Environment\' + IntToStr(Session)) then
        SignedInSid := Names[I];
  if SignedInSid = '' then Exit;
  Profile := '';
  if RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\' + SignedInSid, 'ProfileImagePath', Profile) then
  begin
    Changed := StringChangeEx(Profile, '%SystemDrive%', ExpandConstant('{sd}'), True);
    if (Changed >= 0) and (Profile <> '') and DirExists(Profile + '\AppData\Roaming') then
      SignedInAppData := Profile + '\AppData\Roaming';
  end;
  if CompareText(SignedInAppData, ExpandConstant('{userappdata}')) <> 0 then
    Log('ORIGINAL-USER: setup was elevated with another account; per-user checks and the OpenDeck copy use ' + SignedInAppData + '.');
end;

{ The signed-in person's Roaming AppData folder. }
function UserAppData(): String;
begin
  FindSignedInUser();
  Result := SignedInAppData;
end;

function OpenDeckPlugins(Param: String): String;
begin
  Result := UserAppData() + '\opendeck\plugins';
end;

function InstalledVersion(const AppId: String): String;
var
  Key: String;
begin
  Result := '';
  Key := UninstallRoot + '{' + AppId + '}_is1';
  FindSignedInUser();
  if not RegQueryStringValue(HKLM32, Key, 'DisplayVersion', Result) then
    if not RegQueryStringValue(HKLM64, Key, 'DisplayVersion', Result) then
      if not RegQueryStringValue(HKCU, Key, 'DisplayVersion', Result) then
        if (SignedInSid = '') or not RegQueryStringValue(HKEY_USERS, SignedInSid + '\' + Key, 'DisplayVersion', Result) then
          Result := '';
end;

{ The version a manifest names: "Version": "0.12.16.0" in a Stream Deck plugin, "version": "0.1.6" in a Chrome
  extension. The first value under that name that looks like a version (it has a dot) counts, so the Node.js
  "Version": "24" further down a plugin's manifest is passed over. '' when the file or the field is missing. }
function ManifestVersion(const FileName, Field: String): String;
var
  Raw: AnsiString;
  Text, Value: String;
  P, Q, Guard: Integer;
begin
  Result := '';
  if not LoadStringFromFile(FileName, Raw) then Exit;
  Text := String(Raw);
  Guard := 0;
  while (Result = '') and (Guard < 50) do
  begin
    Guard := Guard + 1;
    P := Pos('"' + Field + '"', Text);
    if P = 0 then Exit;
    Delete(Text, 1, P + Length(Field) + 1);
    P := Pos('"', Text);
    if P = 0 then Exit;
    Value := Copy(Text, P + 1, Length(Text));
    Q := Pos('"', Value);
    if Q = 0 then Exit;
    Value := Copy(Value, 1, Q - 1);
    if (Pos('.', Value) > 0) and (Length(Value) < 40) then Result := Value;
  end;
end;

{ True when the copy on disk is newer than the one this setup carries: it is kept, as for the plugins. }
function NewerOnDisk(const Name, ManifestFile, Field, Bundled: String): Boolean;
var
  Have: String;
begin
  Have := ManifestVersion(ManifestFile, Field);
  Result := (Have <> '') and (CompareVersions(Have, Bundled) > 0);
  if Result and (Pos('/ALLOWDOWNGRADE', Uppercase(GetCmdTail)) > 0) then
  begin
    Log('Downgrade of ' + Name + ' allowed by /ALLOWDOWNGRADE.');
    Result := False;
  end;
  if Result then
    Note('SKIP-NEWER', Name + ' ' + Have + ' is already there; setup carries ' + Bundled + ', so it is left as it is.');
end;

{ [Files] asks once per file: the answer is worked out once, so the note and the log line appear once. }
function OpenDeckCopyWanted(): Boolean;
begin
  if OpenDeckCopy = 0 then
  begin
    OpenDeckCopy := 1;
    if NewerOnDisk('Fadester for OBS in OpenDeck', UserAppData() + '\opendeck\plugins\io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json', 'Version', '{#SdVersion}') then
      OpenDeckCopy := 2;
  end;
  Result := OpenDeckCopy = 1;
end;

function ExtensionCopyWanted(): Boolean;
begin
  if ExtensionCopy = 0 then
  begin
    ExtensionCopy := 1;
    { Not {app}: this can be asked before the folder is settled. It is fixed (DisableDirPage). }
    if NewerOnDisk('The VJster Chrome extension', ExpandConstant('{commonappdata}\Fadester Suite\vjster-extension\manifest.json'), 'version', '{#ExtVersion}') then
      ExtensionCopy := 2;
  end;
  Result := ExtensionCopy = 1;
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
  { The Store keeps its packages per user: the signed-in person's, not those of the administrator setup runs as. }
  FindSignedInUser();
  if RegGetSubkeyNames(HKCU, PackagesKey, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('{#StorePrefix}', Names[I]) = 1 then Result := True;
  if (SignedInSid <> '') and RegGetSubkeyNames(HKEY_USERS, SignedInSid + '\' + PackagesKey, Names) then
    for I := 0 to GetArrayLength(Names) - 1 do
      if Pos('{#StorePrefix}', Names[I]) = 1 then Result := True;
#ifdef BREAK_STORE_GUARD
  Result := False;
#endif
end;

function StandaloneVjsterPresent(): Boolean;
begin
  Result := DirExists(UserAppData() + '\Elgato\StreamDeck\Plugins\com.jbrick2070.vjster.sdPlugin') or
            DirExists(UserAppData() + '\opendeck\plugins\com.jbrick2070.vjster.sdPlugin');
#ifdef BREAK_VJSTER_GUARD
  Result := False;
#endif
end;

{ The standalone Visual Sidechain (0.8.0 and older), retired when Midi Fadester 0.9.0 took it in. }
const
  OldVsAppId = '7C4A92E8-4B19-4F03-9A56-3D8E21B05C7F';

function OldVisualSidechainPresent(): Boolean;
begin
  Result := (InstalledVersion(OldVsAppId) <> '') or
            DirExists(ExpandConstant('{commonappdata}\obs-studio\plugins\visual-sidechain'));
end;

{ After setup, only the plugin folder counts: an old uninstall entry whose uninstaller is gone can outlive the plugin. }
function OldVisualSidechainFolderPresent(): Boolean;
begin
  Result := DirExists(ExpandConstant('{commonappdata}\obs-studio\plugins\visual-sidechain'));
end;

function OpenDeckPresent(): Boolean;
begin
  Result := DirExists(UserAppData() + '\opendeck');
end;

function StreamDeckExe(): String;
begin
  Result := ExpandConstant('{commonpf64}\Elgato\StreamDeck\StreamDeck.exe');
  if not FileExists(Result) then Result := '';
end;

function AnyPluginSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('obs\mf') or WizardIsComponentSelected('obs\pl');
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
  if OldVisualSidechainPresent() then
    Note('OLD-VS', 'The old separate Visual Sidechain plugin is installed. Visual Sidechain is part of Midi Fadester now: keep Midi Fadester ticked and its installer removes the old plugin. If Midi Fadester is not installed by this setup, remove Visual Sidechain in Windows Installed apps.');
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

{ What to do next with a part that was just installed, for the last message of setup. }
function NextStep(const Name: String): String;
begin
  Result := '';
  if Name = 'Midi Fadester' then Result := ' Start OBS, then open Tools > Midi Fadester.'
  else if Name = 'Playlister' then Result := ' Start OBS, then add a Playlister source with the + under Sources.'
  else if Name = 'Fadester Companion' then Result := ' Open Fadester Companion from the Start menu: it finds OBS and starts its controls by itself.';
end;

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
    Summary := Summary + Name + ' installed.' + NextStep(Name) + #13#10;
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
  Result := ChainOne('obs\pl', 'Playlister', '{#PlAppId}', '{#PlVersion}', '{#PlFile}'); if Result <> '' then Exit;
  Result := ChainOne('companion', 'Fadester Companion', '{#CoAppId}', '{#CoVersion}', '{#CoFile}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Package, Deck: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if OldVisualSidechainFolderPresent() then
  begin
    Log('OLD-VS: the old separate Visual Sidechain plugin is still installed after setup.');
    Summary := Summary + 'The old separate Visual Sidechain plugin is still installed. Visual Sidechain is part of Midi Fadester now: remove the old one in Windows Installed apps, or run the Midi Fadester installer again with OBS closed.' + #13#10;
  end;
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
    begin
      if OpenDeckCopy = 2 then
        Summary := Summary + 'OpenDeck already has a newer Fadester for OBS; it was kept.' + #13#10
      else
        Summary := Summary + 'Fadester for OBS was added to OpenDeck. Start OpenDeck to use it.' + #13#10;
    end;
  end;
  if WizardIsComponentSelected('vjsterext') and (ExtensionCopy = 2) then
    Summary := Summary + 'A newer VJster extension is already in ' + ExpandConstant('{app}\vjster-extension') + '; it was kept. Load that folder in Chrome (chrome://extensions, Developer mode, Load unpacked).' + #13#10
  else if WizardIsComponentSelected('vjsterext') then
    Summary := Summary + 'VJster extension: in Chrome open chrome://extensions, turn on Developer mode, click Load unpacked and pick ' + ExpandConstant('{app}\vjster-extension') + '.' + #13#10;
  Log('Summary: ' + Summary);
  if (Summary <> '') and not WizardSilent() then
    MsgBox(Summary, mbInformation, MB_OK);
end;
