# vesta-ui.ps1 —— VESTA 的 Win32 控制面（Node 侧 spawn 调用，stdout 只输出一行 JSON）
#
# 为什么是 PowerShell：VESTA 是闭源 wxWidgets 程序，没有脚本接口；它的菜单是真正的
# HMENU、面板控件是真正的子窗口 HWND，所以用 Win32 消息就能完整驱动，且不需要任何
# 原生依赖。这个脚本只做「手」，语义判断全部留在 Node 侧。
#
# Actions:
#   windows  -Pid <pid>                        列出该进程的顶层窗口
#   menu     -Hwnd <hwnd>                      递归列出菜单命令（含 id / 路径 / 可用性）
#   cmd      -Hwnd <hwnd> -CommandId <n>       投递 WM_COMMAND（等价于点菜单项）
#   controls -Hwnd <hwnd>                      列出窗口内的子控件（含按钮勾选状态）
#   click    -Hwnd <hwnd>                      BM_CLICK
#   settext  -Hwnd <hwnd> -Text <s>            WM_SETTEXT
#   capture  -Hwnd <hwnd> -Out <png>           PrintWindow 抓图（含遮挡窗口）
#   gl       -Hwnd <top>                       找 wxGLCanvas 并报客户区尺寸/DPI
#   drag     -Hwnd <gl> [-X -Y -ToX -ToY]      PostMessage 拖拽（旋转视图）
#   wheel    -Hwnd <gl> [-Delta 120 -Count n]  PostMessage 滚轮（缩放）
#   key      -Hwnd <top> -Key <vk> [-Count -Ctrl]  置前后按键
#   clickat  -Hwnd <gl> [-X -Y]                客户区单击（点选原子）
#   type     -Hwnd <hwnd> -Text <s> [-Enter]   SendKeys 真实打字（文件对话框）
#   host                                       常驻模式：stdin/stdout 行 JSON（Add-Type 只编译一次）
#   viewport -ProcId <pid>                     一步拿主窗口 + GL 画布 + 客户区 + DPI
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$ProcId = 0,
  [long]$Hwnd = 0,
  [int]$CommandId = 0,
  [string]$Text = '',
  [string]$Out = '',
  [int]$X = -1,
  [int]$Y = -1,
  [int]$ToX = -1,
  [int]$ToY = -1,
  [int]$Delta = 120,
  [int]$Count = 1,
  [int]$Steps = 12,
  [int]$Key = 0,
  [switch]$Ctrl,
  [switch]$Enter
)

$ErrorActionPreference = 'Stop'
# stdout 必须是 UTF-8：中文/符号（λ、Å）经控制台默认编码会被毁掉，控件匹配就失效。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

