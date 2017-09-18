// vim: et sw=4 ts=4

window.PIXI = require('phaser/build/custom/pixi');
window.p2 = require('phaser/build/custom/p2');
window.Phaser = require('phaser/build/custom/phaser-split');

import * as Pl from 'planck-js';

const ratio = 24;

var game = new Phaser.Game(800, 600, Phaser.AUTO, '', { preload: preload, create: create, update: update });

const ledgeWidth = 300, ledgeHeight = 32;

function preload() {

    game.load.image('sky', 'assets/sky.png');
    game.load.image('ground', 'assets/platform.png');
    game.load.image('star', 'assets/star.png');
    game.load.image('lava', 'assets/lava.jpg');
    game.load.spritesheet('dude', 'assets/dude.png', 32, 48);

}

var player;
var chars = [];
var platforms;
var cursors;
var lava;
var ledges = [];
const gravity = -10;
var world = Pl.World(Pl.Vec2(0, gravity));

var stars;
var score = 0;
var scoreText;
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

window.dbg = {player, chars, platforms, cursors, lava, ledges, gravity, world, stars, score};

class InputState {
    constructor() {
        this.isDown = false;
    }
}

class Inputs {
    constructor() {
        this.left = new InputState();
        this.down = new InputState();
        this.right = new InputState();
        this.up = new InputState();
    }
}

class Char {
    constructor(sprite) {
        this.sprite = sprite;
        this.inputs = new Inputs();
    }
}

function schedRandInputs(chr) {
    let allClear = true;
    for (var key of ['left','right']) {
        if (chr.inputs[key].isDown) {
            chr.inputs[key].isDown = false;
            allClear = false;
        }
    }
    if (allClear) {
        chr.inputs[['left','right'][getRandomInt(0,2) % 2]].isDown = true;
    }
    setTimeout(() => schedRandInputs(chr), getRandomInt(1000, 3000));
}

function addBody(sprite, type, fixtureOpts = {}) {
    sprite.bod = world.createBody({
        type: type,
        fixedRotation: true,
        position: Pl.Vec2((sprite.x + sprite.width / 2) / ratio, -(sprite.y + sprite.height / 2) / ratio),
        userData: sprite
    });
    sprite.bod.createFixture(Object.assign({
        shape: Pl.Box(sprite.width / 2 / ratio, sprite.height / 2 / ratio),
        density: 1,
        restitution: 1,
        friction: 0
    }, fixtureOpts));
    return sprite.bod;
}

const ledgeSpacing = 200;
function addLedges(x) {
    while (true) {
        if (ledges.length > 0 && ledges[ledges.length - 1].y - ledgeSpacing < -ledgeHeight)
            break;
        const xSpace = (game.world.width - ledgeWidth);
        const x = getRandomInt(0, xSpace / 2) + (ledges.length % 2 ? xSpace / 2 : 0);
        const y = ledges.length == 0 ?
            game.world.height - ledgeSpacing : ledges[ledges.length - 1].y - ledgeSpacing;
        const ledge = platforms.create(x, y, 'ground');
        ledge.scale.setTo(.75,1);
        addBody(ledge, 'kinematic');
        ledge.bod.setLinearVelocity(Pl.Vec2(0, -2));
        ledges.push(ledge);
    }
}

function destroy(sprite) {
    world.destroyBody(sprite.bod);
    sprite.kill();
}

