param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutJson = 'D:/calcf/verify/trials.json',
  [int]$WindowW = 1200,
  [int]$WindowH = 760,
  [int]$WindowX = 10,
  [int]$WindowY = 10
)

# Performs geometry measurement (E1) and selection trials (E2/E3) against a running VESTA,
# writing one JSON object per trial. Pixel analysis is done here; structure checks are done in Node.

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Text;
using System.Drawing;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class VT {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Post(IntPtr h, uint m, int w) { PostMessage(h, m, (IntPtr)w, IntPtr.Zero); return "ok"; }
  public static int ScreenW() { return GetSystemMetrics(0); }
  public static int ScreenH() { return GetSystemMetrics(1); }

  public static string Setup(IntPtr root, int w, int h, int x, int y) {
    if (IsIconic(root)) ShowWindow(root, 9);
    System.Threading.Thread.Sleep(250);
    SetWindowPos(root, IntPtr.Zero, x, y, w, h, 0x0040);
    System.Threading.Thread.Sleep(500);
    SetForegroundWindow(root);
    System.Threading.Thread.Sleep(350);
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    var sb = new StringBuilder();
    RECT wr; GetWindowRect(root, out wr);
    string canvas = "none";
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      if (cls.ToString() != "wxGLCanvas") continue;
      RECT r; GetWindowRect(c, out r);
      canvas = c.ToInt64() + "|" + r.Left + "|" + r.Top + "|" + (r.Right - r.Left) + "|" + (r.Bottom - r.Top);
    }
    return "{\"window\":\"" + wr.Left + "," + wr.Top + "," + (wr.Right - wr.Left) + "," + (wr.Bottom - wr.Top)
      + "\",\"dpi\":" + GetDpiForWindow(root) + ",\"canvas\":\"" + canvas + "\",\"screen\":\"" + ScreenW() + "x" + ScreenH() + "\"}";
  }

  public static string Hit(IntPtr root, int sx, int sy) {
    var p = new POINT(); p.X = sx; p.Y = sy;
    IntPtr hit = WindowFromPoint(p);
    IntPtr r = GetAncestor(hit, 2);
    return "{\"hit\":" + hit.ToInt64() + ",\"inside\":" + ((r == root) ? "true" : "false") + "}";
  }

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

  public static string Palette(IntPtr root, out int pl, out int pt, out int pw, out int ph) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    pl = 0; pt = 0; pw = 0; ph = 0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      if (cls.ToString() != "ToolbarWindow32") continue;
      RECT r; GetWindowRect(c, out r);
      int w = r.Right - r.Left, h = r.Bottom - r.Top;
      if (w < 60 && h > 300) { pl = r.Left; pt = r.Top; pw = w; ph = h; }
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
    return (sx[best] / cnt[best]) + ";" + (sy[best] / cnt[best]) + ";" + bestN;
  }

  public static string Click(IntPtr root, int sx, int sy, int count, int holdMs, int gapMs) {
    SetForegroundWindow(root);
    System.Threading.Thread.Sleep(120);
    SetCursorPos(sx, sy);
    System.Threading.Thread.Sleep(100);
    for (int i = 0; i < count; i++) {
      mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(holdMs);
      mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
      if (i + 1 < count) System.Threading.Thread.Sleep(gapMs);
    }
    System.Threading.Thread.Sleep(700);
    return "ok";
  }

  // 只抓一帧画布（点击前/点击后各调用一次）
  public static string Snap(int cl, int ct, int cw, int chh, string path) {
    var bmp = new Bitmap(cw, chh);
    using (var g = Graphics.FromImage(bmp)) { g.CopyFromScreen(cl, ct, 0, 0, new Size(cw, chh)); }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
    return "ok";
  }

  public static string FullDiff(string beforePath, string afterPath) {
    var a = new Bitmap(beforePath);
    var b = new Bitmap(afterPath);
    int diff = 0, total = 0;
    for (int y = 0; y < a.Height; y += 3) {
      for (int x = 0; x < a.Width; x += 3) {
        var pa = a.GetPixel(x, y); var pb = b.GetPixel(x, y);
        total++;
        if (Math.Abs(pa.R - pb.R) > 25 || Math.Abs(pa.G - pb.G) > 25 || Math.Abs(pa.B - pb.B) > 25) diff++;
      }
    }
    a.Dispose(); b.Dispose();
    double ratio = total == 0 ? 0 : (double)diff / total;
    return ratio.ToString("F4");
  }
  public static string LocalStats(string beforePath, string afterPath, int bx, int by, int box) {
    var a = new Bitmap(beforePath);
    var b = new Bitmap(afterPath);
    int x0 = Math.Max(0, bx - box / 2), y0 = Math.Max(0, by - box / 2);
    int x1 = Math.Min(a.Width - 1, x0 + box), y1 = Math.Min(a.Height - 1, y0 + box);
    int diff = 0, total = 0, yellowB = 0, yellowA = 0;
    for (int y = y0; y < y1; y++) {
      for (int x = x0; x < x1; x++) {
        var pa = a.GetPixel(x, y); var pb = b.GetPixel(x, y);
        total++;
        if (Math.Abs(pa.R - pb.R) > 25 || Math.Abs(pa.G - pb.G) > 25 || Math.Abs(pa.B - pb.B) > 25) diff++;
        if (pa.R > 150 && pa.G > 120 && pa.B < 160 && (pa.R - pa.B) > 35 && (pa.G - pa.B) > 15) yellowB++;
        if (pb.R > 150 && pb.G > 120 && pb.B < 160 && (pb.R - pb.B) > 35 && (pb.G - pb.B) > 15) yellowA++;
      }
    }
    a.Dispose(); b.Dispose();
    double ratio = total == 0 ? 0 : (double)diff / total;
    return "{\"diffLocal\":" + ratio.ToString("F4") + ",\"yellowBefore\":" + yellowB + ",\"yellowAfter\":" + yellowA + "}";
  }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Split-Path $OutJson) | Out-Null
