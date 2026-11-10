// SPDX-License-Identifier: GPL-2.0-or-later
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Fadester.TourBox;

/// <summary>
/// The TourBox preset's global shortcuts. One that another app already owns is skipped and reported, so the rest
/// still work; only when none at all can be registered does the start fail.
/// </summary>
internal sealed class Hotkeys(List<Binding> bindings, Action<string> pressed, Action<string>? log = null)
{
    private readonly List<Binding> registered = new();
    /** How many shortcuts are registered; read it after Ready. */
    public int Count => registered.Count;
    [StructLayout(LayoutKind.Sequential)] private struct Msg { public IntPtr Hwnd; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X, Y; public uint Private; }
    [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr hwnd, int id, uint mods, uint key);
    [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr hwnd, int id);
    [DllImport("user32.dll", EntryPoint = "GetMessageW", SetLastError = true)] private static extern int GetMessage(out Msg msg, IntPtr hwnd, uint min, uint max);
    [DllImport("user32.dll", EntryPoint = "PeekMessageW")] private static extern bool PeekMessage(out Msg msg, IntPtr hwnd, uint min, uint max, uint remove);
    [DllImport("user32.dll", EntryPoint = "PostThreadMessageW", SetLastError = true)] private static extern bool PostThreadMessage(uint thread, uint msg, UIntPtr w, IntPtr l);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task Ready => ready.Task;
    public Task Done => done.Task;

    public void Start(CancellationToken stop)
    {
        new Thread(() =>
        {
            try
            {
                uint tid = GetCurrentThreadId();
                PeekMessage(out _, IntPtr.Zero, 0, 0, 0);
                using var registration = stop.Register(() => PostThreadMessage(tid, 0x0012, UIntPtr.Zero, IntPtr.Zero));
                int lastError = 0;
                var skipped = new List<Binding>();
                foreach (var b in bindings)
                {
                    if (RegisterHotKey(IntPtr.Zero, registered.Count + 1, b.Chord.Mods, b.Chord.Key)) registered.Add(b);
                    else { lastError = Marshal.GetLastWin32Error(); skipped.Add(b); }
                }
                if (registered.Count == 0 && bindings.Count > 0)
                    throw new Win32Exception(lastError, "No TourBox shortcut could be registered. Another app, or Fadester Companion started a second time, owns them.");
                foreach (var b in skipped)
                    log?.Invoke($"The shortcut {b.Label} ({ActionNames.Of(b.Action)}) is in use by another app. The TourBox control for it is off. Everything else works.");
                ready.TrySetResult();
                while (!stop.IsCancellationRequested)
                {
                    int result = GetMessage(out var msg, IntPtr.Zero, 0, 0);
                    if (result < 0) throw new Win32Exception(Marshal.GetLastWin32Error());
                    if (result == 0) break;
                    if (msg.Message == 0x0312) { int i = (int)msg.WParam - 1; if (i >= 0 && i < registered.Count) pressed(registered[i].Action); }
                }
                done.TrySetResult();
            }
            catch (Exception e) { ready.TrySetException(e); done.TrySetException(e); }
            finally { for (int i = 1; i <= registered.Count; i++) UnregisterHotKey(IntPtr.Zero, i); }
        })
        { IsBackground = true, Name = "Fadester shortcuts" }.Start();
    }
}
