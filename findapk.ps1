Get-ChildItem 'C:\Users\TAUSHEF\datashare' -Recurse -Filter *.apk -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName + ' | ' + [math]::Round($_.Length/1MB,1) + ' MB' }
