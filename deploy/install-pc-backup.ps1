param(
    [Parameter(Mandatory = $true)][string]$Server,
    [Parameter(Mandatory = $true)][string]$KnownHostsFile,
    [string]$Destination = 'D:\RefWebBackups',
    [int]$Port = 22
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[a-zA-Z0-9][a-zA-Z0-9.-]*$' -or $Port -lt 1 -or $Port -gt 65535) { throw 'Invalid SSH endpoint' }
if (-not [IO.Path]::IsPathRooted($Destination)) { throw 'Use an absolute dedicated directory' }
$Destination = [IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $Destination) { throw 'Destination already exists; inspect it instead of overwriting' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$keygen = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
New-Item -ItemType Directory -Path $Destination | Out-Null
# Restrict before writing secrets. Keep SYSTEM and local administrators for recovery.
& icacls.exe $Destination /inheritance:r /grant:r "${account}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to restrict backup directory permissions' }
foreach ($directory in @('private', 'bin', 'logs')) { New-Item -ItemType Directory -Path (Join-Path $Destination $directory) | Out-Null }
$version = '0.19.1'
$asset = "restic_${version}_windows_amd64.zip"
$base = "https://github.com/restic/restic/releases/download/v$version"
$archive = Join-Path $Destination "bin\$asset"
$sums = Join-Path $Destination 'bin\SHA256SUMS'
Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $archive
Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile $sums
$line = @(Get-Content -LiteralPath $sums | Where-Object { $_ -match "^[a-f0-9]{64}\s+\*?$([regex]::Escape($asset))$" })
if ($line.Count -ne 1 -or (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $line[0].Substring(0,64)) { throw 'Restic checksum mismatch' }
Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $Destination 'bin')
$restic = Join-Path $Destination "bin\restic_${version}_windows_amd64.exe"
if (-not (Test-Path -LiteralPath $restic)) { throw 'Restic executable missing' }
$identity = Join-Path $Destination 'private\id_ed25519'
$keyScript = Join-Path $Destination 'bin\generate-key.js'
[IO.File]::WriteAllText($keyScript, 'const r=require("child_process").spawnSync(process.argv[2],["-t","ed25519","-N","","-C","tj-refweb-pc-backup-restricted","-f",process.argv[3]],{stdio:"ignore",windowsHide:true});process.exit(r.status??1)', [Text.UTF8Encoding]::new($false))
& $node $keyScript $keygen $identity
if ($LASTEXITCODE -ne 0) { throw 'Dedicated SSH key generation failed' }
Copy-Item -LiteralPath $KnownHostsFile -Destination (Join-Path $Destination 'private\known_hosts')
$passwordFile = Join-Path $Destination 'private\restic-password.txt'
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
[IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($bytes), [Text.UTF8Encoding]::new($false))
$config = @{
    repository = (Join-Path $Destination 'repository'); passwordFile = $passwordFile
    restic = $restic; ssh = $ssh; identityFile = $identity
    knownHostsFile = (Join-Path $Destination 'private\known_hosts')
    host = $Server; user = 'root'; port = $Port
}
[IO.File]::WriteAllText((Join-Path $Destination 'private\config.json'), ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'pcBackup.js') -Destination (Join-Path $Destination 'bin\pcBackup.js')
$env:RESTIC_REPOSITORY = $config.repository
$env:RESTIC_PASSWORD_FILE = $passwordFile
try { & $restic init; if ($LASTEXITCODE -ne 0) { throw 'Repository initialization failed' } }
finally { Remove-Item Env:RESTIC_REPOSITORY; Remove-Item Env:RESTIC_PASSWORD_FILE }
$runner = @'
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$log = Join-Path $root ('logs\backup-' + (Get-Date -Format 'yyyy-MM-dd') + '.log')
# Windows PowerShell 5 uses UTF-16 for redirection; PowerShell 7 uses UTF-8.
# Append explicitly so scheduled and manual runs can safely share a JSONL log.
& '__NODE__' (Join-Path $root 'bin\pcBackup.js') (Join-Path $root 'private\config.json') 2>&1 | ForEach-Object {
    [IO.File]::AppendAllText($log, ([string]$_ + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
}
exit $LASTEXITCODE
'@
$runner = $runner.Replace('__NODE__', $node.Replace("'", "''"))
[IO.File]::WriteAllText((Join-Path $Destination 'bin\run-backup.ps1'), $runner, [Text.UTF8Encoding]::new($true))
Write-Output "Prepared encrypted repository: $Destination"
Write-Output "Install only this public key with the restricted server command: $identity.pub"
Write-Output 'Run one successful backup/restore drill before registering the scheduled task. Save the repository password separately.'
