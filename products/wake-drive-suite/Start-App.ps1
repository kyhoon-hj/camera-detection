param([switch]$NoBrowser)
$App = 'jolbang'
$ErrorActionPreference = 'Stop'
$appRoot = $PSScriptRoot
$port = 5220
$url = "http://127.0.0.1:$port/"
$logRoot = Join-Path $appRoot '.runtime'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
  $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listeners[0].OwningProcess)"
  if (!$owner.CommandLine -or !$owner.CommandLine.Contains($appRoot) -or !$owner.CommandLine.Contains($App)) {
    throw "Port $port is used by another program. Nothing was stopped."
  }
} else {
  if (!(Test-Path -LiteralPath (Join-Path $appRoot "dist\$App\index.html"))) { throw "Build missing: npm run build:$App" }
  $node = (Get-Command node.exe).Source
  $vite = Join-Path $appRoot 'node_modules\vite\bin\vite.js'
  $server = Start-Process -FilePath $node -ArgumentList @(('"' + $vite + '"'),'preview','--mode',$App,'--host','127.0.0.1','--port',"$port",'--strictPort') -WorkingDirectory $appRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logRoot 'server.out.log') -RedirectStandardError (Join-Path $logRoot 'server.err.log')
  $server.Id | Set-Content -LiteralPath (Join-Path $logRoot 'server.pid')
}
$ready = $false
for ($attempt=0; $attempt -lt 40; $attempt++) {
  try { if ((Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200) { $ready=$true; break } } catch { Start-Sleep -Milliseconds 500 }
}
if (!$ready) { throw "Startup failed. See $logRoot" }
Write-Output "$App ready: $url"
if (!$NoBrowser) { Start-Process $url }
