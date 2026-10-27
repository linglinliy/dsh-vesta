# 固定几何 + 自校验的窗口截图。
#   - 先把窗口恢复到固定位置/尺寸（默认 1280x900 @ 10,10），保证每次截图一致
#   - 优先 PrintWindow(PW_RENDERFULLCONTENT)：窗口被遮挡也能抓到
#   - 若抓到空白（GL 画布常见），自动退回屏幕抓取（先置前）
#   - 返回尺寸与“着墨率”，用于自校验
param(
  [Parameter(Mandatory = $true)][long]$Hwnd,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Width = 1280,
  [int]$Height = 900,
  [int]$X = 10,
  [int]$Y = 10
)

Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Shot2 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int ht, bool repaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@ -ErrorAction SilentlyContinue

$h = [IntPtr]$Hwnd
[Shot2]::ShowWindow($h, 9) | Out-Null          # SW_RESTORE
Start-Sleep -Milliseconds 250
[Shot2]::MoveWindow($h, $X, $Y, $Width, $Height, $true) | Out-Null
Start-Sleep -Milliseconds 350
[Shot2]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 450

$r = New-Object Shot2+RECT
[Shot2]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Right - $r.Left
$ht = $r.Bottom - $r.Top
if ($w -lt 200 -or $ht -lt 200) { "BAD_RECT ${w}x${ht}"; exit 1 }

function Measure-Ink($bmp) {
  $nonBg = 0; $total = 0
  for ($yy = 0; $yy -lt $bmp.Height; $yy += 7) {
    for ($xx = 0; $xx -lt $bmp.Width; $xx += 7) {
      $c = $bmp.GetPixel($xx, $yy)
      $total++
      if ([Math]::Abs($c.R - 240) -gt 18 -or [Math]::Abs($c.G - 240) -gt 18 -or [Math]::Abs($c.B - 240) -gt 18) { $nonBg++ }
    }
  }
  if ($total -eq 0) { return 0 }
  return [Math]::Round($nonBg / $total, 4)
}

$method = 'printwindow'
$bmp = New-Object System.Drawing.Bitmap($w, $ht)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$hdc = $g.GetHdc()
$ok = [Shot2]::PrintWindow($h, $hdc, 2)      # PW_RENDERFULLCONTENT
$g.ReleaseHdc($hdc)
$ink = Measure-Ink $bmp

if (-not $ok -or $ink -lt 0.06) {
  # 退回屏幕抓取
  $g.Dispose(); $bmp.Dispose()
  $method = 'screen'
  [Shot2]::SetForegroundWindow($h) | Out-Null
  Start-Sleep -Milliseconds 450
  $bmp = New-Object System.Drawing.Bitmap($w, $ht)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, (New-Object System.Drawing.Size($w, $ht)))
  $ink = Measure-Ink $bmp
}

$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

[pscustomobject]@{
  ok = $true
  method = $method
  width = $w
  height = $ht
  ink = $ink
  out = $Out
} | ConvertTo-Json -Compress
