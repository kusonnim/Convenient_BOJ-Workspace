# Exercise the unmodified Windows installer in a disposable HKCU drive.
param([Parameter(Mandatory=$true)][string]$Python)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$tag = 'ConvenientBOJ-P5-' + [guid]::NewGuid().ToString('N')
$scratch = Join-Path $PSScriptRoot "measurements/$tag"
$reg = "HKEY_CURRENT_USER\Software\$tag"
$oldLocal = $env:LOCALAPPDATA
$oldPath = $env:Path
$oldDrive = (Get-PSDrive HKCU).Root
$nativeName = 'com.convenient_boj.runner'
$origin = 'chrome-extension://mabfdombglhmfnjklbnoglebinejifdi/'
$mapped = $false
try {
    if (Test-Path "Registry::$reg") { throw 'Test key already exists' }
    New-Item "Registry::$reg" | Out-Null
    Remove-PSDrive HKCU
    New-PSDrive HKCU Registry $reg -Scope Script | Out-Null
    $mapped = $true
    if ((Get-PSDrive HKCU).Root -ne $reg) { throw 'Private HKCU drive unavailable' }
    $env:LOCALAPPDATA = (New-Item -Type Directory -Path $scratch).FullName
    $env:Path = (Split-Path -Parent $Python) + ';' + $oldPath
    $old = New-Item -Type Directory -Path (Join-Path $scratch 'previous')
    $archive = Join-Path $scratch 'previous.tar'
    git -C $root archive --format=tar -o $archive 22192f2 host
    if ($LASTEXITCODE) { throw 'Archive failed' }
    tar -xf $archive -C $old.FullName
    if ($LASTEXITCODE) { throw 'Extraction failed' }
    & (Join-Path $old.FullName 'host/install.ps1') -RegisterOnly -ChromeOnly
    $dest = Join-Path $scratch 'ConvenientBOJ'
    Set-Content -LiteralPath (Join-Path $dest 'owner-note.txt') -Value 'preserve'
    & (Join-Path $root 'host/install.ps1') -RegisterOnly -ChromeOnly
    $key = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$nativeName"
    $manifestPath = (Get-Item -LiteralPath $key).GetValue('')
    if ($manifestPath -ne (Join-Path $dest "$nativeName.json")) { throw 'Wrong registration path' }
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
    if ($manifest.name -ne $nativeName -or @($manifest.allowed_origins).Count -ne 1 -or $manifest.allowed_origins[0] -ne $origin) {
        throw 'Native identity changed'
    }
    foreach ($module in Get-ChildItem -LiteralPath (Join-Path $root 'host') -Filter '*.py') {
        if ((Get-FileHash $module.FullName).Hash -ne (Get-FileHash (Join-Path $dest $module.Name)).Hash) { throw "Mismatched $($module.Name)" }
    }
    $probe = @'
import json, struct, sys, subprocess
data = b'{"type":"info","protocol":2}'
proc = subprocess.run([sys.argv[1], sys.argv[2]], input=struct.pack("=I", len(data)) + data, stdout=subprocess.PIPE, check=True, timeout=60)
size, = struct.unpack("=I", proc.stdout[:4])
assert size == len(proc.stdout)-4
reply = json.loads(proc.stdout[4:])
assert reply["protocol"] == 2 and reply["javac"] and reply["stackSizeMiB"]
print(json.dumps(reply))
'@
    & $Python -B -c $probe $manifest.path $origin
    if ($LASTEXITCODE) { throw 'Installed launcher failed' }
    & (Join-Path $root 'host/uninstall.ps1') -ChromeOnly -Yes
    if ((Test-Path -LiteralPath $key) -or ((Get-ChildItem -LiteralPath $dest).Name -join ',') -ne 'owner-note.txt') {
        throw 'Uninstall did not preserve ownership'
    }
    Write-Output 'Clean install, upgrade, seven module hashes, fixed native origin, installed launcher and scoped uninstall passed.'
} finally {
    if ($mapped) { Remove-PSDrive HKCU; New-PSDrive HKCU Registry $oldDrive -Scope Script | Out-Null }
    $env:Path = $oldPath
    $env:LOCALAPPDATA = $oldLocal
    if ($reg -match '^HKEY_CURRENT_USER\\Software\\ConvenientBOJ-P5-[a-f0-9]{32}$' -and (Test-Path "Registry::$reg")) {
        Remove-Item -LiteralPath "Registry::$reg" -Recurse -Force
    }
}
