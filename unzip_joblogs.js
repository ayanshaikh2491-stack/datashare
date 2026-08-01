const fs = require('fs');
const { execSync } = require('child_process');
try {
  execSync('tar -xf run3_logs/job_logs.zip -C run3_logs', { shell: true });
  const files = fs.readdirSync('run3_logs');
  console.log('files:', files);
} catch (e) {
  console.error('extract failed:', e.message);
}
