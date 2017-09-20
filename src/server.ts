export {};

import * as Sio from 'socket.io';
import * as Common from './common';
import * as Pl from 'planck-js';
import {addBody, Player, Ledge, Lava, world, ledgeHeight, ledgeWidth, ratio, updatePeriod} from './common';

const io = Sio();

class InputEvent {
  tick: number;
  keys: any;
}

const events = [];
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
  return {
    time: Date.now(),
    tick: tick,
    bcastNum: bcastNum,
    players: players.map((p) => p.ser()),
    ledges: ledges.map((p) => p.ser())
  }
}

function updatePos(gameObj) {
  gameObj.x = ratio * gameObj.bod.getPosition().x - gameObj.width / 2;
  gameObj.y = ratio * -gameObj.bod.getPosition().y - gameObj.height / 2;
}

function update() {
  Common.update();
  tick += 1;
}

const playerToSocket = new Map();

function bcast() {
  for (let player of players) {
    updatePos(player);
  }
  //if (lastBcastTime == null) lastBcastTime = Date.now() / 1000;
  //if (currTime - lastBcastTime >= bcastPeriod) {
    // snapshot world
    const snapshot = {
      time: Date.now(),
      tick: tick,
      bcastNum: bcastNum,
      events: events,
      players: players.map((p) => p.ser())
    };
    // broadcast
    for (let player of players) {
      const socket = playerToSocket.get(player);
      if (socket) {
        socket.emit('bcast', snapshot);
      }
    }
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
    //events.push(new AddObj());
  }
}

//function schedRandInputs(chr) {
//  let allClear = true;
//  for (var key of ['left','right']) {
//    if (chr.inputs[key].isDown) {
//      chr.inputs[key].isDown = false;
//      allClear = false;
//    }
//  }
//  if (allClear) {
//    chr.inputs[['left','right'][getRandomInt(0,2) % 2]].isDown = true;
//  }
//  setTimeout(() => schedRandInputs(chr), getRandomInt(1000, 3000));
//}

function create() {
  const lava = new Lava(0, game.world.height - 64);
  addBody(lava, 'kinematic');

  addLedges();

  for (let i = 0; i < 10; i++) {
    const player = makePlayer(`bot${i}`);
    //schedRandInputs(player);
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

function destroy(sprite) {
  world.destroyBody(sprite.bod);
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

  socket.on('join', (player) => {
    console.log(`player ${player.name} joined`);

    playerToSocket.set(makePlayer(player.name), socket);

    // TODO create player-joined event

    socket.emit('joined', initSnap());

    socket.on('input', (input: InputEvent) => {
      console.log(`player ${player.name} sent input for t=${input.tick}: ${input.keys}`);
    });

    socket.on('disconnect', () => {
      console.log(`player ${player.name} disconnected`);
    });
  });

});

create();

io.listen(3000);
