const fs = require('fs');
const { execSync } = require('child_process');
async function main() {
  const token = execSync('gh auth token', { shell: true }).toString().trim();
  const url = 'https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/artifacts/8814214766/zip';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync('run5_logs', { recursive: true });
  fs.writeFileSync('run5_logs/logs.zip', buf);
  console.log('saved', buf.length, 'bytes');
  execSync('tar -xf run5_logs/logs.zip -C run5_logs', { shell: true });
  const files = fs.readdirSync('run5_logs');
  console.log('files:', files);
  files.filter(f => f.endsWith('.log')).forEach(f => {
    console.log('===== ' + f + ' =====');
    console.log(fs.readFileSync('run5_logs/' + f, 'utf8').slice(0, 5000));
  });
}
main().catch(e => { console.error(e.message); process.exit(1); });
