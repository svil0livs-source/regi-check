# 시험용 한글(HWP) 신청서 20개를 만든다. (PLAN 5번)
# 먼저 node scripts/fixtures/cases.mjs 로 tests/fixtures-build/cases.json 을 만든 뒤 실행한다.
# 한글(한컴오피스)이 설치돼 있어야 한다. HTML을 만들어 한글 자동화로 .hwp로 저장한다.
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fixtures/make-hwp.ps1

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$fixtures = Join-Path $root "tests\fixtures"
# 중간 데이터는 fixtures 바깥(tests\fixtures-build)에 둔다. fixtures 안의 폴더는 모두 "건"으로 보이기 때문이다.
$cases = Get-Content (Join-Path $root "tests\fixtures-build\cases.json") -Encoding UTF8 -Raw | ConvertFrom-Json
$tmp = Join-Path $root "tests\fixtures-build\html"
New-Item -ItemType Directory -Force $tmp | Out-Null

function Esc([string]$s) { [System.Net.WebUtility]::HtmlEncode($s) }
function Row([string]$label, [string]$value) {
  "<tr><td width='28%' style='background:#eeeeee'><b>$(Esc $label)</b></td><td>$value</td></tr>"
}

$hwp = New-Object -ComObject HWPFrame.HwpObject
try {
  try { $null = $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") } catch {}

  foreach ($c in $cases) {
    $h = $c.hwp
    $props = ($h.properties | ForEach-Object {
      $unit = if ($_.unitNumber) { " " + $_.unitNumber } else { "" }
      "$(Esc $_.location) $(Esc $_.lotNumber)$(Esc $unit) (면적 $(Esc $_.area))"
    }) -join "</p><p>"
    $props = "<p>$props</p>"

    $html = @"
<html><head><meta charset="utf-8"></head><body style="font-family:'바탕'">
<p align="center" style="color:#cc0000"><b>※ 시험용 가짜 서류 - 실제 등기와 관계없음 ※</b></p>
<h2 align="center">근저당권이전등기신청</h2>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
$(Row "이전등기 접수" ("$(Esc $h.transferRegistrationDate) 접수 $(Esc $h.transferReceiptNumber)"))
$(Row "부동산의 표시" $props)
$(Row "등기의 목적" "근저당권이전")
$(Row "이전할 근저당권" ("$(Esc $h.registrationDate) 접수 $(Esc $h.receiptNumber)로 등기한 근저당권"))
$(Row "채권최고액" (Esc $h.maxClaimAmount))
$(Row "채무자" (Esc ($h.parties.debtor -join ", ")))
$(Row "소유자" (Esc ($h.parties.owner -join ", ")))
$(Row "등기의무자 (양도인, 근저당권자)" (Esc ($h.parties.mortgagee -join ", ")))
$(Row "등기권리자 (양수인)" (Esc ($h.parties.assignee -join ", ")))
</table>
<p>건 번호: $(Esc $c.folder)</p>
</body></html>
"@
    $htmlPath = Join-Path $tmp "$($c.folder).html"
    # BOM 없이 저장한다 (BOM이 있으면 한글이 문서 맨 앞에 보이지 않는 글자로 넣는다)
    [System.IO.File]::WriteAllText($htmlPath, $html, (New-Object System.Text.UTF8Encoding $false))

    $caseDir = Join-Path $fixtures $c.folder
    New-Item -ItemType Directory -Force $caseDir | Out-Null
    $out = Join-Path $caseDir "근저당권이전_신청서.hwp"

    if (-not $hwp.Open($htmlPath, "HTML", "")) { throw "열기 실패: $htmlPath" }
    if (-not $hwp.SaveAs($out, "HWP", "")) { throw "저장 실패: $out" }
    $hwp.Clear(1) | Out-Null  # 문서 닫기 (저장 묻지 않음)
    "made $out"
  }
} finally {
  $hwp.Quit()
}
