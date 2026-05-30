$cookiePath = 'C:\Users\TAUSHEF\AppData\Local\Google\Chrome\User Data-DEBUG\Default\Network\Cookies'
$bytes = [System.IO.File]::ReadAllBytes($cookiePath)
$magic = [System.Text.Encoding]::ASCII.GetString($bytes[0..15])
Write-Output "File magic: $magic"
Write-Output "File size: $($bytes.Length) bytes"

# Also check for Supabase cookies
$connStr = "Data Source=$cookiePath;Mode=ReadOnly;"
Add-Type -AssemblyName System.Data
$dataSource = New-Object System.Data.SQLite.SQLiteConnection
$dataSource.ConnectionString = $connStr
try {
    $dataSource.Open()
    $cmd = $dataSource.CreateCommand()
    $cmd.CommandText = "SELECT host_key, name, LENGTH(encrypted_value) as enc_len FROM cookies WHERE host_key LIKE '%supabase%' LIMIT 10"
    $reader = $cmd.ExecuteReader()
    while ($reader.Read()) {
        Write-Output "Host: $($reader['host_key']), Name: $($reader['name']), Encrypted: $($reader['enc_len']) bytes"
    }
    $dataSource.Close()
} catch {
    Write-Output "SQLite not available or error: $_"
}
