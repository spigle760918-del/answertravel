param(
  [string]$OutputDirectory = "../release"
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$repositoryRoot = (Resolve-Path (Join-Path $projectRoot "..")).Path
$outputRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $OutputDirectory))
$gitCommit = (git -C $repositoryRoot rev-parse HEAD).Trim()
$gitShort = (git -C $repositoryRoot rev-parse --short=7 HEAD).Trim()
$dirty = [bool](git -C $repositoryRoot status --porcelain)
if ($dirty) {
  throw "Candidate builds require a clean Git working tree. Commit or discard source changes first."
}
$timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
$version = "$timestamp-$gitShort"
$candidateName = "answertravel-v2-isolated-candidate-$version"
$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) $candidateName
$stage = Join-Path $temporaryRoot "package"

if (Test-Path -LiteralPath $temporaryRoot) { Remove-Item -LiteralPath $temporaryRoot -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

$items = @("package.json","package-lock.json","tsconfig.json","tsconfig.production.json","contracts","src","scripts","migrations","web","deploy")
foreach ($item in $items) { Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination $stage -Recurse -Force }

Get-ChildItem -LiteralPath $stage -Directory -Recurse -Force | Where-Object { $_.Name -in @("node_modules","dist","web-dist",".runtime") } | Sort-Object FullName -Descending | Remove-Item -Recurse -Force
Get-ChildItem -LiteralPath $stage -File -Recurse -Force | Where-Object { $_.Name -match '^\.env($|\.)' -and $_.Name -notlike '*.example' } | Remove-Item -Force

$sourceArchive = Join-Path $stage "web/public/answertravel-v2-frontend-source.tar.gz"
$sourceInputs = @("package.json","package-lock.json","tsconfig.json","tsconfig.production.json","contracts","web")
Push-Location $stage
try { & tar -czf $sourceArchive @sourceInputs; if ($LASTEXITCODE -ne 0) { throw "Frontend source archive creation failed." } }
finally { Pop-Location }

$sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $sourceArchive).Hash.ToLowerInvariant()
$manifest = [ordered]@{
  candidateVersion = $version
  createdAt = (Get-Date).ToUniversalTime().ToString("o")
  gitCommit = $gitCommit
  workingTreeDirty = $dirty
  nodeRuntime = "24.21.0"
  upstream = [ordered]@{ repository = "https://github.com/yaojingang/GEOFlow"; commit = "abcc638887dd35f508a59815f01ed42bc4415a09"; license = "AGPL-3.0-only" }
  includedMigrations = @("0025_invite_auth.sql","0026_competitor_scope_versions.sql")
  deploymentMode = "isolated-api-only"
  productionTrafficSwitchAuthorized = $false
  workerIncluded = $false
  deepseekCallAuthorized = $false
  correspondingSource = [ordered]@{ path = "web/public/answertravel-v2-frontend-source.tar.gz"; sha256 = $sourceHash }
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage "CANDIDATE-MANIFEST.json") -Encoding utf8NoBOM

$archive = Join-Path $outputRoot "$candidateName.tar.gz"
Push-Location $stage
try { & tar -czf $archive CANDIDATE-MANIFEST.json package.json package-lock.json tsconfig.json tsconfig.production.json contracts src scripts migrations web deploy; if ($LASTEXITCODE -ne 0) { throw "Candidate archive creation failed." } }
finally { Pop-Location }
$archiveHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$checksumPath = "$archive.sha256"
$checksumLine = "$archiveHash  $([System.IO.Path]::GetFileName($archive))`n"
[System.IO.File]::WriteAllText($checksumPath, $checksumLine, [System.Text.ASCIIEncoding]::new())

Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
Write-Output ([ordered]@{ event="isolated_candidate.created"; version=$version; archive=$archive; sha256=$archiveHash; workingTreeDirty=$dirty; productionTrafficSwitchAuthorized=$false } | ConvertTo-Json -Compress)
