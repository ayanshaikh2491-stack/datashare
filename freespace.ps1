$c = Get-PSDrive C
Write-Output ("C free: " + [math]::Round($c.Free/1MB,0) + " MB")
