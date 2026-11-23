param([string]$Path, [string]$Command, [int]$OwnerPid, [int]$TimeoutMs = 5000)
$ErrorActionPreference = 'Stop'
# .NET calls only: a cmdlet that auto-loads a module makes Windows PowerShell scan
# every installed module when LOCALAPPDATA is a fresh folder, which takes 20 s or
# more on a machine with many modules.
$PSModuleAutoLoadingPreference = 'None'
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
      [Threading.Thread]::Sleep(50)
    }
  }
  # Informational only. Exclusion comes exclusively from the open OS handle.
  # The caller allows only [a-z][a-z0-9-]* commands, so no JSON escaping is needed.
  [IO.File]::WriteAllText("$Path.holder.json", '{"command":"' + $Command + '","pid":' + $OwnerPid + '}')
  [Console]::Out.WriteLine('acquired')
  [Console]::Out.Flush()
  # EOF means the owning Node process died. No age or PID guessing and no unlink.
  $null = [Console]::In.ReadLine()
} finally {
  if ($null -ne $handle) { $handle.Dispose() }
}
