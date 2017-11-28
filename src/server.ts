import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  AdminStats,
  assert,
  baseHandler,
  Bcast,
  Block,
  clearArray,
  Dir,
  Ent,
  EntMgr,
  Event,
  GameState,
  genStyles,
  getLogger,
  getRandomIntRange,
  ids,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth,
  LoadedCode,
  makeStar,
  maxNameLen,
  now,
  pb,
  Player,
  RemEnt,
  runLocally,
  serSimResults,
  settings,
  Star,
  StartSmash,
  StompEv,
  StopSpeedup,
  updateEntPhysFromPl,
  updatePeriod,
  world
} from './common';
import * as Pl from 'planck-js';
import * as fs from 'fs';
import {Chance} from 'chance';
import * as Case from 'case';
import * as Leet from 'leet';
import {BotMgr} from "./common-admin";
import * as net from "net";
import * as repl from "repl";
import * as Faker from 'faker';
import * as FastGlob from 'fast-glob';

let loadedCode = {} as LoadedCode;
let currentPath = '';
function reloadCode() {
  const [path] = FastGlob.sync('./dyn-*.ts', {cwd: __dirname});
  if (path && currentPath != path) {
    Object.assign(loadedCode, require(path));
    getLogger('dyn').log('loaded', path, 'with', Object.keys(require(path)), 'loadedCode', Object.keys(loadedCode));
    currentPath = path;
  }
}
reloadCode();

const Protobuf = require('protobufjs');
Common.bootstrapPb(Protobuf.loadSync('src/main.proto'));

const chance = new Chance(Date.now());

function permuteNameLeet(name: string) {
  switch (chance.weighted([0,1,2,3,4,5,6], [10, 30, 10, 10, 4, 4, 4])) {
    case 0:
      return name;
    case 1:
      return name.toLowerCase();
    case 2:
      return name.toUpperCase();
    case 3:
      return Case.random(name);
    case 4:
      return Leet.convert(name).replace(/z[0o]rz/i, '');
    case 5:
      return Leet.convert(name).toLowerCase().replace(/z[o0]rz/i, '');
    case 6:
      return Case.random(Leet.convert(name)).replace(/z[o0]rz/i, '');
    default:
      throw new Error();
  }
}
function permuteNameBasic(name: string) {
  switch (chance.weighted([0,1,2,3], [20, 50, 10, 10])) {
    case 0:
      return name;
    case 1:
      return name.toLowerCase();
    case 2:
      return name.toUpperCase();
    case 3:
      return Case.random(name);
  }
}
function maybeCrunch(name: string) {
  return chance.bool({likelihood: 30}) ? name.replace(/ /g,'') : name;
}
const gamerNames = fs
  .readFileSync('src/botnames.txt', 'utf8')
  .trim()
  .split('\n')
  .map(permuteNameLeet)
  .map(maybeCrunch);
const moreNames = fs.readFileSync('src/morenames.txt', 'utf8')
  .trim()
  .split('\n')
  .map(permuteNameBasic)
  .map(maybeCrunch);

function* genBotNames() {
  Faker.seed(Date.now());
  while (true) {
    switch (chance.weighted([0,1,2,3], [20,10,20,20])) {
      case 0:
        // chars
        const length = chance.weighted([1,2,3,4,5,6], [10,5,5,2,2,2])
        const repeat = chance.bool({likelihood: 40});
        const syms = '@#$%^&*()-_=+\'";:<>/=?+`[]{}\\|';
        const anums = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!~-';
        const chars = _.times(repeat ? 1 : length, () => chance.character({
          pool: chance.bool({likelihood: 90}) ? anums : syms
        })).join('');
        const repeated = repeat ? _.repeat(chars, length) : chars;
        yield repeated;
        break;
      case 1:
        // common name
        yield permuteNameBasic(Faker.name.firstName());
        break;
      case 2:
        // gamer names
        yield chance.pickone(gamerNames);
        break;
      case 3:
        // morenames.txt
        yield chance.pickone(moreNames);
        break;
    }
  }
}

function* unusedNames() {
  // TODO still could be using this name, but just respawning
  const iter = genBotNames();
  while (true) {
    const name = iter.next().value;
    if (!gameState.players.find(p => p.name == name)) {
      yield name;
    }
  }
}

const botNameGen = genBotNames();

if (process.argv[2] == 'preview-names') {
  for (let i = 0; i < 300; i++) {
    console.log(botNameGen.next().value);
  }
  process.exit(0);
}

