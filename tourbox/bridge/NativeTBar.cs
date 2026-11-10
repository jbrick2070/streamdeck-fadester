// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Runtime.InteropServices;

namespace Fadester.TourBox;

// The websocket authenticates the OBS connection; the matching local listener identifies its
// Windows process. Never select a window by title or fall back to whatever app has the focus.
internal sealed class NativeTBar(int port) : IDisposable
{
    private Process? helper, target;
    private readonly SemaphoreSlim serial = new(1);

    [DllImport("iphlpapi.dll")]
    private static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
        [MarshalAs(UnmanagedType.Bool)] bool sorted, int family, int tableClass, uint reserved);

    private int ListenerPid()
    {
        var owners = new HashSet<int>();
        foreach (var family in new[] { 2, 23 }) // AF_INET, AF_INET6
        {
            int size = 0;
            const int listenerTable = 3; // TCP_TABLE_OWNER_PID_LISTENER
            var status = GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, listenerTable, 0);
            if (status == 50 && family == 23) continue; // IPv6 unsupported
            if (status != 122 || size < 4) throw new IOException("Couldn't identify the local OBS listener.");
            IntPtr table = Marshal.AllocHGlobal(size);
            try
            {
                int capacity = size;
                status = GetExtendedTcpTable(table, ref size, false, family, listenerTable, 0);
                if (status != 0) throw new IOException("Couldn't read the local OBS listener.");
                bool v6 = family == 23;
                int stride = v6 ? 56 : 24, count = Marshal.ReadInt32(table);
                if (count < 0 || count > (capacity - 4) / stride) throw new InvalidDataException("Invalid TCP listener table.");
                for (int i = 0; i < count; i++)
                {
                    var row = IntPtr.Add(table, 4 + i * stride);
                    int portAt = v6 ? 20 : 8;
                    if ((Marshal.ReadByte(row, portAt) << 8 | Marshal.ReadByte(row, portAt + 1)) != port) continue;
                    var address = new byte[v6 ? 16 : 4];
                    Marshal.Copy(IntPtr.Add(row, v6 ? 0 : 4), address, 0, address.Length);
                    if (address.Any(b => b != 0) && !IPAddress.IsLoopback(new IPAddress(address))) continue;
                    owners.Add(Marshal.ReadInt32(row, v6 ? 52 : 20));
                }
            }
            finally { Marshal.FreeHGlobal(table); }
        }
        if (owners.Count != 1) throw new InvalidOperationException("Could not match the WebSocket port to exactly one local OBS process.");
        return owners.Single();
    }

    private void Open()
    {
        if (helper != null && !helper.HasExited && target is { HasExited: false }) return;
        Close();
        target = Process.GetProcessById(ListenerPid());
        if (!target.ProcessName.Equals("obs64", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The local WebSocket listener isn't OBS Studio.");
        // Hold the OS handle for this connection; a recycled PID is not the same process.
        _ = target.Handle;
        string exe = Path.Combine(AppContext.BaseDirectory, "FadesterNativeSlider.exe");
        if (!File.Exists(exe)) throw new FileNotFoundException("A file of the app is missing: FadesterNativeSlider.exe. Install Fadester Companion again, or extract the whole ZIP again, to use the T-bar.", exe);
        var start = new ProcessStartInfo(exe)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true,
            RedirectStandardOutput = true, WorkingDirectory = AppContext.BaseDirectory
        };
        start.ArgumentList.Add(target.Id.ToString(CultureInfo.InvariantCulture));
        helper = Process.Start(start) ?? throw new IOException("Could not open the OBS slider helper.");
    }

    private static int Tick(double normalized)
    {
        if (!double.IsFinite(normalized) || normalized < 0 || normalized > 1) throw new ArgumentOutOfRangeException(nameof(normalized));
        return (int)Math.Round(normalized * 1023, MidpointRounding.AwayFromZero);
    }

    private async Task<int> RequestAsync(string request)
    {
        await serial.WaitAsync();
        try
        {
            Open();
            await helper!.StandardInput.WriteLineAsync(request);
            await helper.StandardInput.FlushAsync();
            string? line = await helper.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(3));
            if (target!.HasExited || line == null) throw new IOException("Lost the OBS slider connection.");
            if (line.StartsWith("ERR ", StringComparison.Ordinal))
            {
                // The helper says when a write may have landed; any other refusal wrote nothing.
                string why = line[4..];
                if (why.StartsWith("write unconfirmed", StringComparison.Ordinal) || why.StartsWith("prior write unconfirmed", StringComparison.Ordinal))
                    throw new InvalidOperationException(why);
                throw new NativeRefusal(why);
            }
            if (!line.StartsWith("OK ", StringComparison.Ordinal) ||
                !int.TryParse(line.AsSpan(3), NumberStyles.None, CultureInfo.InvariantCulture, out int result) ||
                result is < 0 or > 1023) throw new IOException("Unexpected OBS slider response.");
            return result;
        }
        catch { Close(); throw; } // A timed-out write may already have arrived. Never replay it.
        finally { serial.Release(); }
    }

    public async Task MoveAsync(double from, double to)
    {
        int expected = Tick(from), next = Tick(to);
        if (expected == next)
        {
            // OBS releases the native control asynchronously. A verification may wait for the
            // handle to park but must never pull an operator's handle back to zero.
            for (int attempt = 0; attempt < 24; attempt++)
            {
                if (await ReadAsync() == next) return;
                await Task.Delay(25);
            }
            throw new InvalidOperationException("OBS did not park the native slider at the expected position.");
        }
        var actual = await RequestAsync(FormattableString.Invariant($"{expected} {next}"));
        if (actual != next) throw new InvalidOperationException("OBS did not confirm the new slider position.");
    }

    public Task<int> ReadAsync() => RequestAsync("READ");

    private void Close()
    {
        if (helper != null)
        {
            try { helper.StandardInput.Close(); if (!helper.HasExited && !helper.WaitForExit(200)) helper.Kill(); }
            catch (Exception ex) when (ex is IOException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
            helper.Dispose(); helper = null;
        }
        target?.Dispose(); target = null;
    }
    public void Dispose() { Close(); serial.Dispose(); }
}
