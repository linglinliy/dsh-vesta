param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutJson = 'D:/calcf/verify/e4/sphere.json'
)

# 只做观测：返回窗口/画布/工具栏矩形与最大蓝色球心（不点击、不改布局）
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DpiFix {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int v);
  public static string Enable() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor-v2"; } catch { }
    try { if (SetProcessDpiAwareness(2) == 0) return "per-monitor"; } catch { }
    return "unaware";
  }
}
'@ -ErrorAction SilentlyContinue
[void][DpiFix]::Enable()

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SPH {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Look(int cl, int ct, int cw, int chh) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    var sx = new List<long>(); var sy = new List<long>(); var cnt = new List<int>();
    for (int yy = 0; yy < chh; yy += 2) {
      for (int xx = 0; xx < cw; xx += 2) {
        var c = bmp.GetPixel(xx, yy);
        if ((c.B - c.R) > 90 && (c.B - c.G) > 50 && c.B > 120) {
          int bi = -1; long bd = long.MaxValue;
          for (int i = 0; i < sx.Count; i++) {
            long dx = sx[i] / cnt[i] - xx, dy = sy[i] / cnt[i] - yy; long d = dx * dx + dy * dy;
            if (d < bd) { bd = d; bi = i; }
          }
          if (bi >= 0 && bd < 900) { sx[bi] += xx; sy[bi] += yy; cnt[bi]++; }
          else { sx.Add(xx); sy.Add(yy); cnt.Add(1); }
        }
      }
    }
    bmp.Dispose();
    int best = -1, bestN = 0;
    for (int i = 0; i < cnt.Count; i++) { if (cnt[i] > bestN) { bestN = cnt[i]; best = i; } }
    if (best < 0 || bestN < 60) return "";
    return (sx[best] / cnt[best]) + ";" + (sy[best] / cnt[best]);
  }

  public static string Rects(IntPtr root,
    out IntPtr canvasHwnd, out IntPtr paletteHwnd,
    out int cl, out int ct, out int cw, out int chh,
    out int wl, out int wt,
    out int pl, out int pt, out int pw, out int ph) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    RECT wr; GetWindowRect(root, out wr);
    wl = wr.Left; wt = wr.Top;
    canvasHwnd = IntPtr.Zero; paletteHwnd = IntPtr.Zero;
    cl = 0; ct = 0; cw = 0; chh = 0; pl = 0; pt = 0; pw = 0; ph = 0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      RECT r; GetWindowRect(c, out r);
      int w = r.Right - r.Left, h = r.Bottom - r.Top;
      if (cls.ToString() == "wxGLCanvas" && canvasHwnd == IntPtr.Zero) {
        canvasHwnd = c; cl = r.Left; ct = r.Top; cw = w; chh = h;
      }
      if (cls.ToString() == "ToolbarWindow32" && w < 80 && h > 300 && paletteHwnd == IntPtr.Zero) {
        paletteHwnd = c; pl = r.Left; pt = r.Top; pw = w; ph = h;
      }
    }
    return "ok";
  }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Split-Path $OutJson) | Out-Null
$h = [IntPtr]$Hwnd
$canvasHwnd = [IntPtr]::Zero; $paletteHwnd = [IntPtr]::Zero
$cl=0;$ct=0;$cw=0;$chh=0;$wl=0;$wt=0;$pl=0;$pt=0;$pw=0;$ph=0
[void][SPH]::Rects($h, [ref]$canvasHwnd, [ref]$paletteHwnd,
  [ref]$cl, [ref]$ct, [ref]$cw, [ref]$chh,
  [ref]$wl, [ref]$wt, [ref]$pl, [ref]$pt, [ref]$pw, [ref]$ph)

[void][SPH]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 350
$fgOk = ([SPH]::GetForegroundWindow() -eq $h)
if (-not $fgOk) { "{""error"":""not-foreground""}" | Set-Content $OutJson -Encoding UTF8; exit 3 }
$c = [SPH]::Look($cl, $ct, $cw, $chh)
$out = [ordered]@{
  foreground = $true
  window = @{ left = $wl; top = $wt }
  canvas = @{ hwnd = $canvasHwnd.ToInt64(); left = $cl; top = $ct; width = $cw; height = $chh }
  palette = @{ hwnd = $paletteHwnd.ToInt64(); left = $pl; top = $pt; width = $pw; height = $ph }
  sphere = if ($c) { $parts = $c -split ';'; @{ canvasX = [int]$parts[0]; canvasY = [int]$parts[1]; screenX = ($cl + [int]$parts[0]); screenY = ($ct + [int]$parts[1]) } } else { $null }
}
$out | ConvertTo-Json -Depth 5 | Set-Content $OutJson -Encoding UTF8
$out | ConvertTo-Json -Depth 5
