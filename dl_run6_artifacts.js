const fs = require('fs');
const { execSync } = require('child_process');
const runId = process.argv[2] || '30688286919';
async function main() {
  const token = execSync('gh auth token', { shell: true }).toString().trim();
  const h = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' };
  // list artifacts for the run
  const listUrl = `https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/${runId}/artifacts`;
  const lr = await fetch(listUrl, { headers: h });
  const lj = await lr.json();
  const arts = lj.artifacts || [];
  if (!arts.length) { console.log('no artifacts for run', runId); return; }
  for (const a of arts) {
    console.log('artifact:', a.name, a.id, a.size_in_bytes, 'bytes');
    const zr = await fetch(a.archive_download_url, { headers: h });
    const buf = Buffer.from(await zr.arrayBuffer());
    fs.mkdirSync('run6_logs', { recursive: true });
    fs.writeFileSync(`run6_logs/${a.name}.zip`, buf);
    console.log('  saved run6_logs/' + a.name + '.zip', buf.length, 'bytes');
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
