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
    private readonly TextWriter output;
    private static volatile ConsoleQueue? installed;

    /** Writers that queue for <paramref name="output"/> and <paramref name="error"/>. */
    public ConsoleQueue(TextWriter output, TextWriter error)
    {
        this.output = output;
        // Whole lines, each through PanelLine.Free, whichever Write overload printed them (PanelLine.Guard).
        Out = new PanelLine.Guard(text => Add(output, text), output.Encoding);
        Error = new PanelLine.Guard(text => Add(error, text), error.Encoding);
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
        installed = queue;
        return new Restore(queue, output, error);
    }

    /// <summary>
    /// Prints a line the panel acts on (PanelLine.PickedLayer). Only this way writes one: everything printed through
    /// Console goes through PanelLine.Free, so a video title or a peer's message cannot start a line with its marker.
    /// </summary>
    public static void Marker(string line)
    {
        var queue = installed;
        if (queue != null) queue.Add(queue.output, line + Environment.NewLine);
        else Console.Out.WriteLine(line);
    }

    /// <summary>Waits up to two seconds for the lines still queued: a console that is stuck must not keep the process
    /// from ending.</summary>
    public void Dispose()
    {
        Out.Flush(); Error.Flush(); // text still waiting for its line end
        lines.CompleteAdding();
        writer.Join(TimeSpan.FromSeconds(2));
    }

    /// <summary>Free text is guarded on its way out; only <see cref="Marker"/> writes a line the panel acts on.</summary>
    internal static void SelfTest()
    {
        var printed = new StringWriter();
        using (var queue = new ConsoleQueue(printed, TextWriter.Null))
        {
            queue.Out.WriteLine("LAYER-PICKED {\"layer\":1,\"scene\":\"x\",\"source\":\"y\"} · Video 1x · playing");
            queue.Out.WriteLine("Music up");
            queue.Out.Write("VJster: a\nLAYER-PICKED b\n");
            // No overload and no way of cutting the text up gets a marker to the start of a line.
            queue.Out.Write("LAYER-"); queue.Out.Write("PICKED c"); queue.Out.WriteLine();
            foreach (char c in "LAYER-PICKED d\n") queue.Out.Write(c);
            queue.Out.Write("xxLAYER-PICKED e\nLAYER-PICKED f\n".ToCharArray(), 2, 30);
            queue.Out.Write("LAYER-PICKED g\n".AsSpan());
            queue.Out.Write(new StringBuilder("tail\nLAYER-PICKED h\n"));
            queue.Out.WriteLine("LAYER-PICKED i".ToCharArray());
            queue.Out.Write("{0}-PICKED {1}\n", "LAYER", "j");
            queue.Add(queue.output, PanelLine.PickedLayer(2, "Live", "Title") + Environment.NewLine);
        }
        string n = Environment.NewLine;
        if (printed.ToString() != "> LAYER-PICKED {\"layer\":1,\"scene\":\"x\",\"source\":\"y\"} · Video 1x · playing" + n + "Music up" + n +
            "VJster: a\n> LAYER-PICKED b\n" + "> LAYER-PICKED c" + n + "> LAYER-PICKED d\n" + "> LAYER-PICKED e\n> LAYER-PICKED f\n" +
            "> LAYER-PICKED g\n" + "tail\n> LAYER-PICKED h\n" + "> LAYER-PICKED i" + n + "> LAYER-PICKED j\n" +
            "LAYER-PICKED {\"layer\":2,\"scene\":\"Live\",\"source\":\"Title\"}" + n)
            throw new InvalidOperationException("Console queue test failed: free text must not start a line with the panel's marker.");
    }

    private void Add(TextWriter to, string text)
    {
        try { lines.Add((to, text)); }
        catch (InvalidOperationException) { } // after Dispose: nothing is printed any more
    }

    private sealed class Restore(ConsoleQueue queue, TextWriter output, TextWriter error) : IDisposable
    {
        public void Dispose()
        {
            if (installed == queue) installed = null;
            Console.SetOut(output);
            Console.SetError(error);
            queue.Dispose();
        }
    }
}
