(<any>window).PIXI = require('phaser-ce/build/custom/pixi');
(<any>window).p2 = require('phaser-ce/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser-ce/build/custom/phaser-split');

import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as dat from 'dat.gui/build/dat.gui';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  assert,
  Bcast, Bot,
  clearArray,
  cloneWorld,
  copyVec, defaultColor,
  dt,
  Ent,
  entPosFromPl,
  enumerate,
  Event,
  GameState, genStyles,
  getLogger,
  InputEvent,
  iterBodies,
  iterFixtures,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth,
  Player,
  plPosFromEnt,
  pushAll,
  ratio,
  RemEnt, runLocally,
  Star,
  timeWarp, totalSquishTime,
  updateEntPhysFromPl,
  updatePeriod,
  Vec2,
  veq,
  world
} from './common';
import * as _ from 'lodash';
import * as signals from 'signals';

class ControlPanel {
  currentPlayer = 0;
  viewAll = false;
  makeBot() { makeBot(); }
}
const cp = new ControlPanel();

const styleGen = genStyles();

var game;

const gameState = new GameState(undefined, destroy2);
gameState.onJumpoff.add((player, other) => {
  const minSize = 10, maxSize = 15, slope = 0.1 / (maxSize - minSize);
  const shake = Math.max(0, Math.min(0.01, slope * (player.size - minSize)));
  if (shake > 0)
    game.camera.shake(shake, 100);

  if (other instanceof Player) {
    // squish the other player's sprite a bit
    other.currentSquishTime = 0;
  }
});

let drawPlanckBoxes = true;

function preload() {

  game.load.image('bg', 'assets/bg.png');
  game.load.image('sky', 'assets/bg-grad.png');
  game.load.image('ground', 'assets/ledge.png');
  game.load.image('star', 'assets/star.png');
  game.load.image('lava', 'assets/lava.png');
  game.load.spritesheet('dude-white', 'dist/assets/player-white.png', 567, 756);
  game.load.spritesheet('dude-red', 'dist/assets/player-red.png', 567, 756);
  game.load.spritesheet('dude-yellow', 'dist/assets/player-yellow.png', 567, 756);
  game.load.spritesheet('dude-green', 'dist/assets/player-green.png', 567, 756);
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

const meIsBot = false;

// This may get called multiple times on same object in a single frame when multiple entities collide with something.
function destroy2(ent) {
  const log = getLogger('destroy');
  world.destroyBody(ent.bod);
  entToSprite.get(ent).kill();
  const removed = [
    ..._.remove(gameState.players, e => e == ent),
    ..._.remove(gameState.stars, e => e == ent)
  ];
  log.log(removed.length, ent.type, ent.id);
  assert(ent.type != 'Player' || removed.length == 1);
  if (ent instanceof Player) {
    guiMgr.refresh();
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

  Common.create(gameState);

  //  The platforms group contains the ground and the 2 ledges we can jump on
  platforms = game.add.group();

  const {ents} = initSnap;
  for (let ent of ents) {
    addEnt(ent);
  }

  me = players[players.length - 1];
  const meSprite = entToSprite.get(me);
  game.camera.follow(meSprite, Phaser.Camera.FOLLOW_PLATFORMER);
  guiMgr.refresh();

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
      addPlayer(ent);
      break;
    case 'Ledge':
      addLedge(ent);
      break;
    case 'Star':
      addStar(ent);
      break;
  }
}

function addPlayer(playerObj) {
  const found = players.find((p) => p.id == playerObj.id);
  if (!found) {
    const player = new Player(playerObj.name, playerObj.x, playerObj.y, playerObj.style);
    _.extend(player, playerObj);
    player.baseDims = Vec2.fromObj(player.baseDims);
    players.push(player);
    const sprite = game.add.sprite(player.x, player.y, `dude-${styleGen.next().value}`);
    sprite.width = player.width;
    sprite.height = player.height;
    sprite.animations.add('left', [3, 4, 3, 5], 10, true);
    sprite.animations.add('right', [0, 1, 0, 2], 10, true);
    entToSprite.set(player, sprite);
    addBody(player, 'dynamic');
    guiMgr.refresh();
    return player;
  }
  return found;
}

function addLedge(ledgeObj) {
  if (!ledges.find((p) => p.id == ledgeObj.id)) {
    const ledge = new Ledge(ledgeObj.x, ledgeObj.y, ledgeObj.oscPeriod);
    _.extend(ledge, ledgeObj);
    ledges.push(ledge);
    const platform = platforms.create(ledge.x, ledge.y, 'ground');
    platform.width = ledgeWidth;
    platform.height = ledgeHeight;
    entToSprite.set(ledge, platform);
    addBody(ledge, 'kinematic');
  }
}

function addStar(starObj) {
  if (!gameState.stars.find(s => s.id == starObj.id)) {
    const star = new Star(starObj.x, starObj.y);
    gameState.stars.push(star);
    // TODO eventually make star display larger than physics size
    const [x,y] = star.dispPos().toTuple();
    const sprite = game.add.sprite(x, y, 'star');
    [sprite.width, sprite.height] = star.dispDims().toTuple();
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

function vecStr(v) {
  return JSON.stringify([v.x, v.y]);
}

function update() {

  const currentPlayer = players[cp.currentPlayer];
  const bot = bots.find(b => b.player == currentPlayer);

  const debugText = `
FPS: ${game.time.fps}
${players.length} players

Current player:
Velocity: ${currentPlayer ? vecStr(currentPlayer.bod.getLinearVelocity()) : ''}
Target: ${bot ? vecStr(bot.target) : ''}
Size: ${currentPlayer ? currentPlayer.size : ''}
Mass: ${currentPlayer ? currentPlayer.bod.getMass() / .1875 : ''}

Scores:
${_(players)
    .sort(p => -p.size)
    .map(p => `${p.size} ${p.name}`)
    .join('\n')}
  `.trim();
  for (let [i,line] of enumerate(debugText.split('\n'))) {
    game.debug.text(line, 2, 14 * (i + 1), "#00ff00");
  }
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
      updateSpriteAndPlFromEnt(ent);
    }
  }

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
    if (bot) {
      bot.target = new Vec2(game.input.worldX, game.input.worldY);
    }
  }
  for (let bot of bots) {
    bot.replayPlan(updating, currTime);
  }
  for (let bot of bots) {
    bot.drawPlan(gfx);
  }

  if (runLocally && updating) {
    const origEnts = getEnts();
    const totalStepTime = Common.update(gameState);
    for (let player of gameState.players) {
      if (player.currentSquishTime != null) {
        player.currentSquishTime += totalStepTime;
        if (player.currentSquishTime > totalSquishTime) {
          player.currentSquishTime = null;
        }
      }
    }
    for (let bot of bots) {
      bot.checkPlan(currTime);
    }
    for (let player of players) {
      feedInputs(player);
    }
    // update sprites. iterate over all origEnts, including ones that may have been destroyed & removed, since we can then update their Entity positions to their final physics body positions.
    for (let ent of origEnts) {
      updateEntPhysFromPl(ent);
      updateSpriteFromEnt(ent);
    }
    lastTime = currTime;
  }
}

