$ErrorActionPreference = 'Stop'
# Use Windows PowerShell's inbox modules even when launched from PowerShell 7.
$env:PSModulePath = Join-Path $PSHOME 'Modules'
$warnings = [System.Collections.Generic.List[string]]::new()
$machine = $null
$cpu = $null
$gpu = @()
try { $machine = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model } catch { $warnings.Add('Windows system inventory unavailable: ' + $_.Exception.Message) }
try { $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1 Name, Manufacturer, LoadPercentage, CurrentClockSpeed, MaxClockSpeed } catch { $warnings.Add('CPU inventory unavailable: ' + $_.Exception.Message) }
try { $gpu = @(Get-CimInstance Win32_VideoController | Select-Object Name, PNPDeviceID) } catch { $warnings.Add('GPU inventory unavailable: ' + $_.Exception.Message) }
# Select named fields only: these classes also expose serial numbers and UUIDs.
$bios = $null
$product = $null
try { $bios = Get-CimInstance Win32_BIOS | Select-Object SMBIOSBIOSVersion } catch { $warnings.Add('BIOS inventory unavailable: ' + $_.Exception.Message) }
try { $product = Get-CimInstance Win32_ComputerSystemProduct | Select-Object Version } catch { $warnings.Add('Product inventory unavailable: ' + $_.Exception.Message) }
$boost = $null
$cpuPolicy = $null
$performance = $null
try { $performance = Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" | Select-Object ProcessorFrequency, PerformanceLimitFlags } catch { }
# Returns null when this Windows build does not expose the setting. Values can reach 0xFFFFFFFF.
function Read-PolicyIndices($scheme, $setting) {
  try {
    $text = (& "$env:SystemRoot\System32\powercfg.exe" /qh $scheme SUB_PROCESSOR $setting 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { return $null }
    $found = [regex]::Matches($text, '0x[0-9a-fA-F]{8}')
    if ($found.Count -lt 2) { return $null }
    return @{ ac = [Convert]::ToInt64($found[$found.Count - 2].Value.Substring(2), 16); dc = [Convert]::ToInt64($found[$found.Count - 1].Value.Substring(2), 16) }
  } catch { return $null }
}
# Query the exact setting by GUID. Parse numeric indices, not localized labels.
$schemeOutput = & "$env:SystemRoot\System32\powercfg.exe" /getactivescheme 2>&1
if ($LASTEXITCODE -eq 0 -and "$schemeOutput" -match '[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}') {
  $scheme = $Matches[0]
  $cpuPolicy = @{ scheme = $scheme; maxFrequency = (Read-PolicyIndices $scheme 'PROCFREQMAX'); maxFrequencyClass1 = (Read-PolicyIndices $scheme 'PROCFREQMAX1'); epp = (Read-PolicyIndices $scheme 'PERFEPP'); eppClass1 = (Read-PolicyIndices $scheme 'PERFEPP1') }
  $output = & "$env:SystemRoot\System32\powercfg.exe" /qh $scheme SUB_PROCESSOR PERFBOOSTMODE 2>&1
  if ($LASTEXITCODE -eq 0) {
    $indices = [regex]::Matches(($output -join "`n"), '0x[0-9a-fA-F]{8}')
    if ($indices.Count -ge 2) {
      $boost = @{ scheme = $scheme; ac = [Convert]::ToInt32($indices[$indices.Count - 2].Value.Substring(2), 16); dc = [Convert]::ToInt32($indices[$indices.Count - 1].Value.Substring(2), 16) }
    }
  }
}
if ($null -eq $boost) { $warnings.Add('Processor boost policy could not be read. CPU controls are unavailable.') }
$fanEngine = @{ installed = $false; status = 'Not installed' }
try { $engine = Get-Service -Name TPFanControl -ErrorAction Stop; $fanEngine = @{ installed = $true; status = $engine.Status.ToString() } } catch { }
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$power = 'Unknown'
try {
  Add-Type -AssemblyName System.Windows.Forms
  $power = [System.Windows.Forms.SystemInformation]::PowerStatus.PowerLineStatus.ToString()
} catch { }
@{ machine = $machine; bios = $bios; product = $product; cpu = $cpu; gpus = $gpu; boost = $boost; cpuPolicy = $cpuPolicy; performance = $performance; admin = $admin; fanEngine = $fanEngine; powerSource = $power; warnings = @($warnings.ToArray()) } | ConvertTo-Json -Depth 7 -Compress
