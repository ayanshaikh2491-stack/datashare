Add-Type -AssemblyName System.Security

$cookiePath = 'C:\Users\TAUSHEF\AppData\Local\Google\Chrome\User Data\Profile 2\Network\Cookies'
$dbPath = Join-Path $env:TEMP 'chrome-cookies-temp.db'
Copy-Item $cookiePath $dbPath -Force

$conn = New-Object System.Data.SQLite.SQLiteConnection
$conn.ConnectionString = "Data Source=$dbPath;Mode=ReadOnly;"
$conn.Open()

$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT name, encrypted_value FROM cookies WHERE host_key LIKE '%supabase%' AND name IN ('session_id', 'sb-access-token', 'access_token', 'token')"
$reader = $cmd.ExecuteReader()

while ($reader.Read()) {
    $name = $reader.GetString(0)
    $encrypted = $reader.GetValue(1)
    Write-Output "`nCookie: $name"
    Write-Output "Encrypted bytes: $($encrypted.Length)"
    
    if ($encrypted.Length -gt 0) {
        try {
            $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, 'CurrentUser')
            $value = [System.Text.Encoding]::UTF8.GetString($decrypted)
            Write-Output "DECRYPTED: $value"
        } catch {
            Write-Output "Decrypt failed: $_"
        }
    }
}

$conn.Close()
Remove-Item $dbPath -Force -ErrorAction SilentlyContinue
