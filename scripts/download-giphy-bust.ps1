param(
    [string]$LinkFile = "./media-gathering/Giphy Bust Links.txt",
    [string]$OutputDir = "./media/bust",
    [int]$ThrottleMs = 10000,
    [string[]]$OutputFormats = @("webm")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $LinkFile)) {
    throw "Link file not found: $LinkFile"
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
    New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$urls = Get-Content -LiteralPath $LinkFile | Where-Object { $_.Trim() -ne "" }

$client = New-Object System.Net.Http.HttpClient
$client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (compatible; FarkleAssetFetcher/1.0)")

if ($OutputFormats.Count -gt 0) {
    $ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
    if (-not $ffmpeg) {
        throw "ffmpeg not found in PATH. Install it or adjust OutputFormats to empty to skip conversion."
    }
}

foreach ($url in $urls) {
    $trimmed = $url.Trim()
    # Capture the segment before the final slash (the unique id)
    $match = [regex]::Match($trimmed, "/([^/]+)/[^/]+$")
    if (-not $match.Success) {
        throw "Could not extract id from URL: $trimmed"
    }
    $id = $match.Groups[1].Value
    $baseName = "giphy-$id"
    $gifName = "$baseName.gif"
    $gifPath = Join-Path $OutputDir $gifName

    $convertedTargets = @{}
    foreach ($fmt in $OutputFormats) {
        $convertedTargets[$fmt] = Join-Path $OutputDir "$baseName.$fmt"
    }

    $allConvertedPresent = $true
    foreach ($fmt in $OutputFormats) {
        if (-not (Test-Path -LiteralPath $convertedTargets[$fmt])) {
            $allConvertedPresent = $false
            break
        }
    }

    if ($allConvertedPresent -and $OutputFormats.Count -gt 0) {
        Write-Host "Skip existing converted: $baseName"
        continue
    }

    # Ensure we have a GIF copy (primary source); download if missing
    if (-not (Test-Path -LiteralPath $gifPath)) {
        Write-Host "Downloading gif: $gifName"
        $responseGif = $client.GetAsync($trimmed).GetAwaiter().GetResult()
        if (-not $responseGif.IsSuccessStatusCode) {
            throw "Download failed $($responseGif.StatusCode): $trimmed"
        }

        $bytesGif = $responseGif.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
        if (-not $bytesGif -or $bytesGif.Length -lt 64) {
            throw "Downloaded gif too small or empty: $trimmed"
        }

        [IO.File]::WriteAllBytes($gifPath, $bytesGif)
        $gifSize = (Get-Item -LiteralPath $gifPath).Length
        if ($gifSize -lt 2KB) {
            throw "Saved gif too small: $gifPath"
        }

        Start-Sleep -Milliseconds $ThrottleMs
    }

    $sourceCandidates = @(@{ Path = $gifPath; Label = "gif" })

    $converted = $false
    foreach ($fmt in $OutputFormats) {
        $targetPath = $convertedTargets[$fmt]
        if (Test-Path -LiteralPath $targetPath) {
            continue
        }

        $conversionSucceeded = $false
        foreach ($source in $sourceCandidates) {
            $inputPath = $source.Path
            $label = $source.Label

            Write-Host "Converting (${label} -> .$fmt): $baseName"
            try {
                switch ($fmt.ToLower()) {
                    "webm" {
                        & $ffmpeg.Path -y -i $inputPath -c:v libvpx-vp9 -pix_fmt yuv420p -b:v 0 -crf 32 -an $targetPath
                    }
                    "m4v" {
                        & $ffmpeg.Path -y -i $inputPath -c:v libx264 -pix_fmt yuv420p -crf 23 -preset veryfast -an -movflags +faststart $targetPath
                    }
                    default {
                        throw "Unsupported output format: $fmt"
                    }
                }

                if ($LASTEXITCODE -ne 0) {
                    throw "ffmpeg exited with code $LASTEXITCODE for $inputPath"
                }

                if (-not (Test-Path -LiteralPath $targetPath)) {
                    throw "Conversion did not produce file: $targetPath"
                }

                $outSize = (Get-Item -LiteralPath $targetPath).Length
                if ($outSize -lt 1KB) {
                    throw "Converted file too small: $targetPath"
                }

                $conversionSucceeded = $true
                break
            }
            catch {
                Write-Warning "Conversion failed using $label for $baseName to .$fmt : $_"
                if (Test-Path -LiteralPath $targetPath) {
                    Remove-Item -LiteralPath $targetPath -ErrorAction SilentlyContinue
                }
            }
        }

        if (-not $conversionSucceeded) {
            throw "All sources failed conversion for $baseName to .$fmt"
        }

        $converted = $true
    }
}

Write-Host "Done."