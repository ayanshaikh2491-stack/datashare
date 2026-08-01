'--- system-images contents ---'
Get-ChildItem 'C:\Users\TAUSHEF\android-sdk\system-images' -Recurse -File -ErrorAction SilentlyContinue | Select-Object @{n='Path';e={$_.FullName.Replace('C:\Users\TAUSHEF\android-sdk\system-images\','')}}, @{n='MB';e={[math]::Round($_.Length/1MB,0)}} | Sort-Object MB -Descending | Select-Object -First 15 | Format-Table -AutoSize
'--- gradle still exists? ---'
Test-Path 'C:\Users\TAUSHEF\.gradle'
'--- pub cache still exists? ---'
Test-Path 'C:\Users\TAUSHEF\AppData\Local\Pub\Cache'
'--- emulator dir ---'
if(Test-Path 'C:\Users\TAUSHEF\android-sdk\emulator'){
  $s = (Get-ChildItem 'C:\Users\TAUSHEF\android-sdk\emulator' -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
  Write-Output ("emulator | " + [math]::Round($s/1MB,0) + " MB")
}
