const Database = require('better-sqlite3');
const { execSync } = require('child_process');

const cookiePath = 'C:/Users/TAUSHEF/AppData/Local/Google/Chrome/User Data/Default/Network/Cookies';

try {
  const db = new Database(cookiePath, { readonly: true });
  
  // Find all Supabase-related cookies
  const cookies = db.prepare(`
    SELECT host_key, name, encrypted_value, path 
    FROM cookies 
    WHERE host_key LIKE '%supabase%'
  `).all();
  
  console.log(`Found ${cookies.length} Supabase cookies:`);
  
  for (const cookie of cookies) {
    console.log(`\nHost: ${cookie.host_key}`);
    console.log(`Name: ${cookie.name}`);
    console.log(`Path: ${cookie.path}`);
    console.log(`Encrypted length: ${cookie.encrypted_value.length} bytes`);
    console.log(`First 10 bytes (hex): ${cookie.encrypted_value.toString('hex').substring(0, 20)}`);
    
    // Try to decrypt using Windows DPAPI
    try {
      // Chrome on Windows uses DPAPI for cookie encryption
      // The encrypted value starts with 'DPAPI' or similar prefix
      const buf = cookie.encrypted_value;
      
      // Write encrypted data to temp file
      const fs = require('fs');
      const tmpFile = 'C:/Users/TAUSHEF/datashare/tmp-encrypted.bin';
      fs.writeFileSync(tmpFile, buf);
      
      // Use PowerShell to decrypt via DPAPI
      const psCmd = `$encrypted = [System.IO.File]::ReadAllBytes('${tmpFile.replace(/\//g, '\\\\')}'); $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, 'CurrentUser'); [System.Text.Encoding]::UTF8.GetString($decrypted)`;
      
      const result = execSync(`powershell -Command "${psCmd}"`, { encoding: 'utf8', timeout: 5000 });
      console.log(`DECRYPTED: ${result.trim().substring(0, 50)}...`);
      
      if (cookie.name.includes('token') || cookie.name.includes('access') || cookie.name.includes('session')) {
        console.log(`\n*** THIS IS THE AUTH TOKEN! ***`);
        console.log(`Full token: ${result.trim()}`);
      }
    } catch(e) {
      console.log(`Decrypt failed: ${e.message}`);
    }
  }
  
  db.close();
} catch(e) {
  console.error('Error:', e.message);
}
