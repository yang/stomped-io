import {renderSplash} from "./components";

(<any>window).PIXI = require('phaser-ce/build/custom/pixi');
(<any>window).p2 = require('phaser-ce/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser-ce/build/custom/phaser-split');

import * as CBuffer from 'CBuffer';
import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as dat from 'dat.gui/build/dat.gui';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  assert, baseHandler,
  Bcast, Block, Bot, BotMgr,
  clearArray,
  cloneWorld,
  copyVec, createBody, defaultColor, deserSimResults, Dir, doLava,
  dt,
  Ent,
  EntMgr,
  entPosFromPl,
  enumerate,
  Event, fixtureDims,
  GameState, genStyles, getDir,
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
  RemEnt, runLocally, ServerSettings, setInputsByDir,
  Star, StartSmash,
  timeWarp, totalSquishTime,
  updateEntPhysFromPl,
  updatePeriod,
  Vec2,
  veq,
  world
} from './common';
import * as _ from 'lodash';
import {Component} from "react";
// import Timer = NodeJS.Timer;

const searchParams = new URLSearchParams(window.location.search);
const authKey = searchParams.get('authKey') || '';
const isDebug = !!searchParams.get('debug');

if (!isDebug) Common.setDoAsserts(false);

// For debugging GPU pressure in WebGL canvas.
let ultraSlim = searchParams.get('ultraSlim');

// For debugging jank when not runLocally.
let localBcast = !!searchParams.get('localBcast');
let localBcastDur = +searchParams.get('localBcastDur') || 5;
let localBcastDisconnects = !!searchParams.get('localBcastDisconnects');
const bcastsPerSec = 20, bcastBuffer = [], bcastPeriodMs = 1000 / bcastsPerSec;
let localBcastIndex = 0;

let autoStartName = searchParams.get('autoStartName');

let renderer = searchParams.get('renderer');

let enabledLogs = (searchParams.get('enabledLogs') || '').split(' ');
for (let x of enabledLogs) { baseHandler.enabled.add(x); }

function selectEnum(value, enumObj, enums) {
  if (value === null || value === undefined) {
    return enums[0];
  } else {
    assert(enums.includes(enumObj[value]));
    return enumObj[value];
  }
}

class ControlPanel {
  currentPlayer = 0;
  viewAll = false;
  // hide latency when turning sprite around
  instantTurn = true;
  drawPlanckBoxes = false;
  showDebug = isDebug;
  doShake = false;
  doBuffer = baseHandler.doBuffer;
  runLocally = runLocally;
  alwaysStep = true;
  showIds = false;
  showScores = !isDebug;
  useKeyboard = false;
  boundCameraWithinWalls = false;
  boundCameraAboveGround = true;
  camWidth = 1200;
  camHeight = 800;
  spectate = false;
  backToSplash() { backToSplash(); }
  testNotif() { notify('Testing!'); }
  makeBot() {
    runLocally ? botMgr.makeBot() : socket.emit('makeBot');
  }
}
const cp = new ControlPanel();

const svrSettings = new ServerSettings();

const styleGen = genStyles();

const timelineLimit = 32;

var game, gPool;

const gameState = new GameState(undefined, destroy2);
gameState.onJumpoff.add((player, other) => {
  const minSize = 10, maxSize = 15, slope = 0.1 / (maxSize - minSize);
  if (cp.doShake) {
    const shake = Math.max(0, Math.min(0.01, slope * (player.size - minSize)));
    if (shake > 0)
      game.camera.shake(shake, 100);
  }

  if (other instanceof Player) {
    // squish the other player's sprite a bit
    other.currentSquishTime = 0;
  }
});

let botMgr;

function preload() {

  if (!ultraSlim) {
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
  } else {
    game.load.image('bg', 'assets/ledge.png');
    game.load.image('sky', 'assets/ledge.png');
    game.load.image('ground', 'assets/ledge.png');
    game.load.image('star', 'assets/ledge.png');
    game.load.image('lava', 'assets/ledge.png');
    game.load.spritesheet('dude-white', 'assets/dude.png', 32, 48);
    game.load.spritesheet('dude-red', 'assets/dude.png', 32, 48);
    game.load.spritesheet('dude-yellow', 'assets/dude.png', 32, 48);
    game.load.spritesheet('dude-green', 'assets/dude.png', 32, 48);
    game.stage.disableVisibilityChange = true;
  }
}

