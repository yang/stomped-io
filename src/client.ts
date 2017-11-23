let heavyShim = false;
require('es6-shim');
require('location-origin');
// This is from ES5-DOM-SHIM
if (heavyShim) { require('./a'); }
import * as Bowser from 'bowser';
import {renderSplash, Splash} from "./components";
import * as CBuffer from 'CBuffer';
import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as Common from './common';
import {
  addBody,
  AddEnt,
  assert,
  baseHandler,
  Bcast,
  Block,
  clearArray,
  Dir,
  doLava,
  Ent,
  EntMgr,
  enumerate,
  Event,
  GameState,
  genStyles,
  getDir,
  getLogger,
  InputEvent,
  Lava,
  Ledge,
  now,
  pb,
  Player, playerStyles,
  plPosFromEnt,
  ratio,
  RemEnt,
  runLocally,
  ServerSettings,
  setInputsByDir,
  Star, StartAction,
  StartSmash, StartSpeedup, Stats, StopAction, StopSpeedup,
  Vec2,
  world
} from './common';
import * as _ from 'lodash';
import {loadSprites} from "./spriter";
import * as URLSearchParams from 'url-search-params';

export let browserSupported = function () {
  const hasSvgOuterHtml = (() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGElement;
    return !!svg.outerHTML;
  })();
  return !Bowser.msie && hasSvgOuterHtml;
};

(<any>window).PIXI = require('phaser-ce/build/custom/pixi');
(<any>window).p2 = require('phaser-ce/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser-ce/build/custom/phaser-split');

const Protobuf = require('protobufjs');

const searchParams = new URLSearchParams(window.location.search);
const authKey = searchParams.get('authKey') || '';
export const isDebug = !!searchParams.get('debug');

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

export class ControlPanel {
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
  useKeyboard = true;
  boundCameraWithinWalls = false;
  boundCameraAboveGround = true;
  camWidth = 1200;
  camHeight = 800;
  spectate = false;
  doPings = true;
  doUpdatePl = false;
  smashFrames = 8;
  backToSplash() { backToSplash(); }
  testNotif() { notify('Testing!'); }
}

export let cp = new ControlPanel();
export function setCp(_cp) { cp = _cp; }

export const svrSettings = new ServerSettings();

export const styleGen = genStyles();

export var game, gPool;

export const gameState = new GameState(undefined, destroy2);
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

function preload(sprites) {

  if (!ultraSlim) {
    game.load.image('bg', 'assets/bg.png');
    game.load.image('sky', 'assets/bg-grad.png');
    game.load.image('ground', 'assets/ledge.png');
    game.load.image('star', 'assets/star.png');
    game.load.image('lava', 'assets/lava.png');
    for (let char of Object.keys(sprites)) {
      for (let i = 0; i < sprites[char].length; i++) {
        const variant = sprites[char][i];
        for (let j = 0; j < variant.length; j++) {
          const data = variant[j];
          game.cache.addImage(`dude-${char}-${i}-${j}`, data.src, data);
        }
      }
    }
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

var platforms, starGroup, playerGroup, nameGroup, lavaGroup, activeStarGroup;
var cursors;

var stars;
var score = 0;
export var scoreText, notifText, notifClearer: number;

export var socket;
export var me: Player;

export const players = gameState.players;
const ledges = gameState.ledges;

const timeline = new CBuffer(1024);

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

export const entToSprite = new Map<Ent, any>();
const playerToName = new Map<Player, any>();
const events: Event[] = [];
export let onNextBcastPersistentCallbacks = [];

export let gfx;

(<any>window).dbg = {platforms, cursors, baseHandler, gameWorld: world, players, ledges, entToSprite, Common};

function notify(content: string) {
  notifText.text = content;
  clearTimeout(notifClearer);
  (notifClearer as any) = setTimeout(() => notifText.text = '', 2000);
}

let ptr;

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
  activeStarGroup = game.add.group();

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

  //  Key controls.
  cursors = game.input.keyboard.createCursorKeys();
  for (let keyName of ['left', 'right']) {
    const key = cursors[keyName];
    key.onDown.add(() => cp.useKeyboard && events.push(new InputEvent(inputsToDir())));
    // key.onUp.add(() => cp.useKeyboard && events.push(new InputEvent(inputsToDir())));
  }

  const space = game.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR);
  for (let key of [cursors.down, space]) {
    key.onDown.add(actionButton);
    key.onUp.add(actionRelease);
  }

  game.input.onDown.add(actionButton);
  game.input.onUp.add(actionRelease);

  // Mouse controls.
  game.input.addMoveCallback((_ptr, x: number, y: number, isClick) => {
    // We're manually calculating the mouse pointer position in scaled world coordinates.
    // game.input.worldX doesn't factor in the world scaling.
    // Setting game.input.scale didn't seem to do anything.
    ptr = new Vec2(game.input.x, game.input.y).add(new Vec2(game.camera.x, game.camera.y)).div(game.world.scale.x);

    const dir = ptr.x <= me.x + me.width / 2 ? Dir.Left : Dir.Right;
    if (dir != getDir(me)) {
      setInputsByDir(me, dir);
      socket.emit('input', {time: now(), events: [new InputEvent(me.dir)]});
    }

    // const dx = game.input.mouse.event.movementX;
    // const dy = game.input.mouse.event.movementY;
    // if (this.me) {
    //   this.me.angle += this.dx / 400;
    //   this.me.bod.setAngle(-this.me.angle);
    // }
  }, {});

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
  const ymargin = Math.min(game.camera.height / 2, Math.max(game.camera.height / 3, cp.camHeight / 3));
  game.camera.deadzone = new Phaser.Rectangle(game.camera.width / 2, ymargin, 0, game.camera.height - 2 * ymargin);
};

