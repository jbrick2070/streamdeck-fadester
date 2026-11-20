// SPDX-License-Identifier: GPL-2.0-or-later
// The readiness lights in the panel's header, the reminders under them, and the "Show me" animations they open.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

namespace Fadester.TourBox {
  internal enum Lamp { Green, Amber, Red, Grey }

  /** What one light shows: its colour, its words (a catalog key), and the one button that fixes it, if any. */
  internal struct LightState {
    public Lamp Lamp; public string Text; public string Button; public string Action;
    internal LightState(Lamp lamp, string text, string button, string action) { Lamp = lamp; Text = text; Button = button; Action = action; }
  }

  /** Which colour and words each light shows: pure decisions, so the self-test can check every case. */
  internal static class Readiness {
    internal static LightState Obs(bool connected, bool running, string problem, bool studioOff, bool controlsOn) {
      // Studio Mode off: the light's own button turns it on (it asks OBS, nothing else changes). Shown with the controls
      // on too: they start by themselves now, and Preview and the T-bar do nothing until Studio Mode is on.
      if (connected)
        return studioOff ? new LightState(Lamp.Amber, "liObsStudio", "btnTurnOn", "studioOn") : new LightState(Lamp.Green, "liObsOn", null, null);
      if (!running) return new LightState(Lamp.Red, "liObsClosed", "btnOpenObs", "openObs"); // as on the Mac
      if (problem == "obs-bad-password") return new LightState(Lamp.Amber, "liObsPassword", "btnShowMe", "password");
      if (problem == null) return new LightState(Lamp.Grey, "liObsLooking", null, null); // OBS is starting, or a scan is under way
      return new LightState(Lamp.Amber, "liObsSetting", "btnShowMe", "server");
    }
    /** padSeen: a controller is plugged in now (read while the controls are off); padEver: one was plugged in this session. */
    internal static LightState Pad(bool enabled, bool mixOnly, bool controlsOn, string padState, bool padSeen, bool padEver = false) {
      if (mixOnly) return new LightState(Lamp.Grey, "liPadOff", null, null);
      if (!enabled) return padSeen ? new LightState(Lamp.Amber, "liPadIdle", "btnUseIt", "usePad") : new LightState(Lamp.Grey, "liPadOff", null, null);
      // No controller plugged in is a normal setup (TourBox or Stream Deck only), so it reads grey, not amber (FIX-2, hand
      // test 2026-11-17). Amber only for one that was plugged in this session and is gone now.
      if (controlsOn) return padState == "stPadOn" ? new LightState(Lamp.Green, "liPadOn", null, null)
        : padSeen || padEver ? new LightState(Lamp.Amber, "liPadMissing", null, null) : new LightState(Lamp.Grey, "liPadNone", null, null);
      return padSeen ? new LightState(Lamp.Green, "liPadReady", null, null) : new LightState(Lamp.Grey, "liPadNone", null, null);
    }
    /** The TourBox light, as on the Mac (Model.swift Readiness.tourBox). Grey instead of amber while a game controller is in use, so a panel without a TourBox does not nag. */
    internal static LightState TourBox(bool consoleRunning, bool consoleInstalled, bool mixOnly, bool otherController, bool oldPreset = false, bool noPreset = false) {
      if (mixOnly) return new LightState(Lamp.Grey, "liTbOff", null, null);
      // An older Fadester preset in Console: some controls do other things than the panel's map says (FIX-9).
      if (consoleRunning && oldPreset) return new LightState(Lamp.Amber, "liTbOld", "btnImportNew", "importPreset");
      var lamp = otherController ? Lamp.Grey : Lamp.Amber;
      // Console runs but holds no OBS Fadester preset (read from Console's own files, PresetAge): the TourBox does
      // nothing for OBS yet, so the light is not green. Unknown (files unreadable, a new Console format) stays "ready".
      if (consoleRunning && noPreset) return new LightState(lamp, "liTbNone", "btnImport", "importPreset");
      if (consoleRunning) return new LightState(Lamp.Green, "liTbReady", null, null);
      if (!consoleInstalled) return new LightState(lamp, "liTbMissing", "btnDownload", "downloadConsole");
      return new LightState(lamp, "liTbClosed", "btnOpenConsole", "openConsole");
    }
    /** The VJster light, as on the Mac (Model.swift Readiness.vjster). Peers are the Chrome extension and the OBS page. */
    /** usedBefore: a video has been connected on this PC at some time. VJster is on by default, so until then a missing
        video is not a fault (grey, with the same button), and a busy port is amber, not red. */
    internal static LightState Vjster(bool enabled, bool mixOnly, bool controlsOn, int peers, bool portBusy, bool usedBefore = true) {
      if (!enabled || mixOnly) return new LightState(Lamp.Grey, "liVjOff", null, null);
      if (portBusy) return new LightState(usedBefore ? Lamp.Red : Lamp.Amber, "liVjPort", "btnShowMe", "vjsterPort");
      if (!controlsOn) return new LightState(usedBefore ? Lamp.Green : Lamp.Grey, "liVjReady", null, null);
      return peers > 0 ? new LightState(Lamp.Green, "liVjOn", null, null) : new LightState(usedBefore ? Lamp.Amber : Lamp.Grey, "liVjWait", "btnShowMe", "vjsterWait");
    }
    /** Which VJster peers are connected after this bridge line (VjsterLink.cs prints these). */
    internal static HashSet<string> VjsterPeers(string line, HashSet<string> now) {
      var next = new HashSet<string>(now);
      if (line == "VJster: the Chrome extension connected") next.Add("browser");
      else if (line == "VJster: the OBS video page connected") next.Add("obs");
      else if (line.StartsWith("VJster: the Chrome extension disconnected", StringComparison.Ordinal)) next.Remove("browser");
      else if (line.StartsWith("VJster: the OBS video page disconnected", StringComparison.Ordinal)) next.Remove("obs");
      else if (line == "VJster link stopped") next.Clear();
      return next;
    }
    /** Whether VJster's port is taken after this bridge line (VjsterDesk.cs and VjsterLink.cs print these). */
    internal static bool VjsterPortBusy(string line, bool now) {
      if ((line.StartsWith("VJster port ", StringComparison.Ordinal) && line.Contains(" is in use")) || line.StartsWith("The VJster port could not be opened", StringComparison.Ordinal)) return true;
      if (line.StartsWith("VJster link listening on ", StringComparison.Ordinal) || line == "VJster link stopped") return false;
      return now;
    }
    /**
     * The Controls light, as on the Mac (Model.swift Readiness.controls). While OBS is not connected the button is Try again:
     * with the controls off it reads OBS and then starts them; with them on it restarts them (a corrected password is read then).
     */
    internal static LightState Controls(bool on, bool obsConnected) {
      // On: the light carries Stop, as on the Mac, so the way to turn the controls off is beside the words that say they are on.
      if (on) return obsConnected ? new LightState(Lamp.Green, "liCtlOn", "stop", "stop") : new LightState(Lamp.Amber, "liCtlWaiting", "btnTryAgain", "tryAgain");
      return obsConnected ? new LightState(Lamp.Grey, "liCtlOff", "btnStart", "start") : new LightState(Lamp.Grey, "liCtlOff", "btnTryAgain", "tryAgain");
    }
    /**
     * Whether the controls start by themselves at launch (FIX-5 and FIX-8, hand test 2026-11-17), as on the Mac
     * (Model.swift Readiness.autoStart). OBS need not be open: VJster controls Chrome's videos without it, and the bridge
     * connects to OBS whenever OBS appears. Mix-only serves OBS's mixer and nothing else, so it still waits for OBS.
     * On a first run too (the owner's decision, 2026-11-20: three steps to the first working control; the game controller
     * stays opt-in), and never after the user pressed Stop: that choice holds until they start the controls again.
     * "remembered" is "on", "off" or null. settingsSaved is no longer part of the rule; it is kept for the callers.
     */
    internal static bool AutoStart(bool settingsSaved, bool settingsValid, string remembered, bool obsConnected, bool controlsOn, bool mixOnly, bool vjsterOn = true) {
      return settingsValid && remembered != "off" && !controlsOn && (obsConnected || (vjsterOn && !mixOnly));
    }
    /** The bridge's own sentence when Preview or the T-bar is used with Studio Mode off (StudioFader.ReadScenesAsync). */
    internal static bool SaysStudioOff(string line) { return line != null && line.Contains("Enable Studio Mode in OBS before using Preview or the T-bar."); }
    /**
     * The one reminder worth a strip while the controls run, or null. The T-bar needs OBS's main window; a TourBox preset
     * needs OBS in front, except that Chrome in front is VJster's turn (FIX-8), and with OBS closed there is nothing to bring forward.
     */
    internal static string Reminder(bool controlsOn, bool mixOnly, bool obsHidden, bool tourboxConsole, string front, bool obsRunning, bool vjsterOn = true,
                                    bool? autoSwitch = null, bool? activeFadester = null) {
      if (!controlsOn || mixOnly) return null;
      // Auto Switch off (TourBox Console's customConfig): the selected preset serves every app in front, so OBS need not be
      // in front; but another selected preset makes every TourBox control do something else (hand test 2026-11-17).
      if (tourboxConsole && autoSwitch == false && activeFadester == false) return "remindSelectPreset";
      if (!obsRunning) return null;
      if (obsHidden) return "remindObsOpen";
      // Auto Switch unknown (Console's settings unreadable or in a new format): no strip rather than a wrong one.
      if (tourboxConsole && autoSwitch == true && !IsObs(front) && !(vjsterOn && IsChrome(front))) return "remindObsFront";
      return null;
    }
    /** How a line starts that names a layer the bridge picked by itself (PanelLine.PickedMarker in the bridge). */
    internal const string PickedMarker = "LAYER-PICKED ";
    /**
     * The layer the bridge picked by itself, from the one line it writes for that: the marker at the very start, then
     * one JSON object (layer 1 or 2, scene, source). Null for every other line. Activity text also carries video titles
     * and other text from outside, so the sentence people read ("Layer 1 = scene › source (picked automatically…") is
     * never searched: the bridge lets no free text start a line with the marker (PanelLine.Free).
     */
    internal static Tuple<int, string, string> PickedLayer(string line) {
      if (line == null || !line.StartsWith(PickedMarker, StringComparison.Ordinal)) return null;
      try {
        var d = new System.Web.Script.Serialization.JavaScriptSerializer().Deserialize<Dictionary<string, object>>(line.Substring(PickedMarker.Length));
        object layer, scene, source;
        if (d == null || d.Count != 3 || !d.TryGetValue("layer", out layer) || !d.TryGetValue("scene", out scene) || !d.TryGetValue("source", out source)) return null;
        if (!(layer is int) || ((int)layer != 1 && (int)layer != 2)) return null;
        string sceneName = scene as string, sourceName = source as string;
        if (String.IsNullOrWhiteSpace(sceneName) || String.IsNullOrWhiteSpace(sourceName)) return null;
        return Tuple.Create((int)layer, sceneName, sourceName);
      } catch (Exception) { return null; }
    }
    internal static bool IsObs(string process) {
      return String.Equals(process, "obs64", StringComparison.OrdinalIgnoreCase) || String.Equals(process, "obs", StringComparison.OrdinalIgnoreCase);
    }
    internal static bool IsChrome(string process) {
      return String.Equals(process, "chrome", StringComparison.OrdinalIgnoreCase);
    }
    internal static void Test() {
      Func<LightState, string> s = l => l.Lamp + " " + l.Text + " " + (l.Action ?? "-");
      if (s(Obs(true, true, null, false, false)) != "Green liObsOn -" || s(Obs(true, true, null, true, false)) != "Amber liObsStudio studioOn" ||
          s(Obs(true, true, null, true, true)) != "Amber liObsStudio studioOn" || s(Obs(false, false, null, false, false)) != "Red liObsClosed openObs" ||
          s(Obs(false, true, "obs-no-answer", false, false)) != "Amber liObsSetting server" ||
          s(Obs(false, true, "obs-bad-password", false, false)) != "Amber liObsPassword password" ||
          s(Obs(false, true, null, false, false)) != "Grey liObsLooking -")
        throw new InvalidOperationException("OBS light");
      if (s(Pad(false, false, false, "stPadOff", true)) != "Amber liPadIdle usePad" || s(Pad(false, false, false, "stPadOff", false)) != "Grey liPadOff -" ||
          s(Pad(true, false, true, "stPadOn", false)) != "Green liPadOn -" || s(Pad(true, false, true, "stPadMissing", true)) != "Amber liPadMissing -" ||
          s(Pad(true, false, false, "stPadOff", true)) != "Green liPadReady -" || s(Pad(true, true, true, "stPadOn", true)) != "Grey liPadOff -" ||
          s(Pad(true, false, true, "stPadMissing", false)) != "Grey liPadNone -" || s(Pad(true, false, false, "stPadOff", false)) != "Grey liPadNone -" ||
          s(Pad(true, false, true, "stPadMissing", false, true)) != "Amber liPadMissing -")
        throw new InvalidOperationException("Controller light");
      if (ActivityText.Counted("Music up", 1) != "Music up" || ActivityText.Counted("Music up", 3) != "Music up (×3)")
        throw new InvalidOperationException("Activity repeats");
      if (s(Controls(false, true)) != "Grey liCtlOff start" || s(Controls(true, true)) != "Green liCtlOn stop" ||
          s(Controls(false, false)) != "Grey liCtlOff tryAgain" || s(Controls(true, false)) != "Amber liCtlWaiting tryAgain") throw new InvalidOperationException("Controls light");
      if (!AutoStart(true, true, null, true, false, false) || !AutoStart(true, true, "on", true, false, false) || AutoStart(true, true, "off", true, false, false) ||
          !AutoStart(false, true, null, true, false, false) || AutoStart(false, true, "off", true, false, false) || AutoStart(false, false, null, true, false, false) ||
          !AutoStart(false, true, null, false, false, false) || AutoStart(false, true, null, false, false, true) ||
          AutoStart(true, false, "on", true, false, false) || !AutoStart(true, true, "on", false, false, false) ||
          AutoStart(true, true, "on", false, false, true) || !AutoStart(true, true, "on", true, false, true) ||
          AutoStart(true, true, "on", true, true, false) || AutoStart(true, true, "on", false, false, false, false) ||
          !AutoStart(true, true, "on", true, false, false, false)) throw new InvalidOperationException("Auto-start decision");
      if (Reminder(true, false, false, true, "chrome", true, false, true) != "remindObsFront") throw new InvalidOperationException("Reminder with VJster off");
      if (Reminder(true, false, false, true, "obs64", true) != null || Reminder(true, false, false, true, "chrome", true) != null ||
          Reminder(true, false, false, true, "explorer", true, true, true) != "remindObsFront" || Reminder(true, false, false, true, "explorer", false) != null ||
          Reminder(true, false, true, true, "chrome", true) != "remindObsOpen" || Reminder(false, false, false, true, "explorer", true) != null)
        throw new InvalidOperationException("Reminder strip");
      if (s(TourBox(true, true, false, false)) != "Green liTbReady -" || s(TourBox(false, true, false, false)) != "Amber liTbClosed openConsole" ||
          s(TourBox(false, false, false, false)) != "Amber liTbMissing downloadConsole" || s(TourBox(false, false, false, true)) != "Grey liTbMissing downloadConsole" ||
          s(TourBox(true, true, true, false)) != "Grey liTbOff -" || s(TourBox(true, true, false, false, true)) != "Amber liTbOld importPreset" ||
          s(TourBox(false, true, false, false, true)) != "Amber liTbClosed openConsole" || s(TourBox(true, true, true, false, true)) != "Grey liTbOff -" ||
          s(TourBox(true, true, false, false, false, true)) != "Amber liTbNone importPreset" || s(TourBox(true, true, false, true, false, true)) != "Grey liTbNone importPreset" ||
          s(TourBox(true, true, false, false, true, true)) != "Amber liTbOld importPreset" || s(TourBox(false, true, false, false, false, true)) != "Amber liTbClosed openConsole" ||
          s(TourBox(true, true, true, false, false, true)) != "Grey liTbOff -")
        throw new InvalidOperationException("TourBox light");
      if (s(Vjster(false, false, true, 1, false)) != "Grey liVjOff -" || s(Vjster(true, true, true, 1, false)) != "Grey liVjOff -" ||
          s(Vjster(true, false, false, 0, false)) != "Green liVjReady -" || s(Vjster(true, false, true, 1, false)) != "Green liVjOn -" ||
          s(Vjster(true, false, true, 0, false)) != "Amber liVjWait vjsterWait" || s(Vjster(true, false, true, 2, true)) != "Red liVjPort vjsterPort" ||
          s(Vjster(true, false, true, 0, false, false)) != "Grey liVjWait vjsterWait" || s(Vjster(true, false, false, 0, false, false)) != "Grey liVjReady -" ||
          s(Vjster(true, false, true, 0, true, false)) != "Amber liVjPort vjsterPort" || s(Vjster(true, false, true, 1, false, false)) != "Green liVjOn -")
        throw new InvalidOperationException("VJster light");
      if (!SaysStudioOff("Preview next: Enable Studio Mode in OBS before using Preview or the T-bar.") || SaysStudioOff("Music up") || SaysStudioOff(null))
        throw new InvalidOperationException("Studio Mode line");
      var peers = VjsterPeers("VJster: the Chrome extension connected", new HashSet<string>());
      peers = VjsterPeers("VJster: the OBS video page connected", peers);
      if (peers.Count != 2 || VjsterPeers("VJster: the Chrome extension disconnected (closed)", peers).Count != 1 ||
          VjsterPeers("VJster link stopped", peers).Count != 0 || VjsterPeers("Music up", peers).Count != 2)
        throw new InvalidOperationException("VJster peers");
      bool busy = VjsterPortBusy("VJster port 48150 is in use, probably by the VJster actions in your Stream Deck or OpenDeck software.", false);
      if (!busy || VjsterPortBusy("VJster link listening on 127.0.0.1:48150", busy) ||
          !VjsterPortBusy("The VJster port could not be opened (AccessDenied). Trying again every 30 s.", false) || VjsterPortBusy("Music up", false))
        throw new InvalidOperationException("VJster port");
      if (Reminder(false, false, true, true, "x", true) != null || Reminder(true, true, true, true, "x", true) != null ||
          Reminder(true, false, true, true, "obs64", true) != "remindObsOpen" || Reminder(true, false, false, true, "explorer", true, true, true) != "remindObsFront" ||
          Reminder(true, false, false, true, "obs64", true) != null || Reminder(true, false, false, false, "explorer", true) != null)
        throw new InvalidOperationException("Reminder");
      if (Reminder(true, false, false, true, "explorer", true, true, false, true) != null || Reminder(true, false, false, true, "explorer", true, true, true, true) != "remindObsFront" ||
          Reminder(true, false, false, true, "explorer", false, true, false, false) != "remindSelectPreset" ||
          Reminder(true, false, false, true, "explorer", true, true, null, null) != null || Reminder(true, false, true, true, "obs64", true, true, false, true) != "remindObsOpen" ||
          Reminder(true, false, false, false, "explorer", true, true, false, false) != null || Reminder(false, false, false, true, "explorer", true, true, false, false) != null)
        throw new InvalidOperationException("Reminder with Auto Switch");
      var picked = PickedLayer("LAYER-PICKED {\"layer\":2,\"scene\":\"Kit Visuals\",\"source\":\"Kit \\u203A Title\"}");
      if (picked == null || picked.Item1 != 2 || picked.Item2 != "Kit Visuals" || picked.Item3 != "Kit › Title") throw new InvalidOperationException("Picked layer");
      // Only the bridge's own line counts: the sentence people read, a video title that copies it, or a marker that is
      // not at the very start of the line or is malformed, changes nothing.
      foreach (var forged in new[] {
        "Layer 1 blend: Add", "Layer 1 = Kit Visuals › Kit Motion (picked automatically; change it on the Assignments tab)",
        "Layer 2 = Live › Camera (picked automatically · Video 1x · playing",
        "> LAYER-PICKED {\"layer\":1,\"scene\":\"a\",\"source\":\"b\"}", " LAYER-PICKED {\"layer\":1,\"scene\":\"a\",\"source\":\"b\"}",
        "LAYER-PICKED {\"layer\":3,\"scene\":\"a\",\"source\":\"b\"}", "LAYER-PICKED {\"layer\":\"1\",\"scene\":\"a\",\"source\":\"b\"}",
        "LAYER-PICKED {\"layer\":1,\"scene\":\"a\"}", "LAYER-PICKED {\"layer\":1,\"scene\":\"a\",\"source\":\"\"}",
        "LAYER-PICKED {\"layer\":1,\"scene\":\"a\",\"source\":\"b\",\"more\":1}", "LAYER-PICKED Layer 1 = a › b (picked automatically", "LAYER-PICKED " })
        if (PickedLayer(forged) != null) throw new InvalidOperationException("Picked layer accepted: " + forged);
      PresetAge.Test();
    }
  }

