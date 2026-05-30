Add-Type -AssemblyName System.Security
$data = [System.IO.File]::ReadAllBytes('C:\Users\TAUSHEF\datashare\tmp-cookie-session_id.bin')
$decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($data, $null, 'CurrentUser')
[System.Text.Encoding]::UTF8.GetString($decrypted)
