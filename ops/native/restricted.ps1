# Runs the command line in MDF_RESTRICTED_COMMAND under a restricted copy of this
# process's token, the way pg_ctl starts PostgreSQL: the Administrators and Power
# Users groups become deny-only and every privilege is dropped. PostgreSQL refuses
# to start under an administrator token (elevated terminals, CI runners).
# The command inherits this process's standard handles and folder, and gets its own
# hidden console.
# This process waits for it and exits with its exit code. The command and all its
# descendants run in a job that is closed, and so ended, when this process ends.
# With MDF_RESTRICTED_REPORT_PID=1 the command writes its stdout to this process's
# stderr, and this process writes the command's pid as the one line of its stdout.
$ErrorActionPreference = 'Stop'
# .NET calls only: module auto-loading is slow under a fresh LOCALAPPDATA.
$PSModuleAutoLoadingPreference = 'None'
$commandLine = $env:MDF_RESTRICTED_COMMAND
$reportPid = $env:MDF_RESTRICTED_REPORT_PID -eq '1'
if (-not $commandLine) {
  [Console]::Error.WriteLine('MDF_RESTRICTED_COMMAND is empty')
  exit 2
}
[Environment]::SetEnvironmentVariable('MDF_RESTRICTED_COMMAND', $null)
[Environment]::SetEnvironmentVariable('MDF_RESTRICTED_REPORT_PID', $null)
$source = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
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
  [DllImport("advapi32.dll", SetLastError = true)]
  static extern bool SetTokenInformation(IntPtr token, int infoClass, ref IntPtr info, int length);
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit {
    public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
    public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount;
    public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit {
    public BasicLimit BasicLimitInformation; public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
  }
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int length);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  const uint TOKEN_ASSIGN_PRIMARY = 0x1, TOKEN_DUPLICATE = 0x2, TOKEN_QUERY = 0x8, TOKEN_ADJUST_DEFAULT = 0x80;
  const int TokenDefaultDacl = 6;
  const int GENERIC_ALL = 0x10000000;
  const uint DISABLE_MAX_PRIVILEGE = 0x1;
  const int STARTF_USESHOWWINDOW = 0x1, STARTF_USESTDHANDLES = 0x100;
  const short SW_HIDE = 0;
  const uint CREATE_NEW_CONSOLE = 0x10, CREATE_SUSPENDED = 0x4;
  const int JobObjectExtendedLimitInformation = 9;
  const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

  static IntPtr Sid(string value, out GCHandle pin) {
    var sid = new SecurityIdentifier(value);
    var bytes = new byte[sid.BinaryLength];
    sid.GetBinaryForm(bytes, 0);
    pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
    return pin.AddrOfPinnedObject();
  }

  public static int Run(string commandLine, bool reportPid) {
    IntPtr token, restricted;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT, out token))
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
    // An elevated token's default DACL grants only Administrators and SYSTEM. With
    // Administrators deny-only, the command could not open the pipes and events it
    // creates (pg_ctl adds the user for the same reason). Grant the user and SYSTEM.
    var dacl = new RawAcl(GenericAcl.AclRevision, 2);
    dacl.InsertAce(0, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, GENERIC_ALL,
      WindowsIdentity.GetCurrent().User, false, null));
    dacl.InsertAce(1, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, GENERIC_ALL,
      new SecurityIdentifier("S-1-5-18"), false, null));
    var bytes = new byte[dacl.BinaryLength];
    dacl.GetBinaryForm(bytes, 0);
    var pin = GCHandle.Alloc(bytes, GCHandleType.Pinned);
    try {
      var pointer = pin.AddrOfPinnedObject();
      if (!SetTokenInformation(restricted, TokenDefaultDacl, ref pointer, IntPtr.Size)) {
        CloseHandle(restricted);
        throw new Win32Exception();
      }
    } finally {
      pin.Free();
    }
    var startup = new StartupInfo {
      cb = Marshal.SizeOf(typeof(StartupInfo)),
      dwFlags = STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW,
      wShowWindow = SW_HIDE,
      hStdInput = GetStdHandle(-10),
      hStdOutput = GetStdHandle(reportPid ? -12 : -11),
      hStdError = GetStdHandle(-12),
    };
    // The command and everything it starts live in a job that ends with this process.
    // PostgreSQL creates each backend suspended and resumes it after writing its
    // parameters; a postmaster killed in between leaves a backend that never runs,
    // never exits and keeps the listening socket. Closing the job ends it.
    var job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception();
    var limit = new ExtendedLimit();
    limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limit,
        Marshal.SizeOf(typeof(ExtendedLimit))))
      throw new Win32Exception();
    ProcessInformation info;
    try {
      // The command owns one hidden console, which its own children share.
      if (!CreateProcessAsUser(restricted, null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero,
          true, CREATE_NEW_CONSOLE | CREATE_SUSPENDED, IntPtr.Zero, null, ref startup, out info))
        throw new Win32Exception();
    } finally {
      CloseHandle(restricted);
    }
    if (!AssignProcessToJobObject(job, info.hProcess)) {
      var error = new Win32Exception();
      TerminateProcess(info.hProcess, 1);
      throw error;
    }
    ResumeThread(info.hThread);
    CloseHandle(info.hThread);
    // The job handle stays open for this process's lifetime on purpose.
    if (reportPid) {
      Console.Out.WriteLine(info.dwProcessId);
      Console.Out.Flush();
    }
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
$code = $compiled.CompiledAssembly.GetType('MdfRestricted').GetMethod('Run').Invoke($null, @($commandLine, $reportPid))
exit $code
