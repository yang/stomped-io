import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt, baseHandler,
  Bcast, Block, BotMgr,
  clearArray, Ent, EntMgr,
  Event, GameState, genStyles, getLogger, ids, KillEv,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth, now, oscDist,
  Player,
  RemEnt, runLocally, serSimResults, Star,
  updateEntPhysFromPl,
  updatePeriod,
  world
} from './common';
import * as Pl from 'planck-js';
import * as fs from 'fs';

class Client {
  id = ids.next().value;
  constructor(public socket) {}
}

baseHandler.file = fs.createWriteStream('log');

const styleGen = genStyles();

const io = Sio();

const gameState = new GameState(undefined, destroy);

const events: Event[] = [];
const players = gameState.players;
const ledges = gameState.ledges;

const clients: Client[] = [];

function onEntAdded(ent: Ent) {
  events.push(new AddEnt(ent).ser());
}

const entMgr = new EntMgr(world, gameState, onEntAdded);
const botMgr = new BotMgr(styleGen, entMgr, gameState, null, null);

const doRun = !runLocally, doAddPlayers = !runLocally; // doRun = save-batteries mode

let lastBcastTime = null;
const bcastPeriod = 1 / 20, regenStarPeriod = 1;
let tick = 0, bcastNum = 0;

function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

function initSnap() {
  return <Bcast>{
    time: Date.now(),
    tick: tick,
    bcastNum: bcastNum,
    events: [],
    ents: getEnts().map((p) => p.ser())
  }
}

function update() {
  const currTime = now();
  for (let bot of botMgr.bots) {
    bot.isDumb ? bot.dumbPlan() : bot.replayPlan(true, currTime);
  }
  for (let bot of botMgr.bots) {
    bot.checkPlan(currTime);
  }
  Common.update(gameState);
  for (let ent of getEnts()) {
    updateEntPhysFromPl(ent);
  }
  updateLedges();
  tick += 1;
  const endTime = now();
  getLogger('server-jank').log('start', currTime, 'end', endTime, 'elapsed', endTime - currTime);
}

const playerToSocket = new Map();

function getEnts(): Ent[] {
  return gameState.getEnts();
}

function bcast() {
  // TODO move all removal code to update()
  for (let ev of toRemove) {
    const ent = getEnts().find(e => e.id == ev.id);
    if (ent instanceof Player) {
      if (ev.killerId) {
        const killer = players.find(e => e.id == ev.killerId);
        console.log(killer.describe(), 'killed', ent.describe());
      }
    }
  }
  for (let ev of toRemove) {
    const ent = getEnts().find(e => e.id == ev.id);
    if (!ent) continue; // e.g. if player already killed, and then its client disconnects
    world.destroyBody(ent.bod);
    if (ent instanceof Player) {
      _.remove(players, e => e == ent);
    }
    if (ent instanceof Ledge) {
      _.remove(ledges, e => e == ent);
    }
    if (ent instanceof Star) {
      _.remove(gameState.stars, e => e == ent);
    }
    events.push(ev.ser());
  }
  clearArray(toRemove);

  // snapshot world
  const currTime = now();
  const snapshot: Bcast = ({
    time: currTime,
    tick: tick,
    bcastNum: bcastNum,
    events: events,
    ents: getEnts().map((p) => p.ser())
  });
  // broadcast
  for (let client of clients) {
    const socket = client.socket;
    if (socket) {
      socket.emit('bcast', snapshot);
      getLogger('bcast').log('tick', tick, 'client', client.id, 'snap time', currTime, 'send done time', now());
    }
  }
  clearArray(events);
  bcastNum += 1;
}

function whichBucket(bucketStart: number, bucketSize: number, x: number) {
  return Math.floor((x - bucketStart) / bucketSize);
}

const ledgeSpacing = 150;
function updateLedges() {
  const log = getLogger('updateLedges');
  for (let ledge of ledges) {
    if (ledge.y > Common.gameWorld.height) {
      destroy(ledge);
    }
  }
  while (true) {
    const lastLedge = _(ledges).last();
    if (ledges.length > 0 && lastLedge.y - ledgeSpacing < -ledgeHeight)
      break;

    const y = ledges.length == 0 ?
      Common.gameWorld.height - ledgeSpacing : lastLedge.y - ledgeSpacing;

    const numCols = 2;
    const margin = oscDist / 2 + ledgeWidth;
    const [spawnMin, spawnMax] = [margin, Common.gameWorld.width - margin];
    const spawnWidth = spawnMax - spawnMin;
    const colWidth = spawnWidth / numCols;
    const wasOdd = lastLedge && whichBucket(spawnMin, colWidth, lastLedge.initPos.x + ledgeWidth / 2) % 2 == 1;
    log.log(numCols, margin, spawnMin, spawnMax, spawnWidth, colWidth);

    for (let column = wasOdd ? 0 : 1; column < numCols; column += 2) {
      /*
      const xCenter = getRandomInt(
        spawnMin + column * colWidth,
        spawnMin + (column + 1) * colWidth
      );
      */
      const xCenter = spawnMin + (column + 0.5) * colWidth;
      const x = xCenter - ledgeWidth / 2;
      const ledge = new Ledge(x, y, getRandomInt(5, 10));
      log.log(wasOdd, column, xCenter, x, y);
      addBody(ledge, 'kinematic');
      ledge.bod.setLinearVelocity(Pl.Vec2(0, 0));
      ledges.push(ledge);
      events.push(new AddEnt(ledge).ser());
    }
  }
}