function errorReload() {
  setTimeout(() => {
    alert("Sorry, there was an unexpected error - reloading....");
    window.location.reload();
  }, 1000);
}

function initEnts() {
  const initSnap = timeline.get(0);

  gameState.time = initSnap.tick * svrSettings.dt;

  if (initSnap.isDiff) {
    errorReload();
    throw new Error(`initSnap isDiff; timeline length is ${timeline.length}; first non-diff is at ${timeline.indexOf(timeline.find(bcast => !bcast.isDiff))}`);
  }

  const {ents} = initSnap;
  try {
    for (let ent of ents) {
      entMgr.addEnt(ent);
    }
  } catch (e) {
    errorReload();
    throw new Error(`initSnap is not a diff but STILL got this error; timeline length is ${timeline.length}; first non-diff is at ${timeline.indexOf(timeline.find(bcast => !bcast.isDiff))}; initSnap has ${initSnap.ents.length} ents, ${initSnap.ents.filter(e => !e.type).length} of which has no type; orig error: ${e}\n${e.stack}`);
  }

  Common.idState.nextId = _.max(getEnts().map(e => e.id)) + 1;

  me = players[players.length - 1];
  const meSprite = entToSprite.get(me);
  follow(meSprite);
  guiMgr.refresh();
}

function inputsToDir() {
  const dir = cursors.left.isDown ? Dir.Left : Dir.Right;
  if (cp.instantTurn && me) {
    me.dir = dir;
  }
  return dir;
}

const timeBuffer = 100;
export let delta = null;

function lerp(a,b,alpha) {
  return a + alpha * (b - a);
}

export function getEnts() {
  return gameState.getEnts();
}

function actionButton() {
  events.push(new StartAction());
}

function actionRelease() {
  events.push(new StopAction());
}

function onEntAdded(ent: Ent) {
  if (ent instanceof Player)
    guiMgr.refresh();
  return mkSpriteForEnt(ent);
}
function mkSpriteForEnt(ent: Ent) {
  function mkSprite(group, spriteArt: string) {
    const [x, y] = ent.dispPos().toTuple();
    const sprite = group.create(x, y, spriteArt);
    // Setting autoCull didn't really help performance that much.
    // sprite.autoCull = true;
    [sprite.width, sprite.height] = ent.dispDims().toTuple();
    entToSprite.set(ent, sprite);
    return sprite;
  }
  if (ent instanceof Player) {
    const sprite = mkSprite(playerGroup, `dude-${ent.style}`);
    sprite.anchor.setTo(.5, .5);
    sprite.animations.add('left', [3,4,3,5], 10, true);
    sprite.animations.add('right', [0,1,0,2], 10, true);
    const style = ent.id == meId ?
      { font: "14px Arial", fill: "#ffff00", stroke: "#ffff44", align: "center", fontWeight: 'bold'} :
      { font: "14px Arial", fill: "#cccccc", stroke: "#cccccc", align: "center"};
    const text = game.add.text(0, 0, ent.name, style, nameGroup);
    text.anchor.x = text.anchor.y = 0.5;
    playerToName.set(ent, text);
    moveName(ent);
    return sprite;
  } else if (ent instanceof Ledge) {
    return mkSprite(platforms, 'ground');
  } else if (ent instanceof Star) {
    const sprite = mkSprite(starGroup, 'star');
    sprite.anchor.setTo(.5, .5);
    return sprite;
  } else if (ent instanceof Block) {
    return mkSprite(platforms, 'ground');
  } else {
    throw new Error();
  }
}

