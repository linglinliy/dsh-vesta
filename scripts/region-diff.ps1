param(
  [Parameter(Mandatory = $true)][string]$PathA,
  [Parameter(Mandatory = $true)][string]$PathB,
  [Parameter(Mandatory = $true)][int]$X,
  [Parameter(Mandatory = $true)][int]$Y,
  [Parameter(Mandatory = $true)][int]$W,
  [Parameter(Mandatory = $true)][int]$H
)

# 比较两张 PNG 在给定矩形内的差异（真实解码像素）
Add-Type -AssemblyName System.Drawing
$bmpA = New-Object System.Drawing.Bitmap($PathA)
$bmpB = New-Object System.Drawing.Bitmap($PathB)

$x0 = [Math]::Max(0, [Math]::Min($X, $bmpA.Width - 1))
$y0 = [Math]::Max(0, [Math]::Min($Y, $bmpA.Height - 1))
$x1 = [Math]::Min($bmpA.Width, $x0 + $W)
$y1 = [Math]::Min($bmpA.Height, $y0 + $H)

$diff = 0; $total = 0; $sumA = 0.0; $sumB = 0.0
for ($y = $y0; $y -lt $y1; $y++) {
  for ($x = $x0; $x -lt $x1; $x++) {
    $pa = $bmpA.GetPixel($x, $y); $pb = $bmpB.GetPixel($x, $y)
    $sumA += ($pa.R + $pa.G + $pa.B) / 3.0
    $sumB += ($pb.R + $pb.G + $pb.B) / 3.0
    $total++
    if ([Math]::Abs($pa.R - $pb.R) -gt 20 -or [Math]::Abs($pa.G - $pb.G) -gt 20 -or [Math]::Abs($pa.B - $pb.B) -gt 20) { $diff++ }
  }
}
$bmpA.Dispose(); $bmpB.Dispose()

$out = [ordered]@{
  box = @{ x = $x0; y = $y0; w = ($x1 - $x0); h = ($y1 - $y0) }
  pixels = $total
  diffPixels = $diff
  diffRatio = if ($total -gt 0) { [Math]::Round($diff / $total, 4) } else { 0 }
  meanA = if ($total -gt 0) { [Math]::Round($sumA / $total, 2) } else { 0 }
  meanB = if ($total -gt 0) { [Math]::Round($sumB / $total, 2) } else { 0 }
}
$out | ConvertTo-Json -Depth 4
