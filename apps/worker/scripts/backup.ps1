param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\.env.local"),
  [string]$BackupDirectory = "E:\mellodifai\backups"
)

# DATABASE_URL must use Supabase's session pooler (port 5432), not the
# transaction pooler (6543). Copy the Session pooler URI from Connect.
# Example: postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
# Install pg_dump with the same major version as the hosted Postgres server.

if (-not (Test-Path -LiteralPath $EnvFile)) {
  throw "Environment file not found: $EnvFile"
}

$databaseUrl = $null
foreach ($line in Get-Content -LiteralPath $EnvFile) {
  if ($line -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') {
    $databaseUrl = $Matches[1].Trim().Trim('"').Trim("'")
    break
  }
}
if ([string]::IsNullOrWhiteSpace($databaseUrl)) {
  throw "DATABASE_URL is required in $EnvFile"
}
try { $poolerUri = [Uri]$databaseUrl } catch { throw "Invalid DATABASE_URL URI" }
if ($poolerUri.Host -notlike "*.pooler.supabase.com" -or $poolerUri.Port -ne 5432) {
  throw "DATABASE_URL must be the Supabase session pooler connection string on port 5432"
}

New-Item -ItemType Directory -Force -Path $BackupDirectory | Out-Null
$date = Get-Date -Format "yyyy-MM-dd"
$output = Join-Path $BackupDirectory "mellodifai-$date.sql"
& pg_dump --dbname=$databaseUrl --file=$output
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE"
}

Get-ChildItem -LiteralPath $BackupDirectory -Filter "mellodifai-*.sql" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -Skip 8 |
  ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }
