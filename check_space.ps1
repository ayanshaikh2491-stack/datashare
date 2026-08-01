$dirs = @(
  'C:\Users\TAUSHEF\datashare\openshare\build',
  'C:\Users\TAUSHEF\datashare\agent-device',
  'C:\Users\TAUSHEF\android-sdk\.temp',
  'C:\Users\TAUSHEF\datashare\server\node_modules'
)
foreach ($d in $dirs) {
  if (Test-Path $d) {
    $s = (Get-ChildItem $d -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    Write-Output ($d + " => " + [math]::Round($s/1MB,0) + " MB")
  } else {
    Write-Output ($d + " => missing")
  }
}
$c = Get-PSDrive C
Write-Output ("C free now: " + [math]::Round($c.Free/1MB,0) + " MB")
