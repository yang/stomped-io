import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  Bcast,
  clearArray, Ent,
  Event, GameState, genStyles, getLogger,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth, oscDist,
  Player,
  RemEnt, Star,
  updateEntPhysFromPl,
  updatePeriod,
  world
} from './common';
import * as Pl from 'planck-js';

const styleGen = genStyles();

const io = Sio();

const gameState = new GameState(undefined, destroy);

const events: Event[] = [];
const players = gameState.players;
const ledges = gameState.ledges;

let lastBcastTime = null;
const bcastPeriod = 1 / 10;
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
  Common.update(gameState);
  updateLedges();
  tick += 1;
}

const playerToSocket = new Map();

function getEnts(): Ent[] {
  return gameState.getEnts();
}

function bcast() {
  for (let ent of getEnts()) {
    updateEntPhysFromPl(ent);
  }
  //if (lastBcastTime == null) lastBcastTime = Date.now() / 1000;
  //if (currTime - lastBcastTime >= bcastPeriod) {
    // snapshot world
    const snapshot: Bcast = ({
      time: Date.now(),
      tick: tick,
      bcastNum: bcastNum,
      events: events,
      ents: getEnts().map((p) => p.ser())
    });
    // broadcast
    for (let player of players) {
      const socket = playerToSocket.get(player);
      if (socket) {
        socket.emit('bcast', snapshot);
      }
    }
    clearArray(events);
    //lastBcastTime = currTime;
  //}
  bcastNum += 1;
}

function whichBucket(bucketStart: number, bucketSize: number, x: number) {
  return Math.floor((x - bucketStart) / bucketSize);
}

const ledgeSpacing = 200;
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

function updateStars(gameState: GameState) {
  const gridDim = 200, expPerGrid = 10;
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
  for (let x = 0; x < Common.gameWorld.width / gridDim; x++) {
    for (let y = 0; y < Common.gameWorld.height / gridDim; y++) {
      while (gridCounts[x][y] < expPerGrid) {
        const star = new Star(
          getRandomInt(gridDim * x, gridDim * (x + 1) - 1),
          getRandomInt(gridDim * y, gridDim * (y + 1) - 1));
        gameState.stars.push(star);
        addBody(star, 'kinematic');
        gridCounts[x][y] += 1;
      }
    }
  }
}

const initPlayers = 0;

function create() {
  const lava = new Lava(0, Common.gameWorld.height - 64);
  addBody(lava, 'kinematic');
  gameState.lava = lava;

  updateStars(gameState);
  updateLedges();

  for (let i = 0; i < initPlayers; i++) {
    const player = makePlayer(`bot${i}`);
    schedRandInputs(player);
  }

  setInterval(bcast, bcastPeriod * 1000);
  setInterval(update, updatePeriod * 1000);

  Common.create(gameState);

}

function destroy(ent) {
  world.destroyBody(ent.bod);
  if (ent instanceof Player) {
    _.remove(players, e => e == ent);
  }
  if (ent instanceof Ledge) {
   _.remove(ledges, e => e == ent);
  }
  events.push(new RemEnt(ent.id));
}

function makePlayer(name) {
  const player = new Player(
    name,
    ledges[2].x + ledgeWidth / 2,
    ledges[2].y - 50,
    `dude-${styleGen.next().value}`
  );
  addBody(player, 'dynamic');
  players.push(player);
  events.push(new AddEnt(player).ser());
  return player;
}

io.on('connection', (socket: SocketIO.Socket) => {
  console.log('client connected');

  socket.on('ding', (data) => {
    socket.emit('dong', data)
  });

  socket.on('join', (playerData) => {
    const player = makePlayer(playerData.name);
    playerToSocket.set(player, socket);

    console.log(`player ${player.name} joined`);

    // TODO create player-joined event

    socket.emit('joined', initSnap());

    socket.on('input', (data) => {
      console.log(`player ${player.name} sent input for t=${data.time}`);
      player.inputs = data.events[data.events.length - 1].inputs;
    });

    socket.on('disconnect', () => {
      console.log(`player ${player.name} disconnected`);
    });
  });

});

create();

console.log('listening');

io.listen(3000);
