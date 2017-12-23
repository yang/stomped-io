let heavyShim = false;
require('es6-shim');
require('es7-shim');
require('location-origin');
import {UpUp} from './upup';
import 'clipboard';
import 'whatwg-fetch';
import fscreen from 'fscreen';
import * as Bowser from 'bowser';
import {inIframe, PlayerStats, renderSplash, Splash} from "./components";
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
  GameState, gameWorld,
  genStyles,
  getDir,
  getLogger,
  InputEvent,
  Lava,
  Ledge,
  LoadedCode,
  now,
  pb,
  Player,
  playerStyles,
  plPosFromEnt,
  ratio,
  RemEnt,
  runLocally,
  ServerSettings,
  setInputsByDir,
  Star,
  StartAction,
  StartSmash,
  Stats,
  StopAction,
  Vec2,
  world
} from './common';
import * as _ from 'lodash';
import {charVariants, loadSprites} from "./spriter";
import * as URLSearchParams from 'url-search-params';
import * as Cookies from 'js-cookie';
// This is from ES5-DOM-SHIM
if (heavyShim) { require('./a'); }

if (UpUp) {
  UpUp.debug(true);
  UpUp.start({
    'cache-version': 'v4',
    'content-url': 'offline.html', // show this page to offline users
    'assets': ['assets/main.css']
  });
}

export const loadedCode = require('./dyn');

export let browserSupported = function () {
  const hasSvgOuterHtml = (() => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGElement;
    return !!svg.outerHTML;
  })();
  return !Bowser.msie && hasSvgOuterHtml;
};

function addslashes( str ) {
  return (str + '').replace(/[\\"']/g, '\\$&').replace(/\u0000/g, '\\0');
}

const adPlaceholder = addslashes(`
<div class="right-ad-default">
<p>Servers are expensive!  :(</p>

<p>Please support this game by disabling your ad blocker for this site.</p>

<p>(Playing in an incognito window might work.)</p>

<p>Thank you, I really appreciate it!</p>

<p>— The Developer</p>
</div>
`).replace(/\n/g, '\\n');
document.writeln(`
<script src="//api.adinplay.com/display/pub/STM/stomped.io/display.min.js"></script>
<div class="right-ad">
    <div id='stomped-io_300x250'>
        <script type='text/javascript'>
          if (window.aipDisplayTag) {
            aipDisplayTag.display('stomped-io_300x250');
            aipDisplayTag.refresh('stomped-io_300x250');
          }
        </script>
    </div>
</div>
<script type="text/javascript" src='advertisement.js'></script>
<script>
if (!document.getElementById('ads'))
  document.writeln('${adPlaceholder}');
</script>
`);

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

// Ultimately this doesn't seem to be 100% reliably working, so relying on reload when hitting bug in spriter.
//
// https://madhatted.com/2013/6/16/you-do-not-understand-browser-history
// https://stackoverflow.com/questions/33860241/safari-back-button-doesnt-reload-page-when-used
// https://stackoverflow.com/questions/11979156/mobile-safari-back-button
// https://stackoverflow.com/questions/24524248/how-to-prevent-reloading-of-web-page-from-cache-while-using-mobile-safari-browse
function disableBfCache() {
  // Apparently has not worked since iOS5
  +window.addEventListener('unload', function () {});
  // Apparently not working in recent iOS
  window.addEventListener("pageshow", function(evt){
    if(evt.persisted){
      setTimeout(function(){
        window.location.reload();
      },10);
      window.location.reload();
    }
  }, false);
  window.addEventListener('pagehide', function(e) {
    // wait for this callback to finish executing and then...
    setTimeout(function() {
      document.body.innerHTML = ("<script type='text/javascript'>window.location.reload();<\/script>");
    });
  });
  // TODO also capture popstate.
}

disableBfCache();

const ga = (window as any).ga;
let deferredPrompt;
// From https://medium.com/dev-channel/tracking-pwa-events-with-google-analytics-3b50030d8922
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();

  // Stash the event so it can be triggered later.
  deferredPrompt = e;

  return false;
});

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
  doPings = false;
  doUpdatePl = false;
  smashFrames = 8;
  resetCookies() { Cookies.remove('v1'); }
  backToSplash() { backToSplash(); }
  testNotif() { notify('Testing!'); }
}

