// SPDX-License-Identifier: GPL-2.0-or-later
namespace Fadester.TourBox;

/// <summary>The game controller with a scripted pad: no XInput, no OBS.</summary>
internal static class GamepadSelfTests
{
    private static void Check(bool ok, string why) { if (!ok) throw new InvalidOperationException("Game controller test failed: " + why); }

    private static PadState Pad(ushort buttons = 0, double lt = 0, double rt = 0, double lx = 0, double ly = 0, double rx = 0, double ry = 0) =>
        new(true, buttons, (byte)Math.Round(lt * 255), (byte)Math.Round(rt * 255),
            (short)Math.Round(lx * 32767), (short)Math.Round(ly * 32767), (short)Math.Round(rx * 32767), (short)Math.Round(ry * 32767));

    private static ushort Mask(string name) => PadControls.Buttons.First(b => b.Name == name).Mask;
    private static ushort Masks(params string[] names) => (ushort)names.Aggregate(0, (m, n) => m | Mask(n));

    /** The panel reads presets/gamepad.json; it must say exactly what this code does. */
    public static void CheckPresetFile(string path)
    {
        var root = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(path))!.AsObject();
        Check(root["controls"]!.AsArray().Select(n => (string)n!).SequenceEqual(PadControls.Names), "gamepad.json lists the controls in order");
        var defaults = root["defaults"]!.AsObject().ToDictionary(kv => kv.Key, kv => (string)kv.Value!);
        Check(defaults.Count == PadControls.Defaults.Count && defaults.All(kv => PadControls.Defaults.TryGetValue(kv.Key, out var a) && a == kv.Value), "gamepad.json has the default map");
        Check(root["padOnly"]!.AsArray().Select(n => (string)n!).ToHashSet().SetEquals(PadControls.PadOnly), "gamepad.json lists the controller-only actions");
        var holds = root["holdMs"]!.AsObject().ToDictionary(kv => kv.Key, kv => (int)kv.Value!);
        foreach (var id in DeskActions.Supported.Concat(PadControls.PadOnly))
            Check(PadControls.HoldMs(id) == holds.GetValueOrDefault(id), "gamepad.json has the easy-mode hold for " + id);
        Check(holds.Keys.All(PadControls.Known), "gamepad.json holds only known actions");
        Check(root["speeds"]!.AsArray().Select(n => (double)n!).SequenceEqual(BridgeConfig.PresetSpeeds), "gamepad.json lists the speed presets");
    }

    public static void Run()
    {
        // The trigger T-bar.
        var tbar = new PadTbar();
        Check(tbar.Next(0.5) == null, "a trigger already pulled when the pad appears does nothing");
        Check(tbar.Next(0.6) == null && tbar.Next(0.02) == null, "it arms only from rest, quietly");
        Check(tbar.Next(0.5) is double half && half > 0.45 && half < 0.55, "a pull throws in proportion");
        Check(tbar.Next(0.502) == null, "jitter under one percent sends nothing");
        Check(tbar.Next(0.04) is double low && low == 0.01, "a nearly released trigger stays just above Program, never a cancel");
        Check(tbar.Next(1.0) == 1, "full travel takes");
        Check(tbar.Next(0.6) == null && tbar.Next(0.2) == null, "the spring's return after a take never starts a throw back");
        Check(tbar.Next(0) == null, "back at rest it re-arms without sending");
        Check(tbar.Next(0.3) is > 0 and < 1, "the next pull throws again");
        Check(tbar.Next(0.01) == 0, "letting go before the end cancels");
        Check(tbar.Next(0.3) is > 0 and < 1 && tbar.Lost() == 0 && tbar.Next(0.3) == null, "losing the pad mid-throw cancels and disarms");
        Check(new PadTbar().Lost() == null, "losing an idle pad sends nothing");
        tbar = new PadTbar(); tbar.Next(0); tbar.Next(0.4); tbar.Disarm();
        Check(tbar.Next(0.5) == null && tbar.Next(0) == null && tbar.Next(0.5) is > 0 and < 1, "after a refusal the trigger must return to rest first");

        // A held take pushes the T-bar like a hand, end to end in the Fade's Duration; let go and it stays there.
        var slide = new PadTbar(); slide.Next(0, 0);
        slide.Slide(0, 300, 1000);
        Check(slide.Sliding && slide.Next(0, 1000, pushing: true) == 0.01, "a push starts at once, just off Program");
        Check(slide.Next(0.8, 1150, pushing: true) == 0.5, "held for half the Duration it is halfway, whatever the trigger does");
        Check(slide.Next(0, 1150, pushing: true) == null, "the same position is not sent twice");
        Check(slide.Next(0, 1400, pushing: false) == null && slide.Sliding, "let go: it stays where it is");
        Check(slide.Next(1.0, 2000, pushing: false) == null, "parked, it ignores the trigger and the time");
        Check(slide.Next(0, 2000, pushing: true) == null && slide.Next(0, 2149, pushing: true) == 0.99, "pushed again it carries on from there");
        Check(slide.Next(0, 2150, pushing: true) == 1 && !slide.Sliding, "the full Duration of pushing takes");
        Check(slide.Next(0.5, 2200) == null && slide.Next(0, 2300) == null && slide.Next(0.5, 2400) is > 0 and < 1,
            "after a push the trigger must be back at rest before it throws");
        slide = new PadTbar(); slide.Slide(0.6, 200, 0);
        Check(slide.Next(0, 0, pushing: true) == 0.6 && slide.Next(0, 40, pushing: true) == 0.8 && slide.Next(0, 80, pushing: true) == 1,
            "a push from part-way goes on from there at the same speed");
        slide = new PadTbar(); slide.Slide(0, 300, 0);
        Check(slide.Next(0, 10, pushing: false) == null && !slide.Sliding, "let go before it moved, nothing happens and nothing is parked");
        slide = new PadTbar(); slide.Slide(0, 300, 0); slide.Next(0, 0, pushing: true); slide.Disarm();
        Check(slide.Next(0, 100, pushing: true) == null && slide.Next(0, 400, pushing: true) == null, "a cancel or cue stops a push");
        slide = new PadTbar(); slide.Slide(0, 300, 0); slide.Next(0, 0, pushing: true); slide.Next(0, 90, pushing: true);
        Check(slide.Next(0, 100, pushing: false) == null && slide.Parked && slide.Position == 0.3, "let go at 30%, it is parked there");
        Check(slide.Lost() == 0 && !slide.Parked, "losing the pad with the T-bar parked goes back to Program");
        slide = new PadTbar(); slide.Slide(0, 300, 0);
        Check(slide.Next(0, 0, pushing: true) == 0.01 && slide.Next(0, 10, pushing: false) == 0 && !slide.Sliding,
            "a push let go before 5% goes back to Program instead of leaving a sliver on air");

        // Buttons, the left trigger and the sticks.
        var reader = new PadReader(PadControls.Build(null));
        var (acts, t) = reader.Step(Pad(buttons: Mask("A"), lt: 0.9, rx: 0.9), 0);
        Check(acts.Count == 0 && t == null, "controls already held when the pad appears act on nothing");
        (acts, _) = reader.Step(Pad(buttons: Mask("A"), lt: 0.9, rx: 0.9), 10);
        Check(acts.Count == 0, "still held: still nothing");
        (acts, _) = reader.Step(Pad(), 300);
        Check(acts.Count == 0, "letting go of the held left trigger sends no restore it never ducked");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 400);
        Check(acts.SequenceEqual(["take"]), "A takes once on press");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 420);
        Check(acts.Count == 0, "holding A does not repeat");
        reader.Step(Pad(), 430); (acts, _) = reader.Step(Pad(buttons: Mask("A")), 450);
        Check(acts.Count == 0, "a bounce within 150 ms is ignored");
        reader.Step(Pad(), 600); (acts, _) = reader.Step(Pad(buttons: Masks("A", "DpadDown")), 700);
        Check(acts.SequenceEqual(["preview.next", "take"]), "two buttons in one sample both act");
        reader.Step(Pad(), 900);
        (acts, _) = reader.Step(Pad(lt: 0.6), 1000); Check(acts.SequenceEqual(["music.duck"]), "left trigger past half ducks Music");
        (acts, _) = reader.Step(Pad(lt: 0.3), 1010); Check(acts.Count == 0, "between the thresholds nothing changes");
        (acts, _) = reader.Step(Pad(lt: 0.1), 1020); Check(acts.SequenceEqual([PadControls.Release("music.restore")]), "released, it restores Music, tagged as a release");
        (acts, _) = reader.Step(Pad(ly: 0.9), 2000); Check(acts.SequenceEqual(["layer2.opacity.up"]), "left stick up rides Layer 2 opacity");
        (acts, _) = reader.Step(Pad(ly: 0.9), 2100); Check(acts.Count == 0, "no repeat before 200 ms");
        (acts, _) = reader.Step(Pad(ly: 0.9), 2200); Check(acts.SequenceEqual(["layer2.opacity.up"]), "it repeats while held");
        (acts, _) = reader.Step(Pad(ly: 0.3), 2210); Check(acts.Count == 0, "inside the threshold it stops");
        (acts, _) = reader.Step(Pad(rx: -0.8), 2300); Check(acts.SequenceEqual(["vjster.speed.down"]), "right stick left slows the video");

        // A take or cancel from a button disarms the trigger.
        reader = new PadReader(PadControls.Build(null)); reader.Step(Pad(), 0);
        (_, t) = reader.Step(Pad(rt: 0.5), 10); Check(t is > 0 and < 1, "the trigger throws");
        (acts, t) = reader.Step(Pad(buttons: Mask("A"), rt: 0.6), 20);
        Check(acts.SequenceEqual(["take"]) && t == null, "A during a throw takes and the trigger stops sending");
        (_, t) = reader.Step(Pad(rt: 0.3), 30); Check(t == null, "the held trigger cannot start a throw back after A");
        reader.Step(Pad(), 40); reader.Step(Pad(rt: 0.5), 50);
        (acts, t) = reader.Step(Pad(buttons: Mask("DpadDown"), rt: 0.6), 60);
        Check(acts.SequenceEqual(["preview.next"]) && t == null, "a Preview cue during a throw (which cancels it) disarms the trigger too");

        // The pad going away.
        reader = new PadReader(PadControls.Build(null)); reader.Step(Pad(), 0);
        reader.Step(Pad(lt: 0.8, rt: 0.5), 10);
        (acts, t) = reader.Step(PadState.Disconnected, 20);
        Check(acts.SequenceEqual([PadControls.Release("music.restore")]) && t == 0, "a lost pad restores Music and cancels the throw");
        (acts, t) = reader.Step(PadState.Disconnected, 30);
        Check(acts.Count == 0 && t == null, "and says it once");

        // Letting go of LT is never lost: it is tagged, and the dispatch loop runs it from its mailbox even when OBS was
        // away or the loop was busy (Program.cs).
        Check(PadControls.IsRelease(PadControls.Release("music.restore"), out var released) && released == "music.restore" &&
            !PadControls.IsRelease("music.restore", out var plain) && plain == "music.restore", "a release is tagged, and the tag comes off again");
        var releases = new ReleaseMailbox();
        Check(releases.Take(leftHeld: false) == null, "an empty mailbox runs nothing");
        releases.Post("music.restore");
        Check(releases.Take(leftHeld: false) == "music.restore" && releases.Take(leftHeld: false) == null, "a release waits until it runs, then runs once");
        releases.Post("music.restore"); releases.Post("mix.restore");
        Check(releases.Take(leftHeld: false) == "mix.restore", "only the newest release waits");
        releases.Post("music.restore");
        Check(releases.Take(leftHeld: true) == null && releases.Take(leftHeld: false) == null, "a release that has not run when LT is held again is dropped");
        releases.Post("music.restore"); var cut = releases.Take(leftHeld: false)!; releases.Return(cut);
        Check(releases.Take(leftHeld: false) == "music.restore", "a release a dropped connection cut off waits again");
        releases.Post("music.restore"); cut = releases.Take(leftHeld: false)!; releases.Post("mix.restore"); releases.Return(cut);
        Check(releases.Take(leftHeld: false) == "mix.restore" && releases.Take(leftHeld: false) == null, "but never over a newer release");
        releases.Post("music.restore"); cut = releases.Take(leftHeld: false)!; releases.Return(cut);
        Check(releases.Take(leftHeld: true) == null, "and it is dropped too if LT is held again before it runs");
        Check(ReleaseMailbox.CutOff(new IOException("OBS disconnected."), disconnected: false) &&
            ReleaseMailbox.CutOff(new InvalidDataException("Invalid OBS packet."), disconnected: true) &&
            !ReleaseMailbox.CutOff(new ObsError("GetInputVolume", 600, "No source was found"), disconnected: true) &&
            !ReleaseMailbox.CutOff(new InvalidOperationException("Choose Music / bed on the Assignments tab first."), disconnected: false),
            "a release runs again only when the connection dropped, never after OBS refused it or a setting is missing");
        reader = new PadReader(PadControls.Build(null)); reader.Step(Pad(), 0);
        reader.Step(Pad(lt: 0.8), 10); Check(reader.LeftTriggerHeld, "the reader says when LT is held");
        reader.Step(Pad(), 20); Check(!reader.LeftTriggerHeld, "and when it is let go");

        // The operator's own map.
        var map = PadControls.Build(new Dictionary<string, string> { ["y"] = "mix.fadeOut", ["X"] = "", ["LeftUp"] = "music.up" });
        Check(map["Y"] == "mix.fadeOut" && !map.ContainsKey("X") && map["LeftUp"] == "music.up" && map["A"] == "take", "changes apply over the defaults, case-insensitively");
        foreach (var bad in new Dictionary<string, string>[] { new() { ["RT"] = "take" }, new() { ["Q"] = "take" }, new() { ["A"] = "launch.rocket" }, new() { ["A"] = "bridge.reconnect" } })
        {
            bool refused = false;
            try { PadControls.Build(bad); } catch (InvalidDataException) { refused = true; }
            Check(refused, "refuses " + string.Join(",", bad.Select(kv => kv.Key + "=" + kv.Value)));
        }
        foreach (var (control, action) in PadControls.Defaults)
            Check(PadControls.Known(action), "default " + control + " maps to a known action");
        foreach (var id in PadControls.PadOnly) Check(VjsterDesk.Actions.Contains(id) && !DeskActions.Supported.Contains(id), id + " is a controller-only VJster action");
        foreach (var bad in new Dictionary<string, string>[] { new() { ["LB+LB"] = "undo" }, new() { ["LB+RT"] = "undo" }, new() { ["LTRelease"] = "take" }, new() { ["LB+LTRelease"] = "mic.mute" } })
        {
            bool refused = false;
            try { PadControls.Build(bad); } catch (InvalidDataException) { refused = true; }
            Check(refused, "refuses " + string.Join(",", bad.Select(kv => kv.Key + "=" + kv.Value)));
        }

        // Sticks: one axis per push, held until the stick is back in the centre; a stick action can disarm the trigger.
        reader = new PadReader(PadControls.Build(new Dictionary<string, string> { ["LeftRight"] = "fader.forward" })); reader.Step(Pad(), 0);
        (acts, _) = reader.Step(Pad(lx: 0.7, ly: 0.75), 10);
        Check(acts.SequenceEqual(["layer2.opacity.up"]), "a diagonal push acts on its stronger axis only");
        (acts, _) = reader.Step(Pad(lx: 0.95, ly: 0.65), 300);
        Check(acts.SequenceEqual(["layer2.opacity.up"]), "drifting towards the other axis keeps the first one");
        (acts, _) = reader.Step(Pad(lx: 0.95, ly: 0.1), 600);
        Check(acts.Count == 0, "the other axis waits for the centre");
        reader.Step(Pad(), 700); reader.Step(Pad(rt: 0.5), 710);
        (acts, t) = reader.Step(Pad(lx: 0.9, rt: 0.6), 720);
        Check(acts.SequenceEqual(["fader.forward"]) && t == null, "after the centre the new axis acts, and a fader tick from a stick disarms the trigger");

        // Easy mode: live actions need a hold, fire once when the time is up, and a tap leaves a note.
        reader = new PadReader(PadControls.Build(new Dictionary<string, string> { ["LT"] = "take" }), easy: true); reader.Step(Pad(), 0);
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 1000);
        Check(acts.Count == 0, "easy mode: A does not take on press");
        (acts, _) = reader.Step(Pad(), 1200);
        Check(acts.Count == 0 && reader.Notes.Count == 1 && reader.Notes[0].Contains("Hold it for 0.15 s"), "a tap takes nothing and says how");
        reader.Notes.Clear();
        reader.Step(Pad(buttons: Mask("A")), 2000); reader.Step(Pad(), 2100);
        Check(reader.Notes.Count == 0, "the note is not repeated within five seconds");
        reader.Step(Pad(buttons: Mask("A")), 3000);
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 3149); Check(acts.Count == 0, "not before 0.15 s");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 3150); Check(acts.SequenceEqual(["take"]), "held 0.15 s: take, at once");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 4500); Check(acts.Count == 0, "held on: no second take");
        (acts, _) = reader.Step(Pad(buttons: Mask("DpadDown")), 4600); Check(acts.SequenceEqual(["preview.next"]), "Preview cues stay instant");
        reader.Step(Pad(), 4700); reader.Step(Pad(buttons: Mask("B")), 5000);
        (acts, t) = reader.Step(PadState.Disconnected, 5300);
        Check(acts.Count == 0 && t == null, "a pad lost during a hold fires nothing");
        reader.Step(Pad(), 6000); reader.Step(Pad(lt: 0.8), 6100);
        (acts, _) = reader.Step(Pad(lt: 0.8), 6500); Check(acts.SequenceEqual(["take"]), "a guarded left trigger also needs the hold");
        (acts, _) = reader.Step(Pad(), 6600); Check(acts.SequenceEqual([PadControls.Release("music.restore")]), "and its release follows the accepted press");
        reader = new PadReader(PadControls.Build(new Dictionary<string, string> { ["Y"] = "mic.mute" }), easy: true); reader.Step(Pad(), 0);
        reader.Step(Pad(buttons: Mask("Y")), 100);
        (acts, _) = reader.Step(Pad(buttons: Mask("Y")), 500); Check(acts.Count == 0, "mic mute is not a 0.4 s action");
        (acts, _) = reader.Step(Pad(buttons: Mask("Y")), 800); Check(acts.SequenceEqual(["mic.mute"]), "it needs 0.7 s");

        // The shift layer: LB picks the action, never the hold time.
        map = PadControls.Build(new Dictionary<string, string> { ["LB+DpadRight"] = "music.fineUp", ["LB+X"] = "overlay.show" });
        Check(!map.ContainsKey("LB") && map["DpadRight"] == "music.up", "with a shift layer LB is only the shift");
        reader = new PadReader(map, easy: true); reader.Step(Pad(), 0);
        (acts, _) = reader.Step(Pad(buttons: Mask("LB")), 100); Check(acts.Count == 0, "LB alone does nothing");
        (acts, _) = reader.Step(Pad(buttons: Masks("LB", "DpadRight")), 200); Check(acts.SequenceEqual(["music.fineUp"]), "LB + D-pad right: the shifted action");
        (acts, _) = reader.Step(Pad(buttons: Masks("LB", "X")), 300); Check(acts.Count == 0, "a shifted live action still needs the hold");
        (acts, _) = reader.Step(Pad(buttons: Mask("X")), 500); Check(acts.Count == 0, "letting go of LB mid-hold ends the hold");
        (acts, _) = reader.Step(Pad(buttons: Mask("X")), 900); Check(acts.Count == 0, "and it never fires on the other layer");
        reader.Step(Pad(), 1000);
        (acts, _) = reader.Step(Pad(buttons: Mask("DpadRight")), 1100); Check(acts.SequenceEqual(["music.up"]), "without LB the normal action");
        reader.Step(Pad(), 1200); reader.Step(Pad(ly: 0.9), 1300);
        (acts, _) = reader.Step(Pad(buttons: Mask("LB"), ly: 0.9), 1600);
        Check(acts.Count == 0, "a stick held when LB goes down waits for the centre");
        reader.Step(Pad(), 1700); reader.Step(Pad(buttons: Mask("X")), 1800);
        (acts, _) = reader.Step(Pad(buttons: Masks("X", "LB")), 1900);
        (acts, _) = reader.Step(Pad(buttons: Masks("X", "LB")), 2400);
        Check(acts.Count == 0, "pressing LB during a hold ends it too");
        reader = new PadReader(map, easy: true);
        reader.Step(Pad(buttons: Mask("LB")), 0);
        (acts, _) = reader.Step(Pad(buttons: Masks("LB", "DpadRight")), 100);
        Check(acts.SequenceEqual(["music.fineUp"]), "a pad that connects with LB held is already on the shift layer");
        map = PadControls.Build(null);
        Check(map["DpadUp"] == "preview.previous" && map["DpadDown"] == "preview.next" && map["DpadLeft"] == "music.down" && map["DpadRight"] == "music.up",
            "the D-pad walks OBS's scene list up and down, and rides Music left and right");
        Check(PadControls.Build(new Dictionary<string, string> { ["lb+a"] = "undo" })["LB+A"] == "undo", "shifted names are case-insensitive");
        foreach (var bad in new Dictionary<string, string>[] { new() { ["LTRelease"] = "" }, new() { ["LB+LT"] = "music.duck" } })
        {
            bool refused = false;
            try { PadControls.Build(bad); } catch (InvalidDataException) { refused = true; }
            Check(refused, "a duck without its restore on the same layer is refused: " + string.Join(",", bad.Keys));
        }

        // Guarded and one-shot actions on sticks; easy mode off acts at once.
        reader = new PadReader(PadControls.Build(new Dictionary<string, string> { ["LeftUp"] = "take" }), easy: true); reader.Step(Pad(), 0);
        (acts, _) = reader.Step(Pad(ly: 0.9), 100); Check(acts.Count == 0, "a guarded stick action waits");
        reader.Step(Pad(ly: 0.3), 300); (acts, _) = reader.Step(Pad(ly: 0.9), 400);
        (acts, _) = reader.Step(Pad(ly: 0.9), 540); Check(acts.Count == 0, "a bounce through the centre restarts the wait");
        (acts, _) = reader.Step(Pad(ly: 0.9), 550); Check(acts.SequenceEqual(["take"]), "held long enough, it fires");
        (acts, _) = reader.Step(Pad(ly: 0.9), 1600); Check(acts.Count == 0, "a take on a held stick never repeats");
        Check(PadControls.Repeats("music.up") && PadControls.Repeats("layer2.blend.next") && PadControls.Repeats("fader.forward") &&
            !PadControls.Repeats("take") && !PadControls.Repeats("media.play") && !PadControls.Repeats("vjster.playPause") &&
            !PadControls.Repeats("anchor.1") && !PadControls.Repeats("vjster.speed.fast") && !PadControls.Repeats("undo"), "which actions repeat on a stick");
        reader.Step(Pad(), 900);
        (acts, _) = reader.Step(Pad(lx: -0.9), 1000); Check(acts.Count == 0, "the blend mode on the left stick waits in easy mode too");
        (acts, _) = reader.Step(Pad(lx: -0.9), 1400); Check(acts.SequenceEqual(["layer2.blend.previous"]), "and changes after 0.4 s");
        reader = new PadReader(PadControls.Build(null)); reader.Step(Pad(), 0);
        (acts, _) = reader.Step(Pad(ry: 0.9), 100); Check(acts.SequenceEqual(["vjster.speed.fast"]), "right stick up: fast preset");
        (acts, _) = reader.Step(Pad(ry: 0.9), 900); Check(acts.Count == 0, "a preset is sent once per push, not repeated");
        reader.Step(Pad(), 1000); (acts, _) = reader.Step(Pad(ry: -0.9), 1100); Check(acts.SequenceEqual(["vjster.speed.slow"]), "right stick down: slow preset");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 1200); Check(acts.SequenceEqual(["take"]), "easy mode off: take on press");

        // The mailbox between the pad and the dispatch loop.
        var mail = new TbarMailbox();
        Check(mail.Post(0.3) && !mail.Post(0.4) && mail.Take() == 0.4, "values coalesce to the newest behind one marker");
        Check(mail.Post(1) && !mail.Post(0.2) && mail.Take() == 1, "a pending take is never replaced by a mid-throw value");
        Check(mail.Post(0) && !mail.Post(0.5) && mail.Take() == 0, "nor a pending cancel");
        Check(mail.Take() == null && mail.Post(0.5), "after a take the next value queues a new marker");
        mail.Take(); mail.Fail();
        Check(!mail.Post(0.4, out bool droppedAfterFail) && !droppedAfterFail, "nothing goes out between a failure and the pad reading it");
        Check(mail.ConsumeFailure() && !mail.ConsumeFailure(), "a failure is reported to the pad once");
        Check(mail.Post(1) && !mail.Post(0.3, out bool dropped) && dropped, "a value refused behind a pending take is reported as dropped");
        mail.Take();
        mail.Slide(0, 300);
        Check(mail.TakeSlide() is { From: 0, Ms: 300 } && mail.TakeSlide() == null, "a slide request reaches the pad once");
        mail.Slide(0, 300); mail.Fail();
        Check(mail.TakeSlide() == null && mail.ConsumeFailure(), "a failure after a slide request cancels it");
        mail.Ordinary();
        Check(mail.TakeOrdinary() && !mail.TakeOrdinary(), "an ordinary-take request reaches the pad once");
        mail.Ordinary(); mail.Fail();
        Check(!mail.TakeOrdinary() && mail.ConsumeFailure(), "a failure cancels it too");
        // A held A pushes the T-bar; let go and it stays; held again it carries on; a Preview cue stops it.
        reader = new PadReader(PadControls.Build(null), easy: true); reader.Step(Pad(), 0);
        reader.Step(Pad(buttons: Mask("A")), 100);
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 250); Check(acts.SequenceEqual(["take"]), "held 0.15 s, A asks to push the T-bar");
        reader.Tbar.Slide(0, 300, 260); // the dispatch loop's plan arrives
        (_, t) = reader.Step(Pad(buttons: Mask("A"), rt: 0.9), 260); Check(t == 0.01, "while A is held the T-bar moves, and the trigger is ignored");
        (_, t) = reader.Step(Pad(buttons: Mask("A")), 410); Check(t == 0.5, "on the pad's own clock");
        reader.Notes.Clear();
        (_, t) = reader.Step(Pad(), 420); Check(t == null && reader.Tbar.Sliding, "let go of A: the T-bar stays where it is");
        Check(reader.Notes.Count == 1 && reader.Notes[0].Contains("left at 50%") && reader.Notes[0].Contains("Hold A") &&
            reader.Notes[0].Contains("press B") && reader.Notes[0].Contains("View"), "and the Activity log says where and what to do");
        reader.Step(Pad(rt: 0.5), 450); reader.Step(Pad(rt: 0.6), 460); reader.Step(Pad(), 470);
        Check(reader.Notes.Count == 2 && reader.Notes[1].Contains("right trigger waits"), "a trigger pulled meanwhile is told why it waits, once");
        (_, t) = reader.Step(Pad(buttons: Mask("A")), 600); Check(t == null, "pressed again, it waits the 0.15 s first");
        (acts, t) = reader.Step(Pad(buttons: Mask("A")), 750); Check(acts.SequenceEqual(["take"]) && t == null, "then asks again");
        reader.Tbar.Slide(0.5, 300, 760);
        (_, t) = reader.Step(Pad(buttons: Mask("A")), 760); Check(t == 0.5, "and pushes on from where it stopped");
        (acts, t) = reader.Step(Pad(buttons: Masks("A", "DpadDown")), 800);
        Check(acts.SequenceEqual(["preview.next"]) && t == null && !reader.Tbar.Sliding, "a Preview cue during a push stops it");
        // A take OBS plays by itself (Cut selected) is all at once, so in easy mode it still needs 0.4 s.
        reader = new PadReader(PadControls.Build(null), easy: true); reader.Step(Pad(), 0);
        reader.Step(Pad(buttons: Mask("A")), 100); reader.Step(Pad(buttons: Mask("A")), 250);
        reader.HoldForOrdinaryTake(); // the dispatch loop found no push
        reader.Step(Pad(buttons: Mask("A")), 300);
        (_, t) = reader.Step(Pad(buttons: Mask("A"), rt: 0.6), 400); Check(t == null, "the trigger cannot start a throw while the take waits");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 499); Check(acts.Count == 0, "an ordinary take does not go before 0.4 s");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 500); Check(acts.SequenceEqual([PadControls.TakeNow]), "held 0.4 s, it goes");
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 900); Check(acts.Count == 0, "once");
        reader.Step(Pad(), 1000); reader.Notes.Clear();
        reader.Step(Pad(buttons: Mask("A")), 2000); reader.Step(Pad(buttons: Mask("A")), 2150); reader.HoldForOrdinaryTake();
        (acts, _) = reader.Step(Pad(), 2300);
        Check(acts.Count == 0 && reader.Notes.Count == 1 && reader.Notes[0].Contains("0.4 s hold"), "let go before 0.4 s: no take, and it says why");
        reader.Step(Pad(buttons: Mask("A")), 3000); reader.Step(Pad(buttons: Mask("A")), 3150); reader.HoldForOrdinaryTake();
        (acts, _) = reader.Step(Pad(buttons: Masks("A", "View")), 3200);
        var (later, _) = reader.Step(Pad(buttons: Mask("A")), 3500);
        Check(acts.SequenceEqual(["fader.cancel"]) && later.Count == 0, "a Cancel while it waits stops the take");
        reader.Step(Pad(buttons: Mask("A")), 4000); reader.Step(Pad(buttons: Mask("A")), 4150); reader.HoldForOrdinaryTake(); reader.Disarm();
        (acts, _) = reader.Step(Pad(buttons: Mask("A")), 4500); Check(acts.Count == 0, "so does a refusal or a take from elsewhere");
        reader = new PadReader(PadControls.Build(new Dictionary<string, string> { ["LT"] = "take" })); reader.Step(Pad(), 0);
        reader.Step(Pad(lt: 0.8), 100); reader.Tbar.Slide(0, 300, 100);
        (_, t) = reader.Step(Pad(lt: 0.8), 100); Check(t == 0.01, "a take on the left trigger pushes while the trigger is held");
        (_, t) = reader.Step(Pad(lt: 0.8), 190); Check(t == 0.3, "on and on");
        (_, t) = reader.Step(Pad(lt: 0.1), 200); Check(t == null && reader.Tbar.Parked, "and parks when it is let go");
        var resend = new PadTbar(); resend.Next(0); resend.Next(0.5);
        Check(resend.Next(0.5) == null, "an unchanged trigger sends nothing");
        resend.Resend();
        Check(resend.Next(0.5) is > 0 and < 1, "after a drop the same position is sent again");
    }
}
