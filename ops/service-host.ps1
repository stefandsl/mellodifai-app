param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
Remove-Item -LiteralPath $Manifest

# The OS closes this job handle even if the supervisor crashes or is killed.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class ServiceJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic {
    public long ProcessTime, JobTime;
    public uint Flags;
    public UIntPtr MinWorking, MaxWorking;
    public uint ActiveProcesses;
    public UIntPtr Affinity;
    public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io {
    public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] struct Extended {
    public Basic Basic;
    public Io Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Attach(Process process) {
    var job = CreateJobObject(IntPtr.Zero, null);
    var info = new Extended(); info.Basic.Flags = 0x2000;
    if (job == IntPtr.Zero || !SetInformationJobObject(job, 9, ref info, (uint)Marshal.SizeOf(info)) || !AssignProcessToJobObject(job, process.Handle)) {
      int error = Marshal.GetLastWin32Error();
      if (job != IntPtr.Zero) CloseHandle(job);
      throw new Win32Exception(error);
    }
    return job;
  }
}
'@

$child = $null
$job = [IntPtr]::Zero
try {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  $expected = $current
  $options = @{
    FilePath = $config.command
    ArgumentList = $config.arguments
    WorkingDirectory = $config.cwd
    WindowStyle = 'Hidden'
    PassThru = $true
    RedirectStandardOutput = $config.stdout
    RedirectStandardError = $config.stderr
  }
  if ($config.account -and (Get-LocalUser -Name $config.account -ErrorAction SilentlyContinue)) {
    $credential = Import-Clixml -LiteralPath (Join-Path $config.root ('secrets/services/' + $config.account + '.xml'))
    $expected = $env:COMPUTERNAME + '\' + $config.account
    if ($credential.UserName -ine $expected) { throw 'Service credential identity mismatch' }
    $options.Credential = $credential
  }
  # Do not give a less privileged process the owner's provider or database environment.
  $keep = @('SystemRoot','WINDIR','PATH','PATHEXT','COMSPEC','COMPUTERNAME','TEMP','TMP','TMPDIR','MELLODIFAI_ROOT','HOST','npm_config_cache','npm_config_store_dir')
  if ($config.account) {
    Get-ChildItem Env: | Where-Object { $keep -notcontains $_.Name } | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
  }
  $child = Start-Process @options
  $job = [ServiceJob]::Attach($child)
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
        if (($owner -split '\\')[-1] -ine $entry.Value) { throw 'Tunnel port owner mismatch' }
      }
    }
  }
  if ($config.ports) { Assert-Ports }
  $identity = (Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $child.Id)).CreationDate.ToUniversalTime().ToString('o')
  @{ pid=$child.Id; identity=$identity; supervisorPid=$PID; owner=$actual } | ConvertTo-Json -Compress | Set-Content -LiteralPath $config.state -Encoding UTF8
  while (-not $child.WaitForExit(60000)) {
    if ($config.ports) { Assert-Ports }
  }
} catch {
  # Only a fixed diagnostic is logged; credentials and child environment stay private.
  [Console]::Error.WriteLine('Service host failed; check account setup, ownership and port prerequisites')
  exit 1
} finally {
  if ($job -ne [IntPtr]::Zero) { [ServiceJob]::CloseHandle($job) | Out-Null }
  elseif ($child -and -not $child.HasExited) { $child.Kill() }
  if (Test-Path -LiteralPath $config.state) {
    $state = Get-Content -LiteralPath $config.state -Raw | ConvertFrom-Json
    if ($state.supervisorPid -eq $PID) { Remove-Item -LiteralPath $config.state }
  }
}
