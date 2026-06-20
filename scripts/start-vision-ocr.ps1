# Starts PaddleOCR-VL via llama.cpp's llama-server for the GMA label reader.
# Bound to 0.0.0.0 so the Dockerised app reaches it on host.docker.internal:8185.
# Idempotent: exits if a server is already answering on the port.
# Register at logon:  schtasks /create /tn "GMA Vision OCR" /tr "powershell -WindowStyle Hidden -File C:\Users\91834\Desktop\GMA\scripts\start-vision-ocr.ps1" /sc onlogon /rl highest

$ErrorActionPreference = 'SilentlyContinue'
$dir  = 'C:\Users\91834\llamacpp'
$bin  = "$dir\bin\llama-server.exe"
$port = 8185

try {
    $h = Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($h.status -eq 'ok') { Write-Host "Vision OCR already running on $port"; exit 0 }
} catch {}

if (-not (Test-Path $bin)) { Write-Error "llama-server not found at $bin"; exit 1 }

$args = @(
    '-m',      "$dir\model.gguf",
    '--mmproj', "$dir\mmproj.gguf",
    '-ngl',    '99',           # all layers on the GTX 1050 (~1.8 GB)
    '-c',      '4096',
    '--host',  '0.0.0.0',      # reachable from the container via host-gateway
    '--port',  "$port"
)
Start-Process -FilePath $bin -ArgumentList $args -WindowStyle Hidden `
    -RedirectStandardError "$dir\server.log" -RedirectStandardOutput "$dir\server.out"

foreach ($i in 1..40) {
    Start-Sleep -Seconds 3
    try { if ((Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2).status -eq 'ok') { Write-Host "Vision OCR ready on $port"; exit 0 } } catch {}
}
Write-Error "Vision OCR failed to start; see $dir\server.log"
exit 1
