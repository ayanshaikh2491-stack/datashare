$dirs = @(
  'C:\Users\TAUSHEF\.android',
  'C:\Users\TAUSHEF\android-sdk\system-images',
  'C:\Users\TAUSHEF\android-sdk\.temp',
  'C:\Users\TAUSHEF\datashare',
  'C:\Users\TAUSHEF\AppData\Local\Temp'
)
foreach($t in $dirs){
  if(Test-Path $t){
    $size = (Get-ChildItem $t -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    Write-Output ($t + " | " + [math]::Round($size/1MB,0) + " MB")
  }
}
$c = Get-PSDrive C
Write-Output ("C free: " + [math]::Round($c.Free/1MB,0) + " MB")
