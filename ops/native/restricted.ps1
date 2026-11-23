# Runs the command line in MDF_RESTRICTED_COMMAND under a restricted copy of this
# process's token, the way pg_ctl starts PostgreSQL: the Administrators and Power
# Users groups become deny-only and every privilege is dropped. PostgreSQL refuses
# to start under an administrator token (elevated terminals, CI runners).
# The command inherits this process's standard handles, console state and folder.
# This process waits for it and exits with its exit code.
$ErrorActionPreference = 'Stop'
# .NET calls only: module auto-loading is slow under a fresh LOCALAPPDATA.
$PSModuleAutoLoadingPreference = 'None'
$commandLine = $env:MDF_RESTRICTED_COMMAND
if (-not $commandLine) {
  [Console]::Error.WriteLine('MDF_RESTRICTED_COMMAND is empty')
  exit 2
}
[Environment]::SetEnvironmentVariable('MDF_RESTRICTED_COMMAND', $null)
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

public static class MdfRestricted {
  [StructLayout(LayoutKind.Sequential)]
  struct SidAndAttributes { public IntPtr Sid; public uint Attributes; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct StartupInfo {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize;
    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute;
    public int dwFlags; public short wShowWindow; public short cbReserved2;
    public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
  }

  [StructLayout(LayoutKind.Sequential)]
  struct ProcessInformation { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableCount,
    SidAndAttributes[] disable, uint deleteCount, IntPtr delete, uint restrictCount,
    IntPtr restrict, out IntPtr restricted);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcessAsUser(IntPtr token, string application, StringBuilder commandLine,
    IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags,
    IntPtr environment, string directory, ref StartupInfo startup, out ProcessInformation info);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  const uint TOKEN_ASSIGN_PRIMARY = 0x1, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8;
  const uint DISABLE_MAX_PRIVILEGE = 0x1;
  const int STARTF_USESTDHANDLES = 0x100;
  const uint DETACHED_PROCESS = 0x8, CREATE_NEW_PROCESS_GROUP = 0x200;

  static IntPtr Sid(string value, out GCHandle pin) {
    var sid = new SecurityIdentifier(value);
    var bytes = new byte[sid.BinaryLength];
    sid.GetBinaryForm(bytes, 0);
    pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
    return pin.AddrOfPinnedObject();
  }

  public static int Run(string commandLine) {
    IntPtr token, restricted;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY, out token))
      throw new Win32Exception();
    GCHandle admins, powerUsers;
    var disable = new[] {
      new SidAndAttributes { Sid = Sid("S-1-5-32-544", out admins) },
      new SidAndAttributes { Sid = Sid("S-1-5-32-547", out powerUsers) },
    };
    try {
      if (!CreateRestrictedToken(token, DISABLE_MAX_PRIVILEGE, 2, disable, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted))
        throw new Win32Exception();
    } finally {
      admins.Free(); powerUsers.Free(); CloseHandle(token);
    }
    var startup = new StartupInfo {
      cb = Marshal.SizeOf(typeof(StartupInfo)),
      dwFlags = STARTF_USESTDHANDLES,
      hStdInput = GetStdHandle(-10), hStdOutput = GetStdHandle(-11), hStdError = GetStdHandle(-12),
    };
    ProcessInformation info;
    try {
      if (!CreateProcessAsUser(restricted, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero,
          true, DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, IntPtr.Zero, null, ref startup, out info))
        throw new Win32Exception();
    } finally {
      CloseHandle(restricted);
    }
    CloseHandle(info.hThread);
    WaitForSingleObject(info.hProcess, 0xFFFFFFFF);
    uint code;
    GetExitCodeProcess(info.hProcess, out code);
    CloseHandle(info.hProcess);
    return unchecked((int)code);
  }
}
'@
$parameters = [System.CodeDom.Compiler.CompilerParameters]::new()
$parameters.GenerateInMemory = $true
$null = $parameters.ReferencedAssemblies.Add('System.dll')
$compiled = [Microsoft.CSharp.CSharpCodeProvider]::new().CompileAssemblyFromSource($parameters, $source)
if ($compiled.Errors.HasErrors) {
  foreach ($problem in $compiled.Errors) { [Console]::Error.WriteLine($problem.ToString()) }
  exit 2
}
$code = $compiled.CompiledAssembly.GetType('MdfRestricted').GetMethod('Run').Invoke($null, @($commandLine))
exit $code
