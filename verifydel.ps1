$g = 'C:\Users\TAUSHEF\.gradle'
if(Test-Path $g){
  $s = (Get-ChildItem $g -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  Write-Output ("GRADLE: " + [math]::Round($s/1MB,0) + " MB")
  Get-ChildItem $g -Directory -ErrorAction SilentlyContinue | Select-Object -First 10 -ExpandProperty FullName
} else { 'GRADLE GONE' }
$p = 'C:\Users\TAUSHEF\AppData\Local\Pub\Cache'
if(Test-Path $p){ Write-Output 'PUB:EXISTS' } else { Write-Output 'PUB:GONE' }