export let cp = new ControlPanel();
export function setCp(_cp) { cp = _cp; }

export const svrSettings = new ServerSettings();

export const styleGen = genStyles();

export var game, gPool;

export const gameState = new GameState(undefined, loadedCode as LoadedCode, destroy2);
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
    // game.load.image('lava', 'assets/lava.png');
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

var platforms, starGroup, playerGroup, nameGroup, lavaGroup, activeStarGroup, mapGroup, controlsGroup;
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
export const playerToName = new Map<Player, any>();
const events: Event[] = [];
export let onNextBcastPersistentCallbacks = [];

export let gfx;

let minimap, mapBlip;

(<any>window).dbg = {platforms, cursors, baseHandler, gameWorld: world, players, ledges, entToSprite, Common};

function notify(content: string) {
  notifText.text = content;
  clearTimeout(notifClearer);
  (notifClearer as any) = setTimeout(() => notifText.text = '', 2000);
}

let ptr;

const mapDims = new Vec2(200, 200 / gameWorld.width * gameWorld.height);

let doubleTapping = false;

let dirStickBase, dirStick, actionBtn, actionPtr, dirPtr;

let ptrToWorldPos = function () {
  return Vec2.fromObj(game.input).add(new Vec2(game.camera.x, game.camera.y)).div(game.world.scale.x);
};

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
  mapGroup = game.add.group();
  controlsGroup = game.add.group();

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

  // Virtual controls
  const graphics = game.add.graphics(0,0);
  graphics.clear();
  graphics.beginFill(0xffffff);
  graphics.drawCircle(0, 0, 130);
  const circle = graphics.generateTexture();
  dirStickBase = game.add.sprite(0, 0, circle);
  dirStickBase.anchor.setTo(.5, .5);
  dirStickBase.visible = false;
  dirStickBase.alpha = 0.3;
  dirStick = game.add.sprite(0, 0, circle);
  dirStick.anchor.setTo(.5, .5);
  dirStick.visible = false;
  dirStick.scale.setTo(.7, .7);
  dirStick.alpha = 0.3;
  actionBtn = game.add.sprite(0, 0, circle);
  actionBtn.anchor.setTo(.5, .5);
  actionBtn.visible = false;
  actionBtn.alpha = 0.3;
  graphics.clear();
  controlsGroup.fixedToCamera = true;
  controlsGroup.cameraOffset.setTo(0,0);
  controlsGroup.add(dirStickBase);
  controlsGroup.add(dirStick);
  controlsGroup.add(actionBtn);

  //  Key controls.
  cursors = game.input.keyboard.createCursorKeys();
  for (let keyName of ['left', 'right']) {
    const key = cursors[keyName];
    key.onDown.add(() => cp.useKeyboard && events.push(new InputEvent(inputsToDir())));
    // key.onUp.add(() => cp.useKeyboard && events.push(new InputEvent(inputsToDir())));
  }

  const space = game.input.keyboard.addKey(Phaser.Keyboard.SPACEBAR);
  for (let key of [cursors.down, space]) {
    key.onDown.add(startAction);
    key.onUp.add(stopAction);
  }

  game.input.onDown.add((ptr) => {
    // Pointer position is offset by camera position, and neither is in world scale.
    if (ptr.isMouse) {
      startAction();
    } else {
      const worldPtr = ptrToWorldPos();
      if (worldPtr.x > me.x) {
        actionBtn.visible = true;
        ({x: actionBtn.x, y: actionBtn.y} = worldToScreenOffsetWorldScale(worldPtr));
        actionPtr = ptr;
        startAction();
      } else {
        dirStick.visible = true;
        dirStickBase.visible = true;
        [dirStick.x, dirStick.y] = [dirStickBase.x, dirStickBase.y] = worldToScreenOffsetWorldScale(worldPtr).toTuple();
        dirPtr = ptr;
      }
    }
  });
  game.input.onUp.add((ptr) => {
    if (ptr == actionPtr) {
      actionPtr = null;
      actionBtn.visible = false;
      stopAction();
    } else if (ptr == dirPtr) {
      dirPtr = null;
      dirStickBase.visible = false;
      dirStick.visible = false;
    } else if (ptr.isMouse) {
      stopAction();
    }
  });

  // Mouse controls.
  game.input.addMoveCallback((ptr, x: number, y: number, isClick) => {
    // We're manually calculating the mouse pointer position in scaled world coordinates.
    // game.input.worldX doesn't factor in the world scaling.
    // Setting game.input.scale didn't seem to do anything.
    const worldPtr = ptrToWorldPos();
    if (ptr == dirPtr) {
      ({x: dirStick.x, y: dirStick.y} = worldToScreenOffsetWorldScale(worldPtr).clamp(Vec2.fromObj(dirStickBase), 50));
      const delta = dirStick.x - dirStickBase.x;
      if (delta > 5) {
        setInputsByDir(me, Dir.Right);
        socket.emit('input', {time: now(), events: [new InputEvent(me.dir)]});
      } else if (delta < -5) {
        setInputsByDir(me, Dir.Left);
        socket.emit('input', {time: now(), events: [new InputEvent(me.dir)]});
      }
    } else if (ptr.isMouse) {
      const dir = worldPtr.x <= me.x ? Dir.Left : Dir.Right;
      if (dir != getDir(me)) {
        setInputsByDir(me, dir);
        socket.emit('input', {time: now(), events: [new InputEvent(me.dir)]});
      }
    }
  }, {});

  // The notification banner
  notifText = game.add.text(0, 0, '', { fontSize: '48px', fill: '#fff', align: 'center', boundsAlignH: "center", boundsAlignV: "middle" });
  notifText.fixedToCamera = true;
  notifText.cameraOffset.setTo(0,0);
  notifText.lineSpacing = -2;
  notifText.setShadow(4,4,'#000',4);
}

