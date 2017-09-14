// vim: et sw=4 ts=4

var game = new Phaser.Game(800, 600, Phaser.AUTO, '', { preload: preload, create: create, update: update });

function preload() {

    game.load.image('sky', 'assets/sky.png');
    game.load.image('ground', 'assets/platform.png');
    game.load.image('star', 'assets/star.png');
    game.load.spritesheet('dude', 'assets/dude.png', 32, 48);

}

var player;
var chars = [];
var platforms;
var cursors;

var stars;
var score = 0;
var scoreText;
function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

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
    for (key of ['left','right']) {
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

function create() {

    //  We're going to be using physics, so enable the Arcade Physics system
    game.physics.startSystem(Phaser.Physics.ARCADE);

    //  A simple background for our game
    game.add.sprite(0, 0, 'sky');

    //  The platforms group contains the ground and the 2 ledges we can jump on
    platforms = game.add.group();

    //  We will enable physics for any object that is created in this group
    platforms.enableBody = true;

    // Here we create the ground.
    var ground = platforms.create(0, game.world.height - 64, 'ground');

    //  Scale it to fit the width of the game (the original sprite is 400x32 in size)
    ground.scale.setTo(2, 2);

    //  This stops it from falling away when you jump on it
    ground.body.immovable = true;

    //  Now let's create two ledges
    var ledge = platforms.create(400, 400, 'ground');
    ledge.body.immovable = true;

    ledge = platforms.create(-150, 250, 'ground');
    ledge.body.immovable = true;

    for (var i = 0; i < 10; i++) {

        // The player and its settings
        //let player = game.add.sprite(32, game.world.height - 150, 'dude');
        let player = game.add.sprite(getRandomInt(0, game.world.width), getRandomInt(0, game.world.height - 128), 'dude');

        //  We need to enable physics on the player
        game.physics.arcade.enable(player);

        //  Player physics properties. Give the little guy a slight bounce.
        player.body.bounce.x = 1;
        player.body.bounce.y = 1;
        player.body.gravity.y = 300;
        player.body.collideWorldBounds = true;

        //  Our two animations, walking left and right.
        player.animations.add('left', [0, 1, 2, 3], 10, true);
        player.animations.add('right', [5, 6, 7, 8], 10, true);

        const chr = new Char(player)
        chars.push(chr);
        schedRandInputs(chr);

    }

    player = chars[0].sprite;

    //  Finally some stars to collect
    stars = game.add.group();

    //  We will enable physics for any star that is created in this group
    stars.enableBody = true;

    //  Here we'll create 12 of them evenly spaced apart
    for (var i = 0; i < 12; i++)
    {
        //  Create a star inside of the 'stars' group
        var star = stars.create(i * 70, 0, 'star');

        //  Let gravity do its thing
        star.body.gravity.y = 300;

        //  This just gives each star a slightly random bounce value
        star.body.bounce.y = 0.7 + Math.random() * 0.2;
    }

    //  The score
    scoreText = game.add.text(16, 16, 'score: 0', { fontSize: '32px', fill: '#000' });

    //  Our controls.
    cursors = game.input.keyboard.createCursorKeys();
    
}

const accel = 3;

function update() {

    function bounce (player, platform) {
        if (player.y + player.height <= platform.y) {
            console.log('above');
            player.body.velocity.y = -300;
        //} else if (platform.y + platform.height <= player.y) {
        //    console.log('below');
        //    player.body.velocity.y = -player.body.velocity.y;
        }
    }

    function bounce2 (a, b) {
        if (a.y + a.height <= b.y) {
            console.log('a');
            a.body.velocity.y = -300;
        } else if (b.y + b.height <= a.y) {
            console.log('b');
            b.body.velocity.y = -300;
        }
    }

    charSprites = chars.map(x => x.sprite);

    //  Collide the player and the stars with the platforms
    game.physics.arcade.collide(charSprites, platforms, bounce);
    game.physics.arcade.collide(stars, platforms);
    game.physics.arcade.collide(charSprites, charSprites, bounce2);

    //  Checks to see if the player overlaps with any of the stars, if he does call the collectStar function
    game.physics.arcade.overlap(charSprites, stars, collectStar, null, this);

    chars[0].inputs.left.isDown = cursors.left.isDown;
    chars[0].inputs.right.isDown = cursors.right.isDown;
    chars[0].inputs.down.isDown = cursors.down.isDown;
    chars[0].inputs.up.isDown = cursors.up.isDown;

    for (let chr of chars) {
        feedInputs(chr);
    }

}

function feedInputs(chr) {

    let inputs = chr.inputs;
    let player = chr.sprite;

    if (inputs.left.isDown)
    {
        //  Move to the left
        player.body.velocity.x = Math.max(player.body.velocity.x - accel, -150);

        player.animations.play('left');
    }
    else if (inputs.right.isDown)
    {
        //  Move to the right
        player.body.velocity.x = Math.min(player.body.velocity.x + accel, 150);

        player.animations.play('right');
    }
    else
    {
        //  Reset the players velocity (movement)
        if (player.body.velocity.x < 0) {
            player.body.velocity.x = Math.min(0, player.body.velocity.x + accel);
        } else {
            player.body.velocity.x = Math.max(0, player.body.velocity.x - accel);
        }

        //  Stand still
        player.animations.stop();

        player.frame = 4;
    }
    
    //  Allow the player to jump if they are touching the ground.
    if (inputs.up.isDown && player.body.touching.down)
    {
        player.body.velocity.y = -350;
    }

}

function collectStar (player, star) {
    
    // Removes the star from the screen
    star.kill();

    //  Add and update the score
    score += 10;
    scoreText.text = 'Score: ' + score;

}
