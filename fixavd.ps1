$ini = "$env:USERPROFILE\.android\avd\openshare_test.avd\config.ini"
$content = Get-Content $ini
$map = @{}
foreach($line in $content){ if($line -match '^([^=]+)=(.*)$'){ $map[$matches[1]] = $matches[2] } }
$map['disk.dataPartition.size'] = '1536M'
$map['disk.cachePartition.size'] = '256M'
$map['disk.systemPartition.size'] = '1536M'
$map['hw.ramSize'] = '2048'
$out = ($map.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" })
$out | Set-Content $ini -Encoding ASCII
'Updated config.ini:'
Get-Content $ini | Select-String 'disk.|hw.ramSize'
