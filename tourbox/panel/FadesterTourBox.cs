using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("Fadester Companion")]
[assembly: System.Reflection.AssemblyProduct("Fadester Companion")]
[assembly: System.Reflection.AssemblyCompany("Jeffrey Brick")]
// The version attributes are written by build.ps1 from its -Version (PanelVersion.g.cs in the build stage).

// Stock Windows .NET Framework. No installer, browser, elevated rights, or bundled password.
namespace Fadester.TourBox {
  internal static class Entry {
    [STAThread] static int Main(string[] args) {
      // Dark colours when Windows is in dark app mode, or with --theme dark (Theme.cs).
      Theme.Choose(args);
      if (args.Contains("--self-test")) {
        try { PanelWindow.Test(); return 0; } catch (Exception e) { Log("self-test: " + e); return 1; }
      }
      // --render FILE.png [--tab N] [--language CODE] [--theme dark|light] [--open]: a picture of the window as it opens, for checks and screenshots.
      // Nothing is read, saved, started or connected, and no window appears on screen.
      int render = Array.IndexOf(args, "--render");
      if (render >= 0 && render + 1 < args.Length) {
        try {
          int tab = Array.IndexOf(args, "--tab");
          PanelWindow.Render(PanelText.FromArguments(args, CultureInfo.CurrentUICulture), args[render + 1], tab >= 0 && tab + 1 < args.Length ? Int32.Parse(args[tab + 1], CultureInfo.InvariantCulture) : 0, args.Contains("--open"));
          return 0;
        } catch (Exception e) { Log("render: " + e); return 1; }
      }
      Application.ThreadException += (s, e) => Log("window error: " + e.Exception);
      AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("fatal error: " + e.ExceptionObject);
      var text = PanelText.FromArguments(args, CultureInfo.CurrentUICulture);
      bool created;
      using (var single = new Mutex(true, @"Local\FadesterTourBoxPanel", out created)) {
        if (!created) {
          // The window may be hidden in the notification area with the controls on: ask it to come back.
          try { using (var show = EventWaitHandle.OpenExisting(ShowName)) show.Set(); }
          catch (Exception) { MessageBox.Show(text.Get("alreadyOpen"), "Fadester Companion"); }
          return 0;
        }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new PanelWindow(text));
      }
      return 0;
    }
    /** Set by a second launch: the window that is already open shows itself (PanelWindow.ListenForShow). */
    internal const string ShowName = @"Local\FadesterTourBoxPanelShow";
    /** Why the panel went away, for the next time nobody saw it go: panel.log next to config.json. Never a password. */
    internal static void Log(string line) {
      try {
        string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"FadesterTourBox"), file=Path.Combine(dir,"panel.log");
        Directory.CreateDirectory(dir);
        if(File.Exists(file) && new FileInfo(file).Length>262144) File.Delete(file);
        File.AppendAllText(file,DateTime.Now.ToString("s",CultureInfo.InvariantCulture)+"  "+line+Environment.NewLine,new UTF8Encoding(false));
      } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
  }
  /** Where the settings really are. A Store (MSIX) install keeps a file it created under %LOCALAPPDATA% in its own package storage. */
  internal static class SettingsFolder {
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
    static extern int GetCurrentPackageFamilyName(ref int length, StringBuilder name);
    /** The package family name, or null when the panel does not run from a package (the ZIP build). */
    static string PackageFamily() {
      try {
        int length=0;
        if(GetCurrentPackageFamilyName(ref length,null)!=122) return null; // 122: here is the length; 15700: no package
        var name=new StringBuilder(length);
        return GetCurrentPackageFamilyName(ref length,name)==0 ? name.ToString() : null;
      } catch(EntryPointNotFoundException) { return null; } // Windows 7 has no packages
    }
    /** Whether this is the Microsoft Store package (its start with Windows is a start-up task, not a Run value: SignIn.cs). */
    internal static bool Packaged { get { return PackageFamily()!=null; } }
    /** Where Windows keeps, for a package, a folder the app asked for under %LOCALAPPDATA%; null for a folder elsewhere. */
    internal static string Redirected(string dir,string localAppData,string family) {
      string local=localAppData.TrimEnd('\\');
      if(!dir.StartsWith(local+"\\",StringComparison.OrdinalIgnoreCase)) return null;
      return Path.Combine(local,"Packages",family,"LocalCache","Local",dir.Substring(local.Length+1));
    }
    /** The folder that really holds file (config.json), as Explorer must be shown it. */
    internal static string Holding(string file) {
      string dir=Path.GetDirectoryName(file), family=PackageFamily();
      string redirected=family==null ? null : Redirected(dir,Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),family);
      if(redirected==null) return dir;
      // A file the ZIP build made earlier stays where it was, and the Store build keeps using it there.
      return File.Exists(Path.Combine(redirected,Path.GetFileName(file))) || !File.Exists(file) ? redirected : dir;
    }
  }
  /** VJster's OBS Browser Source page: the same link, video-id rules and token format as the Mac panel (Model.swift) and the bridge (BridgeConfig). */
  internal static class VjsterObsPage {
    internal static readonly string[] Targets = { "both", "browser", "obs" };
    static readonly System.Text.RegularExpressions.Regex IdPattern = new System.Text.RegularExpressions.Regex("^[A-Za-z0-9_-]{11}$");
    static readonly System.Text.RegularExpressions.Regex TokenPattern = new System.Text.RegularExpressions.Regex("^[0-9a-f]{32}$");
    internal static bool ValidToken(string token) { return token!=null && TokenPattern.IsMatch(token); }
    /** As the bridge reads it: trimmed and lower-cased, so a saved token in capitals is kept rather than replaced. */
    internal static string NormalizeToken(string token) { return (token??"").Trim().ToLowerInvariant(); }
    internal static string NewToken() {
      var bytes=new byte[16];
      using(var rng=System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(bytes);
      return String.Concat(bytes.Select(b=>b.ToString("x2",CultureInfo.InvariantCulture)));
    }
    /** The 11-character YouTube id in a bare id or a youtube.com / youtu.be / youtube-nocookie.com link; null when there is none. */
    internal static string VideoId(string input) {
      string trimmed=(input??"").Trim();
      if(trimmed.Length==0) return null;
      if(IdPattern.IsMatch(trimmed)) return trimmed!="videoseries" ? trimmed : null;
      string lower=trimmed.ToLowerInvariant();
      Uri uri;
      if(!Uri.TryCreate(lower.StartsWith("http://",StringComparison.Ordinal) || lower.StartsWith("https://",StringComparison.Ordinal) ? trimmed : "https://"+trimmed,UriKind.Absolute,out uri)) return null;
      string host=uri.Host.ToLowerInvariant();
      bool youtube=host=="youtube.com" || host.EndsWith(".youtube.com",StringComparison.Ordinal) || host=="youtube-nocookie.com" || host.EndsWith(".youtube-nocookie.com",StringComparison.Ordinal);
      string[] segments=uri.AbsolutePath.Split(new[]{'/'},StringSplitOptions.RemoveEmptyEntries);
      string candidate=null;
      if(host=="youtu.be") candidate=segments.Length>0 ? segments[0] : null;
      else if(youtube) {
        foreach(var pair in uri.Query.TrimStart('?').Split('&')) {
          int eq=pair.IndexOf('=');
          if(eq>0 && pair.Substring(0,eq)=="v") { candidate=Uri.UnescapeDataString(pair.Substring(eq+1)); break; }
        }
        if(candidate==null && segments.Length>=2 && new[]{"shorts","embed","live","v"}.Contains(segments[0])) candidate=segments[1];
      }
      return candidate!=null && candidate!="videoseries" && IdPattern.IsMatch(candidate) ? candidate : null;
    }
    internal static string Url(int port,string videoId,string token) {
      return "http://127.0.0.1:"+port.ToString(CultureInfo.InvariantCulture)+"/obs?v="+(videoId??"VIDEO_ID")+"#token="+token;
    }
    internal static void Test() {
      string[][] cases = {
        new[]{"dQw4w9WgXcQ","dQw4w9WgXcQ"}, new[]{"  dQw4w9WgXcQ ","dQw4w9WgXcQ"},
        new[]{"https://youtu.be/dQw4w9WgXcQ","dQw4w9WgXcQ"}, new[]{"youtu.be/dQw4w9WgXcQ?t=42","dQw4w9WgXcQ"},
        new[]{"https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1","dQw4w9WgXcQ"}, new[]{"https://m.youtube.com/watch?feature=x&v=dQw4w9WgXcQ","dQw4w9WgXcQ"},
        new[]{"https://www.youtube.com/shorts/dQw4w9WgXcQ","dQw4w9WgXcQ"}, new[]{"https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ","dQw4w9WgXcQ"},
        new[]{"https://www.youtube.com/embed/videoseries?list=PL123",null}, new[]{"https://example.com/watch?v=dQw4w9WgXcQ",null},
        new[]{"https://notyoutube.com/watch?v=dQw4w9WgXcQ",null}, new[]{"https://www.youtube.com/watch?v=short",null}, new[]{"",null}, new[]{"videoseries",null}
      };
      foreach(var c in cases) if(VideoId(c[0])!=c[1]) throw new InvalidOperationException("VJster video id: "+c[0]);
      string token=NewToken();
      if(!ValidToken(token) || token==NewToken() || ValidToken("0123456789ABCDEF0123456789abcdef") || ValidToken("") ||
         NormalizeToken(" 0123456789ABCDEF0123456789abcdef ")!="0123456789abcdef0123456789abcdef" || NormalizeToken(null)!="")
        throw new InvalidOperationException("VJster OBS page token.");
      if(Url(48150,"dQw4w9WgXcQ",token)!="http://127.0.0.1:48150/obs?v=dQw4w9WgXcQ#token="+token || !Url(48150,null,token).Contains("v=VIDEO_ID#"))
        throw new InvalidOperationException("VJster OBS page link.");
      if(Array.IndexOf(Targets,"both")!=0) throw new InvalidOperationException("VJster target default.");
    }
  }
  internal sealed class PanelWindow : Form {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16000000 };
    readonly PanelText text;
    readonly string folder = AppDomain.CurrentDomain.BaseDirectory;
    readonly string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "config.json");
    /** Whether the user last started ("on") or stopped ("off") the controls; its own file, since config.json is rewritten by Save and Copy URL. */
    readonly string controlsState = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "controls.txt");
    /** Try again was pressed with the controls off: the next scan that reads OBS starts them. */
    bool startAfterScan;
    string Remembered() { try { return File.Exists(controlsState) ? File.ReadAllText(controlsState).Trim() : null; } catch(IOException) { return null; } catch(UnauthorizedAccessException) { return null; } }
    void Remember(string onOff) {
      try { Directory.CreateDirectory(Path.GetDirectoryName(controlsState)); File.WriteAllText(controlsState, onOff, new UTF8Encoding(false)); }
      catch(IOException e) { Entry.Log("controls state: "+e.Message); } catch(UnauthorizedAccessException e) { Entry.Log("controls state: "+e.Message); }
    }
    /** Which folded parts of the Setup page the user opened: its own small file, not a setting of the controls. */
    readonly string foldsState = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "folds.txt");
    /** A part of the Setup page that stays closed until asked for: its link, its one-line summary and the controls it shows. */
    internal sealed class Fold {
      internal string Id; internal LinkLabel Link; internal Label Summary; internal bool Open, Section, Called, ByUser; internal int From;
      internal readonly List<Control> Parts = new List<Control>();
    }
    readonly List<Fold> folds = new List<Fold>(); Fold obsFold, mixFold, vjFold;
    readonly Dictionary<string, ComboBox> boxes = new Dictionary<string, ComboBox>();
    readonly Dictionary<string,Image> glyphs=new Dictionary<string,Image>();
    Dictionary<string, object> config = new Dictionary<string, object>(), catalog = new Dictionary<string, object>();
    Label state, live, vsLive, importNote, reminder; TextBox password;
    string vsStatus = "";
    // The readiness lights: what is true now, never a log line. OBS from the last scan or the running controls' own lines.
    bool obsConnected; string padState="stPadOff"; ListBox activity; Button connect, start, save, openSettings;
    // What the lights also need from the desktop, read once a second without touching OBS (ShowMe.cs).
    Light obsLight, tbLight, vjLight, padLight, ctlLight; System.Windows.Forms.Timer watch; ShowMeWindow showMe;
    string obsProblem, front=""; bool obsRunning, obsHidden, padSeen, padEver, studioOff, tourboxConsole, consoleInstalled; DateTime autoConnectAt=DateTime.MaxValue; int autoTries;
    // Whether Console holds an older OBS Fadester preset than ours (PresetAge.cs, FIX-9): read every few seconds, said once in Activity.
    PresetState presetState=PresetState.Unknown; HashSet<string> shippedShortcuts; DateTime presetCheckAt=DateTime.MinValue; bool toldOldPreset;
    // What Console's files looked like at the last complete read (PresetAge.Stamp): unchanged, they are not read again.
    string presetStamp;
    // A video has been connected to VJster on this PC at some time (config.json vjsterSeen): until then its light does not nag.
    bool vjUsed;
    // Studio Mode off is read again every 10 s while it shows, so turning it on in OBS by hand clears the light too.
    // Twelve looks 10 s apart (two minutes) after the light turned amber, then one a minute: someone who works without
    // Studio Mode must not have OBS asked every 10 s for the whole show, yet turning it on by hand later still clears the light.
    DateTime studioCheckAt=DateTime.MinValue; int studioChecksLeft;
    // The OBS port follows OBS's own settings file (as the password does) until someone types another one.
    bool portAuto=true, settingPort;
    // The icon in the notification area: with the controls on, closing the window hides it there and the show goes on.
    NotifyIcon tray; ToolStripMenuItem trayToggle; bool quitting, toldTray; EventWaitHandle showSignal; volatile bool showStopped;
    readonly Color stopRed = Color.FromArgb(184,52,44);
    // TourBox Console's Auto Switch and whether its selected preset is ours (PresetAge.cs): they decide the reminder strip.
    bool? consoleAutoSwitch, activeFadester; string reminderKey; string shippedLayout;
    // VJster, from the running controls' own lines: which of the Chrome extension and the OBS page are connected, and whether its port is taken.
    HashSet<string> vjPeers=new HashSet<string>(); bool vjPortBusy, vjOnDeck;
    TableLayoutPanel reminderBar; Button bringObs;
    // A bridge that a Stop or Close already waited for in vain: the next Stop or Close ends it if it still does not exit.
    // Ending: the bridge the panel is ending, so whichever sees it exit first says so in the same words.
    Process stopTimedOut, ending;
    CheckBox enableMix, mixOnly, enableVjster, enableGamepad, easyMode;
    // "Open when I sign in": off until ticked; the box shows what Windows reports (SignIn.cs).
    CheckBox signIn; bool settingSignIn;
    // Who decides when Windows set it by policy: its own line under the box, wrapped to the window (QA-R203, QA-R204).
    Label signInNote; TableLayoutPanel mainGrid;
    // The game controller tab, from presets/gamepad.json (checked against the bridge by its self-test).
    DataGridView padGrid; ComboBox fastSpeed, slowSpeed;
    string[] padControls = new string[0], padOnly = new string[0];
    Dictionary<string,string> padDefaults = new Dictionary<string,string>();
    Dictionary<string,int> padHolds = new Dictionary<string,int>();
    double[] padSpeeds = new double[0];
    readonly Dictionary<string,string> actionLabels = new Dictionary<string,string>();
    readonly Dictionary<string,string> englishLabels = new Dictionary<string,string>();
    List<Choice> padChoices = new List<Choice>(), releaseChoices = new List<Choice>();
    sealed class Choice { public string Id { get; set; } public string Label { get; set; } }
    NumericUpDown mixStep, mixDuration, vjsterPort, opacityStep; TextBox extensionId, vjsterVideo; ComboBox vjsterTarget;
    NumericUpDown port,volumeStep,duckLevel,fadeTicks,transitionStep; FlowLayoutPanel body; DataGridView controls; Process worker; Feedback hud; bool closing, refreshing, invalidConfig;
    readonly Color navy = Color.FromArgb(26,34,51), accent = Color.FromArgb(38,90,158);
    static Dictionary<string,object> Decode(string s) { return Json.Deserialize<Dictionary<string,object>>(s); }
    static string Val(Dictionary<string,object> d, string k, string fallback = "") {
      object v; return d != null && d.TryGetValue(k,out v) && v != null ? Convert.ToString(v) : fallback;
    }
    static string[] List(Dictionary<string,object> d, string key) {
      object v; if (d == null || !d.TryGetValue(key,out v) || v is string || !(v is IEnumerable)) return new string[0];
      return ((IEnumerable)v).Cast<object>().Select(x=>Convert.ToString(x)).ToArray();
    }
    internal static void Test() {
      PanelText.Test();
      Readiness.Test();
      Theme.Test();
      SignInStart.Test();
      VjsterObsPage.Test();
      // The wheel over a closed drop-down or number box scrolls the page and leaves the value alone.
      using (var page=new Panel {AutoScroll=true,Size=new Size(200,100)}) {
        var tall=new Panel {Height=1000,Width=150}; var pick=new ComboBox {DropDownStyle=ComboBoxStyle.DropDownList}; var num=new NumericUpDown {Maximum=10,Value=5};
        pick.Items.Add("a"); pick.Items.Add("b"); pick.SelectedIndex=0; tall.Controls.Add(pick); page.Controls.Add(tall);
        KeepWheelForScrolling(page); tall.Controls.Add(num); page.CreateControl();
        var wheel=new HandledMouseEventArgs(MouseButtons.None,0,10,10,-120); PassWheelToPage(pick,wheel);
        var wheel2=new HandledMouseEventArgs(MouseButtons.None,0,10,10,-120); PassWheelToPage(num,wheel2);
        if (!wheel.Handled || !wheel2.Handled || pick.SelectedIndex!=0 || num.Value!=5 || -page.AutoScrollPosition.Y<=0) throw new Exception();
        // Through the real event, after the box was taken away and added back twice: one notch scrolls once.
        tall.Controls.Remove(pick); tall.Controls.Add(pick); tall.Controls.Remove(pick); tall.Controls.Add(pick);
        page.AutoScrollPosition=new Point(0,0);
        typeof(Control).GetMethod("OnMouseWheel",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic)
          .Invoke(pick,new object[] {new HandledMouseEventArgs(MouseButtons.None,0,10,10,-120)});
        if (-page.AutoScrollPosition.Y!=120 || pick.SelectedIndex!=0) throw new Exception();
      }
      var d=Decode("{\"scenes\":[\"🎬 Studio\",\"Act II\"],\"anchors\":[\"a\",\"\",\"b\",\"\"],\"port\":4455}");
      if (List(d,"scenes")[0]!="🎬 Studio" || Val(d,"port")!="4455" || List(d,"anchors").Length!=4) throw new Exception();
      if (List(d,"missing").Length!=0 || Decode(Json.Serialize(d)).Count!=3) throw new Exception();
      // The status line follows the bridge's own lines.
      if (!ObsState("Connected to OBS at 127.0.0.1:4455.",false) || ObsState("Offline: OBS is not answering on port 4455. (obs-no-answer)",true) ||
          ObsState("OBS is not connected. Cut preview live was not sent.",true) || !ObsState("Music up",true) ||
          PadState("Game controller connected.","stPadMissing")!="stPadOn" ||
          PadState("Game controller not found. Plug it in or turn it on.","stPadOn")!="stPadMissing" ||
          PadState("Game controller disconnected.","stPadOn")!="stPadMissing" || PadState("Music up","stPadOn")!="stPadOn") throw new Exception();
      var enText=new PanelText("en"); var deText=new PanelText("de");
      if (FormatVsMeter(enText,"Music up")!=null ||
          FormatVsMeter(enText,"VS-METER: not_loaded")!="Visual Sidechain: NOT LOADED" ||
          FormatVsMeter(deText,"VS-METER: panic")!="Visual Sidechain: PANIK" ||
          FormatVsMeter(enText,"VS-METER: no_audio")!="Visual Sidechain: NO AUDIO" ||
          FormatVsMeter(enText,"VS-METER: active 120 1 2 100 50 0 25")!="Visual Sidechain: 120 BPM [LOCK] · Beat 2/4 · █▅▁▃" ||
          FormatVsMeter(deText,"VS-METER: active 128 0 1 80 60 40 20")!="Visual Sidechain: 128 BPM · Schlag 1/4 · ▇▅▄▂") throw new Exception();
      // The real window, in every language, without showing it: every text it asks for exists, and nothing in building it throws.
      foreach (var locale in PanelText.AllLocales) {
        using (var w = new PanelWindow(new PanelText(locale), true)) {
          w.ShowStatus(); w.ShowStartButton();
          if (w.start.Text.Length == 0 || w.tray != null || w.obsLight == null || w.signIn.Checked || w.signIn.Text.Length == 0) throw new Exception("window " + locale);
        }
      }
      // The assignment lists show words for "none" and for a name OBS no longer has; what is saved stays the name.
      if (ChoiceText(enText,"",null)!="Unassigned" || ChoiceText(enText,"Camera",null)!="Camera" ||
          ChoiceText(enText,"Camera",new HashSet<string>{"Camera"})!="Camera" || ChoiceText(deText,"Camera",new HashSet<string>())!="Nicht verfügbar: Camera") throw new Exception("choice text");
      // Copy OBS Browser Source URL builds the address from the saved settings, never from a box not saved yet, and asks for
      // Stop and Start only when the running controls serve another VJster port or token (or no VJster) than that address.
      using (var w = new PanelWindow(new PanelText("en"), true)) {
        string tok=VjsterObsPage.NewToken();
        w.config["vjsterEnabled"]=true; w.config["vjsterPort"]=48151; w.config["vjsterObsToken"]=tok;
        w.vjsterPort.Value=48160; // typed, not saved
        if (SavedVjsterPort(w.config)!=48151 || w.ObsUrlToCopy("dQw4w9WgXcQ")!="http://127.0.0.1:48151/obs?v=dQw4w9WgXcQ#token="+tok) throw new Exception("copy URL: from the saved settings");
        if (SavedVjsterPort(Decode("{\"vjsterPort\":80}"))!=48150 || SavedVjsterPort(Decode("{}"))!=48150) throw new Exception("copy URL: the default port");
        string served=ObsPageServed(w.config);
        if (ObsPageRestartNeeded(false,null,w.config) || ObsPageRestartNeeded(true,served,w.config)) throw new Exception("copy URL: no restart while the address is served, or with the controls off");
        w.config["vjsterPort"]=48152;
        if (!ObsPageRestartNeeded(true,served,w.config)) throw new Exception("copy URL: a saved port the running controls do not serve");
        w.config["vjsterPort"]=48151; w.config["vjsterObsToken"]=VjsterObsPage.NewToken();
        if (!ObsPageRestartNeeded(true,served,w.config)) throw new Exception("copy URL: a token the running controls do not know");
        w.config["vjsterObsToken"]=tok; w.config["gamepadEnabled"]=true; w.config["mixEnabled"]=true;
        if (ObsPageRestartNeeded(true,served,w.config)) throw new Exception("copy URL: other settings do not touch the OBS page");
        w.config["vjsterEnabled"]=false; string off=ObsPageServed(w.config); w.config["vjsterEnabled"]=true;
        if (!ObsPageRestartNeeded(true,off,w.config)) throw new Exception("copy URL: controls started without VJster");
      }
      // A key Copy OBS URL makes is written alone, and a write that fails says why (the link is then not copied).
      string keysDir=Path.Combine(Path.GetTempPath(),"fadester-keys-"+Guid.NewGuid().ToString("N")), keysFile=Path.Combine(keysDir,"config.json");
      try {
        if (WriteKeys(keysFile,new Dictionary<string,object>{{"vjsterObsToken","x"}})==null) throw new Exception("copy URL: a write into a missing folder says it failed");
        Directory.CreateDirectory(keysDir); File.WriteAllText(keysFile,"{\"port\":4455}");
        if (WriteKeys(keysFile,new Dictionary<string,object>{{"vjsterObsToken","x"}})!=null) throw new Exception("copy URL: the key is written");
        var back=Decode(File.ReadAllText(keysFile));
        if (Val(back,"port")!="4455" || Val(back,"vjsterObsToken")!="x") throw new Exception("copy URL: only the key is written");
        foreach (var locale in PanelText.AllLocales) if (!new PanelText(locale).Get("obsUrlNotSaved","E").EndsWith("E")) throw new Exception("copy URL: not saved, " + locale);
      } finally { if (Directory.Exists(keysDir)) Directory.Delete(keysDir,true); }
      using (var w = new PanelWindow(new PanelText("en"), true)) {
        w.catalog=Decode("{\"scenes\":[\"A\",\"B\"]}"); w.config["anchors"]=new object[]{"B","Gone","",""};
        w.LoadChoices(false);
        if (w.Picked("anchor0")!="B" || w.Picked("anchor1")!="Gone" || w.Picked("anchor2")!="" || w.boxes["anchor1"].Text!="Unavailable: Gone" ||
            w.boxes["anchor2"].Text!="Unassigned" || w.boxes["anchor0"].Text!="B") throw new Exception("assignment lists");
      }
      // The Setup page opens short: the port and password, the long explanations and the two optional sections are closed,
      // each with its link; a click opens one, and a light that needs a field opens its part once (U3-05).
      using (var w = new PanelWindow(new PanelText("en"), true)) {
        w.ShowStatus();
        if (w.folds.Count!=5 || w.folds.Any(f=>f.Open || f.Parts.Count==0) || w.obsFold.Parts.All(c=>!c.Contains(w.password)) ||
            w.obsFold.Link.Text!="Details ▾" || w.mixFold.Link.Text!="Show ▾" || w.mixFold.Summary.Text!="Off" || w.vjFold.Summary.Text!="On, Chrome & OBS page, port 48150") throw new Exception("setup folds");
        w.SetFold(w.mixFold,true); w.enableMix.Checked=true; w.mixOnly.Checked=true; w.enableGamepad.Checked=true;
        if (!w.mixFold.Open || w.mixFold.Link.Text!="Hide ▴" || w.mixFold.Summary.Text!="On, Stream Deck only" || w.vjFold.Open) throw new Exception("setup folds: open");
        w.mixOnly.Checked=false; w.obsRunning=true; w.obsProblem="obs-bad-password"; w.ShowStatus();
        if (!w.obsFold.Open) throw new Exception("setup folds: the password field when OBS refuses the sign-in");
        w.SetFold(w.obsFold,false); w.ShowStatus();
        if (w.obsFold.Open) throw new Exception("setup folds: a part the user closed stays closed");
        w.obsProblem=null; w.obsConnected=true; w.ShowStatus(); w.obsConnected=false; w.obsProblem="obs-no-answer"; w.ShowStatus();
        if (!w.obsFold.Open) throw new Exception("setup folds: a new problem opens it again");
        // Only what the user opened is remembered: the part the light opened is not, and one the user closed again is not.
        w.ToggleFold(w.vjFold);
        if (String.Join(",",w.FoldsToRemember())!="vjster") throw new Exception("setup folds: a part a light opened is not saved");
        w.ToggleFold(w.vjFold); w.ToggleFold(w.obsFold); w.ToggleFold(w.obsFold);
        if (w.FoldsToRemember().Length!=1 || w.FoldsToRemember()[0]!="obs") throw new Exception("setup folds: the user's own opening is saved, a closing is not");
      }
      using (var w = new PanelWindow(new PanelText("en"), true)) {
        w.ShowSignIn(SignInState.OnByPolicy);
        if (!w.signIn.Checked || w.signIn.Enabled || w.signIn.Text!="Open when I sign in" || w.signInNote.Text!=enText.Get("signInManaged") ||
            !w.SignInNoteShown() || w.mainGrid.RowStyles[4].Height!=168 || !w.signInNote.AutoSize) throw new Exception("sign-in box: on by policy");
        w.ShowSignIn(SignInState.OffByPolicy);
        if (w.signIn.Checked || w.signIn.Enabled || !w.SignInNoteShown()) throw new Exception("sign-in box: off by policy");
        w.ShowSignIn(SignInState.Blocked);
        if (w.signIn.Checked || !w.signIn.Enabled || w.SignInNoteShown() || w.mainGrid.RowStyles[4].Height!=128) throw new Exception("sign-in box: switched off in Windows");
      }
      if (MixSummary(deText,false,false)!=deText.Get("off") || VjsterSummary(enText,false,"x",1)!="Off" || !VjsterSummary(deText,true,"Ziel",48150).Contains("48150")) throw new Exception("fold summaries");
      // A refused sign-in keeps its translated sentence in the header; the retry fact follows in the same language.
      if (StillTrying(deText,"Problem.")!="Problem. "+deText.Get("stillTrying") || StillTrying(enText,null)!=enText.Get("stillTrying") ||
          deText.Get("stillTrying")==enText.Get("stillTrying") || !deText.Get("stillTrying").Contains(deText.Get("save"))) throw new Exception("still trying");
      // The dark window builds too, with its own tab strip, and its page is dark.
      bool wasDark=Theme.Dark;
      try {
        Theme.Dark=true;
        using (var w = new PanelWindow(new PanelText("en"), true)) {
          w.ShowStatus(); w.ShowStartButton(); Color blue=Color.FromArgb(38,90,158);
          if (w.BackColor.ToArgb()!=Theme.Back.ToArgb() || w.body.BackColor.ToArgb()!=Theme.Back.ToArgb() || !(w.body.Parent.Parent is DarkTabs) ||
              w.start.BackColor!=blue) throw new Exception("dark window");
        }
      } finally { Theme.Dark=wasDark; }
      // Closing the window hides it only for the user's own close with the controls on; Quit, a shutdown or no icon end as before.
      if (!HidesOnClose(true,true,false,true) || HidesOnClose(true,false,false,true) || HidesOnClose(true,true,true,true) ||
          HidesOnClose(false,true,false,true) || HidesOnClose(true,true,false,false)) throw new Exception();
      // OBS's own port, from the file its password is read from.
      if (ObsPortFrom("{\"server_port\":4466,\"server_password\":\"x\"}")!=4466 || ObsPortFrom("{\"server_port\":0}")!=0 ||
          ObsPortFrom("{\"server_port\":70000}")!=0 || ObsPortFrom("{ half")!=0 || ObsPortFrom(null)!=0 || ObsPortFrom("{}")!=0) throw new Exception();
      // Outside a package the settings are where the panel asks for them; a Store install's are in its LocalCache.
      var probe=Path.Combine(Path.GetTempPath(),"fadester-panel-test-"+Guid.NewGuid().ToString("N"),"config.json");
      if (SettingsFolder.Holding(probe)!=Path.GetDirectoryName(probe)) throw new Exception();
      if (SettingsFolder.Redirected(@"C:\Users\A\AppData\Local\FadesterTourBox",@"C:\Users\A\AppData\Local","Fluxxuuss.FadesterCompanion_x1")!=
          @"C:\Users\A\AppData\Local\Packages\Fluxxuuss.FadesterCompanion_x1\LocalCache\Local\FadesterTourBox" ||
          SettingsFolder.Redirected(@"D:\Elsewhere",@"C:\Users\A\AppData\Local","F_x1")!=null) throw new Exception();
    }
    /// <summary>The build's version (build.ps1 stamps it as the informational version).</summary>
    internal static string AppVersion() {
      try {
        var v=System.Reflection.Assembly.GetExecutingAssembly().GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute),false);
        var s=v.Length>0 ? ((System.Reflection.AssemblyInformationalVersionAttribute)v[0]).InformationalVersion : "";
        var plus=s.IndexOf('+'); if (plus>0) s=s.Substring(0,plus);
        return s.Length>0 ? s : "";
      } catch { return ""; }
    }

    /// <summary>A secondary window's title with the app's version, so a picture of any window says which build it is.</summary>
    internal static string WithVersion(string title) { var v=AppVersion(); return v.Length>0 ? title+"  ·  Fadester Companion "+v : title; }

    /** Built for the self-test or a picture (--render): no icon in the notification area, and opening it reads and starts nothing. */
    readonly bool inert;
    /** The window in this language, with nothing behind it, drawn into a PNG file. */
    internal static void Render(PanelText text, string file, int tab, bool open = false) {
      Application.EnableVisualStyles();
      using (var w = new PanelWindow(text, true)) {
        if (open) { foreach (var fold in w.folds) w.SetFold(fold, true); w.enableGamepad.Checked = true; w.ShowSignIn(SignInState.OnByPolicy); }
        w.StartPosition = FormStartPosition.Manual; w.Location = new Point(-32000, -32000); w.ShowInTaskbar = false;
        w.Show();
        foreach (Control c in w.Controls[0].Controls) { var tabs = c as TabControl; if (tabs != null && tab > 0 && tab < tabs.TabCount) tabs.SelectedIndex = tab; }
        Application.DoEvents();
        using (var picture = new Bitmap(w.Width, w.Height)) {
          w.DrawToBitmap(picture, new Rectangle(0, 0, w.Width, w.Height));
          picture.Save(file, System.Drawing.Imaging.ImageFormat.Png);
        }
        w.Close();
      }
    }
    internal PanelWindow(PanelText text, bool inert = false) {
      this.text = text; this.inert = inert;
      Text="Fadester Companion "+AppVersion(); ClientSize=new Size(780,700); MinimumSize=new Size(620,540);
      // The window and taskbar show the exe's own icon, not WinForms' default one.
      try { Icon=Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception e) { Entry.Log("icon: "+e.Message); }
      Font=new Font("Segoe UI",10); BackColor=Color.White; StartPosition=FormStartPosition.CenterScreen;
      var grid=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=5, Padding=new Padding(14)}; mainGrid=grid;
      grid.RowStyles.Add(new RowStyle(SizeType.Absolute,100)); grid.RowStyles.Add(new RowStyle(SizeType.AutoSize)); grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      grid.RowStyles.Add(new RowStyle(SizeType.Percent,100)); grid.RowStyles.Add(new RowStyle(SizeType.Absolute,128));
      grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); // the window's width bounds every row, so the lights wrap
      Controls.Add(grid);
      var head=new Panel {Dock=DockStyle.Fill,BackColor=navy,Padding=new Padding(12)};
      head.Controls.Add(new Label {Text="Fadester Companion",Location=new Point(14,7),Font=new Font("Segoe UI",17,FontStyle.Bold),ForeColor=Color.White,AutoSize=true});
      // The version, top right, so a screenshot or a question about this window always says which build it is.
      var version=new Label {Text="v"+AppVersion(),AutoSize=true,UseMnemonic=false,ForeColor=Color.FromArgb(190,200,220),Font=new Font("Segoe UI",10),Anchor=AnchorStyles.Top|AnchorStyles.Right};
      head.Controls.Add(version); head.ClientSizeChanged+=delegate { version.Location=new Point(Math.Max(0,head.ClientSize.Width-version.Width-14),12); };
      // Two lines, then an ellipsis; the whole message is the label's tooltip and the newest line on the Activity tab.
      state=new Label {Text=text.Get("lookingForObs"),Location=new Point(16,48),AutoSize=false,Height=42,AutoEllipsis=true,UseMnemonic=false,ForeColor=Color.White, Width=680,Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top}; head.Controls.Add(state); grid.Controls.Add(head,0,0);
      head.ClientSizeChanged+=delegate { state.Width=Math.Max(1,head.ClientSize.Width-32); };
      // The lights, each with the one button that fixes it, so the next step is always in view: OBS, TourBox, VJster and
      // Controls as on the Mac, plus the game controller (Windows only).
      var lights=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoSize=true,WrapContents=true,BackColor=Color.FromArgb(241,244,249),Padding=new Padding(10,6,10,6),Margin=new Padding(0,6,0,0)};
      obsLight=new Light(navy,accent,Color.White); tbLight=new Light(navy,accent,Color.White); vjLight=new Light(navy,accent,Color.White);
      padLight=new Light(navy,accent,Color.White); ctlLight=new Light(navy,accent,Color.White);
      foreach(var l in new[]{obsLight,tbLight,vjLight,padLight,ctlLight}){ l.Acted+=Act; lights.Controls.Add(l); }
      grid.Controls.Add(lights,0,1);
      // The amber reminder, with the button that does what it asks (as on the Mac).
      var amberBack=Color.FromArgb(255,241,214);
      reminderBar=new TableLayoutPanel {Dock=DockStyle.Fill,AutoSize=true,ColumnCount=2,RowCount=1,Visible=false,BackColor=amberBack,Padding=new Padding(10,5,8,5),Margin=new Padding(0,6,0,0)};
      reminderBar.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100)); reminderBar.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
      reminder=new Label {AutoSize=true,UseMnemonic=false,BackColor=amberBack,ForeColor=Color.FromArgb(107,74,0),Font=new Font("Segoe UI",10,FontStyle.Bold),Anchor=AnchorStyles.Left,Margin=new Padding(0,5,8,3),MaximumSize=new Size(560,0)};
      bringObs=new Button {Text=text.Get("btnBringObs"),AutoSize=true,Height=28,FlatStyle=FlatStyle.Flat,BackColor=accent,ForeColor=Color.White,Font=new Font("Segoe UI",9,FontStyle.Bold),UseMnemonic=false,Cursor=Cursors.Hand,Anchor=AnchorStyles.Right,Padding=new Padding(4,0,4,0),Margin=new Padding(0)};
      bringObs.FlatAppearance.BorderSize=0;
      bringObs.Click+=delegate {
        if(reminderKey=="remindSelectPreset"){ OpenConsole(); return; }
        if(!Desktop.BringObsToFront()) Note(text.Get("obsNotFound"));
      };
      reminderBar.Controls.Add(reminder,0,0); reminderBar.Controls.Add(bringObs,1,0);
      grid.Controls.Add(reminderBar,0,2);
      grid.ClientSizeChanged+=delegate { reminder.MaximumSize=new Size(Math.Max(150,grid.ClientSize.Width-28-bringObs.Width-40),0); };
      TabControl tabs=Theme.Dark ? (TabControl)new DarkTabs {Dock=DockStyle.Fill} : new TabControl {Dock=DockStyle.Fill}; grid.Controls.Add(tabs,0,3);
      // Setup reads in the order a newcomer acts: OBS, then the controller in hand, then a first cue with it. Each step is one
      // sentence and its button; what is rarely needed (the port and password OBS already gave, the long explanations, the
      // two optional sections) is folded away until asked for, or until a light says it is needed (U3-05).
      body=Page(tabs,text.Get("setup"));
      Title(body,text.Get("connectTitle")); Hint(body,text.Get("connectShort"));
      connect=AddButton(body,text.Get("discover"),async delegate { await Connect(); });
      live=Note(body);
      vsLive=Note(body);
      obsFold=BeginFold(body,"obs",null);
      Hint(body,text.Get("connectHint"));
      var row=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      row.Controls.Add(new Label {Text=text.Get("port"), AutoSize=true,Margin=new Padding(4,8,4,0)});
      port=new NumericUpDown {Minimum=1,Maximum=65535,Value=4455,Width=78}; row.Controls.Add(port);
      port.ValueChanged+=delegate { if(!settingPort) portAuto=false; }; // a port typed by hand is kept
      row.Controls.Add(new Label {Text=text.Get("password"),AutoSize=true,Margin=new Padding(10,8,4,0)});
      password=new TextBox {UseSystemPasswordChar=true,Width=142}; row.Controls.Add(password); body.Controls.Add(row);
      Hint(body,text.Get("passwordHint"));
      EndFold(body,obsFold);
      Title(body,text.Get("controllerTitle"));
      SubTitle(body,text.Get("gamepadTitle"));
      enableGamepad=Check(body,text.Get("enableGamepad"));
      // Easy mode and what each button does matter only once the game controller is in use.
      easyMode=Check(body,text.Get("gamepadEasy")); easyMode.Checked=true;
      var padHint=Hint(body,text.Get("gamepadHint"));
      Action showPad=delegate { easyMode.Visible=padHint.Visible=enableGamepad.Checked; }; showPad();
      enableGamepad.CheckedChanged+=delegate { showPad(); };
      SubTitle(body,"TourBox");
      var importRow=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0)};
      AddButton(importRow,text.Get("openPreset"),delegate { ImportPreset(); ShowImportGuide(); });
      AddButton(importRow,text.Get("btnShowWhere"),delegate { ShowImportGuide(); });
      body.Controls.Add(importRow); importNote=Note(body);
      var tbFold=BeginFold(body,"tourbox",null);
      Hint(body,text.Get("importHint"));
      Hint(body,text.Get("importAutoHint"));
      EndFold(body,tbFold);
      Title(body,text.Get("cueTitle"));
      Hint(body,text.Get("cueShort"));
      var cueFold=BeginFold(body,"cue",null);
      Hint(body,text.Get("cueHint"));
      EndFold(body,cueFold);
      // Assign your inputs is one sentence here, with the button that opens its tab.
      Hint(body,text.Get("inputsHint"));
      var toAssign=AddButton(body,text.Get("assignments"),null);
      mixFold=BeginFold(body,"mix",text.Get("mixTitle"));
      enableMix=Check(body,text.Get("enableMix"));
      Hint(body,text.Get("mixHint"));
      mixOnly=Check(body,text.Get("mixOnly")); mixOnly.Enabled=false;
      enableMix.CheckedChanged+=delegate{mixOnly.Enabled=enableMix.Checked;if(!enableMix.Checked)mixOnly.Checked=false;};
      mixStep=Number(body,text.Get("mixStep"),0.25m,12m,3m,0.25m,2);
      mixDuration=Number(body,text.Get("mixFade"),0m,10000m,600m,100m,0);
      EndFold(body,mixFold);
      vjFold=BeginFold(body,"vjster",text.Get("vjsterTitle"));
      enableVjster=Check(body,text.Get("enableVjster")); enableVjster.Checked=true;
      Hint(body,text.Get("vjsterHint"));
      Hint(body,text.Get("vjsterChrome"));
      var vjRow=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      vjRow.Controls.Add(new Label {Text=text.Get("vjsterPort"),AutoSize=true,Margin=new Padding(4,8,4,0)});
      vjsterPort=new NumericUpDown {Minimum=1024,Maximum=65535,Value=48150,Width=78}; vjRow.Controls.Add(vjsterPort);
      vjRow.Controls.Add(new Label {Text=text.Get("vjsterExtensionId"),AutoSize=true,Margin=new Padding(10,8,4,0)});
      extensionId=new TextBox {Width=290}; vjRow.Controls.Add(extensionId); body.Controls.Add(vjRow);
      Hint(body,text.Get("vjsterIdHint"));
      // Where VJster sends its commands, and the OBS Browser Source page link (same choices as the Mac panel).
      var targetRow=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      targetRow.Controls.Add(new Label {Text=text.Get("vjsterTarget"),AutoSize=true,UseMnemonic=false,Margin=new Padding(4,8,4,0)});
      vjsterTarget=new ComboBox {Width=230,DropDownStyle=ComboBoxStyle.DropDownList};
      foreach(var key in new[]{"vjsterTargetBoth","vjsterTargetBrowser","vjsterTargetObs"}) vjsterTarget.Items.Add(text.Get(key));
      vjsterTarget.SelectedIndex=0; targetRow.Controls.Add(vjsterTarget); body.Controls.Add(targetRow);
      var pageRow=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      pageRow.Controls.Add(new Label {Text=text.Get("vjsterVideo"),AutoSize=true,UseMnemonic=false,Margin=new Padding(4,8,4,0)});
      vjsterVideo=new TextBox {Width=260}; pageRow.Controls.Add(vjsterVideo);
      AddButton(pageRow,text.Get("copyObsUrl"),delegate { CopyObsUrl(); }); body.Controls.Add(pageRow);
      EndFold(body,vjFold);
      enableMix.CheckedChanged+=delegate { ShowStatus(); }; vjsterPort.ValueChanged+=delegate { ShowStatus(); }; vjsterTarget.SelectedIndexChanged+=delegate { ShowStatus(); };
      enableGamepad.CheckedChanged+=delegate { ShowStatus(); }; mixOnly.CheckedChanged+=delegate { ShowStatus(); }; enableVjster.CheckedChanged+=delegate { ShowStatus(); };
      var assign=Page(tabs,text.Get("assignments")); Title(assign,text.Get("assignTitle"));
      toAssign.Click+=delegate { tabs.SelectedTab=(TabPage)assign.Parent; };
      // Opening Assignments reads OBS's scenes and sources again when the list is old (hand test 2026-11-17: the lists
      // stayed empty until "Read scenes and inputs from OBS" was clicked).
      tabs.SelectedIndexChanged += delegate { if(tabs.SelectedTab==assign.Parent && obsConnected && DateTime.Now-catalogAt>TimeSpan.FromSeconds(10)){ var pending=Connect(true); } };
      Hint(assign,text.Get("assignHint"));
      foreach (var field in new[] { "musicInput", "contentInput", "micInput", "mediaInput", "overlayScene", "overlaySource" })
        Field(assign,text.Get(field),field);
      boxes["overlayScene"].SelectedIndexChanged += delegate { PopulateOverlay(); };
      string[] dirs={"up","right","down","left"}; for(int i=0;i<4;i++) Field(assign,text.Get("anchorField",i+1,text.Get(dirs[i])),"anchor"+i);
      AddButton(assign,text.Get("assignFirstFour"),delegate {var sc=List(catalog,"scenes"); if(sc.Length==0){Note(text.Get("discoverFirst"));return;} for(int i=0;i<4;i++)boxes["anchor"+i].SelectedItem=i<sc.Length?sc[i]:""; Note(text.Get("assignPreviewed"));});
      Title(assign,text.Get("layersTitle")); Hint(assign,text.Get("layersHint"));
      foreach (var field in new[] { "layer1Scene", "layer1Source", "layer2Scene", "layer2Source" }) Field(assign,text.Get(field),field);
      boxes["layer1Scene"].SelectedIndexChanged += delegate { PopulateLayer(1); };
      boxes["layer2Scene"].SelectedIndexChanged += delegate { PopulateLayer(2); };
      Title(assign,text.Get("adjust"));
      volumeStep=Number(assign,text.Get("musicStep"),0.25m,6m,1m,0.25m,2);
      duckLevel=Number(assign,text.Get("duckCeiling"),-60m,0m,-12m,1m,1);
      fadeTicks=Number(assign,text.Get("fadeTicks"),4m,200m,20m,1m,0);
      transitionStep=Number(assign,text.Get("timingStep"),10m,1000m,50m,10m,0);
      opacityStep=Number(assign,text.Get("opacityStep"),1m,50m,5m,1m,0);
      Hint(assign,text.Get("adjustHint"));
      var padPage=Page(tabs,text.Get("gamepadTitle")); Title(padPage,text.Get("padMapTitle")); Hint(padPage,text.Get("padMapHint"));
      fastSpeed=Choose(padPage,text.Get("padFast")); slowSpeed=Choose(padPage,text.Get("padSlow"));
      padGrid=new DataGridView {Width=640,Height=600,AllowUserToAddRows=false,AllowUserToDeleteRows=false,RowHeadersVisible=false,AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill,BackgroundColor=Color.White,EditMode=DataGridViewEditMode.EditOnEnter,Margin=new Padding(3,6,3,6)};
      padGrid.DataError+=(s,e)=>{e.ThrowException=false;};
      padGrid.CurrentCellDirtyStateChanged+=delegate{if(padGrid.IsCurrentCellDirty)padGrid.CommitEdit(DataGridViewDataErrorContexts.Commit);};
      padGrid.CellValueChanged+=(s,e)=>{ if(e.RowIndex<0 || padControls.Length==0) return; PairDuck(); ShowShift(); };
      padPage.Controls.Add(padGrid); padPage.ClientSizeChanged+=delegate{padGrid.Width=Math.Max(300,padPage.ClientSize.Width-42);};
      AddButton(padPage,text.Get("padReset"),delegate{ if(padControls.Length==0)return; FillPadGrid(new Dictionary<string,object>()); Note(text.Get("padResetDone")); });
      var keypage=new TabPage(text.Get("controlMap")); tabs.Controls.Add(keypage); controls=new DataGridView {Dock=DockStyle.Fill,ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,RowHeadersVisible=false,AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill,SelectionMode=DataGridViewSelectionMode.FullRowSelect,BackgroundColor=Color.White};
      controls.DefaultCellStyle.WrapMode=DataGridViewTriState.True;
      controls.AutoSizeRowsMode=DataGridViewAutoSizeRowsMode.AllCells;
      controls.ColumnHeadersHeightSizeMode=DataGridViewColumnHeadersHeightSizeMode.AutoSize;
      foreach(var name in new[]{"control","gesture","action"}) controls.Columns.Add(name,text.Get(name));
      controls.Columns[0].FillWeight=88; controls.Columns[1].FillWeight=95; controls.Columns[2].FillWeight=160; keypage.Controls.Add(controls);
      controls.Columns.Insert(0,new DataGridViewImageColumn {Name="Category",HeaderText="",Width=34,ImageLayout=DataGridViewImageCellLayout.Zoom,AutoSizeMode=DataGridViewAutoSizeColumnMode.None});
      controls.RowTemplate.MinimumHeight=30;
      var logs=new TabPage(text.Get("activity")); tabs.Controls.Add(logs); activity=new ListBox {Dock=DockStyle.Fill,HorizontalScrollbar=true}; logs.Controls.Add(activity);
      var bar=new FlowLayoutPanel {Dock=DockStyle.Fill,Padding=new Padding(0,7,0,0),WrapContents=true,AutoScroll=true};
      start=AddButton(bar,text.Get("saveStart"),async delegate { await ToggleControls(); }); start.BackColor=accent; start.ForeColor=Color.White; start.FlatStyle=FlatStyle.Flat;
      save=AddButton(bar,text.Get("save"),delegate { SaveRequested(); });
      AddButton(bar,text.Get("feedback"),delegate { if(hud!=null && !hud.IsDisposed) {hud.Close();return;} hud=new Feedback(text.Get("lastAction")); hud.Set(state.Text); hud.SetMeter(vsStatus); hud.Show(); });
      AddButton(bar,text.Get("guide"),delegate { OpenPath(text.GuidePath(folder)); });
      // Shown only when config.json cannot be read, so the file can be found and repaired (a Store install keeps it elsewhere).
      openSettings=AddButton(bar,text.Get("openSettings"),delegate { OpenPath(SettingsFolder.Holding(settings)); }); openSettings.Visible=false;
      signIn=new CheckBox {Text=text.Get("openAtSignIn"),AutoSize=true,UseMnemonic=false,Margin=new Padding(6,0,3,0)};
      signIn.CheckedChanged+=async delegate { if(!settingSignIn) await SetSignIn(signIn.Checked); };
      // Always in view under the buttons (it used to sit at the bottom of a long Setup page), matching the Mac panel's footer.
      var footer=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=4,Margin=new Padding(0)};
      footer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
      footer.RowStyles.Add(new RowStyle(SizeType.Percent,100)); footer.RowStyles.Add(new RowStyle(SizeType.AutoSize)); footer.RowStyles.Add(new RowStyle(SizeType.AutoSize)); footer.RowStyles.Add(new RowStyle(SizeType.AutoSize));
      signInNote=new Label {Text=text.Get("signInManaged"),AutoSize=true,UseMnemonic=false,Visible=false,ForeColor=Color.FromArgb(90,98,112),Margin=new Padding(24,0,4,2)};
      var keepOpen=new Label {Text=text.Get("keepOpen"),AutoSize=true,UseMnemonic=false,ForeColor=Color.FromArgb(90,98,112),Margin=new Padding(4,2,4,0)};
      footer.ClientSizeChanged+=delegate { keepOpen.MaximumSize=new Size(Math.Max(200,footer.ClientSize.Width-12),0); signInNote.MaximumSize=new Size(Math.Max(200,footer.ClientSize.Width-32),0); };
      footer.Controls.Add(bar,0,0); footer.Controls.Add(signIn,0,1); footer.Controls.Add(signInNote,0,2); footer.Controls.Add(keepOpen,0,3);
      grid.Controls.Add(footer,0,4);
      Theme.Apply(this,navy,accent,stopRed);
      ShowStatus();
      watch=new System.Windows.Forms.Timer {Interval=1000}; watch.Tick+=delegate { Watch(); };
      FormClosed+=delegate { watch.Stop(); watch.Dispose(); showStopped=true; if(showSignal!=null) showSignal.Set(); if(tray!=null){ tray.Visible=false; tray.Dispose(); tray=null; } };
      if(!inert) MakeTray();
      KeepWheelForScrolling(this);
      Load += async delegate {
        // Never taller or wider than the screen it opens on (a 1080p laptop at 150 % has less room than the window asks for).
        var room=Screen.FromControl(this).WorkingArea;
        if(Width>room.Width || Height>room.Height){ Size=new Size(Math.Min(Width,room.Width),Math.Min(Height,room.Height)); Location=new Point(room.Left+(room.Width-Width)/2,room.Top+(room.Height-Height)/2); }
        if(inert) return; ListenForShow(); ReadFolds(); var signInRead=ReadSignIn(); ReadSettings(); ReadMap(); ReadPad(); Watch(); watch.Start(); if(!invalidConfig) await Connect(); };
      FormClosing+=async (s,e)=>{
        if(inert) return;
        Entry.Log("closing: "+e.CloseReason+(worker==null?"":", controls running")); if(worker==null)return;
        // Windows is shutting down or signing out: hold that up for a second at most. The bridge is asked to stop, so it can
        // put OBS's transition back, and is ended if it has not stopped by then, so it cannot keep the shortcuts or the OBS port.
        if(e.CloseReason==CloseReason.WindowsShutDown){ var p=worker; worker=null; AskToStop(p); if(!WaitForBridge(p,1000)) EndBridge(p,0); return; }
        // The window's own close button with the controls on: the show goes on. The window hides, the icon in the
        // notification area brings it back, and Quit in that icon's menu stops the controls and ends the app.
        if(HidesOnClose(e.CloseReason==CloseReason.UserClosing,true,quitting,tray!=null)){
          e.Cancel=true; Hide();
          if(!toldTray){ toldTray=true; tray.ShowBalloonTip(8000,"Fadester Companion",text.Get("trayStillOn"),ToolTipIcon.Info); }
          return;
        }
        e.Cancel=true; if(closing)return; closing=true; await StopControls(); closing=false;
        if(worker==null)Close(); else { quitting=false; ShowFromTray(); Note(text.Get("stillClosing")); }
      };
    }
    /** Whether the line that says who decides is asked to show (a window that is not on screen reports every child hidden). */
    bool signInNoteWanted;
    internal bool SignInNoteShown() { return signInNoteWanted; }
    /** The box as Windows has it. Set by policy (the Store build): ticked or not as it is, greyed, and it says who decides (QA-C05). */
    void ShowSignIn(SignInState state) {
      if(IsDisposed) return;
      bool managed=SignInStart.Managed(state);
      settingSignIn=true; signIn.Checked=SignInStart.Ticked(state); settingSignIn=false;
      signIn.Enabled=!managed;
      // The sentence is a line of its own: nothing is joined to the label, so it reads right in every language and wraps.
      if(signInNoteWanted!=managed){ signInNoteWanted=managed; signInNote.Visible=managed; mainGrid.RowStyles[4].Height=managed ? 168 : 128; }
    }
    /** The box shows what Windows has: its own switch (Settings → Apps → Startup, Task Manager) may have changed since. */
    async Task ReadSignIn() {
      bool packaged=SettingsFolder.Packaged; string exe=Application.ExecutablePath;
      try { ShowSignIn(await Task.Run(()=>SignInStart.Read(packaged,exe))); }
      catch(Exception e) { Entry.Log("sign-in state: "+e.Message); }
    }
    /** Ticked or cleared by the user. When Windows has it switched off, only Windows' own page turns it on: say so and open it. */
    async Task SetSignIn(bool on) {
      bool packaged=SettingsFolder.Packaged; string exe=Application.ExecutablePath;
      signIn.Enabled=false;
      try {
        var now=await Task.Run(()=>SignInStart.Set(packaged,exe,on));
        ShowSignIn(now);
        if(SignInStart.Managed(now)) Note(text.Get("signInManaged"));
        else if(on && now==SignInState.Blocked){ Note(text.Get("signInSettings")); OpenPath("ms-settings:startupapps"); }
      } catch(Exception e) { Entry.Log("sign-in: "+e); ShowSignIn(SignInState.Off); Note(text.Get("signInFailed",e.Message)); }
    }
    /** Whether closing the window only hides it: the user's own close, with the controls on and an icon to come back from. */
    internal static bool HidesOnClose(bool userClosing,bool controlsOn,bool quitting,bool hasTray) { return userClosing && controlsOn && !quitting && hasTray; }
    async Task ToggleControls() { if(worker==null){ Remember("on"); StartControls(); } else { Remember("off"); await StopControls(); } }
    /** The footer button and the tray menu say what a click does now: Start, or Stop (red, as on the Mac). */
    void ShowStartButton() {
      bool running=worker!=null;
      start.Text=text.Get(running?"stop":"saveStart"); start.BackColor=running?stopRed:accent;
      if(trayToggle!=null) trayToggle.Text=start.Text.Replace("&&","&");
    }
    void MakeTray() {
      try {
        var menu=new ContextMenuStrip();
        menu.Items.Add(text.Get("trayOpen"),null,delegate { ShowFromTray(); });
        trayToggle=new ToolStripMenuItem(text.Get("saveStart").Replace("&&","&")); trayToggle.Click+=async delegate { if(start.Enabled) await ToggleControls(); };
        menu.Items.Add(trayToggle); menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(text.Get("trayQuit"),null,delegate { quitting=true; Close(); });
        tray=new NotifyIcon {Icon=Icon ?? SystemIcons.Application,Text="Fadester Companion "+AppVersion(),ContextMenuStrip=menu,Visible=true};
        tray.MouseClick+=(s,e)=>{ if(e.Button==MouseButtons.Left) ShowFromTray(); };
      } catch(Exception e) { Entry.Log("tray: "+e.Message); tray=null; } // without an icon, closing the window stops the controls as before
    }
    void ShowFromTray() {
      if(IsDisposed) return;
      Show(); if(WindowState==FormWindowState.Minimized) WindowState=FormWindowState.Normal; Activate();
    }
    /** Says it beside the clock when the window is hidden: the controls ended and nobody is looking at the panel. */
    void TrayTell(string message) {
      if(tray!=null && !Visible && !String.IsNullOrWhiteSpace(message)) tray.ShowBalloonTip(10000,"Fadester Companion",message,ToolTipIcon.Warning);
    }
    /** A second launch sets Entry.ShowName instead of opening a second window: come to the front. */
    void ListenForShow() {
      try { showSignal=new EventWaitHandle(false,EventResetMode.AutoReset,Entry.ShowName); }
      catch(Exception e) { Entry.Log("show signal: "+e.Message); return; }
      var waiter=new Thread(()=>{
        while(true){
          try { showSignal.WaitOne(); } catch(ObjectDisposedException) { return; }
          if(showStopped){ showSignal.Dispose(); return; }
          try { BeginInvoke((Action)ShowFromTray); } catch(InvalidOperationException) { }
        }
      }) {IsBackground=true,Name="show window"};
      waiter.Start();
    }
    /** The mouse wheel scrolls the page, not the drop-down or number box under the pointer: scrolling past the Assignments
    once turned every anchor into the same scene. A drop-down that is open still takes the wheel. Rows added later get it too. */
    static void KeepWheelForScrolling(Control root) {
      // Taken off first: a control added again (the grid's editing box, each edit) is hooked once, not once per add.
      if(root is ComboBox||root is NumericUpDown){ root.MouseWheel-=PassWheelToPage; root.MouseWheel+=PassWheelToPage; }
      root.ControlAdded-=HookAdded; root.ControlAdded+=HookAdded;
      foreach(Control c in root.Controls) KeepWheelForScrolling(c);
    }
    static void HookAdded(object sender,ControlEventArgs e) { if(e.Control!=null) KeepWheelForScrolling(e.Control); }
    static void PassWheelToPage(object sender,MouseEventArgs e) {
      var combo=sender as ComboBox; var h=e as HandledMouseEventArgs;
      if((combo!=null&&combo.DroppedDown)||h==null) return;
      h.Handled=true;
      for(var p=((Control)sender).Parent;p!=null;p=p.Parent){
        var sc=p as ScrollableControl;
        if(sc!=null&&sc.AutoScroll&&sc.VerticalScroll.Visible){ sc.AutoScrollPosition=new Point(-sc.AutoScrollPosition.X,-sc.AutoScrollPosition.Y-e.Delta); return; }
      }
    }
    FlowLayoutPanel Page(TabControl t,string title) {
      var p=new TabPage(title); t.Controls.Add(p);
      var f=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,WrapContents=false,FlowDirection=FlowDirection.TopDown,Padding=new Padding(12),BackColor=Color.White}; p.Controls.Add(f); return f;
    }
    /**
     * Starts a folded part: every control added to the page until EndFold belongs to it. With a title it is an optional
     * section, one line with its state and Show / Hide; without one it is a step's Details link.
     */
    Fold BeginFold(FlowLayoutPanel f,string id,string title) {
      var fold=new Fold {Id=id,Section=title!=null};
      fold.Link=new LinkLabel {AutoSize=true,UseMnemonic=false,LinkColor=accent,ActiveLinkColor=navy,LinkBehavior=LinkBehavior.HoverUnderline,TabStop=true};
      // ByUser: open because the user opened it. Only those are remembered; a part a light opened is open for that
      // problem, not for every start after it (QA-C04).
      fold.Link.LinkClicked+=delegate { ToggleFold(fold); RememberFolds(); };
      if(title==null){ fold.Link.Margin=new Padding(3,0,3,6); f.Controls.Add(fold.Link); }
      else {
        var head=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,10,0,2)};
        head.Controls.Add(new Label {Text=title,AutoSize=true,UseMnemonic=false,Font=new Font(Font,FontStyle.Bold),ForeColor=navy,Margin=new Padding(3,0,8,0)});
        fold.Summary=new Label {AutoSize=true,UseMnemonic=false,ForeColor=Color.FromArgb(90,98,112),Margin=new Padding(0,0,8,0)};
        fold.Link.Margin=new Padding(0); head.Controls.Add(fold.Summary); head.Controls.Add(fold.Link); f.Controls.Add(head);
      }
      fold.From=f.Controls.Count; folds.Add(fold); return fold;
    }
    void EndFold(FlowLayoutPanel f,Fold fold) {
      for(int i=fold.From;i<f.Controls.Count;i++) fold.Parts.Add(f.Controls[i]);
      SetFold(fold,false);
    }
    void SetFold(Fold fold,bool open) {
      fold.Open=open; fold.Link.Text=text.Get(open ? "foldHide" : fold.Section ? "foldShow" : "foldDetails")+(open ? " ▴" : " ▾");
      body.SuspendLayout(); foreach(var c in fold.Parts) c.Visible=open; body.ResumeLayout();
    }
    void ToggleFold(Fold fold) { SetFold(fold,!fold.Open); fold.ByUser=fold.Open; }
    /** The parts to open again at the next start: the ones the user opened, never one a light opened. */
    internal string[] FoldsToRemember() { return folds.Where(x=>x.ByUser).Select(x=>x.Id).ToArray(); }
    /** A light asks for something inside a closed part: open it, once per problem, so a later Hide by the user stays. */
    void CallFold(Fold fold,bool needed) {
      if(fold==null) return;
      if(needed && !fold.Called && !fold.Open) SetFold(fold,true);
      fold.Called=needed;
    }
    /** The parts that were open when the window last closed open again; a fresh install starts with all of them closed. */
    void ReadFolds() {
      try { if(!File.Exists(foldsState)) return; var open=new HashSet<string>(File.ReadAllLines(foldsState).Select(x=>x.Trim())); foreach(var fold in folds) if(open.Contains(fold.Id)){ SetFold(fold,true); fold.ByUser=true; } }
      catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
    void RememberFolds() {
      if(inert) return;
      try { Directory.CreateDirectory(Path.GetDirectoryName(foldsState)); File.WriteAllLines(foldsState,FoldsToRemember(),new UTF8Encoding(false)); }
      catch(IOException e) { Entry.Log("folds: "+e.Message); } catch(UnauthorizedAccessException e) { Entry.Log("folds: "+e.Message); }
    }
    /** An optional section's state in a few words, beside its title, so a closed section still says what it does. */
    internal static string MixSummary(PanelText text,bool on,bool only) { return text.Get(!on ? "off" : only ? "sumMixOnly" : "on"); }
    internal static string VjsterSummary(PanelText text,bool on,string target,int port) {
      return on ? text.Get("sumVjster",target,port.ToString(CultureInfo.InvariantCulture)) : text.Get("off");
    }
    void Title(FlowLayoutPanel f,string s) { f.Controls.Add(new Label {Text=s,AutoSize=true,Font=new Font(Font,FontStyle.Bold),ForeColor=navy,Margin=new Padding(3,10,3,2)}); }
    /** A part of a numbered step, such as the game controller or the TourBox in step 2. */
    void SubTitle(FlowLayoutPanel f,string s) { f.Controls.Add(new Label {Text=s,AutoSize=true,UseMnemonic=false,Font=new Font(Font,FontStyle.Bold),ForeColor=accent,Margin=new Padding(3,6,3,0)}); }
    Label Hint(FlowLayoutPanel f,string s) { var l=new Label {Text=s,UseMnemonic=false,AutoSize=true,MaximumSize=new Size(650,0),Margin=new Padding(3,2,3,5)}; f.Controls.Add(l); f.ClientSizeChanged+=delegate {l.MaximumSize=new Size(Math.Max(235,f.ClientSize.Width-42),0);}; return l; }
    /** A line that is filled in later (OBS's scenes, the meter, the import's next step): it takes no room while it is empty. */
    Label Note(FlowLayoutPanel f) { var l=Hint(f,""); l.Visible=false; l.TextChanged+=delegate { l.Visible=l.Text.Length>0; }; return l; }
    CheckBox Check(FlowLayoutPanel f,string label) {
      // An auto-sized check box never wraps its text (a long one ran off the page), so it is sized to the page and wraps.
      var check=new CheckBox {Text=label,AutoSize=false,UseMnemonic=false,TextAlign=ContentAlignment.TopLeft,CheckAlign=ContentAlignment.TopLeft};
      f.Controls.Add(check);
      Action fit=delegate {
        int width=Math.Max(235,f.ClientSize.Width-42);
        int box=Math.Max(0,check.GetPreferredSize(Size.Empty).Width-TextRenderer.MeasureText(label,check.Font).Width);
        var text=TextRenderer.MeasureText(label,check.Font,new Size(Math.Max(1,width-box),0),TextFormatFlags.WordBreak);
        check.Size=new Size(Math.Min(width,text.Width+box),text.Height+6);
      };
      fit(); f.ClientSizeChanged+=delegate { fit(); };
      return check;
    }
    Label FieldLabel(string label) {
      return new Label {Text=label,AutoSize=true,UseMnemonic=false,MinimumSize=new Size(172,0),MaximumSize=new Size(210,0),Margin=new Padding(3,7,3,1)};
    }
    Button AddButton(Control p,string text,EventHandler click) { var b=new Button {Text=text,AutoSize=true,Height=32,Padding=new Padding(6,0,6,0),UseVisualStyleBackColor=true}; b.Click+=click; p.Controls.Add(b); return b; }
    void Field(FlowLayoutPanel p,string name,string id) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(FieldLabel(name));
      var c=new ComboBox {Width=270,DropDownStyle=ComboBoxStyle.DropDownList,FormattingEnabled=true}; r.Controls.Add(c);
      // What the list shows, as on the Mac: "Unassigned" for the empty choice and "Unavailable: name" for a saved name OBS
      // no longer has. The items themselves stay the plain names ("" for none), which is what is saved (Picked).
      c.Format+=(s,e)=>{ e.Value=ChoiceText(text,Convert.ToString(e.ListItem),offered.ContainsKey(id)?offered[id]:null); };
      c.Items.Add(""); c.SelectedIndex=0; boxes[id]=c; p.Controls.Add(r);
    }
    /** The names OBS offered for each list at its last fill; none until OBS has been read, so nothing is called unavailable before. */
    readonly Dictionary<string,HashSet<string>> offered=new Dictionary<string,HashSet<string>>();
    internal static string ChoiceText(PanelText text,string name,HashSet<string> offeredNames) {
      if(String.IsNullOrEmpty(name)) return text.Get("unassigned");
      return offeredNames!=null && !offeredNames.Contains(name) ? text.Get("unavailable",name) : name;
    }
    /** The name chosen in an assignment list ("" for Unassigned): never the words the list shows. */
    string Picked(string k) { return Convert.ToString(boxes[k].SelectedItem ?? ""); }
    ComboBox Choose(FlowLayoutPanel p,string label) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(FieldLabel(label));
      var c=new ComboBox {Width=105,DropDownStyle=ComboBoxStyle.DropDownList}; r.Controls.Add(c); p.Controls.Add(r); return c;
    }
    NumericUpDown Number(FlowLayoutPanel p,string label,decimal min,decimal max,decimal defaultValue,decimal increment,int digits) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(FieldLabel(label));
      var n=new NumericUpDown {Minimum=min,Maximum=max,Value=defaultValue,Increment=increment,DecimalPlaces=digits,Width=105};r.Controls.Add(n);p.Controls.Add(r);return n;
    }
    void SetNumber(NumericUpDown n,string key,bool reciprocal=false){
      object v;if(!config.TryGetValue(key,out v) || v==null)return;
      try{decimal x=Convert.ToDecimal(v,System.Globalization.CultureInfo.InvariantCulture);if(reciprocal){if(x<=0)return;x=Decimal.Round(1m/x);}n.Value=Math.Min(n.Maximum,Math.Max(n.Minimum,x));}catch(FormatException){}catch(OverflowException){}catch(InvalidCastException){}
    }
    void Fill(string k,string[] options,string initial) {
      var c=boxes[k]; c.BeginUpdate(); c.Items.Clear(); c.Items.Add("");
      if(catalog.ContainsKey("scenes")) offered[k]=new HashSet<string>(options); else offered.Remove(k);
      foreach(var x in options.Concat(new[]{initial}).Where(v=>!String.IsNullOrEmpty(v)).Distinct()) c.Items.Add(x);
      c.SelectedItem=initial??""; c.EndUpdate();
    }
    void PopulateOverlay() {
      object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
      string scene=Picked("overlayScene"), keep=scene==Val(config,"overlayScene")?Val(config,"overlaySource"):"";
      Fill("overlaySource",List(d,scene),keep);
    }
    void PopulateLayer(int n) {
      object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
      string sceneKey="layer"+n+"Scene", sourceKey="layer"+n+"Source";
      string scene=Picked(sceneKey), keep=scene==Val(config,sceneKey)?Val(config,sourceKey):"";
      Fill(sourceKey,List(d,scene),keep);
    }
    void LoadChoices(bool preserveEdits) {
      string[] audio=List(catalog,"audioInputs"), scenes=List(catalog,"scenes"), anchors=List(config,"anchors");
      Func<string,string,string> keep=(k,old)=>preserveEdits?Picked(k):old;
      foreach(string k in new[]{"musicInput","contentInput","micInput"}) Fill(k,audio,keep(k,Val(config,k)));
      Fill("mediaInput",List(catalog,"mediaInputs"),keep("mediaInput",Val(config,"mediaInput")));
      string oldOverlay=keep("overlaySource",Val(config,"overlaySource"));
      Fill("overlayScene",scenes,keep("overlayScene",Val(config,"overlayScene"))); PopulateOverlay();
      if(boxes["overlaySource"].Items.Contains(oldOverlay)) boxes["overlaySource"].SelectedItem=oldOverlay;
      foreach(int n in new[]{1,2}) {
        string sk="layer"+n+"Scene", srk="layer"+n+"Source"; string oldSource=keep(srk,Val(config,srk));
        Fill(sk,scenes,keep(sk,Val(config,sk))); PopulateLayer(n);
        if(boxes[srk].Items.Contains(oldSource)) boxes[srk].SelectedItem=oldSource;
      }
      for(int i=0;i<4;i++){ string k="anchor"+i; Fill(k,scenes,keep(k,i<anchors.Length?anchors[i]:"")); }
    }
    void ReadSettings() {
      if(File.Exists(settings)) try {config=Decode(File.ReadAllText(settings,Encoding.UTF8)); if(config==null)throw new FormatException();}
      catch { invalidConfig=true; start.Enabled=connect.Enabled=save.Enabled=false; openSettings.Visible=true; Note(text.Get("configUnreadable",SettingsFolder.Holding(settings))); return; }
      int n; if(Int32.TryParse(Val(config,"port"),out n) && n>0 && n<=65535){ settingPort=true; port.Value=n; settingPort=false; }
      // Settings saved before the port followed OBS keep the port they have; a first run follows OBS.
      portAuto=config.ContainsKey("portAuto") ? String.Equals(Val(config,"portAuto"),"true",StringComparison.OrdinalIgnoreCase) : !config.ContainsKey("port");
      vjUsed=String.Equals(Val(config,"vjsterSeen"),"true",StringComparison.OrdinalIgnoreCase);
      enableMix.Checked=String.Equals(Val(config,"mixEnabled"),"true",StringComparison.OrdinalIgnoreCase);
      mixOnly.Checked=enableMix.Checked && String.Equals(Val(config,"mixOnly"),"true",StringComparison.OrdinalIgnoreCase);
      SetNumber(mixStep,"mixStepDb"); SetNumber(mixDuration,"mixFadeMs");
      enableVjster.Checked=!String.Equals(Val(config,"vjsterEnabled"),"false",StringComparison.OrdinalIgnoreCase);
      int vp; if(Int32.TryParse(Val(config,"vjsterPort"),out vp) && vp>=1024 && vp<=65535) vjsterPort.Value=vp;
      extensionId.Text=Val(config,"vjsterExtensionId");
      vjsterTarget.SelectedIndex=Math.Max(0,Array.IndexOf(VjsterObsPage.Targets,Val(config,"vjsterTarget","both").Trim().ToLowerInvariant()));
      enableGamepad.Checked=String.Equals(Val(config,"gamepadEnabled"),"true",StringComparison.OrdinalIgnoreCase);
      easyMode.Checked=!String.Equals(Val(config,"gamepadEasy"),"false",StringComparison.OrdinalIgnoreCase);
      object os; if(config.TryGetValue("opacityStep",out os) && os!=null) {
        try { decimal x=Decimal.Round(Convert.ToDecimal(os,CultureInfo.InvariantCulture)*100m); opacityStep.Value=Math.Min(opacityStep.Maximum,Math.Max(opacityStep.Minimum,x)); }
        catch(FormatException){} catch(OverflowException){} catch(InvalidCastException){}
      }
      SetNumber(volumeStep,"volumeStepDb");SetNumber(duckLevel,"duckDb");SetNumber(fadeTicks,"faderStep",true);SetNumber(transitionStep,"transitionStepMs");
      LoadChoices(false);
    }
    void ReadMap() {
      try {
        var root=Decode(File.ReadAllText(text.MapPath(folder),Encoding.UTF8));
        var presets=(Dictionary<string,object>)root["presets"];
        foreach(var bank in presets) {
          var def=(Dictionary<string,object>)bank.Value;
          foreach(var listKey in new[]{"bindings","nativeBindings","menuBindings"}) {object rows;if(!def.TryGetValue(listKey,out rows))continue;
            foreach(var o in (IEnumerable)rows) {var b=(Dictionary<string,object>)o; string id=Val(b,"action",Val(b,"function")); controls.Rows.Add(Glyph(id),text.Control(Val(b,"control")),text.Gesture(Val(b,"gesture")),Val(b,"label"));
              if(Val(b,"action").Length>0 && !actionLabels.ContainsKey(id)) actionLabels[id]=Val(b,"label");}
          }
        }
      } catch { Note(text.Get("mapUnreadable")); }
      // The English labels too: the bridge prints those (TbarHint).
      try {
        var root=Decode(File.ReadAllText(Path.Combine(folder,"presets","map.json"),Encoding.UTF8));
        foreach(var bank in (Dictionary<string,object>)root["presets"])
          foreach(var listKey in new[]{"bindings","menuBindings"}) { object rows; if(!((Dictionary<string,object>)bank.Value).TryGetValue(listKey,out rows)) continue;
            foreach(var o in (IEnumerable)rows){ var b=(Dictionary<string,object>)o; string id=Val(b,"action"); if(id.Length>0 && !englishLabels.ContainsKey(id)) englishLabels[id]=Val(b,"label"); } }
      } catch(Exception e) { Entry.Log("english map: "+e.Message); }
    }
    void ReadPad() {
      try {
        var root=Decode(File.ReadAllText(Path.Combine(folder,"presets","gamepad.json"),Encoding.UTF8));
        padControls=List(root,"controls"); padOnly=List(root,"padOnly");
        padDefaults=((Dictionary<string,object>)root["defaults"]).ToDictionary(kv=>kv.Key,kv=>Convert.ToString(kv.Value,CultureInfo.InvariantCulture));
        padHolds=((Dictionary<string,object>)root["holdMs"]).ToDictionary(kv=>kv.Key,kv=>Convert.ToInt32(kv.Value,CultureInfo.InvariantCulture));
        padSpeeds=((IEnumerable)root["speeds"]).Cast<object>().Select(x=>Convert.ToDouble(x,CultureInfo.InvariantCulture)).ToArray();
        if(padControls.Length==0 || padSpeeds.Length==0) throw new FormatException();
        // Without the action names (map.json unreadable, already reported) the tab would offer nothing to choose.
        if(actionLabels.Count==0) throw new FormatException();
      } catch { padControls=new string[0]; padGrid.Enabled=fastSpeed.Enabled=slowSpeed.Enabled=false; Note(text.Get("padMapMissing")); return; }
      foreach(var c in new[]{fastSpeed,slowSpeed}){c.Items.Clear(); foreach(var r in padSpeeds) c.Items.Add(r.ToString("0.##",CultureInfo.CurrentCulture)+"x");}
      fastSpeed.SelectedIndex=SpeedIndex("gamepadFastSpeed",2.0); slowSpeed.SelectedIndex=SpeedIndex("gamepadSlowSpeed",0.5);
      padChoices=new List<Choice>{new Choice{Id="",Label=text.Get("padFree")}};
      foreach(var kv in actionLabels) if(kv.Key!="bridge.reconnect") padChoices.Add(new Choice{Id=kv.Key,Label=kv.Value});
      foreach(var id in padOnly) padChoices.Add(new Choice{Id=id,Label=id=="vjster.speed.fast"?text.Get("speedFast"):id=="vjster.speed.slow"?text.Get("speedSlow"):id});
      object saved; FillPadGrid(config.TryGetValue("gamepadMap",out saved)?saved as Dictionary<string,object>:null);
    }
    int SpeedIndex(string key,double fallback){
      double want=fallback; object v;
      if(config.TryGetValue(key,out v) && v!=null) try{want=Convert.ToDouble(v,CultureInfo.InvariantCulture);}catch(FormatException){}catch(InvalidCastException){}catch(OverflowException){}
      int i=Array.IndexOf(padSpeeds,want); if(i<0)i=Array.IndexOf(padSpeeds,fallback); return Math.Max(0,i);
    }
    string PadName(string c){
      switch(c){
        case "DpadUp":return text.Get("up"); case "DpadDown":return text.Get("down"); case "DpadLeft":return text.Get("left"); case "DpadRight":return text.Get("right");
        case "LS": case "RS": return c+" · "+text.Get("press");
        case "LTRelease": return "LT · "+text.Get("padRelease");
      }
      foreach(var stick in new[]{"Left","Right"}) if(c.StartsWith(stick,StringComparison.Ordinal)){
        string dir=c.Substring(stick.Length), arrow=dir=="Up"?"↑":dir=="Down"?"↓":dir=="Left"?"←":"→";
        return (stick=="Left"?"LS ":"RS ")+arrow;
      }
      return c;
    }
    List<Choice> WithId(List<Choice> list,string id){
      if(String.IsNullOrEmpty(id) || list.Any(x=>x.Id==id)) return list;
      var more=new List<Choice>(list); more.Add(new Choice{Id=id,Label=id}); return more;
    }
    void FillPadGrid(Dictionary<string,object> saved){
      var map=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      if(saved!=null) foreach(var kv in saved) map[kv.Key]=Convert.ToString(kv.Value,CultureInfo.InvariantCulture)??"";
      // A release fires when the trigger is let go: nothing there may need a hold (the bridge refuses it too).
      releaseChoices=padChoices.Where(x=>!padHolds.ContainsKey(x.Id)).ToList();
      padGrid.Rows.Clear(); padGrid.Columns.Clear();
      padGrid.Columns.Add(new DataGridViewTextBoxColumn{Name="control",HeaderText=text.Get("control"),ReadOnly=true,FillWeight=60});
      foreach(var name in new[]{"action","shift"})
        padGrid.Columns.Add(new DataGridViewComboBoxColumn{Name=name,HeaderText=text.Get(name=="action"?"action":"padShift"),DisplayMember="Label",ValueMember="Id",FlatStyle=FlatStyle.Flat,FillWeight=120});
      foreach(var c in padControls){
        string a, d, s;
        if(!map.TryGetValue(c,out a)) a=padDefaults.TryGetValue(c,out d)?d:"";
        if(!map.TryGetValue("LB+"+c,out s)) s="";
        var choices=c=="LTRelease"?releaseChoices:padChoices;
        int i=padGrid.Rows.Add(); var row=padGrid.Rows[i]; row.Tag=c; row.Cells[0].Value=PadName(c);
        var actionCell=(DataGridViewComboBoxCell)row.Cells[1]; actionCell.DataSource=WithId(choices,a); actionCell.Value=a;
        var shiftCell=(DataGridViewComboBoxCell)row.Cells[2]; shiftCell.DataSource=WithId(choices,s); shiftCell.Value=s;
        if(c=="LB"){shiftCell.ReadOnly=true; shiftCell.Style.BackColor=Theme.LockedCell;}
      }
      ShowShift();
    }
    DataGridViewRow PadRow(string control){ foreach(DataGridViewRow r in padGrid.Rows) if((string)r.Tag==control) return r; return null; }
    /** With any "With LB held" action LB is only the shift (the bridge drops its own action): show that, and keep it from being edited. */
    void ShowShift(){
      var lb=PadRow("LB"); if(lb==null) return;
      bool shift=padGrid.Rows.Cast<DataGridViewRow>().Any(r=>(string)r.Tag!="LB" && (Convert.ToString(r.Cells[2].Value)??"").Length>0);
      lb.Cells[1].ReadOnly=shift; lb.Cells[1].Style.BackColor=shift?Theme.LockedCell:Color.Empty;
    }
    /** A left trigger that ducks Music must bring it back on the same layer, or the bridge refuses the map: pair it. */
    void PairDuck(){
      var lt=PadRow("LT"); var release=PadRow("LTRelease"); if(lt==null || release==null) return;
      for(int col=1;col<=2;col++)
        if(Convert.ToString(lt.Cells[col].Value)=="music.duck" && (Convert.ToString(release.Cells[col].Value)??"").Length==0){
          var cell=(DataGridViewComboBoxCell)release.Cells[col]; cell.DataSource=WithId(releaseChoices,"music.restore"); cell.Value="music.restore";
        }
    }
    Dictionary<string,object> PadChanges(){
      padGrid.EndEdit(); PairDuck();
      var m=new Dictionary<string,object>();
      foreach(DataGridViewRow row in padGrid.Rows){
        string c=(string)row.Tag, a=Convert.ToString(row.Cells[1].Value)??"", s=Convert.ToString(row.Cells[2].Value)??"", d;
        if(a!=(padDefaults.TryGetValue(c,out d)?d:"")) m[c]=a;
        if(c!="LB" && s.Length>0) m["LB+"+c]=s;
      }
      return m;
    }
    Image Glyph(string action){
      string category;
      switch(action.Split('.')[0]){
        case "mix":case "music":case "content":case "mic":case "soundcheck":case "undo":category="audio";break;
        case "fader":category="fade";break;case "media":case "vjster":category="media";break;case "overlay":case "layer1":case "layer2":category="overlay";break;
        case "capture":case "recording":case "replay":category="capture";break;
        case "transition":case "take":category="transition";break;case "anchor":case "preview":category="scenes";break;
        default:category="diagnostics";break;
      }
      Image icon;if(!glyphs.TryGetValue(category,out icon)){
        string p=Path.Combine(folder,"artwork","icons",category+".png");
        if(File.Exists(p)){using(var original=Image.FromFile(p)){icon=new Bitmap(original,26,26);}}
        glyphs[category]=icon;
      }
      return icon;
    }
    protected override void Dispose(bool disposing){if(disposing){foreach(var img in glyphs.Values)if(img!=null)img.Dispose();glyphs.Clear();}base.Dispose(disposing);}
    void WriteConfig() {
      if(invalidConfig)throw new InvalidOperationException(text.Get("cannotWrite"));
      foreach(string k in new[]{"musicInput","contentInput","micInput","mediaInput","overlayScene","overlaySource","layer1Scene","layer1Source","layer2Scene","layer2Source"}) config[k]=Picked(k);
      config["vjsterEnabled"]=enableVjster.Checked; config["vjsterPort"]=(int)vjsterPort.Value; config["vjsterExtensionId"]=extensionId.Text.Trim();
      config["vjsterTarget"]=VjsterObsPage.Targets[Math.Max(0,vjsterTarget.SelectedIndex)];
      // The OBS page needs its private link token; make one the first time the page is chosen.
      if(VjsterObsPage.Targets[Math.Max(0,vjsterTarget.SelectedIndex)]=="obs" && !VjsterObsPage.ValidToken(VjsterObsPage.NormalizeToken(Val(config,"vjsterObsToken")))) config["vjsterObsToken"]=VjsterObsPage.NewToken();
      config["opacityStep"]=(double)opacityStep.Value/100.0;
      config["gamepadEnabled"]=enableGamepad.Checked; config["gamepadEasy"]=easyMode.Checked;
      if(padControls.Length>0){
        var changes=PadChanges(); if(changes.Count==0) config.Remove("gamepadMap"); else config["gamepadMap"]=changes;
        config["gamepadFastSpeed"]=padSpeeds[fastSpeed.SelectedIndex]; config["gamepadSlowSpeed"]=padSpeeds[slowSpeed.SelectedIndex];
      }
      config["anchors"]=Enumerable.Range(0,4).Select(i=>Picked("anchor"+i)).ToArray();
      config["mixEnabled"]=enableMix.Checked; config["mixOnly"]=mixOnly.Checked; config["mixStepDb"]=mixStep.Value; config["mixFadeMs"]=(int)mixDuration.Value;
      config["volumeStepDb"]=volumeStep.Value;config["duckDb"]=duckLevel.Value;config["faderStep"]=1m/fadeTicks.Value;config["transitionStepMs"]=(int)transitionStep.Value;
      config["host"]="127.0.0.1"; config["port"]=(int)port.Value; config["portAuto"]=portAuto; Directory.CreateDirectory(Path.GetDirectoryName(settings));
      string tmp=settings+"."+Guid.NewGuid().ToString("N")+".tmp";
      try { File.WriteAllText(tmp,Json.Serialize(config),new UTF8Encoding(false)); if(File.Exists(settings)) File.Replace(tmp,settings,null); else File.Move(tmp,settings); }
      finally { if(File.Exists(tmp)) File.Delete(tmp); }
    }
    /**
     * Save. Running controls take the new assignments, inputs, anchors and steps at once ("reload", hand test 2026-11-17: a
     * saved layer did nothing until Stop and Start); a restart would let go of a T-bar fade part-way. The settings the
     * controls set up at start (ports, VJster, the game controller, the mixer mode, the fade step) still need Stop and Start.
     */
    void SaveRequested() {
      if(PortsClash())return;
      try { WriteConfig(); } catch(Exception e){ Note(e.Message); return; }
      var p=worker;
      if(p==null){ Note(text.Get("saved")); return; }
      try { p.StandardInput.WriteLine("reload"); p.StandardInput.Flush(); } catch(IOException) {} catch(InvalidOperationException) {}
      // Compared with what the running controls started with, so a second Save still says a restart is due.
      Note(text.Get(RestartSettings()==startedWith ? "savedApplied" : "savedRestart"));
    }
    /** Writes only these keys into the saved settings, leaving other edits on the page unsaved (a layer the bridge picked). */
    void SaveKeys(Dictionary<string,object> keys) { string error=WriteKeys(settings,keys); if(error!=null) Note(error); }
    /** Writes only these keys into the settings file; null when written, else why not. */
    static string WriteKeys(string file, Dictionary<string,object> keys) {
      try {
        var saved=File.Exists(file) ? (Decode(File.ReadAllText(file,Encoding.UTF8)) ?? new Dictionary<string,object>()) : new Dictionary<string,object>();
        foreach(var k in keys) saved[k.Key]=k.Value;
        string tmp=file+"."+Guid.NewGuid().ToString("N")+".tmp";
        try { File.WriteAllText(tmp,Json.Serialize(saved),new UTF8Encoding(false)); if(File.Exists(file)) File.Replace(tmp,file,null); else File.Move(tmp,file); }
        finally { if(File.Exists(tmp)) File.Delete(tmp); }
        return null;
      } catch(Exception e) { return e.Message; }
    }
    /** The saved settings a running bridge only reads at start (BridgeConfig.ApplyLive leaves them alone), as one string to compare. */
    string RestartSettings() {
      var keys=new[]{"host","port","vjsterEnabled","vjsterPort","vjsterExtensionId","vjsterTarget","vjsterObsToken","gamepadEnabled","gamepadEasy","gamepadMap","gamepadFastSpeed","gamepadSlowSpeed","mixEnabled","mixOnly","faderStep"};
      var parts=new List<string>(); foreach(var k in keys){ object v; parts.Add(k+"="+(config.TryGetValue(k,out v) ? Json.Serialize(v) : "")); }
      return string.Join("\n",parts);
    }
    /** Console has no way in from outside: no file type, no command line. Hand over the path, open Console, say what to do there. */
    void ImportPreset() {
      string path=text.PresetPath(folder);
      try { Clipboard.SetText(path); importNote.Text=text.Get("importCopied"); }
      catch(ExternalException) { importNote.Text=text.Get("importManual",path); }
      try { if(!Desktop.Running("TourBox Console")) { string exe=Desktop.ConsoleExe(); if(exe!=null) OpenPath(exe); } }
      catch(InvalidOperationException e) { Note(e.Message); }
    }
    /** The "Show me where to click" window for the import: the clicks in Console, animated, with the one button that starts them. */
    void ShowImportGuide() {
      if(showMe!=null && !showMe.IsDisposed) showMe.Close();
      showMe=new ShowMeWindow(text,"tourbox",null,delegate { ImportPreset(); });
      showMe.Show(this);
    }
    /** OBS's own WebSocket port in the settings file OBS keeps on this PC (the one its password is read from); 0 when unknown. */
    internal static int ObsPortFrom(string json) {
      try { var d=json==null ? null : Decode(json); int n; return d!=null && Int32.TryParse(Val(d,"server_port"),out n) && n>0 && n<=65535 ? n : 0; }
      catch(Exception) { return 0; } // half-written or hand-edited
    }
    /**
     * The OBS port fills itself in from OBS, as the password does, until a port is typed by hand (that is how another OBS
     * is chosen: a portable copy or a second one). Never while the controls run, and never onto VJster's port.
     */
    void FollowObsPort() {
      if(!portAuto || worker!=null) return;
      try {
        string file=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),"obs-studio","plugin_config","obs-websocket","config.json");
        if(!File.Exists(file)) return;
        int n=ObsPortFrom(File.ReadAllText(file,Encoding.UTF8));
        if(n>0 && n!=(int)port.Value && !(enableVjster.Checked && n==(int)vjsterPort.Value)){ settingPort=true; port.Value=n; settingPort=false; }
      } catch(IOException) {} catch(UnauthorizedAccessException) {}
    }
    /** Compare Console's stored presets with the one this Companion ships, every 5 s (Console writes them when they change). */
    void CheckPresetAge() {
      presetCheckAt=DateTime.Now.AddSeconds(5);
      // Nothing in Console's folder changed since the last complete read: nothing is opened or parsed again.
      string stamp=PresetAge.Stamp();
      if(stamp==null || stamp!=presetStamp || shippedShortcuts==null){
        if(shippedShortcuts==null) shippedShortcuts=PresetAge.Shipped(text.PresetPath(folder));
        // A preset Console is still writing (or a file it holds) keeps the last answer instead of a false one.
        consoleAutoSwitch=PresetAge.AutoSwitch(); activeFadester=PresetAge.ActiveIsFadester(shippedShortcuts);
        if(shippedLayout==null) shippedLayout=PresetAge.Layout(PresetAge.Unzip(text.PresetPath(folder)));
        bool complete; List<string> layouts; var stored=PresetAge.Stored(out complete, out layouts);
        if(!complete) return;
        presetState=PresetAge.Judge(shippedShortcuts,stored,shippedLayout,layouts);
        presetStamp=stamp;
      }
      // Said once, and only where the TourBox light shows it: Console running and not in Stream Deck-only mode.
      if(presetState==PresetState.Old && !toldOldPreset && tourboxConsole && !mixOnly.Checked){ toldOldPreset=true; Note(text.Get("tbOldNote")); }
      if(presetState!=PresetState.Old) toldOldPreset=false;
    }
    /** The TourBox light's buttons: open Console, or its download page when it is not installed. */
    void OpenConsole() {
      // A running Console comes to the front wherever it is installed; only a missing one sends to the download page.
      if(Desktop.BringToFront("TourBox Console")) return;
      string exe=Desktop.ConsoleExe();
      if(exe!=null) OpenPath(exe); else DownloadConsole();
    }
    void DownloadConsole() { OpenPath("https://www.tourboxtech.com/en/downloads/"); Note(text.Get("consoleDownloadOpened")); }
    /**
     * Builds the bridge's OBS Browser Source link from the saved settings (as the Mac panel does) and puts it on the
     * clipboard. A box changed but not saved does not change the link, and nothing else on the page is saved: only a token
     * made here, the first time, is written. Stop and Start are asked for when the running controls do not serve this link.
     */
    void CopyObsUrl() {
      if(invalidConfig) return;
      string saved=VjsterObsPage.NormalizeToken(Val(config,"vjsterObsToken"));
      if(!VjsterObsPage.ValidToken(saved)) {
        // A key made now must be saved before its link is handed out: a link whose key is not stored never works.
        string made=VjsterObsPage.NewToken(), error=WriteKeys(settings,new Dictionary<string,object>{{"vjsterObsToken",made}});
        if(error!=null) { Note(text.Get("obsUrlNotSaved",error)); return; }
        saved=made;
      }
      config["vjsterObsToken"]=saved;
      string id=VjsterObsPage.VideoId(vjsterVideo.Text);
      string url=ObsUrlToCopy(id);
      try { Clipboard.SetText(url); }
      catch(ExternalException) { Note(text.Get("obsUrlManual",url)); return; }
      Note(text.Get(ObsPageRestartNeeded(worker!=null,obsPageStartedWith,config) ? "obsUrlRestart" : id==null ? "obsUrlCopiedBlank" : "obsUrlCopied"));
    }
    /** The OBS Browser Source link for `videoId` (null: VIDEO_ID), from the saved VJster port and token. */
    string ObsUrlToCopy(string videoId) { return VjsterObsPage.Url(SavedVjsterPort(config),videoId,VjsterObsPage.NormalizeToken(Val(config,"vjsterObsToken"))); }
    /** The saved VJster port, or 48150 when none valid is saved (as the page loads it). */
    static int SavedVjsterPort(Dictionary<string,object> cfg) {
      int vp; return Int32.TryParse(Val(cfg,"vjsterPort"),NumberStyles.Integer,CultureInfo.InvariantCulture,out vp) && vp>=1024 && vp<=65535 ? vp : 48150;
    }
    /** What the bridge serves the OBS page from, as read at start: VJster on or off, its port and the page's token. */
    static string ObsPageServed(Dictionary<string,object> cfg) {
      return Val(cfg,"vjsterEnabled")+"\n"+SavedVjsterPort(cfg).ToString(CultureInfo.InvariantCulture)+"\n"+VjsterObsPage.NormalizeToken(Val(cfg,"vjsterObsToken"));
    }
    /** The running controls (started with `startedWith`) do not serve the link the saved settings give: Stop and Start are needed. */
    static bool ObsPageRestartNeeded(bool running, string startedWith, Dictionary<string,object> cfg) { return running && ObsPageServed(cfg)!=startedWith; }
    bool PortsClash() { if(!enableVjster.Checked || port.Value!=vjsterPort.Value) return false; Note(text.Get("portsClash")); return true; }
    void OpenPath(string p) { try {Process.Start(new ProcessStartInfo(p){UseShellExecute=true});} catch(Exception e){Note(e.Message);} }
    void Note(string msg) {
      if(IsDisposed || Disposing || String.IsNullOrWhiteSpace(msg))return;
      if(InvokeRequired){try{BeginInvoke((Action)(()=>Note(msg)));}catch(InvalidOperationException){}return;}
      msg=msg.Trim(); state.Text=msg; if(hud!=null && !hud.IsDisposed)hud.Set(msg);
      if(stateTip==null) stateTip=new ToolTip {AutoPopDelay=20000}; stateTip.SetToolTip(state,msg);
      if(activity!=null){
        // A repeated line (the same error on every Knob click) becomes one line with a count.
        bool repeat=msg==lastNote && activity.Items.Count>0; lastNoteCount=repeat?lastNoteCount+1:1; lastNote=msg;
        string line=DateTime.Now.ToString("T")+"  "+ActivityText.Counted(msg,lastNoteCount);
        if(repeat)activity.Items[activity.Items.Count-1]=line; else {activity.Items.Add(line); if(activity.Items.Count>180)activity.Items.RemoveAt(0);}
        activity.TopIndex=activity.Items.Count-1;
      }
    }
    string lastNote; int lastNoteCount; DateTime catalogAt=DateTime.MinValue; string startedWith, obsPageStartedWith; ToolTip stateTip;
    /** The OBS a scan reads: the one the running controls use (the saved port), else the Port box. */
    int ScanPort() {
      int readPort=(int)port.Value; object savedPort;
      if(worker!=null && config.TryGetValue("port",out savedPort)){ try { readPort=Convert.ToInt32(savedPort,CultureInfo.InvariantCulture); } catch(FormatException) {} catch(InvalidCastException) {} }
      return readPort;
    }
    /** The OBS light's Turn on button: asks OBS to switch Studio Mode on (the bridge's --studio-on) and reads OBS again. Only on that click. */
    async Task TurnOnStudio() {
      if(refreshing||invalidConfig) return;
      refreshing=true; string tmp=null; bool ok=false;
      try {
        tmp=Path.Combine(Path.GetTempPath(),"fadester-studio-"+Guid.NewGuid().ToString("N")+".json");
        File.WriteAllText(tmp,Json.Serialize(new {host="127.0.0.1",port=ScanPort()}),new UTF8Encoding(false));
        using(var proc=Process.Start(Command("--studio-on --config \""+tmp+"\""))){
          var output=proc.StandardOutput.ReadToEndAsync(); var error=proc.StandardError.ReadToEndAsync();
          bool done=await Task.Run(()=>proc.WaitForExit(15000)); if(!done){proc.Kill(); throw new Exception(text.Get("obsTimeout"));}
          await output; var err=await error;
          if(proc.ExitCode!=0) throw new Exception(String.IsNullOrWhiteSpace(err)?text.Get("obsUnavailable"):text.Explain(err.Trim()));
          ok=true;
        }
      } catch(Exception e) { Note(e.Message); }
      finally { try{if(tmp!=null && File.Exists(tmp))File.Delete(tmp);}catch(IOException){} refreshing=false; }
      if(!ok || IsDisposed) return;
      studioOff=false; ShowStatus(); Note(text.Get("studioTurnedOn"));
      await Connect(true);
    }
    ProcessStartInfo Command(string args) {
      var exe=Path.Combine(folder,"FadesterCompanionBridge.exe"); if(!File.Exists(exe))throw new FileNotFoundException(text.Get("bridgeMissing"));
      var pi=new ProcessStartInfo(exe,args) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=folder,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
      if(password.Text.Length!=0) pi.EnvironmentVariables["FADESTER_OBS_PASSWORD"]=password.Text;
      pi.EnvironmentVariables["FADESTER_PANEL"]="1";
      return pi;
    }
    /** quiet: a refresh of the lists by itself (OBS connected, Assignments opened): Stop stays usable and success says nothing. */
    async Task Connect(bool quiet=false) {
      if(refreshing||invalidConfig||(!quiet && PortsClash()))return;
      if(!quiet) FollowObsPort();
      refreshing=true; connect.Enabled=false; if(!quiet) start.Enabled=false; string tmp=null;
      string failure=null; // the OBS problem this scan found; any other failure counts as OBS not answering
      try {
        // A read-only discovery must not overwrite the user's saved assignments.
        tmp=Path.Combine(Path.GetTempPath(),"fadester-discover-"+Guid.NewGuid().ToString("N")+".json");
        // While the controls run, read the OBS they use (the saved port), not an unsaved edit in the Port box.
        File.WriteAllText(tmp,Json.Serialize(new {host="127.0.0.1",port=ScanPort()}),new UTF8Encoding(false));
        using(var proc=Process.Start(Command("--catalog --config \""+tmp+"\""))){
          var output=proc.StandardOutput.ReadToEndAsync(); var error=proc.StandardError.ReadToEndAsync();
          bool done=await Task.Run(()=>proc.WaitForExit(25000)); if(!done){proc.Kill(); throw new Exception(text.Get("obsTimeout"));}
          var s=await output; var err=await error;
          if(proc.ExitCode!=0){ failure=PanelText.ProblemCode(err); throw new Exception(String.IsNullOrWhiteSpace(err)?text.Get("obsUnavailable"):text.Explain(err.Trim())); }
          var next=Decode(s); if(next==null || !next.ContainsKey("scenes"))throw new Exception(text.Get("noScenes"));
          catalog=next; catalogAt=DateTime.Now; LoadChoices(true);
          bool studioMode, knowsStudio=Boolean.TryParse(Val(next,"studioMode"),out studioMode);
          string studio=knowsStudio ? text.Get(studioMode?"on":"off") : "—";
          live.Text=text.Get("sceneSummary",Val(next,"program","—"),Val(next,"preview","—"),studio);
          SetVsStatus(FormatVsMeter(text,Val(next,"visualSidechain"))??"");
          bool wasStudioOff=studioOff;
          obsConnected=true; obsProblem=null; studioOff=knowsStudio && !studioMode;
          if(studioOff && !wasStudioOff) studioChecksLeft=12;
          studioCheckAt=DateTime.Now.AddSeconds(Readiness.StudioLookSeconds(studioChecksLeft));
          ShowStatus();
          if(!quiet) Note(text.Get(worker==null?"obsReady":"obsConnected",List(next,"scenes").Length));
        }
      }catch(Exception e){if(quiet){ Entry.Log("list refresh: "+e.Message); } else { live.Text=""; if(worker==null){SetVsStatus(""); obsConnected=false; obsProblem=failure??"obs-no-answer"; ShowStatus();} Note(e.Message);}}
      finally{try{if(tmp!=null && File.Exists(tmp))File.Delete(tmp);}catch(IOException){} refreshing=false; if(!IsDisposed){connect.Enabled=true; if(!quiet) start.Enabled=true;}}
      // After the scan, OBS or not: VJster controls Chrome's videos without OBS, and the bridge connects to OBS when it appears (FIX-8).
      if(quiet) return; // a refresh of the lists starts nothing and leaves a pending start for the scan that asked
      bool asked=startAfterScan; startAfterScan=false;
      if(IsDisposed || worker!=null) return;
      if(asked){ if(obsConnected || (enableVjster.Checked && !mixOnly.Checked)) StartControls(); return; }
      if(Readiness.AutoStart(File.Exists(settings),!invalidConfig,Remembered(),obsConnected,worker!=null,mixOnly.Checked,enableVjster.Checked)){ StartControls(); if(worker!=null) Note(text.Get("autoStarted")); }
    }
    void StartControls() {
      if(PortsClash())return;
      try{
        WriteConfig(); startedWith=RestartSettings(); obsPageStartedWith=ObsPageServed(config); var p=new Process {StartInfo=Command(mixOnly.Checked?"--mix-only":"--listen"),EnableRaisingEvents=true};
        p.OutputDataReceived+=(s,e)=>BridgeLine(p,e.Data); p.ErrorDataReceived+=(s,e)=>BridgeLine(p,e.Data);
        p.Exited+=delegate { try{BeginInvoke((Action)(()=>{if(worker==p){worker=null; SetVsStatus(""); ShowStartButton(); padState="stPadOff"; ShowStatus(); string said=text.Get(ending==p?"bridgeEnded":p.ExitCode==0?"stopped":"bridgeFailed"); Note(said); if(ending==p || p.ExitCode!=0) TrayTell(said);} Entry.Log("controls ended: "+p.ExitCode); try{p.CancelOutputRead();p.CancelErrorRead();}catch(InvalidOperationException){} p.Dispose();}));}catch(InvalidOperationException){} };
        vjPeers=new HashSet<string>(); vjPortBusy=false; vjOnDeck=false;
        worker=p; if(!p.Start())throw new Exception(text.Get("bridgeNotStarted")); p.BeginOutputReadLine(); p.BeginErrorReadLine(); ShowStartButton();
        // Until the bridge says it found one, a controller that is switched on counts as not found.
        padState=enableGamepad.Checked && !mixOnly.Checked ? "stPadMissing" : "stPadOff"; ShowStatus(); Note(text.Get("starting"));
      }catch(Exception e){worker=null; SetVsStatus(""); ShowStartButton(); padState="stPadOff"; ShowStatus(); Note(e.Message);}
    }
    async Task StopControls() {
      var p=worker; if(p==null)return; start.Enabled=false;
      try {
        bool again=stopTimedOut==p, ended=false;
        AskToStop(p);
        bool done=await Task.Run(()=>WaitForBridge(p,again?3000:8000));
        if(!done && again){ ended=true; ending=p; done=await Task.Run(()=>EndBridge(p,3000)); }
        if(!done){ stopTimedOut=p; Note(text.Get("finishing")); }
        else if(worker==p){worker=null; stopTimedOut=null; SetVsStatus(""); ShowStartButton(); padState="stPadOff"; ShowStatus(); Note(text.Get(ended?"bridgeEnded":"stopped"));}
      }catch(InvalidOperationException){}finally{if(!IsDisposed)start.Enabled=true;}
    }
    void SetVsStatus(string s) {
      vsStatus=s??"";
      if(vsLive!=null) vsLive.Text=vsStatus;
      if(hud!=null && !hud.IsDisposed) hud.SetMeter(vsStatus);
    }
    static string BandBar(int pct) {
      string blocks="▁▂▃▄▅▆▇█";
      int idx=Math.Max(0,Math.Min(7,(pct*7+50)/100));
      return blocks[idx].ToString();
    }
    /** Parses a rate-limited VS-METER: line from the bridge into the localized HUD status line, or null for any other line. */
    internal static string FormatVsMeter(PanelText text,string line) {
      if(line==null || !line.StartsWith("VS-METER: ",StringComparison.Ordinal)) return null;
      string body=line.Substring(10).Trim();
      if(body=="not_loaded") return text.Get("vsNotLoaded");
      if(body=="panic") return text.Get("vsPanic");
      if(body=="no_audio") return text.Get("vsNoAudio");
      if(body.StartsWith("active ",StringComparison.Ordinal)){
        string[] parts=body.Split(new[]{' '},StringSplitOptions.RemoveEmptyEntries);
        int bpm, locked, beat, s0, s1, s2, s3;
        if(parts.Length>=8 &&
           Int32.TryParse(parts[1],NumberStyles.Integer,CultureInfo.InvariantCulture,out bpm) &&
           Int32.TryParse(parts[2],NumberStyles.Integer,CultureInfo.InvariantCulture,out locked) &&
           Int32.TryParse(parts[3],NumberStyles.Integer,CultureInfo.InvariantCulture,out beat) &&
           Int32.TryParse(parts[4],NumberStyles.Integer,CultureInfo.InvariantCulture,out s0) &&
           Int32.TryParse(parts[5],NumberStyles.Integer,CultureInfo.InvariantCulture,out s1) &&
           Int32.TryParse(parts[6],NumberStyles.Integer,CultureInfo.InvariantCulture,out s2) &&
           Int32.TryParse(parts[7],NumberStyles.Integer,CultureInfo.InvariantCulture,out s3)) {
          string bars=BandBar(s0)+BandBar(s1)+BandBar(s2)+BandBar(s3);
          return text.Get(locked!=0?"vsMeterLocked":"vsMeterActive",bpm,beat,bars);
        }
      }
      return "";
    }
    /** One line from the running controls: update the status line from the lines the bridge prints for it, then show the line. */
    void BridgeLine(Process p,string line) {
      if(line==null || IsDisposed || Disposing) return;
      if(InvokeRequired){try{BeginInvoke((Action)(()=>BridgeLine(p,line)));}catch(InvalidOperationException){}return;}
      if(line.StartsWith("VS-METER: ",StringComparison.Ordinal)){
        if(worker==p) SetVsStatus(FormatVsMeter(text,line));
        return;
      }
      if(worker==p){
        var peersNow=Readiness.VjsterPeers(line,vjPeers); bool busyNow=Readiness.VjsterPortBusy(line,vjPortBusy), deckNow=Readiness.VjsterOnDeck(line,vjOnDeck);
        // The first video ever connected here: from now on a missing one is worth an amber light.
        if(peersNow.Count>0 && !vjUsed){ vjUsed=true; config["vjsterSeen"]=true; SaveKeys(new Dictionary<string,object>{{"vjsterSeen",true}}); ShowStatus(); }
        if(busyNow!=vjPortBusy || deckNow!=vjOnDeck || !peersNow.SetEquals(vjPeers)){ vjPeers=peersNow; vjPortBusy=busyNow; vjOnDeck=deckNow; ShowStatus(); }
        // Preview or the T-bar was used with Studio Mode off: the OBS light says so, with its Turn on button.
        if(Readiness.SaysStudioOff(line) && !studioOff){ studioOff=true; studioChecksLeft=12; studioCheckAt=DateTime.Now.AddSeconds(10); ShowStatus(); }
        string padNow=PadState(line,padState), problem=PanelText.ProblemCode(line); bool obsNow=ObsState(line,obsConnected);
        if(padNow=="stPadOn") padEver=true;
        // OBS just answered the running controls: read its scenes and sources for the Assignments lists, with no click.
        if(obsNow && !obsConnected){ var refresh=Connect(true); }
        if(!obsNow && obsConnected) SetVsStatus("");
        if(obsNow) problem=null; else if(problem==null) problem=obsProblem;
        if(padNow!=padState || obsNow!=obsConnected || problem!=obsProblem){padState=padNow; obsConnected=obsNow; obsProblem=problem; ShowStatus();}
      }
      if(line=="SETTINGS-RELOADED") return; // the Save note already said so
      // The bridge's own line for a layer it picked: never shown (the sentence that follows it says the same in words).
      if(line.StartsWith(Readiness.PickedMarker,StringComparison.Ordinal)){ if(worker==p) TakePickedLayer(line); return; }
      // "Still trying:" follows a refused sign-in (bridge Program.cs). The header keeps the problem in the window's language,
      // with the retry fact after it; the bridge's English sentence is never the header.
      if(line.StartsWith("Still trying:",StringComparison.Ordinal)){ Note(StillTrying(text,lastOffline)); return; }
      string shown=TbarHint(line) ?? text.Explain(line);
      if(line.StartsWith("Offline:",StringComparison.OrdinalIgnoreCase)) lastOffline=shown;
      Note(shown);
    }
    /** The last "Offline:" line as the window showed it, for the retry note that follows it. */
    string lastOffline;
    internal static string StillTrying(PanelText text,string problem) {
      return String.IsNullOrWhiteSpace(problem) ? text.Get("stillTrying") : problem.Trim()+" "+text.Get("stillTrying");
    }
    /**
     * A layer the bridge picked by itself (DeskActions.FillLayers), from the line the bridge writes for the panel alone
     * (Readiness.PickedLayer; never from Activity text, which also carries video titles): shown on the Assignments tab
     * and saved, so the next start keeps it. The bridge already uses it.
     */
    void TakePickedLayer(string line) {
      var pick=Readiness.PickedLayer(line);
      if(pick!=null){
        string n=pick.Item1.ToString(System.Globalization.CultureInfo.InvariantCulture), scene=pick.Item2, source=pick.Item3;
        config["layer"+n+"Scene"]=scene; config["layer"+n+"Source"]=source;
        // Fill adds the name when OBS's list is not read yet: a drop-down list cannot show a name it does not hold.
        object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
        Fill("layer"+n+"Scene",List(catalog,"scenes"),scene); Fill("layer"+n+"Source",List(d,scene),source);
        SaveKeys(new Dictionary<string,object>{{"layer"+n+"Scene",scene},{"layer"+n+"Source",source}});
      }
    }
    /**
     * A counter-clockwise Dial click that left the T-bar at rest, in words, as on the Mac (Model.swift hostFeedback): there
     * is nothing to undo, so turn clockwise. A clockwise click right after a throw says so itself (StudioFader.SettlingNote).
     */
    string TbarHint(string line) {
      // P0 formats by the bridge's culture: "0%", or "0 %" with a (narrow) no-break space in French or German.
      var m=line==null ? null : System.Text.RegularExpressions.Regex.Match(line,@"^(.*) · T-bar 0[\s  ]?%$");
      if(m==null || !m.Success) return null;
      string label=m.Groups[1].Value; string a;
      // The bridge names actions from the English map (it starts without --map), the panel from its language's map: either matches.
      foreach(var id in new[]{"fader.back","fader.fineBack"})
        if((actionLabels.TryGetValue(id,out a) && a==label) || (englishLabels.TryGetValue(id,out a) && a==label)) return text.Get("tbarCw");
      return null;
    }
    /** Whether OBS is connected after this bridge line (Program.cs prints these). */
    internal static bool ObsState(string line,bool now) {
      if(line.StartsWith("Connected to OBS at ",StringComparison.Ordinal)) return true;
      if(line.StartsWith("Offline: ",StringComparison.Ordinal) || line.StartsWith("OBS is not connected.",StringComparison.Ordinal) ||
         line.StartsWith("Not connected to OBS",StringComparison.Ordinal)) return false;
      return now;
    }
    /** The game controller's state after this bridge line (GamepadLoop prints these). */
    internal static string PadState(string line,string now) {
      if(line=="Game controller connected.") return "stPadOn";
      if(line=="Game controller disconnected." || line.StartsWith("Game controller not found.",StringComparison.Ordinal) ||
         line.StartsWith("Game controller: XInput is not available",StringComparison.Ordinal)) return "stPadMissing";
      return now;
    }
    void ShowStatus() {
      if(obsLight==null || enableGamepad==null || mixOnly==null || enableVjster==null || reminderBar==null) return;
      bool on=worker!=null;
      // Stream Deck-only mode serves OBS's mixer and needs no Studio Mode: its light does not ask for it.
      obsLight.Display(Readiness.Obs(obsConnected,obsRunning,obsProblem,studioOff && !mixOnly.Checked,on),text);
      // A stopped bridge has no VJster link: what its lines said no longer holds.
      if(!on){ vjPeers.Clear(); vjPortBusy=false; vjOnDeck=false; }
      tbLight.Display(Readiness.TourBox(tourboxConsole,consoleInstalled,mixOnly.Checked,enableGamepad.Checked,presetState==PresetState.Old,presetState==PresetState.None),text);
      var vjState=Readiness.Vjster(enableVjster.Checked,mixOnly.Checked,on,vjPeers.Count,vjPortBusy,vjUsed,vjOnDeck);
      vjLight.Display(vjState,text);
      if(mixFold!=null && vjFold!=null && enableMix!=null && vjsterTarget!=null){
        mixFold.Summary.Text=MixSummary(text,enableMix.Checked,mixOnly.Checked);
        vjFold.Summary.Text=VjsterSummary(text,enableVjster.Checked,Convert.ToString(vjsterTarget.SelectedItem),(int)vjsterPort.Value);
        // The port and password are needed when OBS runs and refuses the sign-in or does not answer; VJster's fields when its light is amber or red.
        CallFold(obsFold,Readiness.NeedsObsFields(obsConnected,obsRunning,obsProblem));
        CallFold(vjFold,vjState.Lamp==Lamp.Amber || vjState.Lamp==Lamp.Red);
      }
      padLight.Display(Readiness.Pad(enableGamepad.Checked,mixOnly.Checked,on,padState,padSeen,padEver),text);
      ctlLight.Display(Readiness.Controls(on,obsConnected),text);
      string key=Readiness.Reminder(on,mixOnly.Checked,obsHidden,tourboxConsole,front,obsRunning,enableVjster.Checked,consoleAutoSwitch,activeFadester);
      reminderKey=key;
      if(key!=null){ reminder.Text=text.Get(key); bringObs.Text=text.Get(key=="remindSelectPreset" ? "btnOpenConsole" : "btnBringObs"); }
      reminderBar.Visible=key!=null;
    }
    /** Once a second: whether OBS runs, has its main window open or is in front, and whether a controller is plugged in. */
    void Watch() {
      if(IsDisposed || enableGamepad==null) return;
      try { using(var programs=new Desktop.Snapshot()) {
        bool on=worker!=null, running=programs.ObsRunning();
        // OBS was just started (or was already running when the panel opened): read its scenes once its WebSocket
        // server has had time to open, and try again a few times while it is still not answering.
        if(running && !obsRunning && !on && !obsConnected){ autoConnectAt=DateTime.Now.AddSeconds(5); autoTries=4; }
        if(!running && !on){ obsConnected=false; studioOff=false; autoTries=0; obsProblem=null; }
        obsRunning=running;
        if(!on || !enableGamepad.Checked){ padSeen=PadProbe.Any(); padEver|=padSeen; }
        obsHidden=on && running && programs.ObsHidden();
        tourboxConsole=programs.Running("TourBox Console"); // the reminder asks for it only while the controls run
        consoleInstalled=tourboxConsole || Desktop.ConsoleExe()!=null;
        front=on ? Desktop.Front() : "";
        if(obsConnected || on) autoTries=0;
        if(DateTime.Now>=presetCheckAt) CheckPresetAge();
        if(autoTries>0 && !refreshing && DateTime.Now>=autoConnectAt && (obsProblem==null || obsProblem=="obs-no-answer")){
          autoTries--; autoConnectAt=DateTime.Now.AddSeconds(5); var pending=Connect();
        }
        // Studio Mode off is on the OBS light: look again now and then, so turning it on in OBS itself clears the light.
        if(running && obsConnected && studioOff && !mixOnly.Checked && !refreshing && DateTime.Now>=studioCheckAt){ if(studioChecksLeft>0) studioChecksLeft--; studioCheckAt=DateTime.Now.AddSeconds(Readiness.StudioLookSeconds(studioChecksLeft)); var again=Connect(true); }
      } } catch(Exception e) { Entry.Log("watch: "+e.Message); }
      ShowStatus();
    }
    /** A light's button: start the controls, use the controller that is plugged in, or show how to fix OBS. */
    async void Act(string action) {
      // The same rule as the Save & start button: nothing while a scan, a start or a stop is under way.
      if(!start.Enabled) return;
      try {
        if(action=="start"){ if(worker==null){ Remember("on"); StartControls(); } return; }
        if(action=="stop"){ if(worker!=null){ Remember("off"); await StopControls(); } return; }
        if(action=="studioOn"){ await TurnOnStudio(); return; }
        if(action=="openObs"){ string exe=Desktop.ObsExe(); if(exe==null) Note(text.Get("obsNotFound")); else Desktop.StartObs(exe,Note); return; }
        if(action=="tryAgain"){
          Remember("on");
          // Controls on: restart them (the bridge reads OBS's saved password, or the one typed, at start). Off: read OBS, then start.
          if(worker!=null){ await StopControls(); if(worker==null) StartControls(); }
          else { startAfterScan=true; await Connect(); }
          return;
        }
        if(action=="usePad"){
          enableGamepad.Checked=true;
          if(worker!=null){ await StopControls(); if(worker==null) StartControls(); }
          return;
        }
        if(action=="openConsole"){ OpenConsole(); return; }
        if(action=="importPreset"){ ShowImportGuide(); return; }
        if(action=="downloadConsole"){ DownloadConsole(); return; }
        if(showMe!=null && !showMe.IsDisposed) showMe.Close();
        if(action=="vjsterWait" || action=="vjsterPort") showMe=new ShowMeWindow(text,action,null,delegate { CopyObsUrl(); },(int)vjsterPort.Value);
        else showMe=new ShowMeWindow(text,action,obsProblem,delegate { var pending=Connect(); });
        showMe.Show(this);
      } catch(Exception e) { Entry.Log("light button: "+e); Note(e.Message); }
    }
    /** The bridge's own clean stop. A bridge that has just exited by itself has closed its input: the wait that follows then finds it stopped. */
    static void AskToStop(Process p) { try { p.StandardInput.WriteLine("quit"); p.StandardInput.Flush(); } catch(IOException) {} }
    static bool WaitForBridge(Process p,int ms) { try{return p.WaitForExit(ms);}catch(InvalidOperationException){return true;} }
    /** The bridge did not stop when asked: end it, so its shortcuts and its OBS port are free for the next start. */
    static bool EndBridge(Process p,int waitMs) {
      try { if(!p.HasExited) p.Kill(); }
      catch(InvalidOperationException) { return true; } // it has exited meanwhile
      catch(System.ComponentModel.Win32Exception) {} // it is already exiting, or cannot be ended: the wait says which
      return WaitForBridge(p,waitMs);
    }
  }
  internal sealed class Feedback : Form {
    readonly Label text, meter;
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var cp=base.CreateParams; cp.ExStyle|=0x08000000; return cp;}}
    internal Feedback(string title) {
      Text=PanelWindow.WithVersion(title); TopMost=true; ShowInTaskbar=false; StartPosition=FormStartPosition.Manual;
      FormBorderStyle=FormBorderStyle.FixedToolWindow; ClientSize=new Size(420,82); BackColor=Color.FromArgb(26,34,51);
      var screen=Screen.FromPoint(Cursor.Position).WorkingArea; Location=new Point(screen.Right-Width-14,screen.Top+14);
      meter=new Label {Dock=DockStyle.Bottom,Height=26,Padding=new Padding(8,0,8,4),TextAlign=ContentAlignment.MiddleLeft,ForeColor=Color.FromArgb(196,210,232),Font=new Font("Segoe UI",9,FontStyle.Regular),AutoEllipsis=true,UseMnemonic=false};
      text=new Label {Dock=DockStyle.Fill,Padding=new Padding(8,4,8,2),TextAlign=ContentAlignment.MiddleLeft,ForeColor=Color.White,Font=new Font("Segoe UI",10,FontStyle.Bold),AutoEllipsis=true,UseMnemonic=false};
      Controls.Add(text); Controls.Add(meter);
    }
    internal void Set(string s){text.Text=s;}
    internal void SetMeter(string s){meter.Text=s??"";}
  }
}
