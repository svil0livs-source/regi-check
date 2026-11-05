# 시험용 한글 신청서 20개(.hwp, 한글 2002 이후 형식)를 다른 한글 형식으로도 저장한다. (구버전·신버전 읽기 시험용, 2026-11-05)
#   tests\fixtures-build\hwpx\<폴더>.hwpx   신버전(한글 2010 이후)
#   tests\fixtures-build\hwp3\<폴더>.hwp    구버전(한글 97 이하, HWP 3.0)
#   tests\fixtures-build\hml\<폴더>.hml     한글 XML 문서(HWPML 2.x)
# fixtures 안에 두면 한 폴더에 한글 파일이 2개가 되므로 fixtures-build에 따로 둔다.
# 먼저 make-hwp.ps1 로 .hwp를 만든 뒤 실행한다. 한글(한컴오피스)이 설치돼 있어야 한다.
# 실행: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/fixtures/make-hangul-formats.ps1

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$fixtures = Join-Path $root "tests\fixtures"
$build = Join-Path $root "tests\fixtures-build"
$formats = @(
  @{ Dir = "hwpx"; Ext = "hwpx"; Format = "HWPX" },
  @{ Dir = "hwp3"; Ext = "hwp"; Format = "HWP30" },
  @{ Dir = "hml"; Ext = "hml"; Format = "HWPML2X" }
)
foreach ($f in $formats) { New-Item -ItemType Directory -Force (Join-Path $build $f.Dir) | Out-Null }

$hwp = New-Object -ComObject HWPFrame.HwpObject
try {
  try { $null = $hwp.RegisterModule("FilePathCheckDLL", "FilePathCheckerModule") } catch {}
  foreach ($dir in Get-ChildItem $fixtures -Directory) {
    $src = Get-ChildItem $dir.FullName -Filter *.hwp | Select-Object -First 1
    if (-not $src) { continue }
    foreach ($f in $formats) {
      # 형식마다 원본을 새로 열어 저장한다 (앞 형식으로 바꾼 내용이 이어지지 않게)
      if (-not $hwp.Open($src.FullName, "HWP", "")) { throw "열기 실패: $($src.FullName)" }
      $out = Join-Path (Join-Path $build $f.Dir) "$($dir.Name).$($f.Ext)"
      if (-not $hwp.SaveAs($out, $f.Format, "")) { throw "저장 실패: $out" }
      $hwp.Clear(1) | Out-Null
    }
    Write-Output "만듦: $($dir.Name)"
  }
} finally {
  $hwp.Quit()
}
