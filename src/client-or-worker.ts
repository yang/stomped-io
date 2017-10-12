const isWebWorker = typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope;

function werk(x) {
  throw new Error();
}

function pRun(f) {
  return new Promise((resolve) => setImmediate(f));
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;

  const workerpool = require('workerpool/dist/workerpool');
  const pool = workerpool.pool(scriptPath);
  pool.exec('werk', [])
    .then(x => console.log(x))
    .catch(e => console.error(e));

  // require("./client").main();
} else {
  const workerpool = require('workerpool/dist/workerpool');
  workerpool.worker({werk: () => pRun(werk)});
}
