param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutDir = 'D:/calcf/verify/e4'
)

# DPI 感知 + 选中一个球并保存前后截图（只做选择，不删除）
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
public class SEL1 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Canvas(IntPtr root, out int cl, out int ct, out int cw, out int chh) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    cl = 0; ct = 0; cw = 0; chh = 0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      if (cls.ToString() != "wxGLCanvas") continue;
      RECT r; GetWindowRect(c, out r);
      cl = r.Left; ct = r.Top; cw = r.Right - r.Left; chh = r.Bottom - r.Top;
    }
    return "ok";
  }

  public static string BlueCentroid(int cl, int ct, int cw, int chh) {
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

  public static int Yellow(int cl, int ct, int cw, int chh) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    int n = 0;
    for (int yy = 0; yy < chh; yy++) {
      for (int xx = 0; xx < cw; xx++) {
        var c = bmp.GetPixel(xx, yy);
        if (c.R > 150 && c.G > 120 && c.B < 160 && (c.R - c.B) > 35 && (c.G - c.B) > 15) n++;
      }
    }
    bmp.Dispose();
    return n;
  }

  public static string Snap(int cl, int ct, int cw, int chh, string path) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
    return "ok";
  }

  public static string Click(IntPtr root, int sx, int sy, int count) {
    SetForegroundWindow(root); System.Threading.Thread.Sleep(200);
    SetCursorPos(sx, sy); System.Threading.Thread.Sleep(150);
    for (int i = 0; i < count; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(30);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(60);
    }
    System.Threading.Thread.Sleep(700);
    return "ok";
  }
  public static string Dbl(IntPtr root, int sx, int sy) {
    SetForegroundWindow(root); System.Threading.Thread.Sleep(200);
    SetCursorPos(sx, sy); System.Threading.Thread.Sleep(150);
    for (int i = 0; i < 2; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(30);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      if (i == 0) System.Threading.Thread.Sleep(60);
    }
    System.Threading.Thread.Sleep(800);
    return "ok";
  }

  public static string Hit(IntPtr root, int sx, int sy) {
    var p = new POINT(); p.X = sx; p.Y = sy;
    IntPtr hit = WindowFromPoint(p);
    return "hit=" + hit.ToInt64() + " inside=" + (GetAncestor(hit, 2) == root);
  }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$h = [IntPtr]$Hwnd
$cl = 0; $ct = 0; $cw = 0; $chh = 0
[void][SEL1]::Canvas($h, [ref]$cl, [ref]$ct, [ref]$cw, [ref]$chh)
"canvas=$cl,$ct ${cw}x${chh}"

$c = [SEL1]::BlueCentroid($cl, $ct, $cw, $chh)
"centroid=$c"
if (-not $c) { exit 1 }
$p = $c -split ';'
$bx = [int]$p[0]; $by = [int]$p[1]
$sx = $cl + $bx; $sy = $ct + $by

$before = Join-Path $OutDir 'e4-before.png'
$after = Join-Path $OutDir 'e4-selected.png'
[void][SEL1]::Snap($cl, $ct, $cw, $chh, $before)
$yBefore = [SEL1]::Yellow($cl, $ct, $cw, $chh)
"hit: " + [SEL1]::Hit($h, $sx, $sy)
"fg: " + ([SEL1]::GetForegroundWindow() -eq $h)
[void][SEL1]::Click($h, $sx, $sy, 1)
$y1 = [SEL1]::Yellow($cl, $ct, $cw, $chh)
if ($y1 -eq 0) {
  [void][SEL1]::Click($h, $sx, $sy, 2)
  $y1 = [SEL1]::Yellow($cl, $ct, $cw, $chh)
  "tried: single then double"
} else { "tried: single" }
[void][SEL1]::Snap($cl, $ct, $cw, $chh, $after)
$yAfter = [SEL1]::Yellow($cl, $ct, $cw, $chh)
"yellow: $yBefore -> $y1 -> $yAfter | screen=$sx,$sy"
