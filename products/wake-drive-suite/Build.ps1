param([switch]$Install, [switch]$Android)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$gate = 'C:\Users\김영화\Documents\Codex\2026-09-11\new-chat-2\outputs\Invoke-DevHeavy.ps1'
if (!(Test-Path -LiteralPath $gate)) { throw 'Shared build gate was not found. Set its path in Build.ps1 before building on another PC.' }
if ($Install) { & $gate -WorkingDirectory $root -Command { & npm.cmd ci --no-audit --no-fund } }
& $gate -WorkingDirectory $root -Command { & npm.cmd test }
& $gate -WorkingDirectory $root -Command { & npm.cmd run typecheck }
& $gate -WorkingDirectory $root -Command { & npm.cmd run branding }
& $gate -WorkingDirectory $root -Command { & npm.cmd run build:web }
if ($Android) {
  & $gate -WorkingDirectory $root -Command { & npm.cmd run android:sync }
  $sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { Join-Path $env:LOCALAPPDATA 'Android\Sdk' }
  if (!(Test-Path -LiteralPath $sdk)) { throw 'Android SDK not found. Set ANDROID_HOME.' }
  $native = Join-Path $root 'native\jolbang\android'
  # java.util.Properties uses ISO-8859-1; encode non-ASCII path characters explicitly.
  $escaped = $sdk.Replace('\','/').Replace(':','\:')
  $escaped = -join ($escaped.ToCharArray() | ForEach-Object { if ([int]$_ -gt 127) { '\u{0:x4}' -f [int]$_ } else { [string]$_ } })
  [IO.File]::WriteAllText((Join-Path $native 'local.properties'), "sdk.dir=$escaped`n", [Text.Encoding]::ASCII)
  # Match Gradle's worker argument-file encoding to the Java launcher's OS encoding.
  $runtime = Join-Path $root '.runtime'
  New-Item -ItemType Directory -Force -Path $runtime | Out-Null
  $javaSettingsPath = Join-Path $runtime 'java-settings.log'
  $javaProcess = Start-Process -FilePath (Get-Command java.exe).Source -ArgumentList @('-XshowSettings:properties','-version') -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $javaSettingsPath -RedirectStandardOutput (Join-Path $runtime 'java-stdout.log')
  if ($javaProcess.ExitCode -ne 0) { throw 'Java environment inspection failed.' }
  $javaSettings = [IO.File]::ReadAllText($javaSettingsPath)
  $encodingMatch = [regex]::Match($javaSettings, 'native.encoding\s*=\s*(\S+)')
  if (!$encodingMatch.Success) { throw 'Cannot detect Java native.encoding. JDK 21 is required.' }
  $testJvmArgs = '-Dorg.gradle.jvmargs=-Xmx1536m -Dfile.encoding=' + $encodingMatch.Groups[1].Value
  & $gate -WorkingDirectory $native -Command { & .\gradlew.bat :app:testDebugUnitTest $testJvmArgs --console=plain --max-workers=2 --no-daemon }
  & $gate -WorkingDirectory $native -Command { & .\gradlew.bat assembleDebug --console=plain --max-workers=2 --no-daemon }
  New-Item -ItemType Directory -Force -Path (Join-Path $root 'releases') | Out-Null
  Copy-Item -LiteralPath (Join-Path $native 'app\build\outputs\apk\debug\app-debug.apk') -Destination (Join-Path $root 'releases\wake-drive-debug.apk')
}
