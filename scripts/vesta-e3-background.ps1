param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [string]$OutDir = 'D:/calcf/verify/e3'
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
public class E3T {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
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

  public static string BlueCentroid(int cl,int ct,int cw,int chh) {
    var bmp=new Bitmap(cw,chh);
    using(var g=Graphics.FromImage(bmp)){ g.CopyFromScreen(cl,ct,0,0,new Size(cw,chh)); }
    var sx=new List<long>(); var sy=new List<long>(); var cnt=new List<int>();
    for(int yy=0;yy<chh;yy+=2){ for(int xx=0;xx<cw;xx+=2){
      var c=bmp.GetPixel(xx,yy);
      if((c.B-c.R)>90 && (c.B-c.G)>50 && c.B>120){
        int bi=-1; long bd=long.MaxValue;
        for(int i=0;i<sx.Count;i++){ long dx=sx[i]/cnt[i]-xx, dy=sy[i]/cnt[i]-yy; long d=dx*dx+dy*dy; if(d<bd){bd=d;bi=i;} }
        if(bi>=0 && bd<900){ sx[bi]+=xx; sy[bi]+=yy; cnt[bi]++; }
        else { sx.Add(xx); sy.Add(yy); cnt.Add(1); } } } }
    bmp.Dispose();
    int best=-1,bestN=0;
    for(int i=0;i<cnt.Count;i++){ if(cnt[i]>bestN){bestN=cnt[i];best=i;} }
    if(best<0||bestN<60) return "";
    return (sx[best]/cnt[best])+";"+(sy[best]/cnt[best]);
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

  public static string RealClick(IntPtr root,int sx,int sy,int count){
    SetForegroundWindow(root); System.Threading.Thread.Sleep(150);
    SetCursorPos(sx,sy); System.Threading.Thread.Sleep(120);
    for(int i=0;i<count;i++){ mouse_event(0x0002,0,0,0,IntPtr.Zero); System.Threading.Thread.Sleep(30); mouse_event(0x0004,0,0,0,IntPtr.Zero); if(i+1<count) System.Threading.Thread.Sleep(60); }
    System.Threading.Thread.Sleep(700); return "ok";
  }

  // 后台：把鼠标消息直接投递给画布窗口（不移动真实光标、不抢焦点）
  public static string PostedClick(IntPtr canvas,int sx,int sy){
    var p = new POINT(); p.X = sx; p.Y = sy;
    ClientToScreen(canvas, ref p);
    ScreenToClient(canvas, ref p);   // 只为确认换算不报错
    int lx = sx, ly = sy;
    ScreenToClient(canvas, ref p);
    lx = p.X; ly = p.Y;
    IntPtr lp = (IntPtr)((ly << 16) | (lx & 0xFFFF));
    PostMessage(canvas, 0x0200, IntPtr.Zero, lp);              // WM_MOUSEMOVE
    PostMessage(canvas, 0x0201, (IntPtr)1, lp);                // WM_LBUTTONDOWN
    System.Threading.Thread.Sleep(40);
    PostMessage(canvas, 0x0202, IntPtr.Zero, lp);              // WM_LBUTTONUP
    System.Threading.Thread.Sleep(700);
    return "posted=" + lx + "," + ly;
  }

  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
}
'@ -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$h = [IntPtr]$Hwnd
$cl=0;$ct=0;$cw=0;$chh=0;$pl=0;$pw=0
[void][E3T]::Layout($h,[ref]$cl,[ref]$ct,[ref]$cw,[ref]$chh,[ref]$pl,[ref]$pw)
"canvas=$cl,$ct ${cw}x${chh} palette=$pl"

# 切到 3 号候选（已验证具备选中能力）
[void][E3T]::RealClick($h, ($pl + [int]($pw / 2)), 281, 1)
Start-Sleep -Milliseconds 300

# 用真实点击确定“可选中”作为对照
$c = [E3T]::BlueCentroid($cl,$ct,$cw,$chh)
if (-not $c) { "no sphere"; exit 1 }
$p = $c -split ';'
$bx = [int]$p[0]; $by = [int]$p[1]
$sx = $cl + $bx; $sy = $ct + $by
"sphere=$bx,$by screen=$sx,$sy"

# 先测量后台投递
$y0 = [E3T]::Yellow($cl,$ct,$cw,$chh)
"posted: " + [E3T]::PostedClick($h, $sx, $sy)
$y1 = [E3T]::Yellow($cl,$ct,$cw,$chh)
"after posted click: yellow $y0 -> $y1"

# 再用真实点击对照
[void][E3T]::RealClick($h, $sx, $sy, 1)
$y2 = [E3T]::Yellow($cl,$ct,$cw,$chh)
"after real click: yellow $y1 -> $y2"

$line = '{"posted":{"before":' + $y0 + ',"after":' + $y1 + '},"real":{"before":' + $y1 + ',"after":' + $y2 + '}}'
[System.IO.File]::WriteAllText((Join-Path $OutDir 'e3.json'), $line, [System.Text.UTF8Encoding]::new($false))
