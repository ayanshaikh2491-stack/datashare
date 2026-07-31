const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const dest = path.join('C:\\Users\\TAUSHEF', 'android-sdk.zip');

// Try multiple URLs
const urls = [
  'https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip',
  'https://redirector.gvt1.com/edgedl/android/repository/commandlinetools-win-11076708_latest.zip',
];

function download(url, attempt) {
  console.log(`Attempt ${attempt}: ${url.substring(0, 80)}...`);
  
  const file = fs.createWriteStream(dest);
  const protocol = url.startsWith('https') ? https : http;

  protocol.get(url, { timeout: 60000 }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      file.close();
      fs.unlinkSync(dest);
      console.log(`Redirecting to: ${res.headers.location}`);
      return download(res.headers.location, attempt + 1);
    }
    
    if (res.statusCode !== 200) {
      file.close();
      fs.unlinkSync(dest);
      console.error(`HTTP ${res.statusCode}: ${res.statusMessage}`);
      if (attempt < urls.length) return download(urls[attempt], attempt + 1);
      return console.error('All URLs failed');
    }

    const total = parseInt(res.headers['content-length'] || '0', 10);
    let downloaded = 0;
    
    console.log(`Size: ${(total/1024/1024).toFixed(1)} MB`);
    
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      const pct = total > 0 ? ` ${((downloaded/total)*100).toFixed(1)}%` : '';
      process.stdout.write(`\rDownloaded: ${(downloaded/1024/1024).toFixed(1)} MB${pct}`);
    });

    res.pipe(file);
    file.on('finish', () => {
      file.close();
      const stats = fs.statSync(dest);
      console.log(`\n✅ Complete! ${(stats.size/1024/1024).toFixed(1)} MB`);
      console.log(`Saved: ${dest}`);
    });
  }).on('error', (err) => {
    file.close();
    try { fs.unlinkSync(dest); } catch(e) {}
    console.error(`Error: ${err.message}`);
    if (attempt < urls.length) return download(urls[attempt], attempt + 1);
  }).on('timeout', function() {
    this.destroy();
    console.error('Timeout');
    file.close();
    try { fs.unlinkSync(dest); } catch(e) {}
    if (attempt < urls.length) return download(urls[attempt], attempt + 1);
  });
}

download(urls[0], 1);
