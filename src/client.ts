export {};

(<any>window).PIXI = require('phaser/build/custom/pixi');
(<any>window).p2 = require('phaser/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser/build/custom/phaser-split');

import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as Common from './common';
import {Player, Ledge, world, ratio, addBody, Bcast, Ent, Event, AddEnt, RemEnt, InputEvent, clearArray, Vec2, gravity, accel, updatePeriod, plPosFromEnt, entPosFromPl} from './common';
import * as _ from 'lodash';

var game;

function preload() {

  game.load.image('sky', 'assets/sky.png');
  game.load.image('ground', 'assets/platform.png');
  game.load.image('star', 'assets/star.png');
  game.load.image('lava', 'assets/lava.jpg');
  game.load.spritesheet('dude', 'assets/dude.png', 32, 48);

}

var platforms;
var cursors;
var lava;

var stars;
var score = 0;
var scoreText;

var socket;
var me: Player;

const players: Player[] = [];
const ledges: Ledge[] = [];

const timeline: Bcast[] = [];

(<any>window).dbg = {platforms, cursors, lava, world, players, ledges};

function destroy(sprite) {
  world.destroyBody(sprite.bod);
  sprite.kill();
}

const entToSprite = new Map();
const events: Event[] = [];

let gfx;

function create(initSnap) {

  game.world.setBounds(0,0,800,2400);

  gfx = game.add.graphics(0,0);
  gfx.lineStyle(1,0x0088FF,1);

  //  A simple background for our game
  game.add.sprite(0, 0, 'sky');

  lava = game.add.sprite(0, game.world.height - 64, 'lava');
  lava.enableBody = true;
  addBody(lava, 'kinematic');

  //  The platforms group contains the ground and the 2 ledges we can jump on
  platforms = game.add.group();

  const {ents} = initSnap;
  for (let ent of ents) {
    addEnt(ent);
  }

  me = players[players.length - 1]
  const meSprite = entToSprite.get(me);
  game.camera.follow(meSprite, Phaser.Camera.FOLLOW_PLATFORMER);

//  //  Finally some stars to collect
//  stars = game.add.group();
//
//  //  Here we'll create 12 of them evenly spaced apart
//  for (var i = 0; i < 12; i++)
//  {
//    //  Create a star inside of the 'stars' group
//    var star = stars.create(i * 70, 0, 'star');
//
//    addBody(star, 'dynamic', {restitution: 0.7 + Math.random() * 0.2});
//  }

  //  The score
  scoreText = game.add.text(16, 16, 'score: 0', { fontSize: '32px', fill: '#000' });

  //  Our controls.
  cursors = game.input.keyboard.createCursorKeys();
  for (let keyName of ['left', 'down', 'right', 'up']) {
    const key = cursors[keyName];
    key.onDown.add(() => events.push(trace(new InputEvent(updateInputs()))));
    key.onUp.add(() => events.push(new InputEvent(updateInputs())));
  }

}

function trace(x) {
  console.log(x);
  return x;
}

function updateInputs() {
  me.inputs.left.isDown = cursors.left.isDown;
  me.inputs.right.isDown = cursors.right.isDown;
  me.inputs.down.isDown = cursors.down.isDown;
  me.inputs.up.isDown = cursors.up.isDown;
  return me.inputs;
}

let lastTime = null;
const dt = 1 / 60.;

const timeBuffer = 200;
let delta = null;

function lerp(a,b,alpha) {
  return a + alpha * (b - a);
}

function getEnts() {
  return (<Ent[]>players).concat(ledges);
}

function addEnt(ent) {
  switch (ent.type) {
    case 'Player':
      addPlayer(<Player>ent);
      break;
    case 'Ledge':
      addLedge(<Ledge>ent);
      break;
  }
}

function addPlayer(player) {
  if (!players.find((p) => p.id == player.id)) {
    players.push(player);
    const sprite = game.add.sprite(player.x, player.y, 'dude');
    sprite.animations.add('left', [0, 1, 2, 3], 10, true);
    sprite.animations.add('right', [5, 6, 7, 8], 10, true);
    entToSprite.set(player, sprite);
    addBody(player, 'dynamic');
  }
}

function addLedge(ledge) {
  if (!ledges.find((p) => p.id == ledge.id)) {
    ledges.push(ledge);
    const platform = platforms.create(ledge.x, ledge.y, 'ground');
    platform.scale.setTo(.75, 1);
    entToSprite.set(ledge, platform);
    addBody(ledge, 'kinematic');
  }
}

function tryRemove(id: number, ents: Ent[]) {
  const i = _(ents).findIndex((p) => p.id == id);
  if (i >= 0) {
    const ent = ents[i];
    ents.splice(i, 1);
    entToSprite.get(ent).kill();
    entToSprite.delete(ent);
  }
}

