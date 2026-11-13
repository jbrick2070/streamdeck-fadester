// SPDX-License-Identifier: GPL-2.0-or-later
using Fadester.TourBox;
static void Check(bool okay, string reason) { if (!okay) throw new Exception(reason); }
Check(MacNativeTBar.Tick(0) == 0 && MacNativeTBar.Tick(.5) == 512 && MacNativeTBar.Tick(1) == 1023, "native tick conversion");
Check(MacNativeTBar.ClassifyError("guard: stale or future write") is NativeRefusal, "pre-write guard maps to NativeRefusal");
Check(MacNativeTBar.ClassifyError("write unconfirmed: synthetic reply loss") is not NativeRefusal, "uncertain write stays non-refusal so StudioFader disarms");
foreach (double invalid in new[] { double.NaN, double.PositiveInfinity, -.1, 1.1 })
{
    try { MacNativeTBar.Tick(invalid); throw new Exception("accepted invalid tick"); }
    catch (ArgumentOutOfRangeException) { }
}
Check(MacNativeTBar.ParseOwner("p54303\nf30\nn*:4455\n", 4455) == 54303, "observed macOS automatic descriptor field");
Check(MacNativeTBar.ParseOwner("p42\nf0\nn127.0.0.1:4455\nf12\nn[::1]:4455\n", 4455) == 42, "dual-stack single owner and descriptor zero");
foreach (string invalid in new[] {
    "", "p42\nf3\nn*:4455\np99\nf4\nn[::1]:4455\n", "p42\nf3\nn192.0.2.2:4455\n",
    "p42\nf3\nn*:4456\n", "n*:4455\n", "p0\nf3\nn*:4455\n", "p42\nn*:4455\n",
    "f3\nn*:4455\n", "p42\nf-1\nn*:4455\n", "p42\nf+3\nn*:4455\n", "p42\nf3r\nn*:4455\n",
    "p42\nf2147483648\nn*:4455\n", "p42\nf3\n", "p42\nf3\np99\nf4\nn*:4455\n",
    "p42\nf3\nf4\nn*:4455\n", "p42\nf3\nn*:4455\nn*:4455\n", "p42\nf3\nn*:4455\ncOBS\n"
})
{
    try { MacNativeTBar.ParseOwner(invalid, 4455); throw new Exception("accepted invalid listener"); }
    catch (IOException) { }
}
Console.WriteLine("PASS: experimental Mac C# adapter compiles; tick conversion and strict listener parsing. No process, AX or OBS access.");

namespace Fadester.TourBox
{
    internal sealed class NativeRefusal(string message) : InvalidOperationException(message);
}
