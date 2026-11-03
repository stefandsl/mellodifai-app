// Python launcher written next to the ACE-Step install and run with the venv
// interpreter. It ties the API server to the worker's lifetime:
// - on Windows it puts itself in a Job Object with KILL_ON_JOB_CLOSE, so any
//   process the server starts dies with it;
// - a watcher thread exits the process as soon as the worker process is gone
//   (crash, closed window, reboot of the worker), so the GPU is never held by an
//   orphan server.
// Then it runs ACE-Step's own API server module, unchanged.
export const HOST_SCRIPT = String.raw`import os, sys, threading, time, runpy

def parent_pid():
    if "--parent-pid" in sys.argv:
        i = sys.argv.index("--parent-pid")
        pid = int(sys.argv[i + 1])
        del sys.argv[i:i + 2]
        return pid
    return 0

def join_job_object():
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    class BASIC(ctypes.Structure):
        _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64), ("PerJobUserTimeLimit", ctypes.c_int64),
                    ("LimitFlags", wintypes.DWORD), ("MinimumWorkingSetSize", ctypes.c_size_t),
                    ("MaximumWorkingSetSize", ctypes.c_size_t), ("ActiveProcessLimit", wintypes.DWORD),
                    ("Affinity", ctypes.c_size_t), ("PriorityClass", wintypes.DWORD), ("SchedulingClass", wintypes.DWORD)]
    class IO(ctypes.Structure):
        _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]
    class EXT(ctypes.Structure):
        _fields_ = [("Basic", BASIC), ("Io", IO), ("ProcessMemoryLimit", ctypes.c_size_t),
                    ("JobMemoryLimit", ctypes.c_size_t), ("PeakProcessMemoryUsed", ctypes.c_size_t),
                    ("PeakJobMemoryUsed", ctypes.c_size_t)]
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    job = k32.CreateJobObjectW(None, None)
    info = EXT()
    info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    k32.SetInformationJobObject(wintypes.HANDLE(job), 9, ctypes.byref(info), ctypes.sizeof(info))
    k32.GetCurrentProcess.restype = wintypes.HANDLE
    k32.AssignProcessToJobObject(wintypes.HANDLE(job), k32.GetCurrentProcess())
    globals()["_job_handle"] = job  # keep the handle open for the process lifetime

def watch(pid):
    if pid <= 0:
        return
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.OpenProcess.restype = wintypes.HANDLE
        handle = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            os._exit(3)
        k32.WaitForSingleObject(wintypes.HANDLE(handle), 0xFFFFFFFF)
        os._exit(0)
    while True:
        try:
            os.kill(pid, 0)
        except OSError:
            os._exit(0)
        time.sleep(2)

pid = parent_pid()
try:
    join_job_object()
except Exception as error:
    print("job object unavailable:", error, file=sys.stderr)
threading.Thread(target=watch, args=(pid,), daemon=True).start()
host = os.environ.get("ACESTEP_API_HOST", "127.0.0.1")
port = os.environ.get("ACESTEP_API_PORT", "8001")
sys.argv = ["acestep.api_server", "--host", host, "--port", port]
runpy.run_module("acestep.api_server", run_name="__main__", alter_sys=True)
`;
