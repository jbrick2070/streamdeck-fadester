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
      Application.ThreadException += (s, e) => Log("window error: " + e.Exception);
      AppDomain.CurrentDomain.UnhandledException += (s, e) => Log("fatal error: " + e.ExceptionObject);
      var text = PanelText.FromArguments(args, CultureInfo.CurrentUICulture);
      bool created;
      using (var single = new Mutex(true, @"Local\FadesterTourBoxPanel", out created)) {
        if (!created) { MessageBox.Show(text.Get("alreadyOpen"), "Fadester"); return 0; }
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new PanelWindow(text));
      }
      return 0;
    }
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
  internal sealed class PanelWindow : Form {
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16000000 };
    readonly PanelText text;
    readonly string folder = AppDomain.CurrentDomain.BaseDirectory;
    readonly string settings = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FadesterTourBox", "config.json");
    readonly Dictionary<string, ComboBox> boxes = new Dictionary<string, ComboBox>();
    readonly Dictionary<string,Image> glyphs=new Dictionary<string,Image>();
    Dictionary<string, object> config = new Dictionary<string, object>(), catalog = new Dictionary<string, object>();
    Label state, live, importNote; TextBox password; ListBox activity; Button connect, start, save;
    CheckBox enableMix, mixOnly, enableVjster, enableGamepad, easyMode;
    // The game controller tab, from presets/gamepad.json (checked against the bridge by its self-test).
    DataGridView padGrid; ComboBox fastSpeed, slowSpeed;
    string[] padControls = new string[0], padOnly = new string[0];
    Dictionary<string,string> padDefaults = new Dictionary<string,string>();
    Dictionary<string,int> padHolds = new Dictionary<string,int>();
    double[] padSpeeds = new double[0];
    readonly Dictionary<string,string> actionLabels = new Dictionary<string,string>();
    List<Choice> padChoices = new List<Choice>(), releaseChoices = new List<Choice>();
    sealed class Choice { public string Id { get; set; } public string Label { get; set; } }
    NumericUpDown mixStep, mixDuration, vjsterPort, opacityStep; TextBox extensionId;
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
      var d=Decode("{\"scenes\":[\"🎬 Studio\",\"Act II\"],\"anchors\":[\"a\",\"\",\"b\",\"\"],\"port\":4455}");
      if (List(d,"scenes")[0]!="🎬 Studio" || Val(d,"port")!="4455" || List(d,"anchors").Length!=4) throw new Exception();
      if (List(d,"missing").Length!=0 || Decode(Json.Serialize(d)).Count!=3) throw new Exception();
    }
    internal PanelWindow(PanelText text) {
      this.text = text;
      Text="OBS Fadester for TourBox"; ClientSize=new Size(780,700); MinimumSize=new Size(620,540);
      Font=new Font("Segoe UI",10); BackColor=Color.White; StartPosition=FormStartPosition.CenterScreen;
      var grid=new TableLayoutPanel {Dock=DockStyle.Fill,ColumnCount=1,RowCount=3, Padding=new Padding(14)};
      grid.RowStyles.Add(new RowStyle(SizeType.Absolute,82)); grid.RowStyles.Add(new RowStyle(SizeType.Percent,100)); grid.RowStyles.Add(new RowStyle(SizeType.Absolute,86));
      Controls.Add(grid);
      var head=new Panel {Dock=DockStyle.Fill,BackColor=navy,Padding=new Padding(12)};
      head.Controls.Add(new Label {Text="OBS Fadester for TourBox",Location=new Point(14,7),Font=new Font("Segoe UI",17,FontStyle.Bold),ForeColor=Color.White,AutoSize=true});
      state=new Label {Text=text.Get("lookingForObs"),Location=new Point(16,47),AutoEllipsis=true,ForeColor=Color.White, Width=680,Anchor=AnchorStyles.Left|AnchorStyles.Right|AnchorStyles.Top}; head.Controls.Add(state); grid.Controls.Add(head,0,0);
      head.ClientSizeChanged+=delegate { state.Width=Math.Max(1,head.ClientSize.Width-32); };
      var tabs=new TabControl {Dock=DockStyle.Fill}; grid.Controls.Add(tabs,0,1);
      body=Page(tabs,text.Get("setup")); Title(body,text.Get("importTitle")); Hint(body,text.Get("importHint"));
      AddButton(body,text.Get("openPreset"),delegate { ImportPreset(); }); importNote=Hint(body,"");
      Title(body,text.Get("connectTitle")); Hint(body,text.Get("connectHint"));
      var row=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      row.Controls.Add(new Label {Text=text.Get("port"), AutoSize=true,Margin=new Padding(4,8,4,0)});
      port=new NumericUpDown {Minimum=1,Maximum=65535,Value=4455,Width=78}; row.Controls.Add(port);
      row.Controls.Add(new Label {Text=text.Get("password"),AutoSize=true,Margin=new Padding(10,8,4,0)});
      password=new TextBox {UseSystemPasswordChar=true,Width=142}; row.Controls.Add(password); body.Controls.Add(row);
      Hint(body,text.Get("passwordHint"));
      connect=AddButton(body,text.Get("discover"),async delegate { await Connect(); });
      live=Hint(body,""); Title(body,text.Get("cueTitle"));
      Hint(body,text.Get("cueHint"));
      Title(body,text.Get("inputsTitle")); Hint(body,text.Get("inputsHint"));
      Title(body,text.Get("mixTitle"));
      enableMix=Check(body,text.Get("enableMix"));
      Hint(body,text.Get("mixHint"));
      mixOnly=Check(body,text.Get("mixOnly")); mixOnly.Enabled=false;
      enableMix.CheckedChanged+=delegate{mixOnly.Enabled=enableMix.Checked;if(!enableMix.Checked)mixOnly.Checked=false;};
      mixStep=Number(body,text.Get("mixStep"),0.25m,12m,3m,0.25m,2);
      mixDuration=Number(body,text.Get("mixFade"),0m,10000m,600m,100m,0);
      Title(body,text.Get("vjsterTitle"));
      enableVjster=Check(body,text.Get("enableVjster")); enableVjster.Checked=true;
      Hint(body,text.Get("vjsterHint"));
      Hint(body,text.Get("vjsterChrome"));
      var vjRow=new FlowLayoutPanel {AutoSize=true,WrapContents=true,Margin=new Padding(0,3,0,3)};
      vjRow.Controls.Add(new Label {Text=text.Get("vjsterPort"),AutoSize=true,Margin=new Padding(4,8,4,0)});
      vjsterPort=new NumericUpDown {Minimum=1024,Maximum=65535,Value=48150,Width=78}; vjRow.Controls.Add(vjsterPort);
      vjRow.Controls.Add(new Label {Text=text.Get("vjsterExtensionId"),AutoSize=true,Margin=new Padding(10,8,4,0)});
      extensionId=new TextBox {Width=290}; vjRow.Controls.Add(extensionId); body.Controls.Add(vjRow);
      Hint(body,text.Get("vjsterIdHint"));
      Title(body,text.Get("gamepadTitle"));
      enableGamepad=Check(body,text.Get("enableGamepad"));
      easyMode=Check(body,text.Get("gamepadEasy")); easyMode.Checked=true;
      Hint(body,text.Get("gamepadHint"));
      var assign=Page(tabs,text.Get("assignments")); Title(assign,text.Get("assignTitle"));
      Hint(assign,text.Get("assignHint"));
      foreach (var field in new[] { "musicInput", "contentInput", "micInput", "mediaInput", "overlayScene", "overlaySource" })
        Field(assign,text.Get(field),field);
      boxes["overlayScene"].SelectedIndexChanged += delegate { PopulateOverlay(); };
      string[] dirs={"up","right","down","left"}; for(int i=0;i<4;i++) Field(assign,text.Get(dirs[i]),"anchor"+i);
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
      start=AddButton(bar,text.Get("saveStart"),async delegate { if(worker==null) StartControls(); else await StopControls(); }); start.BackColor=accent; start.ForeColor=Color.White; start.FlatStyle=FlatStyle.Flat;
      save=AddButton(bar,text.Get("save"),delegate { SaveRequested(); });
      AddButton(bar,text.Get("feedback"),delegate { if(hud!=null && !hud.IsDisposed) {hud.Close();return;} hud=new Feedback(text.Get("lastAction")); hud.Set(state.Text); hud.Show(); });
      AddButton(bar,text.Get("guide"),delegate { OpenPath(text.GuidePath(folder)); }); grid.Controls.Add(bar,0,2);
      Load += async delegate { ReadSettings(); ReadMap(); ReadPad(); if(!invalidConfig) await Connect(); };
      FormClosing+=async (s,e)=>{ Entry.Log("closing: "+e.CloseReason+(worker==null?"":", controls running")); if(worker==null)return; e.Cancel=true; if(closing)return; closing=true; await StopControls(); closing=false; if(worker==null)Close(); else Note(text.Get("stillClosing")); };
    }
    FlowLayoutPanel Page(TabControl t,string title) {
      var p=new TabPage(title); t.Controls.Add(p);
      var f=new FlowLayoutPanel {Dock=DockStyle.Fill,AutoScroll=true,WrapContents=false,FlowDirection=FlowDirection.TopDown,Padding=new Padding(12),BackColor=Color.White}; p.Controls.Add(f); return f;
    }
    void Title(FlowLayoutPanel f,string s) { f.Controls.Add(new Label {Text=s,AutoSize=true,Font=new Font(Font,FontStyle.Bold),ForeColor=navy,Margin=new Padding(3,10,3,2)}); }
    Label Hint(FlowLayoutPanel f,string s) { var l=new Label {Text=s,UseMnemonic=false,AutoSize=true,MaximumSize=new Size(650,0),Margin=new Padding(3,2,3,5)}; f.Controls.Add(l); f.ClientSizeChanged+=delegate {l.MaximumSize=new Size(Math.Max(235,f.ClientSize.Width-42),0);}; return l; }
    CheckBox Check(FlowLayoutPanel f,string label) {
      var check=new CheckBox {Text=label,AutoSize=true,UseMnemonic=false,MaximumSize=new Size(650,0)};
      f.Controls.Add(check);
      f.ClientSizeChanged+=delegate {check.MaximumSize=new Size(Math.Max(235,f.ClientSize.Width-42),0);};
      return check;
    }
    Label FieldLabel(string label) {
      return new Label {Text=label,AutoSize=true,UseMnemonic=false,MinimumSize=new Size(172,0),MaximumSize=new Size(210,0),Margin=new Padding(3,7,3,1)};
    }
    Button AddButton(Control p,string text,EventHandler click) { var b=new Button {Text=text,AutoSize=true,Height=32,Padding=new Padding(6,0,6,0),UseVisualStyleBackColor=true}; b.Click+=click; p.Controls.Add(b); return b; }
    void Field(FlowLayoutPanel p,string name,string id) {
      var r=new FlowLayoutPanel {AutoSize=true,WrapContents=false,Margin=new Padding(0)};
      r.Controls.Add(FieldLabel(name));
      var c=new ComboBox {Width=270,DropDownStyle=ComboBoxStyle.DropDownList}; r.Controls.Add(c); c.Items.Add(""); c.SelectedIndex=0; boxes[id]=c; p.Controls.Add(r);
    }
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
      foreach(var x in options.Concat(new[]{initial}).Where(v=>!String.IsNullOrEmpty(v)).Distinct()) c.Items.Add(x);
      c.SelectedItem=initial??""; c.EndUpdate();
    }
    void PopulateOverlay() {
      object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
      string scene=boxes["overlayScene"].Text, keep=scene==Val(config,"overlayScene")?Val(config,"overlaySource"):"";
      Fill("overlaySource",List(d,scene),keep);
    }
    void PopulateLayer(int n) {
      object items; var d=catalog.TryGetValue("sceneItems",out items)?items as Dictionary<string,object>:null;
      string sceneKey="layer"+n+"Scene", sourceKey="layer"+n+"Source";
      string scene=boxes[sceneKey].Text, keep=scene==Val(config,sceneKey)?Val(config,sourceKey):"";
      Fill(sourceKey,List(d,scene),keep);
    }
    void LoadChoices(bool preserveEdits) {
      string[] audio=List(catalog,"audioInputs"), scenes=List(catalog,"scenes"), anchors=List(config,"anchors");
      Func<string,string,string> keep=(k,old)=>preserveEdits?boxes[k].Text:old;
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
      catch { invalidConfig=true; start.Enabled=connect.Enabled=save.Enabled=false; Note(text.Get("configUnreadable",Path.GetDirectoryName(settings))); return; }
      int n; if(Int32.TryParse(Val(config,"port"),out n) && n>0 && n<=65535) port.Value=n;
      enableMix.Checked=String.Equals(Val(config,"mixEnabled"),"true",StringComparison.OrdinalIgnoreCase);
      mixOnly.Checked=enableMix.Checked && String.Equals(Val(config,"mixOnly"),"true",StringComparison.OrdinalIgnoreCase);
      SetNumber(mixStep,"mixStepDb"); SetNumber(mixDuration,"mixFadeMs");
      enableVjster.Checked=!String.Equals(Val(config,"vjsterEnabled"),"false",StringComparison.OrdinalIgnoreCase);
      int vp; if(Int32.TryParse(Val(config,"vjsterPort"),out vp) && vp>=1024 && vp<=65535) vjsterPort.Value=vp;
      extensionId.Text=Val(config,"vjsterExtensionId");
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
        if(c=="LB"){shiftCell.ReadOnly=true; shiftCell.Style.BackColor=Color.Gainsboro;}
      }
      ShowShift();
    }
    DataGridViewRow PadRow(string control){ foreach(DataGridViewRow r in padGrid.Rows) if((string)r.Tag==control) return r; return null; }
    /** With any "With LB held" action LB is only the shift (the bridge drops its own action): show that, and keep it from being edited. */
    void ShowShift(){
      var lb=PadRow("LB"); if(lb==null) return;
      bool shift=padGrid.Rows.Cast<DataGridViewRow>().Any(r=>(string)r.Tag!="LB" && (Convert.ToString(r.Cells[2].Value)??"").Length>0);
      lb.Cells[1].ReadOnly=shift; lb.Cells[1].Style.BackColor=shift?Color.Gainsboro:Color.Empty;
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
      foreach(string k in new[]{"musicInput","contentInput","micInput","mediaInput","overlayScene","overlaySource","layer1Scene","layer1Source","layer2Scene","layer2Source"}) config[k]=boxes[k].Text;
      config["vjsterEnabled"]=enableVjster.Checked; config["vjsterPort"]=(int)vjsterPort.Value; config["vjsterExtensionId"]=extensionId.Text.Trim();
      config["opacityStep"]=(double)opacityStep.Value/100.0;
      config["gamepadEnabled"]=enableGamepad.Checked; config["gamepadEasy"]=easyMode.Checked;
      if(padControls.Length>0){
        var changes=PadChanges(); if(changes.Count==0) config.Remove("gamepadMap"); else config["gamepadMap"]=changes;
        config["gamepadFastSpeed"]=padSpeeds[fastSpeed.SelectedIndex]; config["gamepadSlowSpeed"]=padSpeeds[slowSpeed.SelectedIndex];
      }
      config["anchors"]=Enumerable.Range(0,4).Select(i=>boxes["anchor"+i].Text).ToArray();
      config["mixEnabled"]=enableMix.Checked; config["mixOnly"]=mixOnly.Checked; config["mixStepDb"]=mixStep.Value; config["mixFadeMs"]=(int)mixDuration.Value;
      config["volumeStepDb"]=volumeStep.Value;config["duckDb"]=duckLevel.Value;config["faderStep"]=1m/fadeTicks.Value;config["transitionStepMs"]=(int)transitionStep.Value;
      config["host"]="127.0.0.1"; config["port"]=(int)port.Value; Directory.CreateDirectory(Path.GetDirectoryName(settings));
      string tmp=settings+"."+Guid.NewGuid().ToString("N")+".tmp";
      try { File.WriteAllText(tmp,Json.Serialize(config),new UTF8Encoding(false)); if(File.Exists(settings)) File.Replace(tmp,settings,null); else File.Move(tmp,settings); }
      finally { if(File.Exists(tmp)) File.Delete(tmp); }
    }
    void SaveRequested() { if(PortsClash())return; try {WriteConfig(); Note(text.Get(worker==null?"saved":"savedRestart"));}catch(Exception e){Note(e.Message);} }
    /** Console has no way in from outside: no file type, no command line. Hand over the path, open Console, say what to do there. */
    void ImportPreset() {
      string path=text.PresetPath(folder);
      try { Clipboard.SetText(path); importNote.Text=text.Get("importCopied"); }
      catch(ExternalException) { importNote.Text=text.Get("importManual",path); }
      try {
        var running=Process.GetProcessesByName("TourBox Console"); bool open=running.Length>0; foreach(var one in running) one.Dispose();
        if(!open) {
          string exe=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),"TourBox Console","TourBox Console.exe");
          if(File.Exists(exe)) OpenPath(exe);
        }
      } catch(InvalidOperationException e) { Note(e.Message); }
    }
    bool PortsClash() { if(!enableVjster.Checked || port.Value!=vjsterPort.Value) return false; Note(text.Get("portsClash")); return true; }
    void OpenPath(string p) { try {Process.Start(new ProcessStartInfo(p){UseShellExecute=true});} catch(Exception e){Note(e.Message);} }
    void Note(string msg) {
      if(IsDisposed || Disposing || String.IsNullOrWhiteSpace(msg))return;
      if(InvokeRequired){try{BeginInvoke((Action)(()=>Note(msg)));}catch(InvalidOperationException){}return;}
      msg=msg.Trim(); state.Text=msg; if(hud!=null && !hud.IsDisposed)hud.Set(msg); if(activity!=null){activity.Items.Add(DateTime.Now.ToString("T")+"  "+msg); if(activity.Items.Count>180)activity.Items.RemoveAt(0); activity.TopIndex=activity.Items.Count-1;}
    }
    ProcessStartInfo Command(string args) {
      var exe=Path.Combine(folder,"FadesterTourBoxBridge.exe"); if(!File.Exists(exe))throw new FileNotFoundException(text.Get("bridgeMissing"));
      var pi=new ProcessStartInfo(exe,args) {UseShellExecute=false,CreateNoWindow=true,WorkingDirectory=folder,RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true,StandardOutputEncoding=Encoding.UTF8,StandardErrorEncoding=Encoding.UTF8};
      if(password.Text.Length!=0) pi.EnvironmentVariables["FADESTER_OBS_PASSWORD"]=password.Text;
      pi.EnvironmentVariables["FADESTER_PANEL"]="1";
      return pi;
    }
    async Task Connect() {
      if(refreshing||invalidConfig||PortsClash())return;
      refreshing=true; connect.Enabled=false; start.Enabled=false; string tmp=null;
      try {
        // A read-only discovery must not overwrite the user's saved assignments.
        tmp=Path.Combine(Path.GetTempPath(),"fadester-discover-"+Guid.NewGuid().ToString("N")+".json");
        File.WriteAllText(tmp,Json.Serialize(new {host="127.0.0.1",port=(int)port.Value}),new UTF8Encoding(false));
        using(var proc=Process.Start(Command("--catalog --config \""+tmp+"\""))){
          var output=proc.StandardOutput.ReadToEndAsync(); var error=proc.StandardError.ReadToEndAsync();
          bool done=await Task.Run(()=>proc.WaitForExit(25000)); if(!done){proc.Kill(); throw new Exception(text.Get("obsTimeout"));}
          var s=await output; var err=await error; if(proc.ExitCode!=0)throw new Exception(String.IsNullOrWhiteSpace(err)?text.Get("obsUnavailable"):err.Trim());
          var next=Decode(s); if(next==null || !next.ContainsKey("scenes"))throw new Exception(text.Get("noScenes"));
          catalog=next; LoadChoices(true);
          bool studioMode;
          string studio=Boolean.TryParse(Val(next,"studioMode"),out studioMode) ? text.Get(studioMode?"on":"off") : "—";
          live.Text=text.Get("sceneSummary",Val(next,"program","—"),Val(next,"preview","—"),studio);
          Note(text.Get(worker==null?"obsReady":"obsConnected",List(next,"scenes").Length));
        }
      }catch(Exception e){live.Text=""; Note(e.Message);}
      finally{try{if(tmp!=null && File.Exists(tmp))File.Delete(tmp);}catch(IOException){} refreshing=false; if(!IsDisposed){connect.Enabled=true; start.Enabled=true;}}
    }
    void StartControls() {
      if(PortsClash())return;
      try{
        WriteConfig(); var p=new Process {StartInfo=Command(mixOnly.Checked?"--mix-only":"--listen"),EnableRaisingEvents=true};
        p.OutputDataReceived+=(s,e)=>Note(e.Data); p.ErrorDataReceived+=(s,e)=>Note(e.Data);
        p.Exited+=delegate { try{BeginInvoke((Action)(()=>{if(worker==p){worker=null; start.Text=text.Get("saveStart"); Note(text.Get(p.ExitCode==0?"stopped":"bridgeFailed"));} Entry.Log("controls ended: "+p.ExitCode); try{p.CancelOutputRead();p.CancelErrorRead();}catch(InvalidOperationException){} p.Dispose();}));}catch(InvalidOperationException){} };
        worker=p; if(!p.Start())throw new Exception(text.Get("bridgeNotStarted")); p.BeginOutputReadLine(); p.BeginErrorReadLine(); start.Text=text.Get("stop"); Note(text.Get("starting"));
      }catch(Exception e){worker=null; start.Text=text.Get("saveStart"); Note(e.Message);}
    }
    async Task StopControls() {
      var p=worker; if(p==null)return; start.Enabled=false;
      try { p.StandardInput.WriteLine("quit"); p.StandardInput.Flush();
        bool done=await Task.Run(()=>{ try{return p.WaitForExit(8000);}catch(InvalidOperationException){return true;} });
        if(!done) Note(text.Get("finishing"));
        else if(worker==p){worker=null; start.Text=text.Get("saveStart"); Note(text.Get("stopped"));}
      }catch(InvalidOperationException){}catch(IOException){}finally{if(!IsDisposed)start.Enabled=true;}
    }
  }
  internal sealed class Feedback : Form {
    readonly Label text;
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{var cp=base.CreateParams; cp.ExStyle|=0x08000000; return cp;}}
    internal Feedback(string title) {
      Text=title; TopMost=true; ShowInTaskbar=false; StartPosition=FormStartPosition.Manual;
      FormBorderStyle=FormBorderStyle.FixedToolWindow; ClientSize=new Size(390,58); BackColor=Color.FromArgb(26,34,51);
      var screen=Screen.FromPoint(Cursor.Position).WorkingArea; Location=new Point(screen.Right-Width-14,screen.Top+14);
      text=new Label {Dock=DockStyle.Fill,Padding=new Padding(8,3,8,3),TextAlign=ContentAlignment.MiddleLeft,ForeColor=Color.White,Font=new Font("Segoe UI",10,FontStyle.Bold),AutoEllipsis=true}; Controls.Add(text);
    }
    internal void Set(string s){text.Text=s;}
  }
}
