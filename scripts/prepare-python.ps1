# Prepares the bundled Python runtime for Windows builds.
# Downloads the embeddable CPython and installs the engine's dependencies
# into it, so installed apps need no Python of their own.
# Run once before `npm run tauri build`. Safe to re run (skips when present).

$ErrorActionPreference = "Stop"
$ver = "3.11.9"
$dir = Join-Path $PSScriptRoot "..\src-tauri\python-embed"
$dir = (New-Item -ItemType Directory -Force $dir).FullName

if (Test-Path (Join-Path $dir "python.exe")) {
    Write-Output "python-embed already prepared, skipping"
    exit 0
}

$zip = Join-Path $env:TEMP "python-$ver-embed-amd64.zip"
Write-Output "downloading embeddable Python $ver"
Invoke-WebRequest "https://www.python.org/ftp/python/$ver/python-$ver-embed-amd64.zip" -OutFile $zip
Expand-Archive $zip -DestinationPath $dir -Force

# let the embeddable runtime see Lib\site-packages
$pth = Get-ChildItem $dir -Filter "python3*._pth" | Select-Object -First 1
Add-Content $pth.FullName "Lib\site-packages"

Write-Output "installing engine dependencies"
python -m pip install --quiet --target (Join-Path $dir "Lib\site-packages") `
    --python-version 311 --platform win_amd64 --only-binary=:all: `
    pymupdf pikepdf pillow pdf2docx ocrmypdf

Write-Output "bundled runtime ready at $dir"
