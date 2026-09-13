$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$v2Root = Split-Path -Parent $PSScriptRoot
$toolsDirectory = Join-Path $v2Root '.runtime\tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null

function Install-VerifiedArchive {
    param([string]$Name, [string]$Url, [string]$Hash, [string]$Destination, [hashtable]$Headers = @{})
    $archive = Join-Path $toolsDirectory $Name
    if (-not (Test-Path -LiteralPath $archive) -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Hash) {
        Invoke-WebRequest -Uri $Url -Headers $Headers -OutFile $archive -TimeoutSec 180
    }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $Hash) {
        throw "Checksum mismatch: $Name"
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $Destination -Force
    Write-Output "Verified and extracted: $Name"
}

Install-VerifiedArchive -Name 'node-v24.21.0-win-x64.zip' `
    -Url 'https://nodejs.org/dist/v24.21.0/node-v24.21.0-win-x64.zip' `
    -Hash '158F7685B44DE51F6C0DF1D153526CBCD3E1BC739A8DFC607721CEF75DE9E541' `
    -Destination $toolsDirectory

# Community Windows build, local tests only. Production runs Redis on Linux.
Install-VerifiedArchive -Name 'Redis-7.2.16-Windows-x64-msys2.zip' `
    -Url 'https://api.github.com/repos/redis-windows/redis-windows/releases/assets/519261974' `
    -Headers @{ Accept = 'application/octet-stream' } `
    -Hash 'BCBFDA1DDA027BEAEA4D616F8992F9B6353613C1B1F4D0E4A6776940BB036347' `
    -Destination (Join-Path $toolsDirectory 'redis-7.2.16')

Write-Output 'Local tools prepared. Use Node.js 24, npm ci, then npm run verify:local.'
