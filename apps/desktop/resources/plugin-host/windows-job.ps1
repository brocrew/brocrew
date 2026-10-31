# Holds one Windows job object for the guardian that started it, which reads its answers line by
# line. The job ends every process in it when its last handle closes: when this keeper exits, on
# its own or because the guardian did. Nothing in the job may leave it.
#   assign <pid>  -> "assigned <created>" | "refused": only a running child of the guardian, made
#                    after it; the guardian's own handle, held from the start, keeps its number.
#   count         -> "count <n>": processes in the job now
#   priority      -> "priority below" | "priority normal" | "priority unknown"
#   terminate     -> "terminated" | "failed"
# Compiling the job code takes tens of seconds on a cold machine. With a cache path in
# BROCREW_PLUGIN_JOB_CACHE, it is compiled once into that file in the host's private folder and
# loaded from there after.
$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;

public static class BroCrewPluginJob {
  [StructLayout(LayoutKind.Sequential)]
  struct BasicLimit {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct IoCounters {
    public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
    public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct ExtendedLimit {
    public BasicLimit Basic;
    public IoCounters Io;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicAccounting {
    public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct BasicInformation {
    public IntPtr ExitStatus, PebBaseAddress, AffinityMask, BasePriority;
    public IntPtr UniqueProcessId, InheritedFromUniqueProcessId;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
  static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll")]
  static extern UInt64 GetTickCount64();
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimit info, int size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, out BasicAccounting info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr info, int size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern uint GetPriorityClass(IntPtr process);
  [DllImport("kernel32.dll")]
  static extern IntPtr GetCurrentProcess();
  [DllImport("ntdll.dll")]
  static extern int NtQueryInformationProcess(IntPtr process, int kind, out BasicInformation info, int size, IntPtr returned);

  const uint Terminate = 0x0001, SetQuota = 0x0100, QueryLimited = 0x1000, Synchronize = 0x100000;
  const uint StillActive = 259, KillOnJobClose = 0x2000;
  static IntPtr job = IntPtr.Zero, guardian = IntPtr.Zero;
  static int guardianPid;
  static long guardianCreated;

  static int ParentOf(IntPtr process) {
    BasicInformation info;
    if (NtQueryInformationProcess(process, 0, out info, Marshal.SizeOf(typeof(BasicInformation)), IntPtr.Zero) != 0) return -1;
    return (int)info.InheritedFromUniqueProcessId.ToInt64();
  }
  static long CreatedOf(IntPtr process) {
    long created, exited, kernel, user;
    return GetProcessTimes(process, out created, out exited, out kernel, out user) ? created : -1;
  }
  static bool Running(IntPtr process) {
    uint code;
    return GetExitCodeProcess(process, out code) && code == StillActive;
  }

  public static string Open(string name) {
    if (name == null || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^Local\\BroCrew\.Plugin\.[a-f0-9-]{36}$")) return "refused";
    guardianPid = ParentOf(GetCurrentProcess());
    if (guardianPid <= 0) return "refused";
    guardian = OpenProcess(QueryLimited | Synchronize, false, guardianPid);
    if (guardian == IntPtr.Zero || !Running(guardian)) return "refused";
    guardianCreated = CreatedOf(guardian);
    job = CreateJobObjectW(IntPtr.Zero, name);
    int openedError = Marshal.GetLastWin32Error();
    // An existing name is never ours: do not change its limits or assign anything to it.
    if (job == IntPtr.Zero || openedError == 183 || guardianCreated <= 0) {
      if (job != IntPtr.Zero) CloseHandle(job);
      job = IntPtr.Zero;
      return "refused";
    }
    ExtendedLimit limit = new ExtendedLimit();
    limit.Basic.LimitFlags = KillOnJobClose;
    if (!SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(typeof(ExtendedLimit)))) return "refused";
    return "ready";
  }

  public static string Identity() {
    long keeperCreated = CreatedOf(GetCurrentProcess());
    if (job == IntPtr.Zero || keeperCreated <= 0 || guardianCreated <= 0) return "refused";
    return "identity " + guardianPid + " " + guardianCreated + " " + System.Diagnostics.Process.GetCurrentProcess().Id + " " + keeperCreated + " " + GetTickCount64().ToString(System.Globalization.CultureInfo.InvariantCulture);
  }

  public static string Assign(int pid) {
    if (pid <= 0 || pid == System.Diagnostics.Process.GetCurrentProcess().Id || !Running(guardian)) return "refused";
    IntPtr process = OpenProcess(Terminate | SetQuota | QueryLimited | Synchronize, false, pid);
    if (process == IntPtr.Zero) return "refused";
    try {
      long created = CreatedOf(process);
      if (!Running(process) || ParentOf(process) != guardianPid || created < guardianCreated) return "refused";
      if (!AssignProcessToJobObject(job, process)) return "refused";
      return "assigned " + created;
    } finally {
      CloseHandle(process);
    }
  }

  public static string Count() {
    BasicAccounting info;
    if (!QueryInformationJobObject(job, 1, out info, Marshal.SizeOf(typeof(BasicAccounting)), IntPtr.Zero)) return "failed";
    return "count " + info.ActiveProcesses;
  }

  public static string Priority() {
    const int most = 1024;
    int size = 8 + IntPtr.Size * most;
    IntPtr list = Marshal.AllocHGlobal(size);
    try {
      if (!QueryInformationJobObject(job, 3, list, size, IntPtr.Zero)) return "priority unknown";
      int listed = Marshal.ReadInt32(list, 4);
      bool below = false;
      for (int i = 0; i < listed; i++) {
        int pid = (int)Marshal.ReadIntPtr(list, 8 + i * IntPtr.Size).ToInt64();
        IntPtr process = OpenProcess(QueryLimited, false, pid);
        if (process == IntPtr.Zero) continue;
        try {
          uint kind = GetPriorityClass(process);
          if (kind == 0) return "priority unknown";
          if (kind == 0x40 || kind == 0x4000) below = true;
        } finally {
          CloseHandle(process);
        }
      }
      return below ? "priority below" : "priority normal";
    } finally {
      Marshal.FreeHGlobal(list);
    }
  }

  public static string End() {
    return TerminateJobObject(job, 1) ? "terminated" : "failed";
  }
}
'@
$cache = $env:BROCREW_PLUGIN_JOB_CACHE
$loaded = $false
$fromCache = $false
if ($cache -and (Test-Path -LiteralPath $cache -PathType Leaf)) {
  try { Add-Type -Path $cache; $loaded = $true; $fromCache = $true } catch { $loaded = $false }
}
if (-not $loaded -and $cache) {
  $stage = "$cache.$PID.new"
  Add-Type -TypeDefinition $source -OutputAssembly $stage -OutputType Library
  try { Move-Item -LiteralPath $stage -Destination $cache -Force; Add-Type -Path $cache }
  catch { Add-Type -Path $stage }
  $loaded = $true
}
if (-not $loaded) { Add-Type -TypeDefinition $source }
$opened = [BroCrewPluginJob]::Open($env:BROCREW_PLUGIN_JOB_NAME)
# A job opened from code loaded out of the cache says so, for the host's start-time record.
[Console]::Out.WriteLine($(if ($opened -eq 'ready' -and $fromCache) { 'ready cached' } else { $opened }))
[Console]::Out.Flush()
if ($opened -ne 'ready') { exit 1 }
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $words = $line.Split(' ')
  $answer = switch ($words[0]) {
    'identity' { [BroCrewPluginJob]::Identity() }
    'assign' { [BroCrewPluginJob]::Assign([int]$words[1]) }
    'count' { [BroCrewPluginJob]::Count() }
    'priority' { [BroCrewPluginJob]::Priority() }
    'terminate' { [BroCrewPluginJob]::End() }
    default { 'refused' }
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
