param([string]$MSBuild)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$source=Join-Path $root '.tools\dependencies\TPFanCtrl2-source.zip'
$lock=Get-Content -Raw (Join-Path $root 'third-party\dependencies.lock.json')|ConvertFrom-Json
$asset=$lock.assets|Where-Object file -eq 'TPFanCtrl2-source.zip'
if((Get-FileHash $source).Hash -ne $asset.sha256){throw 'Unverified upstream fan source archive.'}
if(!$MSBuild){
    $MSBuild=Join-Path $root '.tools\vs-build\MSBuild\Current\Bin\MSBuild.exe'
    if(!(Test-Path -LiteralPath $MSBuild)){
        $locator=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
        if(Test-Path -LiteralPath $locator){$MSBuild=(& $locator -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find 'MSBuild\**\Bin\MSBuild.exe'|Select-Object -First 1)}
    }
}
if(!(Test-Path -LiteralPath $MSBuild)){throw 'Microsoft C++ Build Tools v143 and Windows SDK required; pass -MSBuild with MSBuild.exe.'}
$work=Join-Path $root ('.tools\fan-engine-build\'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $work|Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($source,$work)
$upstream=Join-Path $work ('TPFanCtrl2-'+$lock.tpfcCommit)
$cpp=Join-Path $upstream 'fancontrol\fanstuff.cpp';$header=Join-Path $upstream 'fancontrol\fancontrol.h'
$text=[IO.File]::ReadAllText($cpp)
$first='WriteByteToEC(TP_ECOFFSET_FAN_SWITCH, TP_ECVALUE_SELFAN1)'
$second='WriteByteToEC(TP_ECOFFSET_FAN_SWITCH, TP_ECVALUE_SELFAN2)'
if(([regex]::Matches($text,[regex]::Escape($first))).Count -ne 2 -or ([regex]::Matches($text,[regex]::Escape($second))).Count -ne 2){throw 'Unexpected selector call sites.'}
$text=$text.Replace($first,'SelectFan(false)').Replace($second,'SelectFan(true)')
$anchor='bool FANCONTROL::ReadEcRaw(FCSTATE* pfcstate) {'
$helper=@('bool FANCONTROL::SelectFan(bool secondary) {','    if (SingleFan) return !secondary;','    char original;','    if (!ReadByteFromEC(TP_ECOFFSET_FAN_SWITCH, &original)) return false;','    const char selected = (original & 0xfe) | (secondary ? 1 : 0);','    return selected == original || WriteByteToEC(TP_ECOFFSET_FAN_SWITCH, selected);','}','') -join [Environment]::NewLine
if(([regex]::Matches($text,[regex]::Escape($anchor))).Count -ne 1){throw 'ReadEcRaw anchor changed.'}
$text=$text.Replace($anchor,$helper+[Environment]::NewLine+$anchor)
# Level 7 reads about 3800 RPM on a T14s Gen 2, so a 4000 RPM threshold never leaves level 7 for full speed.
$spinUp='this->fan1speed < 4000'
if(([regex]::Matches($text,[regex]::Escape($spinUp))).Count -ne 2){throw 'Unexpected full-speed threshold call sites.'}
$text=$text.Replace($spinUp,'this->fan1speed < 3000')
# Both upstream thermal exits must preserve an explicit Max request, including
# the intermediate level-7 spin-up stage. Other manual levels retain the cutoff.
$thermal='this->CurrentMode == 3 && this->MaxTemp > this->ManModeExitInternal'
if(([regex]::Matches($text,[regex]::Escape($thermal))).Count -ne 1){throw 'Unexpected manual thermal exit in fanstuff.'}
$text=$text.Replace($thermal,$thermal+' && !this->ManualMaxCoolingRequested()')
$maxHelper=@'
bool FANCONTROL::ManualMaxCoolingRequested() {
    char level[16] = {0};
    ::GetDlgItemTextA(this->hwndDialog, 8310, level, sizeof(level));
    const char* digits = level;
    int base = 0;
    if (level[0] == 'x' && level[1] == '\'') { digits += 2; base = 16; }
    char* end = NULL;
    const long requested = strtol(digits, &end, base);
    return end != digits && requested == 64;
}

'@
$text=$text.Replace($anchor,$maxHelper+[Environment]::NewLine+$anchor)
[IO.File]::WriteAllText($cpp,$text,[Text.UTF8Encoding]::new($false))
$modeCpp=Join-Path $upstream 'fancontrol\fancontrol.cpp'
$text=[IO.File]::ReadAllText($modeCpp)
if(([regex]::Matches($text,[regex]::Escape($thermal))).Count -ne 1){throw 'Unexpected manual thermal exit in timer.'}
$text=$text.Replace($thermal,$thermal+' && !this->ManualMaxCoolingRequested()')
[IO.File]::WriteAllText($modeCpp,$text,[Text.UTF8Encoding]::new($false))
$text=[IO.File]::ReadAllText($header);$anchor='bool ReadEcRaw(FCSTATE* pfcstate);'
if(([regex]::Matches($text,[regex]::Escape($anchor))).Count -ne 1){throw 'ReadEcRaw declaration changed.'}
$text=$text.Replace($anchor,'bool SelectFan(bool secondary);'+[Environment]::NewLine+'bool ManualMaxCoolingRequested();'+[Environment]::NewLine+$anchor)
[IO.File]::WriteAllText($header,$text,[Text.UTF8Encoding]::new($false))
$start=[Diagnostics.ProcessStartInfo]::new($MSBuild)
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.Arguments='"'+(Join-Path $upstream 'fancontrol\fancontrol.vcxproj')+'" /m /t:Rebuild /p:Configuration=Release /p:Platform=Win32 /p:PlatformToolset=v143 /p:WindowsTargetPlatformVersion=10.0.26100.0 /verbosity:minimal'
# Normalize inherited Path/PATH duplicates before launching framework MSBuild.
$variables=[Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach($entry in [Environment]::GetEnvironmentVariables().GetEnumerator()){$variables[$entry.Key]=[string]$entry.Value}
$start.Environment.Clear();foreach($entry in $variables.GetEnumerator()){$start.Environment[$entry.Key]=$entry.Value}
$compiler=[Diagnostics.Process]::Start($start);$compiler.WaitForExit()
if($compiler.ExitCode -ne 0){throw 'Patched fan engine compilation failed.'}
$output=Join-Path $root '.tools\dependencies\TPFanControl-patched.exe'
Copy-Item -LiteralPath (Join-Path $upstream 'fancontrol\Release\TPFanControl.exe') -Destination $output -Force
$modifiedSource=Join-Path $root '.tools\dependencies\TPFanCtrl2-patched-source.zip'
if(Test-Path -LiteralPath $modifiedSource){Remove-Item -LiteralPath $modifiedSource -Force}
$archive=[IO.Compression.ZipFile]::Open($modifiedSource,[IO.Compression.ZipArchiveMode]::Create)
try {Get-ChildItem -LiteralPath $upstream -File -Recurse|Where-Object {$_.FullName -notmatch '\\(Release|Debug)\\' -and $_.Extension -notin @('.pdb','.obj','.pch','.exe','.dll','.user')}|ForEach-Object {[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$_.FullName.Substring($upstream.Length+1).Replace('\','/'))|Out-Null}}finally{$archive.Dispose()}
@{schemaVersion=1;upstreamCommit=$lock.tpfcCommit;upstreamSourceSha256=$asset.sha256;patchSha256=(Get-FileHash (Join-Path $root 'third-party\patches\TPFanCtrl2-single-fan.patch')).Hash;buildScriptSha256=(Get-FileHash $PSCommandPath).Hash;engineSha256=(Get-FileHash $output).Hash;modifiedSourceSha256=(Get-FileHash $modifiedSource).Hash;toolset='v143';windowsSdk='10.0.26100.0'}|ConvertTo-Json|Set-Content (Join-Path $root 'third-party\fan-engine-build.lock.json')
Write-Output $output



