param([int]$Mode = 2)

# Mode: 0 = 进程不声明 DPI 感知（默认）；2 = PER_MONITOR_DPI_AWARE
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class DPI {
  [DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int value);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }
  public static string Info(IntPtr root) {
    RECT wr; GetWindowRect(root, out wr);
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    string canvas = "none";
    foreach (var h in found) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() != "wxGLCanvas") continue;
      RECT r; GetWindowRect(h, out r);
      canvas = r.Left + "," + r.Top + " " + (r.Right - r.Left) + "x" + (r.Bottom - r.Top);
    }
    return "window=" + wr.Left + "," + wr.Top + " " + (wr.Right - wr.Left) + "x" + (wr.Bottom - wr.Top)
      + " canvas=" + canvas + " dpi=" + GetDpiForWindow(root);
  }
}
'@ -ErrorAction SilentlyContinue

$r = [DPI]::SetProcessDpiAwareness($Mode)
"SetProcessDpiAwareness($Mode) = $r"
$hwnd = (Get-Process VESTA -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1).MainWindowHandle
if (-not $hwnd) { "没有 VESTA 窗口"; exit 1 }
[DPI]::Info([IntPtr]$hwnd)
