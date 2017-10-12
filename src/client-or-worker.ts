const isWebWorker = typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope;

// Note that the instance object passed here does not retain its class info (that would be a miracle, to be
// resolving the correct type object in this potentially completely different environment).
function werk(x?,y?) {
  console.log(x.name);
  //throw new Error();
}

function pRun(f) {
  return new Promise((resolve) => setImmediate(f));
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;

  const workerpool = require('workerpool/dist/workerpool');
  const pool = workerpool.pool(scriptPath);
  pool.exec('werk', [new (require('./common').Player)('z',0,0,'red'), 42])
    .then(x => console.log(x))
    .catch(e => console.error(e));

  require("./client").main();
} else {
  const workerpool = require('workerpool/dist/workerpool');
  workerpool.worker({werk: (...args) => pRun(() => werk(...args))});
}
