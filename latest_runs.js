const https = require('https');
https.get('https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs?per_page=5', {
  headers: { 'User-Agent': 'node', 'Accept': 'application/vnd.github+json' }
}, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    try {
      const j = JSON.parse(d);
      if (j.message) { console.log('API msg:', j.message); return; }
      (j.workflow_runs || []).forEach(run => {
        console.log(run.id, '|', run.status, '|', run.conclusion || '-', '|', run.display_title, '|', run.run_started_at);
      });
    } catch (e) { console.log('parse err', e.message, d.slice(0, 200)); }
  });
}).on('error', e => console.log('ERR', e.message));
