$d='C:\Users\TAUSHEF\android-sdk\.temp'
if(Test-Path $d){
  Get-ChildItem $d -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 5 Name,Length,LastWriteTime | Format-Table -AutoSize
} else { 'no temp folder' }
