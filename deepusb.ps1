Write-Output '=== ALL USB PNP DEVICES (with problems) ==='
Get-PnpDevice -PresentOnly -Class USB | Select-Object Status,InstanceId | Format-Table -AutoSize
Write-Output '=== Portable/WPD devices ==='
Get-PnpDevice -PresentOnly | Where-Object { $_.Class -match 'WPD|Android|Portable' -or $_.FriendlyName -match 'ADB|Android|MTP' } | Select-Object Status,Class,FriendlyName | Format-Table -AutoSize
Write-Output '=== Errors in setupapi log (recent) ==='
Get-Content C:\Windows\INF\setupapi.dev.log -Tail 60 -ErrorAction SilentlyContinue | Select-String -Pattern 'fail|error|!!!|Android' | Select-Object -Last 15
