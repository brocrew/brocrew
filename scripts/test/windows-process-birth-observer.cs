using System;
using System.Diagnostics;
using System.Globalization;

// Independent test oracle: the OS process start time, without a PowerShell host.
internal static class WindowsProcessBirthObserver
{
    private static int Main(string[] args)
    {
        try
        {
            int pid;
            if (args.Length != 1 ||
                !int.TryParse(args[0], NumberStyles.None, CultureInfo.InvariantCulture, out pid) ||
                pid <= 0)
                throw new ArgumentException("Expected one positive process ID.");

            using (Process process = Process.GetProcessById(pid))
                Console.Write(process.StartTime.ToUniversalTime().Ticks.ToString(CultureInfo.InvariantCulture));
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
    }
}