export const entMgr = new EntMgr(world, gameState, onEntAdded);

function consumeStarSprite(sprite) {
  activeStarGroup.add(sprite);
  game.add.tween(sprite.scale).to({
    x: sprite.scale.x * 5,
    y: sprite.scale.y * 5
  }, 400, Phaser.Easing.Quadratic.Out, true);
  game.add.tween(sprite).to({alpha: 0}, 400, Phaser.Easing.Linear.In, true, 300);
}

function tryRemove(id: number, ents: Ent[], instantly = false) {
  const i = _(ents).findIndex((p) => p.id == id);
  if (i >= 0) {
    const ent = ents[i];
    ents.splice(i, 1);
    const sprite = entToSprite.get(ent);
    if (sprite) {
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
      } else if (ent instanceof Star) {
        if (instantly) {
          removeSprite();
        } else {
          consumeStarSprite(sprite);
          setTimeout(() => removeSprite(), 1000);
        }
      } else {
        removeSprite();
      }
      const label = entToLabel.get(ent);
      if (label) label.destroy();
    }
    return ent;
  }
  return null;
}

export function vecStr(v) {
  return JSON.stringify([v.x, v.y]);
}

export const entToLabel = new Map<Ent, any>();

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
  rootComponent.setState({stats: {players: gameState.players.length}});
  rootComponent.show();

  for (let ent of getEnts()) {
    removeEnt(ent.id, true);
  }

  game.paused = true;
  game.input.enabled = false;
  game.canvas.style.display = 'none';
}

let moveName = function (player) {
  const text = playerToName.get(player);
  if (text) {
    text.x = player.midDispPos().x;
    text.y = player.dispPos().y - 16;
  }
  return text;
};

let firstUpdate = true;
let starScale: Vec2;

