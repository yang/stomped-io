import * as Pl from 'planck-js';
import * as _ from 'lodash';

export const ratio = 24;
export const accel = 0.1;

export const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));

export function clearArray(xs) {
  xs.splice(0, xs.length);
}

export class InputState {
  isDown = false;
}

export function create(players, destroy, lava) {
  world.on('end-contact', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      if (players.includes(bA.getUserData())) {
        // only clear of each other in the next tick
        postStep(() => {
          //console.log(fA.getAABB(0).lowerBound.y, fB.getAABB(0).upperBound.y, fA.getAABB(0).upperBound.y, fB.getAABB(0).lowerBound.y);
          if (fA.getAABB(0).lowerBound.y >= fB.getAABB(0).upperBound.y) {
            bA.setLinearVelocity(Pl.Vec2(bA.getLinearVelocity().x, 12));
          }
        });
      }
    }
    bounce(fA, bA, fB, bB);
    bounce(fB, bB, fA, bA);
  });

  world.on('begin-contact', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      //if (players.includes(bA.getUserData()) && stars.children.includes(bB.getUserData())) {
      //  const star = bB.getUserData();
      //  contact.setEnabled(false);
      //  // only clear of each other in the next tick
      //  setTimeout(() => {
      //    destroy(star);
      //    //  Add and update the score
      //    score += 10;
      //    scoreText.text = 'Score: ' + score;
      //  }, 0);
      //}
      if (players.includes(bA.getUserData()) && lava === bB.getUserData()) {
        contact.setEnabled(false);
        const player = bA.getUserData();
        postStep(() => player.bod.setPosition(Pl.Vec2(
          player.bod.getPosition().x, -99999)));
        // only clear of each other in the next tick
        if (destroy) {
          setTimeout(() => {
            destroy(player);
          }, 0);
        }
      }
    }
    bounce(fA, bA, fB, bB);
    bounce(fB, bB, fA, bA);
  });

}

const postSteps = [];
function postStep(f) {
  postSteps.push(f);
}

export class Inputs {
  left = new InputState();
  down = new InputState();
  right = new InputState();
  up = new InputState();
}

export interface Bcast {
  time: number;
  tick: number;
  bcastNum: number;
  events: Event[];
  ents: Ent[];
}

var omit = function(obj, key) {
    var newObj = {};

    for (var name in obj){
        if (name !== key) {
            newObj[name] = obj[name];
        }
    }

    return newObj;
};

function* genIds() {
  let i = 0;
  while (true) {
    yield i;
    i += 1;
  }
}
const ids = genIds();

export class Serializable {
  type: string;
  constructor() {
    this.type = this.constructor.name;
  }
  ser(): this { return this; }
}

export class Vec2 {
  constructor(public x = 0, public y = 0) {}
  toTuple(): [number, number] {
    return [this.x, this.y];
  }
}

export function entPosFromPl(ent, pos = ent.bod.getPosition()) {
  return new Vec2(
      ratio * pos.x - ent.width / 2,
      ratio * -pos.y - ent.height / 2
  );
}

export class Ent extends Serializable {
  width: number;
  height: number;
  x: number;
  y: number;
  vel = new Vec2(0,0);
  id = ids.next().value;
  bod?: Pl.Body;
  ser(): this {
    return <this>omit(this, 'bod');
  }
}

export class Lava extends Ent {
  width = 800;
  height = 64;
  constructor(public x: number, public y: number) {super();}
}

export class Player extends Ent {
  width = 32;
  height = 48;
  inputs = new Inputs();
  constructor(public name: string, public x: number, public y: number) {super();}
}

export const ledgeWidth = 300, ledgeHeight = 32;

export class Ledge extends Ent {
  width = ledgeWidth;
  height = ledgeHeight;
  constructor(public x: number, public y: number) {super();}
}

export class Event extends Serializable {}

export class InputEvent extends Event {
  constructor(public inputs: Inputs) { super(); }
}

export class AddEnt extends Event {
  constructor(public ent: Ent) { super(); }
  ser(): this {
    return _(this)
      .chain()
      .clone()
      .extend({ent: this.ent.ser()})
      .value();
  }
}

export class RemEnt extends Event {
  constructor(public id: number) { super(); }
}

export function plPosFromEnt(ent) {
  return Pl.Vec2((ent.x + ent.width / 2) / ratio, -(ent.y + ent.height / 2) / ratio);
}

export function addBody(ent, type, fixtureOpts = {}) {
  ent.bod = world.createBody({
    type: type,
    fixedRotation: true,
    position: plPosFromEnt(ent),
    userData: ent
  });
  ent.bod.createFixture(Object.assign({
    shape: Pl.Box(ent.width / 2 / ratio, ent.height / 2 / ratio),
    density: 1,
    restitution: 1,
    friction: 0
  }, fixtureOpts));
  return ent.bod;
}

let lastTime = null;
const dt = 1 / 10.;
export const updatePeriod = dt;

function feedInputs(player) {

  const inputs = player.inputs;

  if (inputs.left.isDown) {
    //  Move to the left
    player.bod.getLinearVelocity().x = Math.max(player.bod.getLinearVelocity().x - accel / dt, -5);
  } else if (inputs.right.isDown) {
    //  Move to the right
    player.bod.getLinearVelocity().x = Math.min(player.bod.getLinearVelocity().x + accel / dt, 5);
  } else {
    ////  Reset the players velocity (movement)
    if (player.bod.getLinearVelocity().x < 0) {
      player.bod.getLinearVelocity().x = Math.min(0, player.bod.getLinearVelocity().x + accel / dt);
    } else {
      player.bod.getLinearVelocity().x = Math.max(0, player.bod.getLinearVelocity().x - accel / dt);
    }
  }

}

export function update(players, _dt = dt) {
  // TODO we're feeding inputs every physics tick here, but we send inputs to
  // clients bucketed into the bcasts, which are less frequent.
  for (let player of players) feedInputs(player);

  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  world.step(_dt);
  for (let f of postSteps) {
    f();
  }
  clearArray(postSteps);
}
