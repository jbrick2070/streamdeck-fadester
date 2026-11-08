// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Globalization;

namespace Fadester.TourBox;

// Experimental, not included in the shipping bridge. Authenticate the matching loopback
// OBS WebSocket first; create one of these per OBS connection, and dispose on disconnect.
internal sealed class MacNativeTBar(int port, string applicationPath) : IDisposable
{
    readonly SemaphoreSlim serial = new(1);
    Process? helper;
    bool faulted, disposed;

    internal static int Tick(double normalized)
    {
        if (!double.IsFinite(normalized) || normalized is < 0 or > 1) throw new ArgumentOutOfRangeException(nameof(normalized));
        return (int)Math.Round(normalized * 1023, MidpointRounding.AwayFromZero);
    }
    internal static int ParseOwner(string text, int port)
    {
        if (port is < 1 or > 65535 || text.Length > 65536) throw new IOException("Invalid local listener metadata.");
        int current = 0;
        bool file = false, name = false;
        HashSet<int> owners = [];
        HashSet<string> allowed = [$"127.0.0.1:{port}", $"[::1]:{port}", $"*:{port}", $"[::]:{port}", $"0.0.0.0:{port}"];
        foreach (string line in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            if (line[0] == 'p')
            {
                if (current != 0 && (!file || !name)) throw new IOException("Incomplete local listener record.");
                if (!int.TryParse(line.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out current) || current <= 0)
                    throw new IOException("Invalid local listener PID.");
                file = false; name = false;
            }
            // macOS emits the file-descriptor field even with -Fpn. Request it
            // explicitly and validate record boundaries instead of ignoring tags.
            else if (line[0] == 'f')
            {
                if (current <= 0 || (file && !name) ||
                    !int.TryParse(line.AsSpan(1), NumberStyles.None, CultureInfo.InvariantCulture, out int descriptor) || descriptor < 0)
                    throw new IOException("Invalid local listener descriptor.");
                file = true; name = false;
            }
            else if (line[0] == 'n' && current > 0 && file && !name && allowed.Contains(line[1..]))
            { owners.Add(current); name = true; }
            else throw new IOException("Listener is not a matching loopback endpoint.");
        }
        if (current == 0 || !file || !name) throw new IOException("Incomplete local listener record.");
        if (owners.Count != 1) throw new IOException("Expected exactly one local OBS listener owner.");
        return owners.Single();
    }
    static async Task<int> ListenerPid(int port)
    {
        using var process = new Process { StartInfo = new("/usr/sbin/lsof")
        { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true } };
        foreach (string arg in new[] { "-nP", $"-iTCP:{port}", "-sTCP:LISTEN", "-Ffpn" }) process.StartInfo.ArgumentList.Add(arg);
        RemoveCredentials(process.StartInfo);
        if (!process.Start()) throw new IOException("Could not inspect the local OBS listener.");
        try
        {
            Task<string> output = process.StandardOutput.ReadToEndAsync(), errors = process.StandardError.ReadToEndAsync();
            await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
            await errors; // Capture but never print potentially unrelated lsof diagnostics.
            if (process.ExitCode != 0) throw new IOException("Could not identify the local OBS listener.");
            return ParseOwner(await output, port);
        }
        finally { if (!process.HasExited) process.Kill(); }
    }
    static void RemoveCredentials(ProcessStartInfo start)
    {
        start.Environment.Remove("FADESTER_OBS_PASSWORD");
        start.Environment.Remove("FADESTER_MAC_OBS_PASSWORD");
    }
    async Task OpenLocked()
    {
        if (disposed || faulted) throw new InvalidOperationException("Native T-bar adapter is disarmed; revalidate a new OBS connection.");
        if (helper is not null)
        {
            if (helper.HasExited) throw new IOException("Native slider helper exited.");
            return;
        }
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException("Mac native slider requires macOS.");
        string executable = Path.Combine(Path.GetFullPath(applicationPath), "Contents", "MacOS", "FadesterNativeSlider");
        if (!File.Exists(executable)) throw new FileNotFoundException("Experimental native slider app is missing.", executable);
        int pid = await ListenerPid(port);
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true,
            WorkingDirectory = Path.GetDirectoryName(executable)!
        };
        foreach (string arg in new[] { "--stdio", "--obs-pid", pid.ToString(CultureInfo.InvariantCulture), "--obs-port", port.ToString(CultureInfo.InvariantCulture) }) start.ArgumentList.Add(arg);
        RemoveCredentials(start);
        helper = Process.Start(start) ?? throw new IOException("Could not start the experimental native slider app.");
        _ = await Exchange("READ"); // Bind and warm the read-only target before timestamping any write.
    }
    async Task<int> Exchange(string command)
    {
        await helper!.StandardInput.WriteLineAsync(command);
        await helper.StandardInput.FlushAsync();
        string? line = await helper.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(4));
        if (line is null || helper.HasExited) throw new IOException("Native slider connection lost.");
        if (line.StartsWith("ERR ", StringComparison.Ordinal)) throw new InvalidOperationException(line[4..]);
        if (!line.StartsWith("OK ", StringComparison.Ordinal) ||
            !int.TryParse(line.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture, out int value) || value is < 0 or > 1023)
            throw new IOException("Invalid native slider reply.");
        return value;
    }
    public async Task<int> ReadAsync()
    {
        await serial.WaitAsync();
        try { await OpenLocked(); return await Exchange("READ"); }
        catch { Fault(); throw; }
        finally { serial.Release(); }
    }
    public async Task MoveAsync(double from, double to)
    {
        int expected = Tick(from), desired = Tick(to);
        long queued = Stopwatch.GetTimestamp();
        long requestedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await serial.WaitAsync();
        try
        {
            if (Stopwatch.GetElapsedTime(queued).TotalMilliseconds > 400) throw new InvalidOperationException("Queued native move expired.");
            await OpenLocked();
            if (Stopwatch.GetElapsedTime(queued).TotalMilliseconds > 400) throw new InvalidOperationException("Native move expired during helper startup; warm ReadAsync before accepting controls.");
            if (expected == desired)
            {
                long began = Stopwatch.GetTimestamp();
                do
                {
                    if (await Exchange("READ") == desired) return;
                    await Task.Delay(25);
                } while (Stopwatch.GetElapsedTime(began).TotalMilliseconds < 600);
                throw new InvalidOperationException("OBS did not park the native T-bar at the expected position.");
            }
            string command = FormattableString.Invariant($"MOVE {expected} {desired} {requestedAt}");
            if (await Exchange(command) != desired) throw new InvalidOperationException("Native slider position not confirmed.");
        }
        catch { Fault(); throw; }
        finally { serial.Release(); }
    }
    void Fault() { faulted = true; Close(); }
    void Close()
    {
        if (helper is null) return;
        try { helper.StandardInput.Close(); if (!helper.HasExited && !helper.WaitForExit(250)) helper.Kill(); }
        catch (Exception e) when (e is IOException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        helper.Dispose(); helper = null;
    }
    public void Dispose()
    {
        serial.Wait();
        try { if (!disposed) { disposed = true; Close(); } }
        finally { serial.Release(); }
    }
}
