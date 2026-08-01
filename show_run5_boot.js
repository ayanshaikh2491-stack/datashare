const fs = require('fs');
const content = fs.readFileSync('run5_logs/0_e2e.txt', 'utf8');
const lines = content.split(/\r?\n/);
lines.slice(1768, 1792).forEach((l, i) => console.log((1769 + i) + ': ' + l.replace(/\u001b\[[0-9;]*m/g, '')));
