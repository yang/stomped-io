import {Bot, GameState, getLogger, serSimResults} from "./common";

const isWebWorker = typeof WorkerGlobalScope !== 'undefined' &&
  self instanceof WorkerGlobalScope;

// Note that the instance object passed here does not retain its class info (that would be a miracle, to be
// resolving the correct type object in this potentially completely different environment).
function sim(botData?, gameStateData?) {
  const gameState = new GameState();
  const startTime = performance.now();
  const log = getLogger('worker');
  log.log('starting job for player', botData.playerId, 'of time', gameState.time);
  gameState.deser(gameStateData);
  const bot = new Bot(
    gameState.players.find(p => p.id == botData.playerId),
    gameState, null, null, false
  );
  bot.deser(botData);
  const {bestWorldState, bestPath, worldStates} = bot.runSimsClone();
  log.log('ending job for player', botData.playerId, 'of time', gameState.time, 'in', performance.now() - startTime);
  return serSimResults({worldStates, bestWorldState, bestPath});
}

function pRun(f) {
  return new Promise((resolve) => setImmediate(() => resolve(f())));
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;

  const workerpool = require('workerpool/dist/workerpool');
  const pool = workerpool.pool(scriptPath);

  require("./admin-client").main(pool);
} else {
  const workerpool = require('workerpool/dist/workerpool');
  workerpool.worker({sim: (...args) => pRun(() => sim(...args))});
}
