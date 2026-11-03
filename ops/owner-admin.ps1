$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script in an elevated PowerShell as the MellodifAI owner.'
}
$root = 'E:/mellodifai'
$log = Join-Path $root 'logs/owner-admin.log'
New-Item -ItemType Directory -Path (Join-Path $root 'logs') -Force | Out-Null
$env:MELLODIFAI_ROOT = $root
$env:TEMP = Join-Path $root 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $root 'cache/npm'
$env:npm_config_store_dir = Join-Path $root 'cache/pnpm'
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
Write-Output "MellodifAI owner setup - full log in $log"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$old = Get-Location
try {
  Set-Location $repo
  # The ops output never contains secret values; it goes to the log so failures can be diagnosed.
  & pnpm ops services.ts install --apply *>> $log
  if ($LASTEXITCODE -ne 0) { throw "Service installation failed (exit $LASTEXITCODE). See $log" }
} finally {
  Set-Location $old
}
foreach ($account in 'mdf-web', 'mdf-auth', 'mdf-tunnel') {
  if (Get-LocalUser -Name $account -ErrorAction SilentlyContinue) { Write-Output "OK account $account exists" }
  else { throw "Account $account is missing after install. See $log" }
}
Write-Output 'Done: accounts, runtime ACLs and LAN firewall rule applied.'
