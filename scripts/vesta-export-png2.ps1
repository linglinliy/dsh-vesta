param(
  [string]$Target = 'D:\calcf\verify\export-real-png.png',
  [string]$OutJson = 'D:\calcf\verify\export-png2.json'
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class EX3 {
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
  delegate bool EnumProc(IntPtr h, IntPtr p);

  static string want; static IntPtr found;
  static bool Collect(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var t = new StringBuilder(256); GetWindowText(h, t, 256);
    if (t.ToString().Contains(want)) { found = h; return false; }
    return true;
  }
  public static IntPtr Find(string match) { want = match; found = IntPtr.Zero; EnumWindows(Collect, IntPtr.Zero); return found; }

  public static string FindComboWithItems(IntPtr dlg, out IntPtr combo) {
    var list = new List<IntPtr>();
    EnumChildWindows(dlg, (h, p) => { list.Add(h); return true; }, IntPtr.Zero);
    combo = IntPtr.Zero;
    foreach (var h in list) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() != "ComboBox") continue;
      int n = (int)SendMessage(h, 0x0146, IntPtr.Zero, IntPtr.Zero);
      if (n > 0) { combo = h; return "combo=" + h.ToInt64() + " items=" + n + " cur=" + (int)SendMessage(h, 0x0147, IntPtr.Zero, IntPtr.Zero); }
    }
    return "none";
  }
  public static int GetCur(IntPtr combo) { return (int)SendMessage(combo, 0x0147, IntPtr.Zero, IntPtr.Zero); }

  public static string ClickCenter(IntPtr h) {
    RECT r; GetWindowRect(h, out r);
    int x = (r.Left + r.Right) / 2, y = (r.Top + r.Bottom) / 2;
    SetCursorPos(x, y); System.Threading.Thread.Sleep(180);
    mouse_event(0x0002, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(70);
    mouse_event(0x0004, 0, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(500);
    return x + "," + y;
  }

  public static string Keys(string vks) {
    foreach (var part in vks.Split(',')) {
      var s = part.Trim();
      int vk = s.StartsWith("0x", StringComparison.OrdinalIgnoreCase) ? Convert.ToInt32(s.Substring(2), 16) : Convert.ToInt32(s);
      INPUT[] d = new INPUT[1]; d[0].type = 1; d[0].ki.wVk = (ushort)vk;
      INPUT[] u = new INPUT[1]; u[0].type = 1; u[0].ki.wVk = (ushort)vk; u[0].ki.dwFlags = 2;
      SendInput(1, d, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(40);
      SendInput(1, u, Marshal.SizeOf(typeof(INPUT)));
      System.Threading.Thread.Sleep(140);
    }
    return "keys=" + vks;
  }

  public static string CtrlA() {
    INPUT[] a = new INPUT[4];
    a[0].type = 1; a[0].ki.wVk = 0x11;
    a[1].type = 1; a[1].ki.wVk = 0x41;
    a[2].type = 1; a[2].ki.wVk = 0x41; a[2].ki.dwFlags = 2;
    a[3].type = 1; a[3].ki.wVk = 0x11; a[3].ki.dwFlags = 2;
    SendInput(4, a, Marshal.SizeOf(typeof(INPUT)));
    System.Threading.Thread.Sleep(250);
    return "ctrl+a";
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
    System.Threading.Thread.Sleep(1200);
    return "enter";
  }

  public static string FirstEdit(IntPtr dlg, out IntPtr edit) {
    var list = new List<IntPtr>();
    EnumChildWindows(dlg, (h, p) => { list.Add(h); return true; }, IntPtr.Zero);
    edit = IntPtr.Zero;
    foreach (var h in list) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() == "Edit") { edit = h; break; }
    }
    return edit == IntPtr.Zero ? "none" : edit.ToInt64().ToString();
  }
}
'@ -ErrorAction SilentlyContinue

$log = New-Object System.Collections.ArrayList
function L($s) { [void]$log.Add([string]$s); Write-Output $s }

[EX3]::Keys('0x1B') | Out-Null
Start-Sleep -Milliseconds 400
$root = [EX3]::Find('VESTA')
if ($root -eq [IntPtr]::Zero) { L 'no-vesta'; exit 1 }
[EX3]::PostMessage($root, 0x0111, [IntPtr]104, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 2600
$dlg = [EX3]::Find('Export Raster Image')
if ($dlg -eq [IntPtr]::Zero) { L 'no-dialog'; $log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8; exit 1 }

$combo = [IntPtr]::Zero
L ([EX3]::FindComboWithItems($dlg, [ref]$combo))
L ("before cur=" + [EX3]::GetCur($combo))
L ("click-combo=" + [EX3]::ClickCenter($combo))
Start-Sleep -Milliseconds 400
L ([EX3]::Keys('0x24'))
L ([EX3]::Keys('0x28,0x28,0x28,0x28'))
L ([EX3]::Keys('0x0D'))
Start-Sleep -Milliseconds 500
L ("after cur=" + [EX3]::GetCur($combo))

$edit = [IntPtr]::Zero
L ("edit=" + [EX3]::FirstEdit($dlg, [ref]$edit))
if ($edit -ne [IntPtr]::Zero) {
  L ("click-edit=" + [EX3]::ClickCenter($edit))
  L ([EX3]::CtrlA())
  L ([EX3]::TypeText($Target))
  Start-Sleep -Milliseconds 300
  L ([EX3]::Enter())
}
Start-Sleep -Milliseconds 2000

# 后续选项框：直接回车（默认按钮是 OK）
for ($i = 0; $i -lt 3; $i++) {
  $follow = [EX3]::Find('Export image')
  if ($follow -eq [IntPtr]::Zero) { $follow = [EX3]::Find('Export Graphics') }
  if ($follow -eq [IntPtr]::Zero) { break }
  L ("followup=" + $follow.ToInt64() + " -> Enter")
  [EX3]::SetForegroundWindow($follow) | Out-Null
  Start-Sleep -Milliseconds 200
  [EX3]::Enter() | Out-Null
  Start-Sleep -Milliseconds 1500
}

$exists = Test-Path $Target
$size = if ($exists) { (Get-Item $Target).Length } else { 0 }
$head = ''
if ($exists -and $size -ge 8) { $b = [System.IO.File]::ReadAllBytes($Target); $head = [BitConverter]::ToString($b[0..7]) }
L ("file=" + $exists + " size=" + $size + " head=" + $head)
$log | ConvertTo-Json | Set-Content $OutJson -Encoding UTF8
