const fs = require('fs');
const content = fs.readFileSync('run3_logs/0_e2e.txt', 'utf8');
const lines = content.split(/\r?\n/);
const keys = ['Create AVDs', 'avdmanager', 'AVDs created', 'Unknown AVD', 'Boot donor', 'emulator -avd', 'Donor state', 'Donor boot', 'DONOR_BOOT_FAILED', 'ERROR', 'no file donor.ini', 'HOME is defined'];
let shown = 0;
lines.forEach((l, i) => {
  if (keys.some(k => l.includes(k))) {
    console.log(i + 1 + ': ' + l);
    shown++;
  }
});
console.log('total matching lines:', shown, 'of', lines.length);
