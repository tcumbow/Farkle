param(
    [string]$LinkFile = "./media-gathering/Giphy Bust Links.txt",
    [string]$OutputDir = "./media/bust",
    [int]$ThrottleMs = 10000
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

foreach ($url in $urls) {
    $trimmed = $url.Trim()
    # Capture the segment before the final slash (the unique id)
    $match = [regex]::Match($trimmed, "/([^/]+)/[^/]+$")
    if (-not $match.Success) {
        throw "Could not extract id from URL: $trimmed"
    }
    $id = $match.Groups[1].Value
    $fileName = "giphy-$id.webp"
    $destPath = Join-Path $OutputDir $fileName

    if (Test-Path -LiteralPath $destPath) {
        Write-Host "Skip existing: $fileName"
        continue
    }

    $webpUrl = $trimmed -replace "\.gif$", ".webp"
    if ($webpUrl -eq $trimmed) {
        throw "URL did not end in .gif: $trimmed"
    }

    Write-Host "Downloading: $fileName"
    $response = $client.GetAsync($webpUrl).GetAwaiter().GetResult()
    if (-not $response.IsSuccessStatusCode) {
        throw "Download failed $($response.StatusCode): $webpUrl"
    }

    $bytes = $response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
    if (-not $bytes -or $bytes.Length -lt 64) {
        throw "Downloaded file too small or empty: $webpUrl"
    }

    [IO.File]::WriteAllBytes($destPath, $bytes)

    $size = (Get-Item -LiteralPath $destPath).Length
    if ($size -lt 20KB) {
        throw "Saved file too small: $destPath"
    }

    Start-Sleep -Milliseconds $ThrottleMs
}

Write-Host "Done."