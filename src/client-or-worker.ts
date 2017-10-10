export {};

const isWebWorker = typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope;

function worker() {
  self.addEventListener('message', (ev) => {
    postMessage(ev.data);
  });
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;
  const w = new Worker(scriptPath);
  w.addEventListener('message', (ev) => {console.log(ev.data);})
  w.postMessage('hello');
  require("./client").main();
} else {
  worker();
}
