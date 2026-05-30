# Flutter Download & Install Script
$url = "https://storage.googleapis.com/flutter_infra_release/releases/stable/windows/flutter_windows_3.27.4-stable.zip"
$zipPath = "C:\flutter-sdk.zip"
$extractPath = "C:\"

Write-Host "Downloading Flutter SDK..." -ForegroundColor Green
Write-Host "URL: $url"
Write-Host "Size: ~1GB (this will take a few minutes)"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$wc = New-Object System.Net.WebClient
$wc.DownloadFile($url, $zipPath)

Write-Host "Download complete!" -ForegroundColor Green
Write-Host "Extracting..." -ForegroundColor Green

Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

Write-Host "Flutter extracted to C:\flutter\" -ForegroundColor Green
Write-Host ""
Write-Host "NOW ADD TO PATH:" -ForegroundColor Yellow
Write-Host "1. Win+R -> sysdm.cpl -> Advanced -> Environment Variables"
Write-Host "2. Path -> Edit -> New -> C:\flutter\bin"
Write-Host "3. Open NEW terminal and run: flutter doctor"
Write-Host ""
Write-Host "Cleaning up zip file..."
Remove-Item $zipPath -Force