function update(extraSteps, mkDebugText) {

  if (firstUpdate) {
    firstUpdate = false;
    for (let char of playerStyles) {
      const {width, height} = game.cache.getImage(`dude-${char}-0`);
      const bmd = game.add.bitmapData(6 * width, height);
      for (let i = 0; i < 3; i++) {
        const sprite = game.make.sprite(0, 0, `dude-${char}-${i}`);
        // Need to translate one full image width over to the right from where we expect to draw, since the scale of -1
        // is based around the left of the sprite (and setting anchorX = 0.5 doesn't work).
        bmd.draw(sprite, width * i, 0);
      }
      for (let i = 0; i < 3; i++) {
        const sprite = game.make.sprite(0, 0, `dude-${char}-${i}`);
        // Need to translate one full image width over to the right from where we expect to draw, since the scale of -1
        // is based around the left of the sprite (and setting anchorX = 0.5 doesn't work).
        bmd.copy(sprite, 0, 0, width, height, width * (i + 3 + 1), 0, width, height, 0, 0, 0, -1);
      }
      game.cache.addSpriteSheet(`dude-${char}`, '', bmd.canvas, width, height, 6, 0, 0);
    }

    const starImg = game.cache.getImage('star');
    starScale = new Vec2(Star.width / starImg.width, Star.height / starImg.height);
  }

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
  // We're manually calculating the mouse pointer position in scaled world coordinates.
  // game.input.worldX doesn't factor in the world scaling.
  // Setting game.input.scale didn't seem to do anything.
  // const ptr = new Vec2(game.input.x, game.input.y).add(new Vec2(game.camera.x, game.camera.y)).div(game.world.scale.x);

  const currTime = now();
  // if (delta == null && timeline.length > 0)
  //   delta = timeline[0].time - currTime;
  const targetTime = currTime + delta - timeBuffer;

  if (cp.showDebug) {
    clientState.debugText = `
Total ${players.length} players
${mkScoreText()}

FPS: ${game.time.fps} (msMin=${game.time.msMin}, msMax=${game.time.msMax})
Delta: ${delta}
Mouse: ${ptr && vecStr(ptr)}
Game dims: ${vecStr(new Vec2(game.width, game.height))} 
Scale: ${game.world.scale.x}
Bounds: world ${game.world.bounds.height} camera ${game.camera.bounds.height}

Current player:
Position: ${currentPlayer ? vecStr(currentPlayer.pos()) : ''}
Planck Velocity: ${currentPlayer ? vecStr(currentPlayer.bod.getLinearVelocity()) : ''}
Size: ${currentPlayer ? currentPlayer.size : ''}
Mass: ${currentPlayer ? currentPlayer.bod.getMass() / .1875 : ''}

${mkDebugText(ptr, currentPlayer)}
    `.trim();
    showDebugText();
  }

  let updating = false;

  if (!runLocally) {
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
        't0', timeline.get(0).time,
        't1', timeline.last().time,
        'index', nextBcastIdx,
        'total buffered', timeline.length
      );
    if (nextBcastIdx <= 0) {
      getLogger('timeline').warn('off end of timeline');
      return;
    }
    const nextBcast: Bcast = timeline.get(nextBcastIdx);
    const prevBcast: Bcast = timeline.get(nextBcastIdx - 1);

    // Figure out if we have jumped beyond the newest available bcast.
    // (If we had fallen behind the oldest available bcast, that would have been caught above.)
    if (timeline.first().bcastNum > clientState.lastBcastNum + 1) {
      getLogger('timeline').warn('target bcastNum', clientState.lastBcastNum + 1, 'is older than oldest on timeline,', timeline.first().bcastNum);
    }

    // Catch up on additions/removals
    const toProcess = timeline.filter(bcast =>
      clientState.lastBcastNum < bcast.bcastNum && bcast.bcastNum <= prevBcast.bcastNum
    );
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
            const theEnt = getEnts().find(e => e.id == id);
            assert(theEnt);
            if (theEnt instanceof Player && remEnt.killerId !== null) {
              const killed = players.find(p => p.id == remEnt.id);
              const killer = players.find(p => p.id == remEnt.killerId);
              // TODO working around bug where killer might not be found - not sure how this is possible yet, but Sentry has surfaced it a few times.
              getLogger('kills').log(killer ? killer.describe() : remEnt.killerId, 'killed', killed.describe());
              if (killed == me) {
                if (killer) {
                  notify(`You got stomped by\n${killer.name}!`);
                  setTimeout(() => {
                    cp.currentPlayer = players.indexOf(killer);
                    follow(entToSprite.get(killer));
                  }, 0);
                } else {
                  notify(`You got stomped!`);
                }
                if (!cp.spectate)
                  setTimeout(backToSplash, 2000);
              } else if (killer == me) {
                notify(`You stomped\n${killed.name}!`)
              }
            }
            // Do actual removals after additions (since we may be removing just-added Ents) and after
            // notifications have been displayed.
            later.push(() => removeEnt(id, !remEnt.killerId));
            break;
          case 'StartSmash':
            const startSmash = ev as StartSmash;
            const player = gameState.players.find(p => p.id == startSmash.playerId);
            if (player) player.state = 'startingSmash';
            break;
          case 'StompEv':
            const p = gameState.players.find(p => p.id == ev.playerId);

            if (p) {
              // Can't use particle emitter since it doesn't support delayed fading out.
              for (let i = 0; i < Math.min(ev.count, 30); i++) {
                const dims = p.dispDims();
                const area = new Vec2(dims.x, dims.y / 2);
                const pos = p.dispPos().add(new Vec2(dims.x / 2, 0.75 * dims.y));
                setTimeout(() => {
                  const star = game.add.sprite(pos.x + (Math.random() - .5) * area.x, pos.y + (Math.random() - .5) * area.y, 'star');
                  star.anchor.setTo(.5, .5);
                  star.width = 3 * Star.width;
                  star.height = 3 * Star.height;
                  consumeStarSprite(star);
                  setTimeout(() => star.destroy(), 1000);
                }, 100 / 10 * i);
              }
            }

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
      // Interpolate directly from current client position if last bcast was a diff and therefore doesn't nec. have
      // position info.
      // TODO the lerping is broken here for diffing protocol, since a no longer represents the starting position, but
      // it appears fine / indistinguishable.
      // TODO In fact, should always be able to do this, assuming nothing skipped, but we do currently truncate the
      // timeline aggressively, which should be fixed.
      const [a, b] = [prevBcast.isDiff ? ent : aMap.get(ent.id), bMap.get(ent.id)];
      if (a && b) {
        if (ent instanceof Player) {
          const dir = ((aMap.get(ent.id) || {}) as Player).dir;
          if (_.isNumber(dir) && (ent != me || !cp.instantTurn)) {
            ent.dir = dir;
          }
        }
        if (b.height)
          ent.height = lerp(a.height, b.height, alpha);
        if (b.width)
          ent.width = lerp(a.width, b.width, alpha);
        if (b.x)
          ent.x = lerp(a.x, b.x, alpha);
        if (b.y)
          ent.y = lerp(a.y, b.y, alpha);
        if (b.vel) {
          ent.vel.x = lerp(a.vel.x, b.vel.x, alpha);
          ent.vel.y = lerp(a.vel.y, b.vel.y, alpha);
        }
        if (ent instanceof Player) {
          if ((b as Player).size)
            ent.size = lerp((a as Player).size, (b as Player).size, alpha);
          if ((b as Player).state) {
            const state = (a as Player).state;
            if (state != 'startingSmash')
              ent.state = state;
          }
        }
      }
    }
    for (let player of players) {
      feedInputs(player);
    }

    // For whatever reason, the updateSprite functions were eating up a lot of CPU.  Rather than run it for e.g. every
    // star in existence, limit to just what's visible or almost visible, for a dramatic speedup.
    const padding = 200;
    const possiblyVisible = (ent: Ent) =>
      game.camera.view.left / game.world.scale.x - padding < ent.x && ent.x < game.camera.view.right / game.world.scale.x + padding &&
      game.camera.view.top / game.world.scale.y - padding < ent.y && ent.y < game.camera.view.bottom / game.world.scale.y + padding;
    const updateSpriteAndMaybePlFromEnt = cp.doUpdatePl ? updateSpriteAndPlFromEnt : updateSpriteFromEnt;
    // We must hide the sprites of non-visible (far-off) Ents, or else they just linger in the last place we rendered
    // them.  Also, we should *always* render the current player, since if you switch away from the tab and back later,
    // the Ent may have long exited the visible area.
    for (let ent of getEnts()) {
      let sprite = entToSprite.get(ent);
      if (!(ent instanceof Player || ent instanceof Star) || possiblyVisible(ent) || ent == me) {
        if (!sprite) {
          entToSprite.set(ent, sprite = mkSpriteForEnt(ent));
        }
        updateSpriteAndMaybePlFromEnt(ent);
      } else {
        if (sprite) {
          sprite.destroy();
          entToSprite.delete(ent);
          if (ent instanceof Player) {
            const name = playerToName.get(ent);
            name.destroy();
          }
        }
      }
    }
  }

  extraSteps(currentPlayer, updating, currTime);

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

