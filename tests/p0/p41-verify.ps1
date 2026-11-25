# Run a version-sensitive Chrome suite with a private native name and a disposable profile.
param([ValidateSet('p0','p1','p2','p3','p4','polish','ime','timing','legacy')][string]$Suite = 'polish',
      [string]$Baseline, [string]$Filter, [switch]$Offline)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$common = (git -C $root rev-parse --path-format=absolute --git-common-dir).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Git common directory unavailable' }
$project = [IO.Directory]::GetParent($common)
$coord = Join-Path $project.Parent.FullName ($project.Name + '-coordination')
[IO.Directory]::CreateDirectory($coord) | Out-Null
$python = $env:CBOJ_TEST_PYTHON
if (!$python) { $python = (Get-Command python -CommandType Application).Source }
if (!(Test-Path -LiteralPath $python) -or $python -like '*\WindowsApps\*') { throw 'Set CBOJ_TEST_PYTHON to an installed interpreter.' }
$env:CBOJ_TEST_PYTHON = $python
$privateName = "com.convenient_boj.p41_$PID"
$runId = "$PID-$([guid]::NewGuid().ToString('N').Substring(0,8))"
$owned = Join-Path $PSScriptRoot "measurements/private-$runId"
if (Test-Path -LiteralPath $owned) { throw 'Fixture directory already exists.' }
[IO.Directory]::CreateDirectory($owned) | Out-Null
$stage = Join-Path $owned 'unpacked'
[IO.Directory]::CreateDirectory($stage) | Out-Null
$source = if ($Baseline) { (Resolve-Path -LiteralPath $Baseline).Path } else { $root }
foreach ($name in 'manifest.json','background.js','content','editor','popup','shared','icons','vendor','host') {
    Copy-Item -LiteralPath (Join-Path $source $name) -Destination $stage -Recurse
}
$utf8 = [Text.UTF8Encoding]::new($false)
foreach ($relative in 'background.js','popup/popup.js','editor/formatting.js') {
    $file = Join-Path $stage $relative
    if (Test-Path -LiteralPath $file) {
        [IO.File]::WriteAllText($file, [IO.File]::ReadAllText($file).Replace('com.convenient_boj.runner', $privateName), $utf8)
    }
}
$bat = Join-Path $owned 'runner.bat'
$hostRoot = $stage
if ($Suite -eq 'legacy') {
    $hostRoot = Join-Path $owned 'base-host'
    [IO.Directory]::CreateDirectory($hostRoot) | Out-Null
    $archive = Join-Path $owned 'host.tar'
    git -C $root archive --format=tar -o $archive f5fd0b4 host
    if ($LASTEXITCODE) { throw 'Legacy host archive failed.' }
    tar -xf $archive -C $hostRoot
    if ($LASTEXITCODE) { throw 'Legacy host extraction failed.' }
}
$hostScript = (Join-Path $hostRoot 'host/cboj_host.py').Replace('%','%%')
[IO.File]::WriteAllLines($bat, @('@echo off', ('"' + $python.Replace('%','%%') + '" -E -s -S -B -u "' + $hostScript + '" %*')), $utf8)
$manifest = Join-Path $owned 'host.json'
[IO.File]::WriteAllText($manifest, ([ordered]@{
    name=$privateName; description='Private P4.1 test host'; path=$bat; type='stdio'
    allowed_origins=@('chrome-extension://mabfdombglhmfnjklbnoglebinejifdi/')
} | ConvertTo-Json), $utf8)
$lock = Join-Path $coord 'system-resources.lock'
$lease = $null
if ($Offline -and $Suite -notin 'p0','polish','timing') { throw 'This suite requires the private native registration.' }
while (!$Offline -and !$lease) {
    try { $lease = [IO.File]::Open($lock, 'OpenOrCreate', 'ReadWrite', 'None') }
    catch [IO.IOException] { Start-Sleep -Seconds 2 }
}
$key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$privateName"
$registered = $false
try {
    if (Test-Path -LiteralPath $key) { throw 'Test registry name already in use.' }
    if (!$Offline) {
        New-Item -Path $key -Value $manifest -ErrorAction Stop | Out-Null
        $registered = $true
    }
    $env:CBOJ_P41_LEGACY = if ($Suite -eq 'legacy') { '1' } else { '' }
    $env:CBOJ_P41_UNPACKED = $stage
    $env:CBOJ_P41_HOST = $privateName
    if (!$env:CBOJ_P41_EVIDENCE) { $env:CBOJ_P41_EVIDENCE = Join-Path $PSScriptRoot 'measurements/p41-evidence' }
    $env:CBOJ_P41_BASELINE = if ($Baseline) { '1' } else { '' }
    $env:CBOJ_P41_BENCHMARK = if ($Suite -eq 'timing') { '1' } else { '' }
    Push-Location $PSScriptRoot
    try {
        if ($Suite -eq 'ime') { & node windows-ime.mjs $stage }
        else {
            $configs = @{ p0='playwright.config.mjs'; p1='playwright.native.config.mjs'; p2='playwright.editor.config.mjs';
                p3='playwright.clangd.config.mjs'; p4='playwright.p4.config.mjs'; polish='playwright.polish.config.mjs'; timing='playwright.polish.config.mjs'; legacy='playwright.polish.config.mjs' }
            $params = @('node_modules/@playwright/test/cli.js','test','--config',$configs[$Suite],"--output=measurements/$Suite-$runId",'--reporter=list')
            if ($Suite -eq 'legacy') { $params += @('--grep','prior host') }
            if ($Suite -eq 'timing') { $params += @('--grep','startup and typing') }
            if ($Offline -and $Suite -eq 'polish') { $params += @('--grep-invert','real local tools') }
            if ($Filter) { $params += @('--grep',$Filter) }
            & node @params
        }
        $result = $LASTEXITCODE
    } finally { Pop-Location }
} finally {
    try {
        if ($registered -and (Get-Item -LiteralPath $key).GetValue('') -eq $manifest) { Remove-Item -LiteralPath $key }
    } finally { if ($lease) { $lease.Dispose() } }
}
exit $result
