param(
  [string]$Target = 'D:\calcf\verify\export-real-png.png',
  [string]$OutJson = 'D:\calcf\verify\export-png.json'
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class EX2 {
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
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
  public static extern IntPtr SendMessageSB(IntPtr h, uint m, IntPtr w, StringBuilder l);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
  delegate bool EnumProc(IntPtr h, IntPtr p);

  static string want; static IntPtr found;
  static bool Collect(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var t = new StringBuilder(256); GetWindowText(h, t, 256);
    if (t.ToString().Contains(want)) { found = h; return false; }
    return true;
  }
  public static IntPtr Find(string match) { want = match; found = IntPtr.Zero; EnumWindows(Collect, IntPtr.Zero); return found; }

  public static string Kids(IntPtr dlg) {
    var list = new List<IntPtr>();
    EnumChildWindows(dlg, (h, p) => { list.Add(h); return true; }, IntPtr.Zero);
    var sb = new StringBuilder();
    foreach (var h in list) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      RECT r; GetWindowRect(h, out r);
      var txt = new StringBuilder(128); GetWindowText(h, txt, 128);
      sb.Append(cls + "|" + h.ToInt64() + "|" + r.Left + "|" + r.Top + "|" + (r.Right-r.Left) + "|" + (r.Bottom-r.Top) + "|" + txt + "\n");
    }
    return sb.ToString();
  }

  public static int ComboCount(IntPtr c) { return (int)SendMessage(c, 0x0146, IntPtr.Zero, IntPtr.Zero); }
  public static string ComboItem(IntPtr c, int i) { var b = new StringBuilder(256); SendMessageSB(c, 0x0148, (IntPtr)i, b); return b.ToString(); }

  // 选中下拉项并通知父窗口
  public static string SelectIndex(IntPtr combo, IntPtr parent, int index) {
    SendMessage(combo, 0x014E, (IntPtr)index, IntPtr.Zero);       // CB_SETCURSEL
    int id = GetDlgCtrlID(combo);
    int wparam = (1 << 16) | (id & 0xFFFF);                        // CBN_SELCHANGE = 1
    PostMessage(parent, 0x0111, (IntPtr)wparam, combo);            // WM_COMMAND
    System.Threading.Thread.Sleep(300);
    return "id=" + id + " set=" + index;
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
function L($s) { [void]$log.Add([string]$s); Write-Output $s }

$root = [EX2]::Find('VESTA')
if ($root -eq [IntPtr]::Zero) { L 'no-vesta'; $log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8; exit 1 }
[EX2]::PostMessage($root, 0x0111, [IntPtr]104, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 2600
$dlg = [EX2]::Find('Export Raster Image')
if ($dlg -eq [IntPtr]::Zero) { L 'no-dialog'; $log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8; exit 1 }
$kids = [EX2]::Kids($dlg) -split "`n" | Where-Object { $_ }

$combo = [IntPtr]::Zero
$edit = [IntPtr]::Zero
foreach ($line in $kids) {
  $p = $line -split '\|'
  if ($p[0] -eq 'ComboBox') {
    $c = [IntPtr][long]$p[1]
    $n = [EX2]::ComboCount($c)
    if ($n -gt 0 -and $combo -eq [IntPtr]::Zero) { $combo = $c; L ("format-combo=" + $c.ToInt64() + " items=" + $n + " first=" + [EX2]::ComboItem($c, 0)) }
  }
  if ($p[0] -eq 'Edit' -and $edit -eq [IntPtr]::Zero) { $edit = [IntPtr][long]$p[1] }
}
if ($combo -eq [IntPtr]::Zero) { L 'no-format-combo'; $log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8; exit 1 }

# 找 PNG 的索引
$pngIndex = -1
for ($i = 0; $i -lt [EX2]::ComboCount($combo); $i++) {
  if ([EX2]::ComboItem($combo, $i) -match 'PNG') { $pngIndex = $i; break }
}
L ("png-index=" + $pngIndex)
if ($pngIndex -ge 0) { L ([EX2]::SelectIndex($combo, $dlg, $pngIndex)) }

if ($edit -ne [IntPtr]::Zero) {
  L ("click-edit=" + [EX2]::ClickCenter($edit))
  L ([EX2]::CtrlA())
  L ([EX2]::TypeText($Target))
  Start-Sleep -Milliseconds 300
  L ([EX2]::Enter())
}
Start-Sleep -Milliseconds 1500

for ($i = 0; $i -lt 3; $i++) {
  $follow = [EX2]::Find('Export image')
  if ($follow -eq [IntPtr]::Zero) { $follow = [EX2]::Find('Export Graphics') }
  if ($follow -eq [IntPtr]::Zero) { break }
  L ("followup=" + $follow.ToInt64())
  $ok = [IntPtr]::Zero
  foreach ($line in ([EX2]::Kids($follow) -split "`n" | Where-Object { $_ })) {
    $p = $line -split '\|'
    if ($p[0] -eq 'Button' -and $p[6] -match '^OK$') { $ok = [IntPtr][long]$p[1] }
  }
  if ($ok -ne [IntPtr]::Zero) { [EX2]::PostMessage($ok, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; L 'clicked-OK'; Start-Sleep -Milliseconds 1800 }
  else { L 'no-OK'; break }
}

$exists = Test-Path $Target
$size = if ($exists) { (Get-Item $Target).Length } else { 0 }
$head = ''
if ($exists -and $size -ge 8) { $b = [System.IO.File]::ReadAllBytes($Target); $head = [BitConverter]::ToString($b[0..7]) }
L ("file=" + $exists + " size=" + $size + " head=" + $head)
$log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8
