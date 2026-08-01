const fs = require('fs');
const content = fs.readFileSync('run5_logs/0_e2e.txt', 'utf8');
const lines = content.split(/\r?\n/);
const keys = ['Boot donor emulator', 'DONOR_BOOT', 'Donor state', 'Donor boot', 'EMULATOR LOG', 'adb devices', 'error', 'Error', 'ERROR', 'crash', 'FATAL', 'failed', 'timed out', 'KVM', 'kvm', 'AUTH', 'Boot receiver'];
let prev = -1;
lines.forEach((l, i) => {
  if (keys.some(k => l.includes(k))) {
    if (i - prev > 3) console.log('...');
    console.log(i + 1 + ': ' + l.replace(/\u001b\[[0-9;]*m/g, ''));
    prev = i;
  }
});