function update() {

  if (lastTime == null) lastTime = performance.now() / 1000;
  const currTime = performance.now();

  if (events.length > 0) {
    socket.emit('input', {
      time: currTime,
      events: events.map((e) => e.ser())
    });
    clearArray(events);
  }

  const targetTime = currTime + delta - timeBuffer;
  const nextBcastIdx = timeline.findIndex((snap) => snap.time > targetTime);
  if (nextBcastIdx <= 0) return;
  const nextBcast = timeline[nextBcastIdx];
  const prevBcast = timeline[nextBcastIdx - 1];
  const alpha = (targetTime - prevBcast.time) / (nextBcast.time - prevBcast.time);

  const aMap = new Map(prevBcast.ents.map<[number, Ent]>((p) => [p.id, p]));
  const bMap = new Map(nextBcast.ents.map<[number, Ent]>((p) => [p.id, p]));
  for (let ev of prevBcast.events) {
    switch (ev.type) {
      case 'AddEnt':
        const ent: Ent = (<AddEnt>ev).ent;
        addEnt(ent);
        break;
      case 'RemEnt':
        const id = (<RemEnt>ev).id;
        tryRemove(id, players);
        tryRemove(id, ledges);
        break;
    }
  }
  for (let ent of getEnts()) {
    const [a,b] = [aMap.get(ent.id), bMap.get(ent.id)];
    if (a && b) {
      if (ent instanceof Player && a instanceof Player) ent.inputs = a.inputs;
      ent.x = lerp(a.x, b.x, alpha);
      ent.y = lerp(a.y, b.y, alpha);
      ent.vel.x = lerp(a.vel.x, b.vel.x, alpha);
      ent.vel.y = lerp(a.vel.y, b.vel.y, alpha);
    }
  }

  //while (currTime - lastTime >= dt) {
  //    world.step(dt);
  //    lastTime += dt;
  //}

  //chars[0].inputs.left.isDown = cursors.left.isDown;
  //chars[0].inputs.right.isDown = cursors.right.isDown;
  //chars[0].inputs.down.isDown = cursors.down.isDown;
  //chars[0].inputs.up.isDown = cursors.up.isDown;

  //for (let chr of chars) {
  //  feedInputs(chr);
  //}

  //for (var chr of charSprites) {
    //updatePos(chr);
  //}

  for (let player of players) {
    feedInputs(player);
    updatePos(player);
  }

  for (let ledge of ledges) {
    updatePos(ledge);
  }

  //for (let star of stars.children) {
    //updatePos(star);
  //}

  gfx.clear();
  gfx.lineStyle(1,defaultColor,1);
  if (game.input.activePointer.isDown) {
    target = new Vec2(game.input.worldX, game.input.worldY);
  }
  if (target) {
    gfx.drawCircle(target.x, target.y, 100);
    gfx.moveTo(me.x, me.y);
    if (currTime - lastSimTime > simPeriod) {
      lastSimTime = currTime;
      const horizon = 2;
      const startState = getWorldState();
      // This approach simply reuses the existing game logic to simulate hypothetical input sequences.  It explores
      // the space of possible moves using simple breadth-first search, picking the path that ends closest to the
      // target location.
      //
      // The resulting performance is prohibitively slow for even modest horizons.  The AI has // some moments of
      // intelligence, but with the short horizon, it just ends up flailing between non-optimal choices.
      const {bestNode: bestWorldState, bestCost, bestPath, visitedNodes: worldStates} = bfs({
        start: startState,
        edges: (worldState) => worldState.elapsed < horizon ?
          [Dir.Left, Dir.Right] : [],
        traverseEdge: sim,
        cost: (worldState) => worldState == startState ? 9999999 : worldState.finalDistToTarget
      });
      lastWorldStates = worldStates.concat([bestWorldState]);
      setInputsByDir(bestPath[0][1]);
      socket.emit('input', {time: currTime, events: [new InputEvent(me.inputs)]});
    }

    if (lastWorldStates) {
      for (let worldState of lastWorldStates) {
        gfx.lineStyle(1, worldState == lastWorldStates[lastWorldStates.length - 1] ? bestColor : defaultColor, 1);
        gfx.moveTo(...entPosFromPl(me, worldState.mePath[0]).toTuple());
        for (let pos of worldState.mePath.slice(1)) {
          gfx.lineTo(...entPosFromPl(me, pos).toTuple());
        }
      }
    }
  }

}

let lastSimTime = 0, lastWorldStates = null;
const simPeriod = 1000;
const defaultColor = 0x0088FF, bestColor = 0xFF0000;

let target: Vec2;

class BodyState {
  constructor(public bod: Pl.Body, public pos: Pl.Vec2, public vel: Pl.Vec2) {}
  //shadowEnt(ent: Ent): Ent {
  //  const shadow = new Ent();
  //  shadow.x = this.pos.x;
  //  shadow.y = this.pos.y;
  //  shadow.vel = new Vec2(this.vel);
  //  shadow.height = ent.height;
  //  shadow.width = ent.width;
  //  return shadow;
  //}
}

class WorldState {
  constructor(
      public elapsed: number,
      public minDistToTarget: number,
      public finalDistToTarget: number,
      public plState: [Ent, BodyState][],
      public mePath: Pl.Vec2[]
  ) {}
}

