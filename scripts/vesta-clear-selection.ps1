param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutDir = 'D:/calcf/verify/clear'
)

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
public class CLR {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, Size = 40)] public struct INPUT { public uint type; public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] a, int size);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  static List<IntPtr> found;
  static bool Collect(IntPtr h, IntPtr p) { found.Add(h); return true; }

  public static string Layout(IntPtr root, out int cl, out int ct, out int cw, out int chh, out int pl, out int pw) {
    found = new List<IntPtr>();
    EnumChildWindows(root, Collect, IntPtr.Zero);
    cl=0;ct=0;cw=0;chh=0;pl=0;pw=0;
    foreach (var c in found) {
      var cls = new StringBuilder(64); GetClassName(c, cls, 64);
      RECT r; GetWindowRect(c, out r);
      int w = r.Right-r.Left, h = r.Bottom-r.Top;
      if (cls.ToString()=="wxGLCanvas") { cl=r.Left; ct=r.Top; cw=w; chh=h; }
      if (cls.ToString()=="ToolbarWindow32" && w<80 && h>300) { pl=r.Left; pw=w; }
    }
    return "ok";
  }

  public static int Yellow(int cl,int ct,int cw,int chh) {
    var bmp=new Bitmap(cw,chh);
    using(var g=Graphics.FromImage(bmp)){ g.CopyFromScreen(cl,ct,0,0,new Size(cw,chh)); }
    int n=0;
    for(int yy=0;yy<chh;yy++){ for(int xx=0;xx<cw;xx++){
      var c=bmp.GetPixel(xx,yy);
      if(c.R>150&&c.G>120&&c.B<160&&(c.R-c.B)>35&&(c.G-c.B)>15) n++; } }
    bmp.Dispose(); return n;
  }

  public static string Click(IntPtr root,int sx,int sy,int count){
    SetForegroundWindow(root); System.Threading.Thread.Sleep(150);
    SetCursorPos(sx,sy); System.Threading.Thread.Sleep(120);
    for(int i=0;i<count;i++){ mouse_event(0x0002,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(0x0004,0,0,0,IntPtr.Zero); if(i+1<count) System.Threading.Thread.Sleep(60); }
    System.Threading.Thread.Sleep(600); return "ok";
  }

  public static string Esc(IntPtr root){
    SetForegroundWindow(root); System.Threading.Thread.Sleep(150);
    INPUT[] d=new INPUT[1]; d[0].type=1; d[0].ki.wVk=0x1B;
    INPUT[] u=new INPUT[1]; u[0].type=1; u[0].ki.wVk=0x1B; u[0].ki.dwFlags=2;
    SendInput(1,d,Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(60);
    SendInput(1,u,Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(700);
    return "esc";
  }
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$h = [IntPtr]$Hwnd
$cl=0;$ct=0;$cw=0;$chh=0;$pl=0;$pw=0
[void][CLR]::Layout($h,[ref]$cl,[ref]$ct,[ref]$cw,[ref]$chh,[ref]$pl,[ref]$pw)
"canvas=$cl,$ct ${cw}x${chh}"

# 选中（候选 3）
[void][CLR]::Click($h, ($pl + [int]($pw/2)), 281, 1)
Start-Sleep -Milliseconds 300
$c = [CLR]::Yellow($cl,$ct,$cw,$chh)
"after select: yellow=$c"

# 1) 真实 Esc
[void][CLR]::Esc($h)
$a = [CLR]::Yellow($cl,$ct,$cw,$chh)
"after real Esc: yellow=$a"

# 2) 空白处单击（画布左上）
[void][CLR]::Click($h, ($cl+25), ($ct+25), 1)
$b = [CLR]::Yellow($cl,$ct,$cw,$chh)
"after click empty: yellow=$b"

# 3) 空白处双击
[void][CLR]::Click($h, ($cl+25), ($ct+25), 2)
$d = [CLR]::Yellow($cl,$ct,$cw,$chh)
"after dblclick empty: yellow=$d"

$json = '{"selected":' + $c + ',"afterRealEsc":' + $a + ',"afterClickEmpty":' + $b + ',"afterDblEmpty":' + $d + '}'
[System.IO.File]::WriteAllText((Join-Path $OutDir 'clear.json'), $json, [System.Text.UTF8Encoding]::new($false))
