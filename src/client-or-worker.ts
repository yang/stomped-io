import {Bot, GameState, getLogger} from "./common";

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
    gameState, null, null
  );
  bot.deser(botData);
  const {bestWorldState, bestPath, worldStates} = bot.runSimsClone();
  const wsToIndex = new Map(worldStates.map((x, i) => [x, i]));
  log.log('ending job for player', botData.playerId, 'of time', gameState.time, 'in', performance.now() - startTime);
  return {
    bestWorldStateIndex: wsToIndex.get(bestWorldState),
    bestPath: bestPath.map(([ws, [dir, dur]]) => [wsToIndex.get(ws), [dir, dur]]),
    worldStatesData: worldStates.map(s => s.ser())
  };
}

function pRun(f) {
  return new Promise((resolve) => setImmediate(() => resolve(f())));
}

if (!isWebWorker) {
  const scriptPath = (<any>document.getElementById('main-script')).src;

  const workerpool = require('workerpool/dist/workerpool');
  const pool = workerpool.pool(scriptPath);

  require("./client").main(pool);
} else {
  const workerpool = require('workerpool/dist/workerpool');
  workerpool.worker({sim: (...args) => pRun(() => sim(...args))});
}
