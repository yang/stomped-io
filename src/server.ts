import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt, assert, baseHandler,
  Bcast, Block, BotMgr, Burster,
  clearArray, Ent, EntMgr,
  Event, GameState, genStyles, getLogger, getRandomInt, ids, KillEv,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth, makeStar, now,
  Player,
  RemEnt, runLocally, serSimResults, Star,
  updateEntPhysFromPl,
  updatePeriod,
  world
} from './common';
import * as Pl from 'planck-js';
import * as fs from 'fs';
import {Chance} from 'chance';
import * as Case from 'case';
import * as Leet from 'leet';

const chance = new Chance(0);

function permuteName(name: string) {
  switch (chance.integer({min: 0, max: 6})) {
    case 0:
      return name;
    case 1:
      return name.toLowerCase();
    case 2:
      return name.toUpperCase();
    case 3:
      return Case.random(name);
    case 4:
      return Leet.convert(name);
    case 5:
      return Leet.convert(name).toLowerCase();
    case 6:
      return Case.random(Leet.convert(name));
    default:
      throw new Error();
  }
}
const botNames = fs
  .readFileSync('src/botnames.txt', 'utf8')
  .trim()
  .split('\n');
const botNameGen = chance.shuffle(botNames)
  .map(name => permuteName(name))
  [Symbol.iterator]();

class Client {
  id = ids.next().value;
  constructor(public socket) {}
}

baseHandler.file = fs.createWriteStream('log');

const styleGen = genStyles();

const io = Sio();

const gameState = new GameState(undefined, destroy);
gameState.onEntCreated.add(ent => ent instanceof Star && events.push(new AddEnt(ent).ser()));

const events: Event[] = [];
const players = gameState.players;
const ledges = gameState.ledges;

const clients: Client[] = [];

function onEntAdded(ent: Ent) {
  events.push(new AddEnt(ent).ser());
}

const entMgr = new EntMgr(world, gameState, onEntAdded);
const botMgr = new BotMgr(styleGen, entMgr, gameState, null, null, botNameGen);

const doRun = !runLocally, doAddPlayers = !runLocally; // doRun = save-batteries mode

let lastBcastTime = null;
const bcastPeriod = 1 / 20, regenStarPeriod = 1;
let tick = 0, bcastNum = 0;

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
    bot.checkDeath();
  }
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

let dbgRementSent = true;
const rementSent = new Map<number, RemEnt>();

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
    if (!ent)
      continue; // e.g. if player already killed, and then its client disconnects
    assert(!rementSent.has(ev.id));
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
    if (dbgRementSent)
      rementSent.set(ev.id, ev);
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
    const margin = +Common.settings.doOsc * Common.settings.oscDist / 2 + ledgeWidth;
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
  const gridCounts: Star[][][] = [];
  const nx = Common.gameWorld.width / gridDim;
  const ny = Common.gameWorld.height / gridDim;
  const {'true': kept, 'false': toRemove} = _(gameState.stars).groupBy(({x,y}) =>
    (0 <= x && x < Common.gameWorld.width && 0 <= y && y < Common.gameWorld.height)
  ).defaults({'true': [], 'false': []}).value();
  for (let star of toRemove) {
    gameState.destroy(star);
  }
  for (let x = 0; x < nx; x++) {
    gridCounts.push([]);
    for (let y = 0; y < ny; y++) {
      gridCounts[x].push([]);
    }
  }
  for (let star of kept) {
    const x = Math.floor(star.x / gridDim);
    const y = Math.floor(star.y / gridDim);
    gridCounts[x][y].push(star);
  }
  for (let x = 0; x < Math.floor(nx); x++) {
    for (let y = 0; y < Math.floor(ny); y++) {
      while (gridCounts[x][y].length < expPerGrid && (bootstrap || Math.random() < .1)) {
        const star = makeStar(
          getRandomInt(gridDim * x, gridDim * (x + 1) - 1),
          getRandomInt(gridDim * y, gridDim * (y + 1) - 1),
          gameState
        );
        gridCounts[x][y].push(star);
      }
      while (gridCounts[x][y].length > expPerGrid && Math.random() < .2) {
        const star = gridCounts[x][y].shift();
        gameState.destroy(star);
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
    const wall = new Block(i == 0 ? -Common.gameWorld.width : Common.gameWorld.width, 0, Common.gameWorld.width, 2 * Common.gameWorld.height);
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
    setInterval(() => updateStars(gameState, false), regenStarPeriod * 1000);
  }

  Common.create(gameState);

}

const toRemove: RemEnt[] = [];

function destroy(ent, killer?) {
  getLogger('destroy').log('destroying', ent.type, ent.id);
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

  if (admins.has(socket)) {
    console.log('client', client.id, 'is an admin');

    socket.emit('svrSettings', Common.settings.ser());

    socket.on('svrSettings', (svrData) => {
      Common.settings.deser(svrData);
    });
  }

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

(<any>global).dbg = {Common, gameState, botMgr, baseHandler};

create();

console.log('listening');

io.listen(3000);
