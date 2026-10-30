param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][string]$Out
)

# 纯观测截图：不移动、不还原、不置前；PrintWindow 失败才回退屏幕抓取（并标注 method）
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
using System.Drawing;
using System.Runtime.InteropServices;
public class CAP {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowDC(IntPtr h);
  [DllImport("user32.dll")] public static extern int ReleaseDC(IntPtr h, IntPtr dc);

  public static string Shot(IntPtr h, string path) {
    RECT r; GetWindowRect(h, out r);
    int w = r.Right - r.Left, ht = r.Bottom - r.Top;
    if (w <= 0 || ht <= 0) return "bad-rect";
    string method = "printwindow";
    var bmp = new Bitmap(w, ht);
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      bool ok = PrintWindow(h, hdc, 2);
      g.ReleaseHdc(hdc);
      if (!ok) { method = "screen"; using (var g2 = Graphics.FromImage(bmp)) { g2.CopyFromScreen(r.Left, r.Top, 0, 0, new Size(w, ht)); } }
    }
    // 着墨率：粗采样判断是否空白
    int ink = 0, total = 0;
    for (int y = 0; y < ht; y += 7) { for (int x = 0; x < w; x += 7) { total++; var c = bmp.GetPixel(x, y); if (c.R + c.G + c.B < 720) ink++; } }
    bmp.Save(path, System.Drawing.Imaging.ImageFormat.Png);
    bmp.Dispose();
    return "{\"method\":\"" + method + "\",\"width\":" + w + ",\"height\":" + ht + ",\"ink\":" + (total > 0 ? ((double)ink / total).ToString("F4") : "0") + ",\"left\":" + r.Left + ",\"top\":" + r.Top + "}";
  }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path (Split-Path $Out) | Out-Null
$res = [CAP]::Shot([IntPtr]$Hwnd, $Out)
$res
