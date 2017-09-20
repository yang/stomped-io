export {};

(<any>window).PIXI = require('phaser/build/custom/pixi');
(<any>window).p2 = require('phaser/build/custom/p2');
const Phaser = (<any>window).Phaser = require('phaser/build/custom/phaser-split');

import * as Pl from 'planck-js';
import * as Sio from 'socket.io-client';
import * as Common from './common';
import {Player, world, ratio, addBody, Bcast} from './common';
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

let players: Player[], ledges;

const timeline: Bcast[] = [];

(<any>window).dbg = {platforms, cursors, lava, world, players, ledges};

class InputState {
  isDown: boolean;
  constructor() {
    this.isDown = false;
  }
}

class Inputs {
  left: InputState;
  down: InputState;
  right: InputState;
  up: InputState;
  constructor() {
    this.left = new InputState();
    this.down = new InputState();
    this.right = new InputState();
    this.up = new InputState();
  }
}

function destroy(sprite) {
  world.destroyBody(sprite.bod);
  sprite.kill();
}

const gameObjToSprite = new Map();

function create({ledges, players}) {

  game.world.setBounds(0,0,800,2400);

  //  A simple background for our game
  game.add.sprite(0, 0, 'sky');

  lava = game.add.sprite(0, game.world.height - 64, 'lava');
  lava.enableBody = true;
  addBody(lava, 'kinematic');

  //  The platforms group contains the ground and the 2 ledges we can jump on
  platforms = game.add.group();
  for (let ledge of ledges) {
    const platform = platforms.create(ledge.x, ledge.y, 'ground');
    platform.scale.setTo(.75, 1);
    gameObjToSprite.set(ledge, platform);
  }

  for (let player of players) {
    const sprite = game.add.sprite(player.x, player.y, 'dude');
    gameObjToSprite.set(player, sprite);
  }

  const me = gameObjToSprite.get(players[players.length - 1]);
  game.camera.follow(me, Phaser.Camera.FOLLOW_PLATFORMER);

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

}

const accel = .1;

let lastTime = null;
const dt = 1 / 60.;

const timeBuffer = 200;
let delta = null;

function lerp(a,b,alpha) {
  return a + alpha * (b - a);
}

function update() {

  if (lastTime == null) lastTime = performance.now() / 1000;
  const currTime = performance.now();
  const targetTime = currTime + delta - timeBuffer;
  const nextBcastIdx = timeline.findIndex((snap) => snap.time > targetTime);
  if (nextBcastIdx <= 0) return;
  const nextBcast = timeline[nextBcastIdx];
  const prevBcast = timeline[nextBcastIdx - 1];
  const alpha = (targetTime - prevBcast.time) / (nextBcast.time - prevBcast.time);

  const aMap = new Map(prevBcast.players.map<[number, Player]>((p) => [p.id, p]));
  const bMap = new Map(nextBcast.players.map<[number, Player]>((p) => [p.id, p]));
  for (let player of players) {
    const [a,b] = [aMap.get(player.id), bMap.get(player.id)];
    player.x = lerp(a.x, b.x, alpha);
    player.y = lerp(a.y, b.y, alpha);
  }
  

  function die(player, lava) {
    player.kill();
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
    updatePos(player);
  }

  for (let ledge of ledges) {
    updatePos(ledge);
  }

  //for (let star of stars.children) {
    //updatePos(star);
  //}

}

function updatePos(gameObj) {
  const sprite = gameObjToSprite.get(gameObj);
  sprite.x = gameObj.x;
  sprite.y = gameObj.y;
}

function clamp(x, bound) {
  return Math.min(Math.abs(x), bound) * Math.sign(x);
}

function feedInputs(chr) {

  let inputs = chr.inputs;
  let player = chr.sprite;

  if (inputs.left.isDown)
    {
      //  Move to the left
      player.bod.getLinearVelocity().x = Math.max(player.bod.getLinearVelocity().x - accel, -5);

      player.animations.play('left');
    }
    else if (inputs.right.isDown)
      {
        //  Move to the right
        player.bod.getLinearVelocity().x = Math.min(player.bod.getLinearVelocity().x + accel, 5);

        player.animations.play('right');
      }
      else
        {
          ////  Reset the players velocity (movement)
          if (player.bod.getLinearVelocity().x < 0) {
            player.bod.getLinearVelocity().x = Math.min(0, player.bod.getLinearVelocity().x + accel);
          } else {
            player.bod.getLinearVelocity().x = Math.max(0, player.bod.getLinearVelocity().x - accel);
          }

          //  Stand still
          player.animations.stop();

          player.frame = 4;
        }

}

function main() {
  const socket = Sio('http://localhost:3000');
  socket.on('connect', () => {
    console.log('connect')

    socket.emit('join', {name: 'z'});

    socket.on('joined', (initSnap) => {
      game = new Phaser.Game(800, 600, Phaser.AUTO, '', {
        preload: preload,
        create: () => create(initSnap),
        update: update
      });

      ({players, ledges} = initSnap);
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
