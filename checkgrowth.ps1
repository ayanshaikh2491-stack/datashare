Start-Sleep 8
$f = Get-Item 'C:\Users\TAUSHEF\android-sdk\.temp\system.img' -ErrorAction SilentlyContinue
if($f){ $f | Select-Object Length,LastWriteTime | Format-Table -AutoSize }
Write-Output ("NOW: " + (Get-Date))
