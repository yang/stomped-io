export {};

(<any>window).PIXI = require('phaser-ce/build/custom/pixi');
(<any>window).p2 = require('phaser-ce/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser-ce/build/custom/phaser-split');

import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as Common from './common';
import {
  addBody,
  AddEnt, assert,
  Bcast,
  clearArray, cloneWorld, dt,
  copyVec,
  Ent,
  isClose,
  veq,
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
  world,
  iterBodies,
  iterFixtures, Lava, ledgeWidth, ledgeHeight, GameState, Star, pushAll, getLogger
} from './common';
import * as _ from 'lodash';

// doCloneWorlds is necessary for accurate prediction (proper cloning of collision state), but currently takes 307ms
// vs. 167ms for non-cloning - most of the time goes into _.deepClone().
let doCloneWorlds = true;

var game;

const gameState = new GameState();

let drawPlanckBoxes = false, drawAllPaths = false, drawPlans = true;

function preload() {

  game.load.image('bg', 'assets/bg.png');
  game.load.image('sky', 'assets/bg-grad.png');
  game.load.image('ground', 'assets/ledge.png');
  game.load.image('star', 'assets/star.png');
  game.load.image('lava', 'assets/lava.png');
  game.load.spritesheet('dude', 'dist/assets/player-white.png', 567, 756);
  game.stage.disableVisibilityChange = true;

}

var platforms;
var cursors;

var stars;
var score = 0;
var scoreText;

var socket;
var me: Player;

const players = gameState.players;
const ledges = gameState.ledges;

const timeline: Bcast[] = [];

let isSim = false;

const meIsBot = false;

// This may get called multiple times on same object in a single frame when multiple entities collide with something.
function destroy2(ent) {
  const log = getLogger('destroy');
  if (!isSim) {
    world.destroyBody(ent.bod);
    entToSprite.get(ent).kill();
    const removed = [
      ..._.remove(gameState.players, e => e == ent),
      ..._.remove(gameState.stars, e => e == ent)
    ];
    log.log(isSim, removed.length, ent.type, ent.id);
    assert(ent.type != 'Player' || removed.length == 1);
  }
}

const entToSprite = new Map();
const events: Event[] = [];

let gfx;

(<any>window).dbg = {platforms, cursors, gameWorld: world, players, ledges, entToSprite};

function create(initSnap) {

  gameState.time = initSnap.tick * dt;

  game.world.setBounds(0,0,Common.gameWorld.width,Common.gameWorld.height);
  game.time.advancedTiming = true;

  gfx = game.add.graphics(0,0);
  gfx.lineStyle(1,0x0088FF,1);

  //  A simple background for our game
  game.add.sprite(0, 0, 'sky');

  const bg = game.add.tileSprite(0,0,Common.gameWorld.width,Common.gameWorld.height,'bg');
  bg.tileScale.x = 1/4;
  bg.tileScale.y = 1/4;
  bg.alpha = .05;

  const lava = new Lava(0, Common.gameWorld.height - 64);
  addBody(lava, 'kinematic');
  gameState.lava = lava;
  const lavaSprite = game.add.sprite(0, Common.gameWorld.height - 64, 'lava');
  entToSprite.set(lava, lavaSprite);
  lavaSprite.width = lava.width;
  lavaSprite.height = lava.height;

  Common.create(destroy2, gameState);

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
    key.onDown.add(() => events.push(new InputEvent(updateInputs())));
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
  return gameState.getEnts();
}

function addEnt(ent) {
  switch (ent.type) {
    case 'Player':
      addPlayer(<Player>ent);
      break;
    case 'Ledge':
      addLedge(<Ledge>ent);
      break;
    case 'Star':
      addStar(<Star>ent);
      break;
  }
}

function addPlayer(player) {
  if (!players.find((p) => p.id == player.id)) {
    players.push(player);
    const sprite = game.add.sprite(player.x, player.y, 'dude');
    sprite.width = 24;
    sprite.height = 32;
    sprite.animations.add('left', [3, 4, 3, 5], 10, true);
    sprite.animations.add('right', [0, 1, 0, 2], 10, true);
    entToSprite.set(player, sprite);
    addBody(player, 'dynamic');
  }
}

function addLedge(ledge) {
  if (!ledges.find((p) => p.id == ledge.id)) {
    ledges.push(ledge);
    const platform = platforms.create(ledge.x, ledge.y, 'ground');
    platform.width = ledgeWidth;
    platform.height = ledgeHeight;
    entToSprite.set(ledge, platform);
    addBody(ledge, 'kinematic');
  }
}

