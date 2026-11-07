// SPDX-License-Identifier: GPL-2.0-or-later
using Fadester.TourBox;
static void Check(bool value, string why) { if (!value) throw new Exception(why); }
HashSet<string> allowed = ["fader.forward", "music.down", "take"];
Check(MacShortcutInput.TryParseEvent("event 7 1793912345678 fader.forward", allowed, out var ev) && ev is { Generation: 7, UnixMs: 1793912345678, Action: "fader.forward" }, "preserve native generation/timestamp/action");
foreach (string invalid in new[] { "event 0 1 take", "event -1 1 take", "event 1 -1 take", "event 1 1 stream.start", "event 1 1 take extra", "event  1 1 take", "action take" })
    Check(!MacShortcutInput.TryParseEvent(invalid, allowed, out _), "reject malformed/unmapped event");
Console.WriteLine("PASS: Mac shortcut C# transport compiles and validates exact timestamped ingress records. No native listener, hardware, UI or OBS used.");
