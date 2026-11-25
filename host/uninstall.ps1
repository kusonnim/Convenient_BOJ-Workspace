# Convenient BOJ - 내 PC 실행 도우미 제거
# (Python, gcc 같은 설치한 프로그램은 지우지 않아요)
param([switch]$ChromeOnly, [switch]$Yes)
$ErrorActionPreference = 'Stop'
$HostName = 'com.convenient_boj.runner'
$Dest = Join-Path $env:LOCALAPPDATA 'ConvenientBOJ'
$manifest = Join-Path $Dest "$HostName.json"
$keepFiles = $false
foreach ($base in 'HKCU:\Software\Google\Chrome\NativeMessagingHosts',
                  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts',
                  'HKCU:\Software\Naver\Naver Whale\NativeMessagingHosts') {
  $key = Join-Path $base $HostName
  if (-not (Test-Path -LiteralPath $key)) { continue }
  if ((Get-Item -LiteralPath $key).GetValue('') -ne $manifest) { continue }
  if ($ChromeOnly -and $base -ne 'HKCU:\Software\Google\Chrome\NativeMessagingHosts') {
    $keepFiles = $true
    continue
  }
  Remove-Item -LiteralPath $key -Force
}
if (-not $keepFiles -and (Test-Path -LiteralPath $Dest)) {
  foreach ($file in "$HostName.json", 'cboj_host.bat', 'cboj_host.py', 'toolchains.py', 'process_tree.py', 'workspace.py', 'clangd_tools.py', 'clangd_session.py') {
    $path = Join-Path $Dest $file
    if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
  }
  if (-not (Get-ChildItem -LiteralPath $Dest -Force)) { Remove-Item -LiteralPath $Dest }
}
Write-Host '도우미 등록을 제거했어요.' -ForegroundColor Green
if (-not $Yes) { Read-Host '엔터를 누르면 창이 닫혀요' | Out-Null }
