const fs = require('fs');
const { execSync } = require('child_process');
try {
  execSync('tar -xf run4_logs/logs.zip -C run4_logs', { shell: true });
  const files = fs.readdirSync('run4_logs');
  console.log('files:', files);
  files.filter(f => f.endsWith('.log')).forEach(f => {
    console.log('===== ' + f + ' =====');
    console.log(fs.readFileSync('run4_logs/' + f, 'utf8').slice(0, 4000));
  });
} catch (e) {
  console.error('extract failed:', e.message);
}
