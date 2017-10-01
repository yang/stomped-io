import * as Pl from 'planck-js';
import * as _ from 'lodash';

export const ratio = 24;
export const accel = 10;

export const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));

export function clearArray(xs) {
  xs.splice(0, xs.length);
}

export class InputState {
  isDown = false;
}

export function create(players: Player[], destroy, lava, world: Pl.World) {
  world.on('end-contact', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      if (bA.getUserData().type == 'Player') {
//        console.log('end-contact');
        // only clear of each other in the next tick
        postStep(() => {
//          console.log(fA.getAABB(0).lowerBound.y, fB.getAABB(0).upperBound.y, fA.getAABB(0).upperBound.y, fB.getAABB(0).lowerBound.y);
          if (fA.getAABB(0).lowerBound.y >= fB.getAABB(0).upperBound.y) {
            if (fA.getAABB(0).lowerBound.y - fB.getAABB(0).upperBound.y > 1) {
              // console.log('huge gap', bA.getUserData(), bB.getUserData(), fA.getAABB(0).lowerBound.y, fB.getAABB(0).upperBound.y);
            }
            bA.setLinearVelocity(Pl.Vec2(bA.getLinearVelocity().x, 15));
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
//      if (players.includes(bA.getUserData()))
//        console.log('begin-contact');
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

export function entPosFromPl(ent, pos = ent.bod.getPosition(), midpoint = false) {
  return new Vec2(
      ratio * pos.x - (midpoint ? 0 : ent.width / 2),
      ratio * -pos.y - (midpoint ? 0 : ent.height / 2)
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
  ent.bod = createBody(world, ent, type, fixtureOpts);
  return ent.bod;
}

export function createBody(world: Pl.World, ent, type, fixtureOpts = {}) {
  const bod = world.createBody({
    type: type,
    fixedRotation: true,
    position: plPosFromEnt(ent),
    userData: ent
  });
  bod.createFixture(Object.assign({
    shape: Pl.Box(ent.width / 2 / ratio, ent.height / 2 / ratio),
    density: 1,
    restitution: 1,
    friction: 0
  }, fixtureOpts));
  return bod;
}

let lastTime = null;
export const dt = 1 / 10;
export const updatePeriod = 1 / 10;
// physics timestep per real timestep
export const timeWarp = dt / updatePeriod;

export function assert(pred, msg = "Assertion failed") {
  if (!pred) throw new Error(msg);
}

function updateVel(bod, f) {
  bod.setLinearVelocity(f(bod.getLinearVelocity()));
}

function feedInputs(player, dt) {

  const inputs = player.inputs;

  if (inputs.left.isDown) {
    //  Move to the left
    updateVel(player.bod, ({x,y}) => Pl.Vec2(Math.max(x - accel * dt, -5), y));
  } else if (inputs.right.isDown) {
    //  Move to the right
    updateVel(player.bod, ({x,y}) => Pl.Vec2(Math.min(x + accel * dt, 5), y));
  } else {
    ////  Reset the players velocity (movement)
    if (player.bod.getLinearVelocity().x < 0) {
      updateVel(player.bod, ({x,y}) => Pl.Vec2(Math.min(x + accel * dt, 0), y));
    } else {
      updateVel(player.bod, ({x,y}) => Pl.Vec2(Math.max(x - accel * dt, 0), y));
    }
  }

}

export function update(players: Player[], _dt = dt, _world = world) {
  // TODO we're feeding inputs every physics tick here, but we send inputs to
  // clients bucketed into the bcasts, which are less frequent.
  for (let player of players) feedInputs(player, _dt);

  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  _world.step(_dt);
  for (let f of postSteps) {
    f();
  }
  clearArray(postSteps);
}

export function updateEntPhys(ent) {
  [ent.x, ent.y] = entPosFromPl(ent).toTuple();
  ent.vel.x = ratio * ent.bod.getLinearVelocity().x;
  ent.vel.y = ratio * -ent.bod.getLinearVelocity().y;
}

export function copyVec(v: Pl.Vec2): Pl.Vec2 {
  return Pl.Vec2(v.x, v.y);
}

export function cloneWorld(world: Pl.World): Pl.World {
  const newWorld = Pl.World(Pl.Vec2(0, gravity));
  for (let body of [...iterBodies(world)].reverse()) {
    const clone = createBody(newWorld, body.getUserData(), body.getType());
    clone.setLinearVelocity(copyVec(body.getLinearVelocity()));
    clone.setPosition(copyVec(body.getPosition()));
  }
  assert(_.isEqual(
    Array.from(iterBodies(world)).map(body => body.getUserData()),
    Array.from(iterBodies(newWorld)).map(body => body.getUserData())));
  return newWorld;
}

export function isClose(a: number, b: number) {
  return Math.abs(a-b) <=  Math.max(1e-9 * Math.max(Math.abs(a), Math.abs(b)), 0);
}

export function veq(a,b) {
  return isClose(a.x, b.x) && isClose(a.y, b.y);
}

function* iterList(node) {
  for (; node; node = node.getNext()) yield node;
}

export function iterBodies(world) {
  return iterList(world.getBodyList());
}

export function iterFixtures(body) {
  return iterList(body.getFixtureList());
}