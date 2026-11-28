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
; First run, with the wizard on screen: the components start ticked from what this PC has (PretickFromThisPc). OBS
; Studio missing unticks the OBS plugins; no Stream Deck app and no OpenDeck unticks Fadester for OBS; no TourBox
; Console and no game controller unticks Fadester Companion. Each is said on the "Before you choose" page and can be
; ticked again. A silent run, /COMPONENTS or /TYPE, and a PC where this setup ran before keep the choice already made.
; Languages: the suite's 13. English is in [CustomMessages] below; the others are in installer\lang\<code>.isl, one
; file per language for this setup and FadesterCompanion.iss together (tests/companion-installer-languages.test.ts
; checks that none lacks a message). Setup opens in the Windows display language, without asking. The log stays in
; English whatever the language.
; Log markers (for tests and support): OBS-RUNNING, COMPANION-RUNNING, OPENDECK-RUNNING, SKIP-NEWER, STORE-EDITION,
; VJSTER-CLASH, OLD-ID-PLUGIN, BOTH-IDS, OLD-VS, ORIGINAL-USER, DETECTED, PRETICK, INSTALLED, FAILED.

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
; The Windows display language when it is one of the 13, else English (the first language listed). "no": never a
; language question; "auto" would ask on a Windows whose language is none of the 13.
ShowLanguageDialog=no
; The OpenDeck task writes to the signed-in user's own OpenDeck folder on purpose ({code:OpenDeckPlugins}).
UsedUserAreasWarning=no
#ifdef SIGN
SignTool=fadester
#endif

[Languages]
#include "lang\languages.iss"

