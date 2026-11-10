// SPDX-License-Identifier: GPL-2.0-or-later
using System.Collections.Concurrent;
using System.Text;

namespace Fadester.TourBox;

/// <summary>
/// Every line the running companion prints goes through one queue, and one thread writes the lines in order. A console
/// that stops taking lines (text being selected in a classic Windows console, or a panel that reads slowly) then never
/// holds up the controls: a take, a T-bar move or the controller's next press does not wait for the screen.
/// </summary>
internal sealed class ConsoleQueue : IDisposable
{
    private readonly BlockingCollection<(TextWriter To, string Text)> lines = new();
    private readonly Thread writer;

    /** Writers that queue for <paramref name="output"/> and <paramref name="error"/>. */
    public ConsoleQueue(TextWriter output, TextWriter error)
    {
        Out = new Port(this, output);
        Error = new Port(this, error);
        writer = new Thread(() =>
        {
            foreach (var (to, text) in lines.GetConsumingEnumerable())
                try { to.Write(text); } catch (Exception) { } // a line that cannot be written must not stop the next
        }) { IsBackground = true, Name = "console writer" };
        writer.Start();
    }

    public TextWriter Out { get; }
    public TextWriter Error { get; }

    /// <summary>Sends Console.Out and Console.Error through one queue until the returned object is disposed.</summary>
    public static IDisposable Install()
    {
        TextWriter output = Console.Out, error = Console.Error;
        var queue = new ConsoleQueue(output, error);
        Console.SetOut(queue.Out);
        Console.SetError(queue.Error);
        return new Restore(queue, output, error);
    }

    /// <summary>Waits up to two seconds for the lines still queued: a console that is stuck must not keep the process
    /// from ending.</summary>
    public void Dispose()
    {
        lines.CompleteAdding();
        writer.Join(TimeSpan.FromSeconds(2));
    }

    private void Add(TextWriter to, string text)
    {
        try { lines.Add((to, text)); }
        catch (InvalidOperationException) { } // after Dispose: nothing is printed any more
    }

    private sealed class Port(ConsoleQueue queue, TextWriter to) : TextWriter
    {
        public override Encoding Encoding => to.Encoding;
        public override void Write(char value) => queue.Add(to, value.ToString());
        public override void Write(string? value) { if (!string.IsNullOrEmpty(value)) queue.Add(to, value); }
        public override void Write(char[] buffer, int index, int count) { if (count > 0) queue.Add(to, new string(buffer, index, count)); }
        // One queue entry per line, so a line is never split by another thread's.
        public override void WriteLine(string? value) => queue.Add(to, value + NewLine);
    }

    private sealed class Restore(ConsoleQueue queue, TextWriter output, TextWriter error) : IDisposable
    {
        public void Dispose()
        {
            Console.SetOut(output);
            Console.SetError(error);
            queue.Dispose();
        }
    }
}
