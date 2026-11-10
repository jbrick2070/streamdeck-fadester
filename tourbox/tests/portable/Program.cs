// SPDX-License-Identifier: GPL-2.0-or-later
using System.Runtime.InteropServices;
using System.Text;

namespace Fadester.TourBox;

internal static class CoreChecks
{
    public static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);
        Console.WriteLine($"Fadester core checks | {RuntimeInformation.OSDescription} | process {RuntimeInformation.ProcessArchitecture} | {RuntimeInformation.FrameworkDescription}");
        Console.WriteLine("Managed core logic and a simulated OBS transport only. No real OBS, global hotkeys, UI automation or controller hardware is exercised.");
        try
        {
            if (args is ["--help"])
            {
                Console.WriteLine("FadesterCoreChecks [--map PATH]\nRuns all offline checks. The default is the bundled presets/map.json.");
                return 0;
            }
            string map = args switch
            {
                [] => Path.Combine(AppContext.BaseDirectory, "presets", "map.json"),
                ["--map", var path] => Path.GetFullPath(path),
                _ => throw new ArgumentException("Use no arguments, --map PATH, or --help.")
            };
            var bindings = Binding.Load(map);
            if (!bindings.Select(b => b.Action).ToHashSet().SetEquals(DeskActions.Supported))
                throw new InvalidDataException("The real preset map must retain every supported bridge action.");
            Console.WriteLine($"PASS: real preset map, {bindings.Count} unique shortcuts and all supported actions.");
            // BridgeSelfTests also runs MixSelfTests, including temporary journal recovery.
            await BridgeSelfTests.RunAsync();
            Console.WriteLine("PASS: audio rides/undo/ramps, grouped mix and journal recovery.");
            await StudioFaderSelfTests.RunAsync();
            Console.WriteLine("PASS: Studio fader state machine with simulated native callbacks.");
            await TransitionTraceSelfTests.RunAsync();
            Console.WriteLine("PASS: transition trace attribution with a scripted OBS and clock.");
            await ObsTransportChecks.RunAsync();
            Console.WriteLine("PASS: production OBS connection authentication, framing, correlation, events, errors and disconnect handling against a private loopback fake.");
            Console.WriteLine("PASS: all portable core checks. This is not a native macOS app or a hardware compatibility test.");
            return 0;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine($"FAIL: {e.GetType().Name}: {e.Message}");
            return 1;
        }
    }
}
