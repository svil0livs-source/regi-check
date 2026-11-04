# 시험용 등기부등본(스캔본처럼 보이는 이미지 PDF) 20개를 만든다. (PLAN 5번)
# 먼저 node scripts/fixtures/cases.mjs 로 tests/fixtures-build/cases.json 을 만든 뒤 실행한다.
# Windows 기본 그림 기능(System.Drawing)으로 그리고, 살짝 기울이고 잡티를 넣어 스캔처럼 만든 뒤 JPEG로 PDF에 넣는다.
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fixtures/make-registry-pdf.ps1

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$fixtures = Join-Path $root "tests\fixtures"
$cases = Get-Content (Join-Path $root "tests\fixtures-build\cases.json") -Encoding UTF8 -Raw | ConvertFrom-Json

# A4, 200dpi
$W = 1654; $H = 2339
$fontName = "굴림"
# 본문 약 10pt (실제 등기부와 비슷한 크기, 200dpi 기준 28px)
$fBody = New-Object System.Drawing.Font($fontName, 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fBold = New-Object System.Drawing.Font($fontName, 28, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fTitle = New-Object System.Drawing.Font($fontName, 34, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$fMark = New-Object System.Drawing.Font($fontName, 90, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(35, 35, 35))
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60, 60, 60)), 1.6
$shade = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(232, 232, 232))

# 칸 안에서 글자를 폭에 맞게 줄바꿈한다 ("\n"은 강제 줄바꿈)
function Wrap($g, [string]$text, $font, [float]$width) {
  $lines = New-Object System.Collections.Generic.List[string]
  foreach ($para in ($text -split "`n")) {
    $cur = ""
    foreach ($ch in $para.ToCharArray()) {
      $try = $cur + $ch
      if ($g.MeasureString($try, $font).Width -gt $width -and $cur.Length -gt 0) { $lines.Add($cur); $cur = "$ch" } else { $cur = $try }
    }
    $lines.Add($cur)
  }
  return ,$lines
}

# 표 하나를 그리고 다음 y를 돌려준다
function DrawTable($g, [float]$x, [float]$y, [float[]]$widths, $header, $rows) {
  $lineH = 38
  $all = @(,$header) + $rows
  for ($r = 0; $r -lt $all.Count; $r++) {
    $cells = $all[$r]
    $wrapped = @(); $maxLines = 1
    for ($c = 0; $c -lt $widths.Count; $c++) {
      $font = if ($r -eq 0) { $fBold } else { $fBody }
      $wl = Wrap $g ([string]$cells[$c]) $font ($widths[$c] - 14)
      $wrapped += ,$wl
      if ($wl.Count -gt $maxLines) { $maxLines = $wl.Count }
    }
    $rowH = $maxLines * $lineH + 14
    $cx = $x
    for ($c = 0; $c -lt $widths.Count; $c++) {
      if ($r -eq 0) { $g.FillRectangle($shade, $cx, $y, $widths[$c], $rowH) }
      $g.DrawRectangle($pen, $cx, $y, $widths[$c], $rowH)
      $font = if ($r -eq 0) { $fBold } else { $fBody }
      $ly = $y + 7
      foreach ($line in $wrapped[$c]) { $g.DrawString($line, $font, $ink, $cx + 7, $ly); $ly += $lineH }
      $cx += $widths[$c]
    }
    $y += $rowH
  }
  return $y
}

function SectionTitle($g, [string]$text, [float]$y) {
  $g.DrawString($text, $fBold, $ink, 90, $y)
  return $y + 48
}

# 이미지 한 장을 담은 최소 PDF를 쓴다 (JPEG 그대로 넣기)
function Write-JpegPdf([byte[]]$jpeg, [int]$pxW, [int]$pxH, [string]$path) {
  $ms = New-Object System.IO.MemoryStream
  $enc = [System.Text.Encoding]::ASCII
  $offsets = New-Object System.Collections.Generic.List[long]
  function W([string]$s) { $b = $enc.GetBytes($s); $ms.Write($b, 0, $b.Length) }
  W "%PDF-1.4`n"
  $content = "q 595 0 0 842 0 0 cm /Im0 Do Q"
  $offsets.Add($ms.Position); W "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj`n"
  $offsets.Add($ms.Position); W "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`n"
  $offsets.Add($ms.Position); W "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >> endobj`n"
  $offsets.Add($ms.Position); W "4 0 obj << /Type /XObject /Subtype /Image /Width $pxW /Height $pxH /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length $($jpeg.Length) >> stream`n"
  $ms.Write($jpeg, 0, $jpeg.Length); W "`nendstream endobj`n"
  $offsets.Add($ms.Position); W "5 0 obj << /Length $($content.Length) >> stream`n$content`nendstream endobj`n"
  $xref = $ms.Position
  W "xref`n0 6`n0000000000 65535 f `n"
  foreach ($o in $offsets) { W ("{0:D10} 00000 n `n" -f $o) }
  W "trailer << /Size 6 /Root 1 0 R >>`nstartxref`n$xref`n%%EOF`n"
  [System.IO.File]::WriteAllBytes($path, $ms.ToArray())
}

$jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/jpeg" }
$encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
$encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]78)

