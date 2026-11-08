param(
  [ValidateSet('run','install','disable')][string]$Action = 'run',
  [string]$Root = 'E:/mellodifai',
  [string]$Pnpm = 'pnpm.cmd',
  [int]$Attempts = 60,
  [int]$RetrySeconds = 10
)
$ErrorActionPreference = 'Stop'
$taskName = 'MellodifAI production logon'
$Root = [IO.Path]::GetFullPath($Root)
if ($Root -match '^[Cc]:\\') { throw 'Runtime root must be outside C:' }
$script = $PSCommandPath
if ($Action -eq 'disable') {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'MellodifAI production.lnk'
  if (Test-Path -LiteralPath $startup) {
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
    if ($link.Arguments.Contains($script)) { Remove-Item -LiteralPath $startup }
  }
  Write-Output 'Production logon disabled; running services were preserved.'
  exit 0
}
if ($Action -eq 'install') {
  if ($script -match '^[Cc]:\\') { throw 'Install from a pinned ops copy outside C:' }
  $Pnpm = (Get-Command $Pnpm -CommandType Application -ErrorAction Stop).Source
  $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '" -Root "' + $Root + '" -Pnpm "' + $Pnpm + '"'
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  try {
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
    $actionSpec = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory $PSScriptRoot
    Register-ScheduledTask -TaskName $taskName -Action $actionSpec -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    Write-Output 'Installed per-user production logon task.'
  } catch [Microsoft.Management.Infrastructure.CimException] {
    # Some Windows policies refuse even limited per-user tasks. A Startup
    # shortcut supplies the same interactive logon trigger without elevation.
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'MellodifAI production.lnk'
    if (Test-Path -LiteralPath $startup) { throw 'Startup shortcut already exists; preserve it' }
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($startup)
    $link.TargetPath = (Get-Command powershell.exe).Source
    $link.Arguments = $arguments
    $link.WorkingDirectory = $PSScriptRoot
    $link.WindowStyle = 7
    $link.Save()
    Write-Output 'Installed per-user production Startup shortcut (task registration unavailable).'
  }
  exit 0
}

$env:MELLODIFAI_ROOT = $Root
$env:TEMP = Join-Path $Root 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $Root 'cache/npm'
$env:npm_config_store_dir = Join-Path $Root 'cache/pnpm'
$env:TSX_DISABLE_CACHE = '1'
New-Item -ItemType Directory -Force -Path $env:TEMP,(Join-Path $Root 'logs') | Out-Null
$log = Join-Path $Root 'logs/logon.log'
function Write-Log([string]$message) { Add-Content -LiteralPath $log -Value ((Get-Date).ToUniversalTime().ToString('o') + ' ' + $message) }
$mutex = New-Object Threading.Mutex($false, 'Local\MellodifAI-production-logon')
$locked = $false
try {
  try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { exit 0 }
  Write-Log 'Starting production recovery; waiting for Docker.'
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    # Native stderr and stdout are never persisted: Docker can print secrets.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & docker info --format '{{.ServerVersion}}' *> $null
    $dockerExit = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($dockerExit -eq 0) {
      $ErrorActionPreference = 'Continue'
      $output = & $Pnpm --dir $PSScriptRoot run start:production 2>&1
      $startExit = $LASTEXITCODE
      $ErrorActionPreference = $previousPreference
      # Only our fixed diagnostic is retained; pnpm and child output is discarded.
      $diagnostic = @($output | ForEach-Object { [string]$_ } | Where-Object { $_ -match '^Service (command|database provisioning/probe|start) failed:' })
      $output = $null
      if ($startExit -eq 0) {
        try {
          $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 5
          if ($health.web -eq 'ok' -and $health.db -eq 'ok' -and $health.ops -eq 'ok' -and $null -ne $health.worker_heartbeat_age_s -and $health.worker_heartbeat_age_s -lt 60) {
            Write-Log 'Production ready: web/db/ops ok; worker heartbeat fresh.'
            exit 0
          }
        } catch { }
      }
      Write-Log ('Attempt ' + $attempt + ': services exit ' + $startExit + '; health not ready.')
      foreach ($line in $diagnostic) { Write-Log $line }
    } else { Write-Log ('Attempt ' + $attempt + ': Docker not ready.') }
    if ($attempt -lt $Attempts) { Start-Sleep -Seconds $RetrySeconds }
  }
  Write-Log 'Recovery timed out. Check production ports 44321/44322, Windows excluded port ranges, and service logs. No reset or restore was attempted.'
  exit 1
} catch {
  Write-Log 'Recovery failed; verify the pinned ops installation and prerequisites. Exception output withheld.'
  exit 1
} finally {
  if ($locked) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
