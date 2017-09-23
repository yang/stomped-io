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
  gfx.lineStyle(1,0x0088FF,1);
  if (game.input.activePointer.isDown) {
    target = new Vec2(game.input.worldX, game.input.worldY);
  }
  if (target) {
    gfx.drawCircle(target.x, target.y, 100);
  }
  gfx.moveTo(me.x, me.y);
  const dt = 1/10;
  const horizon = 4;
  for (let i = 0; i < horizon / dt; i++) {
    Common.update(players, dt);
    gfx.lineTo(...entPosFromPl(me).toTuple());
  }

}
let target: Vec2;

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
