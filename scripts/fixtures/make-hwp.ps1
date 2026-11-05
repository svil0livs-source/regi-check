# 시험용 한글(HWP) 근저당권이전등기신청서 20개를 만든다. (PLAN 5번)
# 양식: 사용자가 준 「근저당권변경등기신청」 양식(2026-11-05)의 틀을 따르고, 칸 내용만 이전등기에 맞게 바꿨다.
#   - 맨 위 접수 칸(년 월 일 / 제 호)에 이전등기 접수일·접수번호
#   - ④ 칸은 "이전할 근저당권" (원 접수일·접수번호 + 채권최고액·채무자·근저당권설정자)
#   - ⑤ 등기의무자 = 근저당권자(양도인), ⑥ 등기권리자 = 양수인
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
function P([string]$s) { "<p>$(Esc $s)</p>" }
$th = "style='background:#eeeeee'"

$hwp = New-Object -ComObject HWPFrame.HwpObject
try {
  try { $null = $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") } catch {}

  foreach ($c in $cases) {
    $h = $c.hwp
    $x = $h.extra
    $person = { param($name) $x.persons.$name }

    # ① 부동산의 표시 (1동의 건물 / 전유부분 / 대지권)
    $props = ""
    $n = 0
    foreach ($p in $h.properties) {
      $n++
      $no = if ($h.properties.Count -gt 1) { "$n. " } else { "" }
      $props += (P "${no}1동의 건물의 표시")
      $props += (P "$($p.location) $($p.lotNumber) $($x.building)")
      $props += (P "[도로명주소] $($x.road)")
      $props += (P "전유부분의 건물의 표시")
      $props += (P "건물의 번호 $($p.unitNumber)")
      $props += (P "구 조 철근콘크리트조")
      $props += (P "면 적 $($p.area)")
      $props += (P "대지권의 표시")
      $props += (P "토지의 표시 1. $($p.location) $($p.lotNumber) 대 $($x.landArea)")
      $props += (P "대지권의 종류 소유권")
      $props += (P "대지권의 비율 $($x.ratio)")
    }
    $props += "<p align='center'>이 상</p>"

    $debtors = ($h.parties.debtor -join ", ")
    $owners = ($h.parties.owner -join ", ")
    $obligor = @($h.parties.mortgagee)
    $holder = @($h.parties.assignee)
    $partyRow = {
      param($label, $names, $role)
      $ids = ($names | ForEach-Object { (& $person $_).id }) -join "<br>"
      $addrs = ($names | ForEach-Object { (& $person $_).address }) -join "<br>"
      "<tr><td $th><b>$label</b></td><td>$(P ($names -join ', '))$(P $role)</td><td>$ids</td><td>$addrs</td></tr>"
    }

    $html = @"
<html><head><meta charset="utf-8"></head><body style="font-family:'바탕'">
<p align="center" style="color:#cc0000"><b>※ 시험용 가짜 서류 - 실제 등기와 관계없음 ※</b></p>
<h2 align="center">근저당권이전등기신청</h2>
<table border="1" cellpadding="5" cellspacing="0" width="100%">
<tr><td rowspan="2" $th><b>접 수</b></td><td>$(Esc $h.transferRegistrationDate)</td><td rowspan="2" $th><b>처리인</b></td><td>접 수</td><td>기 입</td><td>교 합</td><td>각종 통지</td></tr>
<tr><td>$(Esc $h.transferReceiptNumber)</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
</table>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<tr><td colspan="2" align="center" $th><b>① 부동산의 표시</b></td></tr>
<tr><td colspan="2">$props</td></tr>
<tr><td width="30%" $th><b>② 등기원인과 그 연월일</b></td><td>$(Esc $x.transferCause)</td></tr>
<tr><td $th><b>③ 등기의 목적</b></td><td>근저당권이전</td></tr>
<tr><td $th><b>④ 이전할 근저당권</b></td><td>$(P "$($h.registrationDate) 접수 $($h.receiptNumber)로 등기한 순위 제1번 근저당권")$(P "채권최고액 $($h.maxClaimAmount)")$(P "채무자 $debtors")$(P "근저당권설정자(소유자) $owners")</td></tr>
</table>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<tr><td $th><b>구분</b></td><td $th><b>성 명 (상호·명칭)</b></td><td $th><b>주민등록번호 (등기용등록번호)</b></td><td $th><b>주 소 (소재지)</b></td></tr>
$(& $partyRow "⑤ 등기의무자" $obligor "근저당권자(양도인)")
$(& $partyRow "⑥ 등기권리자" $holder "근저당권 양수인")
</table>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<tr><td width="30%" $th><b>⑦ 등록면허세</b></td><td>금 6,000원</td></tr>
<tr><td $th><b>⑦ 지방교육세</b></td><td>금 1,200원</td></tr>
<tr><td $th><b>⑧ 세액합계</b></td><td>금 7,200원</td></tr>
<tr><td $th><b>⑨ 등기신청수수료</b></td><td>금 3,000원 납부번호 : 00-00-00000000-0</td></tr>
<tr><td $th><b>⑩ 등기의무자의 등기필정보</b></td><td>부동산고유번호 1102-2026-$('{0:D6}' -f [int]$c.folder.Substring(5)) / 일련번호 Q77C-LO71-35J5 / 비밀번호 40-4636</td></tr>
<tr><td $th><b>⑪ 첨부서면</b></td><td>근저당권이전계약서 1통 · 등록면허세영수필확인서 1통 · 등기신청수수료 영수필확인서 1통 · 등기필증 1통 · 인감증명서 1통</td></tr>
</table>
<p align="center">$(Esc $h.transferRegistrationDate)</p>
<p>⑫ 위 신청인 $(Esc (($obligor + $holder) -join ', '))</p>
<p>(또는)위 대리인 법무사 가짜법무사 (전화 : 02-000-0000)</p>
<p align="center">서울중앙지방법원 등기국 귀중</p>
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
