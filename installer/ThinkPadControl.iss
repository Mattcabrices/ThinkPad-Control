#ifndef SourceRoot
  #define SourceRoot "..\artifacts\windows-x64"
#endif
#ifndef ReleaseRoot
  #define ReleaseRoot "..\artifacts\releases"
#endif
#ifndef AppVersion
  #define AppVersion "0.4.0-alpha.34"
#endif
[Setup]
#ifdef SignedBuild
SignTool=ThinkPadRelease
SignedUninstaller=yes
SignToolRetryCount=0
#endif
AppId={{1D42A8AC-7307-4D73-934C-E4C157D22CD8}
AppName=ThinkPad Control
AppVersion={#AppVersion}
AppPublisher=Matt Cabrices
AppCopyright=Copyright (c) 2026 Matt Cabrices and ThinkPad Control contributors
VersionInfoCompany=Matt Cabrices
VersionInfoCopyright=Copyright (c) 2026 Matt Cabrices and ThinkPad Control contributors
DisableWelcomePage=no
DefaultDirName={autopf}\ThinkPad Control
DisableDirPage=yes
DefaultGroupName=ThinkPad Control
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#ReleaseRoot}
OutputBaseFilename=ThinkPad-Control-Setup-{#AppVersion}-x64
LicenseFile=..\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\ThinkPad Control.exe
AppMutex=Local\ThinkPadControlInstallerLock
SetupMutex=ThinkPadControlSetup
CloseApplications=yes
RestartApplications=no
DisableProgramGroupPage=yes
SetupLogging=yes
SetupIconFile=..\desktop\app.ico

[Messages]
WelcomeLabel1=ThinkPad Control by Matt Cabrices
WelcomeLabel2=Open-source fan, sensor and power control for ThinkPads.%n%nThis installs the app and its hardware support: the signed PawnIO driver, downloaded from its official source if it isn't already installed; a scheduled task that lets the app start its hardware worker without a UAC prompt each time; and on Intel or Ryzen ThinkPads, the bundled TPFanCtrl2 fan engine as a Windows service. An existing fan-control service is left alone. The fan stays under firmware control until you choose otherwise.%n%nThis is unsigned alpha software that can change fan behaviour and firmware power limits. Use it at your own risk.

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Excludes: "engine\TPFanControl.ini"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#SourceRoot}\scripts\migrate-engine-config.ps1"; Flags: dontcopy
Source: "{#SourceRoot}\engine\TPFanControl.ini"; DestName: "TPFanControl.defaults.ini"; Flags: dontcopy

[Icons]
Name: "{group}\ThinkPad Control"; Filename: "{app}\ThinkPad Control.exe"; WorkingDir: "{app}"
Name: "{group}\ThinkPad Control Demo"; Filename: "{app}\ThinkPad Control.exe"; Parameters: "--demo"; WorkingDir: "{app}"
Name: "{group}\Uninstall ThinkPad Control"; Filename: "{uninstallexe}"
Name: "{autodesktop}\ThinkPad Control"; Filename: "{app}\ThinkPad Control.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\ThinkPad Control.exe"; Description: "Open ThinkPad Control"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: files; Name: "{app}\engine\TPFanControl.ini"
Type: files; Name: "{app}\engine\TPFanControl.ini.upgrade-backup"
Type: files; Name: "{app}\engine\TPFanControl.ini.upgrade-new"

[Code]
var OwnedEnginePresent, RestartOwnedEngine, UpgradeServiceStateKnown, UpgradeServiceStopped: Boolean;
var ConfigurationPrepared, ConfigurationCommitted: Boolean;

function ConfigurationAction(Action, Extra: String): Boolean;
var ExitCode: Integer;
begin
  ExitCode := -1;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + ExpandConstant('{tmp}\migrate-engine-config.ps1') + '" -Action ' + Action +
    ' -OutputPath "' + ExpandConstant('{tmp}\TPFanControl.migrated.ini') + '" -DestinationPath "' + ExpandConstant('{app}\engine\TPFanControl.ini') + '" ' + Extra,
    ExpandConstant('{tmp}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
  Result := Result and (ExitCode = 0);
  Log('Fan configuration ' + Action + ' exit code: ' + IntToStr(ExitCode));
end;

function PrepareConfiguration(PreserveOwned: Boolean): Boolean;
var Extra: String;
begin
  if FileExists(ExpandConstant('{app}\engine\TPFanControl.ini.upgrade-backup')) or FileExists(ExpandConstant('{app}\engine\TPFanControl.ini.upgrade-new')) then begin
    Log('An unfinished configuration backup exists; refusing to overwrite recovery data.');
    Result := False;
    exit;
  end;
  ExtractTemporaryFile('migrate-engine-config.ps1');
  ExtractTemporaryFile('TPFanControl.defaults.ini');
  Extra := '-TemplatePath "' + ExpandConstant('{tmp}\TPFanControl.defaults.ini') + '"';
  if PreserveOwned then Extra := Extra + ' -PreviousPath "' + ExpandConstant('{app}\engine\TPFanControl.ini') + '"';
  Result := ConfigurationAction('Prepare', Extra);
end;

function HardwareSupport(Action: String): Boolean;
var ExitCode: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File "' + ExpandConstant('{app}\scripts\hardware-support.ps1') + '" -Action ' + Action,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
  Result := Result and (ExitCode = 0);
  Log('Hardware support ' + Action + ' exit code: ' + IntToStr(ExitCode));
end;

function ReadOwnedEngineRunning(var Running: Boolean): Boolean;
var ExitCode: Integer; Query: String;
begin
  // Only read service state. Never enable a stopped/disabled engine during an upgrade.
  Query := '-NoProfile -NonInteractive -Command "$ErrorActionPreference=''Stop''; $env:PSModulePath=Join-Path $PSHOME ''Modules''; $service=Get-Service -Name ''TPFanControl'' -ErrorAction Stop; if($service.Status -eq ''Running''){exit 0}; if($service.Status -eq ''Stopped''){exit 10}; exit 11"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Query,
    ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ExitCode);
  Result := Result and ((ExitCode = 0) or (ExitCode = 10));
  Running := ExitCode = 0;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var ImagePath: String; OwnedEngine: Boolean;
begin
  Result := '';
  OwnedEngine := RegQueryStringValue(HKLM, 'SYSTEM\CurrentControlSet\Services\TPFanControl', 'ImagePath', ImagePath) and
    (CompareText(ImagePath, '"' + ExpandConstant('{app}\engine\TPFanControl.exe') + '" -s') = 0);
  OwnedEnginePresent := OwnedEngine;
  if not ConfigurationPrepared then begin
    if not PrepareConfiguration(OwnedEngine) then begin
      Result := 'Could not validate the previous fan configuration. No files have been replaced. Return to firmware or resolve the configuration before retrying.';
      exit;
    end;
    ConfigurationPrepared := True;
  end;
  if OwnedEngine then begin
    if not UpgradeServiceStateKnown then begin
      if not ReadOwnedEngineRunning(RestartOwnedEngine) then begin
        Result := 'Could not read a stable fan engine state. Wait for the service to finish starting/stopping, then retry. No files have been replaced.';
        exit;
      end;
      UpgradeServiceStateKnown := True;
    end;
    if RestartOwnedEngine then begin
      if HardwareSupport('StopOwned') then UpgradeServiceStopped := True
      else Result := 'Could not stop the owned fan engine for upgrade. No files have been replaced.';
    end;
  end;
end;
function InitializeUninstall(): Boolean;
begin
  Result := True;
  if FileExists(ExpandConstant('{app}\scripts\hardware-support.ps1')) then begin
    Result := HardwareSupport('Remove');
    if not Result then MsgBox('Could not remove the owned fan engine service. Uninstall stopped to preserve its files.', mbError, MB_OK);
  end;
end;

function RuntimeAvailable: Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(HKLM32, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version);
end;

// A stopped engine is the owner's choice, so an upgrade refreshes only the worker task then.
function WorkerAction(): String;
begin
  if OwnedEnginePresent and (not RestartOwnedEngine) then Result := 'InstallWorker' else Result := 'Install';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var ErrorCode: Integer;
begin
  // Hardware support is a core feature, so it always installs. An engine the owner stopped stays stopped on upgrade.
  if CurStep = ssPostInstall then begin
    if not ConfigurationAction('Commit', '') then
      RaiseException('Could not commit the validated fan configuration. The previous configuration is retained.');
    ConfigurationCommitted := True;
    if not HardwareSupport(WorkerAction()) then begin
      Log('Application installed; hardware support failed or requires restart.');
      if not WizardSilent then MsgBox('The app is installed, but hardware support could not be enabled. An existing fan-control service, a pending restart, a network failure or a Windows security policy may be responsible. See hardware-setup-error.txt in the install folder and the setup log. Run setup again to retry. Existing external fan-control services were left untouched.', mbError, MB_OK);
    end else begin
      UpgradeServiceStopped := False;
      if not ConfigurationAction('Finalize', '') then
        Log('Could not remove the prior fan configuration backup; it is retained for recovery.');
      ConfigurationCommitted := False;
    end;
  end;
  if (CurStep = ssDone) and (not WizardSilent) and (not RuntimeAvailable) then
    if MsgBox('ThinkPad Control uses Microsoft WebView2 for its desktop window. If the runtime is not already present, install it from Microsoft. Open the official download page?', mbInformation, MB_YESNO) = IDYES then
      ShellExec('open', 'https://developer.microsoft.com/microsoft-edge/webview2/', '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
end;

// User data stays in LocalAppData\ThinkPadControl; uninstall removes installed program files only.


procedure DeinitializeSetup();
begin
  if ConfigurationCommitted then
    if not ConfigurationAction('Restore', '') then begin
      UpgradeServiceStopped := False;
      Log('Could not restore the previous fan configuration. Inspect the upgrade-backup before restarting cooling.');
    end;
  // Cancellation after stopping an owned running engine should restore it.
  // The helper revalidates ownership and all engine hashes before starting it.
  if UpgradeServiceStopped then
    if not HardwareSupport('Install') then
      Log('Could not restart the previously running owned engine after interrupted setup. Re-run hardware support setup.');
end;