function plVelFromEnt(ent) {
  return Pl.Vec2(ent.vel.x / ratio, -ent.vel.y / ratio);
}

function updateSpriteAndPlFromEnt(ent) {
  updateSpriteFromEnt(ent);
  ent.bod.setPosition(plPosFromEnt(ent));
  ent.bod.setLinearVelocity(plVelFromEnt(ent));
}

function updateSpriteFromEnt(ent) {
  const sprite = entToSprite.get(ent);
  [sprite.x, sprite.y] = ent.dispPos().toTuple();
  [sprite.width, sprite.height] = ent.dispDims().toTuple();
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

function makeBot() {
  const player = addPlayer(new Player(
    'bot',
    ledges[2].x + ledgeWidth / 2,
    ledges[2].y - 50,
    `dude-${styleGen.next().value}`
  ));
  player.inputs.left.isDown = true;
  const bot = new Bot(player, gameState, socket);
  bot.target = new Vec2(0,0);
  bots.push(bot);
  return bot;
}

class GuiMgr {
  controllers = [];
  gui = new dat.GUI();
  add(xs) {
    this.controllers = this.controllers.concat(xs);
  }
  clear() {
    if (this.gui) this.gui.destroy();
    this.gui = new dat.GUI();
  }
  refresh() {
    guiMgr.clear();
    const targetPlayerIndex = players.findIndex(p => entToSprite.get(p) == game.camera.target);
    cp.currentPlayer = targetPlayerIndex >= 0 ? targetPlayerIndex : 0;
    refollow();
    guiMgr.add([
      this.gui.add(cp, 'currentPlayer', players.map((p,i) => i)).onFinishChange(() => refollow()),
      this.gui.add(cp, 'makeBot'),
      this.gui.add(cp, 'viewAll').onFinishChange(rescale)
    ]);
  }

}
const guiMgr = new GuiMgr();

function refollow() {
  if (cp.currentPlayer <= players.length) {
    game.camera.follow(entToSprite.get(players[cp.currentPlayer]), Phaser.Camera.FOLLOW_PLATFORMER);
  }
}

let lastParentBounds = null;
function rescale() {
  if (lastParentBounds) {
    const scale = cp.viewAll ?
      Math.min(
        game.width / game.world.width,
        game.height / game.world.height
      ) :
      Math.max(
        game.width / 800,
        game.height / 800
      )
    game.world.scale.set(scale);
  }
}

const doPings = false;
export function main() {
  socket = Sio('http://localhost:3000');
  socket.on('connect', () => {
    if (game) return;

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
        state: {
          onResize: function(scaleMgr, parentBounds) {
            lastParentBounds = parentBounds;
            rescale();
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
