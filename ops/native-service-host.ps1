param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
Remove-Item -LiteralPath $Manifest

Add-Type -Path (Join-Path $PSScriptRoot 'service-process.cs')

$child = $null
$service = $null
try {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $expected = $current
  $credential = $null
  if ($config.account -and (Get-LocalUser -Name $config.account -ErrorAction SilentlyContinue)) {
    $credential = Import-Clixml -LiteralPath (Join-Path $config.root ('secrets/services/' + $config.account + '.xml'))
    $expected = $env:COMPUTERNAME + '\' + $config.account
    if ($credential.UserName -ine $expected) { throw 'Service credential identity mismatch' }

  }
  # Do not give a less privileged process the owner's provider or database environment.
  $keep = @('SystemRoot','WINDIR','PATH','PATHEXT','COMSPEC','COMPUTERNAME','TEMP','TMP','TMPDIR','MELLODIFAI_ROOT','HOST','npm_config_cache','npm_config_store_dir')
  if ($config.account) {
    Get-ChildItem Env: | Where-Object { $keep -notcontains $_.Name } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
  }
  $executable = (Get-Command -Name $config.command -CommandType Application -ErrorAction Stop).Source
  $user = $null; $domain = $null; $password = $null
  if ($credential) { $user = $config.account; $domain = $env:COMPUTERNAME; $password = $credential.Password }
  for ($restart = 0; $restart -le 5; $restart++) {
  $service = [ServiceProcess]::CreateSuspended($executable, $config.arguments, $config.cwd, $config.stdout, $config.stderr, $user, $domain, $password)
  $child = $service.Child
  $processOwner = Invoke-CimMethod -InputObject (Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.Id)) -MethodName GetOwner
  if ($processOwner.ReturnValue -ne 0) { throw 'Cannot verify service process owner' }
  $actual = $processOwner.Domain + '\' + $processOwner.User
  if ($actual -ine $expected) { throw 'Service process owner mismatch' }
  function Assert-Ports {
    foreach ($entry in $config.ports.PSObject.Properties) {
      $listeners = @(Get-NetTCPConnection -State Listen -LocalPort ([int]$entry.Name) -ErrorAction SilentlyContinue)
      if ($listeners.Count -eq 0) { throw 'Missing tunnel upstream listener' }
      foreach ($listener in $listeners) {
        $owner = (Get-Process -Id $listener.OwningProcess -IncludeUserName).UserName
        if ($owner -ine $entry.Value) { throw 'Tunnel port owner mismatch' }
      }
    }
  }
  if ($config.ports) { Assert-Ports }
  $service.Resume()
  $identity = (Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.Id)).CreationDate.ToUniversalTime().ToString('o')
  @{ pid=$child.Id; identity=$identity; supervisorPid=$PID; supervisorIdentity=(Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $PID)).CreationDate.ToUniversalTime().ToString('o'); owner=$actual; restarts=$restart } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config.state -Encoding UTF8
  while (-not $child.WaitForExit(60000)) {
    if ($config.ports) { Assert-Ports }
  }
  $service.Dispose(); $service = $null
  if ($restart -eq 5) { throw 'Service restart limit reached' }
  [Console]::Error.WriteLine('Service exited; restarting within the five restart bound')
  Start-Sleep -Seconds ([Math]::Min(30, [Math]::Pow(2, $restart)))
  }
} catch {
  # Only a fixed diagnostic is logged; credentials and child environment stay private.
  [Console]::Error.WriteLine('Service host failed; check account setup, ownership and port prerequisites')
  exit 1
} finally {
  if ($service) { $service.Dispose() }
  if (Test-Path -LiteralPath $config.state) {
    $state = Get-Content -LiteralPath $config.state -Raw | ConvertFrom-Json
    if ($state.supervisorPid -eq $PID) { Remove-Item -LiteralPath $config.state }
  }
}