const enum Dir { Left, Right };

function getWorldState(elapsed: number = 0): WorldState {
  return new WorldState(
    elapsed,
    dist(entPosFromPl(me), target),
    dist(entPosFromPl(me), target),
    (getEnts().map((ent) => <[Ent,BodyState]> [
        ent, new BodyState(
          ent.bod, copyVec(ent.bod.getPosition()), copyVec(ent.bod.getLinearVelocity())
        )
    ])),
    [plPosFromEnt(me)]
  );
}

function restoreBody(ent, bodyState) {
  ent.bod.setPosition(copyVec(bodyState.pos));
  ent.bod.setLinearVelocity(copyVec(bodyState.vel));
}

function dist(a: Vec2, b: Vec2) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return Math.sqrt(x*x + y*y);
}

function copyVec(v: Pl.Vec2): Pl.Vec2 {
  return Pl.Vec2(v.x, v.y);
}

function setInputs([left, right]) {
  me.inputs.left.isDown = left;
  me.inputs.right.isDown = right;
}

function setInputsByDir(dir) {
  setInputs(dir == Dir.Left ? [true, false] : [false, true]);
}

const chunk = 1;
function sim(init: WorldState, dir: Dir) {
  // restore world state
  for (let [ent, bodyState] of init.plState) restoreBody(ent, bodyState);
  //for (let ent of getEnts()) restoreBody(ent, init.plState.get(ent));
  // simulate core logic
  const dt = 1/5;
  let minDistToTarget = 9999999;
  const mePath = [];
  mePath.push(copyVec(me.bod.getPosition()));
  const origInputs: [boolean, boolean] = [me.inputs.left.isDown, me.inputs.right.isDown];
  setInputsByDir(dir);
  for (let t = 0; t < chunk; t += dt) {
    Common.update(players, dt);
    mePath.push(copyVec(me.bod.getPosition()));
    minDistToTarget = Math.min(minDistToTarget, dist(entPosFromPl(me), target));
  }
  setInputs(origInputs);
  // save world state
  return new WorldState(
    init.elapsed + chunk,
    minDistToTarget,
    dist(entPosFromPl(me), target),
    getWorldState().plState,
    mePath
  );
}

interface BfsParams<V,E> {
  start: V;
  edges: (v: V) => E[];
  traverseEdge: (v: V, e: E) => V;
  cost: (v: V) => number;
}

interface BfsResult<V,E> {
  bestCost: number;
  bestNode: V;
  bestPath: [V,E][];
  visitedNodes: V[];
}

function bfs<V,E>({start, edges, traverseEdge, cost}: BfsParams<V,E>): BfsResult<V,E> {
  const queue = [start];
  const cameFrom = new Map<V,[V,E]>();
  let bestNode = start;
  let bestCost = cost(start);
  const visitedNodes = [];
  while (queue.length > 0) {
    const [node] = queue.splice(0,1);
    visitedNodes.push(node);
    if (cost(node) < bestCost) {
      bestNode = node;
      bestCost = cost(node);
    }
    for (let edge of edges(node)) {
      const next = traverseEdge(node, edge);
      queue.push(next);
      cameFrom.set(next, [node, edge]);
    }
  }
  const bestPath = [];
  let node = bestNode;
  while (true) {
    if (node == start) {
      break;
    }
    bestPath.push(cameFrom.get(node));
    node = cameFrom.get(node)[0];
  }
  bestPath.reverse();
  return {bestCost, bestNode, bestPath, visitedNodes};
}

function plVelFromEnt(ent) {
  return Pl.Vec2(ent.vel.x / ratio, -ent.vel.y / ratio);
}

function updatePos(ent) {
  const sprite = entToSprite.get(ent);
  sprite.x = ent.x;
  sprite.y = ent.y;
  ent.bod.setPosition(plPosFromEnt(ent));
  ent.bod.setLinearVelocity(plVelFromEnt(ent));
}

function clamp(x, bound) {
  return Math.min(Math.abs(x), bound) * Math.sign(x);
}

function feedInputs(player) {
  const inputs = player.inputs;
  const sprite = entToSprite.get(player);
  if (inputs.left.isDown) {
    sprite.animations.play('left');
  } else if (inputs.right.isDown) {
    sprite.animations.play('right');
  } else {
    //  Stand still
    sprite.animations.stop();
    sprite.frame = 4;
  }
}

function main() {
  socket = Sio('http://localhost:3000');
  socket.on('connect', () => {
    console.log('connect')

    socket.emit('join', {name: 'z'});

    socket.on('joined', (initSnap) => {
      game = new Phaser.Game(800, 600, Phaser.AUTO, '', {
        preload: preload,
        create: () => create(initSnap),
        update: update
      });

      timeline.push(initSnap);
      delta = initSnap.time - performance.now();

      socket.on('bcast', (bcast) => {
        timeline.push(bcast);
      });
    });

    socket.on('disconnect', () => console.log('disconnect'));
  });
}

main();
