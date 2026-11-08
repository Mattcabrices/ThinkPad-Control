$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'package.json') | ConvertFrom-Json).version
$destination = Join-Path $projectRoot "artifacts\releases\ThinkPad-Control-$version-source.zip"
New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
$directories = @('src','public','native','native-tests','desktop','installer','scripts','tests','docs','third-party','.github')
$privateJournals = @('HOST-VALIDATION.md','VALIDATION.md','MORNING-CHECK.md','REMOTE-VALIDATION.md','T14-GEN3-RESULTS.md','HANDOFF.md')
$files = @('README.md','LICENSE','THIRD-PARTY-NOTICES.md','SECURITY.md','CONTRIBUTING.md','NuGet.Config','package.json','.gitignore','signing/artifact-signing.example.json','signing/metadata.example.json','signing/certificate-store.example.json')
Add-Type -AssemblyName System.IO.Compression,System.IO.Compression.FileSystem
$stream = [IO.File]::Open($destination,[IO.FileMode]::Create)
$archive = [IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create)
try {
    $sources = @($files | ForEach-Object { Get-Item -LiteralPath (Join-Path $projectRoot $_) })
    $sources += @($directories | ForEach-Object { Get-ChildItem -LiteralPath (Join-Path $projectRoot $_) -File -Recurse } | Where-Object {
        $_.FullName.Substring($projectRoot.Length+1) -notmatch '(^|\\)(bin|obj|node_modules|\.git)(\\|$)' -and $_.Extension -notin @('.pdb','.log','.sqlite','.db','.user','.pfx','.pem','.key') -and $_.Name -notin $privateJournals
    })
    foreach ($source in $sources) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$source.FullName,$source.FullName.Substring($projectRoot.Length+1).Replace('\','/'),[IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
} finally { $archive.Dispose(); $stream.Dispose() }
Write-Output $destination

