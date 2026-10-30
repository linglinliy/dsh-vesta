param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutJson = 'D:/calcf/verify/e3/e3.json',
  [int]$PaletteOffsetY = 153
)

# E3：在“已能选中”的基线上，比较「向画布句柄投递消息」与「真实点击」。
# 修正点（VESTA-LATEST-REVIEW N1）：Layout 返回 canvasHwnd；投递目标是 canvasHwnd；
# 只做一次 ScreenToClient；记录句柄/类名/PID/返回值/前台状态。
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
public class E3V {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Layout(IntPtr root, out IntPtr canvas, out IntPtr palette, out int cl, out int ct, out int cw, out int chh, out int pl, out int pt, out int pw) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    canvas = IntPtr.Zero; palette = IntPtr.Zero;
    cl = 0; ct = 0; cw = 0; chh = 0; pl = 0; pt = 0; pw = 0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      RECT r; GetWindowRect(c, out r);
      int w = r.Right - r.Left, h = r.Bottom - r.Top;
      if (cls.ToString() == "wxGLCanvas" && canvas == IntPtr.Zero) { canvas = c; cl = r.Left; ct = r.Top; cw = w; chh = h; }
      if (cls.ToString() == "ToolbarWindow32" && w < 80 && h > 300 && palette == IntPtr.Zero) { palette = c; pl = r.Left; pt = r.Top; pw = w; }
    }
    return "ok";
  }

  public static string Describe(IntPtr h) {
    var cls = new StringBuilder(64); GetClassName(h, cls, 64);
    uint pid; GetWindowThreadProcessId(h, out pid);
    RECT r; GetWindowRect(h, out r);
    return "{\"hwnd\":" + h.ToInt64() + ",\"class\":\"" + cls + "\",\"pid\":" + pid
      + ",\"visible\":" + (IsWindowVisible(h) ? "true" : "false")
      + ",\"rect\":[" + r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top) + "]}";
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

  public static string RealClick(IntPtr root, int sx, int sy, int count) {
    SetForegroundWindow(root); System.Threading.Thread.Sleep(150);
    SetCursorPos(sx, sy); System.Threading.Thread.Sleep(120);
    for (int i = 0; i < count; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero); System.Threading.Thread.Sleep(30);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(60);
    }
    System.Threading.Thread.Sleep(700);
    return "ok";
  }

  // 只做一次 ScreenToClient，然后向 canvas 句柄投递
  public static string PostedClick(IntPtr canvas, int screenX, int screenY) {
    var p = new POINT(); p.X = screenX; p.Y = screenY;
    bool ok = ScreenToClient(canvas, ref p);
    IntPtr lp = (IntPtr)((p.Y << 16) | (p.X & 0xFFFF));
    bool m = PostMessage(canvas, 0x0200, IntPtr.Zero, lp);
    bool d = PostMessage(canvas, 0x0201, (IntPtr)1, lp);
    System.Threading.Thread.Sleep(40);
    bool u = PostMessage(canvas, 0x0202, IntPtr.Zero, lp);
    System.Threading.Thread.Sleep(700);
    return "{\"client\":[" + p.X + "," + p.Y + "],\"screenToClient\":" + (ok ? "true" : "false")
      + ",\"postMove\":" + (m ? "true" : "false") + ",\"postDown\":" + (d ? "true" : "false")
      + ",\"postUp\":" + (u ? "true" : "false") + "}";
  }

  public static string Snap(int cl, int ct, int cw, int chh, string path) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
    return "ok";
  }

  public static IntPtr Fg() { return GetForegroundWindow(); }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Split-Path $OutJson) | Out-Null
$h = [IntPtr]$Hwnd
$canvas = [IntPtr]::Zero; $palette = [IntPtr]::Zero
$cl=0;$ct=0;$cw=0;$chh=0;$pl=0;$pt=0;$pw=0
[void][E3V]::Layout($h, [ref]$canvas, [ref]$palette, [ref]$cl, [ref]$ct, [ref]$cw, [ref]$chh, [ref]$pl, [ref]$pt, [ref]$pw)

$log = [ordered]@{}
$log.root = [E3V]::Describe($h) | ConvertFrom-Json
$log.canvas = [E3V]::Describe($canvas) | ConvertFrom-Json
$log.palette = [E3V]::Describe($palette) | ConvertFrom-Json

if ($canvas -eq [IntPtr]::Zero) { $log.error = 'no-canvas'; $log | ConvertTo-Json -Depth 5 | Set-Content $OutJson -Encoding UTF8; exit 2 }

# 切到 Select 候选（用工具栏自身矩形定位）
[void][E3V]::RealClick($h, ($pl + [int]($pw / 2)), ($pt + $PaletteOffsetY), 1)
Start-Sleep -Milliseconds 300

$c = [E3V]::BlueCentroid($cl, $ct, $cw, $chh)
if (-not $c) { $log.error = 'no-sphere'; $log | ConvertTo-Json -Depth 5 | Set-Content $OutJson -Encoding UTF8; exit 2 }
$p = $c -split ';'
$bx = [int]$p[0]; $by = [int]$p[1]
$sx = $cl + $bx; $sy = $ct + $by
$log.target = [ordered]@{ canvasX = $bx; canvasY = $by; screenX = $sx; screenY = $sy }
$log.fgBefore = ([E3V]::Fg() -eq $h)

$log.yellowBeforePosted = [E3V]::Yellow($cl, $ct, $cw, $chh)
$log.posted = [E3V]::PostedClick($canvas, $sx, $sy) | ConvertFrom-Json
Start-Sleep -Milliseconds 400
$log.yellowAfterPosted = [E3V]::Yellow($cl, $ct, $cw, $chh)
[void][E3V]::Snap($cl, $ct, $cw, $chh, (Join-Path (Split-Path $OutJson) 'e3-after-posted.png'))

$log.yellowBeforeReal = [E3V]::Yellow($cl, $ct, $cw, $chh)
[void][E3V]::RealClick($h, $sx, $sy, 1)
$log.yellowAfterReal = [E3V]::Yellow($cl, $ct, $cw, $chh)
[void][E3V]::Snap($cl, $ct, $cw, $chh, (Join-Path (Split-Path $OutJson) 'e3-after-real.png'))

$log | ConvertTo-Json -Depth 6 | Set-Content $OutJson -Encoding UTF8
$log | ConvertTo-Json -Depth 6
