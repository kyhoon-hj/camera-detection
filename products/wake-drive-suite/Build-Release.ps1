param([switch]$AllowUnsigned)
$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$gate='C:\Users\김영화\Documents\Codex\2026-09-11\new-chat-2\outputs\Invoke-DevHeavy.ps1'
$signingNames=@('WAKE_UPLOAD_STORE_FILE','WAKE_UPLOAD_KEY_ALIAS','WAKE_UPLOAD_STORE_PASSWORD','WAKE_UPLOAD_KEY_PASSWORD')
$signed=@($signingNames | Where-Object { [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($_)) }).Count -eq 0
if (!$signed -and !$AllowUnsigned) { throw 'Upload signing is not configured. Set WAKE_UPLOAD_* environment variables, or use -AllowUnsigned only to generate a review bundle that cannot be uploaded.' }
if ($signed -and !(Test-Path -LiteralPath $env:WAKE_UPLOAD_STORE_FILE)) { throw 'Upload keystore was not found.' }
& $gate -WorkingDirectory $root -Command { & npm.cmd test }
& $gate -WorkingDirectory $root -Command { & npm.cmd run typecheck }
& $gate -WorkingDirectory $root -Command { & npm.cmd run build:web }
& $gate -WorkingDirectory $root -Command { & npm.cmd run android:sync }
$native=Join-Path $root 'native/jolbang/android'
& $gate -WorkingDirectory $native -Command { & .\gradlew.bat :app:assembleDebug :app:bundleRelease :app:assembleRelease --console=plain --max-workers=2 --no-daemon }
$suffix=if($signed){'signed'}else{'unsigned'}
New-Item -ItemType Directory -Force -Path (Join-Path $root 'releases') | Out-Null
Copy-Item -LiteralPath (Join-Path $native 'app/build/outputs/bundle/release/app-release.aab') -Destination (Join-Path $root "releases/wake-drive-1.0.0-release-$suffix.aab")
$apkName=if($signed){'app-release.apk'}else{'app-release-unsigned.apk'}
Copy-Item -LiteralPath (Join-Path $native "app/build/outputs/apk/release/$apkName") -Destination (Join-Path $root "releases/wake-drive-1.0.0-release-$suffix.apk")
Copy-Item -LiteralPath (Join-Path $native 'app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $root 'releases/wake-drive-debug.apk')
Write-Output "Release artifact signing state: $suffix"