# 进程 DPI 感知：必须在查询/截图前声明，否则拿到的是被虚拟化的逻辑像素（120 DPI 下差 1.25 倍）
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class DpiFix {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("shcore.dll")] static extern int SetProcessDpiAwareness(int value);
  public static string Enable() {
    try { if (SetProcessDpiAwarenessContext(new IntPtr(-4))) return "per-monitor-v2"; } catch { }
    try { if (SetProcessDpiAwareness(2) == 0) return "per-monitor"; } catch { }
    return "unaware";
  }
}
'@ -ErrorAction SilentlyContinue
[DpiFix]::Enable() | Out-Null

Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class VestaWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern int GetMenuItemID(IntPtr h, int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetMenuString(IntPtr h, int id, StringBuilder s, int n, uint flags);
  [DllImport("user32.dll")] public static extern uint GetMenuState(IntPtr h, int id, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern IntPtr SetFocus(IntPtr h);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  // WS_EX_TOPMOST = 0x8, GWL_EXSTYLE = -20
  public static int PidOf(IntPtr h) { uint p; GetWindowThreadProcessId(h, out p); return (int)p; }
  public static bool IsTopmost(IntPtr h) { try { return (GetWindowLongPtr(h, -20).ToInt64() & 0x8) != 0; } catch { return false; } }
  // 返回 命中窗口|是否属于 root 子树|root
  public static string HitTest(IntPtr root, int x, int y) {
    var p = new POINT(); p.X = x; p.Y = y;
    IntPtr hit = WindowFromPoint(p);
    IntPtr r = GetAncestor(hit, 2);
    return hit.ToInt64() + "|" + (r == root) + "|" + r.ToInt64();
  }
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);

  public static string Txt(IntPtr h) { var sb = new StringBuilder(512); GetWindowText(h, sb, 512); return sb.ToString(); }
  public static string Cls(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
  public static int Id(IntPtr h) { return GetDlgCtrlID(h); }
  public static List<IntPtr> Kids(IntPtr h) { var r = new List<IntPtr>(); EnumChildWindows(h, (k, l) => { r.Add(k); return true; }, IntPtr.Zero); return r; }
  public static List<IntPtr> Tops(uint pid) {
    var r = new List<IntPtr>();
    EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p == pid) r.Add(h); return true; }, IntPtr.Zero);
    return r;
  }
  public static string MenuLabel(IntPtr hm, int i) { var sb = new StringBuilder(256); GetMenuString(hm, i, sb, 256, 0x400); return sb.ToString(); }
  public static int MenuId(IntPtr hm, int i) { return GetMenuItemID(hm, i); }
  public static IntPtr MenuSub(IntPtr hm, int i) { return GetSubMenu(hm, i); }
  public static int MenuCount(IntPtr hm) { return GetMenuItemCount(hm); }
  public static int MenuFlags(IntPtr hm, int i) { return (int)GetMenuState(hm, i, 0x400); }
  public static void Cmd(IntPtr h, int id) { PostMessage(h, 0x0111, (IntPtr)id, IntPtr.Zero); }
  public static int Click(IntPtr h) { return (int)SendMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero); }
  /// <summary>非阻塞点击：BM_CLICK 用 PostMessage 发，避免对话框的模态处理把调用方卡住。</summary>
  public static bool ClickPost(IntPtr h) { return PostMessage(h, 0x00F5, IntPtr.Zero, IntPtr.Zero); }

  /// <summary>把我们的线程挂到目标窗口所属线程上，强行 SetFocus（后台进程无法直接夺焦点的替代方案）。</summary>
  public static bool AttachFocus(IntPtr target) {
    if (target == IntPtr.Zero) return false;
    uint procId;
    uint targetThread = GetWindowThreadProcessId(target, out procId);
    uint currentThread = GetCurrentThreadId();
    IntPtr root = GetAncestor(target, 2); // GA_ROOT
    bool attached = AttachThreadInput(currentThread, targetThread, true);
    ShowWindow(root, 9);          // SW_RESTORE
    SetForegroundWindow(root);
    SetFocus(target);
    System.Threading.Thread.Sleep(150);
    AttachThreadInput(currentThread, targetThread, false);
    return attached;
  }

  /// <summary>真实鼠标点击控件中心：置前 → 光标移到屏幕坐标 → 按下抬起。</summary>
  /// <remarks>对话框里的输入框只认真实焦点，PostMessage 的点击不足以让 SendKeys 打进去。</remarks>
  public static bool RealClick(IntPtr target) {
    RECT r;
    if (!GetWindowRect(target, out r)) return false;
    IntPtr top = target;
    var sb = new System.Text.StringBuilder(64);
    GetClassName(top, sb, 64);
    SetForegroundWindow(GetAncestor(target, 2)); // GA_ROOT = 2
    System.Threading.Thread.Sleep(150);
    int x = (r.Left + r.Right) / 2;
    int y = (r.Top + r.Bottom) / 2;
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(80);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    return true;
  }
  public static int CheckState(IntPtr h) { return (int)SendMessage(h, 0x00F0, IntPtr.Zero, IntPtr.Zero); }
  public static void SetText(IntPtr h, string s) { SendMessage(h, 0x000C, IntPtr.Zero, s); }
  /// <summary>读取控件文字（WM_GETTEXT），用于取 VESTA 的文本区输出。</summary>
  public static string ReadText(IntPtr h) {
    var sb = new StringBuilder(200000);
    SendMessage(h, 0x000D, (IntPtr)sb.Capacity, sb);
    return sb.ToString();
  }

  public static string Grab(IntPtr h, string path) {
    RECT r;
    if (!GetWindowRect(h, out r)) return "no-rect";
    int w = r.Right - r.Left, ht = r.Bottom - r.Top;
    if (w <= 0 || ht <= 0) return "bad-size";
    using (var bmp = new Bitmap(w, ht))
    using (var g = Graphics.FromImage(bmp)) {
      IntPtr hdc = g.GetHdc();
      PrintWindow(h, hdc, 2);
      g.ReleaseHdc(hdc);
      bmp.Save(path, ImageFormat.Png);
    }
    return w + "x" + ht;
  }
  public static string Rect(IntPtr h) {
    RECT r;
    if (!GetWindowRect(h, out r)) return "";
    return (r.Right - r.Left) + "x" + (r.Bottom - r.Top);
  }

  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetDepth(IntPtr h);

  /// <summary>递归列出所有子窗口及其父窗口（用于识别「嵌套对话框」）。</summary>
  public static List<string> Tree(IntPtr top) {
    var rows = new List<string>();
    Walk(top, top, 1, rows);
    return rows;
  }
  static void Walk(IntPtr top, IntPtr parent, int depth, List<string> rows) {
    if (depth > 6) return;
    foreach (var k in Kids(parent)) {
      var cls = Cls(k);
      var title = Txt(k);
      rows.Add((long)k + "|" + (long)parent + "|" + depth + "|" + cls + "|" + title);
      Walk(top, k, depth + 1, rows);
    }
  }

  /// <summary>在窗口里找 wxGLCanvas（VESTA 的 3D 视图），找不到返回 Zero。</summary>
  public static IntPtr Gl(IntPtr top) {
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(top, (h, l) => {
      if (Cls(h).StartsWith("wxGLCanvas")) { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  /// <summary>客户区尺寸，返回 "w x h"。</summary>
  public static string ClientSize(IntPtr h) {
    RECT r;
    if (!GetClientRect(h, out r)) return "";
    return (r.Right - r.Left) + "x" + (r.Bottom - r.Top);
  }

  public static void Focus(IntPtr h) { ShowWindow(h, 9); SetForegroundWindow(h); }

  /// <summary>把客户区坐标打包成 lParam（低字 X，高字 Y）。</summary>
  public static IntPtr Pack(int x, int y) {
    return (IntPtr)((y << 16) | (x & 0xFFFF));
  }

  /// <summary>拖拽：按下 → 分步移动 → 抬起，全部走 PostMessage（不移动真实光标）。</summary>
  public static bool Drag(IntPtr h, int x1, int y1, int x2, int y2, int steps) {
    PostMessage(h, 0x0201, (IntPtr)1, Pack(x1, y1));
    for (int i = 1; i <= steps; i++) {
      int x = x1 + (x2 - x1) * i / steps;
      int y = y1 + (y2 - y1) * i / steps;
      PostMessage(h, 0x0200, (IntPtr)1, Pack(x, y));
      System.Threading.Thread.Sleep(15);
    }
    PostMessage(h, 0x0202, IntPtr.Zero, Pack(x2, y2));
    return true;
  }

  /// <summary>滚轮：delta>0 放大。lParam 用客户区坐标即可（VESTA 不校验屏幕坐标）。</summary>
  public static bool Wheel(IntPtr h, int delta, int count, int x, int y) {
    for (int i = 0; i < count; i++) {
      IntPtr w = (IntPtr)((delta & 0xFFFF) << 16);
      PostMessage(h, 0x020A, w, Pack(x, y));
      System.Threading.Thread.Sleep(60);
    }
    return true;
  }

  /// <summary>按键：先置前再发 KEYDOWN/KEYUP（VESTA 只处理有焦点的按键）。</summary>
  public static bool Key(IntPtr top, IntPtr target, int vk, int count, bool ctrl) {
    Focus(top);
    System.Threading.Thread.Sleep(120);
    for (int i = 0; i < count; i++) {
      if (ctrl) keybd_event(0x11, 0, 0, IntPtr.Zero);
      PostMessage(target, 0x0100, (IntPtr)vk, IntPtr.Zero);
      System.Threading.Thread.Sleep(40);
      PostMessage(target, 0x0101, (IntPtr)vk, IntPtr.Zero);
      if (ctrl) keybd_event(0x11, 0, 2, IntPtr.Zero);
      System.Threading.Thread.Sleep(80);
    }
    return true;
  }

  /// <summary>在客户区某点单击（用于点选原子/打开面板）。</summary>
  /// <summary>点击控件中心（用于让输入框获得焦点）。</summary>
  /// <summary>向控件投递字符（WM_CHAR）。\b 表示退格，用于先清空再输入。</summary>
  public static int SendChars(IntPtr h, string text) {
    int sent = 0;
    foreach (char c in text) {
      int code = c == '\b' ? 8 : (int)c;
      PostMessage(h, 0x0102, (IntPtr)code, IntPtr.Zero);
      sent++;
      System.Threading.Thread.Sleep(8);
    }
    return sent;
  }

  /// <summary>记录当前的光标屏幕坐标与前台窗口（用于操作后还原，减少对用户的干扰）。</summary>
  public static string SaveEnv() { return SaveEnvFor(IntPtr.Zero); }
  // 记录光标、前台以及（可选）指定窗口的置顶状态与句柄
  public static string SaveEnvFor(IntPtr root) {
    POINT pt;
    GetCursorPos(out pt);
    IntPtr fg = GetForegroundWindow();
    long rm = root.ToInt64();
    bool top = root != IntPtr.Zero && IsTopmost(root);
    return pt.X + "," + pt.Y + "," + ((long)fg) + "," + (top ? "1" : "0") + "," + rm;
  }

  /// <summary>还原光标位置与前台窗口。</summary>
  public static bool RestoreEnv(string state) {
    string[] parts = (state ?? "").Split(',');
    if (parts.Length < 3) return false;
    int x, y; long hwnd;
    if (!int.TryParse(parts[0], out x) || !int.TryParse(parts[1], out y) || !long.TryParse(parts[2], out hwnd)) return false;
    SetCursorPos(x, y);
    if (hwnd != 0) { SetForegroundWindow(new IntPtr(hwnd)); }
    // 4/5 段：置顶状态与目标窗口（有则恢复原状态）
    if (parts.Length >= 5) {
      bool wasTop = parts[3] == "1";
      long rootRaw;
      if (long.TryParse(parts[4], out rootRaw) && rootRaw != 0) {
        var root = new IntPtr(rootRaw);
        if (IsTopmost(root) != wasTop) {
          var flag = wasTop ? new IntPtr(-1) : new IntPtr(-2);
          SetWindowPos(root, flag, 0, 0, 0, 0, 0x0013);
        }
      }
    }
    return true;
  }

  /// <summary>把窗口置前（含还原），返回是否成功。</summary>
  public static bool Foreground(IntPtr target) {
    IntPtr root = GetAncestor(target, 2);
    ShowWindow(root, 9);
    System.Threading.Thread.Sleep(80);
    bool ok = SetForegroundWindow(root);
    System.Threading.Thread.Sleep(120);
    return ok;
  }

  /// <summary>按键和弦：先按下修饰键，再按主键，最后依次抬起（Ctrl+A 必须这样发）。</summary>
  public static int Chord(IntPtr target, int modifier, int vk) {
    SetForegroundWindow(GetAncestor(target, 2));
    System.Threading.Thread.Sleep(100);
    keybd_event((byte)modifier, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    keybd_event((byte)vk, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    keybd_event((byte)vk, 0, 2, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    keybd_event((byte)modifier, 0, 2, IntPtr.Zero);
    return 2;
  }

  /// <summary>按虚拟键码发送真实按键（keybd_event，走系统输入队列）。</summary>
  /// <remarks>wx 的数值输入框对 WM_CHAR / SendKeys 的文字映射不可靠（实测会变成乱码），
  /// 而虚拟键码（0-9 = 48-57、退格 8、Ctrl 0x11、A 0x41）是布局无关的，实测能正确落到字段里。</remarks>
  public static int SendVk(IntPtr target, int[] vks) {
    SetForegroundWindow(GetAncestor(target, 2));
    System.Threading.Thread.Sleep(120);
    foreach (int vk in vks) {
      keybd_event((byte)vk, 0, 0, IntPtr.Zero);
      System.Threading.Thread.Sleep(25);
      keybd_event((byte)vk, 0, 2, IntPtr.Zero);
      System.Threading.Thread.Sleep(45);
    }
    return vks.Length;
  }

  public static bool ClickCenter(IntPtr h) {
    RECT r;
    if (!GetClientRect(h, out r)) return false;
    int cx = (r.Right - r.Left) / 2;
    int cy = (r.Bottom - r.Top) / 2;
    return ClickAt(h, cx, cy);
  }

  public static bool ClickAt(IntPtr h, int x, int y) {
    PostMessage(h, 0x0200, IntPtr.Zero, Pack(x, y));
    System.Threading.Thread.Sleep(30);
    PostMessage(h, 0x0201, (IntPtr)1, Pack(x, y));
    System.Threading.Thread.Sleep(40);
    PostMessage(h, 0x0202, IntPtr.Zero, Pack(x, y));
    return true;
  }

  /// <summary>真实键盘输入（Unicode，用 SendInput 的替代：keybd_event 逐字符不可行，
  /// 这里用 SetForegroundWindow + WScript.Shell SendKeys 由脚本层完成）。</summary>
  public static string Dpi(IntPtr h) { try { return GetDpiForWindow(h).ToString(); } catch { return "?"; } }
}
"@

function Walk-Menu([IntPtr]$hm, [string]$prefix, [int]$depth) {
  $rows = @()
  if ($hm -eq [IntPtr]::Zero -or $depth -gt 3) { return $rows }
  $n = [VestaWin]::MenuCount($hm)
  for ($i = 0; $i -lt $n; $i++) {
    $label = [VestaWin]::MenuLabel($hm, $i)
    $sub = [VestaWin]::MenuSub($hm, $i)
    $id = [VestaWin]::MenuId($hm, $i)
    $flags = [VestaWin]::MenuFlags($hm, $i)
    $clean = ($label -replace "`t.*$", '').Trim()
    # 空标签就是分隔符；不能拿 0x800 判分隔符 —— 顶层弹出菜单的 flags 里也带这一位。
    if ($clean -eq '' -or $clean -eq '-') { continue }
    $path = if ($prefix) { "$prefix > $clean" } else { $clean }
    if ($sub -ne [IntPtr]::Zero) {
      $rows += [pscustomobject]@{ path = $path; id = $null; kind = 'menu' }
      $rows += Walk-Menu $sub $path ($depth + 1)
    } else {
      $rows += [pscustomobject]@{
        path = $path
        id = $id
        kind = 'command'
        # MF_ENABLED 是 0，MF_GRAYED=1 / MF_DISABLED=2 才表示不可用。
        enabled = (($flags -band 0x3) -eq 0)
      }
    }
  }
  return $rows
}

function Invoke-VestaRequest($req) {
  $act = [string]$req.action
  switch ($act) {
    'windows' {
      $list = @()
      foreach ($w in [VestaWin]::Tops([uint32]$req.pid)) {
        $list += [pscustomobject]@{
          hwnd = [long]$w; class = [VestaWin]::Cls($w); title = [VestaWin]::Txt($w)
          visible = [VestaWin]::IsWindowVisible($w); enabled = [VestaWin]::IsWindowEnabled($w)
          rect = [VestaWin]::Rect($w)
        }
      }
      return [pscustomobject]@{ ok = $true; pid = $req.pid; windows = $list }
    }
    'viewport' {
      # 一步拿到：主窗口 hwnd + GL 画布 hwnd + 客户区尺寸 + DPI
      $main = [IntPtr]::Zero
      foreach ($w in [VestaWin]::Tops([uint32]$req.pid)) {
        if ([VestaWin]::Txt($w) -like '*- VESTA') { $main = $w; break }
      }
      if ($main -eq [IntPtr]::Zero) { return [pscustomobject]@{ ok = $false; error = 'no-main-window' } }
      $gl = [VestaWin]::Gl($main)
      return [pscustomobject]@{
        ok = ($gl -ne [IntPtr]::Zero)
        hwnd = [long]$main
        gl = [long]$gl
        client = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::ClientSize($gl) } else { '' }
        dpi = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::Dpi($gl) } else { '' }
        title = [VestaWin]::Txt($main)
      }
    }
    'gl' {
      $gl = [VestaWin]::Gl([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{
        ok = ($gl -ne [IntPtr]::Zero); gl = [long]$gl
        client = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::ClientSize($gl) } else { '' }
        dpi = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::Dpi($gl) } else { '' }
      }
    }
    'drag' {
      $gl = [IntPtr][long]$req.hwnd
      [VestaWin]::Drag($gl, [int]$req.x, [int]$req.y, [int]$req.tox, [int]$req.toy, [int]$req.steps) | Out-Null
      return [pscustomobject]@{ ok = $true; client = [VestaWin]::ClientSize($gl) }
    }
    'wheel' {
      $gl = [IntPtr][long]$req.hwnd
      $rect = [VestaWin]::ClientSize($gl)
      $parts = $rect -split 'x'
      $cx = if ($null -ne $req.x) { [int]$req.x } else { [int]([int]$parts[0] / 2) }
      $cy = if ($null -ne $req.y) { [int]$req.y } else { [int]([int]$parts[1] / 2) }
      [VestaWin]::Wheel($gl, [int]$req.delta, [int]$req.count, $cx, $cy) | Out-Null
      return [pscustomobject]@{ ok = $true; client = $rect }
    }
    'keypost' {
      # 只投递按键，不置前、不改变焦点（对比 key 动作会先 Focus）
      $top = [IntPtr][long]$req.hwnd
      $target = [VestaWin]::Gl($top)
      if ($target -eq [IntPtr]::Zero) { $target = $top }
      $vk = [int]$req.key
      $count = if ($req.count) { [int]$req.count } else { 1 }
      for ($i = 0; $i -lt $count; $i++) {
        [VestaWin]::PostMessage($target, 0x0100, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 40
        [VestaWin]::PostMessage($target, 0x0101, [IntPtr]$vk, [IntPtr]::Zero) | Out-Null
        Start-Sleep -Milliseconds 60
      }
      return [pscustomobject]@{ ok = $true; vk = $vk; count = $count }
    }
    'key' {
      $top = [IntPtr][long]$req.hwnd
      $target = [VestaWin]::Gl($top)
      if ($target -eq [IntPtr]::Zero) { $target = $top }
      [VestaWin]::Key($top, $target, [int]$req.key, [int]$req.count, [bool]$req.ctrl) | Out-Null
      return [pscustomobject]@{ ok = $true; vk = $req.key }
    }
    'tree' {
      $rows = [VestaWin]::Tree([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $true; rows = $rows }
    }
    'clickat' {
      [VestaWin]::ClickAt([IntPtr][long]$req.hwnd, [int]$req.x, [int]$req.y) | Out-Null
      return [pscustomobject]@{ ok = $true }
    }
    'cmd' {
      [VestaWin]::Cmd([IntPtr][long]$req.hwnd, [int]$req.id)
      return [pscustomobject]@{ ok = $true; sent = $req.id }
    }
    'click' {
      $r = [VestaWin]::Click([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $true; sent = $r }
    }
    'settext' {
      [VestaWin]::SetText([IntPtr][long]$req.hwnd, [string]$req.text)
      return [pscustomobject]@{ ok = $true }
    }
    'capture' {
      $res = [VestaWin]::Grab([IntPtr][long]$req.hwnd, [string]$req.out)
      $okSize = $res -match '^\d+x\d+$'
      return [pscustomobject]@{ ok = $okSize; size = $res; path = $req.out }
    }
    'clickcenter' {
      $ok = [VestaWin]::ClickCenter([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $ok }
    }
    'clickpost' {
      $ok = [VestaWin]::ClickPost([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $ok }
    }
    'clientorigin' {
      $h = [IntPtr][long]$req.hwnd
      $p = New-Object VestaWin+POINT
      $p.X = 0; $p.Y = 0
      [VestaWin]::ClientToScreen($h, [ref]$p) | Out-Null
      return [pscustomobject]@{ ok = $true; x = $p.X; y = $p.Y }
    }
    'realkey' {
      # 真实按键（SendInput 兜底）：置前到根窗口后 keybd_event 按下/抬起
      $top = [IntPtr][long]$req.hwnd
      $root = [VestaWin]::GetAncestor($top, 2)
      [VestaWin]::ShowWindow($root, 9) | Out-Null
      [VestaWin]::SetForegroundWindow($root) | Out-Null
      Start-Sleep -Milliseconds 200
      $vk = [byte][int]$req.key
      $count = if ($req.count) { [int]$req.count } else { 1 }
      for ($i = 0; $i -lt $count; $i++) {
        [VestaWin]::keybd_event($vk, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 50
        [VestaWin]::keybd_event($vk, 0, 2, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 80
      }
      return [pscustomobject]@{ ok = $true; vk = $vk }
    }
    'topmost' {
      # 临时置顶：鼠标按 z 序命中，不需要抢焦点；SWP_NOACTIVATE 防止激活
      $top = [IntPtr][long]$req.hwnd
      $root = [VestaWin]::GetAncestor($top, 2)
      $prev = [VestaWin]::IsTopmost($root)
      $flag = if ($req.on -eq $false) { -2 } else { -1 }   # HWND_NOTOPMOST / HWND_TOPMOST
      [VestaWin]::SetWindowPos($root, [IntPtr]$flag, 0, 0, 0, 0, 0x0013) | Out-Null  # NOSIZE|NOMOVE|NOACTIVATE
      $now = [VestaWin]::IsTopmost($root)
      return [pscustomobject]@{ ok = $true; on = $now; previous = $prev; root = $root.ToInt64() }
    }
    'realdblclickat' {
      # 真实双击：先恢复窗口并等布局稳定，再换算坐标，做命中校验，最后恢复置顶状态
      $h = [IntPtr][long]$req.hwnd
      $root = [VestaWin]::GetAncestor($h, 2)
      $fgBefore = [VestaWin]::GetForegroundWindow()
      $prevTop = [VestaWin]::IsTopmost($root)
      [VestaWin]::ShowWindow($root, 9) | Out-Null
      [VestaWin]::SetForegroundWindow($root) | Out-Null
      if ($req.topmost) { [VestaWin]::SetWindowPos($root, [IntPtr](-1), 0, 0, 0, 0, 0x0013) | Out-Null }
      Start-Sleep -Milliseconds 350
      # 布局稳定后再换算，避免恢复窗口导致旧坐标失效
      $pt = New-Object VestaWin+POINT
      $pt.X = [int]$req.x
      $pt.Y = [int]$req.y
      if (-not [VestaWin]::ClientToScreen($h, [ref]$pt)) { return [pscustomobject]@{ ok = $false; error = "ClientToScreen failed" } }
      $fgAfter = [VestaWin]::GetForegroundWindow()
      $hit = [VestaWin]::HitTest($root, $pt.X, $pt.Y)
      $hitParts = $hit.Split("|")
      $hitInside = ($hitParts.Length -ge 2 -and $hitParts[1] -eq "True")
      if (-not $hitInside) {
        if ($prevTop -eq $false) { [VestaWin]::SetWindowPos($root, [IntPtr](-2), 0, 0, 0, 0, 0x0013) | Out-Null }
        return [pscustomobject]@{ ok = $false; error = "point-not-in-target"; hit = $hit; screenX = $pt.X; screenY = $pt.Y; fgIsTarget = ($fgAfter -eq $root); topmostRestored = $true }
      }
      [VestaWin]::SetCursorPos($pt.X, $pt.Y) | Out-Null
      Start-Sleep -Milliseconds 80
      for ($i = 0; $i -lt 2; $i++) {
        [VestaWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
        Start-Sleep -Milliseconds 25
        [VestaWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
        if ($i -eq 0) { Start-Sleep -Milliseconds 60 }
      }
      # 恢复置顶到原状态（不能一律取消，用户原本可能就是置顶）
      if ([VestaWin]::IsTopmost($root) -ne $prevTop) {
        $flag = if ($prevTop) { -1 } else { -2 }
        [VestaWin]::SetWindowPos($root, [IntPtr]$flag, 0, 0, 0, 0, 0x0013) | Out-Null
      }
      return [pscustomobject]@{ ok = $true; screenX = $pt.X; screenY = $pt.Y; hit = $hit; hitInside = $hitInside; fgBefore = $fgBefore.ToInt64(); fgAfter = $fgAfter.ToInt64(); fgIsTarget = ($fgAfter -eq $root); topmostPrevious = $prevTop; topmostNow = [VestaWin]::IsTopmost($root) }
    }
    'realdrag' {
      # 真实鼠标拖拽（框选用）：按下 → 分步移动 → 抬起
      $h = [IntPtr][long]$req.hwnd
      $p1 = New-Object VestaWin+POINT; $p1.X = [int]$req.x1; $p1.Y = [int]$req.y1
      $p2 = New-Object VestaWin+POINT; $p2.X = [int]$req.x2; $p2.Y = [int]$req.y2
      [VestaWin]::ClientToScreen($h, [ref]$p1) | Out-Null
      [VestaWin]::ClientToScreen($h, [ref]$p2) | Out-Null
      $root = [VestaWin]::GetAncestor($h, 2)
      [VestaWin]::ShowWindow($root, 9) | Out-Null
      [VestaWin]::SetForegroundWindow($root) | Out-Null
      Start-Sleep -Milliseconds 150
      [VestaWin]::SetCursorPos($p1.X, $p1.Y) | Out-Null
      Start-Sleep -Milliseconds 80
      [VestaWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 80
      for ($i = 1; $i -le 12; $i++) {
        $x = [int]($p1.X + ($p2.X - $p1.X) * $i / 12)
        $y = [int]($p1.Y + ($p2.Y - $p1.Y) * $i / 12)
        [VestaWin]::SetCursorPos($x, $y) | Out-Null
        Start-Sleep -Milliseconds 25
      }
      Start-Sleep -Milliseconds 80
      [VestaWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
      return [pscustomobject]@{ ok = $true; from = "$($p1.X),$($p1.Y)"; to = "$($p2.X),$($p2.Y)" }
    }
    'realclickat' {
      # 真鼠标点击控件内坐标（SendInput 兜底）；可用 -Modifier 按住 Shift(16)/Ctrl(17) 再点
      $h = [IntPtr][long]$req.hwnd
      $pt = New-Object VestaWin+POINT
      $pt.X = [int]$req.x
      $pt.Y = [int]$req.y
      if (-not [VestaWin]::ClientToScreen($h, [ref]$pt)) { return [pscustomobject]@{ ok = $false; error = "ClientToScreen failed" } }
      $root = [VestaWin]::GetAncestor($h, 2)
      [VestaWin]::ShowWindow($root, 9) | Out-Null
      [VestaWin]::SetForegroundWindow($root) | Out-Null
      Start-Sleep -Milliseconds 150
      [VestaWin]::SetCursorPos($pt.X, $pt.Y) | Out-Null
      Start-Sleep -Milliseconds 80
      $mod = [int]$req.modifier
      if ($mod -gt 0) { [VestaWin]::keybd_event([byte]$mod, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 60 }
      [VestaWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [VestaWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      if ($mod -gt 0) { [VestaWin]::keybd_event([byte]$mod, 0, 2, [IntPtr]::Zero) }
      return [pscustomobject]@{ ok = $true; screenX = $pt.X; screenY = $pt.Y; modifier = $mod }
    }
    'realmouse' {
      $ok = [VestaWin]::RealClick([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $ok }
    }
    'type' {
      Add-Type -AssemblyName System.Windows.Forms
      [VestaWin]::Focus([IntPtr][long]$req.hwnd)
      Start-Sleep -Milliseconds 250
      $text = [string]$req.text
      $pattern = '([+^%~(){}\[\]])'
      $escaped = [regex]::Replace($text, $pattern, '{$1}')
      if ($req.enter) { [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
      [System.Windows.Forms.SendKeys]::SendWait($escaped)
      if ($req.enter) { Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }
      return [pscustomobject]@{ ok = $true; typed = $text.Length }
    }
    'focusattach' {
      $ok = [VestaWin]::AttachFocus([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $ok }
    }
    'chars' {
      $n = [VestaWin]::SendChars([IntPtr][long]$req.hwnd, [string]$req.text)
      return [pscustomobject]@{ ok = $true; sent = $n }
    }
    'rect' {
      $rows = @()
      foreach ($h in @($req.hwnds)) {
        $r = New-Object VestaWin+RECT
        if ([VestaWin]::GetWindowRect([IntPtr][long]$h, [ref]$r)) {
          $rows += [pscustomobject]@{ hwnd = [long]$h; left = $r.Left; top = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top); visible = [VestaWin]::IsWindowVisible([IntPtr][long]$h) }
        }
      }
      return [pscustomobject]@{ ok = $true; rects = $rows }
    }
    'wininfo' {
      $h = [IntPtr][long]$req.hwnd
      $pidv = [VestaWin]::PidOf($h)
      $owner = [VestaWin]::GetWindow($h, 4)   # GW_OWNER
      $title = New-Object System.Text.StringBuilder 256
      [void][VestaWin]::GetWindowText($h, $title, 256)
      $cls = New-Object System.Text.StringBuilder 128
      [void][VestaWin]::GetClassName($h, $cls, 128)
      return [pscustomobject]@{ ok = $true; hwnd = $h.ToInt64(); pid = $pidv; owner = $owner.ToInt64(); title = $title.ToString(); cls = $cls.ToString() }
    }
    'saveenv' {
      $root = if ($req.hwnd) { [VestaWin]::GetAncestor([IntPtr][long]$req.hwnd, 2) } else { [IntPtr]::Zero }
      $state = [VestaWin]::SaveEnvFor($root)
      return [pscustomobject]@{ ok = $true; state = $state }
    }
    'restoreenv' {
      $ok = [VestaWin]::RestoreEnv([string]$req.state)
      return [pscustomobject]@{ ok = $true; restored = $ok }
    }
    'foreground' {
      $ok = [VestaWin]::Foreground([IntPtr][long]$req.hwnd)
      return [pscustomobject]@{ ok = $true; front = $ok }
    }
    'chord' {
      $n = [VestaWin]::Chord([IntPtr][long]$req.hwnd, [int]$req.modifier, [int]$req.key)
      return [pscustomobject]@{ ok = $true; sent = $n }
    }
    'vk' {
      # 真实按键：$req.vks 是虚拟键码数组（48-57 为数字 0-9，8 退格，0x11+0x41 为 Ctrl+A）
      $keys = @($req.vks | ForEach-Object { [int]$_ })
      $n = [VestaWin]::SendVk([IntPtr][long]$req.hwnd, [int[]]$keys)
      return [pscustomobject]@{ ok = $true; sent = $n }
    }
    'ping' { return [pscustomobject]@{ ok = $true; pid = $PID; mode = 'host' } }
    default { return [pscustomobject]@{ ok = $false; error = "unsupported in host: $act" } }
  }
}

try {
  switch ($Action) {
    'windows' {
      $list = @()
      foreach ($w in [VestaWin]::Tops([uint32]$ProcId)) {
        $list += [pscustomobject]@{
          hwnd = [long]$w
          class = [VestaWin]::Cls($w)
          title = [VestaWin]::Txt($w)
          visible = [VestaWin]::IsWindowVisible($w)
          enabled = [VestaWin]::IsWindowEnabled($w)
          rect = [VestaWin]::Rect($w)
        }
      }
      $payload = [pscustomobject]@{ ok = $true; pid = $ProcId; windows = $list }
    }
    'menu' {
      $hm = [VestaWin]::GetMenu([IntPtr]$Hwnd)
      $rows = Walk-Menu $hm '' 0
      $payload = [pscustomobject]@{ ok = $true; menu = $rows }
    }
    'cmd' {
      [VestaWin]::Cmd([IntPtr]$Hwnd, $CommandId)
      $payload = [pscustomobject]@{ ok = $true; sent = $CommandId }
    }
    'controls' {
      $list = @()
      foreach ($k in [VestaWin]::Kids([IntPtr]$Hwnd)) {
        $cls = [VestaWin]::Cls($k)
        $item = [pscustomobject]@{
          hwnd = [long]$k
          class = $cls
          id = [VestaWin]::Id($k)
          text = [VestaWin]::Txt($k)
          enabled = [VestaWin]::IsWindowEnabled($k)
          visible = [VestaWin]::IsWindowVisible($k)
        }
        if ($cls -eq 'Button') { $item | Add-Member -NotePropertyName check -NotePropertyValue ([VestaWin]::CheckState($k)) }
        $list += $item
      }
      $payload = [pscustomobject]@{ ok = $true; controls = $list }
    }
    'click' {
      $r = [VestaWin]::Click([IntPtr]$Hwnd)
      $payload = [pscustomobject]@{ ok = $true; sent = $r }
    }
    'settext' {
      [VestaWin]::SetText([IntPtr]$Hwnd, $Text)
      $payload = [pscustomobject]@{ ok = $true; text = [VestaWin]::Txt([IntPtr]$Hwnd) }
    }
    'text' {
      # 列出有文字的控件（VESTA 的 Text Area 就在这里），按文字长度倒序
      $rows = @()
      foreach ($k in [VestaWin]::Kids([IntPtr]$Hwnd)) {
        $cls = [VestaWin]::Cls($k)
        $t = [VestaWin]::ReadText($k)
        if ($null -ne $t -and $t.Trim().Length -gt 0) {
          $rows += [pscustomobject]@{ hwnd = [long]$k; class = $cls; length = $t.Length; text = $t }
        }
      }
      $payload = [pscustomobject]@{ ok = $true; controls = @($rows | Sort-Object length -Descending) }
    }

    'viewport' {
      $main = [IntPtr]::Zero
      foreach ($w in [VestaWin]::Tops([uint32]$ProcId)) {
        if ([VestaWin]::Txt($w) -like '*- VESTA') { $main = $w; break }
      }
      if ($main -eq [IntPtr]::Zero) {
        $payload = [pscustomobject]@{ ok = $false; error = 'no-main-window' }
      } else {
        $gl = [VestaWin]::Gl($main)
        $payload = [pscustomobject]@{
          ok = ($gl -ne [IntPtr]::Zero); hwnd = [long]$main; gl = [long]$gl
          client = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::ClientSize($gl) } else { '' }
          dpi = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::Dpi($gl) } else { '' }
          title = [VestaWin]::Txt($main)
        }
      }
    }
    'gl' {
      $gl = [VestaWin]::Gl([IntPtr]$Hwnd)
      $payload = [pscustomobject]@{
        ok = ($gl -ne [IntPtr]::Zero)
        gl = [long]$gl
        client = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::ClientSize($gl) } else { '' }
        dpi = if ($gl -ne [IntPtr]::Zero) { [VestaWin]::Dpi($gl) } else { '' }
      }
    }
    'drag' {
      $gl = if ($Hwnd -ne 0) { [IntPtr]$Hwnd } else { [VestaWin]::Gl([IntPtr]$Hwnd) }
      $rect = [VestaWin]::ClientSize($gl)
      $parts = $rect -split 'x'
      $w = [int]$parts[0]; $h = [int]$parts[1]
      $fromX = if ($X -ge 0) { $X } else { [int]($w / 2) }
      $fromY = if ($Y -ge 0) { $Y } else { [int]($h / 2) }
      $toX = if ($ToX -ge 0) { $ToX } else { $fromX + 120 }
      $toY = if ($ToY -ge 0) { $ToY } else { $fromY }
      [VestaWin]::Drag($gl, $fromX, $fromY, $toX, $toY, $Steps) | Out-Null
      $payload = [pscustomobject]@{ ok = $true; gl = [long]$gl; from = "$fromX,$fromY"; to = "$toX,$toY"; client = $rect }
    }
    'wheel' {
      $gl = [IntPtr]$Hwnd
      $rect = [VestaWin]::ClientSize($gl)
      $parts = $rect -split 'x'
      $cx = if ($X -ge 0) { $X } else { [int]([int]$parts[0] / 2) }
      $cy = if ($Y -ge 0) { $Y } else { [int]([int]$parts[1] / 2) }
      [VestaWin]::Wheel($gl, $Delta, $Count, $cx, $cy) | Out-Null
      $payload = [pscustomobject]@{ ok = $true; alpha = $Delta; count = $Count; client = $rect }
    }
    'key' {
      $top = [IntPtr]$Hwnd
      $gl = [VestaWin]::Gl($top)
      $target = if ($gl -ne [IntPtr]::Zero) { $gl } else { $top }
      [VestaWin]::Key($top, $target, $Key, $Count, [bool]$Ctrl) | Out-Null
      $payload = [pscustomobject]@{ ok = $true; vk = $Key; count = $Count; ctrl = [bool]$Ctrl }
    }
    'tree' {
      $rows = [VestaWin]::Tree([IntPtr]$Hwnd)
      $payload = [pscustomobject]@{ ok = $true; rows = $rows }
    }
    'clickat' {
      $gl = [IntPtr]$Hwnd
      $rect = [VestaWin]::ClientSize($gl)
      $parts = $rect -split 'x'
      $cx = if ($X -ge 0) { $X } else { [int]([int]$parts[0] / 2) }
      $cy = if ($Y -ge 0) { $Y } else { [int]([int]$parts[1] / 2) }
      [VestaWin]::ClickAt([IntPtr]$Hwnd, $cx, $cy) | Out-Null
      $payload = [pscustomobject]@{ ok = $true; at = "$cx,$cy"; client = $rect }
    }
    'type' {
      # 真实键盘输入：置前后用 SendKeys 逐字打字（对话框文件名等场景）
      Add-Type -AssemblyName System.Windows.Forms
      [VestaWin]::Focus([IntPtr]$Hwnd)
      Start-Sleep -Milliseconds 250
      if ($Enter) { [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
      [System.Windows.Forms.SendKeys]::SendWait($Text)
      if ($Enter) { Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait("{ENTER}") }
      $payload = [pscustomobject]@{ ok = $true; typed = $Text.Length }
    }

    'host' {
      # 常驻模式：stdin 一行一个 JSON 请求，stdout 一行一个 JSON 响应。
      # 关键收益：Add-Type 只编译一次，单次动作从 ~14 s 降到几十毫秒。
      $stdout = [Console]::Out
      [Console]::In.ReadLine() | Out-Null  # 预热行（可省略）
      $stdout.WriteLine(([pscustomobject]@{ ok = $true; ready = $true; pid = $PID } | ConvertTo-Json -Compress))
      $stdout.Flush()
      while ($true) {
        $line = [Console]::In.ReadLine()
        if ($null -eq $line) { break }
        if ($line.Trim() -eq '') { continue }
        try {
          $req = $line | ConvertFrom-Json
          $res = Invoke-VestaRequest $req
        } catch {
          $res = [pscustomobject]@{ ok = $false; error = $_.Exception.Message }
        }
        $stdout.WriteLine(($res | ConvertTo-Json -Depth 6 -Compress))
        $stdout.Flush()
      }
      $payload = [pscustomobject]@{ ok = $true; closed = $true }
    }

    'capture' {
      $res = [VestaWin]::Grab([IntPtr]$Hwnd, $Out)
      $payload = [pscustomobject]@{ ok = ($res -match '^\d+x\d+$'); size = $res; path = $Out }
    }
    default {
      $payload = [pscustomobject]@{ ok = $false; error = "unknown action: $Action" }
    }
  }
  $payload | ConvertTo-Json -Depth 6 -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
