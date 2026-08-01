const fs = require('fs');
const { execSync } = require('child_process');
async function main() {
  const token = execSync('gh auth token', { shell: true }).toString().trim();
  const url = 'https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/30685665226/logs';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync('run3_logs', { recursive: true });
  fs.writeFileSync('run3_logs/job_logs.zip', buf);
  console.log('saved', buf.length, 'bytes');
}
main().catch(e => { console.error(e.message); process.exit(1); });
