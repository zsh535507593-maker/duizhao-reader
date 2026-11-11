$ErrorActionPreference = 'Stop'
$readerRoot = Split-Path -Parent $PSScriptRoot
$readerUrl = 'http://127.0.0.1:8787/'
try {
    $readerResponse = Invoke-WebRequest -Uri $readerUrl -UseBasicParsing -TimeoutSec 2
    if ($readerResponse.StatusCode -eq 200 -and $readerResponse.Content -match 'id="reader"') {
        Start-Process $readerUrl
        exit 0
    }
} catch {}
$readerNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $readerNode) {
    $readerBundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $readerBundled) { $readerNode = $readerBundled }
}
if (-not $readerNode) { Write-Host '未找到 Node.js。请使用在线网址，或安装 Node.js 后重试。'; exit 1 }
$readerServer = Join-Path $PSScriptRoot 'serve.mjs'
Start-Process -FilePath $readerNode -ArgumentList @('"' + $readerServer + '"') -WorkingDirectory $readerRoot -WindowStyle Hidden
for ($readerAttempt=0; $readerAttempt -lt 20; $readerAttempt++) {
    Start-Sleep -Milliseconds 250
    try {
        $readerResponse = Invoke-WebRequest -Uri $readerUrl -UseBasicParsing -TimeoutSec 1
        if ($readerResponse.StatusCode -eq 200 -and $readerResponse.Content -match 'id="reader"') {
            Start-Process $readerUrl
            exit 0
        }
    } catch {}
}
Write-Host '本机预览未能启动，可能是 8787 端口正被其他程序使用。'
exit 1
