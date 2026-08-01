$ErrorActionPreference = 'SilentlyContinue'
Write-Output '=== lib files ==='
Get-ChildItem -Recurse 'C:\Users\TAUSHEF\datashare\openshare\lib' -File | ForEach-Object { $_.FullName.Replace('C:\Users\TAUSHEF\datashare\openshare\','') }

Write-Output ''
Write-Output '=== Endpoint search in openshare project ==='
Get-ChildItem -Recurse 'C:\Users\TAUSHEF\datashare\openshare' -Include *.dart,*.yaml,*.json -File |
  Where-Object { $_.FullName -notmatch 'build|\.dart_tool' } |
  Select-String -Pattern 'hf\.space|onrender|http://|https://|WebSocket|ws://|wss://|apiUrl|baseUrl|serverUrl' |
  Select-Object -First 40 |
  ForEach-Object { '{0}:{1}: {2}' -f $_.Path.Replace('C:\Users\TAUSHEF\datashare\openshare\',''), $_.LineNumber, $_.Line.Trim() }