// Was using game.camera.width/height here but that doesn't always immediately update after changing game.width/height (when window is resized for instance)
let follow = function (sprite: any) {
  game.camera.follow(sprite, Phaser.Camera.FOLLOW_PLATFORMER);
  const ymargin = Math.min(game.height / 2, Math.max(game.height / 3, cp.camHeight / 3));
  console.log('follow', game.width, game.height);
  game.camera.deadzone = new Phaser.Rectangle(game.width / 2, ymargin, 0, game.height - 2 * ymargin);
};

function errorReload() {
  setTimeout(() => {
    alert("Sorry, there was an unexpected error - reloading....");
    window.location.reload();
  }, 1000);
}

const playerStats = new PlayerStats();

function initEnts() {
  const initSnap = timeline.get(0);
  playerStats.spawnTime = initSnap.time;
  playerStats.leaderboardTime = 0;
  playerStats.currLeaderboardStartTime = 0;
  playerStats.topRank = 99999;
  playerStats.stomped = 0;
  playerStats.gotStomped = 0;
  playerStats.topSize = 0;
  playerStats.leaderStreakTime = 0;
  playerStats.currLeaderStartTime = 0;
  playerStats.aliveTime = 0;

  gameState.time = initSnap.tick * svrSettings.dt;

  if (initSnap.isDiff) {
    errorReload();
    throw new Error(`initSnap isDiff; timeline length is ${timeline.length}; first non-diff is at ${timeline.indexOf(timeline.find(bcast => !bcast.isDiff))}`);
  }

  const {ents} = initSnap;
  for (let ent of ents) {
    entMgr.addEnt(ent);
  }

  Common.idState.nextId = _.max(getEnts().map(e => e.id)) + 1;

  me = players[players.length - 1];
  const meSprite = entToSprite.get(me);
  follow(meSprite);
  const [origMeData] = ents.filter(e => e.type == 'Player').slice(-1);
  me.name = origMeData.name;
  playerToName.get(me).text = me.name;

  // The minimap
  const graphics = game.add.graphics(0,0);
  graphics.clear();
  graphics.beginFill(0xffff00);
  graphics.drawCircle(0, 0, 5);
  mapBlip = game.add.sprite(0, 0, graphics.generateTexture());
  mapBlip.anchor.setTo(.5, .5);
  graphics.clear();
  const graphics2 = game.add.graphics(0,0);
  graphics2.clear();
  graphics2.lineStyle(1, 0xcccccc, 1);
  graphics2.beginFill(0x000000);
  graphics2.drawRect(0, 0, mapDims.x, mapDims.y);
  // graphics.beginFill(0xffffff);
  // graphics.drawRect(0, 0, 5000, 5000);
  minimap = game.add.sprite(0, 0, graphics2.generateTexture());
  graphics2.clear();
  mapGroup.fixedToCamera = true;
  mapGroup.cameraOffset.setTo(0,0);
  mapGroup.add(minimap);
  mapGroup.add(mapBlip);

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

function startAction() {
  events.push(new StartAction());
}

function stopAction() {
  events.push(new StopAction());
}

function onEntAdded(ent: Ent) {
  if (ent instanceof Player)
    guiMgr.refresh();
  return mkSpriteForEnt(ent);
}

let specialStyle = function(ent: Ent) {
  return null;
};
export function setSpecialStyle(f) {
  specialStyle = f;
}

export const defaultNameStyle = { font: "14px Arial", fill: "#cccccc", stroke: "#cccccc", align: "center"};

function mkSpriteForEnt(ent: Ent) {
  function mkSprite(group, spriteArt: string) {
    const [x, y] = ent instanceof Player ? ent.dispTopLeft().toTuple() : ent.dispPos().toTuple();
    const sprite = group.create(x, y, spriteArt);
    // Setting autoCull didn't really help performance that much.
    // sprite.autoCull = true;
    [sprite.width, sprite.height] = ent.dispDims().toTuple();
    entToSprite.set(ent, sprite);
    return sprite;
  }
  if (ent instanceof Player) {
    const char = playerStyles.includes(ent.style) ? ent.style : 'plain-0';
    if (!ent.spriteBbox) {
      ent.spriteBbox = charVariants.find(char => char.name == ent.style.slice(0, -2)).bbox;
    }
    const sprite = mkSprite(playerGroup, `dude-${char}`);
    sprite.anchor.setTo(...ent.anchor().toTuple());
    sprite.animations.add('left', [3,4,3,5], 10, true);
    sprite.animations.add('right', [0,1,0,2], 10, true);
    const style = ent.id == meId ?
      { font: "14px Arial", fill: "#ffff00", stroke: "#ffff44", align: "center", fontWeight: 'bold'} :
      Object.assign({}, defaultNameStyle, {fill: specialStyle(ent) || '#cccccc'});
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
  if (fscreen.fullscreenEnabled) {
    fscreen.exitFullscreen();
  }
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choiceResult => {
      if (ga) {
        ga('send', 'event', 'A2H', choiceResult.outcome);
      }
      deferredPrompt = null;
    });
  }
  rootComponent.setState({stats: Object.assign({players: gameState.players.length}, rootComponent.state.stats)});
  rootComponent.show();

  for (let ent of getEnts()) {
    removeEnt(ent.id, true);
  }

  game.paused = true;
  game.input.enabled = false;
  game.canvas.style.display = 'none';

  socket.close();
}

