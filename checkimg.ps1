$base = "$env:USERPROFILE\android-sdk\system-images"
if(Test-Path $base){
  Get-ChildItem $base -Recurse -Directory | Select-Object -ExpandProperty FullName
} else { "NO system-images dir" }
