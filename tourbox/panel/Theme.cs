// SPDX-License-Identifier: GPL-2.0-or-later
// The panel in dark colours when Windows is set to dark app mode (Settings → Personalisation → Colours → "Choose your
// default app mode"), so it is not a white window in a dark room. Read once when the panel opens; --theme dark or
// --theme light chooses it by hand. The light panel is untouched: every change here happens only when Dark is set.
// The header, the feedback window and the blue and red buttons are the same in both. The Show-me guide windows keep
// their own light card, as on the Mac.
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace Fadester.TourBox {
  internal static class Theme {
    internal static bool Dark;
    internal static readonly Color Back = Color.FromArgb(30, 33, 40), Strip = Color.FromArgb(44, 50, 63), Field = Color.FromArgb(42, 46, 56),
      Raised = Color.FromArgb(56, 62, 76), Line = Color.FromArgb(84, 92, 108), Text = Color.FromArgb(226, 232, 244), Dim = Color.FromArgb(160, 168, 184),
      Ink = Color.FromArgb(226, 232, 244), AccentText = Color.FromArgb(128, 176, 240), AmberBack = Color.FromArgb(84, 62, 14),
      AmberText = Color.FromArgb(255, 220, 150), Selected = Color.FromArgb(38, 90, 158);
    /** A cell that cannot be edited (the game controller's LB while it is the shift button). */
    internal static Color LockedCell { get { return Dark ? Color.FromArgb(62, 66, 78) : Color.Gainsboro; } }

    /** --theme dark, --theme light (or --theme=...), else what Windows says. High contrast keeps Windows' own colours. */
    internal static void Choose(string[] args) {
      string asked = null;
      for (int i = 0; i < args.Length; i++) {
        if (args[i].Equals("--theme", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length) asked = args[i + 1];
        else if (args[i].StartsWith("--theme=", StringComparison.OrdinalIgnoreCase)) asked = args[i].Substring("--theme=".Length);
      }
      if (asked != null && asked.Equals("dark", StringComparison.OrdinalIgnoreCase)) { Dark = true; return; }
      if (asked != null && asked.Equals("light", StringComparison.OrdinalIgnoreCase)) { Dark = false; return; }
      Dark = !SystemInformation.HighContrast && AppsUseDark(ReadAppsUseLightTheme());
    }
    /** Windows writes 0 for dark app mode; anything else, or no value (Windows before 10 1607), is light. */
    internal static bool AppsUseDark(object appsUseLightTheme) { return appsUseLightTheme is int && (int)appsUseLightTheme == 0; }
    static object ReadAppsUseLightTheme() {
      try {
        using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")) {
          return key == null ? null : key.GetValue("AppsUseLightTheme");
        }
      } catch (Exception) { return null; }
    }

    [DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] static extern int SetWindowTheme(IntPtr window, string app, string ids);
    [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);

    /** Dark scroll bars and, for a window, a dark title bar. Older Windows refuses: the control then keeps its light ones. */
    static void DarkChrome(Control c) {
      Action set = delegate {
        try {
          SetWindowTheme(c.Handle, "DarkMode_Explorer", null);
          if (c is Form) { int on = 1; if (DwmSetWindowAttribute(c.Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(c.Handle, 19, ref on, 4); }
        } catch (Exception) { }
      };
      if (c.IsHandleCreated) set();
      c.HandleCreated += delegate { set(); };
    }

    static void DrawChoice(object sender, DrawItemEventArgs e) {
      var combo = (ComboBox)sender;
      bool chosen = (e.State & DrawItemState.Selected) != 0 && (e.State & DrawItemState.ComboBoxEdit) == 0;
      using (var fill = new SolidBrush(chosen ? Selected : Field)) e.Graphics.FillRectangle(fill, e.Bounds);
      if (e.Index >= 0 && e.Index < combo.Items.Count)
        TextRenderer.DrawText(e.Graphics, combo.GetItemText(combo.Items[e.Index]), combo.Font, e.Bounds, chosen ? Color.White : (combo.Enabled ? Text : Dim),
          TextFormatFlags.Left | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.EndEllipsis | TextFormatFlags.SingleLine);
      if ((e.State & DrawItemState.Focus) != 0 && (e.State & DrawItemState.NoFocusRect) == 0) e.DrawFocusRectangle();
    }

    static bool Is(Color a, Color b) { return a.ToArgb() == b.ToArgb(); }

    /** Recolours a finished window. navy and accent are the panel's own two colours: text in them is made readable on dark. */
    internal static void Apply(Control root, Color navy, Color accent, Color stop) {
      if (!Dark) return;
      var form = root as Form;
      if (form != null) { form.BackColor = Back; form.ForeColor = Text; }
      Paint(root, navy, accent, stop);
    }
    static void Paint(Control c, Color navy, Color accent, Color stop) {
      var label = c as Label; var button = c as Button; var grid = c as DataGridView; var combo = c as ComboBox; var page = c as TabPage;
      if (label != null) {
        var link = c as LinkLabel;
        if (link != null) { link.LinkColor = AccentText; link.ActiveLinkColor = Text; }
        if (Is(label.ForeColor, navy)) label.ForeColor = Ink;
        else if (Is(label.ForeColor, accent)) label.ForeColor = AccentText;
        else if (Is(label.ForeColor, Color.FromArgb(90, 98, 112))) label.ForeColor = Dim;
        else if (Is(label.ForeColor, Color.FromArgb(107, 74, 0))) { label.ForeColor = AmberText; label.BackColor = AmberBack; }
      } else if (button != null) {
        // The blue and red buttons stay as they are; the plain ones lose Windows' light button face.
        if (!(button.FlatStyle == FlatStyle.Flat && (Is(button.BackColor, accent) || Is(button.BackColor, stop)))) {
          button.FlatStyle = FlatStyle.Flat; button.UseVisualStyleBackColor = false; button.BackColor = Raised; button.ForeColor = Text;
          button.FlatAppearance.BorderColor = Line; button.FlatAppearance.BorderSize = 1;
        }
      } else if (grid != null) {
        grid.BackgroundColor = Back; grid.GridColor = Line; grid.BorderStyle = BorderStyle.FixedSingle; grid.EnableHeadersVisualStyles = false;
        grid.DefaultCellStyle.BackColor = Field; grid.DefaultCellStyle.ForeColor = Text;
        grid.DefaultCellStyle.SelectionBackColor = Selected; grid.DefaultCellStyle.SelectionForeColor = Color.White;
        grid.ColumnHeadersDefaultCellStyle.BackColor = Strip; grid.ColumnHeadersDefaultCellStyle.ForeColor = Text;
        grid.ColumnHeadersDefaultCellStyle.SelectionBackColor = Strip; grid.ColumnHeadersDefaultCellStyle.SelectionForeColor = Text;
        grid.ColumnHeadersBorderStyle = DataGridViewHeaderBorderStyle.Single;
        DarkChrome(grid);
      } else if (combo != null) {
        // Windows paints a drop-down list's own field white whatever BackColor says, so the panel draws the items itself.
        combo.FlatStyle = FlatStyle.Flat; combo.BackColor = Field; combo.ForeColor = Text;
        if (combo.DrawMode == DrawMode.Normal) { combo.DrawMode = DrawMode.OwnerDrawFixed; combo.DrawItem += DrawChoice; }
      } else if (c is TextBox) {
        ((TextBox)c).BorderStyle = BorderStyle.FixedSingle; c.BackColor = Field; c.ForeColor = Text;
      } else if (c is NumericUpDown) {
        ((NumericUpDown)c).BorderStyle = BorderStyle.FixedSingle; c.BackColor = Field; c.ForeColor = Text; DarkChrome(c);
      } else if (c is ListBox) {
        c.BackColor = Field; c.ForeColor = Text; DarkChrome(c);
      } else if (page != null) {
        page.UseVisualStyleBackColor = false; page.BackColor = Back; page.ForeColor = Text;
      } else if (c is CheckBox) {
        c.ForeColor = Text;
      } else if (c is ScrollableControl || c is ScrollBar) {
        if (Is(c.BackColor, Color.White)) c.BackColor = Back;
        else if (Is(c.BackColor, Color.FromArgb(241, 244, 249))) c.BackColor = Strip;
        else if (Is(c.BackColor, Color.FromArgb(255, 241, 214))) c.BackColor = AmberBack;
        DarkChrome(c);
      }
      foreach (Control child in c.Controls) Paint(child, navy, accent, stop);
    }

    internal static void Test() {
      if (!AppsUseDark(0) || AppsUseDark(1) || AppsUseDark(null) || AppsUseDark("0")) throw new Exception("theme: Windows' app mode");
      bool was = Dark;
      try {
        Choose(new[] { "--theme", "dark" }); if (!Dark) throw new Exception("theme: --theme dark");
        Choose(new[] { "--theme=light" }); if (Dark) throw new Exception("theme: --theme=light");
        // Dark: navy text becomes readable, a plain button loses the light face, the blue button stays blue.
        Dark = true;
        Color navy = Color.FromArgb(26, 34, 51), accent = Color.FromArgb(38, 90, 158), stop = Color.FromArgb(184, 52, 44);
        using (var host = new Panel { BackColor = Color.White }) {
          var title = new Label { ForeColor = navy }; var plain = new Button(); var go = new Button { FlatStyle = FlatStyle.Flat, BackColor = accent, ForeColor = Color.White };
          var box = new TextBox(); host.Controls.Add(title); host.Controls.Add(plain); host.Controls.Add(go); host.Controls.Add(box);
          Apply(host, navy, accent, stop);
          if (!Is(host.BackColor, Back) || !Is(title.ForeColor, Ink) || !Is(plain.BackColor, Raised) || !Is(go.BackColor, accent) || !Is(box.BackColor, Field))
            throw new Exception("theme: dark colours");
        }
        // Light: nothing is touched.
        Dark = false;
        using (var host = new Panel { BackColor = Color.White }) {
          var title = new Label { ForeColor = navy }; host.Controls.Add(title);
          Apply(host, navy, accent, stop);
          if (!Is(host.BackColor, Color.White) || !Is(title.ForeColor, navy)) throw new Exception("theme: light is left alone");
        }
      } finally { Dark = was; }
    }
  }

  /// The tab strip, drawn by the panel in dark mode: Windows draws its own tab strip light whatever the colours set.
  internal sealed class DarkTabs : TabControl {
    internal DarkTabs() {
      SetStyle(ControlStyles.UserPaint | ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
    }
    protected override void OnPaintBackground(PaintEventArgs e) { }
    protected override void OnPaint(PaintEventArgs e) {
      e.Graphics.Clear(Theme.Back);
      if (TabCount == 0) return;
      // The page's frame, then the tabs over its top edge.
      var frame = DisplayRectangle; frame.Inflate(3, 3);
      using (var pen = new Pen(Theme.Line)) {
        e.Graphics.DrawRectangle(pen, frame.Left, frame.Top, frame.Width - 1, frame.Height - 1);
        for (int i = 0; i < TabCount; i++) {
          var tab = GetTabRect(i); bool chosen = i == SelectedIndex;
          if (!chosen) tab = new Rectangle(tab.Left, tab.Top + 2, tab.Width, tab.Height - 2);
          using (var fill = new SolidBrush(chosen ? Theme.Back : Theme.Strip)) e.Graphics.FillRectangle(fill, tab);
          e.Graphics.DrawLine(pen, tab.Left, tab.Bottom, tab.Left, tab.Top); e.Graphics.DrawLine(pen, tab.Left, tab.Top, tab.Right, tab.Top);
          e.Graphics.DrawLine(pen, tab.Right, tab.Top, tab.Right, tab.Bottom);
          if (!chosen) e.Graphics.DrawLine(pen, tab.Left, tab.Bottom, tab.Right, tab.Bottom);
          TextRenderer.DrawText(e.Graphics, TabPages[i].Text, Font, tab, chosen ? Theme.Text : Theme.Dim,
            TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
          if (chosen && Focused && ShowFocusCues) { var cue = tab; cue.Inflate(-4, -4); ControlPaint.DrawFocusRectangle(e.Graphics, cue, Theme.Text, Theme.Back); }
        }
      }
    }
    protected override void OnSelectedIndexChanged(EventArgs e) { base.OnSelectedIndexChanged(e); Invalidate(); }
    protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
    protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }
  }
}
