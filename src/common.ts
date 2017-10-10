import * as Pl from 'planck-js';
import * as _ from 'lodash';
import * as Signals from 'signals';

export class Logger {
  constructor(public name: string, public handler: LogHandler) {}
  log(...args) { this.handler.log(this.name, args); }
}

export class LogHandler {
  buffer = [];
  enabled = new Set<string>();
  log(name, msg) {
    this.buffer.push([name, msg]);
    if (this.enabled.has(name)) {
      console.log(`#{name}:`, ...msg);
    }
  }
}

export const baseHandler = new LogHandler();
const nameToLogger = new Map<string, Logger>();
export function getLogger(name: string) {
  let logger = nameToLogger.get(name);
  if (!logger) {
    logger = new Logger(name, baseHandler);
    nameToLogger.set(name, logger)
  }
  return logger;
}

export const ratio = 64;
export const accel = 10;

export const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));
const gWorld = world;

export const gameWorld = {
  width: 1600,
  height: 1600
};

export const oscDist = gameWorld.width / 8 * 2;

export let alwaysMoveLeft = false;

export class GameState {
  public time = 0;
  public players: Player[] = [];
  public ledges: Ledge[] = [];
  public lava: Lava;
  public stars: Star[] = [];
  onJumpoff = new Signals.Signal();
  constructor(public world: Pl.World = gWorld, public destroy = _.noop) {}
  getEnts() {
    return (<Ent[]>this.players).concat(this.ledges).concat(this.stars);
  }
}

export function pushAll(xs, ys) {
  xs.splice(xs.length, 0, ys);
}

export function clearArray(xs) {
  xs.splice(0, xs.length);
}

export function enumerate<T>(xs: T[]): [number,T][] {
  return Array.from((function*() {
    for (let i = 0; i < xs.length; i++) {
      yield <[number,T]>[i, xs[i]];
    }
  })());
}

export class InputState {
  isDown = false;
}

