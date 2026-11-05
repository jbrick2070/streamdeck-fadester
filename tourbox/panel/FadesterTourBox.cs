using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
[assembly: System.Reflection.AssemblyTitle("OBS Fadester for TourBox")]
[assembly: System.Reflection.AssemblyProduct("OBS Fadester for TourBox")]
[assembly: System.Reflection.AssemblyCompany("Jeffrey Brick")]
[assembly: System.Reflection.AssemblyVersion("0.1.0.0")]

// Stock Windows .NET Framework. No installer, browser, elevated rights, or bundled password.
namespace Fadester.TourBox {
  internal static class Entry {
    [STAThread] static int Main(string[] args) {
      if (args.Contains("--self-test")) {
        try { PanelWindow.Test(); return 0; } catch { return 1; }
      }
      bool created;
      using (var single = new Mutex(true, @"Local\FadesterTourBoxPanel", out created)) {
        if (!created) { MessageBox.Show("OBS Fadester for TourBox is already open. Check the taskbar.", "Fadester"); return 0; }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new PanelWindow());
      }
      return 0;
    }
  }
  internal sealed class PanelWindow : Form {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16000000 };
    readonly string folder = AppDomain.CurrentDomain.BaseDirectory;
    readonly string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "config.json");
    readonly Dictionary<string, ComboBox> boxes = new Dictionary<string, ComboBox>();
    readonly Dictionary<string,Image> glyphs=new Dictionary<string,Image>();
    Dictionary<string, object> config = new Dictionary<string, object>(), catalog = new Dictionary<string, object>();
    Label state, live; TextBox password; ListBox activity; Button connect, start, save;
    CheckBox enableMix, mixOnly;
    NumericUpDown mixStep, mixDuration;
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
      var d=Decode("{\"scenes\":[\"🎬 Studio\",\"Act II\"],\"anchors\":[\"a\",\"\",\"b\",\"\"],\"port\":4455}");
      if (List(d,"scenes")[0]!="🎬 Studio" || Val(d,"port")!="4455" || List(d,"anchors").Length!=4) throw new Exception();
      if (List(d,"missing").Length!=0 || Decode(Json.Serialize(d)).Count!=3) throw new Exception();
    }
    internal PanelWindow() {
      Text="OBS Fadester for TourBox"; ClientSize=new Size(780,700); MinimumSize=new Size(620,540);
      Font=new Font("Segoe UI",10); BackColor=Color.White; StartPosition=FormStartPosition.CenterScreen;
      var grid=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=3, Padding=new Padding(14)};
      grid.RowStyles.Add(new RowStyle(SizeType.Absolute,82)); grid.RowStyles.Add(new RowStyle(SizeType.Percent,100)); grid.RowStyles.Add(new RowStyle(SizeType.Absolute,56));
      Controls.Add(grid);
      var head=new Panel {Dock=DockStyle.Fill,BackColor=navy,Padding=new Padding(12)};
      head.Controls.Add(new Label {Text="OBS Fadester for TourBox",Location=new Point(14,7),Font=new Font("Segoe UI",17,FontStyle.Bold),ForeColor=Color.White,AutoSize=true});
      state=new Label {Text="Looking for OBS on this PC…",Location=new Point(16,47),AutoEllipsis=true,ForeColor=Color.White, Width=680}; head.Controls.Add(state); grid.Controls.Add(head,0,0);
      var tabs=new TabControl {Dock=DockStyle.Fill}; grid.Controls.Add(tabs,0,1);
      body=Page(tabs,"Setup"); Title(body,"1   Import the preset"); Hint(body,"In TourBox Console, use the preset list’s Import button to add OBS Fadester for TourBox.tb. Link this one preset to OBS Studio. Press Tour for production tools; no preset switching is needed.");
      AddButton(body,"Open preset folder",delegate { OpenPath(Path.Combine(folder,"presets")); });
      Title(body,"2   Connect to OBS"); Hint(body,"In OBS, open Tools → WebSocket Server Settings and enable the server. Keep authentication on. For the manual crossfader, turn on Studio Mode and choose Fade.");
      var row=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      row.Controls.Add(new Label {Text="Local port", AutoSize=true,Margin=new Padding(4,8,4,0)});
      port=new NumericUpDown {Minimum=1,Maximum=65535,Value=4455,Width=78}; row.Controls.Add(port);
      row.Controls.Add(new Label {Text="Password override",AutoSize=true,Margin=new Padding(10,8,4,0)});
      password=new TextBox {UseSystemPasswordChar=true,Width=142}; row.Controls.Add(password); body.Controls.Add(row);
      Hint(body,"On this PC the bridge can use OBS’s saved password. A password typed here lasts only until you close this window.");
      connect=AddButton(body,"Read scenes and inputs from OBS",async delegate { await Connect(); });
      live=Hint(body,""); Title(body,"3   Try a cue");
      Hint(body,"Start controls below. Select OBS Fadester for TourBox in Console and focus OBS. Turn Scroll one step: Preview should change and Program should stay put. Use the Dial to fade between them.");
      Title(body,"Optional   Assign your inputs"); Hint(body,"Open Assignments to pick Music, Content and your scene shortcuts. Empty assignments do nothing.");
      Title(body,"Optional   Fade all OBS mixer inputs");
      enableMix=new CheckBox {Text="Enable All OBS mixer inputs",AutoSize=true}; body.Controls.Add(enableMix);
      Hint(body,"One relative fade for the public audio inputs in this scene collection, including newly added inputs. Their balance is preserved. All tracks and monitors fed by these inputs follow the fade; mutes and routing stay as set.");
      mixOnly=new CheckBox {Text="Run for Stream Deck, OpenDeck or MIDI only (no TourBox shortcuts)",AutoSize=true,Enabled=false}; body.Controls.Add(mixOnly);
      enableMix.CheckedChanged+=delegate{mixOnly.Enabled=enableMix.Checked;if(!enableMix.Checked)mixOnly.Checked=false;};
      mixStep=Number(body,"Group step (dB)",0.25m,12m,3m,0.25m,2);
      mixDuration=Number(body,"Group fade (ms)",0m,10000m,600m,100m,0);
      var assign=Page(tabs,"Assignments"); Title(assign,"Choose the OBS sources you want to control");
      Hint(assign,"Assignments apply after Save & start, or after restarting the controls. Choose scenes by name; nothing is assigned based on its list position.");
      Field(assign,"Music / bed","musicInput"); Field(assign,"Content / guest","contentInput"); Field(assign,"Microphone","micInput"); Field(assign,"Media / Playlister","mediaInput");
      Field(assign,"Overlay scene","overlayScene"); Field(assign,"Overlay source","overlaySource");
      boxes["overlayScene"].SelectedIndexChanged += delegate { PopulateOverlay(); };
      string[] dirs={"Up","Right","Down","Left"}; for(int i=0;i<4;i++) Field(assign,"D-pad "+dirs[i],"anchor"+i);
      AddButton(assign,"Use first four OBS scenes for D-pad",delegate {var sc=List(catalog,"scenes"); if(sc.Length==0){Note("Read the scene list from OBS first.");return;} for(int i=0;i<4;i++)boxes["anchor"+i].SelectedItem=i<sc.Length?sc[i]:""; Note("D-pad assignments previewed. Save to keep them.");});
      Title(assign,"Adjust the feel");
      volumeStep=Number(assign,"Music step (dB)",0.25m,6m,1m,0.25m,2);
      duckLevel=Number(assign,"Duck ceiling (dB)",-60m,0m,-12m,1m,1);
      fadeTicks=Number(assign,"Ticks per full fade",4m,200m,20m,1m,0);
      transitionStep=Number(assign,"Timing step (ms)",10m,1000m,50m,10m,0);
      Hint(assign,"Press and turn Music or Fade for a quarter step. Duck never raises a quiet input.");
      var keypage=new TabPage("Control map"); tabs.Controls.Add(keypage); controls=new DataGridView {Dock=DockStyle.Fill,ReadOnly=true,AllowUserToAddRows=false,AllowUserToDeleteRows=false,RowHeadersVisible=false,AutoSizeColumnsMode=DataGridViewAutoSizeColumnsMode.Fill,SelectionMode=DataGridViewSelectionMode.FullRowSelect,BackgroundColor=Color.White};
      foreach(var name in new[]{"Control","Gesture","Action"}) controls.Columns.Add(name,name);
      controls.Columns[0].FillWeight=88; controls.Columns[1].FillWeight=95; controls.Columns[2].FillWeight=160; keypage.Controls.Add(controls);
      controls.Columns.Insert(0,new DataGridViewImageColumn {Name="Category",HeaderText="",Width=34,ImageLayout=DataGridViewImageCellLayout.Zoom,AutoSizeMode=DataGridViewAutoSizeColumnMode.None});
      controls.RowTemplate.Height=30;
      var logs=new TabPage("Activity"); tabs.Controls.Add(logs); activity=new ListBox {Dock=DockStyle.Fill,HorizontalScrollbar=true}; logs.Controls.Add(activity);
      var bar=new FlowLayoutPanel {Dock=DockStyle.Fill,Padding=new Padding(0,7,0,0),WrapContents=false};
      start=AddButton(bar,"Save && start controls",async delegate { if(worker==null) StartControls(); else await StopControls(); }); start.BackColor=accent; start.ForeColor=Color.White; start.FlatStyle=FlatStyle.Flat;
      save=AddButton(bar,"Save assignments",delegate { SaveRequested(); });
      AddButton(bar,"Show / hide feedback",delegate { if(hud!=null && !hud.IsDisposed) {hud.Close();return;} hud=new Feedback(); hud.Set(state.Text); hud.Show(); });
      AddButton(bar,"Quick guide",delegate { OpenPath(Path.Combine(folder,"START-HERE.html")); }); grid.Controls.Add(bar,0,2);
      Load += async delegate { ReadSettings(); ReadMap(); if(!invalidConfig) await Connect(); };
      FormClosing+=async (s,e)=>{ if(worker==null)return; e.Cancel=true; if(closing)return; closing=true; await StopControls(); closing=false; if(worker==null)Close(); else Note("The bridge is still completing its current action. Keep the panel open and try Close again."); };
    }
    FlowLayoutPanel Page(TabControl t,string title) {
      var p=new TabPage(title); t.Controls.Add(p);
      var f=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,WrapContents=false,FlowDirection=FlowDirection.TopDown,Padding=new Padding(12),BackColor=Color.White}; p.Controls.Add(f); return f;
    }
    void Title(FlowLayoutPanel f,string s) { f.Controls.Add(new Label {Text=s,AutoSize=true,Font=new Font(Font,FontStyle.Bold),ForeColor=navy,Margin=new Padding(3,10,3,2)}); }
    Label Hint(FlowLayoutPanel f,string s) { var l=new Label {Text=s,UseMnemonic=false,AutoSize=true,MaximumSize=new Size(650,0),Margin=new Padding(3,2,3,5)}; f.Controls.Add(l); f.ClientSizeChanged+=delegate {l.MaximumSize=new Size(Math.Max(235,f.ClientSize.Width-42),0);}; return l; }
    Button AddButton(Control p,string text,EventHandler click) { var b=new Button {Text=text,AutoSize=true,Height=32,Padding=new Padding(6,0,6,0),UseVisualStyleBackColor=true}; b.Click+=click; p.Controls.Add(b); return b; }
    void Field(FlowLayoutPanel p,string name,string id) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(new Label {Text=name,Width=140,Margin=new Padding(3,7,3,1)});
      var c=new ComboBox {Width=270,DropDownStyle=ComboBoxStyle.DropDownList}; r.Controls.Add(c); c.Items.Add(""); c.SelectedIndex=0; boxes[id]=c; p.Controls.Add(r);
    }
    NumericUpDown Number(FlowLayoutPanel p,string label,decimal min,decimal max,decimal defaultValue,decimal increment,int digits) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(new Label {Text=label,Width=140,Margin=new Padding(3,7,3,1)});
      var n=new NumericUpDown {Minimum=min,Maximum=max,Value=defaultValue,Increment=increment,DecimalPlaces=digits,Width=105};r.Controls.Add(n);p.Controls.Add(r);return n;
    }
    void SetNumber(NumericUpDown n,string key,bool reciprocal=false){
      object v;if(!config.TryGetValue(key,out v) || v==null)return;
      try{decimal x=Convert.ToDecimal(v,System.Globalization.CultureInfo.InvariantCulture);if(reciprocal){if(x<=0)return;x=Decimal.Round(1m/x);}n.Value=Math.Min(n.Maximum,Math.Max(n.Minimum,x));}catch(FormatException){}catch(OverflowException){}
    }
    void Fill(string k,string[] options,string initial) {
      var c=boxes[k]; c.BeginUpdate(); c.Items.Clear(); c.Items.Add("");
      foreach(var x in options.Concat(new[]{initial}).Where(v=>!String.IsNullOrEmpty(v)).Distinct()) c.Items.Add(x);
      c.SelectedItem=initial??""; c.EndUpdate();
    }
    void PopulateOverlay() {
      object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
      string scene=boxes["overlayScene"].Text, keep=scene==Val(config,"overlayScene")?Val(config,"overlaySource"):"";
      Fill("overlaySource",List(d,scene),keep);
    }
    void LoadChoices(bool preserveEdits) {
      string[] audio=List(catalog,"audioInputs"), scenes=List(catalog,"scenes"), anchors=List(config,"anchors");
      Func<string,string,string> keep=(k,old)=>preserveEdits?boxes[k].Text:old;
      foreach(string k in new[]{"musicInput","contentInput","micInput"}) Fill(k,audio,keep(k,Val(config,k)));
      Fill("mediaInput",List(catalog,"mediaInputs"),keep("mediaInput",Val(config,"mediaInput")));
      string oldOverlay=keep("overlaySource",Val(config,"overlaySource"));
      Fill("overlayScene",scenes,keep("overlayScene",Val(config,"overlayScene"))); PopulateOverlay();
      if(boxes["overlaySource"].Items.Contains(oldOverlay)) boxes["overlaySource"].SelectedItem=oldOverlay;
      for(int i=0;i<4;i++){ string k="anchor"+i; Fill(k,scenes,keep(k,i<anchors.Length?anchors[i]:"")); }
    }
    void ReadSettings() {
      if(File.Exists(settings)) try {config=Decode(File.ReadAllText(settings,Encoding.UTF8)); if(config==null)throw new FormatException();}
      catch { invalidConfig=true; start.Enabled=connect.Enabled=save.Enabled=false; Note("Cannot read config.json. Back up or repair the file in "+Path.GetDirectoryName(settings)); return; }
      int n; if(Int32.TryParse(Val(config,"port"),out n) && n>0 && n<=65535) port.Value=n;
      enableMix.Checked=String.Equals(Val(config,"mixEnabled"),"true",StringComparison.OrdinalIgnoreCase);
      mixOnly.Checked=enableMix.Checked && String.Equals(Val(config,"mixOnly"),"true",StringComparison.OrdinalIgnoreCase);
      SetNumber(mixStep,"mixStepDb"); SetNumber(mixDuration,"mixFadeMs");
      SetNumber(volumeStep,"volumeStepDb");SetNumber(duckLevel,"duckDb");SetNumber(fadeTicks,"faderStep",true);SetNumber(transitionStep,"transitionStepMs");
      LoadChoices(false);
    }
    void ReadMap() {
      try {
        var root=Decode(File.ReadAllText(Path.Combine(folder,"presets","map.json"),Encoding.UTF8));
        var presets=(Dictionary<string,object>)root["presets"];
        foreach(var bank in presets) {
          var def=(Dictionary<string,object>)bank.Value;
          foreach(var listKey in new[]{"bindings","nativeBindings","menuBindings"}) {object rows;if(!def.TryGetValue(listKey,out rows))continue;
            foreach(var o in (IEnumerable)rows) {var b=(Dictionary<string,object>)o; controls.Rows.Add(Glyph(Val(b,"action",Val(b,"function"))),Val(b,"control"),Val(b,"gesture"),Val(b,"label"));}
          }
        }
      } catch { Note("Could not read the control map. Extract the entire ZIP before running Fadester."); }
    }
    Image Glyph(string action){
      string category;
      switch(action.Split('.')[0]){
        case "mix":case "music":case "content":case "mic":case "soundcheck":case "undo":category="audio";break;
        case "fader":category="fade";break;case "media":category="media";break;case "overlay":category="overlay";break;
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
      if(invalidConfig)throw new InvalidOperationException("Existing config could not be read.");
      foreach(string k in new[]{"musicInput","contentInput","micInput","mediaInput","overlayScene","overlaySource"}) config[k]=boxes[k].Text;
      config["anchors"]=Enumerable.Range(0,4).Select(i=>boxes["anchor"+i].Text).ToArray();
      config["mixEnabled"]=enableMix.Checked; config["mixOnly"]=mixOnly.Checked; config["mixStepDb"]=mixStep.Value; config["mixFadeMs"]=(int)mixDuration.Value;
      config["volumeStepDb"]=volumeStep.Value;config["duckDb"]=duckLevel.Value;config["faderStep"]=1m/fadeTicks.Value;config["transitionStepMs"]=(int)transitionStep.Value;
      config["host"]="127.0.0.1"; config["port"]=(int)port.Value; Directory.CreateDirectory(Path.GetDirectoryName(settings));
      string tmp=settings+"."+Guid.NewGuid().ToString("N")+".tmp";
      try { File.WriteAllText(tmp,Json.Serialize(config),new UTF8Encoding(false)); if(File.Exists(settings)) File.Replace(tmp,settings,null); else File.Move(tmp,settings); }
      finally { if(File.Exists(tmp)) File.Delete(tmp); }
    }
    void SaveRequested() { try {WriteConfig(); Note(worker==null?"Assignments saved.":"Assignments saved. Stop and restart controls to apply.");}catch(Exception e){Note(e.Message);} }
    void OpenPath(string p) { try {Process.Start(new ProcessStartInfo(p){UseShellExecute=true});} catch(Exception e){Note(e.Message);} }
    void Note(string msg) {
      if(IsDisposed || Disposing || String.IsNullOrWhiteSpace(msg))return;
      if(InvokeRequired){try{BeginInvoke((Action)(()=>Note(msg)));}catch(InvalidOperationException){}return;}
      msg=msg.Trim(); state.Text=msg; if(hud!=null && !hud.IsDisposed)hud.Set(msg); if(activity!=null){activity.Items.Add(DateTime.Now.ToString("T")+"  "+msg); if(activity.Items.Count>180)activity.Items.RemoveAt(0); activity.TopIndex=activity.Items.Count-1;}
    }
    ProcessStartInfo Command(string args) {
      var exe=Path.Combine(folder,"FadesterTourBoxBridge.exe"); if(!File.Exists(exe))throw new FileNotFoundException("Extract the whole ZIP: FadesterTourBoxBridge.exe is missing.");
      var pi=new ProcessStartInfo(exe,args) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=folder,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
      if(password.Text.Length!=0) pi.EnvironmentVariables["FADESTER_OBS_PASSWORD"]=password.Text;
      return pi;
    }
    async Task Connect() {
      if(refreshing||invalidConfig)return;
      refreshing=true; connect.Enabled=false; start.Enabled=false; string tmp=null;
      try {
        // A read-only discovery must not overwrite the user's saved assignments.
        tmp=Path.Combine(Path.GetTempPath(),"fadester-discover-"+Guid.NewGuid().ToString("N")+".json");
        File.WriteAllText(tmp,Json.Serialize(new {host="127.0.0.1",port=(int)port.Value}),new UTF8Encoding(false));
        using(var proc=Process.Start(Command("--catalog --config \""+tmp+"\""))){
          var output=proc.StandardOutput.ReadToEndAsync(); var error=proc.StandardError.ReadToEndAsync();
          bool done=await Task.Run(()=>proc.WaitForExit(25000)); if(!done){proc.Kill(); throw new Exception("OBS did not answer. Check the port and password.");}
          var s=await output; var err=await error; if(proc.ExitCode!=0)throw new Exception(String.IsNullOrWhiteSpace(err)?"Cannot connect to OBS. Check WebSocket settings.":err.Trim());
          var next=Decode(s); if(next==null || !next.ContainsKey("scenes"))throw new Exception("Bridge returned no scene list.");
          catalog=next; LoadChoices(true); live.Text="Program: "+Val(next,"program","—")+"   •   Preview: "+Val(next,"preview","—")+"   •   Studio Mode: "+Val(next,"studioMode");
          Note("Connected to OBS. Found "+List(next,"scenes").Length+" scene(s).");
        }
      }catch(Exception e){live.Text=""; Note(e.Message);}
      finally{try{if(tmp!=null && File.Exists(tmp))File.Delete(tmp);}catch(IOException){} refreshing=false; if(!IsDisposed){connect.Enabled=true; start.Enabled=true;}}
    }
    void StartControls() {
      try{
        WriteConfig(); var p=new Process {StartInfo=Command(mixOnly.Checked?"--mix-only":"--listen"),EnableRaisingEvents=true};
        p.OutputDataReceived+=(s,e)=>Note(e.Data); p.ErrorDataReceived+=(s,e)=>Note(e.Data);
        p.Exited+=delegate { try{BeginInvoke((Action)(()=>{if(worker==p){worker=null; start.Text="Save && start controls"; Note(p.ExitCode==0?"Controls stopped.":"Could not start or continue controls. See Activity for the shortcut or connection error.");} p.Dispose();}));}catch(InvalidOperationException){} };
        worker=p; if(!p.Start())throw new Exception("Bridge did not start."); p.BeginOutputReadLine(); p.BeginErrorReadLine(); start.Text="Stop controls"; Note("Starting controller…");
      }catch(Exception e){worker=null; start.Text="Save && start controls"; Note(e.Message);}
    }
    async Task StopControls() {
      var p=worker; if(p==null)return; start.Enabled=false;
      try { p.StandardInput.WriteLine("quit"); p.StandardInput.Flush();
        bool done=await Task.Run(()=>{ try{return p.WaitForExit(8000);}catch(InvalidOperationException){return true;} });
        if(!done) Note("Bridge is still finishing its current action.");
        else if(worker==p){worker=null; start.Text="Save && start controls"; Note("Controls stopped.");}
      }catch(InvalidOperationException){}catch(IOException){}finally{if(!IsDisposed)start.Enabled=true;}
    }
  }
  internal sealed class Feedback : Form {
    readonly Label text;
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var cp=base.CreateParams; cp.ExStyle|=0x08000000; return cp;}}
    internal Feedback() {
      Text="Fadester · last action"; TopMost=true; ShowInTaskbar=false; StartPosition=FormStartPosition.Manual;
      FormBorderStyle=FormBorderStyle.FixedToolWindow; ClientSize=new Size(390,58); BackColor=Color.FromArgb(26,34,51);
      var screen=Screen.FromPoint(Cursor.Position).WorkingArea; Location=new Point(screen.Right-Width-14,screen.Top+14);
      text=new Label {Dock=DockStyle.Fill,Padding=new Padding(8,3,8,3),TextAlign=ContentAlignment.MiddleLeft,ForeColor=Color.White,Font=new Font("Segoe UI",10,FontStyle.Bold),AutoEllipsis=true}; Controls.Add(text);
    }
    internal void Set(string s){text.Text=s;}
  }
}