$h = [IntPtr]$Hwnd
$rows = New-Object System.Collections.ArrayList

$geom = [VT]::Setup($h, $WindowW, $WindowH, $WindowX, $WindowY)
"E1 " + $geom
[void]$rows.Add('{"phase":"E1","geometry":' + $geom + '}')

$cl = 0; $ct = 0; $cw = 0; $chh = 0
[void][VT]::Canvas($h, [ref]$cl, [ref]$ct, [ref]$cw, [ref]$chh)
$pl = 0; $pt = 0; $pw = 0; $ph = 0
[void][VT]::Palette($h, [ref]$pl, [ref]$pt, [ref]$pw, [ref]$ph)
$pitch = if ($ph -gt 0) { [int]($ph / 8) } else { 0 }
"canvas=$cl,$ct ${cw}x${chh} palette=$pl,$pt ${pw}x${ph} pitch=$pitch"

$trialId = 0

# ---------- 正对照（检验捕获灵敏度和输入可达性） ----------
$pcBefore = Join-Path (Split-Path $OutJson) "pc-before.png"
$pcAfter = Join-Path (Split-Path $OutJson) "pc-after.png"
[void][VT]::Snap($cl, $ct, $cw, $chh, $pcBefore)
[void][VT]::Post($h, 0x0111, 5137)     # Zoom In（投递）
Start-Sleep -Milliseconds 900
[void][VT]::Snap($cl, $ct, $cw, $chh, $pcAfter)
$pcZoom = [VT]::FullDiff($pcBefore, $pcAfter)
[void]$rows.Add('{"phase":"PC1","name":"zoom-in-posted","diffFull":' + $pcZoom + '}')
"PC1 zoom-in 全画布差异: $pcZoom"
[void][VT]::Post($h, 0x0111, 209)      # Fit to Screen 还原
Start-Sleep -Milliseconds 900