let moveName = function (player) {
  const text = playerToName.get(player);
  if (text) {
    text.x = player.dispPos().x;
    text.y = player.dispTopLeft().y - 16;
  }
  return text;
};

let firstUpdate = true;
let starScale: Vec2;
let lastGameDims;

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

  if (gameState.players.length == 0)
    initEnts();

  if (game.width != window.innerWidth || game.height != window.innerHeight) {
    game.scale.setGameSize(window.innerWidth, window.innerHeight);
    console.log('resize', window.innerWidth, window.innerHeight, game.width, game.height);
  }

  // onResize doesn't fire reliably, so manually check.
  if (!lastGameDims || game.width != lastGameDims.width || game.height != lastGameDims.height) {
    lastParentBounds = {};
    lastGameDims = {width: game.width, height: game.height};
    rescale();
    follow(entToSprite.get(me));
  }

  // Phaser stupidly grows game.world.bounds to at least cover game.width/.height
  // (which I understand as the canvas size) even if world is scaled.
  // This in turn propagates - repeatedly - to game.camera.bounds, so I have to keep reminding
  // Phaser to properly bound the camera every step - simply doing so in
  // create()/rescale()/onResize() doesn't work.
  //
  // Understanding zooming and the camera and scaling systems in Phaser is very confusing.
  game.camera.bounds.width = (cp.boundCameraWithinWalls || cp.viewAll ? 1 : 3) * Common.gameWorld.width;
  game.camera.bounds.x = cp.boundCameraWithinWalls || cp.viewAll ? 0 : -Common.gameWorld.width;
  game.camera.bounds.height = cp.boundCameraAboveGround ? Common.gameWorld.height : game.world.height;

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
Window dims: ${vecStr(new Vec2(window.innerWidth, window.innerHeight))}
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
                playerStats.aliveTime = bcast.time - playerStats.spawnTime;
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
            if (player) {
              player.state = 'startingSmash';
              player.smashStart = currTime;
            }
            break;
          case 'StompEv':
            const p = gameState.players.find(p => p.id == ev.playerId);

            if (p) {
              if (p == me) {
                playerStats.stomped += 1;
              } else if (ev.victimId == me.id) {
                playerStats.gotStomped += 1;
              }
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
          if (ent == me) {
            playerStats.topSize = Math.max(playerStats.topSize, me.size);
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

  // minimap
  mapGroup.cameraOffset.setTo(
    game.width  / 1 - minimap.width  * game.world.scale.x  - 10,
    game.height / 1 - minimap.height * game.world.scale.y - 10
  );
  [mapBlip.x, mapBlip.y] = [me.x / gameWorld.width * mapDims.x, me.y / gameWorld.height * mapDims.y];

  if (cp.showScores) {
    scoreText.text = mkScoreText();
  }

  notifText.setTextBounds(0, 0, game.width / game.world.scale.x, 600);

  const endTime = now();
  getLogger('client-jank').log('start', currTime, 'end', endTime, 'elapsed', endTime - currTime);
}

function showScore(player: Player) {
  return Math.round(10 * player.size);
}

function camPos() {
  return new Vec2(game.camera.x, game.camera.y);
}
function worldScale() {
  return new Vec2(game.world.scale.x, game.world.scale.y);
}

let camWorldPos = function () {
  return camPos().xdiv(worldScale());
};

// Output: (0,0) is top left of screen, but scale is still world scale (not # pixels, i.e. not game.width)
function worldToScreenOffsetWorldScale(ptr: {x: number, y: number}) {
  return Vec2.fromObj(ptr).sub(camWorldPos());
}

export function mkScoreText() {
  const sorted = _(gameState.players)
    .sortBy([
      p => -p.size,
      p => p.id
    ])
    .map((p, i) => [i,p] as [number, Player])
    .filter(([i, p]) => i < 10 || me == p);
  const myEntry = sorted.find(([i, p]) => p == me);
  const myRank = myEntry ? myEntry[0] + 1 : 999;
  playerStats.topRank = Math.min(playerStats.topRank, myRank);
  if (myRank == 1 && playerStats.currLeaderStartTime == 0) {
    playerStats.currLeaderStartTime = now();
  } else if (myRank != 1 && playerStats.currLeaderStartTime != 0) {
    playerStats.leaderStreakTime = Math.max(playerStats.leaderStreakTime, now() - playerStats.currLeaderStartTime);
    playerStats.currLeaderStartTime = 0;
  }
  if (myRank <= 10 && playerStats.currLeaderboardStartTime == 0) {
    playerStats.currLeaderboardStartTime = now();
  } else if (myRank > 10 && playerStats.currLeaderboardStartTime != 0) {
    playerStats.leaderboardTime += now() - playerStats.currLeaderboardStartTime;
    playerStats.currLeaderboardStartTime = 0;
  }
  return `Leaderboard
${sorted
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
  if (ent instanceof Player) {
    sprite.anchor.setTo(...ent.anchor().toTuple());
  }
  if (sprite.anchor.x == 0 || ent instanceof Player) {
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
      const smashAnimDur = svrSettings.smashDelay * .75 * 1000;
      const smashAnimElapsed = now() - player.smashStart;
      if (smashAnimElapsed < smashAnimDur) {
        sprite.angle = (player.dir == Dir.Left ? -1 : 1) * 360 * smashAnimElapsed / smashAnimDur;
      } else {
        player.state = 'normal';
        sprite.angle = 0;
        player.smashStart = null;
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
        game.width / gameWorld.width,
        game.height / gameWorld.height
      ) :
      Math.max(
        game.width / cp.camWidth,
        game.height / cp.camHeight
      );
    console.log('rescale', lastGameDims, game.width, game.height, scale);
    game.world.scale.set(scale);
  }
}

function render() {
  if (cp.showDebug)
    showDebugText();
}

export type UpdateExtrasFn = (currentPlayer: Player, updating: boolean, currTime: number) => void;

let meId: number;
let pinger;
const autoKill = +searchParams.get('autoKill');
function startGame(name: string, char: string, server: string, onJoin: (socket) => void, updateExtras: UpdateExtrasFn, mkDebugText, sprites) {
  if (autoKill) setTimeout(backToSplash, autoKill);
  socket = connect(server);

  lastGameDims = null;

  socket.emit('join', {name, char});

  if (cp.doPings && !pinger) {
    pinger = setInterval(() => {
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
export let connect = function (server: string) {
  const addr = server.indexOf('http') == 0 ? server : `https://${server}`;
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
  let stats: Stats;
  let firstSubmitted = false, pRootComponent: Promise<Splash>;
  const pFirstSubmit = new Promise<[string, string, string]>((resolveSubmit) => {
    pRootComponent = renderSplash({
      browserSupported: browserSupported(),
      stats: stats,
      playerStats: playerStats,
      onSubmit: (name, char, server) => {
        // OK to resolve multiple times
        resolveSubmit([name, char, server]);
        // Let Promise.all handle the first one
        if (firstSubmitted) startGame(name, char, server, onJoin, updateExtras, mkDebugText, sprites);
        firstSubmitted = true;
      },
      shown: !autoStartName
    });
    pRootComponent.then(root => rootComponent = root);
    if (autoStartName) { resolveSubmit([autoStartName, 'white', 'stomped.io']); }
  });
  Promise.all([pSprites, pRootComponent]).then(([sprites, rootComponent]) =>
    rootComponent.setImgs(sprites)
  );
  Promise.all([pFirstSubmit, pPb, pSprites])
    .then(([firstSubmit, pb, _sprites]) => {
      const [name, char, server] = firstSubmit;
      return startGame(name, char, server, onJoin, updateExtras, mkDebugText, _sprites);
    });
  fetch(`/stats`).then((resp) => resp.json().then((_stats: Stats) => {
    if (rootComponent) {
      rootComponent.setStats(_stats);
    }
  }));
}