$idx = 0
foreach ($c in $cases) {
  $idx++
  $r = $c.registry
  $rand = New-Object System.Random ($idx * 7919)

  # 1) 깨끗한 원본 그리기
  $clean = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($clean)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
  $g.Clear([System.Drawing.Color]::White)

  $g.DrawString("등기사항전부증명서(말소사항 포함) - 집합건물", $fTitle, $ink, 330, 90)
  $g.DrawString("[시험용 가짜 서류 - 실제 등기와 관계없음]   고유번호 9999-2026-$('{0:D6}' -f $idx)   건 번호 $($c.folder)", $fBody, $ink, 90, 160)
  $y = 210

  # 표제부: 부동산의 표시
  $y = SectionTitle $g "【 표  제  부 】 ( 부동산의 표시 )" $y
  $rows = @(); $n = 0
  foreach ($p in $r.properties) { $n++; $rows += ,@("$n", "$($p.location) $($p.lotNumber)", $(if ($p.unitNumber) { $p.unitNumber } else { "" }), "철근콘크리트구조`n$($p.area)") }
  $y = DrawTable $g 90 $y ([float[]]@(110, 760, 330, 274)) @("표시번호", "소재지번", "건물 호수", "건물내역(면적)") $rows
  $y += 40

  # 갑구: 소유권
  $y = SectionTitle $g "【 갑      구 】 ( 소유권에 관한 사항 )" $y
  $owners = @($r.parties.owner)
  $ownerText = if ($owners.Count -gt 1) { ($owners | ForEach-Object { "공유자 지분 $($owners.Count)분의 1`n$_" }) -join "`n" } else { "소유자 $($owners[0])" }
  $y = DrawTable $g 90 $y ([float[]]@(110, 230, 300, 250, 584)) @("순위번호", "등기목적", "접    수", "등기원인", "권리자 및 기타사항") @(,@("1", "소유권이전", "2012년4월9일`n제30215호", "2012년3월15일`n매매", $ownerText))
  $y += 40

  # 을구: 근저당권 (다른 근저당권이 있으면 그것이 1번, 이번 근저당권이 다음 번호)
  $y = SectionTitle $g "【 을      구 】 ( 소유권 이외의 권리에 관한 사항 )" $y
  $rows = @(); $rank = 0
  foreach ($o in @($r.otherMortgages)) {
    if (-not $o) { continue }
    $rank++
    $rows += ,@("$rank", "근저당권설정", "$($o.registrationDate -replace ' ', '')`n$($o.receiptNumber)", "$($o.registrationDate -replace ' ', '')`n설정계약", "채권최고액 $($o.maxClaimAmount)`n채무자 $($o.debtor)`n근저당권자 $($o.mortgagee)")
  }
  $rank++
  $debtors = (@($r.parties.debtor) -join ", ")
  $rows += ,@("$rank", "근저당권설정", "$($r.registrationDate -replace ' ', '')`n$($r.receiptNumber)", "$($r.registrationDate -replace ' ', '')`n설정계약", "채권최고액 $($r.maxClaimAmount)`n채무자 $debtors`n근저당권자 $(@($r.parties.mortgagee) -join ', ')")
  $rows += ,@("$rank-1", "${rank}번근저당권이전", "$($r.transferRegistrationDate -replace ' ', '')`n$($r.transferReceiptNumber)", "$($r.transferRegistrationDate -replace ' ', '')`n확정채권양도", "근저당권자 $(@($r.parties.assignee) -join ', ')")
  $y = DrawTable $g 90 $y ([float[]]@(110, 230, 300, 250, 584)) @("순위번호", "등기목적", "접    수", "등기원인", "권리자 및 기타사항") $rows

  # 옅은 사선 표시
  $g.TranslateTransform(($W / 2), ($H / 2)); $g.RotateTransform(-35)
  $markBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 200, 0, 0))
  $g.DrawString("시험용 가짜 서류", $fMark, $markBrush, -380, -60)
  $g.ResetTransform()
  $g.Dispose()

  # 2) 스캔처럼: 누런 바탕, 살짝 기울기·밀림, 잡티
  $scan = New-Object System.Drawing.Bitmap $W, $H
  $g2 = [System.Drawing.Graphics]::FromImage($scan)
  $g2.Clear([System.Drawing.Color]::FromArgb(246, 244, 236))
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $angle = 0.25 + $rand.NextDouble() * 0.6
  if ($rand.Next(2) -eq 0) { $angle = -$angle }
  $g2.TranslateTransform(($W / 2) + $rand.Next(-12, 12), ($H / 2) + $rand.Next(-12, 12)); $g2.RotateTransform($angle)
  $attr = New-Object System.Drawing.Imaging.ImageAttributes
  $attr.SetColorKey([System.Drawing.Color]::FromArgb(250, 250, 250), [System.Drawing.Color]::White)  # 흰 바탕은 투명하게
  $g2.DrawImage($clean, (New-Object System.Drawing.Rectangle (-$W / 2), (-$H / 2), $W, $H), 0, 0, $W, $H, [System.Drawing.GraphicsUnit]::Pixel, $attr)
  $g2.ResetTransform()
  for ($k = 0; $k -lt 2500; $k++) {
    $v = $rand.Next(120, 210)
    $b = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($rand.Next(40, 140), $v, $v, $v))
    $s = $rand.Next(1, 3)
    $g2.FillRectangle($b, $rand.Next(0, $W), $rand.Next(0, $H), $s, $s); $b.Dispose()
  }
  $g2.Dispose(); $clean.Dispose()

  $msImg = New-Object System.IO.MemoryStream
  $scan.Save($msImg, $jpegCodec, $encParams); $scan.Dispose()

  $caseDir = Join-Path $fixtures $c.folder
  New-Item -ItemType Directory -Force $caseDir | Out-Null
  $out = Join-Path $caseDir "등기사항전부증명서.pdf"
  Write-JpegPdf $msImg.ToArray() $W $H $out
  "made $out ($([math]::Round($msImg.Length / 1KB)) KB)"
}
