# Skyline AI Bridge launcher — serves index.html on http://127.0.0.1:8123 so
# browser wallet extensions can inject (they refuse file:// pages), then opens
# the default browser. Zero dependencies: built-in .NET HttpListener only.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$file = @("index.html", "skyline-bridge-app.html") |
  ForEach-Object { Join-Path $root $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $file) { Write-Host "No app HTML found next to this script."; exit 1 }

$port = 8123
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$port/")
try { $listener.Start() } catch {
  # Port busy — assume a previous launcher is already serving; just open it.
  Start-Process "http://127.0.0.1:$port/"
  exit 0
}

Write-Host ""
Write-Host "  SKYLINE AI BRIDGE" -ForegroundColor Red
Write-Host "  serving http://127.0.0.1:$port/  (close this window to stop)" -ForegroundColor DarkGray
Write-Host ""
Start-Process "http://127.0.0.1:$port/"

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctx.Response.ContentType = "text/html; charset=utf-8"
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {} finally {
    $ctx.Response.OutputStream.Close()
  }
}
