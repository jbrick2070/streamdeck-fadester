// SPDX-License-Identifier: GPL-2.0-or-later
using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Nodes;

namespace Fadester.TourBox;

internal sealed record MacShortcutEvent(string Action, int Generation, long UnixMs);

// Optional input transport for the experimental Mac host. It never dispatches an OBS action.
internal sealed class MacShortcutInput : IDisposable
{
    readonly string applicationPath, mapPath;
    readonly Action<MacShortcutEvent> received;
    readonly HashSet<string> actions;
    readonly int count;
    readonly SemaphoreSlim commandGate = new(1);
    readonly object acknowledgements = new();
    readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    TaskCompletionSource? pendingAck;
    string? expectedAck;
    Process? child;
    CancellationTokenRegistration cancellation;
    int stopping, started;
    public Task Ready => ready.Task;
    public Task Done => done.Task;

    public MacShortcutInput(string appPath, string mapPath, Action<MacShortcutEvent> pressed)
    {
        applicationPath = Path.GetFullPath(appPath); this.mapPath = Path.GetFullPath(mapPath); received = pressed;
        var root = JsonNode.Parse(File.ReadAllText(this.mapPath));
        if (root?["version"]?.GetValue<int>() != 1 || root["presets"] is not JsonObject presets) throw new InvalidDataException("Invalid native shortcut map.");
        actions = []; HashSet<string> labels = new(StringComparer.OrdinalIgnoreCase);
        foreach (var preset in presets)
            foreach (var row in (preset.Value?["bindings"] as JsonArray ?? throw new InvalidDataException("Missing bindings."))
                .Concat(preset.Value?["menuBindings"] as JsonArray ?? new JsonArray()))
            {
                string action = row?["action"]?.GetValue<string>() ?? "", label = row?["hotkey"]?.GetValue<string>() ?? "";
                if (action.Length is < 1 or > 64 || !action.All(c => char.IsAsciiLetterOrDigit(c) || c == '.') || label.Length == 0)
                    throw new InvalidDataException("Invalid native shortcut binding.");
                actions.Add(action); labels.Add(label);
            }
        count = labels.Count;
        if (count is < 1 or > 128) throw new InvalidDataException("Invalid native shortcut count.");
    }
    internal static bool TryParseEvent(string line, IReadOnlySet<string> allowed, out MacShortcutEvent? result)
    {
        result = null;
        if (line.Length > 180) return false;
        string[] parts = line.Split(' ');
        if (parts.Length != 4 || parts[0] != "event" ||
            !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out int generation) || generation <= 0 ||
            !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out long stamp) || stamp <= 0 || !allowed.Contains(parts[3])) return false;
        result = new(parts[3], generation, stamp); return true;
    }
    public void Start(CancellationToken stop)
    {
        if (Interlocked.Exchange(ref started, 1) != 0) throw new InvalidOperationException("Shortcut input already started.");
        if (!OperatingSystem.IsMacOS()) throw new PlatformNotSupportedException("Native Mac shortcuts require macOS.");
        string executable = Path.Combine(applicationPath, "Contents", "MacOS", "FadesterMacShortcuts");
        if (!File.Exists(executable)) throw new FileNotFoundException("Experimental Mac shortcut app is missing.", executable);
        var info = new ProcessStartInfo(executable)
        {
            UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true,
            WorkingDirectory = Path.GetDirectoryName(executable)!
        };
        info.ArgumentList.Add("--listen"); info.ArgumentList.Add(mapPath);
        info.Environment.Remove("FADESTER_OBS_PASSWORD"); info.Environment.Remove("FADESTER_MAC_OBS_PASSWORD");
        child = Process.Start(info) ?? throw new IOException("Cannot start Mac shortcut input.");
        cancellation = stop.Register(Stop);
        _ = Pump();
    }
    async Task Pump()
    {
        try
        {
            while (await child!.StandardOutput.ReadLineAsync() is { } line)
            {
                if (line == $"INPUT_READY {count}" && !ready.Task.IsCompleted) { ready.TrySetResult(); continue; }
                if (line.StartsWith("ERR ", StringComparison.Ordinal)) throw new IOException(line[4..]);
                lock (acknowledgements)
                {
                    if (line == expectedAck && pendingAck is not null) { pendingAck.TrySetResult(); continue; }
                }
                if (!ready.Task.IsCompletedSuccessfully || !TryParseEvent(line, actions, out var input)) throw new IOException("Invalid native shortcut protocol reply.");
                long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                if (input!.UnixMs < now - 1500 || input.UnixMs > now + 100 || Volatile.Read(ref stopping) != 0) continue;
                received(input); // Preserve timestamp/generation; the host enforces its 180 ms rotary cutoff.
            }
            await child.WaitForExitAsync();
            if (Volatile.Read(ref stopping) == 0) throw new IOException("Native shortcut listener exited unexpectedly.");
            ready.TrySetCanceled(); done.TrySetResult();
        }
        catch (Exception error)
        {
            ready.TrySetException(error); done.TrySetException(error);
            lock (acknowledgements) pendingAck?.TrySetException(error);
            Stop();
        }
        finally { child?.Dispose(); }
    }
    public Task ArmAsync(int generation)
    {
        if (generation <= 0) throw new ArgumentOutOfRangeException(nameof(generation));
        return Command($"ARM {generation}", $"INPUT_ARMED {generation}");
    }
    public Task DisarmAsync() => Command("DISARM", "INPUT_DISARMED");
    async Task Command(string command, string response)
    {
        await Ready.WaitAsync(TimeSpan.FromSeconds(5));
        await commandGate.WaitAsync();
        try
        {
            if (Volatile.Read(ref stopping) != 0) throw new IOException("Native shortcut input is stopping.");
            var ack = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (acknowledgements) { expectedAck = response; pendingAck = ack; }
            await child!.StandardInput.WriteLineAsync(command); await child.StandardInput.FlushAsync();
            await ack.Task.WaitAsync(TimeSpan.FromSeconds(2));
        }
        catch { Stop(); throw; }
        finally
        {
            lock (acknowledgements) { expectedAck = null; pendingAck = null; }
            commandGate.Release();
        }
    }
    void Stop()
    {
        if (Interlocked.Exchange(ref stopping, 1) != 0) return;
        try { child?.StandardInput.Close(); } catch (Exception e) when (e is IOException or InvalidOperationException) { }
        _ = Task.Run(async () =>
        {
            await Task.Delay(700);
            try { if (child is { HasExited: false }) child.Kill(); } catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        });
    }
    public void Dispose() { cancellation.Dispose(); Stop(); }
}
