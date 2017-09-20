export {};

import * as Sio from 'socket.io';
import * as Common from './common';
import * as Pl from 'planck-js';
import {addBody, Player, Ledge, Lava, world, ledgeHeight, ledgeWidth, ratio, updatePeriod, Bcast, AddEnt, RemEnt, Event, InputEvent, clearArray} from './common';

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

function updatePos(ent) {
  ent.x = ratio * ent.bod.getPosition().x - ent.width / 2;
  ent.y = ratio * -ent.bod.getPosition().y - ent.height / 2;
}

const accel = .1;

function feedInputs(player) {

  const inputs = player.inputs;

  if (inputs.left.isDown) {
    //  Move to the left
    player.bod.getLinearVelocity().x = Math.max(player.bod.getLinearVelocity().x - accel, -5);
  } else if (inputs.right.isDown) {
    //  Move to the right
    player.bod.getLinearVelocity().x = Math.min(player.bod.getLinearVelocity().x + accel, 5);
  } else {
    ////  Reset the players velocity (movement)
    if (player.bod.getLinearVelocity().x < 0) {
      player.bod.getLinearVelocity().x = Math.min(0, player.bod.getLinearVelocity().x + accel);
    } else {
      player.bod.getLinearVelocity().x = Math.max(0, player.bod.getLinearVelocity().x - accel);
    }
  }

}

function update() {
  for (let player of players) feedInputs(player);
  Common.update();
  addLedges();
  tick += 1;
}

const playerToSocket = new Map();

function getEnts() {
  return players.concat(ledges);
}

function bcast() {
  for (let ent of getEnts()) {
    updatePos(ent);
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
function addLedges() {
  while (true) {
    if (ledges.length > 0 && ledges[ledges.length - 1].y - ledgeSpacing < -ledgeHeight)
      break;
    const xSpace = (game.world.width - ledgeWidth);
    const x = getRandomInt(0, xSpace / 2) + (ledges.length % 2 ? xSpace / 2 : 0);
    const y = ledges.length == 0 ?
      game.world.height - ledgeSpacing : ledges[ledges.length - 1].y - ledgeSpacing;
    const ledge = new Ledge(x, y);
    addBody(ledge, 'kinematic');
    ledge.bod.setLinearVelocity(Pl.Vec2(0, -2));
    ledges.push(ledge);
    events.push(new AddEnt(ledge).ser());
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

function create() {
  const lava = new Lava(0, game.world.height - 64);
  addBody(lava, 'kinematic');

  addLedges();

  for (let i = 0; i < 10; i++) {
    const player = makePlayer(`bot${i}`);
    schedRandInputs(player);
  }

  setInterval(bcast, bcastPeriod * 1000);
  setInterval(update, updatePeriod * 1000);

  world.on('end-contact', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      if (players.includes(bA.getUserData())) {
        // only clear of each other in the next tick
        setTimeout(() => {
          //console.log(fA.getAABB(0).lowerBound.y, fB.getAABB(0).upperBound.y, fA.getAABB(0).upperBound.y, fB.getAABB(0).lowerBound.y);
          if (fA.getAABB(0).lowerBound.y >= fB.getAABB(0).upperBound.y) {
            bA.getLinearVelocity().y = 12;
          }
        }, 0);
      }
    }
    bounce(fA, bA, fB, bB);
    bounce(fB, bB, fA, bA);
  });

  world.on('begin-contact', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      //if (players.includes(bA.getUserData()) && stars.children.includes(bB.getUserData())) {
      //  const star = bB.getUserData();
      //  contact.setEnabled(false);
      //  // only clear of each other in the next tick
      //  setTimeout(() => {
      //    destroy(star);
      //    //  Add and update the score
      //    score += 10;
      //    scoreText.text = 'Score: ' + score;
      //  }, 0);
      //}
      if (players.includes(bA.getUserData()) && lava === bB.getUserData()) {
        contact.setEnabled(false);
        const player = bA.getUserData();
        // only clear of each other in the next tick
        setTimeout(() => {
          destroy(player);
        }, 0);
      }
    }
    bounce(fA, bA, fB, bB);
    bounce(fB, bB, fA, bA);
  });

}

function destroy(ent) {
  world.destroyBody(ent.bod);
  //if (ent instanceof Player) {
  //  players.remove(ent);
  //}
  //if (ent instanceof Ledge) {
  //  ledges.remove(ent);
  //}
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
  return player;
}

io.on('connection', (socket: SocketIO.Socket) => {
  console.log('client connected');

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
