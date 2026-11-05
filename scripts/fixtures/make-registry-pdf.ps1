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
# 본문 약 9pt (실제 등기부와 비슷한 크기, 200dpi 기준 25px). 양식 칸이 많아 한 장에 맞추려고 조금 줄였다.
$fBody = New-Object System.Drawing.Font($fontName, 25, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$fBold = New-Object System.Drawing.Font($fontName, 25, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
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
  $lineH = 32
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
  return $y + 42
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

  # 양식: 사용자가 준 「등기사항증명서(말소사항 포함) 집합건물」 샘플(2026-11-05)
  $x = $r.extra
  $p0 = $r.properties[0]
  $who = { param($name) $x.persons.$name }
  $nd = { param($s) $s -replace ' ', '' }  # 등기부는 날짜를 붙여 쓴다 (2020년3월2일)

  $g.DrawString("※ 등기사항증명서 (말소사항 포함)  집합건물  [제출용]", $fTitle, $ink, 260, 70)
  $g.DrawString("[시험용 가짜 서류 - 실제 등기와 관계없음]   건 번호 $($c.folder)", $fBody, $ink, 90, 125)
  $g.DrawString("[집합건물] $($p0.location) $($p0.lotNumber) $($x.building) $($p0.unitNumber)", $fBody, $ink, 90, 165)
  $g.DrawString("고유번호 1102-2026-$('{0:D6}' -f $idx)", $fBody, $ink, 1200, 165)
  $y = 215
  $wide5 = [float[]]@(90, 260, 470, 380, 274)
  # 갑구·을구: 「권리자 및 기타사항」 칸이 가장 길어서 넓게 잡는다
  $rights5 = [float[]]@(90, 230, 250, 250, 654)

  # 표제부 (1동의 건물의 표시)
  $y = SectionTitle $g "【 표    제    부 】 ( 1동의 건물의 표시 )" $y
  $rows = @(); $n = 0
  foreach ($p in $r.properties) { $n++; $rows += ,@("$n", "2005년3월2일", "$($p.location) $($p.lotNumber)`n$($x.building)`n[도로명주소] $($x.road)", "철근콘크리트구조 슬래브지붕`n15층 아파트", "도면편철장 제1책`n제30장") }
  $y = DrawTable $g 90 $y $wide5 @("표시번호", "접    수", "소재지번, 건물명칭 및 번호", "건 물 내 역", "등기원인 및 기타사항") $rows
  $y += 10
  # (대지권의 목적인 토지의 표시)
  $g.DrawString("( 대지권의 목적인 토지의 표시 )", $fBody, $ink, 600, $y); $y += 40
  $y = DrawTable $g 90 $y ([float[]]@(90, 730, 150, 230, 274)) @("표시번호", "소 재 지 번", "지목", "면  적", "등기원인 및 기타사항") @(,@("1", "1. $($p0.location) $($p0.lotNumber)", "대", "$($x.landArea)", "2005년3월2일"))
  $y += 30

  # 표제부 (전유부분의 건물의 표시)
  $y = SectionTitle $g "【 표    제    부 】 ( 전유부분의 건물의 표시 )" $y
  $rows = @(); $n = 0
  foreach ($p in $r.properties) { $n++; $rows += ,@("$n", "2005년3월2일", "$($p.unitNumber)", "철근콘크리트구조 $($p.area)", "도면편철장 제1책`n제30장") }
  $y = DrawTable $g 90 $y $wide5 @("표시번호", "접    수", "건 물 번 호", "건 물 내 역", "등기원인 및 기타사항") $rows
  $y += 10
  # (대지권의 표시)
  $g.DrawString("( 대지권의 표시 )", $fBody, $ink, 680, $y); $y += 40
  $y = DrawTable $g 90 $y ([float[]]@(90, 560, 550, 274)) @("표시번호", "대지권종류", "대지권비율", "등기원인 및 기타사항") @(,@("1", "1 소유권대지권", "$($x.ratio)", "2005년2월28일 대지권`n2005년3월2일"))
  $y += 30

  # 갑구: 소유권 (보존 → 이전. 대조할 소유자는 마지막 줄의 현재 소유자)
  $y = SectionTitle $g "【 갑        구 】 ( 소유권에 관한 사항 )" $y
  $owners = @($r.parties.owner)
  $ownerText = if ($owners.Count -gt 1) {
    ($owners | ForEach-Object { "공유자 지분 $($owners.Count)분의 1`n$_ $((& $who $_).id)`n$((& $who $_).address)" }) -join "`n"
  } else {
    "소유자 $($owners[0]) $((& $who $owners[0]).id)`n$((& $who $owners[0]).address)"
  }
  # 줄 하나 = 칸 5개짜리 배열. 앞에 쉼표를 붙이면 한 겹 더 감싸져 모든 칸이 첫 칸에 몰리므로 붙이지 않는다.
  $rows = @(
    @("1", "소유권보존", "2005년3월2일`n제11111호", "", "소유자 $($x.builder) 110111-1111111`n$($x.road)"),
    @("2", "소유권이전", "2012년4월9일`n제30215호", "2012년3월15일`n매매", "$ownerText`n거래가액 금300,000,000원")
  )
  $y = DrawTable $g 90 $y $rights5 @("순위번호", "등 기 목 적", "접    수", "등 기 원 인", "권리자 및 기타사항") $rows
  $y += 30

  # 을구: 근저당권 (다른 근저당권이 있으면 그것이 1번, 이번 근저당권이 다음 번호)
  $y = SectionTitle $g "【 을        구 】 ( 소유권 이외의 권리에 관한 사항 )" $y
  $rows = @(); $rank = 0
  foreach ($o in @($r.otherMortgages)) {
    if (-not $o) { continue }
    $rank++
    $rows += ,@("$rank", "근저당권설정", "$(& $nd $o.registrationDate)`n$($o.receiptNumber)", "$(& $nd $o.registrationDate)`n설정계약", "채권최고액 $($o.maxClaimAmount)`n채무자 $($o.debtor)`n근저당권자 $($o.mortgagee) 110111-2222222")
  }
  $rank++
  $debtorText = (@($r.parties.debtor) | ForEach-Object { "채무자 $_`n$((& $who $_).address)" }) -join "`n"
  $mortgagee = @($r.parties.mortgagee)[0]
  $assignee = @($r.parties.assignee)[0]
  $rows += ,@("$rank", "근저당권설정", "$(& $nd $r.registrationDate)`n$($r.receiptNumber)", "$(& $nd $r.registrationDate)`n설정계약", "채권최고액 $($r.maxClaimAmount)`n$debtorText`n근저당권자 $mortgagee $((& $who $mortgagee).id)`n$((& $who $mortgagee).address)")
  $rows += ,@("$rank-1", "${rank}번근저당권이전", "$(& $nd $r.transferRegistrationDate)`n$($r.transferReceiptNumber)", "$(& $nd ($x.transferCause -replace ' 확정채권양도$', ''))`n확정채권양도", "근저당권자 $assignee $((& $who $assignee).id)`n$((& $who $assignee).address)")
  $y = DrawTable $g 90 $y $rights5 @("순위번호", "등 기 목 적", "접    수", "등 기 원 인", "권리자 및 기타사항") $rows
  if ($y -gt $H - 60) { throw "$($c.folder): 내용이 한 장을 넘음 (y=$y)" }

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
