$ErrorActionPreference = 'Stop'
$pythonExe = $env:SUHA_PYTHON
if (-not $pythonExe) {
    try { py -3.12 -c "import sys; assert sys.version_info[:2] == (3, 12)" 2>$null; $pythonExe = 'py -3.12' } catch {}
}
if (-not $pythonExe) {
    throw 'Python 3.12 is required. Install it or set SUHA_PYTHON to a Python 3.12 executable.'
}
Invoke-Expression "$pythonExe -m venv .venv"
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -e '.[dev,vision]'
& .\.venv\Scripts\python.exe scripts\download_mediapipe_models.py
pnpm install
Write-Host 'Ready. Activate with: .\.venv\Scripts\Activate.ps1'
