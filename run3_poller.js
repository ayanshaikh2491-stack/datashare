const gh = 'https://api.github.com/repos/ayanshaikh2491-stack/datashare';
const runId = process.argv[2] || '30685665226';
const start = Date.now();
let last = '';
async function main() {
  while (true) {
    let j = null;
    try {
      const r = await fetch(gh + '/actions/runs/' + runId + '/jobs');
      const d = await r.json();
      j = d.jobs && d.jobs[0];
    } catch (e) {
      console.log('poll error', e.message);
    }
    if (j) {
      const s = j.status + ' ' + (j.conclusion || '') + ' ' + Math.round((Date.now() - start) / 60000) + 'm';
      if (s !== last) {
        last = s;
        console.log('JCODE_PROGRESS ' + JSON.stringify({ percent: 0, message: 'run3 ' + s, kind: 'checkpoint' }));
        console.log('STATUS ' + s);
        if (j.conclusion === 'success') {
          console.log('RUN3_SUCCESS');
          process.exit(0);
        }
        if (j.conclusion === 'failure' || j.conclusion === 'cancelled' || j.conclusion === 'timed_out') {
          console.log('RUN3_' + j.conclusion.toUpperCase());
          const step = j.steps && j.steps.find(x => x.conclusion === 'failure') || {};
          console.log('FAILED_STEP ' + (step.name || '?'));
          process.exit(0);
        }
      }
    }
    await new Promise(r => setTimeout(r, 30000));
  }
}
main();