export function create(gameState: GameState) {
  const players = gameState.players, world = gameState.world;
  const starToPlayer = new Map<Star, Player>();
  const log = getLogger('jumpoff');
  const destroy = gameState.destroy;

  world.on('post-solve', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB, reverse: boolean) {
      if (bA.getUserData().type == 'Player') {
        const m = contact.getWorldManifold();
        if (veq(m.normal, Pl.Vec2(0,-1).mul(reverse ? -1 : 1))) {
          log.log('jumping', bA.getUserData(), bB.getUserData());
          gameState.onJumpoff.dispatch(bA.getUserData(), bB.getUserData());
          postStep(() => updateVel(bA, ({x,y}) => Pl.Vec2(x,8)));
        }
      }
    }
    bounce(fA, bA, fB, bB, false);
    bounce(fB, bB, fA, bA, true);
  });

  // pre-solve is the only time to cancel contacts.
  world.on('pre-solve', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB) {
      if (players.includes(bA.getUserData())) {
        const player: Player = bA.getUserData();
        if (gameState.lava === bB.getUserData() || bB.getUserData().type == 'Lava') {
          contact.setEnabled(false);
          const player = bA.getUserData();
          postStep(() => {
            bA.setPosition(Pl.Vec2(bA.getPosition().x, -99999))
            if (destroy) {
              destroy(player);
            }
          });
        } else if (bB.getUserData() instanceof Star) {
          // Star may collide with multiple players simultaneously - must attribute the star to only one player.
          contact.setEnabled(false);
          const star: Star = bB.getUserData();
          if (!starToPlayer.has(star)) {
            starToPlayer.set(star, player);
            postStep(() => {
              player.size += .1;
              [player.width, player.height] = player.baseDims.mul(player.size ** (1/3)).toTuple();
              for (let i = 0; i < 4; i++) {
                const v = fA.getShape().getVertex(i);
                fA.getShape().getVertex(i).set(Pl.Vec2(
                  player.width / 2 / ratio * Math.sign(v.x),
                  player.height / 2 / ratio * Math.sign(v.y)
                ));
              }
              if (destroy) destroy(star);
            });
          }
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
  add(v: Vec2) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v: Vec2) { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(x: number) { return new Vec2(this.x * x, this.y * x); }
  div(x: number) { return new Vec2(this.x / x, this.y / x); }
  toTuple(): [number, number] { return [this.x, this.y]; }
  static fromObj({x, y}: {x: number, y: number}) { return new Vec2(x,y); }
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
  ser(): this { return <this>omit(this, 'bod'); }
  pos() { return new Vec2(this.x, this.y); }
  dims() { return new Vec2(this.width, this.height); }
  dispDims() { return this.dims(); }
  dispPos(): Vec2 { return this.pos().add(this.dims().sub(this.dispDims()).div(2)); }
}

export class Lava extends Ent {
  width = gameWorld.width;
  height = 64;
  constructor(public x: number, public y: number) {super();}
}

export class Player extends Ent {
  width = 24;
  height = 32;
  baseDims = new Vec2(this.width, this.height);
  inputs = new Inputs();
  size = 1;
  constructor(public name: string, public x: number, public y: number, public style: string) {super();}
}

export const ledgeWidth = 300, ledgeHeight = 24;

export class Ledge extends Ent {
  width = ledgeWidth;
  height = ledgeHeight;
  initPos: Vec2;
  constructor(public x: number, public y: number, public oscPeriod: number) {
    super();
    this.initPos = new Vec2(x,y);
  }
}

export class Star extends Ent {
  width = 16;
  height = 16;
  constructor(public x: number, public y: number) {super();}
  dispDims(): Vec2 { return super.dispDims().mul(2); }
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
export const dt = 1 / 20;
export const updatePeriod = 1 / 20;
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

  if (inputs.left.isDown || alwaysMoveLeft) {
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

export function oscillate(ledge: Ledge, time: number) {
  ledge.bod.setLinearVelocity(Pl.Vec2(Math.cos(time * 2 * Math.PI / ledge.oscPeriod) * oscDist / 2 / ratio, 0));
}

export function update(gameState: GameState, _dt: number = dt, _world: Pl.World = world) {
  // TODO we're feeding inputs every physics tick here, but we send inputs to
  // clients bucketed into the bcasts, which are less frequent.
  for (let player of gameState.players) feedInputs(player, _dt);
  for (let ledge of gameState.ledges) oscillate(ledge, gameState.time);

  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  gameState.time += _dt;
  _world.step(_dt);
  for (let f of postSteps) {
    f();
  }
  for (let player of gameState.players) {
    updateVel(player.bod, ({x,y}) => Pl.Vec2(x, clamp(y, 9)));
    if (
      player.bod.getFixtureList().getAABB(0).lowerBound.y <=
      gameState.lava.bod.getFixtureList().getAABB(0).upperBound.y
    ) {
      player.bod.setPosition(Pl.Vec2(player.bod.getPosition().x, -99999));
      gameState.destroy(player);
    }
  }
  clearArray(postSteps);
}

export function updateEntPhysFromPl(ent) {
  [ent.x, ent.y] = entPosFromPl(ent).toTuple();
  ent.vel.x = ratio * ent.bod.getLinearVelocity().x;
  ent.vel.y = ratio * -ent.bod.getLinearVelocity().y;
}

export function copyVec(v: Pl.Vec2): Pl.Vec2 {
  return Pl.Vec2(v.x, v.y);
}

export function cloneWorld(world: Pl.World): Pl.World {
  // Temporarily clear the user data, since the user data has reverse links pointing back into the
  // (original) world, which would cause cloning to unnecessarily also clone the original world
  // (along with the passed-in world). This drops the time from 500ms to 300ms.
  const userData = [];
  for (let body of Array.from(iterBodies(world))) {
    userData.push(body.getUserData());
    body.setUserData(null);
  }
  const clone: Pl.World = _.cloneDeepWith(world);
  clone.addPair = clone.createContact.bind(clone);
  clone.m_broadPhase.queryCallback = clone.m_broadPhase.__proto__.queryCallback.bind(clone.m_broadPhase);
  for (let [u,a,b] of _.zip(userData, Array.from(iterBodies(world)), Array.from(iterBodies(clone)))) {
    a.setUserData(u);
    b.setUserData(u);
  }
  return clone;
}

export function isClose(a: number, b: number, eps = 1e-9) {
  return Math.abs(a-b) <=  Math.max(eps * Math.max(Math.abs(a), Math.abs(b)), 0);
}

export function veq(a, b, eps = 1e-9) {
  return isClose(a.x, b.x, eps) && isClose(a.y, b.y, eps);
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

export function clamp(x, bound) {
  return Math.min(Math.abs(x), bound) * Math.sign(x);
}

export function* genStyles() {
  while (true) {
    yield 'white';
    yield 'red';
    yield 'yellow';
    yield 'green';
  }
}