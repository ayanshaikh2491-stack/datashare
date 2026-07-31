const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\TAUSHEF\\datashare';
const entries = fs.readdirSync(dir, { withFileTypes: true });

for (const entry of entries) {
  if (entry.name === '.git' || entry.name === 'clean.js') continue;
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }
  console.log('DELETED: ' + entry.name);
}

console.log('--- All deleted. Remaining: ---');
fs.readdirSync(dir).forEach(f => console.log(f));
