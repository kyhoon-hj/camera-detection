$ErrorActionPreference = 'Stop'
# Create and back up your own upload key in Android Studio before running this script.
# Secrets are read interactively, inherited by Gradle only, and removed on exit.
$names = @('WAKE_UPLOAD_STORE_FILE','WAKE_UPLOAD_KEY_ALIAS','WAKE_UPLOAD_STORE_PASSWORD','WAKE_UPLOAD_KEY_PASSWORD')
$previous = @{}
foreach ($name in $names) { $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
try {
  $keyPath = Read-Host 'Upload keystore full path (.jks)'
  if (!(Test-Path -LiteralPath $keyPath -PathType Leaf)) { throw 'Keystore not found.' }
  $env:WAKE_UPLOAD_STORE_FILE = (Resolve-Path -LiteralPath $keyPath).Path
  $env:WAKE_UPLOAD_KEY_ALIAS = Read-Host 'Upload key alias'
  foreach ($name in @('WAKE_UPLOAD_STORE_PASSWORD','WAKE_UPLOAD_KEY_PASSWORD')) {
    $secret = Read-Host $name -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { [Environment]::SetEnvironmentVariable($name, [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer), 'Process') }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
  }
  & (Join-Path $PSScriptRoot 'Build-Release.ps1')
} finally {
  foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
