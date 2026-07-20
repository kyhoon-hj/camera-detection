param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$LicenseReference,
  [ValidateSet("aihub-sign-video", "aihub-disaster-safety", "nikl-parallel")][string]$DatasetType = "aihub-sign-video",
  [string]$OutputRoot = "output\ksl-public-model",
  [int]$Epochs = 80,
  [switch]$ConfirmLicense,
  [switch]$ExtractLandmarks
)

$ErrorActionPreference = "Stop"
if (-not $ConfirmLicense) { throw "Use -ConfirmLicense only after reviewing and accepting the dataset terms." }

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$python = Join-Path $repoRoot ".venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { throw "Project Python environment not found: $python" }

$sourcePath = (Resolve-Path -LiteralPath $Source).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputRoot))
$datasetPath = Join-Path $outputPath "dataset"
$modelPath = Join-Path $outputPath "model"

& $python -m suha_server.cli ksl-dataset validate $sourcePath --dataset-type $DatasetType
if ($LASTEXITCODE -ne 0) { throw "KSL source validation failed." }

$importArgs = @("-m", "suha_server.cli", "ksl-dataset", "import", $sourcePath, $datasetPath, "--dataset-type", $DatasetType, "--confirm-license", "--license-reference", $LicenseReference)
if ($ExtractLandmarks) { $importArgs += "--extract-landmarks" }
& $python @importArgs
if ($LASTEXITCODE -ne 0) { throw "KSL dataset import failed." }

& $python -m suha_server.cli train-ksl-baseline $datasetPath $modelPath --model-id suha-ksl-public-v1 --version 1.0.0 --epochs $Epochs
if ($LASTEXITCODE -ne 0) { throw "KSL model training failed." }

Write-Output (Join-Path $modelPath "manifest.json")
