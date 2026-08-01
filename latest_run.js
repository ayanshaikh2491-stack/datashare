const gh = 'https://api.github.com/repos/ayanshaikh2491-stack/datashare';
async function main() {
  const r = await fetch(gh + '/actions/runs?per_page=1');
  const d = await r.json();
  const run = d.workflow_runs[0];
  console.log(JSON.stringify({ id: run.id, status: run.status, conclusion: run.conclusion, display: run.display_title }));
}
main().catch(e => { console.error(e.message); process.exit(1); });
