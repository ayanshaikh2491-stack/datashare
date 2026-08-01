$ErrorActionPreference = 'Continue'
Write-Output '=== DNS: ayanshaikh2-datashare-relay.hf.space ==='
try { Resolve-DnsName 'ayanshaikh2-datashare-relay.hf.space' -ErrorAction Stop | Select-Object Name,Type,IPAddress | Format-Table -AutoSize | Out-String } catch { Write-Output "RESOLVE FAILED: $($_.Exception.Message)" }

Write-Output '=== DNS: jehuang-datashare.hf.space ==='
try { Resolve-DnsName 'jehuang-datashare.hf.space' -ErrorAction Stop | Select-Object Name,Type,IPAddress | Format-Table -AutoSize | Out-String } catch { Write-Output "RESOLVE FAILED: $($_.Exception.Message)" }

Write-Output '=== DNS: huggingface.co ==='
try { Resolve-DnsName 'huggingface.co' -ErrorAction Stop | Select-Object Name,Type,IPAddress | Format-Table -AutoSize | Out-String } catch { Write-Output "RESOLVE FAILED: $($_.Exception.Message)" }

Write-Output '=== curl: ayanshaikh2 space (verbose-ish) ==='
$r = curl.exe -s -o NUL -w '%{http_code}|%{time_total}|%{errormsg}' --max-time 20 'https://ayanshaikh2-datashare-relay.hf.space/'
Write-Output "curl result: $r"
