using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security;
using System.Text;

// The job handle is never inherited. Closing it kills the entire service tree.
public sealed class ServiceProcess : IDisposable {
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
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int Size;
    public string Reserved, Desktop, Title;
    public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public short ShowWindow, ReservedSize;
    public IntPtr ReservedBytes, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo {
    public IntPtr Process, Thread;
    public int ProcessId, ThreadId;
  }
  [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
    public int Length;
    public IntPtr Descriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
  }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended info, uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcessWithLogonW(string user, string domain, IntPtr password, uint logonFlags, string application, StringBuilder command, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string path, uint access, uint share, ref SecurityAttributes attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

  IntPtr job;
  ProcessInfo process;
  public Process Child { get; private set; }

  static IntPtr Open(string path, bool input) {
    var attributes = new SecurityAttributes { Length=Marshal.SizeOf(typeof(SecurityAttributes)), Inherit=true };
    var handle = CreateFileW(path, input ? 0x80000000u : 0x40000000u, 3, ref attributes, input ? 3u : 2u, 0x80, IntPtr.Zero);
    if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
    return handle;
  }

  public static ServiceProcess CreateSuspended(string executable, string arguments, string cwd, string stdout, string stderr, string user, string domain, SecureString password) {
    var service = new ServiceProcess();
    IntPtr input=IntPtr.Zero, output=IntPtr.Zero, error=IntPtr.Zero, environment=IntPtr.Zero, secret=IntPtr.Zero;
    try {
      service.job = CreateJobObject(IntPtr.Zero, null);
      var limits = new Extended(); limits.Basic.Flags = 0x2000; // KILL_ON_JOB_CLOSE
      if (service.job == IntPtr.Zero || !SetInformationJobObject(service.job, 9, ref limits, (uint)Marshal.SizeOf(limits))) throw new Win32Exception(Marshal.GetLastWin32Error());
      input=Open("NUL", true); output=Open(stdout, false); error=Open(stderr, false);
      var startup = new Startup { Size=Marshal.SizeOf(typeof(Startup)), Flags=0x101, ShowWindow=0, Input=input, Output=output, Error=error };
      // Pass the host's already filtered environment to both creation APIs.
      var variables = new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach (DictionaryEntry entry in Environment.GetEnvironmentVariables()) variables[(string)entry.Key]=(string)entry.Value;
      var block = new StringBuilder();
      foreach (var entry in variables) block.Append(entry.Key).Append('=').Append(entry.Value).Append('\0');
      block.Append('\0');
      environment=Marshal.StringToHGlobalUni(block.ToString());
      var command = new StringBuilder("\"" + executable + "\" " + arguments);
      const uint flags=0x08000404; // CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED
      bool created;
      if (password == null) created=CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, flags, environment, cwd, ref startup, out service.process);
      else {
        secret=Marshal.SecureStringToGlobalAllocUnicode(password);
        created=CreateProcessWithLogonW(user, domain, secret, 0, executable, command, flags, environment, cwd, ref startup, out service.process);
      }
      if (!created) throw new Win32Exception(Marshal.GetLastWin32Error());
      if (!AssignProcessToJobObject(service.job, service.process.Process)) throw new Win32Exception(Marshal.GetLastWin32Error());
      service.Child=Process.GetProcessById(service.process.ProcessId);
      return service;
    } catch {
      // A failed assignment still leaves a suspended process that must be terminated.
      if (service.process.Process != IntPtr.Zero) TerminateProcess(service.process.Process, 1);
      service.Dispose();
      throw;
    } finally {
      if (secret != IntPtr.Zero) Marshal.ZeroFreeGlobalAllocUnicode(secret);
      if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
      foreach (var handle in new[] {input, output, error}) if (handle != IntPtr.Zero) CloseHandle(handle);
    }
  }

  public void Resume() {
    if (process.Thread == IntPtr.Zero) throw new InvalidOperationException("Service already resumed");
    if (ResumeThread(process.Thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
    CloseHandle(process.Thread); process.Thread=IntPtr.Zero;
  }

  public void Dispose() {
    if (job != IntPtr.Zero) { CloseHandle(job); job=IntPtr.Zero; }
    if (process.Thread != IntPtr.Zero) { CloseHandle(process.Thread); process.Thread=IntPtr.Zero; }
    if (process.Process != IntPtr.Zero) { CloseHandle(process.Process); process.Process=IntPtr.Zero; }
    if (Child != null) { Child.Dispose(); Child=null; }
  }
}