# 真点击 File 菜单区域（真实输入是否到达）
$menuBefore = Join-Path (Split-Path $OutJson) "pc-menu-before.png"
$menuAfter = Join-Path (Split-Path $OutJson) "pc-menu-after.png"
[void][VT]::Snap($cl, $ct, $cw, $chh, $menuBefore)
[void][VT]::Click($h, ($pl - 12), ($pt - 20), 1, 40, 0)   # 左栏上方的 File 菜单附近
Start-Sleep -Milliseconds 600
[void][VT]::Snap($cl, $ct, $cw, $chh, $menuAfter)
$pcMenu = [VT]::FullDiff($menuBefore, $menuAfter)
[void]$rows.Add('{"phase":"PC2","name":"real-click-file-menu","diffFull":' + $pcMenu + '}')
"PC2 真实点击菜单 全画布差异: $pcMenu"
[void][VT]::Post($h, 0x0100, 0x1B)     # Esc 关闭菜单
Start-Sleep -Milliseconds 500
# E2: icons 0..7 x variants
foreach ($icon in 0..7) {
  if ($pitch -le 0) { break }
  $iconY = $pt + [int]($pitch / 2) + $icon * $pitch
  # 点图标切换模式（真实点击）
  [void][VT]::Click($h, ($pl + [int]($pw / 2)), $iconY, 1, 40, 60)
  Start-Sleep -Milliseconds 250
  $c = [VT]::BlueCentroid($cl, $ct, $cw, $chh)
  if (-not $c) {
    [void]$rows.Add('{"phase":"E2","trial":' + (++$trialId) + ',"icon":' + $icon + ',"result":"no-sphere"}')
    continue
  }
  $p = $c -split ';'
  $bx = [int]$p[0]; $by = [int]$p[1]
  $sx = $cl + $bx; $sy = $ct + $by
  $hit = [VT]::Hit($h, $sx, $sy)

  foreach ($variant in @(@{ n = 1; hold = 40; gap = 0; name = 'click-40ms' }, @{ n = 1; hold = 200; gap = 0; name = 'click-hold200' }, @{ n = 2; hold = 30; gap = 60; name = 'dbl-60ms' }, @{ n = 2; hold = 30; gap = 120; name = 'dbl-120ms' })) {
    $before = Join-Path (Split-Path $OutJson) ("t$trialId-before.png")
    $after = Join-Path (Split-Path $OutJson) ("t$trialId-after.png")
    [void][VT]::Click($h, $sx, $sy, 0, 0, 0)          # 仅移动光标（不点）
    Start-Sleep -Milliseconds 250
    [void][VT]::Snap($cl, $ct, $cw, $chh, $before)     # 点击前
    [void][VT]::Click($h, $sx, $sy, [int]$variant.n, [int]$variant.hold, [int]$variant.gap)
    Start-Sleep -Milliseconds 500
    [void][VT]::Snap($cl, $ct, $cw, $chh, $after)      # 点击后
    $stats = [VT]::LocalStats($before, $after, $bx, $by, 160)
    $full = [VT]::FullDiff($before, $after)
    [void]$rows.Add('{"phase":"E2","trial":' + (++$trialId) + ',"icon":' + $icon + ',"variant":"' + $variant.name + '","screen":"' + $sx + ',' + $sy + '","hit":' + $hit + ',"stats":' + $stats + ',"diffFull":' + $full + '}')
    Start-Sleep -Milliseconds 200
  }
}

# E3: background posted click on the same sphere (no real input)
$c = [VT]::BlueCentroid($cl, $ct, $cw, $chh)
if ($c) {
  $p = $c -split ';'
  $edges = '{"phase":"E3","note":"posted-click-via-host","target":"' + ($cl + [int]$p[0]) + ',' + ($ct + [int]$p[1]) + '"}'
  [void]$rows.Add($edges)
}

$rows | Set-Content -Path $OutJson -Encoding UTF8
"trials=" + $trialId + " -> " + $OutJson
