const isWebWorker = typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope;

const werk = module.exports = function werk(x, done?) {
  throw new Error();
}

function worker() {
  self.addEventListener('message', (ev) => {
    postMessage(werk(ev.data));
  });
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;

  const threads = require('threads');
  threads.config.set({
    basepath: {
      browser: 'http://localhost:8000/dist',
      node: __dirname
    }
  });
  const thread = new threads.spawn('http://localhost:8000/dist/bundle.js')
    .send('happy')
    .on('message', (x) => console.log(x))
    .on('error', (x) => console.error(x))
    .on('exit', (x) => console.log(x));

  // const workerpool = require('workerpool/dist/workerpool');
  // const pool = workerpool.pool(scriptPath);
  // pool.exec('werk', []).then(x => console.log(x));

  // const w = new Worker(scriptPath);
  // w.addEventListener('message', (ev) => {console.log(ev.data);})
  // w.postMessage('hello');
  // require("./client").main();
} else {
  // const workerpool = require('workerpool/dist/workerpool');
  // workerpool.worker({werk: werk});
  // worker();
}
