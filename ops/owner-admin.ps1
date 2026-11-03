$ErrorActionPreference = 'Stop'
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script in an elevated PowerShell as the MellodifAI owner.'
}
$root = 'E:/mellodifai'
$env:MELLODIFAI_ROOT = $root
$env:TEMP = Join-Path $root 'tmp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:npm_config_cache = Join-Path $root 'cache/npm'
$env:npm_config_store_dir = Join-Path $root 'cache/pnpm'
New-Item -ItemType Directory -Path $env:TEMP -Force | Out-Null
$created = @('mdf-web', 'mdf-auth', 'mdf-tunnel') | Where-Object { -not (Get-LocalUser -Name $_ -ErrorAction SilentlyContinue) }
$old = Get-Location
try {
  Set-Location (Split-Path -Parent $PSScriptRoot)
  & pnpm ops services.ts install --apply *> $null
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed. Review the administrator prerequisites.' }
} finally {
  Set-Location $old
}
foreach ($account in $created) { Write-Output "Created $account and saved its credential in the owner-only service store." }
Write-Output 'Applied runtime ACLs and LAN firewall rule.'
