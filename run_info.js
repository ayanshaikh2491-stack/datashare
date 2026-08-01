const https = require('https');
const runId = process.argv[2] || '30686954875';
https.get(`https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/${runId}`, {
  headers: { 'User-Agent': 'node' }
}, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const j = JSON.parse(d);
    console.log(JSON.stringify({
      status: j.status,
      conclusion: j.conclusion,
      created: j.created_at,
      updated: j.updated_at,
      run_started: j.run_started_at,
      name: j.name
    }, null, 2));
  });
}).on('error', e => console.log('ERR', e.message));
