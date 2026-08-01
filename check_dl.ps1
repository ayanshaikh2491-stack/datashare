$files = Get-ChildItem 'C:\Users\TAUSHEF\android-sdk\.temp' -Recurse -File
$total = ($files | Measure-Object Length -Sum).Sum
Write-Output ("FILES: " + $files.Count)
Write-Output ("SIZE_MB: " + [math]::Round($total/1MB, 1))
foreach ($f in $files) {
  Write-Output ($f.Name + " " + [math]::Round($f.Length/1MB, 1) + "MB")
}