function schedRandInputs(player) {
  let allClear = true;
  for (var key of ['left','right']) {
    if (player.inputs[key].isDown) {
      player.inputs[key].isDown = false;
      allClear = false;
    }
  }
  if (allClear) {
    player.inputs[['left','right'][getRandomInt(0,2) % 2]].isDown = true;
  }
  setTimeout(() => schedRandInputs(player), getRandomInt(1000, 3000));
}

const doStars = true, gridDim = 200, expPerGrid = doStars ? 10 : 0;
function updateStars(gameState: GameState, bootstrap: boolean) {
  getLogger('stars').log('regenerating stars');
  const gridCounts = [];
  for (let x = 0; x < Common.gameWorld.width / gridDim; x++) {
    gridCounts.push([]);
    for (let y = 0; y < Common.gameWorld.height / gridDim; y++) {
      gridCounts[x].push(0);
    }
  }
  for (let star of gameState.stars) {
    gridCounts[Math.floor(star.x / gridDim)][Math.floor(star.y / gridDim)] += 1;
  }
  for (let x = 0; x < Math.floor(Common.gameWorld.width / gridDim); x++) {
    for (let y = 0; y < Math.floor(Common.gameWorld.height / gridDim); y++) {
      while (gridCounts[x][y] < expPerGrid && (bootstrap || Math.random() < .1)) {
        const star = new Star(
          getRandomInt(gridDim * x, gridDim * (x + 1) - 1),
          getRandomInt(gridDim * y, gridDim * (y + 1) - 1));
        gameState.stars.push(star);
        addBody(star, 'kinematic');
        gridCounts[x][y] += 1;
        events.push(new AddEnt(star).ser());
      }
    }
  }
}

const initPlayers = 0;

function create() {
  const lava = new Lava(0, Common.gameWorld.height - 64);
  addBody(lava, 'kinematic');
  gameState.lava = lava;

  updateStars(gameState, true);
  updateLedges();

  for (let i = 0; i < 2; i++) {
    const wall = new Block(i == 0 ? -10 : Common.gameWorld.width, 0, 10, Common.gameWorld.height);
    addBody(wall, 'kinematic');
    gameState.blocks.push(wall);
  }

  for (let i = 0; i < initPlayers; i++) {
    const player = makePlayer(`bot${i}`);
    schedRandInputs(player);
  }

  if (doRun) {
    setInterval(bcast, bcastPeriod * 1000);
    setInterval(update, updatePeriod * 1000);
    setInterval(() => updateStars(gameState, false), regenStarPeriod * 3000);
  }

  Common.create(gameState);

}

const toRemove: RemEnt[] = [];

function destroy(ent, killer?) {
  toRemove.push(new RemEnt(ent.id, killer ? killer.id : null));
}

function makePlayer(name, style = null) {
  if (!doAddPlayers && players.length > 0) {
    return players[0];
  }
  const player = new Player(
    name,
    Common.gameWorld.width / 2,
    50,
    style || styleGen.next().value
  );
  addBody(player, 'dynamic');
  players.push(player);
  events.push(new AddEnt(player).ser());
  return player;
}

const admins = new Set<SocketIO.Socket>();

// From https://stackoverflow.com/questions/13745519/send-custom-data-along-with-handshakedata-in-socket-io
io.use(function(socket, next) {
  if (socket.handshake.query.authKey == 'SECRET') {
    admins.add(socket);
  }
  return next();
});

io.on('connection', (socket: SocketIO.Socket) => {
  const client = new Client(socket);
  clients.push(client);
  console.log('client', client.id, 'connected');

  if (admins.has(socket))
    console.log('client', client.id, 'is an admin');

  socket.on('disconnect', () => {
    console.log('client', client.id, 'disconnected');
  });

  socket.on('ding', (data) => {
    socket.emit('dong', data)
  });

  socket.on('join', (playerData) => {
    const player = makePlayer(playerData.name, playerData.char);

    socket.on('disconnect', () => destroy(player));

    console.log('player', player.describe(), 'with style', player.style, `joined (client ${client.id})`);

    // TODO create player-joined event

    socket.emit('joined', initSnap());

    socket.on('input', (data) => {
      getLogger('input').log('player', player.describe(), 'sent input for time', data.time);
      player.inputs = data.events[data.events.length - 1].inputs;
    });

    socket.on('makeBot', () => {
      const bot = botMgr.makeBot(true);
      socket.emit('botProxy', bot.ser());
      bot.onSim.add(({worldStates, bestPath, bestWorldState}) => {
        const botData = bot.ser();
        const resultsData = serSimResults({worldStates, bestPath, bestWorldState});
        socket.emit('botPlan', {botData, ...resultsData});
      });
    });
  });

});

(<any>global).dbg = {Common, gameState, botMgr};

create();

console.log('listening');

io.listen(3000);
