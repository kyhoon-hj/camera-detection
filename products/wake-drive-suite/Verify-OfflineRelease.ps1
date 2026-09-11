$ErrorActionPreference='Stop'
$root=$PSScriptRoot
$sdk=if($env:ANDROID_HOME){$env:ANDROID_HOME}else{Join-Path $env:LOCALAPPDATA 'Android/Sdk'}
$aapt=Join-Path $sdk 'build-tools/36.0.0/aapt.exe'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$forbidden=@('android.permission.ACCESS_FINE_LOCATION','android.permission.ACCESS_COARSE_LOCATION','android.permission.ACCESS_BACKGROUND_LOCATION','android.permission.INTERNET','android.permission.ACCESS_NETWORK_STATE','com.google.android.gms.permission.AD_ID')
$results=@()
Push-Location (Join-Path $root 'releases')
try {
  foreach($name in @('wake-drive-debug.apk','wake-drive-1.0.0-release-unsigned.apk','wake-drive-1.0.0-release-unsigned.aab')) {
    if(!(Test-Path -LiteralPath $name)){throw "Missing artifact: $name"}
    $zip=[IO.Compression.ZipFile]::OpenRead((Join-Path (Get-Location).Path $name))
    $sdkHits=@()
    try {
      if($name.EndsWith('.apk')) {
        $permissions=(& $aapt dump permissions $name) -join "`n"
        if($LASTEXITCODE -ne 0){throw 'Cannot inspect APK permissions'}
        $metadata=(& $aapt dump badging $name) -join "`n"
        if($LASTEXITCODE -ne 0){throw 'Cannot inspect APK metadata'}
        if($name.Contains('release') -and $metadata.Contains('application-debuggable')){throw 'Release APK is debuggable'}
      } else {
        $entry=$zip.GetEntry('base/manifest/AndroidManifest.xml')
        $stream=$entry.Open();$buffer=New-Object IO.MemoryStream
        try {$stream.CopyTo($buffer);$permissions=[Text.Encoding]::UTF8.GetString($buffer.ToArray())}finally{$stream.Dispose();$buffer.Dispose()}
      }
      foreach($permission in $forbidden){if($permissions.Contains($permission)){throw "Forbidden permission in ${name}: $permission"}}
      if(!$permissions.Contains('android.permission.CAMERA')){throw "Camera permission missing in $name"}
      foreach($entry in $zip.Entries | Where-Object {$_.FullName -match '(^|/)classes\d*\.dex$'}) {
        $stream=$entry.Open();$buffer=New-Object IO.MemoryStream
        try {$stream.CopyTo($buffer);$dex=[Text.Encoding]::UTF8.GetString($buffer.ToArray())}finally{$stream.Dispose();$buffer.Dispose()}
        foreach($pattern in @('Lcom/google/firebase/','Lcom/google/android/gms/ads/','Lcom/getcapacitor/community/admob/')){if($dex.Contains($pattern)){$sdkHits+=$pattern}}
      }
      if($sdkHits.Count){throw "Advertising/analytics SDK remains in $name"}
      $results+=[ordered]@{file=$name;bytes=(Get-Item -LiteralPath $name).Length;sha256=(Get-FileHash -LiteralPath $name).Hash;cameraPermission=$true;forbiddenPermissions=@();advertisingAnalyticsSdkClasses=@();uploadReady=$false;signing=if($name -eq 'wake-drive-debug.apk'){'debug'}else{'unsigned'}}
    } finally {$zip.Dispose()}
  }
} finally {Pop-Location}
$report=[ordered]@{checkedAt=(Get-Date).ToString('o');version='1.0.0';versionCode=27;artifacts=$results;remaining=@('Upload signing key','Public privacy policy must be aligned with Wake Drive offline behavior','Play Console declarations and device acceptance tests')}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $root 'docs/OFFLINE_RELEASE_EVIDENCE.json') -Encoding UTF8
$report | ConvertTo-Json -Depth 8
