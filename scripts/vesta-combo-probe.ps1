param(
  [string]$OutJson = 'D:\calcf\verify\combo-probe.json'
)

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class CP {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc cb, IntPtr p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageW")]
  public static extern IntPtr SendMessageSB(IntPtr h, uint m, IntPtr w, StringBuilder l);
  delegate bool EnumProc(IntPtr h, IntPtr p);

  static string want; static IntPtr found;
  static bool Collect(IntPtr h, IntPtr p) {
    if (!IsWindowVisible(h)) return true;
    var t = new StringBuilder(256); GetWindowText(h, t, 256);
    if (t.ToString().Contains(want)) { found = h; return false; }
    return true;
  }
  public static IntPtr Find(string match) { want = match; found = IntPtr.Zero; EnumWindows(Collect, IntPtr.Zero); return found; }

  public static string Dump(IntPtr dlg) {
    var kids = new List<IntPtr>();
    EnumChildWindows(dlg, (h, p) => { kids.Add(h); return true; }, IntPtr.Zero);
    var sb = new StringBuilder();
    foreach (var h in kids) {
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() != "ComboBox" && cls.ToString() != "ComboBoxEx32") continue;
      RECT r; GetWindowRect(h, out r);
      int count = (int)SendMessage(h, 0x0146, IntPtr.Zero, IntPtr.Zero);
      int cur = (int)SendMessage(h, 0x0147, IntPtr.Zero, IntPtr.Zero);
      sb.Append(cls + "|" + h.ToInt64() + "|" + r.Left + "," + r.Top + "|" + (r.Right-r.Left) + "x" + (r.Bottom-r.Top) + "|count=" + count + "|cur=" + cur);
      int limit = count < 12 ? count : 12;
      for (int i = 0; i < limit; i++) {
        var buf = new StringBuilder(256);
        SendMessageSB(h, 0x0148, (IntPtr)i, buf);
        sb.Append("|" + i + "=" + buf);
      }
      sb.Append("\n");
    }
    return sb.ToString();
  }
}
'@ -ErrorAction SilentlyContinue

$main = New-Object System.Text.StringBuilder 256
$root = [CP]::Find('VESTA')
if ($root -eq [IntPtr]::Zero) { '{"error":"no-vesta"}' | Set-Content $OutJson -Encoding UTF8; exit 1 }
[CP]::PostMessage($root, 0x0111, [IntPtr]104, [IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 2600

$dlg = [CP]::Find('Export Raster Image')
$dump = if ($dlg -ne [IntPtr]::Zero) { [CP]::Dump($dlg) } else { 'no-dialog' }
$payload = @{ dlg = $dlg.ToInt64(); dump = $dump } | ConvertTo-Json
$payload | Set-Content -Path $OutJson -Encoding UTF8
$dump
