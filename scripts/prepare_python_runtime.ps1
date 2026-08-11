$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $rootDir "electron\python-runtime"
$releaseTag = if ($env:PYTHON_STANDALONE_RELEASE) { $env:PYTHON_STANDALONE_RELEASE } else { "20251007" }
$release = Invoke-RestMethod "https://api.github.com/repos/astral-sh/python-build-standalone/releases/tags/$releaseTag"
$asset = $null
foreach ($page in 1..10) {
    $assets = Invoke-RestMethod "https://api.github.com/repos/astral-sh/python-build-standalone/releases/$($release.id)/assets?per_page=100&page=$page"
    $asset = $assets | Where-Object {
        $_.name -match '^cpython-3\.12\.[0-9]+\+.*-x86_64-pc-windows-msvc-install_only_stripped\.tar\.gz$'
    } | Select-Object -First 1
    if ($asset) { break }
}

if (-not $asset) {
    throw "Python 3.12 runtime asset was not found in release $releaseTag"
}

New-Item -ItemType Directory -Force $runtimeDir | Out-Null
$archivePath = Join-Path ([System.IO.Path]::GetTempPath()) "vyact-python-$([guid]::NewGuid()).tar.gz"
try {
    Write-Host "Downloading bundled Python 3.12 runtime (Windows)..."
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath
    $pythonDir = Join-Path $runtimeDir "python"
    if (Test-Path $pythonDir) { Remove-Item -Recurse -Force $pythonDir }
    tar -xzf $archivePath -C $runtimeDir
    & (Join-Path $pythonDir "python.exe") --version
} finally {
    Remove-Item -Force -ErrorAction SilentlyContinue $archivePath
}
