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
  assert, baseHandler,
  Bcast, Bot, BotMgr,
  clearArray,
  cloneWorld,
  copyVec, createBody, defaultColor, deserSimResults, doLava,
  dt,
  Ent,
  EntMgr,
  entPosFromPl,
  enumerate,
  Event, fixtureDims,
  GameState, genStyles,
  getLogger,
  InputEvent, Inputs,
  iterBodies,
  iterFixtures,
  Lava,
  Ledge,
  ledgeHeight,
  ledgeWidth, now,
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

class ControlPanel {
  currentPlayer = 0;
  viewAll = false;
  // hide latency when turning sprite around
  instantTurn = true;
  drawPlanckBoxes = false;
  showDebug = true;
  makeBot() { runLocally ? botMgr.makeBot() : socket.emit('makeBot'); }
}
const cp = new ControlPanel();

const styleGen = genStyles();

var game, gPool;

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

let botMgr;

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
let onNextBcastPersistentCallbacks = [];

let gfx;

(<any>window).dbg = {platforms, cursors, baseHandler, gameWorld: world, players, ledges, entToSprite, Common};

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
  const lavaSprite = game.add.sprite(0, Common.gameWorld.height - 64, doLava ? 'lava' : 'ground');
  entToSprite.set(lava, lavaSprite);
  lavaSprite.width = lava.width;
  lavaSprite.height = lava.height;

  Common.create(gameState);

  //  The platforms group contains the ground and the 2 ledges we can jump on
  platforms = game.add.group();

  const {ents} = initSnap;
  for (let ent of ents) {
    entMgr.addEnt(ent);
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

  Common.idState.nextId = _.max(getEnts().map(e => e.id)) + 1;

}

function trace(x) {
  console.log(x);
  return x;
}

function updateInputs() {
  const inputs = new Inputs();
  inputs.left.isDown = cursors.left.isDown;
  inputs.right.isDown = cursors.right.isDown;
  inputs.down.isDown = cursors.down.isDown;
  inputs.up.isDown = cursors.up.isDown;
  if (cp.instantTurn) {
    me.inputs = inputs;
  }
  return inputs;
}

let lastTime = 0;

const timeBuffer = 100;
let delta = null;

function lerp(a,b,alpha) {
  return a + alpha * (b - a);
}

function getEnts() {
  return gameState.getEnts();
}

function onEntAdded(ent: Ent) {
  function mkSprite(spriteArt: string) {
    const [x, y] = ent.dispPos().toTuple();
    const sprite = game.add.sprite(x, y, spriteArt);
    [sprite.width, sprite.height] = ent.dispDims().toTuple();
    entToSprite.set(ent, sprite);
    return sprite;
  }
  if (ent instanceof Player) {
    const sprite = mkSprite(`dude-${styleGen.next().value}`);
    sprite.animations.add('left', [3, 4, 3, 5], 10, true);
    sprite.animations.add('right', [0, 1, 0, 2], 10, true);
    guiMgr.refresh();
  } else if (ent instanceof Ledge) {
    mkSprite('ground');
  } else if (ent instanceof Star) {
    mkSprite('star');
  }
}

const entMgr = new EntMgr(world, gameState, onEntAdded);

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
  const bot = botMgr.bots.find(b => b.player == currentPlayer);

  const currTime = now();
  // if (delta == null && timeline.length > 0)
  //   delta = timeline[0].time - currTime;
  const targetTime = currTime + delta - timeBuffer;

  if (cp.showDebug) {
    const debugText = `
  FPS: ${game.time.fps} (msMin=${game.time.msMin}, msMax=${game.time.msMax})
  ${players.length} players
  
  Current player:
  Velocity: ${currentPlayer ? vecStr(currentPlayer.bod.getLinearVelocity()) : ''}
  Target: ${bot ? vecStr(bot.target) : ''}
  Size: ${currentPlayer ? currentPlayer.size : ''}
  Mass: ${currentPlayer ? currentPlayer.bod.getMass() / .1875 : ''}
  Step: ${bot ?
      `${bot.chunkSteps} total ${bot.lastBestSeq ?
        JSON.stringify((([chunk, index, steps]) =>
            _(chunk)
              .pick('startTime', 'endTime', 'dur')
              .extend({index, steps})
              .value())(bot.getCurrChunk(-1))) : ''
        }` : ''}
  
  Scores:
  ${_(players)
      .sort(p => -p.size)
      .map(p => `${p.size} ${p.name}`)
      .join('\n')}
    `.trim();
    for (let [i, line] of enumerate(debugText.split('\n'))) {
      game.debug.text(line, 2, 14 * (i + 1), "#00ff00");
    }
  }

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
          entMgr.addEnt(ent);
          break;
        case 'RemEnt':
          const id = (<RemEnt>ev).id;
          tryRemove(id, players);
          tryRemove(id, ledges);
          tryRemove(id, gameState.stars);
          break;
      }
    }
    onNextBcastPersistentCallbacks = onNextBcastPersistentCallbacks.filter(f => !f());
    for (let ent of getEnts()) {
      const [a, b] = [aMap.get(ent.id), bMap.get(ent.id)];
      if (a && b) {
        if (!cp.instantTurn && ent instanceof Player && a.type == 'Player') {
          ent.inputs = (<Player>a).inputs;
        }
        ent.height = lerp(a.height, b.height, alpha);
        ent.width = lerp(a.width, b.width, alpha);
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
  if (cp.drawPlanckBoxes) {
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
  if (runLocally) {
    for (let bot of botMgr.bots) {
      bot.replayPlan(updating, currTime);
    }
  }
  for (let bot of botMgr.bots) {
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
    for (let bot of botMgr.bots) {
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
      this.gui.add(cp, 'viewAll').onFinishChange(rescale),
      this.gui.add(cp, 'instantTurn'),
      this.gui.add(cp, 'drawPlanckBoxes'),
      this.gui.add(cp, 'showDebug').onFinishChange(() => cp.showDebug ? 0 : game.debug.reset())
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
export function main(pool) {
  gPool = pool;
  socket = Sio('http://localhost:3000');
  botMgr = new BotMgr(styleGen, entMgr, gameState, socket, gPool);
  socket.on('connect', () => {
    if (game) return;

    console.log('connect')

    socket.emit('join', {name: 'z'});

    if (doPings) {
      setInterval(() => {
        console.log('pinging');
        socket.emit('ding', {pingTime: now()})
      }, 1000);
    }
    socket.on('dong', ({pingTime}) => console.log('ping', now() - pingTime));

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
      delta = initSnap.time - now();

      // setTimeout((() => botMgr.makeBot()), 3000);

      socket.on('bcast', (bcast) => {
        timeline.push(bcast);
      });

      socket.on('botProxy', (botData) => {
        onNextBcastPersistentCallbacks.push(() => botMgr.maybeAddProxy(botData));
      });

      socket.on('botPlan', ({botData, bestWorldStateIndex, bestPath, worldStatesData}) => {
        onNextBcastPersistentCallbacks.push(() => {
          const bot = botMgr.bots.find(b => b.player.id == botData.playerId);
          if (bot) {
            const {worldStates, bestPath: realBestPath, bestWorldState} = deserSimResults({
              bestWorldStateIndex,
              bestPath,
              worldStatesData
            });
            bot.deser(botData);
            bot.lastWorldStates = worldStates;
            bot.lastBestSeq = realBestPath.map(([ws, dir]) => ws).concat([bestWorldState]);
            return true;
          } else {
            return false;
          }
        });
      });
    });

    socket.on('disconnect', () => console.log('disconnect'));
  });
}