export function mkScoreText() {
  return `Leaderboard
${_(gameState.players)
    .sortBy([
      p => -p.size,
      p => p.id
    ])
    .map((p, i) => [i,p] as [number, Player])
    .filter(([i, p]) => i < 10 || me == p)
    .map(([i, p]) => `${i + 1}. ${showScore(p)} -- ${p.name} ${p == me ? '<---' : ''}`)
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

export function updateSpriteFromEnt(ent) {
  const sprite = entToSprite.get(ent);
  if (sprite.anchor.x == 0) {
    ({x: sprite.x, y: sprite.y} = ent.dispPos());
  } else {
    ({x: sprite.x, y: sprite.y} = ent.dispPos().add(ent.dispDims().div(2)));
  }
  ({x: sprite.width, y: sprite.height} = ent.dispDims());
  if (!(ent instanceof Player))
    sprite.angle = ent.dispAngle();
}

export function feedInputs(player: Player) {
  const sprite = entToSprite.get(player);
  if (sprite) {
    if (player.dir == Dir.Left) {
      sprite.animations.play('left');
    } else if (player.dir == Dir.Right) {
      sprite.animations.play('right');
    } else {
      //  Stand still
      sprite.animations.stop();
      if (sprite.frame < 3) sprite.frame = 0;
      else sprite.frame = 3;
    }
    // This is our hacky approach to spinning the player.
    if (player.state == 'startingSmash') {
      sprite.angle += 360 / cp.smashFrames;
      if (sprite.angle == 0) {
        player.state = 'normal';
      }
    } else {
      sprite.angle = 0;
    }
  } else {
    // This is part of our hacky approach to spinning the player - if there's no sprite, then don't spin at all!
    player.state = 'normal';
  }
}

let guiMgr;

export function refollow() {
  if (cp.currentPlayer && cp.currentPlayer <= players.length) {
    follow(entToSprite.get(players[cp.currentPlayer]));
  }
}

let lastParentBounds = null;
export function rescale() {
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

export type UpdateExtrasFn = (currentPlayer: Player, updating: boolean, currTime: number) => void;

let meId: number;
function startGame(name: string, char: string, onJoin: (socket) => void, updateExtras: UpdateExtrasFn, mkDebugText, sprites) {
  socket.emit('join', {name, char});

  if (cp.doPings) {
    setInterval(() => {
      socket.emit('ding', {pingTime: now()})
    }, 1000);
  }
  socket.on('dong', ({pingTime}) => getLogger('ping').log('ping', now() - pingTime));

  socket.on('joined', (initSnap, myId) => {
    meId = myId;
    timeline.empty();
    timeline.push(initSnap);
    getLogger('net').log(`joined, timeline length is`, timeline.length);

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
          preload: () => preload(sprites),
          create: function () {
            if (!ultraSlim) {
              this.scale.setResizeCallback(this.onResize, this);
              this.scale.refresh();
            }
            create();
          },
          update: () => update(updateExtras, mkDebugText),
          render: render
        }
      });
    } else {
      game.canvas.style.display = '';
      game.paused = false;
      game.input.enabled = true;
    }

    socket.on('bcast', (bcastData) => {
      const bcast = bcastData.buf ? bcastData : JSON.parse(bcastData);
      const currTime = now();
      getLogger('bcast.data').log(currTime, bcast);
      if (localBcast && bcastBuffer.length == localBcastDur * bcastsPerSec)
        return;
      // TODO: compute delta to be EWMA of the running third-std-dev of recent deltas
      const thisDelta = bcast.time - currTime;
      delta = delta * .9 + thisDelta * (delta == null ? 1 : .1);
      getLogger('bcast').log('time', currTime, 'thisDelta', thisDelta, 'delta', delta, 'length', bcastData.length);
      if (timeline.find(b => b.tick == bcast.tick)) return;
      timeline.push(bcast);
      if (bcast.buf) {
        bcast.ents = pb.Bcast.decode(new Uint8Array(bcast.buf)).ents;
        for (let ent of bcast.ents) {
          if (ent.player) {
            _.assign(ent, ent.player);
            if (_.isBoolean(ent.dirLeft)) {
              ent.dir = ent.dirLeft ? Dir.Left : Dir.Right;
            }
          }
        }
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

    onJoin(socket);
  });

  socket.on('disconnect', () => console.log('disconnect'));
}

let rootComponent;
export let connect = function () {
  const addr = location.origin.replace(/:\d+$/, ':3000');
  const socket = Sio(addr, {query: {authKey}});
  socket.on('svrSettings', (svrData) => {
    svrSettings.deser(svrData);
    guiMgr.refresh();
  });
  return socket;
};

export function main(pool, _guiMgr, onJoin: (socket) => void, updateExtras: UpdateExtrasFn, mkDebugText) {
  getLogger('main').log('starting main');
  guiMgr = _guiMgr;
  gPool = pool;
  const pPb = Protobuf.load('dist/main.proto').then((root) => Common.bootstrapPb(root));
  let sprites;
  const pSprites = browserSupported() ?
    loadSprites().then(s => sprites = s) :
    new Promise(() => null);
  socket = connect();
  let stats: Stats;
  socket.on('stats', (_stats: Stats) => {
    stats = _stats;
    if (rootComponent) {
      rootComponent.setStats(stats);
    }
  });
  let firstSubmitted = false, pRootComponent: Promise<Splash>;
  const pFirstSubmit = new Promise<[string, string]>((resolveSubmit) => {
    pRootComponent = renderSplash({
      browserSupported: browserSupported(),
      stats: stats,
      onSubmit: (name, char) => {
        // OK to resolve multiple times
        resolveSubmit([name, char]);
        // Let Promise.all handle the first one
        if (firstSubmitted) startGame(name, char, onJoin, updateExtras, mkDebugText, sprites);
        firstSubmitted = true;
      },
      shown: !autoStartName
    });
    pRootComponent.then(root => rootComponent = root);
    if (autoStartName) { resolveSubmit([autoStartName, 'white']); }
  });
  Promise.all([pSprites, pRootComponent]).then(([sprites, rootComponent]) =>
    rootComponent.setImgs(sprites)
  );
  const pConnected = new Promise<any>((resolve) => socket.on('connect', resolve));
  Promise.all([pFirstSubmit, pConnected, pPb, pSprites])
    .then(([firstSubmit, connected, pb, _sprites]) => {
      const [name, char] = firstSubmit;
      return startGame(name, char, onJoin, updateExtras, mkDebugText, _sprites);
    });
}