[CustomMessages]
; English. Every key here is also in each installer\lang\<code>.isl.
TypeFull=Everything
TypeCustom=Choose components
CompObs=OBS Studio 33 plugins (each keeps its own uninstall entry)
CompMf=Midi Fadester %1: for an APC40 or another MIDI controller (includes Visual Sidechain)
CompPl=Playlister %1: playlists of video and audio files as an OBS source
CompCo=Fadester Companion %1: for a TourBox or a game controller (also whole-mix audio)
CompSd=Fadester for OBS %1: for a Stream Deck or OpenDeck (includes VJster)
CompExt=VJster Chrome extension %1: YouTube speed and quality from your controller (unpacked, for Load unpacked)
TaskOpenDeck=Add Fadester for OBS to OpenDeck
OpenCompanion=Open Fadester Companion
BeforeTitle=Before you choose
BeforeSub=Setup checked what is already on this PC.
BeforeIntro=Components that are already newer, or would clash, start unticked:
NoteNewer=%1 %2 is already installed; setup carries %3, so it is left as it is.
NoteNewerOpenDeck=Fadester for OBS %1 is already in OpenDeck; setup carries %2, so it is left as it is.
NoteNewerExt=VJster Chrome extension %1 is already there; setup carries %2, so it is left as it is.
NoteNewerSd=Fadester for OBS %1 is already in Stream Deck; setup carries %2, so Stream Deck is not asked to replace it.
NoteOldVs=The old separate Visual Sidechain plugin is installed. Visual Sidechain is part of Midi Fadester now: keep Midi Fadester ticked and its installer removes the old plugin. If Midi Fadester is not installed by this setup, remove Visual Sidechain in Windows Installed apps.
NoteStore=The Microsoft Store edition of Fadester Companion is already installed, so the standalone copy is unticked: two copies would fight over the OBS connection and VJster port 48150.
NoteOldIdSd=An older Fadester for OBS%1, from before version 0.10, is in Stream Deck, so setup adds no second copy (it carries %2). In Stream Deck, open Preferences > Plugins, right-click the older Fadester for OBS and choose Uninstall, then run this setup again. Keys and dials placed from the older copy then show a question mark and need placing again.
NoteBothSd=Fadester for OBS is in Stream Deck twice: an older copy%1, from before version 0.10, and the current one. In Stream Deck, open Preferences > Plugins, right-click the one with the lower version number and choose Uninstall. Keys and dials placed from it then show a question mark and need placing again.
NoteVjsterClash=The standalone VJster plugin is installed. Fadester for OBS already includes VJster; keeping both makes them fight over port 48150, so remove the standalone VJster plugin in Stream Deck or OpenDeck.
NoteNoObs=OBS Studio was not found on this PC, so the OBS plugins start unticked. Tick them if your OBS is in another folder.
NoteNoDeck=No Stream Deck app and no OpenDeck were found, so Fadester for OBS starts unticked. Tick it if you want it anyway.
NoteNoController=No TourBox Console and no game controller were found, so Fadester Companion starts unticked. Tick it if you want it anyway.
StopObsOpen=OBS Studio is open. Close OBS Studio (File > Exit), then run setup again. Setup never closes OBS for you, so a live show is never cut.
StopCompanionRunning=Fadester Companion is running. Click Stop in Fadester Companion and close its window (or choose Quit from its icon beside the clock), then run setup again.
StopOpenDeckOpen=OpenDeck is open. Close OpenDeck, then run setup again.
DoneInstalled=%1 installed.
DoneNextMf=Start OBS, then open Tools > Midi Fadester.
DoneNextPl=Start OBS, then add a Playlister source with the + under Sources.
DoneNextCo=Open Fadester Companion from the Start menu: it finds OBS and starts its controls by itself.
DoneFailed=%1 did not install (exit code %2). Nothing after it was changed. Run setup again, or install %1 on its own.
DoneKept=%1 %2 kept (newer than %3).
DoneOldVs=The old separate Visual Sidechain plugin is still installed. Visual Sidechain is part of Midi Fadester now: remove the old one in Windows Installed apps, or run the Midi Fadester installer again with OBS closed.
DoneSdImporting=Stream Deck is importing Fadester for OBS: confirm in Stream Deck.
DoneSdOpen=Open %1 to add Fadester for OBS to Stream Deck.
DoneSdReady=Fadester for OBS is ready at %1. Open it once Stream Deck is installed.
DoneOpenDeckKept=OpenDeck already has a newer Fadester for OBS; it was kept.
DoneOpenDeckAdded=Fadester for OBS was added to OpenDeck. Start OpenDeck to use it.
DoneExtKept=A newer VJster extension is already in %1; it was kept. Load that folder in Chrome (chrome://extensions, Developer mode, Load unpacked).
DoneExtLoad=VJster extension: in Chrome open chrome://extensions, turn on Developer mode, click Load unpacked and pick %1.

[Types]
Name: "full"; Description: "{cm:TypeFull}"
Name: "custom"; Description: "{cm:TypeCustom}"; Flags: iscustom

[Components]
Name: "obs"; Description: "{cm:CompObs}"; Types: full
Name: "obs\mf"; Description: "{cm:CompMf,{#MfVersion}}"; Types: full
Name: "obs\pl"; Description: "{cm:CompPl,{#PlVersion}}"; Types: full
Name: "companion"; Description: "{cm:CompCo,{#CoVersion}}"; Types: full
Name: "streamdeck"; Description: "{cm:CompSd,{#SdVersion}}"; Types: full
Name: "vjsterext"; Description: "{cm:CompExt,{#ExtVersion}}"; Types: full

[Tasks]
Name: "opendeck"; Description: "{cm:TaskOpenDeck}"; Components: streamdeck; Check: OpenDeckPresent

[Run]
; The last page offers to open Fadester Companion when this run installed it (its own installer ran silently, so its
; own "Open" tick box never showed). It opens as the person signed in, not as the administrator.
Filename: "{code:CompanionExe}"; Description: "{cm:OpenCompanion}"; Flags: nowait postinstall skipifsilent runasoriginaluser; Check: CompanionJustInstalled

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
  { Decided once per setup run: 0 not yet, 1 copy, 2 keep the newer copy that is installed. For StreamDeckOffer also
    3: Fadester for OBS under its pre-0.10 ID is in Stream Deck and this setup's is not, so no second copy is offered. }
  OpenDeckCopy, ExtensionCopy, StreamDeckOffer: Integer;
  { Stream Deck holds Fadester for OBS under both IDs, the pre-0.10 one and this setup's: said on the first and on the
    last page. }
  BothIds: Boolean;
  { Set when this run installed Fadester Companion: the last page then offers to open it. }
  CompanionInstalledNow: Boolean;

function ProcessIdToSessionId(ProcessId: DWORD; var SessionId: DWORD): BOOL;
  external 'ProcessIdToSessionId@kernel32.dll stdcall';
function GetCurrentProcessId(): DWORD;
  external 'GetCurrentProcessId@kernel32.dll stdcall';

{ LogText is English whatever the language (tests and support read the log); Shown is what the person reads. }
procedure Note(const Marker, LogText, Shown: String);
begin
  Log(Marker + ': ' + LogText);
  Notes := Notes + Shown + #13#10;
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
{ The account that owns Explorer (the desktop) in this Windows session, as a SID; '' when it cannot be told. }
function DesktopOwnerSid(Session: DWORD): String;
var
  Locator, Service, Found, Shell, Answer: Variant;
begin
  Result := '';
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Found := Service.ExecQuery('SELECT * FROM Win32_Process WHERE Name = ''explorer.exe'' AND SessionId = ' + IntToStr(Session));
    if Found.Count > 0 then
    begin
      Shell := Found.ItemIndex(0);
      Answer := Shell.ExecMethod_('GetOwnerSid');
      if not VarIsNull(Answer.Sid) then Result := Answer.Sid;
    end;
  except
    Log('Could not ask who owns the desktop: ' + GetExceptionMessage);
    Result := '';
  end;
end;

procedure FindSignedInUser();
var
  Names: TArrayOfString;
  I, Changed: Integer;
  Session: DWORD;
  Profile, Owner: String;
begin
  if SignedInChecked then Exit;
  SignedInChecked := True;
  SignedInSid := '';
  SignedInAppData := ExpandConstant('{userappdata}');
  Session := 0;
  Changed := 0;
  if not ProcessIdToSessionId(GetCurrentProcessId(), Session) then Exit;
  if not RegGetSubkeyNames(HKEY_USERS, '', Names) then Exit;
  { First choice: whoever owns the desktop of this session. An elevating administrator's settings can carry this
    session's key as well, so the first match in the list below could be the administrator. }
  Owner := DesktopOwnerSid(Session);
  if (Owner <> '') and RegKeyExists(HKEY_USERS, Owner) then SignedInSid := Owner;
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

{ The version a manifest names: "Version": "1.5.0.0" in a Stream Deck plugin, "version": "1.5.0" in a Chrome
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
function NewerOnDisk(const Name, ShownKey, ManifestFile, Field, Bundled: String): Boolean;
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
    Note('SKIP-NEWER', Name + ' ' + Have + ' is already there; setup carries ' + Bundled + ', so it is left as it is.',
      FmtMessage(CustomMessage(ShownKey), [Have, Bundled]));
end;

{ [Files] asks once per file: the answer is worked out once, so the note and the log line appear once. }
function OpenDeckCopyWanted(): Boolean;
begin
  if OpenDeckCopy = 0 then
  begin
    OpenDeckCopy := 1;
    if NewerOnDisk('Fadester for OBS in OpenDeck', 'NoteNewerOpenDeck', UserAppData() + '\opendeck\plugins\io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json', 'Version', '{#SdVersion}') then
      OpenDeckCopy := 2;
  end;
  Result := OpenDeckCopy = 1;
end;

{ Up to 0.9.x Fadester for OBS had another ID, com.jbrick2070.fadester-for-obs. Stream Deck holds the two IDs as two
  plugins: both in the action list, their VJster parts contending for port 48150. Its folder in Stream Deck is what
  counts, when there is something in it: the manifest is not relied on, so a copy whose manifest cannot be read is
  still seen (to be safe; no such copy is known), and an empty folder is not a plugin. }
function OldIdPluginPresent(): Boolean;
var
  Found: TFindRec;
begin
  Result := False;
  if FindFirst(UserAppData() + '\Elgato\StreamDeck\Plugins\com.jbrick2070.fadester-for-obs.sdPlugin\*', Found) then
  begin
    try
      repeat
        if (Found.Name <> '.') and (Found.Name <> '..') then Result := True;
      until Result or not FindNext(Found);
    finally
      FindClose(Found);
    end;
  end;
#ifdef BREAK_OLDID_GUARD
  Result := False;
#endif
end;

{ Its version in brackets with a space before, for a sentence: ' (0.9.0.0)'. Nothing when it cannot be read. }
function OldIdPluginInBrackets(): String;
begin
  Result := ManifestVersion(UserAppData() + '\Elgato\StreamDeck\Plugins\com.jbrick2070.fadester-for-obs.sdPlugin\manifest.json', 'Version');
  if Result <> '' then Result := ' (' + Result + ')';
end;

{ Stream Deck is asked to import the bundled Fadester for OBS only when it does not already hold a newer one, and
  not when it holds the pre-0.10 copy alone: that would add a second copy of the same plugin. Where both IDs are
  there already, this setup's copy is handled as always and the person is told to uninstall the older one. }
function StreamDeckOfferWanted(): Boolean;
var
  OwnManifest: String;
begin
  if StreamDeckOffer = 0 then
  begin
    StreamDeckOffer := 1;
    OwnManifest := UserAppData() + '\Elgato\StreamDeck\Plugins\io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json';
    if OldIdPluginPresent() and not FileExists(OwnManifest) then
    begin
      StreamDeckOffer := 3;
      Note('OLD-ID-PLUGIN', 'An older Fadester for OBS' + OldIdPluginInBrackets() + ', from before version 0.10, is in Stream Deck; no second copy is offered (setup carries {#SdVersion}).',
        FmtMessage(CustomMessage('NoteOldIdSd'), [OldIdPluginInBrackets(), '{#SdVersion}']));
    end
    else
    begin
      if OldIdPluginPresent() then
      begin
        BothIds := True;
        Note('BOTH-IDS', 'Fadester for OBS is in Stream Deck twice: an older copy' + OldIdPluginInBrackets() + ', from before version 0.10, and this setup''s.',
          FmtMessage(CustomMessage('NoteBothSd'), [OldIdPluginInBrackets()]));
      end;
      if NewerOnDisk('Fadester for OBS in Stream Deck', 'NoteNewerSd', OwnManifest, 'Version', '{#SdVersion}') then
        StreamDeckOffer := 2;
    end;
  end;
  Result := StreamDeckOffer = 1;
end;

function ExtensionCopyWanted(): Boolean;
begin
  if ExtensionCopy = 0 then
  begin
    ExtensionCopy := 1;
    // Not the app constant: this can be asked before the folder is settled. It is fixed (DisableDirPage).
    if NewerOnDisk('The VJster Chrome extension', 'NoteNewerExt', ExpandConstant('{commonappdata}\Fadester Suite\vjster-extension\manifest.json'), 'version', '{#ExtVersion}') then
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

{ ---------- what this PC has: the components start ticked from it (UI review U3-07) ---------- }

type
  { XINPUT_STATE: a packet number and the controller's 12 bytes of buttons, triggers and sticks. }
  TPadState = record
    Packet, A, B, C: DWORD;
  end;

function XInputGetState(Index: DWORD; var State: TPadState): DWORD;
  external 'XInputGetState@xinput1_4.dll stdcall delayload';

{ An Xbox or other XInput game controller that is plugged in or switched on now. }
function GamepadConnected(): Boolean;
var
  I: Integer;
  State: TPadState;
begin
  Result := False;
  try
    for I := 0 to 3 do
      if XInputGetState(I, State) = 0 then Result := True;
  except
    Log('Could not look for a game controller: ' + GetExceptionMessage);
    Result := False;
  end;
end;

function TourBoxConsolePresent(): Boolean;
begin
  Result := FileExists(ExpandConstant('{commonpf64}\TourBox Console\TourBox Console.exe')) or
            FileExists(ExpandConstant('{commonpf32}\TourBox Console\TourBox Console.exe'));
end;

{ OBS Studio: its installer's own registry entry, its usual folder, the settings folder it makes on first start, or OBS running now. }
function ObsPresent(): Boolean;
var
  Folder: String;
begin
  Result := RegQueryStringValue(HKLM32, 'SOFTWARE\OBS Studio', '', Folder) or RegQueryStringValue(HKLM64, 'SOFTWARE\OBS Studio', '', Folder) or
            FileExists(ExpandConstant('{commonpf64}\obs-studio\bin\64bit\obs64.exe')) or DirExists(UserAppData() + '\obs-studio') or
            ProcessRunning('obs64.exe');
end;

{ The Stream Deck app (its program or the signed-in person's settings folder) or OpenDeck. }
function DeckAppPresent(): Boolean;
begin
  Result := (StreamDeckExe() <> '') or DirExists(UserAppData() + '\Elgato\StreamDeck') or OpenDeckPresent();
end;

{ A choice that is already made and must stand: a silent run, components or a type named on the command line, or an
  earlier run of this setup on this PC (the wizard then starts from what was chosen that time). }
function ChoiceAlreadyMade(): Boolean;
var
  Tail: String;
begin
  Tail := Uppercase(GetCmdTail);
  Result := WizardSilent() or (Pos('/COMPONENTS=', Tail) > 0) or (Pos('/TYPE=', Tail) > 0) or (Pos('/LOADINF=', Tail) > 0) or
            (InstalledVersion('{#SuiteAppId}') <> '');
end;

function YesNo(const Value: Boolean): String;
begin
  if Value then Result := 'yes' else Result := 'no';
end;

{ What is found stays ticked, what is not found starts unticked and is named on the "Before you choose" page. A part
  of the suite that is already installed counts as found, so an update is never unticked. }
procedure PretickFromThisPc();
var
  HasObs, HasDeck, HasController: Boolean;
begin
  if ChoiceAlreadyMade() then
  begin
    Log('PRETICK: not applied (a silent run, the command line or an earlier run of this setup decides).');
    Exit;
  end;
  HasObs := ObsPresent() or (InstalledVersion('{#MfAppId}') <> '') or (InstalledVersion('{#PlAppId}') <> '');
  HasDeck := DeckAppPresent();
  HasController := TourBoxConsolePresent() or GamepadConnected() or (InstalledVersion('{#CoAppId}') <> '');
  Log('DETECTED: obs=' + YesNo(HasObs) + ' deck=' + YesNo(HasDeck) + ' controller=' + YesNo(HasController));
  { Nothing found says nothing about what this person has: everything stays ticked, as before. }
  if not (HasObs or HasDeck or HasController) then Exit;
  if not HasObs then
  begin
    WizardSelectComponents('!obs\mf,!obs\pl,!obs');
    Note('PRETICK', 'OBS Studio was not found, so the OBS plugins start unticked.', CustomMessage('NoteNoObs'));
  end;
  if not HasDeck then
  begin
    WizardSelectComponents('!streamdeck');
    Note('PRETICK', 'No Stream Deck app and no OpenDeck were found, so Fadester for OBS starts unticked.', CustomMessage('NoteNoDeck'));
  end;
  if not HasController then
  begin
    WizardSelectComponents('!companion');
    Note('PRETICK', 'No TourBox Console and no game controller were found, so Fadester Companion starts unticked.', CustomMessage('NoteNoController'));
  end;
  { The Chrome extension is driven from a deck or from Fadester Companion: with neither, it starts unticked too. }
  if not HasDeck and not HasController then
  begin
    WizardSelectComponents('!vjsterext');
    Log('PRETICK: the VJster Chrome extension starts unticked (no deck app and no controller).');
  end;
end;

function AnyPluginSelected(): Boolean;
begin
  Result := WizardIsComponentSelected('obs\mf') or WizardIsComponentSelected('obs\pl');
end;

{ Where this run's Fadester Companion installer put the app (its own uninstall entry says so). }
function CompanionExe(Param: String): String;
var
  Folder: String;
begin
  Folder := '';
  if not RegQueryStringValue(HKLM64, UninstallRoot + '{' + '{#CoAppId}' + '}_is1', 'Inno Setup: App Path', Folder) then
    Folder := ExpandConstant('{commonpf64}\Fadester Companion');
  Result := AddBackslash(Folder) + 'Fadester Companion.exe';
end;

function CompanionJustInstalled(): Boolean;
begin
  Result := CompanionInstalledNow and FileExists(CompanionExe(''));
end;

{ ---------- wizard ---------- }

procedure InitializeWizard();
begin
  Notes := '';
  CompanionInstalledNow := False;
  PretickFromThisPc();
  if NewerInstalled('Midi Fadester', '{#MfAppId}', '{#MfVersion}') then
  begin
    WizardSelectComponents('!obs\mf');
    Note('SKIP-NEWER', 'Midi Fadester ' + InstalledVersion('{#MfAppId}') + ' is already installed; setup carries {#MfVersion}, so it is left as it is.',
      FmtMessage(CustomMessage('NoteNewer'), ['Midi Fadester', InstalledVersion('{#MfAppId}'), '{#MfVersion}']));
  end;
  if OldVisualSidechainPresent() then
    Note('OLD-VS', 'The old separate Visual Sidechain plugin is installed.', CustomMessage('NoteOldVs'));
  if NewerInstalled('Playlister', '{#PlAppId}', '{#PlVersion}') then
  begin
    WizardSelectComponents('!obs\pl');
    Note('SKIP-NEWER', 'Playlister ' + InstalledVersion('{#PlAppId}') + ' is already installed; setup carries {#PlVersion}, so it is left as it is.',
      FmtMessage(CustomMessage('NoteNewer'), ['Playlister', InstalledVersion('{#PlAppId}'), '{#PlVersion}']));
  end;
  if StoreEditionInstalled() then
  begin
    WizardSelectComponents('!companion');
    Note('STORE-EDITION', 'The Microsoft Store edition of Fadester Companion is already installed, so the standalone copy is unticked.', CustomMessage('NoteStore'));
  end
  else if NewerInstalled('Fadester Companion', '{#CoAppId}', '{#CoVersion}') then
  begin
    WizardSelectComponents('!companion');
    Note('SKIP-NEWER', 'Fadester Companion ' + InstalledVersion('{#CoAppId}') + ' is already installed; setup carries {#CoVersion}, so it is left as it is.',
      FmtMessage(CustomMessage('NoteNewer'), ['Fadester Companion', InstalledVersion('{#CoAppId}'), '{#CoVersion}']));
  end;
  if StandaloneVjsterPresent() then
    Note('VJSTER-CLASH', 'The standalone VJster plugin is installed; with Fadester for OBS they fight over port 48150.', CustomMessage('NoteVjsterClash'));
  { Decided here, not first while files are copied, so a newer copy that will be kept is on this page too. }
  StreamDeckOfferWanted();
  ExtensionCopyWanted();
  if OpenDeckPresent() then OpenDeckCopyWanted();
  if Notes <> '' then
    CreateOutputMsgMemoPage(wpWelcome, CustomMessage('BeforeTitle'), CustomMessage('BeforeSub'), CustomMessage('BeforeIntro'), Notes);
end;

{ ---------- chaining ---------- }

{ What to do next with a part that was just installed, for the last message of setup. }
function NextStep(const Name: String): String;
begin
  Result := '';
  if Name = 'Midi Fadester' then Result := ' ' + CustomMessage('DoneNextMf')
  else if Name = 'Playlister' then Result := ' ' + CustomMessage('DoneNextPl')
  else if Name = 'Fadester Companion' then Result := ' ' + CustomMessage('DoneNextCo');
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
    if Name = 'Fadester Companion' then CompanionInstalledNow := True;
    Summary := Summary + FmtMessage(CustomMessage('DoneInstalled'), [Name]) + NextStep(Name) + #13#10;
  end
  else
  begin
    Log('FAILED: ' + Name + ' exit code ' + IntToStr(Code));
    Result := FmtMessage(CustomMessage('DoneFailed'), [Name, IntToStr(Code)]);
  end;
end;

function ChainOne(const Component, Name, AppId, Version, FileName: String): String;
begin
  Result := '';
  if not WizardIsComponentSelected(Component) then Exit;
  if NewerInstalled(Name, AppId, Version) then
  begin
    Log('SKIP-NEWER: ' + Name + ' ' + InstalledVersion(AppId) + ' kept; bundled ' + Version + '.');
    Summary := Summary + FmtMessage(CustomMessage('DoneKept'), [Name, InstalledVersion(AppId), Version]) + #13#10;
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
    Result := CustomMessage('StopObsOpen');
    Exit;
  end;
  // Today's names, and the ones the app had up to 0.1.3.
  if WizardIsComponentSelected('companion') and (ProcessRunning('FadesterCompanionBridge.exe') or ProcessRunning('Fadester Companion.exe')
    or ProcessRunning('FadesterTourBoxBridge.exe') or ProcessRunning('Fadester for TourBox.exe')) then
  begin
    Log('COMPANION-RUNNING: setup stopped before changing anything.');
    Result := CustomMessage('StopCompanionRunning');
    Exit;
  end;
  if WizardIsTaskSelected('opendeck') and ProcessRunning('opendeck.exe') then
  begin
    Log('OPENDECK-RUNNING: setup stopped before changing anything.');
    Result := CustomMessage('StopOpenDeckOpen');
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
    Summary := Summary + CustomMessage('DoneOldVs') + #13#10;
  end;
  if WizardIsComponentSelected('streamdeck') then
  begin
    Package := ExpandConstant('{app}\packages\{#SdFile}');
    Deck := StreamDeckExe();
    if StandaloneVjsterPresent() then
      Log('VJSTER-CLASH: standalone VJster plugin still installed alongside Fadester for OBS.');
    StreamDeckOfferWanted(); { decided by now in every run; asked once more so that the lines below never read 0 }
    if BothIds then
      Summary := Summary + FmtMessage(CustomMessage('NoteBothSd'), [OldIdPluginInBrackets()]) + #13#10;
    if StreamDeckOffer = 3 then
      Summary := Summary + FmtMessage(CustomMessage('NoteOldIdSd'), [OldIdPluginInBrackets(), '{#SdVersion}']) + #13#10
    else if not StreamDeckOfferWanted() then
      Summary := Summary + FmtMessage(CustomMessage('NoteNewerSd'), [ManifestVersion(UserAppData() + '\Elgato\StreamDeck\Plugins\io.github.jbrick2070.fadester-for-obs.sdPlugin\manifest.json', 'Version'), '{#SdVersion}']) + #13#10
    else if (Deck <> '') and not WizardSilent() then
    begin
      { Stream Deck installs the plugin itself, as the signed-in user, so its own files are never written behind its back. }
      if ShellExecAsOriginalUser('open', Package, '', '', SW_SHOWNORMAL, ewNoWait, Code) then
        Summary := Summary + CustomMessage('DoneSdImporting') + #13#10
      else
        Summary := Summary + FmtMessage(CustomMessage('DoneSdOpen'), [Package]) + #13#10;
    end
    else
      Summary := Summary + FmtMessage(CustomMessage('DoneSdReady'), [Package]) + #13#10;
    if WizardIsTaskSelected('opendeck') then
    begin
      if OpenDeckCopy = 2 then
        Summary := Summary + CustomMessage('DoneOpenDeckKept') + #13#10
      else
        Summary := Summary + CustomMessage('DoneOpenDeckAdded') + #13#10;
    end;
  end;
  if WizardIsComponentSelected('vjsterext') and (ExtensionCopy = 2) then
    Summary := Summary + FmtMessage(CustomMessage('DoneExtKept'), [ExpandConstant('{app}\vjster-extension')]) + #13#10
  else if WizardIsComponentSelected('vjsterext') then
    Summary := Summary + FmtMessage(CustomMessage('DoneExtLoad'), [ExpandConstant('{app}\vjster-extension')]) + #13#10;
  Log('Summary: ' + Summary);
  if (Summary <> '') and not WizardSilent() then
    MsgBox(Summary, mbInformation, MB_OK);
end;
