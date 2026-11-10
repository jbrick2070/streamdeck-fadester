# SPDX-License-Identifier: GPL-2.0-or-later
# Opens the companion's panel, captures each of its tabs as a PNG for the Store screenshots, and closes it again.
# It saves nothing and starts no controls; on opening the panel only reads the scene list from OBS.
#   .\capture-panel.ps1 -Panel "...\Fadester for TourBox.exe" -OutDir captures
param([Parameter(Mandatory)][string]$Panel, [Parameter(Mandatory)][string]$OutDir)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class PanelShot {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc f, IntPtr l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  // The WinForms tab strip is a SysTabControl32; UI Automation only sees panes in this window.
  public static IntPtr FindTabs(IntPtr window) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(window, (h, l) => { var s = new System.Text.StringBuilder(256); GetClassName(h, s, 256);
      if (s.ToString().Contains("SysTabControl32")) { found = h; return false; } return true; }, IntPtr.Zero);
    return found;
  }
}
"@

$out = if ([IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path (Get-Location).Path $OutDir }
New-Item -ItemType Directory -Force -Path $out | Out-Null
$process = Start-Process -FilePath $Panel -PassThru
try {
  for ($i = 0; $i -lt 150 -and $process.MainWindowHandle -eq 0; $i++) { Start-Sleep -Milliseconds 100; $process.Refresh() }
  if ($process.MainWindowHandle -eq 0) { throw 'The panel window did not appear.' }
  Start-Sleep -Seconds 4 # it reads the scene list from OBS
  $handle = $process.MainWindowHandle
  $strip = [PanelShot]::FindTabs($handle)
  if ($strip -eq [IntPtr]::Zero) { throw 'The panel has no tab strip.' }
  $count = [int][PanelShot]::SendMessage($strip, 0x1304, [IntPtr]::Zero, [IntPtr]::Zero) # TCM_GETITEMCOUNT
  for ($n = 1; $n -le $count; $n++) {
    # TCM_SETCURFOCUS selects the tab the way a click does, with the notifications WinForms needs to show the page.
    [PanelShot]::SendMessage($strip, 0x1330, [IntPtr]($n - 1), [IntPtr]::Zero) | Out-Null
    Start-Sleep -Milliseconds 700
    $rect = New-Object PanelShot+RECT
    [PanelShot]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $bitmap = New-Object Drawing.Bitmap ($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $dc = $graphics.GetHdc()
    [PanelShot]::PrintWindow($handle, $dc, 2) | Out-Null # PW_RENDERFULLCONTENT
    $graphics.ReleaseHdc($dc); $graphics.Dispose()
    # PrintWindow includes the window's invisible resize borders, which come out black: trim them.
    function Dark($c) { $c.R -lt 40 -and $c.G -lt 40 -and $c.B -lt 40 }
    $left = 0; $right = $bitmap.Width - 1; $bottom = $bitmap.Height - 1; $mid = [int]($bitmap.Height / 2)
    while ($left -lt 20 -and (Dark $bitmap.GetPixel($left, $mid))) { $left++ }
    while ($right -gt $bitmap.Width - 20 -and (Dark $bitmap.GetPixel($right, $mid))) { $right-- }
    while ($bottom -gt $bitmap.Height - 20 -and (Dark $bitmap.GetPixel([int]($bitmap.Width / 2), $bottom))) { $bottom-- }
    $trimmed = $bitmap.Clone((New-Object Drawing.Rectangle $left, 0, ($right - $left + 1), ($bottom + 1)), $bitmap.PixelFormat)
    $bitmap.Dispose()
    $file = Join-Path $out ("panel-{0}.png" -f $n)
    $trimmed.Save($file, [Drawing.Imaging.ImageFormat]::Png); $trimmed.Dispose()
    Write-Host "Captured $file"
  }
}
finally { if (-not $process.HasExited) { $process.CloseMainWindow() | Out-Null; if (-not $process.WaitForExit(3000)) { $process.Kill() } } }
