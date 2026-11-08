param([Parameter(Mandatory=$true)][string]$PackageRoot)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
$manifest = @(Get-ChildItem -LiteralPath $root -Recurse -File | Where-Object { $_.FullName -ne (Join-Path $root 'package-manifest.json') } | Sort-Object FullName | ForEach-Object {
    @{path=$_.FullName.Substring($root.Length+1);sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'package-manifest.json') -Encoding utf8