var platforms, starGroup, playerGroup, nameGroup, lavaGroup;
var cursors;

var stars;
var score = 0;
var scoreText, notifText, notifClearer: number;

var socket;
var me: Player;

const players = gameState.players;
const ledges = gameState.ledges;

// const timeline = new CBuffer<Bcast>(8);
const timeline: Bcast[] = [];

// This may get called multiple times on same object in a single frame when multiple entities collide with something.
function destroy2(ent) {
  if (runLocally) {
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
}

const entToSprite = new Map<Ent, any>();
const playerToName = new Map<Player, any>();
const events: Event[] = [];
let onNextBcastPersistentCallbacks = [];

let gfx;

(<any>window).dbg = {platforms, cursors, baseHandler, gameWorld: world, players, ledges, entToSprite, Common};

function notify(content: string) {
  notifText.text = content;
  clearTimeout(notifClearer);
  (notifClearer as any) = setTimeout(() => notifText.text = '', 2000);
}

function create() {

  game.world.setBounds(-Common.gameWorld.width,0,3 * Common.gameWorld.width, Common.gameWorld.height);
  game.time.advancedTiming = true;

  gfx = game.add.graphics(0,0);
  gfx.lineStyle(1,0x0088FF,1);

  //  A simple background for our game
  if (!ultraSlim) {
    const sky = game.add.sprite(0, 0, 'sky');
    sky.width = Common.gameWorld.width;

    const bg = game.add.tileSprite(0, 0, Common.gameWorld.width, Common.gameWorld.height, 'bg');
    bg.tileScale.x = 1 / 4;
    bg.tileScale.y = 1 / 4;
    bg.alpha = .05
  }

  // Specify the z-order via groups
  starGroup = game.add.group();
  platforms = game.add.group();
  playerGroup = game.add.group();
  nameGroup = game.add.group();
  lavaGroup = game.add.group();

  const lava = new Lava(0, Common.gameWorld.height - 64);
  addBody(lava, 'kinematic');
  gameState.lava = lava;
  const lavaSprite = lavaGroup.create(-Common.gameWorld.width, Common.gameWorld.height - 64, doLava ? 'lava' : 'ground');
  entToSprite.set(lava, lavaSprite);
  lavaSprite.width = 3 * lava.width;
  lavaSprite.height = lava.height;

  Common.create(gameState);

  //  The score
  scoreText = game.add.text(16, 16, '', { fontSize: '12px', fill: '#fff' });
  scoreText.fixedToCamera = true;
  scoreText.cameraOffset.setTo(16,16);
  scoreText.lineSpacing = -2;

  //  Our controls.
  cursors = game.input.keyboard.createCursorKeys();
  for (let keyName of ['left', 'down', 'right', 'up']) {
    const key = cursors[keyName];
    key.onDown.add(() => cp.useKeyboard && events.push(new InputEvent(updateInputs())));
    key.onUp.add(() => cp.useKeyboard && events.push(new InputEvent(updateInputs())));
  }

  game.input.onDown.add(startSmash);

  // The notification banner
  notifText = game.add.text(16, 16, '', { fontSize: '48px', fill: '#fff', align: 'center', boundsAlignH: "center", boundsAlignV: "middle" });
  notifText.fixedToCamera = true;
  notifText.cameraOffset.setTo(16,16);
  notifText.lineSpacing = -2;
  notifText.setTextBounds(0,0,cp.camWidth,600);
  notifText.setShadow(4,4,'#000',4);
}

let follow = function (sprite: any) {
  game.camera.follow(sprite, Phaser.Camera.FOLLOW_PLATFORMER);
  const zone = game.camera.deadzone;
  game.camera.deadzone = new Phaser.Rectangle(game.camera.width / 2, zone.y, 0, zone.height);
};

function initEnts() {
  const initSnap = timeline[0];

  gameState.time = initSnap.tick * dt;

  const {ents} = initSnap;
  for (let ent of ents) {
    entMgr.addEnt(ent);
  }

  Common.idState.nextId = _.max(getEnts().map(e => e.id)) + 1;

  me = players[players.length - 1];
  const meSprite = entToSprite.get(me);
  follow(meSprite);
  guiMgr.refresh();
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

function startSmash() {
  events.push(new StartSmash(me.id));
}

function onEntAdded(ent: Ent) {
  function mkSprite(group, spriteArt: string) {
    const [x, y] = ent.dispPos().toTuple();
    const sprite = group.create(x, y, spriteArt);
    [sprite.width, sprite.height] = ent.dispDims().toTuple();
    entToSprite.set(ent, sprite);
    return sprite;
  }
  if (ent instanceof Player) {
    const sprite = mkSprite(playerGroup, `dude-${ent.style}`);
    // [sprite.anchor.x, sprite.anchor.y] = [.5, .5];
    sprite.anchor.setTo(.5, .5);
    sprite.animations.add('left', [3, 4, 3, 5], 10, true);
    sprite.animations.add('right', [0, 1, 0, 2], 10, true);
    const style = { font: "12px Arial", fill: "#cccccc", align: "center"};
    const text = game.add.text(0, 0, ent.name, style, nameGroup);
    text.anchor.x = text.anchor.y = 0.5;
    playerToName.set(ent, text);
    moveName(ent);
    guiMgr.refresh();
  } else if (ent instanceof Ledge) {
    mkSprite(platforms, 'ground');
  } else if (ent instanceof Star) {
    mkSprite(starGroup, 'star');
  } else if (ent instanceof Block) {
    mkSprite(platforms, 'ground');
  } else {
    throw new Error();
  }
}

const entMgr = new EntMgr(world, gameState, onEntAdded);

function tryRemove(id: number, ents: Ent[], instantly = false) {
  const i = _(ents).findIndex((p) => p.id == id);
  if (i >= 0) {
    const ent = ents[i];
    ents.splice(i, 1);
    const sprite = entToSprite.get(ent);
    const removeSprite = () => {
      sprite.destroy();
      entToSprite.delete(ent);
    };
    if (ent instanceof Player) {
      const squishHeight = sprite.height / 5;
      sprite.y += sprite.height - squishHeight;
      sprite.x -= sprite.width / 2;
      sprite.height = squishHeight;
      sprite.width *= 2;
      let removeSpriteAndName = function () {
        removeSprite();
        playerToName.get(ent).destroy();
        playerToName.delete(ent);
      };
      if (instantly)
        removeSpriteAndName();
      else
        setTimeout(() => {
          removeSpriteAndName();
        }, 2000);
    } else {
      removeSprite();
    }
    const label = entToLabel.get(ent);
    if (label) label.destroy();
    return ent;
  }
  return null;
}

function vecStr(v) {
  return JSON.stringify([v.x, v.y]);
}

const entToLabel = new Map<Ent, any>();

class ClientState {
  lastBcastNum = 0;
  debugText = '';
  name = '';
}

const clientState = new ClientState();


let showDebugText = function () {
  for (let [i, line] of enumerate(clientState.debugText.split('\n'))) {
    game.debug.text(line, 2, 14 * (i + 1), "#00ff00");
  }
};

function removeEnt(id: number, instantly = false) {
  tryRemove(id, players, instantly);
  tryRemove(id, ledges, instantly);
  tryRemove(id, gameState.stars, instantly);
  tryRemove(id, gameState.blocks, instantly);
}

function backToSplash() {
  rootComponent.show();

  for (let ent of getEnts()) {
    removeEnt(ent.id, true);
  }

  game.paused = true;
  game.canvas.style.display = 'none';
}

let moveName = function (player) {
  const text = playerToName.get(player);
  text.x = player.midDispPos().x;
  text.y = player.y - 16;
  return text;
};

function update() {

  // Phaser stupidly grows game.world.bounds to at least cover game.width/.height
  // (which I understand as the canvas size) even if world is scaled.
  // This in turn propagates - repeatedly - to game.camera.bounds, so I have to keep reminding
  // Phaser to properly bound the camera every step - simply doing so in
  // create()/rescale()/onResize() doesn't work.
  //
  // Understanding zooming and the camera and scaling systems in Phaser is very confusing.
  game.camera.bounds.width = (cp.boundCameraWithinWalls ? 1 : 3) * Common.gameWorld.width;
  game.camera.bounds.x = cp.boundCameraWithinWalls ? 0 : -Common.gameWorld.width;
  game.camera.bounds.height = cp.boundCameraAboveGround ? Common.gameWorld.height : game.world.height;

  if (gameState.players.length == 0)
    initEnts();

  if (rootComponent.state.shown) {
    rootComponent.hide();
  }

  const currentPlayer = cp.currentPlayer ? players[cp.currentPlayer] : null;
  const bot = botMgr.bots.find(b => b.player == currentPlayer);
  // We're manually calculating the mouse pointer position in scaled world coordinates.
  // game.input.worldX doesn't factor in the world scaling.
  // Setting game.input.scale didn't seem to do anything.
  const ptr = new Vec2(game.input.x, game.input.y).add(new Vec2(game.camera.x, game.camera.y)).div(game.world.scale.x);

  const currTime = now();
  // if (delta == null && timeline.length > 0)
  //   delta = timeline[0].time - currTime;
  const targetTime = currTime + delta - timeBuffer;

  if (cp.showDebug) {
    clientState.debugText = `
FPS: ${game.time.fps} (msMin=${game.time.msMin}, msMax=${game.time.msMax})
${players.length} players
Delta: ${delta}
Mouse: ${vecStr(ptr)}
Game dims: ${vecStr(new Vec2(game.width, game.height))} 
Scale: ${game.world.scale.x}
Bounds: world ${game.world.bounds.height} camera ${game.camera.bounds.height}

Current player:
Position: ${currentPlayer ? vecStr(currentPlayer.pos()) : ''}
Planck Velocity: ${currentPlayer ? vecStr(currentPlayer.bod.getLinearVelocity()) : ''}
Target: ${bot && bot.target ? vecStr(bot.target) : ''}
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
Total ${players.length} players

${mkScoreText()}
    `.trim();
    showDebugText();
  }

  const dir = ptr.x <= me.x + me.width / 2 ? Dir.Left : Dir.Right;
  if (!cp.useKeyboard && dir != getDir(me)) {
    setInputsByDir(me, dir);
    socket.emit('input', {time: currTime, events: [new InputEvent(me.inputs)]});
  }

  let updating = false;

  if (runLocally) {
    updating = cp.alwaysStep || currTime - lastTime >= updatePeriod * 1000;
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
    if (timeline.length > 0)
      getLogger('timeline').log(
        'time', currTime,
        'delta', delta,
        'targetTime', targetTime,
        't0', timeline[0].time,
        't1', _(timeline).last().time
      );
    if (nextBcastIdx <= 0) {
      console.warn('off end of timeline');
      return;
    }
    const nextBcast = timeline[nextBcastIdx];
    const prevBcast = timeline[nextBcastIdx - 1];

    // Catch up on additions/removals
    if (!timeline.find(bcast => bcast.bcastNum == clientState.lastBcastNum + 1)) {
      console.warn('skipped over bcastNum', clientState.lastBcastNum + 1, '- no longer on timeline, smallest kept is', timeline[0].bcastNum);
    }
    const toProcess = timeline.filter(bcast =>
      clientState.lastBcastNum < bcast.bcastNum && bcast.bcastNum <= prevBcast.bcastNum
    )
    const later = [];
    for (let bcast of toProcess) {
      for (let ev of bcast.events) {
        switch (ev.type) {
          case 'AddEnt':
            const ent: Ent = (<AddEnt>ev).ent;
            entMgr.addEnt(ent);
            break;
          case 'RemEnt':
            const remEnt = ev as RemEnt;
            const id = remEnt.id;
            assert(getEnts().find(e => e.id == id));
            if (remEnt.killerId !== null) {
              const killed = players.find(p => p.id == remEnt.id);
              const killer = players.find(p => p.id == remEnt.killerId);
              console.log(killer.describe(), 'killed', killed.describe());
              if (killed == me) {
                notify(`You got stomped by ${killer.name}!`);
                setTimeout(() => {
                  cp.currentPlayer = players.indexOf(killer);
                  follow(entToSprite.get(killer));
                }, 0);
                if (!cp.spectate)
                  setTimeout(backToSplash, 2000);
              } else if (killer == me) {
                notify(`You stomped ${killed.name}!`)
              }
            }
            // Do actual removals after additions (since we may be removing just-added Ents) and after
            // notifications have been displayed.
            later.push(() => removeEnt(id));
            break;
          case 'StartSmash':
            const startSmash = ev as StartSmash;
            const player = gameState.players.find(p => p.id == startSmash.playerId);
            player.state = 'startingSmash';
            // const sprite = entToSprite.get(player);
            // game.timer.add(200, () => sprite.state = 'normal');
            break;
        }
      }
    }
    later.forEach(f => f());
    clientState.lastBcastNum = prevBcast.bcastNum;

    const alpha = (targetTime - prevBcast.time) / (nextBcast.time - prevBcast.time);

    const aMap = new Map(prevBcast.ents.map<[number, Ent]>((p) => [p.id, p]));
    const bMap = new Map(nextBcast.ents.map<[number, Ent]>((p) => [p.id, p]));
    onNextBcastPersistentCallbacks = onNextBcastPersistentCallbacks.filter(f => !f());
    for (let ent of getEnts()) {
      const [a, b] = [aMap.get(ent.id), bMap.get(ent.id)];
      if (a && b) {
        if (ent instanceof Player) {
          if (ent != me || !cp.instantTurn) {
            ent.inputs = (<Player>a).inputs;
          }
        }
        ent.height = lerp(a.height, b.height, alpha);
        ent.width = lerp(a.width, b.width, alpha);
        ent.x = lerp(a.x, b.x, alpha);
        ent.y = lerp(a.y, b.y, alpha);
        ent.vel.x = lerp(a.vel.x, b.vel.x, alpha);
        ent.vel.y = lerp(a.vel.y, b.vel.y, alpha);
        if (ent instanceof Player) {
          ent.size = lerp((a as Player).size, (b as Player).size, alpha);
          const state = (a as Player).state;
          if (state != 'startingSmash')
            ent.state = state;
        }
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
      bot.isDumb ? bot.dumbPlan() : bot.replayPlan(updating, currTime);
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

  if (cp.showIds) {
    const style = { font: "12px Arial", fill: "#ff0044", wordWrap: true, align: "center"};
    for (let ent of getEnts()) {
      let label = entToLabel.get(ent);
      if (!label) {
        entToLabel.set(ent, label = game.add.text(ent.x, ent.y, ""+ent.id, style));
      }
      [label.x, label.y] = [ent.x, ent.y];
    }
  }

  for (let player of players) {
    const text = moveName(player);
  }

  if (cp.showScores) {
    scoreText.text = mkScoreText();
  }

  const endTime = now();
  getLogger('client-jank').log('start', currTime, 'end', endTime, 'elapsed', endTime - currTime);
}

function showScore(player: Player) {
  return Math.round(10 * player.size);
}

function mkScoreText() {
  return `Leaderboard
${_(gameState.players)
    .sortBy([
      p => -p.size,
      p => p.name
    ])
    .filter((p, i) => i < 10 || me == p)
    .map((p, i) => `${i + 1}. ${showScore(p)} -- ${p.name} ${p == me ? '<---' : ''}`)
    .join('\n')}`;
};

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
  if (sprite.anchor.x == 0) {
    [sprite.x, sprite.y] = ent.dispPos().toTuple();
  } else {
    [sprite.x, sprite.y] = ent.dispPos().add(ent.dispDims().div(2)).toTuple();
  }
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
  if (player.state == 'startingSmash') {
    sprite.angle += 360 / 8;
    if (sprite.angle == 0) {
      player.state = 'normal';
    }
  } else {
    sprite.angle = 0;
  }
}

class GuiMgr {
  gui = isDebug ? new dat.GUI() : null;
  cliControllers = [];
  cliOpts;
  svrOpts;
  constructor() {
    if (!isDebug) return;
    this.cliOpts = this.gui.addFolder('Client');
    this.svrOpts = this.gui.addFolder('Server');
    this.cliOpts.open();
    this.svrOpts.open();
    const svrOpts = this.svrOpts;
    const svrControllers = [
      svrOpts.add(svrSettings, 'accel'),
      svrOpts.add(svrSettings, 'doOsc'),
      svrOpts.add(svrSettings, 'oscDist'),
      svrOpts.add(svrSettings, 'smashSpeed'),
      svrOpts.add(svrSettings, 'maxFallSpeed'),
      svrOpts.add(svrSettings, 'oneWayLedges')
    ];
    const uploadSettings = () => socket.emit('svrSettings', svrSettings.ser());
    for (let c of svrControllers) {
      c.onFinishChange(uploadSettings);
    }
  }
  private clear() {
    this.cliControllers.forEach(c => this.cliOpts.remove(c));
    clearArray(this.cliControllers);
    // if (this.gui) this.gui.destroy();
    // this.gui = new dat.GUI();
  }
  refresh() {
    if (!isDebug) return;
    this.clear();
    const targetPlayerIndex = players.findIndex(p => entToSprite.get(p) == game.camera.target);
    cp.currentPlayer = targetPlayerIndex >= 0 ? targetPlayerIndex : null;
    refollow();

    const cliOpts = this.cliOpts;
    this.cliControllers = [
      cliOpts.add(cp, 'currentPlayer', players.map((p,i) => i)).onFinishChange(() => refollow()),
      cliOpts.add(cp, 'runLocally').onFinishChange(() => Common.setRunLocally(cp.runLocally)),
      cliOpts.add(cp, 'makeBot'),
      cliOpts.add(cp, 'viewAll').onFinishChange(rescale),
      cliOpts.add(cp, 'instantTurn'),
      cliOpts.add(cp, 'drawPlanckBoxes'),
      cliOpts.add(cp, 'doShake'),
      cliOpts.add(cp, 'alwaysStep'),
      cliOpts.add(cp, 'testNotif'),
      cliOpts.add(cp, 'boundCameraWithinWalls'),
      cliOpts.add(cp, 'useKeyboard'),
      cliOpts.add(cp, 'camWidth').onFinishChange(rescale),
      cliOpts.add(cp, 'camHeight').onFinishChange(rescale),
      cliOpts.add(cp, 'spectate'),
      cliOpts.add(cp, 'backToSplash'),
      cliOpts.add(cp, 'boundCameraAboveGround'),
      cliOpts.add(cp, 'showScores').onFinishChange(() => scoreText.text = ''),
      cliOpts.add(cp, 'showIds').onFinishChange(() =>
        cp.showIds ? 0 : Array.from(entToLabel.values()).map(t => t.destroy())),
      cliOpts.add(cp, 'doBuffer').onFinishChange(() => baseHandler.doBuffer = cp.doBuffer),
      cliOpts.add(cp, 'showDebug').onFinishChange(() => cp.showDebug ? 0 : game.debug.reset())
      ];
  }

}
const guiMgr = new GuiMgr();

function refollow() {
  if (cp.currentPlayer && cp.currentPlayer <= players.length) {
    follow(entToSprite.get(players[cp.currentPlayer]));
  }
}

let lastParentBounds = null;
function rescale() {
  if (lastParentBounds) {
    // Main job is to ensure, in normal non-viewAll mode, that we scale the world up or down enough
    // such that the viewport covers 800 logical pixels, either in the horizontal or vertical direction,
    // whichever one is longer.  Thus we are OK truncating the shorter dimension.
    //
    // This is done by scaling to max(width / 800, height / 800).  Consider some examples:
    //
    // - width = 800 means no scaling.
    // - width = 400 means shrink to half size.
    // - width = 1600 means doubling size.
    // - width = 800, height = 400 means no scaling.
    const scale = cp.viewAll ?
      Math.min(
        game.width / game.world.width,
        game.height / game.world.height
      ) :
      Math.max(
        game.width / cp.camWidth,
        game.height / cp.camHeight
      )
    game.world.scale.set(scale);
  }
}

function render() {
  if (cp.showDebug)
    showDebugText();
}

function startGame(name: string, char: string) {
  socket.emit('join', {name, char});

  if (doPings) {
    setInterval(() => {
      console.log('pinging');
      socket.emit('ding', {pingTime: now()})
    }, 1000);
  }
  socket.on('dong', ({pingTime}) => console.log('ping', now() - pingTime));

  socket.on('joined', (initSnap) => {
    clearArray(timeline);
    timeline.push(initSnap);

    if (!game) {
      game = new Phaser.Game({
        scaleMode: ultraSlim ? undefined : Phaser.ScaleManager.RESIZE,
        renderer: selectEnum(renderer, Phaser, [Phaser.CANVAS, Phaser.AUTO, Phaser.WEBGL]),
        state: {
          onResize: function (scaleMgr, parentBounds) {
            lastParentBounds = parentBounds;
            rescale();
            // This is needed to keep the camera on the player. Camera doesn't register game rescales.
            follow(entToSprite.get(me));
          },
          preload: preload,
          create: function () {
            if (!ultraSlim) {
              this.scale.setResizeCallback(this.onResize, this);
              this.scale.refresh();
            }
            create();
          },
          update: update,
          render: render
        }
      });
    } else {
      game.canvas.style.display = '';
      game.paused = false;
    }

    // setTimeout((() => botMgr.makeBot()), 3000);

    socket.on('bcast', (bcast) => {
      const currTime = now();
      getLogger('bcast.data').log(currTime, bcast);
      if (localBcast && bcastBuffer.length == localBcastDur * bcastsPerSec)
        return;
      // TODO: compute delta to be EWMA of the running third-std-dev of recent deltas
      const thisDelta = bcast.time - currTime;
      delta = delta * .9 + thisDelta * (delta == null ? 1 : .1);
      getLogger('bcast').log('time', currTime, 'thisDelta', thisDelta, 'delta', delta);
      if (timeline.find(b => b.tick == bcast.tick)) return;
      timeline.push(bcast);
      if (timeline.length > timelineLimit) {
        timeline.shift();
      }
      if (localBcast) {
        bcastBuffer.push(bcast);
        if (bcastBuffer.length == localBcastDur * bcastsPerSec) {
          if (localBcastDisconnects) socket.disconnect();
          setInterval(() => {
            const bcast = bcastBuffer[localBcastIndex];
            bcast.time = now() + delta;
            timeline.push(bcast);
            localBcastIndex = (localBcastIndex + 1) % bcastBuffer.length;
            timeline.shift();
          }, bcastPeriodMs);
        }
      }
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
}

const doPings = false;
let rootComponent;
export function main(pool) {
  gPool = pool;
  socket = Sio(location.origin.replace(':8000', '') + ':3000', {query: {authKey}});
  socket.on('svrSettings', (svrData) => {
    svrSettings.deser(svrData);
    guiMgr.refresh();
  });
  botMgr = new BotMgr(styleGen, entMgr, gameState, socket, gPool, null);
  let firstSubmitted = false;
  const pFirstSubmit = new Promise<[string, string]>((resolveSubmit) => {
    renderSplash({
      onSubmit: (name, char) => {
        // OK to resolve multiple times
        resolveSubmit([name, char]);
        // Let Promise.all handle the first one
        if (firstSubmitted) startGame(name, char);
        firstSubmitted = true;
      },
      shown: !autoStartName
    }).then(root => rootComponent = root);
    if (autoStartName) { resolveSubmit([autoStartName, 'white']); }
  });
  const pConnected = new Promise<any>((resolve) => socket.on('connect', resolve));
  Promise.all([pFirstSubmit, pConnected])
    .then(([firstSubmit, _]) => {
      const [name, char] = firstSubmit;
      return startGame(name, char);
    });
}