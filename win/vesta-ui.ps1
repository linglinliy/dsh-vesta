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
param(
  [Parameter(Mandatory = $true)][string]$Action,
  [int]$ProcId = 0,
  [long]$Hwnd = 0,
  [int]$CommandId = 0,
  [string]$Text = '',
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
# stdout 必须是 UTF-8：中文/符号（λ、Å）经控制台默认编码会被毁掉，控件匹配就失效。
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

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