class Client {
  id = ids.next().value;
  constructor(public socket) {}
}

baseHandler.file = fs.createWriteStream('log');

const styleGen = genStyles();

const io = Sio();

const gameState = new GameState(undefined, loadedCode, destroy);
gameState.onEntCreated.add(ent => ent instanceof Star && events.push(new AddEnt(ent).ser()));
gameState.onStomp.add((player, count) => events.push(new StompEv(player.id, count).ser()));
gameState.onStartSmash.add((player) => events.push(new StartSmash(player.id).ser()));

// already-serialized
const events: Event[] = [];
const players = gameState.players;
const ledges = gameState.ledges;

function onEntAdded(ent: Ent) {
  events.push(new AddEnt(ent).ser());
}

const entMgr = new EntMgr(world, gameState, onEntAdded);
const botMgr = new BotMgr(styleGen, entMgr, gameState, null, null, botNameGen);

const doRun = !runLocally, doAddPlayers = !runLocally; // doRun = save-batteries mode

let lastBcastTime = null;
const bcastPeriod = 1 / 20, updateStarsPeriod = 1;
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

let firstUpdate = true;
let initBots = 40;

function update() {
  if (firstUpdate) {
    for (let i = 0; i < initBots; i++) {
      setTimeout(() => botMgr.makeBot(true), 500 * i);
    }
    firstUpdate = false;
  }

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

function getEnts(): Ent[] {
  return gameState.getEnts();
}

let dbgRementSent = false;
const rementSent = new Map<number, RemEnt>();

let lastSnapshot: Bcast = null;
let doVerifySnapshots = false;

function bcast() {
  // TODO move all removal code to update()
  for (let ev of toRemove) {
    const ent = getEnts().find(e => e.id == ev.id);
    if (ent instanceof Player) {
      if (ev.killerId) {
        const killer = players.find(e => e.id == ev.killerId);
        getLogger('kills').log(killer.describe(), 'killed', ent.describe());
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
  let getDirtyEnts = function () {
    return getEnts().filter(p => p.isDirty());
  };
  const dirtyEnts = getDirtyEnts();
  let getNewSers = function () {
    const newSers = events
      .filter(ev => ev.type == 'AddEnt' &&
        !removed.has((ev as AddEnt).ent.id))
      .map(ev => (ev as AddEnt).ent);
    return newSers;
  };
  if (lastSnapshot) {
    // Note: we need to explicitly filter out the new Entities here that were immediately destroyed, or else they will
    // leak into the snapshot and end up staying around forever *on the server*.  So while any currently connected
    // clients will properly remove the ent as instructed by the RemEnt event, any future connecting clients will get a
    // world state that includes all these ents.  This would typically manifest as a star burst where many of the stars
    // were immediately removed (and then the clients would fetch a world that had these very dense identically-
    // positioned stars).
    const newSers = getNewSers();
    dirtySers = dirtyEnts.map(p => p.ser());
    const newOrDirtySers = _.unionBy(newSers, dirtySers, (ent) => ent.id);
    const newOrDirtySersById = new Map(newOrDirtySers.map<[number, Ent]>(p => [p.id, p]));
    let updateLastSnapWithNewDirtyRemoved = function () {
      allSers = lastSnapshot.ents.filter(p =>
        !newOrDirtySersById.has(p.id) &&
        // GC destroyed ents
        !removed.has(p.id)
      ).concat(newOrDirtySers);
    };
    updateLastSnapWithNewDirtyRemoved();
    if (doVerifySnapshots) {
      assert(_.isEqual(
        gameState.getEnts().map(e => e.id).sort(),
        allSers.map(s => s.id).sort()
      ));
    }
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
  let mkIdMap = function () {
    const lastById = new Map(lastSnapshot.ents.map<[number, Ent]>(e => [e.id, e]));
    return lastById;
  };
  let getDiffs = function () {
    if (lastSnapshot && settings.doDiff) {
      const lastById = mkIdMap();
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
            (entDiff as any).player = {
              name: entDiff.name,
              size: entDiff.size,
              currentSquishTime: entDiff.currentSquishTime,
              state: entDiff.state
            };
            if (_.isNumber(entDiff.dir)) {
              (entDiff as any).player.dirLeft = entDiff.dir == Dir.Left;
            }
          }
        }
      }
    }
  };
  getDiffs();
  if (settings.doProtobuf) {
    assert(!pb.Bcast.verify({ents: diff.ents}));
    const msg = pb.Bcast.create({ents: diff.ents});
    diff.buf = pb.Bcast.encode(msg).finish();
    diff.ents = null;
  }
  const data = settings.doProtobuf ? diff : JSON.stringify(diff);

  // broadcast
  io.emit('bcast', data);
  getLogger('bcast').log('tick', tick, 'snap time', currTime, 'send done time', now(), 'length', data instanceof String ? data.length : data.buf.length);
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
    for (let y = lowestY; y > 3 * ledgeSpacing; y -= ledgeSpacing) {
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
    const margin = +settings.doOsc * settings.oscDist / 2 + ledgeWidth;
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

const doStars = true, gridDim = 500, expPerGrid = doStars ? 10 : 0;
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
      const target = gridCounts[x][y].length * .9 + expPerGrid * .1;
      while (gridCounts[x][y].length > target) {
        const star = gridCounts[x][y].shift();
        gameState.destroy(star);
      }
    }
  }
}

const initPlayers = 0;

function reloadPlayerStyles() {
  const lines = fs
    .readFileSync('src/chars.txt', 'utf8')
    .trim()
    .split('\n');
  Common.setPlayerStyles(lines);
}

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

  if (doRun) {
    setInterval(bcast, bcastPeriod * 1000);
    setInterval(update, updatePeriod * 1000);
    setInterval(() => updateStars(gameState, false), updateStarsPeriod * 1000);
    setInterval(reloadPlayerStyles, 1000);
    setInterval(reloadCode, 10000);
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
  const log = getLogger('net');
  const client = new Client(socket);
  log.log('client', client.id, 'connected');

  if (admins.has(socket)) {
    log.log('client', client.id, 'is an admin');

    socket.emit('svrSettings', settings.ser());

    socket.on('svrSettings', (svrData) => {
      settings.deser(svrData);
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

    let sendAdminStats = function () {
      socket.emit('adminStats', {
        botIds: botMgr.bots.map(b => b.player.id)
      } as AdminStats);
    };
    sendAdminStats();
    setInterval(() => {
      sendAdminStats();
    }, 1000);
  }

  let clientInputTimeout = setTimeout(() => socket.disconnect(), settings.clientInputTimeout);

  let player;

  socket.emit('stats', {
    players: gameState.players.length
  });

  socket.on('disconnect', () => {
    log.log('client', client.id, 'disconnected');
    if (player) destroy(player);
  });

  socket.on('ding', (data) => {
    socket.emit('dong', data)
  });

  socket.on('join', (playerData) => {
    const char = loadedCode.selectChar(playerData);
    player = makePlayer(playerData.name.trim().slice(0, maxNameLen) || 'Anonymous Stomper', char);

    log.log('player', player.describe(), 'with style', player.style, `joined (client ${client.id})`);

    // TODO create player-joined event

    socket.emit('joined',
      _(lastSnapshot).extend({ents: lastSnapshot.ents.concat([player.ser()])}).value(),
      player.id
    );
  });

  socket.on('input', (data) => {
    clearTimeout(clientInputTimeout);
    clientInputTimeout = setTimeout(() => socket.disconnect(), settings.clientInputTimeout);

    if (!player) return;
    getLogger('input').log('player', player.describe(), 'sent input for time', data.time);
    for (let ev of data.events) {
      if (ev.type == 'InputEvent') {
        player.dir = ev.dir;
      } else {
        if (ev.type == 'StartAction') {
          gameState.startAction(player);
        } else if (ev.type == 'StopAction') {
          gameState.stopAction(player);
        } else if (ev.type == 'StartSpeedup') {
          if (ev.playerId == player.id) {
            gameState.startSpeedup(player);
          }
        } else if (ev.type == 'StopSpeedup') {
          if (ev.playerId == player.id) {
            gameState.stopSpeedup(player);
          }
        } else if (ev.type == 'StartSmash') {
          if (ev.playerId == player.id) {
            gameState.startSmash(player);
          }
        }
      }
    }
  });

});

(<any>global).dbg = {Common, gameState, botMgr, baseHandler};

create();

console.log('listening');

io.listen(3000);

net.createServer(function (socket) {
  repl.start({
    prompt: "node via TCP socket> ",
    input: socket,
    output: socket
  }).on('exit', () => socket.end());
}).listen(5001, "localhost");