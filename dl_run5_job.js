const fs = require('fs');
const { execSync } = require('child_process');
async function main() {
  const token = execSync('gh auth token', { shell: true }).toString().trim();
  const url = 'https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/30686684461/logs';
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' } });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync('run5_logs/job_logs.zip', buf);
  execSync('tar -xf run5_logs/job_logs.zip -C run5_logs', { shell: true });
  const files = fs.readdirSync('run5_logs');
  console.log('files:', files);
  const txt = files.find(f => f.endsWith('.txt'));
  const content = fs.readFileSync('run5_logs/' + txt, 'utf8');
  const lines = content.split(/\r?\n/);
  // find boot donor section
  let start = -1, end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Boot donor emulator')) start = i;
    if (start > 0 && i > start && lines[i].includes('##[group]')) { end = i; break; }
  }
  console.log('boot section lines', start, 'to', end);
  lines.slice(start, Math.min(end, start + 120)).forEach(l => console.log(l.replace(/\u001b\[[0-9;]*m/g, '')));
}
main().catch(e => { console.error(e.message); process.exit(1); });
