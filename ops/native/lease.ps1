param([string]$Path, [string]$Command, [int]$OwnerPid, [int]$TimeoutMs = 5000)
$ErrorActionPreference = 'Stop'
$handle = $null
$deadline = [DateTime]::UtcNow.AddMilliseconds($TimeoutMs)
try {
  while ($null -eq $handle) {
    try {
      $handle = [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if ([DateTime]::UtcNow -ge $deadline) {
        [Console]::Out.WriteLine('busy')
        exit 2
      }
      Start-Sleep -Milliseconds 50
    }
  }
  # Informational only. Exclusion comes exclusively from the open OS handle.
  $holder = @{ command = $Command; pid = $OwnerPid } | ConvertTo-Json -Compress
  [IO.File]::WriteAllText("$Path.holder.json", $holder)
  [Console]::Out.WriteLine('acquired')
  [Console]::Out.Flush()
  # EOF means the owning Node process died. No age or PID guessing and no unlink.
  $null = [Console]::In.ReadLine()
} finally {
  if ($null -ne $handle) { $handle.Dispose() }
}