  /** Activity lines: the same message again becomes one line with a count (hand test 2026-11-17), as on the Mac. */
  internal static class ActivityText {
    internal static string Counted(string message, int count) { return count <= 1 ? message : message + " (×" + count + ")"; }
  }

  /** What the panel can see of the desktop without touching OBS: whether it runs, whether its main window is open, what is in front. */
  internal static class Desktop {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);

    internal static bool Running(string name) {
      var found = Process.GetProcessesByName(name);
      try { return found.Length > 0; } finally { foreach (var p in found) p.Dispose(); }
    }
    internal static bool ObsRunning() { return Running("obs64") || Running("obs"); }
    /**
     * One listing of the running programs for one tick of the panel's one-second timer, which used to ask Windows for the
     * whole list three to five times per tick, on the thread that draws the window.
     */
    internal sealed class Snapshot : IDisposable {
      readonly Process[] all = Process.GetProcesses();
      static bool Named(Process p, string name) {
        try { return String.Equals(p.ProcessName, name, StringComparison.OrdinalIgnoreCase); } catch (InvalidOperationException) { return false; }
      }
      internal bool Running(string name) { foreach (var p in all) if (Named(p, name)) return true; return false; }
      internal bool ObsRunning() { return Running("obs64") || Running("obs"); }
      /** As Desktop.ObsHidden: OBS runs but its main window is minimised or hidden to the tray. */
      internal bool ObsHidden() {
        foreach (var p in all) {
          if (!Named(p, "obs64") && !Named(p, "obs")) continue;
          IntPtr h;
          try { h = p.MainWindowHandle; } catch (InvalidOperationException) { continue; } catch (System.ComponentModel.Win32Exception) { continue; }
          if (h == IntPtr.Zero || IsIconic(h) || !IsWindowVisible(h)) return true;
        }
        return false;
      }
      public void Dispose() { foreach (var p in all) p.Dispose(); }
    }
    /** OBS runs but its main window is minimised or hidden (minimise to tray), where the native T-bar cannot be reached. */
    internal static bool ObsHidden() {
      foreach (var name in new[] { "obs64", "obs" }) {
        var found = Process.GetProcessesByName(name);
        try {
          foreach (var p in found) {
            IntPtr h;
            try { h = p.MainWindowHandle; } catch (InvalidOperationException) { continue; } catch (System.ComponentModel.Win32Exception) { continue; }
            if (h == IntPtr.Zero || IsIconic(h) || !IsWindowVisible(h)) return true;
          }
        } finally { foreach (var p in found) p.Dispose(); }
      }
      return false;
    }
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int length);
    delegate bool WindowProc(IntPtr window, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(WindowProc proc, IntPtr data);

    /** OBS Studio's own program, where its installer puts it (or says it did, in the registry); null when it is not found. */
    internal static string ObsExe() {
      var roots = new List<string>();
      foreach (var view in new[] { Microsoft.Win32.RegistryView.Registry64, Microsoft.Win32.RegistryView.Registry32 }) {
        try {
          using (var hive = Microsoft.Win32.RegistryKey.OpenBaseKey(Microsoft.Win32.RegistryHive.LocalMachine, view))
          using (var key = hive.OpenSubKey(@"SOFTWARE\OBS Studio")) { var dir = key == null ? null : key.GetValue(null) as string; if (!String.IsNullOrEmpty(dir)) roots.Add(dir); }
        } catch (Exception) { } // no such key, or no right to read it: the usual folder is tried next
      }
      string programs = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
      if (!String.IsNullOrEmpty(programs)) roots.Add(Path.Combine(programs, "obs-studio"));
      foreach (var root in roots) {
        try { var exe = Path.Combine(root, "bin", "64bit", "obs64.exe"); if (File.Exists(exe)) return exe; } catch (ArgumentException) { }
      }
      return null;
    }
    /** Starts OBS the way its own shortcut does: from its bin folder, or it cannot find its files. */
    internal static void StartObs(string exe, Action<string> failed) {
      try { using (Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(exe) })) { } }
      catch (Exception e) { failed(e.Message); }
    }

    /** TourBox Console's own program, where its installer puts it; null when it is not installed. */
    internal static string ConsoleExe() {
      foreach (var root in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86) }) {
        if (String.IsNullOrEmpty(root)) continue;
        var exe = Path.Combine(root, "TourBox Console", "TourBox Console.exe");
        if (File.Exists(exe)) return exe;
      }
      return null;
    }

    /** Shows OBS's main window (restored if minimised, shown if hidden to the tray) and puts it in front. False when OBS does not run. */
    internal static bool BringObsToFront() {
      var ids = new HashSet<uint>();
      IntPtr fallback = IntPtr.Zero;
      foreach (var name in new[] { "obs64", "obs" }) {
        var found = Process.GetProcessesByName(name);
        try {
          foreach (var p in found) {
            ids.Add((uint)p.Id);
            try { if (fallback == IntPtr.Zero) fallback = p.MainWindowHandle; } catch (InvalidOperationException) { } catch (System.ComponentModel.Win32Exception) { }
          }
        } finally { foreach (var p in found) p.Dispose(); }
      }
      if (ids.Count == 0) return false;
      // The main window's title starts with "OBS " (OBS 31.0.0 - Profile: …); a window hidden to the tray has no MainWindowHandle.
      IntPtr main = IntPtr.Zero;
      WindowProc look = (h, data) => {
        uint id; GetWindowThreadProcessId(h, out id);
        if (!ids.Contains(id) || GetWindow(h, 4) != IntPtr.Zero) return true; // 4: GW_OWNER, so dialogs are skipped
        var title = new StringBuilder(256); GetWindowText(h, title, title.Capacity);
        if (title.ToString().StartsWith("OBS ", StringComparison.Ordinal)) { main = h; return false; }
        return true;
      };
      EnumWindows(look, IntPtr.Zero);
      GC.KeepAlive(look);
      if (main == IntPtr.Zero) main = fallback;
      if (main == IntPtr.Zero) return true; // running, but no window yet (starting up)
      ShowWindow(main, IsIconic(main) ? 9 : 5); // SW_RESTORE, SW_SHOW
      SetForegroundWindow(main);
      return true;
    }
    /** Restores and fronts a running program's main window; false when it does not run or has no window. */
    internal static bool BringToFront(string name) {
      var found = Process.GetProcessesByName(name);
      try {
        foreach (var p in found) {
          IntPtr h;
          try { h = p.MainWindowHandle; } catch (InvalidOperationException) { continue; } catch (System.ComponentModel.Win32Exception) { continue; }
          if (h == IntPtr.Zero) continue;
          ShowWindow(h, IsIconic(h) ? 9 : 5); SetForegroundWindow(h); return true;
        }
      } finally { foreach (var p in found) p.Dispose(); }
      return false;
    }
    internal static string Front() {
      try {
        uint id; GetWindowThreadProcessId(GetForegroundWindow(), out id);
        if (id == 0) return "";
        using (var p = Process.GetProcessById((int)id)) return p.ProcessName;
      } catch (ArgumentException) { return ""; } catch (InvalidOperationException) { return ""; } catch (System.ComponentModel.Win32Exception) { return ""; }
    }
  }

  /** Whether an XInput controller is plugged in, read by the panel itself while the controls are off. */
  internal static class PadProbe {
    [StructLayout(LayoutKind.Sequential)]
    struct State { public uint Packet; public ushort Buttons; public byte LeftTrigger, RightTrigger; public short LX, LY, RX, RY; }
    [DllImport("xinput1_4.dll")] static extern uint XInputGetState(uint user, out State state);
    internal static bool Any() {
      try {
        for (uint i = 0; i < 4; i++) { State s; if (XInputGetState(i, out s) == 0) return true; }
      } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
      return false;
    }
  }

  /** One light in the header: a coloured dot, a few words, and at most one button. */
  internal sealed class Light : FlowLayoutPanel {
    readonly Dot dot = new Dot();
    readonly Label words;
    readonly Button action;
    string actionId;
    internal event Action<string> Acted;
    internal Light(Color text, Color buttonBack, Color buttonText) {
      AutoSize = true; WrapContents = false; BackColor = Color.Transparent; Margin = new Padding(0, 0, 16, 0); Padding = new Padding(0);
      dot.Size = new Size(12, 12); dot.Margin = new Padding(0, 7, 6, 0);
      words = new Label { AutoSize = true, UseMnemonic = false, ForeColor = text, Font = new Font("Segoe UI", 10, FontStyle.Bold), Margin = new Padding(0, 4, 6, 0) };
      action = new Button { AutoSize = true, Height = 26, FlatStyle = FlatStyle.Flat, BackColor = buttonBack, ForeColor = buttonText, Font = new Font("Segoe UI", 9, FontStyle.Bold), Margin = new Padding(0, 0, 0, 0), Padding = new Padding(4, 0, 4, 0), Visible = false, UseMnemonic = false, Cursor = Cursors.Hand };
      action.FlatAppearance.BorderSize = 0;
      action.Click += delegate { if (actionId != null && Acted != null) Acted(actionId); };
      Controls.Add(dot); Controls.Add(words); Controls.Add(action);
    }
    internal void Display(LightState state, PanelText text) {
      dot.Lamp = state.Lamp; dot.Invalidate();
      words.Text = text.Get(state.Text);
      actionId = state.Action;
      action.Visible = state.Button != null;
      if (state.Button != null) action.Text = text.Get(state.Button);
      AccessibleName = words.Text;
    }
    internal Lamp Lamp { get { return dot.Lamp; } }

    sealed class Dot : Control {
      internal Lamp Lamp = Lamp.Grey;
      internal Dot() { SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.SupportsTransparentBackColor, true); BackColor = Color.Transparent; }
      protected override void OnPaint(PaintEventArgs e) {
        e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var b = new SolidBrush(Colour(Lamp))) e.Graphics.FillEllipse(b, 0, 0, Width - 1, Height - 1);
      }
    }
    internal static Color Colour(Lamp lamp) {
      switch (lamp) {
        case Lamp.Green: return Color.FromArgb(76, 194, 110);
        case Lamp.Amber: return Color.FromArgb(244, 176, 48);
        case Lamp.Red: return Color.FromArgb(236, 86, 74);
        default: return Color.FromArgb(150, 156, 170);
      }
    }
  }

  /** A short silent animation of the clicks in OBS, drawn with OBS's own labels in the panel's language, so it needs no video. */
  internal sealed class ShowMeClip : Control {
    readonly string mode;
    readonly PanelText text;
    readonly Timer timer = new Timer { Interval = 33 };
    readonly Stopwatch clock = Stopwatch.StartNew();
    static readonly Color Frame = Color.FromArgb(30, 32, 41), Bar = Color.FromArgb(43, 46, 56), Docks = Color.FromArgb(37, 40, 50),
      Ghost = Color.FromArgb(78, 83, 98), Picture = Color.FromArgb(17, 19, 24), Ink = Color.FromArgb(225, 228, 236), Blue = Color.FromArgb(47, 111, 214),
      Good = Color.FromArgb(76, 194, 110);

    readonly int port;
    internal ShowMeClip(string mode, PanelText text, int port = 0) {
      this.mode = mode; this.text = text; this.port = port;
      SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
      Size = new Size(520, 250); BackColor = Color.White; AccessibleRole = AccessibleRole.Animation;
      timer.Tick += delegate { Invalidate(); };
      timer.Start();
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }

    float Length { get { return mode == "studio" ? 8.5f : mode == "password" ? 9.5f : mode == "tourbox" ? 11f : mode.StartsWith("vjster", StringComparison.Ordinal) ? 6f : 9f; } }
    static float Ease(float t, float a, float b) { if (t <= a) return 0; if (t >= b) return 1; float x = (t - a) / (b - a); return x * x * (3 - 2 * x); }
    static PointF Mix(PointF p, PointF q, float k) { return new PointF(p.X + (q.X - p.X) * k, p.Y + (q.Y - p.Y) * k); }

    /** A moment to draw instead of the running clock, for still pictures of the animation (Store art, checks). */
    internal float FixedTime = -1;

    protected override void OnPaint(PaintEventArgs e) {
      var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
      float t = FixedTime >= 0 ? FixedTime : (float)(clock.Elapsed.TotalSeconds % Length);
      if (mode == "studio") Studio(g, t);
      else if (mode == "tourbox") TourBoxImport(g, t);
      else if (mode == "vjsterWait" || mode == "vjsterPort") VjsterCards(g, t, mode == "vjsterPort");
      else Server(g, t, mode == "password");
    }

    // VJster: two ways out, side by side (the Mac panel's ShowMe.swift drawVjsterGuide).
    void VjsterCards(Graphics g, float t, bool busy) {
      Color card = Color.FromArgb(39, 48, 69), green = Good, blue = Color.FromArgb(77, 148, 255);
      Fill(g, Color.FromArgb(26, 34, 51), new RectangleF(10, 8, 500, 234), 8);
      TextRenderer.DrawText(g, busy ? text.Get("vjCardPortHead", port) : text.Get("vjCardWaitHead"), Font9b, new Rectangle(24, 18, 472, 36), Color.White,
        TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix | TextFormatFlags.VerticalCenter);
      string[] titles = busy ? new[] { "vjCardPortA", "vjCardPortB" } : new[] { "vjCardChrome", "vjCardObs" };
      string[] bodies = busy ? new[] { "vjCardPortABody", "vjCardPortBBody" } : new[] { "vjCardChromeBody", "vjCardObsBody" };
      for (int i = 0; i < 2; i++) {
        var box = new RectangleF(24 + 240 * i, 62, 232, 166);
        // Each card lights up in turn, so the eye reads one way, then the other.
        bool hot = (t % 6f) < 3f ? i == 0 : i == 1;
        Fill(g, card, box, 6); if (hot) Edge(g, i == 0 ? green : blue, box);
        TextRenderer.DrawText(g, text.Get(titles[i]), Font9b, Rectangle.Round(new RectangleF(box.X + 10, box.Y + 8, box.Width - 20, 36)), i == 0 ? green : blue,
          TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
        TextRenderer.DrawText(g, text.Get(bodies[i]), Font9, Rectangle.Round(new RectangleF(box.X + 10, box.Y + 46, box.Width - 20, box.Height - 52)), Ink,
          TextFormatFlags.WordBreak | TextFormatFlags.NoPrefix);
      }
    }

    // TourBox Console: Import, paste the copied path, open, then select the preset with Auto Switch off (the Mac's drawTourBoxImport, with Windows' file dialog).
    // Console's own labels stay as Console shows them, as the panel's texts name them.
    void TourBoxImport(Graphics g, float t) {
      Color card = Color.FromArgb(47, 52, 68), side = Color.FromArgb(34, 38, 50), amber = Color.FromArgb(244, 176, 48), muted = Color.FromArgb(148, 156, 176);
      Fill(g, Frame, new RectangleF(10, 8, 500, 234), 7);
      Fill(g, Bar, new RectangleF(10, 8, 500, 24), 7); Fill(g, Bar, new RectangleF(10, 20, 500, 12), 0);
      Words(g, "TourBox Console", new PointF(20, 13), Ghost, Font9);
      Fill(g, side, new RectangleF(20, 40, 226, 194), 6);
      Words(g, "Preset List", new PointF(30, 48), Ink, Font9b);
      var importBtn = new RectangleF(190, 46, 22, 20);
      Fill(g, card, new RectangleF(165, 46, 20, 20), 4); Fill(g, card, new RectangleF(217, 46, 20, 20), 4);
      Words(g, "+", new PointF(223, 48), muted, Font9b);
      bool importHot = t < 3.4f;
      Fill(g, importHot ? Blue : card, importBtn, 4);
      if (importHot) using (var pen = new Pen(amber, 2)) g.DrawRectangle(pen, importBtn.X - 2, importBtn.Y - 2, importBtn.Width + 4, importBtn.Height + 4);
      using (var pen = new Pen(Color.White, 1.6f) { EndCap = LineCap.Round, StartCap = LineCap.Round }) {
        // The import glyph: an arrow down into a tray.
        g.DrawLine(pen, importBtn.X + 11, importBtn.Y + 4, importBtn.X + 11, importBtn.Y + 12);
        g.DrawLines(pen, new[] { new PointF(importBtn.X + 7, importBtn.Y + 9), new PointF(importBtn.X + 11, importBtn.Y + 13), new PointF(importBtn.X + 15, importBtn.Y + 9) });
        g.DrawLines(pen, new[] { new PointF(importBtn.X + 5, importBtn.Y + 13), new PointF(importBtn.X + 5, importBtn.Y + 16), new PointF(importBtn.X + 17, importBtn.Y + 16), new PointF(importBtn.X + 17, importBtn.Y + 13) });
      }
      Fill(g, Color.FromArgb(190, card), new RectangleF(28, 74, 210, 34), 5);
      Words(g, "Auto Switch", new PointF(36, 82), Ink, Font9b);
      // Off: one preset serves every app in front (hand test 2026-11-17).
      Fill(g, Color.FromArgb(107, 112, 128), new RectangleF(198, 82, 32, 17), 8); Fill(g, Color.White, new RectangleF(200, 84, 13, 13), 6);
      // With Auto Switch off the preset is selected, not linked to an app (hand test 2026-11-17).
      bool imported = t >= 6.8f, popover = false, linked = t >= 7.6f;
      var row = new RectangleF(28, 116, 210, 34);
      var notLinked = new RectangleF(170, 123, 64, 20);
      if (imported) {
        Fill(g, linked ? Blue : Color.FromArgb(72, 76, 88), row, 5);
        Words(g, "OBS Fadester for…", new PointF(36, 125), Color.White, Font9b);
        if (linked) { Fill(g, Good, notLinked, 4); Words(g, "✓", new PointF(notLinked.X + 27, notLinked.Y + 3), Color.White, Font9b); }
      } else {
        Fill(g, card, row, 5); Words(g, "Default Preset", new PointF(36, 125), muted, Font9);
      }
      // The TourBox itself, on the right.
      Fill(g, side, new RectangleF(256, 106, 244, 128), 6);
      Fill(g, card, new RectangleF(318, 118, 124, 104), 18);
      Fill(g, Frame, new RectangleF(336, 162, 42, 42), 21); Fill(g, Frame, new RectangleF(388, 132, 32, 32), 16);
      Fill(g, Frame, new RectangleF(340, 130, 30, 16), 5); Fill(g, Color.FromArgb(190, Blue), new RectangleF(396, 178, 26, 12), 4);
      var obsRow = new RectangleF(264, 140, 228, 26);
      var saveBtn = new RectangleF(392, 202, 92, 24);
      if (popover) {
        var pop = new RectangleF(254, 40, 248, 194);
        Fill(g, Color.FromArgb(36, 39, 48), pop, 7); Edge(g, muted, pop);
        Words(g, "Running applications", new PointF(266, 50), Ink, Font9b);
        Words(g, "Fadester Companion", new PointF(272, 80), muted, Font9);
        Words(g, "Google Chrome", new PointF(272, 108), muted, Font9);
        bool chosen = t >= 8.2f;
        Fill(g, chosen ? Blue : card, obsRow, 5); Words(g, "●  OBS Studio", new PointF(274, 145), Color.White, Font9b);
        Fill(g, card, new RectangleF(288, 202, 92, 24), 5); Words(g, "Cancel", new PointF(314, 206), muted, Font9);
        Fill(g, chosen ? Blue : card, saveBtn, 5); Words(g, "Save", new PointF(424, 206), Color.White, Font9b);
      }
      // Windows' Open dialog: Ctrl+V puts the copied path in the file name, Enter opens it.
      bool dialog = t >= 3.4f && t < 6.8f;
      var field = new RectangleF(86, 150, 348, 24);
      if (dialog) {
        using (var shade = new SolidBrush(Color.FromArgb(96, 0, 0, 0))) g.FillRectangle(shade, 10, 32, 500, 210);
        var box = new RectangleF(64, 48, 392, 180);
        Fill(g, Color.White, box, 6); Edge(g, Color.FromArgb(190, 198, 212), box);
        Fill(g, Color.FromArgb(241, 244, 249), new RectangleF(72, 58, 110, 80), 4);
        for (int i = 0; i < 3; i++) Fill(g, Color.FromArgb(205, 211, 222), new RectangleF(80, 68 + 22 * i, 70 + 12 * i, 7), 3);
        for (int i = 0; i < 3; i++) Fill(g, Color.FromArgb(225, 230, 238), new RectangleF(194, 66 + 22 * i, 150 + 30 * (i % 2), 9), 3);
        Fill(g, Color.FromArgb(244, 246, 250), field, 4); Edge(g, t >= 4.2f ? Blue : Color.FromArgb(190, 198, 212), field);
        if (t >= 4.5f) Words(g, @"C:\…\presets\OBS Fadester for TourBox.tb", new PointF(field.X + 8, field.Y + 4), Color.FromArgb(26, 34, 51), Font9);
        var open = new RectangleF(370, 190, 64, 26);
        Fill(g, t >= 5.9f ? Color.FromArgb(30, 80, 170) : Blue, open, 4);
        Key(g, "Ctrl+V", new PointF(150, 196), t >= 4.0f && t < 5.0f);
        Key(g, "Enter", new PointF(238, 196), t >= 5.5f && t < 6.4f);
      }
      if (t >= 9.4f) Tick(g, t, 9.4f);
      var rest = new PointF(360, 160);
      var steps = new[] { Step(0.8f, 1.9f, Centre(importBtn)), Step(3.5f, 4.0f, Centre(field)), Step(6.9f, 7.5f, Centre(row)), Step(9.4f, 10.2f, rest) };
      Pointer(g, Walk(t, rest, steps), new[] { 2.0f, 4.1f, 7.6f }, t);
    }
    static void Key(Graphics g, string label, PointF at, bool down) {
      var size = TextRenderer.MeasureText(g, label, Font9b, Size.Empty, TextFormatFlags.NoPadding);
      var cap = new RectangleF(at.X, at.Y, size.Width + 18, 24);
      Fill(g, down ? Color.FromArgb(47, 111, 214) : Color.FromArgb(234, 238, 244), cap, 5);
      Edge(g, Color.FromArgb(170, 178, 192), cap);
      Words(g, label, new PointF(cap.X + 9, cap.Y + 4), down ? Color.White : Color.FromArgb(26, 34, 51), Font9b);
    }

    // OBS's window: title bar, a menu bar whose only readable item is Tools, a preview and the docks below it.
    RectangleF ToolsItem(Graphics g) {
      float x = 26; foreach (var w in new[] { 26f, 26f, 30f, 32f, 38f, 54f }) x += w + 12;
      var size = TextRenderer.MeasureText(g, text.Get("obsUiTools"), Font9, Size.Empty, TextFormatFlags.NoPadding);
      return new RectangleF(x - 5, 36, size.Width + 10, 20);
    }
    static readonly Font Font9 = new Font("Segoe UI", 9), Font9b = new Font("Segoe UI", 9, FontStyle.Bold);
    void Window(Graphics g, bool menuHot) {
      Fill(g, Frame, new RectangleF(10, 8, 500, 234), 7);
      Fill(g, Bar, new RectangleF(10, 8, 500, 24), 7); Fill(g, Bar, new RectangleF(10, 20, 500, 12), 0);
      Words(g, "OBS Studio", new PointF(20, 13), Ghost, Font9);
      float x = 26;
      foreach (var w in new[] { 26f, 26f, 30f, 32f, 38f, 54f }) { Fill(g, Ghost, new RectangleF(x, 43, w, 6), 3); x += w + 12; }
      var tools = ToolsItem(g);
      if (menuHot) Fill(g, Blue, tools, 4);
      Words(g, text.Get("obsUiTools"), new PointF(tools.X + 5, 38), Ink, Font9);
      Fill(g, Ghost, new RectangleF(tools.Right + 12, 43, 26, 6), 3);
      Fill(g, Picture, new RectangleF(24, 64, 472, 116), 4);
      Fill(g, Color.FromArgb(52, 84, 140), new RectangleF(170, 92, 180, 60), 6);
      Fill(g, Docks, new RectangleF(24, 188, 228, 44), 4); Fill(g, Docks, new RectangleF(268, 188, 228, 44), 4);
    }

    void Server(Graphics g, float t, bool password) {
      var tools = ToolsItem(g);
      bool menu = t >= 1.8f && t < 3.25f, dialog = t >= 3.25f && t < (password ? 6.9f : 6.35f);
      Window(g, menu);
      var menuBox = new RectangleF(Math.Min(tools.X, 502 - 232), 58, 232, 112);
      var wsRow = new RectangleF(menuBox.X + 4, menuBox.Y + 4 + 22 * 3, menuBox.Width - 8, 20);
      if (menu) {
        Fill(g, Bar, menuBox, 4); Edge(g, Color.FromArgb(70, 74, 88), menuBox);
        for (int i = 0; i < 5; i++) if (i != 3) Fill(g, Ghost, new RectangleF(menuBox.X + 12, menuBox.Y + 11 + 22 * i, 90 + 23 * (i % 3), 6), 3);
        if (t >= 2.9f) Fill(g, Blue, wsRow, 3);
        Words(g, text.Get("obsUiWsSettings"), new PointF(wsRow.X + 8, wsRow.Y + 2), Ink, Font9);
      }
      var box = new RectangleF(92, 56, 336, 178);
      var enable = new RectangleF(box.X + 20, box.Y + 44, 14, 14);
      var auth = new RectangleF(box.X + 20, box.Y + 72, 14, 14);
      var info = new RectangleF(box.X + 20, box.Y + 102, TextRenderer.MeasureText(g, text.Get("obsUiConnectInfo"), Font9).Width + 16, 24);
      var ok = new RectangleF(box.Right - 76, box.Bottom - 34, 60, 24);
      if (dialog) {
        Fill(g, Bar, box, 6); Edge(g, Color.FromArgb(70, 74, 88), box);
        Words(g, text.Get("obsUiWsSettings"), new PointF(box.X + 16, box.Y + 12), Ink, Font9b);
        Check(g, enable, password || t >= 4.5f); Words(g, text.Get("obsUiEnable"), new PointF(enable.Right + 8, enable.Y - 2), Ink, Font9);
        Check(g, auth, true); Words(g, text.Get("obsUiAuth"), new PointF(auth.Right + 8, auth.Y - 2), Ink, Font9);
        if (password) { Fill(g, password && t >= 4.4f && t < 4.7f ? Blue : Ghost, info, 4); Words(g, text.Get("obsUiConnectInfo"), new PointF(info.X + 8, info.Y + 4), Ink, Font9); }
        bool okDown = !password && t >= 6.0f && t < 6.3f;
        Fill(g, okDown ? Blue : Ghost, ok, 4); Words(g, text.Get("obsUiOk"), new PointF(ok.X + (ok.Width - TextRenderer.MeasureText(g, text.Get("obsUiOk"), Font9).Width) / 2, ok.Y + 4), Ink, Font9);
      }
      var copy = new RectangleF(box.X + 210, box.Y + 136, 22, 22);
      if (password && t >= 4.7f && t < 6.9f) {
        var pop = new RectangleF(box.X + 20, box.Y + 128, 222, 38);
        Fill(g, Frame, pop, 5); Edge(g, Blue, pop);
        Words(g, "••••••••••••", new PointF(pop.X + 12, pop.Y + 10), Ink, Font9b);
        Fill(g, t >= 6.1f && t < 6.4f ? Blue : Ghost, copy, 4);
        using (var pen = new Pen(Ink, 1.4f)) { g.DrawRectangle(pen, copy.X + 6, copy.Y + 8, 8, 9); g.DrawRectangle(pen, copy.X + 9, copy.Y + 5, 8, 9); }
      }
      if (password && t >= 6.9f) {
        float k = Ease(t, 6.9f, 7.4f);
        var card = new RectangleF(520 - (210 * k) - 6, 90, 200, 70);
        Fill(g, Color.White, card, 8); Edge(g, Color.FromArgb(200, 205, 215), card);
        Words(g, text.Get("password"), new PointF(card.X + 12, card.Y + 10), Color.FromArgb(26, 34, 51), Font9b);
        var field = new RectangleF(card.X + 12, card.Y + 34, 176, 24);
        Fill(g, Color.FromArgb(244, 246, 250), field, 4); Edge(g, Color.FromArgb(38, 90, 158), field);
        int dots = (int)Math.Round(12 * Ease(t, 7.5f, 8.4f));
        Words(g, new string('•', dots), new PointF(field.X + 8, field.Y + 4), Color.FromArgb(26, 34, 51), Font9b);
      }
      if (!password && t >= 6.5f) Tick(g, t, 6.5f);
      // The cursor walks to each thing it clicks.
      var rest = new PointF(330, 150);
      var steps = password
        ? new[] { Step(1.0f, 1.7f, Centre(tools)), Step(2.2f, 2.9f, Centre(wsRow)), Step(3.6f, 4.3f, Centre(info)), Step(5.3f, 6.0f, Centre(copy)), Step(6.9f, 7.6f, new PointF(420, 136)) }
        : new[] { Step(1.0f, 1.7f, Centre(tools)), Step(2.2f, 2.9f, Centre(wsRow)), Step(3.6f, 4.4f, Centre(enable)), Step(5.0f, 5.8f, Centre(ok)), Step(6.5f, 7.6f, rest) };
      float[] clicks = password ? new[] { 1.75f, 3.0f, 4.4f, 6.1f } : new[] { 1.75f, 3.0f, 4.5f, 6.0f };
      Pointer(g, Walk(t, rest, steps), clicks, t);
    }

    void Studio(Graphics g, float t) {
      Window(g, false);
      float split = Ease(t, 2.2f, 2.8f);
      var studio = new RectangleF(392, 198, TextRenderer.MeasureText(g, text.Get("obsUiStudio"), Font9).Width + 16, 24);
      var fade = new RectangleF(36, 198, 150, 24);
      bool studioOn = t >= 1.9f;
      if (split > 0) {
        Fill(g, Picture, new RectangleF(24, 64, 472, 116), 4);
        float w = 236 - 16 * split;
        float bar = Ease(t, 4.8f, 5.8f) - Ease(t, 6.0f, 7.0f);
        Fill(g, Color.FromArgb(52, 84, 140), new RectangleF(30, 70, w - 14, 104), 5); // Preview
        Fill(g, Color.FromArgb((int)(104 - 52 * bar), (int)(66 + 18 * bar), (int)(132 + 8 * bar)), new RectangleF(496 - w + 8, 70, w - 14, 104), 5); // Program takes Preview's picture
        float x = 260;
        using (var pen = new Pen(Ghost, 3)) g.DrawLine(pen, x, 78, x, 166);
        Fill(g, Ink, new RectangleF(x - 9, 78 + 80 * bar, 18, 8), 3);
      }
      for (int i = 0; i < 3; i++) Fill(g, Ghost, new RectangleF(284 + 34 * i, 207, 24, 6), 3);
      Fill(g, studioOn ? Blue : Ghost, studio, 4); Words(g, text.Get("obsUiStudio"), new PointF(studio.X + 8, studio.Y + 4), Ink, Font9);
      bool fadeHot = t >= 3.9f && t < 4.7f;
      Fill(g, Frame, fade, 4); Edge(g, fadeHot ? Blue : Ghost, fade);
      Words(g, text.Get("obsUiFade"), new PointF(fade.X + 8, fade.Y + 4), Ink, Font9);
      using (var b = new SolidBrush(Ink)) g.FillPolygon(b, new[] { new PointF(fade.Right - 16, fade.Y + 10), new PointF(fade.Right - 8, fade.Y + 10), new PointF(fade.Right - 12, fade.Y + 15) });
      var rest = new PointF(330, 130);
      Pointer(g, Walk(t, rest, new[] { Step(1.0f, 1.8f, Centre(studio)), Step(3.0f, 3.8f, Centre(fade)), Step(4.8f, 5.6f, rest) }), new[] { 1.9f, 3.9f }, t);
    }

    struct Hop { public float From, To; public PointF Target; }
    static Hop Step(float from, float to, PointF target) { Hop m; m.From = from; m.To = to; m.Target = target; return m; }
    static PointF Walk(float t, PointF start, Hop[] steps) {
      var at = start;
      foreach (var s in steps) { if (t < s.From) break; at = Mix(at, s.Target, Ease(t, s.From, s.To)); }
      return at;
    }
    static PointF Centre(RectangleF r) { return new PointF(r.X + r.Width / 2, r.Y + r.Height / 2); }

    static void Pointer(Graphics g, PointF p, float[] clicks, float t) {
      foreach (var c in clicks) {
        float k = (t - c) / 0.45f;
        if (k < 0 || k > 1) continue;
        using (var pen = new Pen(Color.FromArgb((int)(200 * (1 - k)), 47, 111, 214), 2.5f)) g.DrawEllipse(pen, p.X - 6 - 12 * k, p.Y - 6 - 12 * k, 12 + 24 * k, 12 + 24 * k);
      }
      var arrow = new[] { new PointF(0, 0), new PointF(0, 17), new PointF(4.5f, 13), new PointF(7.5f, 20), new PointF(10.5f, 18.8f), new PointF(7.6f, 12), new PointF(13, 12) };
      for (int i = 0; i < arrow.Length; i++) arrow[i] = new PointF(arrow[i].X + p.X, arrow[i].Y + p.Y);
      using (var b = new SolidBrush(Color.White)) g.FillPolygon(b, arrow);
      using (var pen = new Pen(Color.Black, 1.2f)) g.DrawPolygon(pen, arrow);
    }
    static void Tick(Graphics g, float t, float from) {
      float k = Ease(t, from, from + 0.35f);
      float r = 26 * k;
      using (var b = new SolidBrush(Good)) g.FillEllipse(b, 260 - r, 122 - r, 2 * r, 2 * r);
      if (k >= 1) using (var pen = new Pen(Color.White, 5) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
        g.DrawLines(pen, new[] { new PointF(248, 123), new PointF(257, 132), new PointF(273, 114) });
    }
    static void Check(Graphics g, RectangleF r, bool on) {
      Fill(g, on ? Blue : Frame, r, 3); Edge(g, on ? Blue : Ghost, r);
      if (on) using (var pen = new Pen(Color.White, 2) { StartCap = LineCap.Round, EndCap = LineCap.Round })
        g.DrawLines(pen, new[] { new PointF(r.X + 3, r.Y + 7), new PointF(r.X + 6, r.Y + 10), new PointF(r.X + 11, r.Y + 4) });
    }
    static void Words(Graphics g, string s, PointF at, Color colour, Font font) {
      TextRenderer.DrawText(g, s, font, Point.Round(at), colour, TextFormatFlags.NoPadding | TextFormatFlags.NoPrefix);
    }
    static GraphicsPath Round(RectangleF r, float radius) {
      var path = new GraphicsPath();
      if (radius <= 0) { path.AddRectangle(r); return path; }
      float d = radius * 2;
      path.AddArc(r.X, r.Y, d, d, 180, 90); path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
      path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90); path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
      path.CloseFigure(); return path;
    }
    static void Fill(Graphics g, Color c, RectangleF r, float radius) { using (var path = Round(r, radius)) using (var b = new SolidBrush(c)) g.FillPath(b, path); }
    static void Edge(Graphics g, Color c, RectangleF r) { using (var path = Round(r, 5)) using (var pen = new Pen(c, 1)) g.DrawPath(pen, path); }
  }

  /** The window a "Show me" button opens: the animation, the same steps in words, and the button that checks again. */
  internal sealed class ShowMeWindow : Form {
    /** mode: server, password, studio (OBS), vjsterWait, vjsterPort (VJster) or tourbox (the preset import). primary is the main button's action. */
    internal ShowMeWindow(PanelText text, string mode, string problem, Action primary, int port = 0) {
      Text = mode == "studio" ? text.Get("showStudioTitle") : mode == "password" ? text.Get("showPasswordTitle")
        : mode == "vjsterWait" ? text.Get("showVjWaitTitle") : mode == "vjsterPort" ? text.Get("showVjPortTitle", port)
        : mode == "tourbox" ? text.Get("showTbTitle") : text.Get("showServerTitle");
      FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
      StartPosition = FormStartPosition.CenterParent; BackColor = Color.White; Font = new Font("Segoe UI", 10);
      AutoScaleMode = AutoScaleMode.None;
      var flow = new FlowLayoutPanel { Location = new Point(0, 0), FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(20, 16, 20, 12), AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
      flow.Controls.Add(new ShowMeClip(mode, text, port) { Margin = new Padding(0, 0, 0, 12) });
      string key = mode == "studio" ? "showStudioHint" : mode == "password" ? "obsBadPassword"
        : mode == "vjsterWait" ? "showVjWaitHint" : mode == "vjsterPort" ? "showVjPortHint" : mode == "tourbox" ? "showTbHint"
        : problem == "obs-no-password" ? "obsNoPassword" : problem == "obs-auth-off" ? "obsAuthOff" : "obsNoAnswer";
      flow.Controls.Add(new Label { Text = text.Get(key), AutoSize = true, MaximumSize = new Size(520, 0), UseMnemonic = false, Margin = new Padding(0, 0, 0, 14) });
      var buttons = new FlowLayoutPanel { AutoSize = false, Size = new Size(520, 38), FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(0) };
      var close = new Button { Text = text.Get("btnClose"), AutoSize = true, Height = 32, Padding = new Padding(6, 0, 6, 0), UseMnemonic = false };
      close.Click += delegate { Close(); };
      buttons.Controls.Add(close);
      CancelButton = close;
      // The port in use has no button that fixes it from here: only Close.
      if (mode != "vjsterPort") {
        string label = mode == "vjsterWait" ? "copyObsUrl" : mode == "tourbox" ? "openPreset" : "discover";
        var again = new Button { Text = text.Get(label), AutoSize = true, Height = 32, Padding = new Padding(6, 0, 6, 0), UseMnemonic = false,
          BackColor = Color.FromArgb(38, 90, 158), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
        // The import guide stays open beside Console while the clicks are made there.
        again.Click += delegate { if (mode != "tourbox") Close(); primary(); };
        buttons.Controls.Add(again);
        AcceptButton = again;
      }
      if (mode == "tourbox") TopMost = true;
      flow.Controls.Add(buttons);
      Controls.Add(flow);
      AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
    }
  }
}
