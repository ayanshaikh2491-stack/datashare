$ErrorActionPreference = 'SilentlyContinue'
Write-Output '=== URLs in Flutter lib ==='
Get-ChildItem -Recurse 'C:\Users\TAUSHEF\datashare\openshare\lib' -Filter *.dart |
  Select-String -Pattern 'https?://' |
  Where-Object { $_.Line -notmatch 'flutter|fonts|pub.dev|dart.dev|schemas' } |
  Select-Object -First 30 |
  ForEach-Object { '{0}:{1}: {2}' -f $_.Path.Replace('C:\Users\TAUSHEF\datashare\openshare\',''), $_.LineNumber, $_.Line.Trim() }

Write-Output ''
Write-Output '=== _hf-space files ==='
Get-ChildItem -Recurse 'C:\Users\TAUSHEF\datashare\_hf-space' -File | ForEach-Object { $_.FullName.Replace('C:\Users\TAUSHEF\datashare\','') }
Write-Output ''
Write-Output '=== _hf-space/package.json ==='
Get-Content 'C:\Users\TAUSHEF\datashare\_hf-space\package.json' -ErrorAction SilentlyContinue
