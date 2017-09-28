import * as _ from 'lodash';
import * as Sio from 'socket.io';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  Bcast,
  clearArray,
  Event,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth,
  Player,
  RemEnt,
  updateEntPhys,
  updatePeriod,
  world
} from './common';
import * as Pl from 'planck-js';

const io = Sio();

const events: Event[] = [];
const players = [];
const ledges = [];
const game = {
  world: {
    width: 800,
    height: 2400
  }
};

let lastBcastTime = null;
const bcastPeriod = 1 / 10;
let tick = 0, bcastNum = 0;

function getRandomInt(min, max) {
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
  Common.update(players);
  updateLedges();
  tick += 1;
}

const playerToSocket = new Map();

function getEnts() {
  return players.concat(ledges);
}

function bcast() {
  for (let ent of getEnts()) {
    updateEntPhys(ent);
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

const ledgeSpacing = 200;
function updateLedges() {
  while (true) {
    if (ledges.length > 0 && ledges[ledges.length - 1].y - ledgeSpacing < -ledgeHeight)
      break;
    const xSpace = (game.world.width - ledgeWidth);
    const x = getRandomInt(0, xSpace / 2) + (ledges.length % 2 ? xSpace / 2 : 0);
    const y = ledges.length == 0 ?
      game.world.height - ledgeSpacing : ledges[ledges.length - 1].y - ledgeSpacing;
    const ledge = new Ledge(x, y);
    addBody(ledge, 'kinematic');
    ledge.bod.setLinearVelocity(Pl.Vec2(0, 0));
    ledges.push(ledge);
    events.push(new AddEnt(ledge).ser());
    for (let ledge of ledges) {
      if (ledge.y > game.world.height) {
        destroy(ledge);
      }
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

const initPlayers = 0;

function create() {
  const lava = new Lava(0, game.world.height - 64);
  addBody(lava, 'kinematic');

  updateLedges();

  for (let i = 0; i < initPlayers; i++) {
    const player = makePlayer(`bot${i}`);
    schedRandInputs(player);
  }

  setInterval(bcast, bcastPeriod * 1000);
  setInterval(update, updatePeriod * 1000);

  Common.create(players, destroy, lava);

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
    getRandomInt(0, game.world.width),
    getRandomInt(0, game.world.height - 200)
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

io.listen(3000);
