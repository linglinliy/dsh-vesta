param(
  [string]$Target = 'D:\calcf\verify\export-real.png',
  [string]$OutJson = 'D:\calcf\verify\export.json'
)

# 状态机：打开 Export Raster Image -> 枚举文件类型下拉框 -> 选 PNG -> 填路径 -> 保存 -> 处理后续选项框
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class EX {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, Size = 40)] public struct INPUT { public uint type; public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, IntPtr e);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] a, int size);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageStr(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  delegate bool EnumProc(IntPtr h, IntPtr p);

  static string want; static bool exact; static IntPtr found;
  static bool Collect(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var t = new StringBuilder(256); GetWindowText(h, t, 256);
    string s = t.ToString();
    if (exact ? s == want : s.Contains(want)) { found = h; return false; }
    return true;
  }
  public static string Find(string match, bool ex) {
    want = match; exact = ex; found = IntPtr.Zero;
    EnumWindows(Collect, IntPtr.Zero);
    return found == IntPtr.Zero ? "" : found.ToInt64().ToString();
  }
  public static IntPtr H() { return found; }

  public static string Titles() {
    var sb = new StringBuilder();
    found = IntPtr.Zero; want = "Export"; exact = false;
    EnumWindows(Collect, IntPtr.Zero);
    return found == IntPtr.Zero ? "" : found.ToInt64().ToString();
  }

  // 枚举子控件，返回 "class|hwnd|left|top|w|h" 列表
  public static string Kids(IntPtr dlg) {
    var list = new List<IntPtr>();
    EnumChildWindows(dlg, (h, p) => { list.Add(h); return true; }, IntPtr.Zero);
    var sb = new StringBuilder();
    foreach (var h in list) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      RECT r; GetWindowRect(h, out r);
      sb.Append(cls + "|" + h.ToInt64() + "|" + r.Left + "|" + r.Top + "|" + (r.Right-r.Left) + "|" + (r.Bottom-r.Top) + "\n");
    }
    return sb.ToString();
  }

  public static string ComboItems(IntPtr combo) {
    int n = (int)SendMessage(combo, 0x0146, IntPtr.Zero, IntPtr.Zero);  // CB_GETCOUNT
    var sb = new StringBuilder();
    for (int i = 0; i < n; i++) {
      var buf = new StringBuilder(256);
      SendMessageStr(combo, 0x0148, (IntPtr)i, null);  // 需要可写缓冲，改用 GetWindowText 兜底
      int len = (int)SendMessage(combo, 0x0149, (IntPtr)i, IntPtr.Zero); // CB_GETLBTEXTLEN
      sb.Append(i + ":" + len + " ");
    }
    return "count=" + n + " lens=" + sb;
  }

  public static string ComboText(IntPtr combo) {
    int n = (int)SendMessage(combo, 0x0146, IntPtr.Zero, IntPtr.Zero);
    int cur = (int)SendMessage(combo, 0x0147, IntPtr.Zero, IntPtr.Zero);  // CB_GETCURSEL
    var sb = new StringBuilder("count=" + n + " cur=" + cur);
    return sb.ToString();
  }

  public static bool SelectByText(IntPtr combo, string text) {
    IntPtr idx = SendMessageStr(combo, 0x0158, (IntPtr)(-1), text);  // CB_FINDSTRINGEXACT
    if (idx.ToInt64() < 0) return false;
    SendMessage(combo, 0x014E, idx, IntPtr.Zero);  // CB_SETCURSEL
    SendMessage(GetParent(combo), 0x0111, (IntPtr)1, combo);  // CBN_SELCHANGE
    return true;
  }

  public static string ClickCenter(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    int x = (r.Left + r.Right) / 2, y = (r.Top + r.Bottom) / 2;
    SetCursorPos(x, y); System.Threading.Thread.Sleep(150);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(350);
    return x + "," + y;
  }

  public static string CtrlA() {
    INPUT[] a = new INPUT[4];
    a[0].type = 1; a[0].ki.wVk = 0x11;
    a[1].type = 1; a[1].ki.wVk = 0x41;
    a[2].type = 1; a[2].ki.wVk = 0x41; a[2].ki.dwFlags = 2;
    a[3].type = 1; a[3].ki.wVk = 0x11; a[3].ki.dwFlags = 2;
    SendInput(4, a, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(250);
    return "ok";
  }

  public static string TypeText(string text) {
    int ok = 0;
    foreach (char ch in text) {
      INPUT[] d = new INPUT[1]; d[0].type = 1; d[0].ki.wScan = (ushort)ch; d[0].ki.dwFlags = 4;
      INPUT[] u = new INPUT[1]; u[0].type = 1; u[0].ki.wScan = (ushort)ch; u[0].ki.dwFlags = 6;
      if (SendInput(1, d, Marshal.SizeOf(typeof(INPUT))) == 1 && SendInput(1, u, Marshal.SizeOf(typeof(INPUT))) == 1) ok++;
      System.Threading.Thread.Sleep(6);
    }
    return "typed=" + ok + "/" + text.Length;
  }

  public static string Enter() {
    INPUT[] d = new INPUT[1]; d[0].type = 1; d[0].ki.wVk = 0x0D;
    INPUT[] u = new INPUT[1]; u[0].type = 1; u[0].ki.wVk = 0x0D; u[0].ki.dwFlags = 2;
    SendInput(1, d, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(70);
    SendInput(1, u, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(1500);
    return "ok";
  }
}
'@ -ErrorAction SilentlyContinue

$log = New-Object System.Collections.ArrayList
function Add-Log($s) { [void]$log.Add($s); Write-Output $s }

$main = [EX]::Find('VESTA', $false)
if (-not $main) { Add-Log 'no-vesta'; exit 1 }
$mainHwnd = [IntPtr][long]$main
[void][EX]::SetForegroundWindow($mainHwnd)
Start-Sleep -Milliseconds 300
[EX]::PostMessage($mainHwnd, 0x0111, [IntPtr]104, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 2600

$dlgRaw = [EX]::Titles()
Add-Log "dialog=$dlgRaw"
if (-not $dlgRaw) { $log | ConvertTo-Json | Set-Content -Path $OutJson -Encoding UTF8; exit 1 }
$dlg = [IntPtr][long]$dlgRaw
$kids = [EX]::Kids($dlg)
$kidLines = $kids -split "`n" | Where-Object { $_ }
Add-Log ("controls=" + $kidLines.Count)

$combo = $null
$edit = $null
$save = $null
foreach ($line in $kidLines) {
  $p = $line -split '\|'
  if ($p[0] -eq 'ComboBox' -and -not $combo) { $combo = [IntPtr][long]$p[1] }
  if ($p[0] -eq 'Edit' -and -not $edit) { $edit = [IntPtr][long]$p[1] }
  if ($p[0] -eq 'Button' -and $p[1] -and -not $save) { }
}
foreach ($line in $kidLines) {
  $p = $line -split '\|'
  $h = [IntPtr][long]$p[1]
  $txt = New-Object System.Text.StringBuilder 128
  [void][EX]::GetWindowText($h, $txt, 128)
  if ($p[0] -eq 'Button' -and ($txt.ToString() -match '保存|Save')) { $save = $h }
  if ($p[0] -eq 'ComboBox' -and -not $combo) { $combo = $h }
  if ($p[0] -eq 'Edit' -and -not $edit) { $edit = $h }
}
Add-Log ("combo=" + ($(if ($combo) { $combo.ToInt64() } else { 'none' })) + " edit=" + ($(if ($edit) { $edit.ToInt64() } else { 'none' })) + " save=" + ($(if ($save) { $save.ToInt64() } else { 'none' })))

if ($combo) {
  Add-Log ("combo-info: " + [EX]::ComboText($combo))
  $sel = [EX]::SelectByText($combo, 'PNG')
  Add-Log ("select PNG: " + $sel)
  Add-Log ("combo-after: " + [EX]::ComboText($combo))
}
if ($edit) {
  Add-Log ("click edit: " + [EX]::ClickCenter($edit))
  Add-Log ("ctrl+a: " + [EX]::CtrlA())
  Add-Log ("type: " + [EX]::TypeText($Target))
  Start-Sleep -Milliseconds 300
  Add-Log ("enter: " + [EX]::Enter())
}
Start-Sleep -Milliseconds 1500

# 后续可能出现的选项框（Export image / Export Graphics）
for ($i = 0; $i -lt 3; $i++) {
  $d2raw = [EX]::Find('Export image', $true)
  if (-not $d2raw) { $d2raw = [EX]::Find('Export Graphics', $true) }
  if (-not $d2raw) { break }
  $d2 = [IntPtr][long]$d2raw
  Add-Log ("followup=" + $d2raw)
  $kids2 = [EX]::Kids($d2) -split "`n" | Where-Object { $_ }
  $okBtn = $null
  foreach ($line in $kids2) {
    $p = $line -split '\|'
    if ($p[0] -ne 'Button') { continue }
    $txt = New-Object System.Text.StringBuilder 128
    [void][EX]::GetWindowText([IntPtr][long]$p[1], $txt, 128)
    if ($txt.ToString() -match '^OK$') { $okBtn = [IntPtr][long]$p[1] }
  }
  if ($okBtn) { [EX]::PostMessage($okBtn, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; Add-Log 'clicked OK'; Start-Sleep -Milliseconds 1800 }
  else { Add-Log 'no OK button'; break }
}

$exists = Test-Path $Target
$size = if ($exists) { (Get-Item $Target).Length } else { 0 }
$head = ''
if ($exists -and $size -ge 8) {
  $bytes = [System.IO.File]::ReadAllBytes($Target)
  $head = [BitConverter]::ToString($bytes[0..7])
}
Add-Log ("file=" + $exists + " size=" + $size + " head=" + $head)

$log | ConvertTo-Json | Set-Content -Path $OutJson -Encoding UTF8
