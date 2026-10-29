param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutDir = 'D:/calcf/verify/map'
)

# 每个候选位置：清状态 → 点图标 → 找球 → 单击 → 量黄色
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
public class MAP {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Layout(IntPtr root, out int cl, out int ct, out int cw, out int chh, out int pl, out int pt, out int pw) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    cl = 0; ct = 0; cw = 0; chh = 0; pl = 0; pt = 0; pw = 0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      RECT r; GetWindowRect(c, out r);
      int w = r.Right - r.Left, h = r.Bottom - r.Top;
      if (cls.ToString() == "wxGLCanvas") { cl = r.Left; ct = r.Top; cw = w; chh = h; }
      if (cls.ToString() == "ToolbarWindow32" && w < 80 && h > 300) { pl = r.Left; pt = r.Top; pw = w; }
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

  public static string Click(IntPtr root, int sx, int sy, int count, int hold, int gap) {
    SetForegroundWindow(root); System.Threading.Thread.Sleep(150);
    SetCursorPos(sx, sy); System.Threading.Thread.Sleep(120);
    for (int i = 0; i < count; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(hold);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(gap);
    }
    System.Threading.Thread.Sleep(700);
    return "ok";
  }

  public static string Snap(int cl, int ct, int cw, int chh, string path) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
    return "ok";
  }

  public static string Focus(IntPtr root) { SetForegroundWindow(root); System.Threading.Thread.Sleep(250); return "ok"; }
  public static IntPtr Fg() { return GetForegroundWindow(); }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$h = [IntPtr]$Hwnd
$cl=0;$ct=0;$cw=0;$chh=0;$pl=0;$pt=0;$pw=0
[void][MAP]::Layout($h,[ref]$cl,[ref]$ct,[ref]$cw,[ref]$chh,[ref]$pl,[ref]$pt,[ref]$pw)
"canvas=$cl,$ct ${cw}x${chh} palette=$pl,$pt w=$pw"

$candidateYs = @(126, 186, 236, 281, 326, 371, 416, 461)
$rows = New-Object System.Collections.ArrayList

foreach ($i in 0..($candidateYs.Count - 1)) {
  $y = $candidateYs[$i]
  # 清状态：先点画布空白（左上角内侧），再 Esc
  [void][MAP]::Click($h, ($cl + 25), ($ct + 25), 1, 30, 0)
  [void][MAP]::PostMessage($h, 0x0100, [IntPtr]0x1B, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 300

  # 点候选图标
  [void][MAP]::Click($h, ($pl + [int]($pw / 2)), $y, 1, 40, 0)
  Start-Sleep -Milliseconds 300

  $c = [MAP]::BlueCentroid($cl, $ct, $cw, $chh)
  if (-not $c) {
    [void]$rows.Add('{"candidateIndex":' + $i + ',"y":' + $y + ',"result":"no-sphere"}')
    continue
  }
  $p = $c -split ';'
  $bx = [int]$p[0]; $by = [int]$p[1]
  $yBefore = [MAP]::Yellow($cl, $ct, $cw, $chh)
  [void][MAP]::Click($h, ($cl + $bx), ($ct + $by), 1, 40, 0)
  $yAfter = [MAP]::Yellow($cl, $ct, $cw, $chh)
  $img = Join-Path $OutDir ("cand$i.png")
  [void][MAP]::Snap($cl, $ct, $cw, $chh, $img)
  [void]$rows.Add('{"candidateIndex":' + $i + ',"y":' + $y + ',"sphere":"' + $bx + ',' + $by + '","yellowBefore":' + $yBefore + ',"yellowAfter":' + $yAfter + ',"fg":' + ($(if ([MAP]::Fg() -eq $h) { 'true' } else { 'false' })) + '}')
  "cand $i y=$y -> yellow $yBefore -> $yAfter"
}

$out = Join-Path $OutDir 'map.jsonl'
[System.IO.File]::WriteAllLines($out, [string[]]$rows, [System.Text.UTF8Encoding]::new($false))
"wrote $out"
