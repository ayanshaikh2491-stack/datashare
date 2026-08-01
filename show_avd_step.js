const fs = require('fs');
const content = fs.readFileSync('run3_logs/0_e2e.txt', 'utf8');
const lines = content.split(/\r?\n/);
lines.slice(1600, 1630).forEach((l, i) => console.log((1601 + i) + ': ' + l.replace(/\u001b\[[0-9;]*m/g, '')));
