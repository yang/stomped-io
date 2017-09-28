export {};

(<any>window).PIXI = require('phaser/build/custom/pixi');
(<any>window).p2 = require('phaser/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser/build/custom/phaser-split');

import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  Bcast,
  clearArray, dt,
  Ent,
  entPosFromPl,
  Event,
  InputEvent,
  Ledge,
  Player,
  plPosFromEnt,
  ratio,
  RemEnt,
  timeWarp,
  updateEntPhys,
  updatePeriod,
  Vec2,
  world
} from './common';
import * as _ from 'lodash';

var game;

function preload() {

  game.load.image('sky', 'assets/sky.png');
  game.load.image('ground', 'assets/platform.png');
  game.load.image('star', 'assets/star.png');
  game.load.image('lava', 'assets/lava.jpg');
  game.load.spritesheet('dude', 'assets/dude.png', 32, 48);
  game.stage.disableVisibilityChange = true;

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

function destroy2(sprite) {
  world.destroyBody(sprite.bod);
  sprite.kill();
}

const entToSprite = new Map();
const events: Event[] = [];

let gfx;

function create(initSnap) {

  game.world.setBounds(0,0,800,2400);
  game.time.advancedTiming = true;

  gfx = game.add.graphics(0,0);
  gfx.lineStyle(1,0x0088FF,1);

  //  A simple background for our game
  // game.add.sprite(0, 0, 'sky');

  lava = game.add.sprite(0, game.world.height - 64, 'lava');
  lava.enableBody = true;
  addBody(lava, 'kinematic');
  Common.create(players, null, lava);

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

let lastTime = 0;

const timeBuffer = 50;
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

function reallySetInput(dir: Dir, currTime: number) {
  setInputsByDir(dir);
  socket.emit('input', {time: currTime, events: [new InputEvent(me.inputs)]});
}

function* iterBodies(world) {
  for (let body = world.getBodyList(); body; body = body.getNext()) {
    yield body;
  }
}

function* iterFixtures(body) {
  for (let fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
    yield fixture;
  }
}

// This enables easier debugging---no runaway server-side simulation while setting breakpoints, no skipped frames,
// no latency/interpolation, exact same resutls between predicted and actual physics.
const runLocally = true;

function replayChunkStep(currTime: number) {
  if (replayMode == ReplayMode.TIME) {
    const currChunk = lastBestSeq[1 + Math.floor((currTime - lastSimTime) / (1000 * chunk / timeWarp))];
    if (lastChunk != currChunk) {
      if (chunkSteps && chunkSteps < chunk / simDt) {
        console.log('switching from old chunk ', lastChunk && lastChunk.elapsed, ' to new chunk ', currChunk.elapsed, ', but did not execute all steps in last chunk!');
      }
      chunkSteps = 0;
    }
    lastChunk = currChunk;
    chunkSteps += 1;
    console.log(chunkSteps, (currTime - lastSimTime) / (1000 * chunk / timeWarp), currTime - lastSimTime, 1000 * chunk / timeWarp, currTime, lastSimTime);
    if (currChunk && getDir(me) != currChunk.dir) {
      //console.log(getDir(me), currChunk.dir, (currTime - lastSimTime) / (1000 * chunk / timeWarp))
      reallySetInput(currChunk.dir, currTime);
    }
  } else if (replayMode == ReplayMode.STEPS) {
//          assert(chunkSteps <= chunk / simDt);
    //        const currChunk = chunkSteps == chunk / simDt;
  } else {
    throw new Error();
  }
}

function update() {

  game.debug.text(game.time.fps, 2, 14, "#00ff00");
  const currTime = performance.now();
  let updating = false;

  if (runLocally) {
    if (currTime - lastTime >= updatePeriod * 1000) {
      updating = true;
    }
  } else {
    if (events.length > 0) {
      socket.emit('input', {
        time: currTime,
        events: events.map((e) => e.ser())
      });
      clearArray(events);
    }

    const targetTime = currTime + delta - timeBuffer;
    // console.log(currTime, delta, timeBuffer, currTime + delta - timeBuffer);
    const nextBcastIdx = timeline.findIndex((snap) => snap.time > targetTime);
    if (nextBcastIdx <= 0) {
      console.log('off end of timeline');
      return;
    }
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
      const [a, b] = [aMap.get(ent.id), bMap.get(ent.id)];
      if (a && b) {
        if (ent instanceof Player && a instanceof Player) ent.inputs = a.inputs;
        ent.x = lerp(a.x, b.x, alpha);
        ent.y = lerp(a.y, b.y, alpha);
        ent.vel.x = lerp(a.vel.x, b.vel.x, alpha);
        ent.vel.y = lerp(a.vel.y, b.vel.y, alpha);
      }
    }
    for (let player of players) {
      feedInputs(player);
    }

    for (let ent of getEnts()) {
      updatePos(ent);
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

  //for (let star of stars.children) {
    //updatePos(star);
  //}

  gfx.clear();
  gfx.lineStyle(1,0x555555,1);
  function fixtureDims(fix) {
    const v = [0,1,2,3].map(i => fix.getShape().getVertex(i)),
      xs = v.map(p => p.x),
      ys = v.map(p => p.y),
      xmax = _(xs).max(),
      xmin = _(xs).min(),
      ymax = _(ys).max(),
      ymin = _(ys).min();
    return {width: xmax - xmin, height: ymax - ymin};
  }
  for (let body of iterBodies(world)) {
    const [fix] = iterFixtures(body), dims = fixtureDims(fix);
    gfx.drawRect(
      ratio *  (body.getPosition().x - dims.width  / 2),
      ratio * -(body.getPosition().y + dims.height / 2),
      dims.width * ratio, dims.height * ratio
    );
  }
  gfx.lineStyle(1,defaultColor,1);
  if (game.input.activePointer.isDown) {
    target = new Vec2(game.input.worldX, game.input.worldY);
  }
  if (target) {
    gfx.drawCircle(target.x, target.y, 100);
    gfx.moveTo(me.x, me.y);
    if (!runLocally || updating) {
      if (lastBestSeq) {
        replayChunkStep(currTime);
      }
      if (lastSimTime == null || currTime - lastSimTime > simPeriod / timeWarp) {
        lastSimTime = currTime;
        const startState = getWorldState();
        // This approach simply reuses the existing game logic to simulate hypothetical input sequences.  It explores
        // the space of possible moves using simple breadth-first search, picking the path that ends closest to the
        // target location.
        //
        // The resulting performance is prohibitively slow for even modest horizons.  The AI has // some moments of
        // intelligence, but with the short horizon, it just ends up flailing between non-optimal choices.
        const {bestNode: bestWorldState, bestCost, bestPath, visitedNodes: worldStates} = bfs<WorldState, Dir>({
          start: startState,
          edges: (worldState) => worldState.elapsed < horizon ?
            [Dir.Left, Dir.Right] : [],
          traverseEdge: sim,
          cost: (worldState) => worldState.elapsed < horizon ? 9999999 : worldState.finalDistToTarget
        });
        // revert bodies to their original states
        for (let ent of getEnts()) {
          updatePos(ent);
        }
        lastWorldStates = worldStates;
        lastBestSeq = bestPath.map(([ws, dir]) => ws).concat([bestWorldState]);
        console.log('simulated');
        if (lastBestSeq.length > 1) {
          chunkSteps = null;
          replayChunkStep(currTime);
//          reallySetInput(lastBestSeq[1].dir, currTime);
//          console.log('switching to brand new path ');
        }
      }
    }

    if (lastWorldStates) {
      const poly = [{x: -1,y: -1}, {x: -1, y: 1}, {x: 1, y: 0}, {x: -1, y: -1}].map(({x,y}) => ({x: 5*x, y: 5*y}));
      const bcolors = bestColors.concat(bestColors).concat(bestColors)[Symbol.iterator]();
      for (let worldState of lastWorldStates.concat(lastBestSeq)) {
        gfx.lineStyle(1, lastBestSeq.includes(worldState) ? bcolors.next().value : defaultColor, 1);
        const startPos = entPosFromPl(me, worldState.mePath[0], true).toTuple();
        if (worldState.dir == null) {
          gfx.drawCircle(...startPos, 10);
        } else {
          const dirSign = Dir.Left == worldState.dir ? -1 : 1;
          gfx.drawPolygon(poly.map(({x,y}) => ({x: dirSign*x+startPos[0], y: y+startPos[1]})));
        }
        gfx.moveTo(...startPos);
        // if (_.find(worldState.mePath, (pos: Pl.Vec2) => Math.abs(pos.y) > 9999)) {
        //   console.log(worldState.mePath.map((pos) => entPosFromPl(me, pos).y).join(' '));
        // }
        for (let pos of worldState.mePath.slice(1)) {
          gfx.lineTo(...entPosFromPl(me, pos, true).toTuple());
        }
        for (let pos of worldState.mePath.slice(1)) {
          const dirSign = Dir.Left == worldState.dir ? -1 : 1;
          const entPos = entPosFromPl(me, pos, true);
          gfx.drawPolygon(poly.map(({x,y}) => ({x: dirSign*x+entPos.x, y: y+entPos.y})));
        }
      }
    }
  }

  if (runLocally && updating) {
    Common.update(players);
    for (let player of players) {
      feedInputs(player);
    }
    // update sprites
    for (let ent of getEnts()) {
      updateEntPhys(ent);
      updatePos(ent);
    }
    lastTime = currTime;
  }
}

enum ReplayMode { TIME, STEPS }
const replayMode = ReplayMode.TIME; // runLocally && simDt == dt ? ReplayMode.TIME : ReplayMode.STEPS;

const simPeriod = 3000;
let lastSimTime = null, lastWorldStates, lastBestSeq: WorldState[], lastChunk: WorldState, chunkSteps: number;
const defaultColor = 0x002244, bestColor = 0xFF0000, bestColors = [
  0xff0000,
  0xffff00,
  0x00ff00,
  0x00ffff,
  0xff00ff,
  0xffffff
];

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
      public dir: Dir,
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
    null,
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

function getDir(player) {
  return player.inputs.left.isDown ? Dir.Left :
    player.inputs.right.isDown ? Dir.Right : null;
}

//const chunk = 1 / 5, horizon = 6 / 5;
const chunk = 1, horizon = 6;
const simDt = 1/10;

function sim(init: WorldState, dir: Dir) {
  // restore world state
  for (let [ent, bodyState] of init.plState) restoreBody(ent, bodyState);
  //for (let ent of getEnts()) restoreBody(ent, init.plState.get(ent));
  // simulate core logic
  let minDistToTarget = 9999999;
  const mePath = [];
  mePath.push(copyVec(me.bod.getPosition()));
  const origInputs: [boolean, boolean] = [me.inputs.left.isDown, me.inputs.right.isDown];
  setInputsByDir(dir);
  for (let i = 0; i < chunk / simDt; i++) {
    Common.update(players, simDt);
    if (Math.abs(mePath[mePath.length - 1].y) > game.world.height / ratio &&
      Math.abs(me.bod.getPosition().y) < game.world.height / ratio) {
      console.log('jerking');
    }
    mePath.push(copyVec(me.bod.getPosition()));
    minDistToTarget = Math.min(minDistToTarget, dist(entPosFromPl(me), target));
  }
  // console.log('finish sim');
  setInputs(origInputs);
  // save world state
  return new WorldState(
    init.elapsed + chunk,
    dir,
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

const doPings = false;
function main() {
  socket = Sio('http://localhost:3000');
  socket.on('connect', () => {
    console.log('connect')

    socket.emit('join', {name: 'z'});

    if (doPings) {
      setInterval(() => {
        console.log('pinging');
        socket.emit('ding', {pingTime: performance.now()})
      }, 1000);
    }
    socket.on('dong', ({pingTime}) => console.log('ping', performance.now() - pingTime));

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
