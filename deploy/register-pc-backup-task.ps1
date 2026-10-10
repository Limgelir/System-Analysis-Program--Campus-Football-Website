param([string]$Destination = 'D:\RefWebBackups')
$ErrorActionPreference = 'Stop'
$Destination = [IO.Path]::GetFullPath($Destination)
$runner = Join-Path $Destination 'bin\run-backup.ps1'
if (-not (Test-Path -LiteralPath $runner) -or -not (Test-Path -LiteralPath (Join-Path $Destination 'repository\config'))) { throw 'Initialize and verify the repository first' }
$account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskName = 'TJ RefWeb encrypted backup'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw 'Task already exists; inspect before changing it' }
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"')
$login = New-ScheduledTaskTrigger -AtLogOn -User $account
$hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6) -RestartCount 2 -RestartInterval (New-TimeSpan -Minutes 10)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($login, $hourly) -Principal $principal -Settings $settings -Description 'Pull verified TJ RefWeb backups into a local encrypted Restic repository after login and hourly.' | Select-Object TaskName, State
