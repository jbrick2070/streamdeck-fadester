// SPDX-License-Identifier: GPL-2.0-or-later
// "Open when I sign in" (UI review U3-06): off until the user ticks it, and Windows' own switch always wins.
//  - The ZIP build writes one value under HKCU\Software\Microsoft\Windows\CurrentVersion\Run, the place Task Manager's
//    Startup page and Settings → Apps → Startup list and can turn off.
//  - The Microsoft Store package cannot use that key (a package's registry writes are private to it). It declares a
//    start-up task in AppxManifest.xml (uap5:StartupTask, Enabled="false") and asks Windows to turn it on or off.
//    The panel is built with the stock .NET Framework compiler and no Windows SDK, so Windows.ApplicationModel.StartupTask
//    is reached by reflection.
using System;
using System.Reflection;
using System.Threading;
using Microsoft.Win32;

namespace Fadester.TourBox {
  /** Off, On, or Blocked: Windows has it switched off (by the user in Settings or Task Manager, or by policy), so only Windows' own switch turns it on. */
  internal enum SignInState { Off, On, Blocked }

  internal static class SignInStart {
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string ApprovedKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    internal const string Name = "Fadester Companion";
    /** The TaskId of the uap5:StartupTask in tourbox/store/AppxManifest.xml (tests/companion-sign-in.test.ts keeps them equal). */
    internal const string TaskId = "FadesterCompanionStartup";

    internal static string Command(string exe) { return "\"" + exe + "\""; }
    /** The program a Run value starts: the text between its first pair of quotes, or all of it. */
    internal static string ExeOf(string runValue) {
      string v = (runValue ?? "").Trim();
      if (v.StartsWith("\"", StringComparison.Ordinal)) { int end = v.IndexOf('"', 1); return end > 0 ? v.Substring(1, end - 1) : v.Substring(1); }
      return v;
    }
    /** Task Manager and Settings record a switched-off start-up entry as a binary value whose first byte is odd (03); 02 or none is on. */
    internal static bool SwitchedOff(byte[] approved) { return approved != null && approved.Length > 0 && (approved[0] & 1) == 1; }
    /** The ZIP build's state from what the registry holds: our value for this exe, and Windows' own switch for it. */
    internal static SignInState RunState(string runValue, byte[] approved, string exe) {
      if (String.IsNullOrWhiteSpace(runValue) || !String.Equals(ExeOf(runValue), exe, StringComparison.OrdinalIgnoreCase)) return SignInState.Off;
      return SwitchedOff(approved) ? SignInState.Blocked : SignInState.On;
    }
    /** The Store build's state from Windows.ApplicationModel.StartupTaskState's name. */
    internal static SignInState TaskState(string state) {
      switch (state) {
        case "Enabled": case "EnabledByPolicy": return SignInState.On;
        case "DisabledByUser": case "DisabledByPolicy": return SignInState.Blocked;
        default: return SignInState.Off;
      }
    }

    internal static SignInState Read(bool packaged, string exe) { return packaged ? ReadTask() : ReadRun(exe); }
    /** Turns it on or off and returns the state Windows then reports. */
    internal static SignInState Set(bool packaged, string exe, bool on) {
      if (packaged) return SetTask(on);
      using (var key = Registry.CurrentUser.CreateSubKey(RunKey)) {
        if (on) key.SetValue(Name, Command(exe), RegistryValueKind.String); else key.DeleteValue(Name, false);
      }
      return ReadRun(exe);
    }

    static SignInState ReadRun(string exe) {
      using (var key = Registry.CurrentUser.OpenSubKey(RunKey, true)) {
        if (key == null) return SignInState.Off;
        string value = key.GetValue(Name) as string;
        // The folder was moved or replaced by a newer one: the user's choice follows the app instead of pointing at nothing.
        if (!String.IsNullOrWhiteSpace(value) && !String.Equals(ExeOf(value), exe, StringComparison.OrdinalIgnoreCase) && !System.IO.File.Exists(ExeOf(value))) {
          value = Command(exe); key.SetValue(Name, value, RegistryValueKind.String);
        }
        byte[] approved = null;
        using (var switches = Registry.CurrentUser.OpenSubKey(ApprovedKey)) { if (switches != null) approved = switches.GetValue(Name) as byte[]; }
        return RunState(value, approved, exe);
      }
    }

    // The Store package's start-up task, through the Windows Runtime.
    static Type WinRt(string name) { return Type.GetType(name + ", Windows, ContentType=WindowsRuntime", true); }
    static object Finish(object operation, Type result) {
      var info = WinRt("Windows.Foundation.IAsyncInfo"); var status = info.GetProperty("Status");
      for (int i = 0; i < 400; i++) {
        string now = Convert.ToString(status.GetValue(operation, null));
        if (now == "Completed") return WinRt("Windows.Foundation.IAsyncOperation`1").MakeGenericType(result).GetMethod("GetResults").Invoke(operation, null);
        if (now != "Started") throw new InvalidOperationException(Convert.ToString(info.GetProperty("ErrorCode").GetValue(operation, null)));
        Thread.Sleep(25);
      }
      throw new TimeoutException();
    }
    static object Task(out Type type) {
      type = WinRt("Windows.ApplicationModel.StartupTask");
      return Finish(type.GetMethod("GetAsync").Invoke(null, new object[] { TaskId }), type);
    }
    static SignInState ReadTask() {
      try { Type type; object task = Task(out type); return TaskState(Convert.ToString(type.GetProperty("State").GetValue(task, null))); }
      catch (TargetInvocationException e) { throw e.InnerException ?? e; }
    }
    static SignInState SetTask(bool on) {
      try {
        Type type; object task = Task(out type);
        if (on) return TaskState(Convert.ToString(Finish(type.GetMethod("RequestEnableAsync").Invoke(task, null), WinRt("Windows.ApplicationModel.StartupTaskState"))));
        type.GetMethod("Disable").Invoke(task, null);
        return TaskState(Convert.ToString(type.GetProperty("State").GetValue(task, null)));
      } catch (TargetInvocationException e) { throw e.InnerException ?? e; }
    }

    internal static void Test() {
      string exe = @"C:\Apps\Fadester Companion\Fadester Companion.exe";
      if (Command(exe) != "\"" + exe + "\"" || ExeOf(Command(exe)) != exe || ExeOf(Command(exe) + " --x") != exe || ExeOf(@"C:\a.exe") != @"C:\a.exe" || ExeOf(null) != "")
        throw new Exception("sign-in: command");
      if (RunState(null, null, exe) != SignInState.Off || RunState(Command(exe), null, exe) != SignInState.On ||
          RunState(Command(exe.ToUpperInvariant()), new byte[] { 2, 0, 0 }, exe) != SignInState.On ||
          RunState(Command(exe), new byte[] { 3, 0, 0 }, exe) != SignInState.Blocked ||
          RunState(Command(@"D:\Old\Fadester Companion.exe"), null, exe) != SignInState.Off)
        throw new Exception("sign-in: Run value");
      if (TaskState("Disabled") != SignInState.Off || TaskState("Enabled") != SignInState.On || TaskState("EnabledByPolicy") != SignInState.On ||
          TaskState("DisabledByUser") != SignInState.Blocked || TaskState("DisabledByPolicy") != SignInState.Blocked)
        throw new Exception("sign-in: start-up task");
    }
  }
}
