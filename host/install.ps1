# Convenient BOJ - 내 PC 실행 도우미 설치 (Windows, 관리자 권한 필요 없음)
#
# 하는 일
#   1. Python 확인 (없으면 winget으로 설치할지 물어봄)
#   2. C/C++ 컴파일러 gcc/g++ 확인 (없으면 winget으로 WinLibs 설치할지 물어봄)
#   3. 도우미를 %LOCALAPPDATA%\ConvenientBOJ 에 복사하고 크롬·엣지·웨일에 등록
#
# 실행: install.bat 더블클릭, 또는
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Yes]
param(
  [switch]$Yes,
  [switch]$RegisterOnly,  # 설치된 도구만 사용
  [switch]$ChromeOnly
)

$ErrorActionPreference = 'Stop'
$HostName = 'com.convenient_boj.runner'
$ExtensionId = 'mabfdombglhmfnjklbnoglebinejifdi'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Dest = Join-Path $env:LOCALAPPDATA 'ConvenientBOJ'

function Write-Step($text) { Write-Host "`n▶ $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "  ✔ $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "  ! $text" -ForegroundColor Yellow }

function Confirm-Action($question) {
  if ($Yes) { return $true }
  $answer = Read-Host "  $question (Y/n)"
  return ($answer -eq '' -or $answer -match '^[yYㅛ]')
}

function Update-PathFromRegistry {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user;$env:LOCALAPPDATA\Microsoft\WinGet\Links"
}

function Find-Python {
  foreach ($name in 'python', 'python3') {
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    # WindowsApps 안의 python.exe는 스토어로 안내하는 가짜라서 건너뛴다
    if ($cmd -and $cmd.Source -notlike '*\WindowsApps\*') { return $cmd.Source }
  }
  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    $exe = & $py.Source -3 -c 'import sys; print(sys.executable)' 2>$null
    if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
  }
  foreach ($dir in Get-ChildItem "$env:LOCALAPPDATA\Programs\Python" -Directory -ErrorAction SilentlyContinue) {
    $exe = Join-Path $dir.FullName 'python.exe'
    if (Test-Path $exe) { return $exe }
  }
  return $null
}

function Find-Gpp {
  $cmd = Get-Command g++ -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\g++.exe", 'C:\msys64\ucrt64\bin\g++.exe', 'C:\msys64\mingw64\bin\g++.exe')
  $candidates += Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\BrechtSanders.WinLibs*\mingw64\bin\g++.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function Install-WithWinget($id, $label) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Warn "winget이 없어서 $label 을(를) 자동으로 설치할 수 없어요. 직접 설치한 뒤 다시 실행해 주세요."
    return $false
  }
  Write-Host "  $label 설치 중… (몇 분 걸릴 수 있어요)"
  & winget install -e --id $id --scope user --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    # 일부 패키지는 사용자 범위 설치를 지원하지 않아서 범위 없이 한 번 더 시도
    & winget install -e --id $id --accept-package-agreements --accept-source-agreements --silent
  }
  Update-PathFromRegistry
  return $true
}

Write-Host 'Convenient BOJ - 내 PC 실행 도우미 설치' -ForegroundColor White

# 1) Python
Write-Step 'Python 확인'
$python = Find-Python
if (-not $python) {
  Write-Warn 'Python이 없어요. 도우미가 Python으로 동작하고, Python 코드 실행에도 필요해요.'
  if (-not $RegisterOnly -and (Confirm-Action 'winget으로 Python 3.13을 설치할까요?')) {
    Install-WithWinget 'Python.Python.3.13' 'Python 3.13' | Out-Null
    $python = Find-Python
  }
}
if (-not $python) {
  Write-Host "`nPython을 찾지 못해 설치를 멈춰요. https://www.python.org 에서 설치한 뒤 다시 실행해 주세요." -ForegroundColor Red
  exit 1
}
Write-Ok "Python: $python"
& $python -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.9 이상이 필요해요.' }

# 2) gcc / g++
Write-Step 'C/C++ 컴파일러(MSVC, GCC) 확인'
$gpp = Find-Gpp
$programFilesRoot = if (${env:ProgramFiles(x86)}) { ${env:ProgramFiles(x86)} } else { $env:ProgramFiles }
$vswhere = Join-Path $programFilesRoot 'Microsoft Visual Studio\Installer\vswhere.exe'
$vs = if (Test-Path -LiteralPath $vswhere) { & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationVersion }
if ($vs) { Write-Ok "Visual Studio C++ $vs (실행할 때 x64 컴파일 확인)" }
if (-not $gpp -and -not $vs -and -not $RegisterOnly) {
  Write-Warn 'gcc/g++가 없어요. C/C++ 코드를 내 PC에서 실행하려면 필요해요. (Python만 쓰면 없어도 돼요)'
  if (Confirm-Action 'winget으로 WinLibs(gcc/g++, 약 250MB)를 설치할까요?') {
    Install-WithWinget 'BrechtSanders.WinLibs.POSIX.UCRT' 'WinLibs (gcc/g++)' | Out-Null
    $gpp = Find-Gpp
  }
}
if ($gpp) { Write-Ok "g++: $gpp" }

# 3) 도우미 복사·등록
Write-Step '도우미 설치'
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
foreach ($file in 'workspace.py', 'process_tree.py', 'toolchains.py', 'clangd_tools.py', 'clangd_session.py', 'cboj_host.py') {
  Copy-Item -LiteralPath (Join-Path $Here $file) -Destination $Dest -Force
}
$bat = Join-Path $Dest 'cboj_host.bat'
$batText = "@echo off`r`nchcp 65001 >nul`r`n`"$($python.Replace('%','%%'))`" -E -s -S -B -u `"%~dp0cboj_host.py`" %*`r`n"
[IO.File]::WriteAllText($bat, $batText, (New-Object Text.UTF8Encoding $false))

$manifestPath = Join-Path $Dest "$HostName.json"
$manifest = [ordered]@{
  name            = $HostName
  description     = 'Convenient BOJ local runner'
  path            = $bat
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json
[IO.File]::WriteAllText($manifestPath, $manifest, (New-Object Text.UTF8Encoding $false))

$browsers = [ordered]@{
  'Chrome'      = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts'
  'Edge'        = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts'
  'Naver Whale' = 'HKCU:\Software\Naver\Naver Whale\NativeMessagingHosts'
}
foreach ($b in $browsers.GetEnumerator()) {
  if ($ChromeOnly -and $b.Key -ne 'Chrome') { continue }
  $key = Join-Path $b.Value $HostName
  New-Item -Path $key -Force -Value $manifestPath | Out-Null
  Write-Ok "$($b.Key) 등록 완료"
}
Write-Ok "설치 위치: $Dest"

Write-Host "`n완료! 백준 문제 탭을 새로고침하면 터미널이 '내 PC'에서 실행돼요." -ForegroundColor Green
if (-not $Yes -and -not $RegisterOnly) { Read-Host "`n엔터를 누르면 창이 닫혀요" | Out-Null }