function create() {

    game.world.setBounds(0,0,800,2400);

    //  A simple background for our game
    game.add.sprite(0, 0, 'sky');

    lava = game.add.sprite(0, game.world.height - 64, 'lava');
    lava.enableBody = true;
    addBody(lava, 'kinematic');

    //  The platforms group contains the ground and the 2 ledges we can jump on
    platforms = game.add.group();

    //  Now let's create two ledges
    addLedges();

    for (var i = 0; i < 10; i++) {

        // The player and its settings
        //let player = game.add.sprite(32, game.world.height - 150, 'dude');
        let player = game.add.sprite(getRandomInt(0, game.world.width), getRandomInt(0, game.world.height - 200), 'dude');

        addBody(player, 'dynamic');

        //  Our two animations, walking left and right.
        player.animations.add('left', [0, 1, 2, 3], 10, true);
        player.animations.add('right', [5, 6, 7, 8], 10, true);

        const chr = new Char(player)
        chars.push(chr);
        schedRandInputs(chr);

    }

    player = chars[0].sprite;
    game.camera.follow(player, Phaser.Camera.FOLLOW_PLATFORMER);

    //  Finally some stars to collect
    stars = game.add.group();

    //  Here we'll create 12 of them evenly spaced apart
    for (var i = 0; i < 12; i++)
    {
        //  Create a star inside of the 'stars' group
        var star = stars.create(i * 70, 0, 'star');

        addBody(star, 'dynamic', {restitution: 0.7 + Math.random() * 0.2});
    }

    //  The score
    scoreText = game.add.text(16, 16, 'score: 0', { fontSize: '32px', fill: '#000' });

    //  Our controls.
    cursors = game.input.keyboard.createCursorKeys();

    world.on('end-contact', (contact, imp) => {
        const fA = contact.getFixtureA(), bA = fA.getBody();
        const fB = contact.getFixtureB(), bB = fB.getBody();
        function bounce(fA, bA, fB, bB) {
            if (chars.map(x => x.sprite).includes(bA.getUserData())) {
                // only clear of each other in the next tick
                setTimeout(() => {
                    console.log(fA.getAABB(0).lowerBound.y, fB.getAABB(0).upperBound.y, fA.getAABB(0).upperBound.y, fB.getAABB(0).lowerBound.y);
                    if (fA.getAABB(0).lowerBound.y >= fB.getAABB(0).upperBound.y) {
                        bA.getLinearVelocity().y = 12;
                    }
                }, 0);
            }
        }
        bounce(fA, bA, fB, bB);
        bounce(fB, bB, fA, bA);
    });

    world.on('begin-contact', (contact, imp) => {
        const fA = contact.getFixtureA(), bA = fA.getBody();
        const fB = contact.getFixtureB(), bB = fB.getBody();
        function bounce(fA, bA, fB, bB) {
            if (chars.map(x => x.sprite).includes(bA.getUserData()) && stars.children.includes(bB.getUserData())) {
                const star = bB.getUserData();
                contact.setEnabled(false);
                // only clear of each other in the next tick
                setTimeout(() => {
                    destroy(star);
                    //  Add and update the score
                    score += 10;
                    scoreText.text = 'Score: ' + score;
                }, 0);
            }
            if (chars.map(x => x.sprite).includes(bA.getUserData()) && lava === bB.getUserData()) {
                contact.setEnabled(false);
                const player = bA.getUserData();
                // only clear of each other in the next tick
                setTimeout(() => {
                    destroy(player);
                }, 0);
            }
        }
        bounce(fA, bA, fB, bB);
        bounce(fB, bB, fA, bA);
    });

}

const accel = .1;

let lastTime = null;
const dt = 1 / 60.;

function update() {

    if (lastTime == null) lastTime = performance.now() / 1000;
    const currTime = performance.now() / 1000;

    function die(player, lava) {
        player.kill();
    }

    const charSprites = chars.map(x => x.sprite);

    world.step(dt);

    //while (currTime - lastTime >= dt) {
    //    world.step(dt);
    //    lastTime += dt;
    //}

    chars[0].inputs.left.isDown = cursors.left.isDown;
    chars[0].inputs.right.isDown = cursors.right.isDown;
    chars[0].inputs.down.isDown = cursors.down.isDown;
    chars[0].inputs.up.isDown = cursors.up.isDown;

    for (let chr of chars) {
        feedInputs(chr);
    }
    addLedges();

    for (var chr of charSprites) {
        updatePos(chr);
    }

    for (let platform of platforms.children) {
        updatePos(platform);
    }

    for (let star of stars.children) {
        updatePos(star);
    }

}

function updatePos(sprite) {
    sprite.x = ratio * sprite.bod.getPosition().x - sprite.width / 2;
    sprite.y = ratio * -sprite.bod.getPosition().y - sprite.height / 2;
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
