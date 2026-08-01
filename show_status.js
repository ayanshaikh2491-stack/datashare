const https = require('https');
const runId = process.argv[2] || '30686954875';
https.get(`https://api.github.com/repos/ayanshaikh2491-stack/datashare/actions/runs/${runId}/jobs`, {
  headers: { 'User-Agent': 'node', 'Accept': 'application/vnd.github+json' }
}, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    const j = JSON.parse(d);
    if (!j.jobs || !j.jobs.length) { console.log('no jobs yet'); return; }
    j.jobs.forEach(job => {
      console.log((job.status === 'in_progress' ? 'RUNNING' : job.status.toUpperCase()), '|', job.conclusion || '-', '|', job.name);
      (job.steps || []).forEach(s => {
        const st = s.status === 'in_progress' ? 'RUNNING' : s.status.toUpperCase();
        const co = s.conclusion ? ' ' + s.conclusion.toUpperCase() : '';
        if (st !== 'COMPLETED' || (s.conclusion && s.conclusion !== 'success')) {
          console.log('   -', st + co, '|', s.name);
        }
      });
    });
  });
}).on('error', e => console.log('ERR', e.message));
