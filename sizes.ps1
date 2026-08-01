$targets = @(
  'C:\Users\TAUSHEF\datashare\openshare\build',
  'C:\Users\TAUSHEF\datashare\openshare\.dart_tool',
  'C:\Users\TAUSHEF\datashare\openshare\android\.gradle',
  'C:\Users\TAUSHEF\datashare\openshare\android\app\build',
  'C:\Users\TAUSHEF\.gradle',
  'C:\Users\TAUSHEF\AppData\Local\Pub\Cache'
)
foreach($t in $targets){
  if(Test-Path $t){
    $size = (Get-ChildItem $t -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
    Write-Output ($t + " | " + [math]::Round($size/1MB,0) + " MB")
  }
}