function addStar(star) {
  if (!gameState.stars.find(s => s.id == star.id)) {
    gameState.stars.push(star);
    // TODO eventually make star display larger than physics size
    const starDispDim = 1 * star.width;
    const offset = (star.width - starDispDim) / 2;
    const sprite = game.add.sprite(star.x + offset, star.y + offset, 'star');
    sprite.width = starDispDim;
    sprite.height = starDispDim;
    entToSprite.set(star, sprite);
    addBody(star, 'kinematic');
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

// This enables easier debugging---no runaway server-side simulation while setting breakpoints, no skipped frames,
// no latency/interpolation, exact same resutls between predicted and actual physics.
const runLocally = true;

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
      console.warn('off end of timeline');
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
          tryRemove(id, gameState.stars);
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
  if (drawPlanckBoxes) {
    for (let body of Array.from(iterBodies(world))) {
      const [fix] = Array.from(iterFixtures(body)), dims = fixtureDims(fix);
      gfx.drawRect(
        ratio * (body.getPosition().x - dims.width / 2),
        ratio * -(body.getPosition().y + dims.height / 2),
        dims.width * ratio, dims.height * ratio
      );
    }
  }
  gfx.lineStyle(1,defaultColor,1);
  if (game.input.activePointer.isDown) {
    const bot = makeBot();
    bot.target = new Vec2(game.input.worldX, game.input.worldY);
  }
  for (let bot of bots) {
    bot.replayPlan(updating, currTime);
  }
  for (let bot of bots) {
    bot.drawPlan();
  }

  if (runLocally && updating) {
    const origEnts = getEnts();
    Common.update(gameState);
    for (let bot of bots) {
      bot.checkPlan(currTime);
    }
    for (let player of players) {
      feedInputs(player);
    }
    // update sprites. iterate over all origEnts, including ones that may have been destroyed & removed, since we can then update their Entity positions to their final physics body positions.
    for (let ent of origEnts) {
      updateEntPhys(ent);
      updatePos(ent);
    }
    lastTime = currTime;
  }
}

enum ReplayMode { TIME, STEPS }
let replayMode = ReplayMode.STEPS;

const simPeriod = 3000;

//const chunk = 1 / 5, horizon = 6 / 5;
const chunk = 1, horizon = 6;
const simDt = 1/20;

if (replayMode == ReplayMode.STEPS)
  assert(runLocally && simDt == dt);

const defaultColor = 0x002244, bestColor = 0xFF0000, bestColors = [
  0xff0000,
  0xffff00,
  0x00ff00,
  0x00ffff,
  0xff00ff,
  0xffffff
];

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

type PlState = [Ent, BodyState][];

class WorldState {
  constructor(
      public elapsed: number,
      public dir: Dir,
      public minDistToTarget: number,
      public finalDistToTarget: number,
      public plState: PlState,
      public mePath: Pl.Vec2[],
      public meVels: Pl.Vec2[],
      public gameState: GameState
  ) {}
}

const enum Dir { Left, Right };

function capturePlState(): PlState {
  return getEnts().map((ent) => <[Ent, BodyState]> [
    ent, new BodyState(
      ent.bod, copyVec(ent.bod.getPosition()), copyVec(ent.bod.getLinearVelocity())
    )
  ]);
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

function setInputs(player: Player, [left, right]: [boolean, boolean]) {
  player.inputs.left.isDown = left;
  player.inputs.right.isDown = right;
}

function setInputsByDir(player: Player, dir: Dir) {
  setInputs(player, dir == Dir.Left ? [true, false] : [false, true]);
}

function getDir(player) {
  return player.inputs.left.isDown ? Dir.Left :
    player.inputs.right.isDown ? Dir.Right : null;
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
    if (sprite.frame < 3) sprite.frame = 0;
    else sprite.frame = 3;
  }
}

const bots: Bot[] = [];
class Bot {
  target: Vec2;
  lastSimTime = null;
  lastWorldStates;
  lastBestSeq: WorldState[];
  lastChunk: WorldState;
  chunkSteps: number;

  constructor(public player: Player) {}

  getWorldState(plState: PlState, gameState: GameState): WorldState {
    const me = this.player;
    return new WorldState(
      0,
      null,
      dist(entPosFromPl(me), this.target),
      dist(entPosFromPl(me), this.target),
      plState,
      [plPosFromEnt(me)],
      [],
      gameState
    );
  }

  getCurrChunk(currTime: number): WorldState {
    let currChunk;
    assert(this.chunkSteps <= chunk / simDt);
    if (replayMode == ReplayMode.TIME) {
      currChunk = this.lastBestSeq[1 + Math.floor((currTime - this.lastSimTime) / (1000 * chunk / timeWarp))];
    } else if (replayMode == ReplayMode.STEPS) {
      const index = this.lastBestSeq.indexOf(this.lastChunk); // 0 if not found, i.e. new path
      currChunk = index < 0 ? this.lastBestSeq[1] :
        this.chunkSteps == chunk / simDt ? this.lastBestSeq[index + 1] :
          this.lastChunk;
    } else {
      throw new Error();
    }
    return currChunk;
  }

  runSims(startState: WorldState, simFunc: (node: WorldState, dir: Dir) => WorldState) {
    isSim = true;
    const {bestNode: bestWorldState, bestCost, bestPath, visitedNodes: worldStates} = bfs<WorldState, Dir>({
      start: startState,
      edges: (worldState) => worldState.elapsed < horizon ?
        [Dir.Left, Dir.Right] : [],
      traverseEdge: simFunc,
      cost: (worldState) => worldState.elapsed < horizon ? 9999999 : worldState.finalDistToTarget
    });
    isSim = false;
    return {bestWorldState, bestPath, worldStates};
  }

  runSimsReuse() {
    const me = this.player;
    const startState = this.getWorldState(capturePlState(), gameState);
    const res = this.runSims(startState, (init, dir) => {
      // restore world state
      for (let [ent, bodyState] of init.plState) restoreBody(ent, bodyState);
      const origInputs: [boolean, boolean] = [me.inputs.left.isDown, me.inputs.right.isDown];
      setInputsByDir(me, dir);
      const stars = gameState.stars;
      clearArray(gameState.stars);
      const res = this.sim(dir, world, gameState, init, world => capturePlState());
      setInputs(me, origInputs);
      pushAll(gameState.stars, stars);
      return res;
    });
    // revert bodies to their original states
    for (let ent of getEnts()) {
      updatePos(ent);
    }
    return res;
  }

  runSimsClone() {
    const me = this.player;
    const initGameState = _.clone(gameState);
    initGameState.stars = [];
    initGameState.world = cloneWorld(world);
    for (let body of Array.from(iterBodies(initGameState.world))) {
      if (gameState.stars.includes(body.getUserData())) {
        initGameState.world.destroyBody(body);
      }
    }
    const startState = this.getWorldState([], initGameState);
    return this.runSims(startState, (init, dir) => {
      const world = cloneWorld(init.gameState.world);
      const entToNewBody = new Map(
        Array.from(iterBodies(world)).map<[Ent, Pl.Body]>(b => [b.getUserData(), b])
      );
      const newLedges = ledges.map(l => {
        const m = new Ledge(l.x, l.y, l.oscPeriod);
        m.bod = entToNewBody.get(l);
        return m;
      });
      const newPlayers = players.map(p => {
        const q = new Player(p.name, p.x, p.y);
        q.bod = entToNewBody.get(p);
        setInputs(q, [p.inputs.left.isDown, p.inputs.right.isDown]);
        return q;
      });
      // What needs to be cloned depends on how .bod is traversed in Common.update() and potentially how the collision
      // handlers use it.
      // No need to clone lava.
      const newMe = newPlayers[players.findIndex(p => p == me)];
      setInputsByDir(newMe, dir);
      const newGameState = _.clone(init.gameState);
      newGameState.ledges = newLedges;
      newGameState.players = newPlayers;
      newGameState.world = world;
      return this.sim(dir, world, newGameState, init, world => []);
    });
  }

  // simulate core logic
  sim(dir: Dir, world: Pl.World, gameState: GameState, init: WorldState, capturePlState: (world: Pl.World) => PlState) {
    const me = this.player;
    let minDistToTarget = 9999999, distance = null;
    const mePath = [], meVels = [];
    const meBody = _(Array.from(iterBodies(world))).find(body => body.getUserData() == me);
    mePath.push(copyVec(meBody.getPosition()));
    meVels.push(copyVec(meBody.getLinearVelocity()));
    for (let i = 0; i < chunk / simDt; i++) {
      Common.update(gameState, simDt, world);
      if (Math.abs(mePath[mePath.length - 1].y) > Common.gameWorld.height / ratio &&
        Math.abs(meBody.getPosition().y) < Common.gameWorld.height / ratio) {
        console.log('jerking');
      }
      mePath.push(copyVec(meBody.getPosition()));
      meVels.push(copyVec(meBody.getLinearVelocity()));
      distance = dist(entPosFromPl(me, meBody.getPosition()), this.target);
      minDistToTarget = Math.min(minDistToTarget, distance);
    }
    return new WorldState(
      init.elapsed + chunk,
      dir,
      minDistToTarget,
      distance,
      capturePlState(world),
      mePath,
      meVels,
      gameState
    );
  }

  reallySetInput(dir: Dir, currTime: number) {
    const me = this.player;
    setInputsByDir(me, dir);
    socket.emit('input', {time: currTime, events: [new InputEvent(me.inputs)]});
  }

  replayChunkStep(currTime: number) {
    const me = this.player;
    const log = getLogger('replay');
    const currChunk = this.getCurrChunk(currTime);
    if (this.lastChunk != currChunk) {
      if (this.chunkSteps && this.chunkSteps < chunk / simDt) {
        log.log('switching from old chunk ', this.lastChunk && this.lastChunk.elapsed, ' to new chunk ', currChunk.elapsed, ', but did not execute all steps in last chunk!');
      }
      this.chunkSteps = 0;
    }
    this.chunkSteps += 1;
    this.lastChunk = currChunk;
//  console.log(currChunk.dir, this.chunkSteps, (currTime - this.lastSimTime) / (1000 * chunk / timeWarp), currTime - this.lastSimTime, 1000 * chunk / timeWarp, currTime, this.lastSimTime);
    if (currChunk && getDir(me) != currChunk.dir) {
      //console.log(getDir(me), currChunk.dir, (currTime - this.lastSimTime) / (1000 * chunk / timeWarp))
      this.reallySetInput(currChunk.dir, currTime);
    }
  }

  replayPlan(updating: boolean, currTime: number) {
    const log = getLogger('replay');
    if (!this.isDead() && (!runLocally || updating)) {
      if (this.lastBestSeq) {
        this.replayChunkStep(currTime);
      }
      let doSim = false;
      if (replayMode == ReplayMode.TIME) {
        doSim = this.lastSimTime == null || currTime - this.lastSimTime > simPeriod / timeWarp;
      } else if (replayMode == ReplayMode.STEPS) {
        log.log(this.lastChunk && this.lastChunk.elapsed - chunk, this.chunkSteps, this.lastChunk && (this.lastChunk.elapsed + this.chunkSteps * simDt / chunk) * 1000);
        doSim = !this.lastChunk || (this.lastChunk.elapsed - chunk + this.chunkSteps * simDt / chunk) * 1000 > simPeriod;
      } else {
        throw new Error();
      }
      if (doSim) {
        this.lastSimTime = currTime;
        const {worldStates, bestPath, bestWorldState} =
          doCloneWorlds ? this.runSimsClone() : this.runSimsReuse();
        this.lastWorldStates = worldStates;
        this.lastBestSeq = bestPath.map(([ws, dir]) => ws).concat([bestWorldState]);
        log.log('simulated');
        if (this.lastBestSeq.length > 1) {
          this.chunkSteps = null;
          this.replayChunkStep(currTime);
//          reallySetInput(this.lastBestSeq[1].dir, currTime);
//          console.log('switching to brand new path ');
        }
      }
    }
  }

  isDead() {
    return this.player.y >= Common.gameWorld.height;
  }
  
  drawPlan() {
    const me = this.player;
    if (drawPlans && this.target && !this.isDead()) {
      gfx.drawCircle(this.target.x, this.target.y, 100);

      if (this.lastWorldStates) {
        const poly = [{x: -1,y: -1}, {x: -1, y: 1}, {x: 1, y: 0}, {x: -1, y: -1}].map(({x,y}) => ({x: 5*x, y: 5*y}));
        const bcolors = bestColors.concat(bestColors).concat(bestColors)[Symbol.iterator]();
        const pathsToDraw = (drawAllPaths ? this.lastWorldStates : []).concat(this.lastBestSeq);
        for (let worldState of pathsToDraw) {
          gfx.lineStyle(1, this.lastBestSeq.includes(worldState) ? bcolors.next().value : defaultColor, 1);
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
  }
  
  checkPlan(currTime: number) {
    const me = this.player;
    if (meIsBot && this.target && !this.isDead() && replayMode == ReplayMode.STEPS) {
      const currChunk = this.getCurrChunk(currTime);
      if (!veq(me.bod.getPosition(), currChunk.mePath[this.chunkSteps % (chunk / simDt)])) {
        console.error('diverging from predicted path!');
      }
    }
  }
}

function makeBot() {
  const player = new Player(
    name,
    ledges[2].x + ledgeWidth / 2,
    ledges[2].y - 50
  );
  addPlayer(player);
  const bot = new Bot(player);
  bots.push(bot);
  return bot;
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
      game = new Phaser.Game({
        scaleMode: Phaser.ScaleManager.RESIZE,
        renderer: Phaser.WEBGL,
        state: {
          onResize: function(scaleMgr, parentBounds) {
            const scale = Math.max(parentBounds.width / 800, parentBounds.height / 800);
            this.world.scale.set(scale);
            // This is needed to keep the camera on the player. Camera doesn't register game rescales.
            this.camera.follow(entToSprite.get(me), Phaser.Camera.FOLLOW_PLATFORMER);
          },
          preload: preload,
          create: function() {
            this.scale.setResizeCallback(this.onResize, this);
            this.scale.refresh();
            create(initSnap);
          },
          update: update
        }
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
