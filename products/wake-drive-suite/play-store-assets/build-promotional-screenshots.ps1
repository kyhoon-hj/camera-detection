param(
    [string]$AssetsRoot = $PSScriptRoot
)

Add-Type -AssemblyName System.Drawing

$sourceRoot = Join-Path $AssetsRoot 'screenshots'
$outputRoot = Join-Path $AssetsRoot 'screenshots-promotional'
New-Item -ItemType Directory -Force -Path $outputRoot | Out-Null

$canvasWidth = 1080
$canvasHeight = 1920
$contentTop = 350
$contentBottom = 1870
$contentLeft = 96
$contentWidth = 888
$fontFamily = New-Object System.Drawing.FontFamily('Malgun Gothic')

function New-RoundedPath {
    param([System.Drawing.RectangleF]$Rect, [float]$Radius)
    $diameter = $Radius * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($Rect.X, $Rect.Y, $diameter, $diameter, 180, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Y, $diameter, $diameter, 270, 90)
    $path.AddArc($Rect.Right - $diameter, $Rect.Bottom - $diameter, $diameter, $diameter, 0, 90)
    $path.AddArc($Rect.X, $Rect.Bottom - $diameter, $diameter, $diameter, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-PromoScreenshot {
    param(
        [string]$SourceName,
        [string]$OutputName,
        [string]$Eyebrow,
        [string]$Headline,
        [float]$CropY,
        [float]$CropHeight
    )

    $sourcePath = Join-Path $sourceRoot $SourceName
    $source = [System.Drawing.Bitmap]::FromFile($sourcePath)
    $canvas = New-Object System.Drawing.Bitmap($canvasWidth, $canvasHeight, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $background = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Rectangle(0, 0, $canvasWidth, $canvasHeight)),
        [System.Drawing.Color]::FromArgb(12, 9, 22),
        [System.Drawing.Color]::FromArgb(22, 15, 35),
        90
    )
    $graphics.FillRectangle($background, 0, 0, $canvasWidth, $canvasHeight)

    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 205, 255, 0))
    $graphics.FillEllipse($glowBrush, 700, -120, 520, 520)
    $glowBrush.Dispose()
    $glowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(28, 0, 238, 255))
    $graphics.FillEllipse($glowBrush, -180, 180, 520, 520)
    $glowBrush.Dispose()

    $eyebrowFont = New-Object System.Drawing.Font($fontFamily, 25, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $headlineFont = New-Object System.Drawing.Font($fontFamily, 57, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $eyebrowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 231, 255, 43))
    $headlineBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $graphics.DrawString($Eyebrow, $eyebrowFont, $eyebrowBrush, 96, 78)
    $graphics.DrawString($Headline, $headlineFont, $headlineBrush, (New-Object System.Drawing.RectangleF(92, 125, 900, 170)))

    $shadowRect = New-Object System.Drawing.RectangleF(($contentLeft + 12), ($contentTop + 18), $contentWidth, ($contentBottom - $contentTop))
    $shadowPath = New-RoundedPath -Rect $shadowRect -Radius 44
    $shadowBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(110, 0, 0, 0))
    $graphics.FillPath($shadowBrush, $shadowPath)

    $frameRect = New-Object System.Drawing.RectangleF($contentLeft, $contentTop, $contentWidth, ($contentBottom - $contentTop))
    $framePath = New-RoundedPath -Rect $frameRect -Radius 44
    $graphics.SetClip($framePath)
    $srcRect = New-Object System.Drawing.RectangleF(0, $CropY, $source.Width, $CropHeight)
    $graphics.DrawImage($source, $frameRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $graphics.ResetClip()

    $framePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 207, 255, 0), 3)
    $graphics.DrawPath($framePen, $framePath)

    $outputPath = Join-Path $outputRoot $OutputName
    $canvas.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $framePen.Dispose()
    $framePath.Dispose()
    $shadowBrush.Dispose()
    $shadowPath.Dispose()
    $headlineBrush.Dispose()
    $eyebrowBrush.Dispose()
    $headlineFont.Dispose()
    $eyebrowFont.Dispose()
    $background.Dispose()
    $graphics.Dispose()
    $canvas.Dispose()
    $source.Dispose()
}

New-PromoScreenshot -SourceName '02-main.png' -OutputName '01-drowsiness-detection.png' `
    -Eyebrow 'WAKE DRIVE' -Headline "졸음 신호를 감지하면`n깨우기 영상이 바로 출동" -CropY 0 -CropHeight 1920

New-PromoScreenshot -SourceName '03-collection.png' -OutputName '02-video-collection.png' `
    -Eyebrow '11가지 깨우기 영상' -Headline "내 취향대로 고르는`n강력한 깨우기 영상" -CropY 0 -CropHeight 1920

New-PromoScreenshot -SourceName '01-privacy.png' -OutputName '03-on-device-privacy.png' `
    -Eyebrow '개인정보 보호' -Headline "카메라 영상은`n기기 안에서만 분석" -CropY 250 -CropHeight 1550

New-PromoScreenshot -SourceName '05-settings.png' -OutputName '04-alert-settings.png' `
    -Eyebrow '맞춤형 안전 설정' -Headline "경보음과 음성 안내로`n위험 순간을 또렷하게" -CropY 0 -CropHeight 1920

$fontFamily.Dispose()

Get-ChildItem $outputRoot -Filter '*.png' | Select-Object Name, Length, FullName
