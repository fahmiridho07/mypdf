# Captures the running MyPDF desktop window (title "MyPDF") to PNG.
# Usage: run `npm run tauri dev` first, wait for the window, then:
#   powershell -ExecutionPolicy Bypass -File scripts/capture-screenshot.ps1 -Out docs/screenshot.png
param([string]$Out = "docs/screenshot.png")

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing, System.Windows.Forms

$code = @"
using System;
using System.Runtime.InteropServices;
public static class Win32 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type -TypeDefinition $code

$proc = Get-Process | Where-Object { $_.MainWindowTitle -eq "MyPDF" } | Select-Object -First 1
if (-not $proc) { throw "MyPDF window not found. Run the app first." }
$h = $proc.MainWindowHandle
if ([Win32]::IsIconic($h)) { [void][Win32]::ShowWindow($h, 9) }
[void][Win32]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 800

$r = New-Object Win32+RECT
[void][Win32]::GetWindowRect($h, [ref]$r)
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap($w, $hh)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$g.Dispose()
$dir = Split-Path $Out -Parent
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
$bmp.Save((Resolve-Path (Split-Path $Out -Parent)).Path + "\" + (Split-Path $Out -Leaf), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "saved $Out (${w}x${hh})"
