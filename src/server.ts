import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt, assert, baseHandler,
  Bcast, Block, BotMgr, Burster,
  clearArray, Ent, EntMgr,
  Event, GameState, genStyles, getLogger, getRandomIntRange, ids, KillEv,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth, makeStar, now, pb,
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

const Protobuf = require('protobufjs');
Common.bootstrapPb(Protobuf.loadSync('src/main.proto'));

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

// already-serialized
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

let lastSnapshot: Bcast = null;

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
  const removed = new Set(toRemove.map(ev => ev.id));
  clearArray(toRemove);

  // snapshot world
  const currTime = now();
  let allSers: Ent[], dirtySers: Ent[];
  const dirtyEnts = getEnts().filter(p => p.isDirty());
  if (lastSnapshot) {
    const newSers = events.filter(ev => ev.type == 'AddEnt').map(ev => (ev as AddEnt).ent);
    dirtySers = dirtyEnts.map(p => p.ser());
    const newOrDirtySers = _.unionBy(newSers, dirtySers, (ent) => ent.id);
    const newOrDirtySersById = new Map(newOrDirtySers.map<[number, Ent]>(p => [p.id, p]));
    allSers = lastSnapshot.ents.filter(p =>
      !newOrDirtySersById.has(p.id) &&
      // GC destroyed ents
      !removed.has(p.id)
    ).concat(newOrDirtySers);
  } else {
    dirtySers = allSers = getEnts().map(p => p.ser());
  }
  const snapshot: Bcast = ({
    isDiff: false,
    time: currTime,
    tick: tick,
    bcastNum: bcastNum,
    events: events,
    ents: allSers,
    buf: null
  });
  const diff: Bcast = _(snapshot).clone();
  if (lastSnapshot && Common.settings.doDiff) {
    const lastById = new Map(lastSnapshot.ents.map<[number, Ent]>(e => [e.id, e]));
    diff.isDiff = true;
    diff.ents = [];
    for (let b of dirtySers) {
      const a = lastById.get(b.id);
      // Note we're only diffing dirty ents; new ents that are not dirty should already be covered by
      // AddEnt.  There are no new ents that are dirty - stars are created after update(), and new
      // players are TODO there may be new dirty players!?
      const entDiff: any = Common.objDiff(a, b) as Ent;
      if (entDiff) {
        entDiff.id = b.id;
        diff.ents.push(entDiff);
        if (b.type == "Player") {
          (entDiff as any).player = _.pick(entDiff, 'name','size','currentSquishTime','state');
          if (entDiff.inputs)
            (entDiff as any).player.dirLeft = entDiff.inputs.left.isDown;
        }
      }
    }
  }
  if (Common.settings.doProtobuf) {
    assert(!pb.Bcast.verify({ents: diff.ents}));
    const msg = pb.Bcast.create({ents: diff.ents});
    diff.buf = pb.Bcast.encode(msg).finish();
    diff.ents = null;
  }
  const data = Common.settings.doProtobuf ? diff : JSON.stringify(diff);

  // broadcast
  for (let client of clients) {
    const socket = client.socket;
    if (socket) {
      socket.emit('bcast', data);
      getLogger('bcast').log('tick', tick, 'client', client.id, 'snap time', currTime, 'send done time', now(), 'length', data instanceof String ? data.length : data.buf.length);
    }
  }
  clearArray(events);
  bcastNum += 1;
  lastSnapshot = snapshot;

  // reset dirty bits
  for (let ent of dirtyEnts) {
    ent.dirty = false;
  }
}

function whichBucket(bucketStart: number, bucketSize: number, x: number) {
  return Math.floor((x - bucketStart) / bucketSize);
}

function* repeat(xs) {
  while (true) {
    for (let x of xs) {
      yield x;
    }
  }
}

const ledgeSpacing = 150;
function updateLedges() {
  if (gameState.ledges.length > 0) return;
  const maxGap = ledgeSpacing;
  const range = ledgeWidth + maxGap;
  const lowestY = Common.gameWorld.height - Lava.height - ledgeSpacing;
  function* genXCenters() {
    const leftRightPattern = repeat([0,1,1,0,1,0,1,0]);
    const chance = new Chance(0);
    const xCenters = null;
    let xCenter = 0;
    while (true) {
      yield xCenter;
      xCenter += (leftRightPattern.next().value ? -1 : 1) *
        chance.integer({min: 0, max: range});
    }
  }
  for (let baseX = 3 * ledgeWidth; baseX < Common.gameWorld.width - 3 * ledgeWidth; baseX += 3 * ledgeWidth) {
    const xCenters = genXCenters();
    for (let y = lowestY; y > 2 * ledgeSpacing; y -= ledgeSpacing) {
      const xCenter = baseX + xCenters.next().value;
      const x = xCenter - ledgeWidth / 2;
      const ledge = new Ledge(x, y, getRandomIntRange(5, 10));
      addBody(ledge, 'kinematic');
      ledges.push(ledge);
      events.push(new AddEnt(ledge).ser());
    }
  }
  if (1/1) return;
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
      const ledge = new Ledge(x, y, getRandomIntRange(5, 10));
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
    player.inputs[['left','right'][getRandomIntRange(0,2) % 2]].isDown = true;
  }
  setTimeout(() => schedRandInputs(player), getRandomIntRange(1000, 3000));
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
          getRandomIntRange(gridDim * x, gridDim * (x + 1) - 1),
          getRandomIntRange(gridDim * y, gridDim * (y + 1) - 1),
          gameState
        );
        gridCounts[x][y].push(star);
      }
      const target = gridCounts[x][y].length * .1 + expPerGrid * .9;
      while (gridCounts[x][y].length > target) {
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
  const ceiling = new Block(0, -10, Common.gameWorld.width, 10);
  addBody(ceiling, 'kinematic');
  gameState.blocks.push(ceiling);

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
    getRandomIntRange(0, Common.gameWorld.width),
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

    socket.emit('joined',
      _(lastSnapshot).extend({ents: lastSnapshot.ents.concat([player.ser()])}).value()
    );

    socket.on('input', (data) => {
      getLogger('input').log('player', player.describe(), 'sent input for time', data.time);
      for (let ev of data.events) {
        if (ev.type == 'InputEvent') {
          player.inputs = ev.inputs;
        } else if (ev.type == 'StartSmash') {
          if (Common.settings.doSmashes) {
            // Ignore/distrust its id param.
            player.state = 'startingSmash';
            gameState.timerMgr.wait(.2, () => player.state = 'smashing');
            events.push(ev);
          }
        }
      }
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
