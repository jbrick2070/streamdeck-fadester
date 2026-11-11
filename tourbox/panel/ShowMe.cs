// SPDX-License-Identifier: GPL-2.0-or-later
// The readiness lights in the panel's header, the reminders under them, and the "Show me" animations they open.
using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
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
      if (connected)
        return studioOff && !controlsOn ? new LightState(Lamp.Amber, "liObsStudio", "btnShowMe", "studio") : new LightState(Lamp.Green, "liObsOn", null, null);
      if (!running) return new LightState(Lamp.Red, "liObsClosed", null, null);
      if (problem == "obs-bad-password") return new LightState(Lamp.Amber, "liObsPassword", "btnShowMe", "password");
      if (problem == null) return new LightState(Lamp.Grey, "liObsLooking", null, null); // OBS is starting, or a scan is under way
      return new LightState(Lamp.Amber, "liObsSetting", "btnShowMe", "server");
    }
    internal static LightState Pad(bool enabled, bool mixOnly, bool controlsOn, string padState, bool padSeen) {
      if (mixOnly) return new LightState(Lamp.Grey, "liPadOff", null, null);
      if (!enabled) return padSeen ? new LightState(Lamp.Amber, "liPadIdle", "btnUseIt", "usePad") : new LightState(Lamp.Grey, "liPadOff", null, null);
      if (controlsOn) return padState == "stPadOn" ? new LightState(Lamp.Green, "liPadOn", null, null) : new LightState(Lamp.Amber, "liPadMissing", null, null);
      return padSeen ? new LightState(Lamp.Green, "liPadReady", null, null) : new LightState(Lamp.Amber, "liPadMissing", null, null);
    }
    internal static LightState Controls(bool on) {
      return on ? new LightState(Lamp.Green, "liCtlOn", null, null) : new LightState(Lamp.Grey, "liCtlOff", "btnStart", "start");
    }
    /** The one reminder worth a strip while the controls run, or null. The T-bar needs OBS's main window; a TourBox preset needs OBS in front. */
    internal static string Reminder(bool controlsOn, bool mixOnly, bool obsHidden, bool tourboxConsole, string front) {
      if (!controlsOn || mixOnly) return null;
      if (obsHidden) return "remindObsOpen";
      if (tourboxConsole && !IsObs(front)) return "remindObsFront";
      return null;
    }
    internal static bool IsObs(string process) {
      return String.Equals(process, "obs64", StringComparison.OrdinalIgnoreCase) || String.Equals(process, "obs", StringComparison.OrdinalIgnoreCase);
    }
    internal static void Test() {
      Func<LightState, string> s = l => l.Lamp + " " + l.Text + " " + (l.Action ?? "-");
      if (s(Obs(true, true, null, false, false)) != "Green liObsOn -" || s(Obs(true, true, null, true, false)) != "Amber liObsStudio studio" ||
          s(Obs(true, true, null, true, true)) != "Green liObsOn -" || s(Obs(false, false, null, false, false)) != "Red liObsClosed -" ||
          s(Obs(false, true, "obs-no-answer", false, false)) != "Amber liObsSetting server" ||
          s(Obs(false, true, "obs-bad-password", false, false)) != "Amber liObsPassword password" ||
          s(Obs(false, true, null, false, false)) != "Grey liObsLooking -")
        throw new InvalidOperationException("OBS light");
      if (s(Pad(false, false, false, "stPadOff", true)) != "Amber liPadIdle usePad" || s(Pad(false, false, false, "stPadOff", false)) != "Grey liPadOff -" ||
          s(Pad(true, false, true, "stPadOn", false)) != "Green liPadOn -" || s(Pad(true, false, true, "stPadMissing", true)) != "Amber liPadMissing -" ||
          s(Pad(true, false, false, "stPadOff", true)) != "Green liPadReady -" || s(Pad(true, true, true, "stPadOn", true)) != "Grey liPadOff -")
        throw new InvalidOperationException("Controller light");
      if (s(Controls(false)) != "Grey liCtlOff start" || s(Controls(true)) != "Green liCtlOn -") throw new InvalidOperationException("Controls light");
      if (Reminder(false, false, true, true, "x") != null || Reminder(true, true, true, true, "x") != null ||
          Reminder(true, false, true, true, "obs64") != "remindObsOpen" || Reminder(true, false, false, true, "chrome") != "remindObsFront" ||
          Reminder(true, false, false, true, "obs64") != null || Reminder(true, false, false, false, "chrome") != null)
        throw new InvalidOperationException("Reminder");
    }
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

    internal ShowMeClip(string mode, PanelText text) {
      this.mode = mode; this.text = text;
      SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
      Size = new Size(520, 250); BackColor = Color.White; AccessibleRole = AccessibleRole.Animation;
      timer.Tick += delegate { Invalidate(); };
      timer.Start();
    }
    protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }

    float Length { get { return mode == "studio" ? 8.5f : mode == "password" ? 9.5f : 9f; } }
    static float Ease(float t, float a, float b) { if (t <= a) return 0; if (t >= b) return 1; float x = (t - a) / (b - a); return x * x * (3 - 2 * x); }
    static PointF Mix(PointF p, PointF q, float k) { return new PointF(p.X + (q.X - p.X) * k, p.Y + (q.Y - p.Y) * k); }

    /** A moment to draw instead of the running clock, for still pictures of the animation (Store art, checks). */
    internal float FixedTime = -1;

    protected override void OnPaint(PaintEventArgs e) {
      var g = e.Graphics; g.SmoothingMode = SmoothingMode.AntiAlias; g.Clear(BackColor);
      float t = FixedTime >= 0 ? FixedTime : (float)(clock.Elapsed.TotalSeconds % Length);
      if (mode == "studio") Studio(g, t); else Server(g, t, mode == "password");
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
    internal ShowMeWindow(PanelText text, string mode, string problem, Action checkAgain) {
      Text = text.Get(mode == "studio" ? "showStudioTitle" : mode == "password" ? "showPasswordTitle" : "showServerTitle");
      FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false; ShowInTaskbar = false;
      StartPosition = FormStartPosition.CenterParent; BackColor = Color.White; Font = new Font("Segoe UI", 10);
      AutoScaleMode = AutoScaleMode.None;
      var flow = new FlowLayoutPanel { Location = new Point(0, 0), FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(20, 16, 20, 12), AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
      flow.Controls.Add(new ShowMeClip(mode, text) { Margin = new Padding(0, 0, 0, 12) });
      string key = mode == "studio" ? "showStudioHint" : mode == "password" ? "obsBadPassword"
        : problem == "obs-no-password" ? "obsNoPassword" : problem == "obs-auth-off" ? "obsAuthOff" : "obsNoAnswer";
      flow.Controls.Add(new Label { Text = text.Get(key), AutoSize = true, MaximumSize = new Size(520, 0), UseMnemonic = false, Margin = new Padding(0, 0, 0, 14) });
      var buttons = new FlowLayoutPanel { AutoSize = false, Size = new Size(520, 38), FlowDirection = FlowDirection.RightToLeft, WrapContents = false, Margin = new Padding(0) };
      var close = new Button { Text = text.Get("btnClose"), AutoSize = true, Height = 32, Padding = new Padding(6, 0, 6, 0), UseMnemonic = false };
      close.Click += delegate { Close(); };
      var again = new Button { Text = text.Get("discover"), AutoSize = true, Height = 32, Padding = new Padding(6, 0, 6, 0), UseMnemonic = false,
        BackColor = Color.FromArgb(38, 90, 158), ForeColor = Color.White, FlatStyle = FlatStyle.Flat };
      again.Click += delegate { Close(); checkAgain(); };
      buttons.Controls.Add(close); buttons.Controls.Add(again);
      flow.Controls.Add(buttons);
      Controls.Add(flow);
      AutoSize = true; AutoSizeMode = AutoSizeMode.GrowAndShrink;
      CancelButton = close; AcceptButton = again;
    }
  }
}
