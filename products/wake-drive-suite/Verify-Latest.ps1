$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$snapshot = Get-Content -LiteralPath (Join-Path $root 'docs/SOURCE_SNAPSHOT.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$sourceChanges = @($snapshot.files | Where-Object { (Get-FileHash -LiteralPath (Join-Path $snapshot.source $_.path) -Algorithm SHA256).Hash -ne $_.sha256 } | ForEach-Object { $_.path })
$status = @(& git -C $snapshot.source -c status.relativePaths=false status --short -- .)
$statusUnchanged = @(Compare-Object @($snapshot.status) $status).Count -eq 0
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apkPath = Join-Path $root 'releases/wake-drive-debug.apk'
$zip = [IO.Compression.ZipFile]::OpenRead($apkPath)
$dist = Join-Path $root 'dist/jolbang'
$assetCount = 0
$mismatches = @()
try {
  Get-ChildItem -LiteralPath $dist -File -Recurse | ForEach-Object {
    $relative = $_.FullName.Substring($dist.Length + 1).Replace('\','/')
    $entry = $zip.GetEntry('assets/public/' + $relative)
    if (!$entry) { $mismatches += $relative; return }
    $stream = $entry.Open()
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose(); $sha.Dispose() }
    if ($hash -ne (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash) { $mismatches += $relative }
    $assetCount++
  }
} finally { $zip.Dispose() }
$listener = Get-NetTCPConnection -LocalPort 5220 -State Listen | Select-Object -First 1
$owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
$http = @('/','/brand/wake-drive-mascot.svg','/brand/driver-placement-ko.png','/brand/driver-placement-en.png','/media/rock-star.mp4','/posters/rock-star.webp') | ForEach-Object { @{ path=$_; status=(Invoke-WebRequest -Uri ('http://127.0.0.1:5220' + $_) -Method Head -UseBasicParsing).StatusCode } }
$rockHash = (Get-FileHash -LiteralPath (Join-Path $root 'public/media/rock-star.mp4')).Hash
$result = [ordered]@{
  checkedAt = (Get-Date).ToString('o')
  source = $snapshot.source
  sourceFilesChecked = $snapshot.files.Count
  sourceFileChanges = $sourceChanges
  sourceGitStatusUnchanged = $statusUnchanged
  apkSha256 = (Get-FileHash -LiteralPath $apkPath).Hash
  apkWebAssetsChecked = $assetCount
  apkAssetMismatches = $mismatches
  rockStarMatchesSuppliedVideo = $rockHash -eq '19B720375E4E4357078AE1B1DAC20FD005FB24A0918E599F1F3DE73EE293EF3B'
  serverPid = $listener.OwningProcess
  serverCommandLine = $owner.CommandLine
  serverUsesLatestProject = $owner.CommandLine.Contains($root)
  http = $http
}
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $root 'docs/RESTORE_EVIDENCE.json') -Encoding UTF8
$result | ConvertTo-Json -Depth 6
if ($sourceChanges.Count -or !$statusUnchanged -or $mismatches.Count -or !$result.serverUsesLatestProject -or !$result.rockStarMatchesSuppliedVideo) { throw 'Verification failed; see RESTORE_EVIDENCE.json.' }
