import * as Pl from 'planck-js';
import * as _ from 'lodash';
import * as Signals from 'signals';
import * as CBuffer from 'CBuffer';
import * as Chance from 'chance';

CBuffer.prototype.findIndex = function(pred) {
  for (let i = 0; i < this.length; i++) {
    const x = this.get(i);
    if (pred(x,i)) return i;
  }
  return -1;
};

CBuffer.prototype.find = function(pred) {
  const i = this.findIndex(pred);
  return i < 0 ? null : this.get(i);
};

CBuffer.prototype.filter = function(pred) {
  const res = [];
  for (let i = 0; i < this.length; i++) {
    const x = this.get(i);
    if (pred(x,i)) res.push(x);
  }
  return res;
};

export class Logger {
  constructor(public name: string, public handler: LogHandler) {}
  log(...args) { this.handler.log(this.name, args); }
  warn(...args) {
    // TODO note this will double print if flag is an enabled one.
    // TODO also we do not distinguish in the buffers between normal and warning logs.
    console.warn(...args);
    this.handler.log(this.name, args);
  }
}

export class LogHandler {
  buffer = [];
  enabled = new Set<string>(['net']);
  doBuffer = false;
  doCBuffer = true;
  cBuffer = new CBuffer(8192);
  file;
  log(name, msg) {
    const time = now();
    if (this.doBuffer) {
      this.buffer.push([time, name, msg]);
    }
    if (this.doCBuffer) {
      this.cBuffer.push([time, name, msg]);
    }
    if (this.enabled.has(name)) {
      console.log(time, `${name}:`, ...msg);
    }
    if (this.file) {
      this.file.write(`${time} ${name}: ${msg.join(' ')}\n`);
    }
  }
  toText(buffer) {
    return buffer.map(([time, tag, msg]) => `${time} ${tag}: ${msg.join(' ')}`).join('\n');
  }
  bufferToText() {
    return this.toText(this.buffer);
  }
  // For convenient copy(baseHandler.cBufferToText()) in browser console (for analysis in e.g. pandas)
  cBufferToText() {
    return this.toText(this.cBuffer.toArray());
  }
}

export function ensureOne(xs) {
  assert(xs.length == 1);
  return xs[0];
}

export function fixed(x) {
  return +x.toPrecision(12);
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

export const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));
const gWorld = world;

export const gameWorld = {
  width: 4000,
  height: 2000
};

export function* cumsum(xs: number[]) {
  let sum = 0;
  for (let x of xs) {
    sum += x;
    yield sum;
  }
}

export class ServerSettings {
  accel = 25;
  doOsc = false;
  oscDist = gameWorld.width / 8 * 2;
  maxFallSpeed = 9;
  smashSpeed = 20;
  oneWayLedges = true;
  doDiff = true;
  doProtobuf = true;
  doSmashes = false;
  burstLimit = 100;
  ser() {
    return _({}).assign(this);
  }
  deser(data) {
    _.merge(this, data);
  }
}

export const settings = new ServerSettings();

export let alwaysMoveLeft = false;
export const maxNameLen = 32;

export const playerStyleBases = [
  'plain',
  'spacesuit',
  'robot',
  'alien',
  'skeleton',
  'plumber'
];

export const playerStyles = [];
for (let base of playerStyleBases) {
  for (let i = 0; i < 3; i++) {
    playerStyles.push(`${base}-${i}`);
  }
}

export class Timer {
  aborted = false;
  id = ids.next().value;
  constructor(public time: number, public callback: () => void) {}
  cancel() { this.aborted = true; }
}

class SortedSet<T> {
  xs: T[] = [];
  constructor(public cmp: (a:T,b:T) => number) {}
  add(x: T) { this.xs.push(x); }
  remove(x: T) { _.remove(this.xs, x); }
}

export class TimerMgr {
  timers = new SortedSet<Timer>((a,b) => Math.sign(a.time - b.time) || Math.sign(a.id - b.id));
  constructor(public time = 0) {}
  advanceTo(time: number) {
    assert(time >= this.time);
    const {'true': toFire, 'false': toKeep} = _(this.timers.xs)
      // for some reason the iteration protocol always yields an extra undefined at the end and it can't be filtered out!
      .groupBy(x => x && x.time < time)
      .defaults({'true': [], 'false': []})
      .value();
    for (let x of toFire) {
      if (!x.aborted)
        x.callback();
      this.timers.remove(x);
    }
    this.timers.xs = toKeep;
    this.time = time;
  }
  advanceBy(dt: number) {
    return this.advanceTo(this.time + dt);
  }
  at(time: number, callback: () => void) {
    this.timers.add(new Timer(time, callback));
  }
  wait(dur: number, callback: () => void) {
    this.at(this.time + dur, callback);
  }
}

export class GameState {
  timerMgr = new TimerMgr();
  public time = 0;
  public players: Player[] = [];
  public ledges: Ledge[] = [];
  public lava: Lava;
  public stars: Star[] = [];
  public blocks: Block[] = [];
  // not serialized
  public bursters: Burster[] = [];
  onJumpoff = new Signals.Signal();
  onEntCreated = new Signals.Signal();
  constructor(public world: Pl.World = gWorld, public destroy: (killed: Ent, killer?: Ent) => void = () => {}) {}
  getEnts() {
    return (<Ent[]>this.players).concat(this.ledges).concat(this.stars).concat(this.blocks);
  }
  ser() {
    for (let body of Array.from(iterBodies(world))) {
      body.getUserData().bod = null;
    }
    const res = {
//      ents: this.players.map(p => p.ser()),
//      lava: this.lava.ser(),
      time: this.time,
      world: saveWorldWithoutBackRef(this.world)
    };
    for (let body of Array.from(iterBodies(world))) {
      body.getUserData().bod = body;
    }
    return res;
  }
  deser(data) {
    this.time = data.time;
    this.world = restoreWorldWithBackRef(data.world);
    this.lava = new Lava(0, 0);
    this.lava.deser(data.lava);
    const t2bs = bodiesByType(this.world);
    this.players = t2bs.get(Player);
    this.ledges = t2bs.get(Ledge);
    this.stars = t2bs.get(Star);
    [this.lava] = t2bs.get(Lava);
  }
}

export function pushAll(xs, ys) {
  xs.splice(xs.length, 0, ys);
}

export function clearArray(xs) {
  xs.splice(0, xs.length);
}

export function replaceArray<T>(xs: T[], ys: T[]) {
  clearArray(xs);
  pushAll(xs, ys);
}

/**
 * Returns object that contains subset of RHS fields that are different from LHS.
 *
 * Many things we don't worry about - changing fields/schema, changing types, deep recursion, cycles, etc.
 *
 * @param a
 * @param b
 * @returns {{}}
 */
export function objDiff(a, b) {
  const res = {};
  let empty = true;
  for (let k in a) {
    if (!_.isEqual(a[k], b[k])) {
      res[k] = b[k];
      empty = false;
    }
  }
  return empty ? null : res;
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

let getRandomNum = function (min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.random() * (max - min) + min;
};

//The maximum is exclusive and the minimum is inclusive
export function getRandomIntRange(min: number, max: number) {
  return Math.floor(getRandomNum(min, max));
}

export function getRandomInt(min: number, max: number) {
  return getRandomIntRange(min, max + 1);
}

export function makeStar(x: number, y: number, gameState: GameState, xformer = _.noop) {
  const star = new Star(x,y);
  gameState.stars.push(star);
  addBody(star, 'kinematic');
  xformer(star);
  gameState.onEntCreated.dispatch(star);
  return star;
}

export function makeBurst(x: number, y: number, count: number, gameState: GameState) {
  const stars = [];
  for (let i = 0; i < Math.min(settings.burstLimit, count); i++) {
    const star = makeStar(x,y,gameState, (star) => {
      star.bod.setLinearVelocity(Pl.Vec2(
        getRandomNum(-10,10),
        getRandomNum(-10,10)
      ));
      star.bod.getFixtureList().setFilterData({
        categoryBits: 1,
        maskBits: 0,
        filterGroupIndex: 0
      });
      star.vel.x = star.bod.getLinearVelocity().x * ratio;
      star.vel.y = star.bod.getLinearVelocity().y * ratio;
    });
    stars.push(star);
  }
  gameState.bursters.push(new Burster(stars));
}

const entToHitter = new Map<Ent, Player>();
export function create(gameState: GameState) {
  const players = gameState.players, world = gameState.world;
  const log = getLogger('jumpoff');
  const destroy = gameState.destroy;

  function uniqueHit(player, ent, f) {
    if (!entToHitter.has(ent)) {
      entToHitter.set(ent, player);
      return f();
    }
  }

  world.on('post-solve', (contact, imp) => {
    const fA = contact.getFixtureA(), bA = fA.getBody();
    const fB = contact.getFixtureB(), bB = fB.getBody();
    function bounce(fA, bA, fB, bB, reverse: boolean) {
      if (bA.getUserData().type == 'Player') {
        const playerA: Player = bA.getUserData();
        const m = contact.getWorldManifold();
        if (veq(m.normal, Pl.Vec2(0,-1).mul(reverse ? -1 : 1))) {
          log.log('jumping', playerA, bB.getUserData());
          gameState.onJumpoff.dispatch(playerA, bB.getUserData());
          playerA.state = 'normal';
          postStep(() => {
            updateVel(bA, ({x,y}) => Pl.Vec2(x,8));
            if (bB.getUserData() instanceof Player) {
              const playerB: Player = bB.getUserData();
              uniqueHit(playerA, playerB, () => {
                const impact = Math.min(playerA.size, playerB.size);
                playerB.grow(-impact);
                playerA.grow(impact / 2);
                makeBurst(playerB.x, playerB.y,impact / 2 * 10, gameState);
                playerB.state = 'normal';
                if (playerB.size < 1) {
                  destroy(playerB, playerA);
                  playerB.dead = true;
                }
              });
            }
          });
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
        if (doLava && (gameState.lava === bB.getUserData() || bB.getUserData().type == 'Lava')) {
          contact.setEnabled(false);
          const player = bA.getUserData();
          postStep(() => {
            bA.setPosition(Pl.Vec2(bA.getPosition().x, -99999))
            if (destroy) {
              player.state = 'normal';
              player.dead = true;
              destroy(player);
            }
          });
        } else if (bB.getUserData() instanceof Star) {
          // Star may collide with multiple players simultaneously - must attribute the star to only one player.
          contact.setEnabled(false);
          const star: Star = bB.getUserData();
          uniqueHit(player, star, () => {
            postStep(() => {
              player.grow(.1);
              if (destroy) destroy(star, player);
            });
          });
        } else if (bB.getUserData() instanceof Ledge && settings.oneWayLedges) {
          if (
            !(
              veq(contact.m_manifold.localNormal, Pl.Vec2(0,1)) &&
              bA.getLinearVelocity().y <= 0 &&
              bbox(bA).above(bbox(bB))
            )
          ) {
            contact.setEnabled(false);
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

export let Protobuf;
export let pb: any = {};
export function bootstrapPb(_pb) {
  Protobuf = _pb;
  for (let t of 'Bcast Ent Vec2 Player Star'.split(' ')) {
    pb[t] = _pb.lookupType(`main.${t}`);
  }
}

export interface Bcast {
  time: number;
  tick: number;
  bcastNum: number;
  events: Event[];
  ents: Ent[];
  isDiff: boolean;
  buf: Buffer;
}

// simple container so that client can reach in and bump this
class IdState {
  nextId = 0;
}
export const idState = new IdState();
function* genIds() {
  while (true) {
    yield idState.nextId;
    idState.nextId += 1;
  }
}
export const ids = genIds();

export abstract class Serializable {
  type: string;
  // Explicitly pass the type names for items Serialized in the production client (where class names are mangled).
  constructor(typeName?) {
    this.type = typeName || this.constructor.name;
  }
  ser(): this { return this; }
  deser(data) { _.merge(this, data); }
}

export class Vec2 {
  constructor(public x = 0, public y = 0) {}
  add(v: Vec2) { return new Vec2(this.x + v.x, this.y + v.y); }
  sub(v: Vec2) { return new Vec2(this.x - v.x, this.y - v.y); }
  mul(x: number) { return new Vec2(this.x * x, this.y * x); }
  div(x: number) { return new Vec2(this.x / x, this.y / x); }
  len() { return Math.sqrt(this.x**2 + this.y**2); }
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
  dirty = false;
  ser(): this { return <this>_.omit(this, 'bod', 'stack', 'timers', 'dirty'); }
  pos() { return new Vec2(this.x, this.y); }
  dims() { return new Vec2(this.width, this.height); }
  dispDims() { return this.dims(); }
  dispPos(): Vec2 { return this.pos().add(this.dims().sub(this.dispDims()).div(2)); }
  dispAngle() { return 0; }
  midDispPos(): Vec2 { return this.dispPos().add(this.dispDims().div(2)); }
  isDirty() { return this.dirty; }
}

export class Lava extends Ent {
  static width = gameWorld.width;
  static height = 64;
  width = Lava.width;
  height = Lava.height;
  constructor(public x: number, public y: number) {super();}
}

export const totalSquishTime = 0.25;
export class Player extends Ent {
  timers: Timer[] = [];
  state = 'normal';
  width = 24;
  height = 32;
  baseDims = new Vec2(this.width, this.height);
  dir = Dir.Left;
  size = 1;
  currentSquishTime: number = null;
  dead = false;
  smashStart: number = null;
  constructor(public name: string, public x: number, public y: number, public style: string) {super();}

  dispDims() {
    const dims = super.dispDims().mul(1.4);
    if (this.currentSquishTime != null) {
      const currentSquish = 1 - 0.5 * Math.sin(this.currentSquishTime * Math.PI / totalSquishTime);
      dims.y *= currentSquish;
      return dims;
    } else {
      return dims;
    }
  }

  grow(incSize: number) {
    const player = this;
    const bA = player.bod;
    const fA = bA.getFixtureList();
    player.size += incSize;
    [player.width, player.height] = player.baseDims.mul(player.size ** (1 / 3)).toTuple();
    for (let i = 0; i < 4; i++) {
      const v = fA.getShape().getVertex(i);
      fA.getShape().getVertex(i).set(Pl.Vec2(
        player.width / 2 / ratio * Math.sign(v.x),
        player.height / 2 / ratio * Math.sign(v.y)
      ));
    }
    // Mass is computed based on fixture size and density. 2D fixture size only accounts for two of the three
    // dimensions that are assumed to contribute to the mass.  Adjust the density accordingly - it is then the
    // third dimension.  All dimensions are multiplied by the cube root of the `size` multiple, since `size`
    // *is* the mass.
    fA.setDensity(player.size ** (1 / 3));
    bA.resetMassData();
  }

  describe() {
    return `${this.name} (${this.id})`;
  }
}

export const ledgeWidth = 300, ledgeHeight = 10;

export class Ledge extends Ent {
  width = ledgeWidth;
  height = ledgeHeight;
  initPos: Vec2;
  constructor(public x: number, public y: number, public oscPeriod: number) {
    super();
    this.initPos = new Vec2(x,y);
  }
}

export class Block extends Ent {
  constructor(public x: number, public y: number, public width: number, public height: number) {
    super();
  }
}

const gChance = new Chance();
export class Star extends Ent {
  width = 16;
  height = 16;
  dispPosOffset = getRandomInt(0,1000);
  dispDimOffset = getRandomInt(0,1000);
  dispAngleOffset = getRandomInt(0,1000);
  dispPosDist = getRandomInt(0,5);
  dispPosScaler = gChance.floating({min: .5, max: 1.5});
  dispDimScaler = gChance.floating({min: .5, max: 1.5});
  dispAngleScaler = gChance.floating({min: .5, max: 1.5}) * gChance.pickone([1,-1]);
  constructor(public x: number, public y: number) {super();}
  ser(): this { return _.omit(super.ser(),
    'dispDimOffset', 'dispAngleOffset', 'dispPosOffset',
    'dispDimScaler', 'dispAngleScaler', 'dispPosScaler',
    'dispPosDist'); }
  now() { return now(); }
  dispPos() {
    const t = this.dispPosScaler * this.now() + this.dispPosOffset;
    return super.dispPos().add(new Vec2(
      Math.sin(Math.PI * t / 1000),
      Math.cos(Math.PI * t / 1000)
    ).sub(new Vec2(.5, .5)).mul(this.dispPosDist));
  }
  dispDims(): Vec2 {
    const t = this.dispDimScaler * this.now() + this.dispDimOffset;
    return super.dispDims().mul(2 + 1 + Math.sin(Math.PI * t / 1000));
  }
  dispAngle() {
    const t =  this.dispAngleScaler * this.now() + this.dispAngleOffset;
    return t / 10;
  }
}

const burstDur = 1;
export class Burster {
  private elapsed = 0;
  constructor(public ents: Ent[]) {}
  step(dt: number) {
    // start velocity = 2
    // last elapsed = .3
    // last velocity = 1.4
    // curr elapsed = .5
    // curr velocity = ? = last velocity / (1 - last progress) * curr progress
    const lastProgress = this.elapsed / burstDur,
      currProgress = (this.elapsed + dt) / burstDur,
      factor = (1 - currProgress) / (1 - lastProgress);
    for (let ent of this.ents) {
      if (ent.bod.getFixtureList()) {
        if (this.elapsed > .2)
          ent.bod.getFixtureList().setFilterData({
            categoryBits: 1,
            maskBits: 65535,
            filterGroupIndex: 0
          });
        updateVel(ent.bod, ({x, y}) => Pl.Vec2(x * factor, y * factor));
        ent.dirty = true;
      }
    }
    this.elapsed += dt;
    return this.elapsed < burstDur;
  }
}

export class Event extends Serializable {}

export class StartSmash extends Event {
  constructor(public playerId: number) { super("StartSmash"); }
}

export class InputEvent extends Event {
  constructor(public dir: Dir) { super("InputEvent"); }
}

export class KillEv extends Event {
  constructor(public killerId: number, public killedId: number) { super(); }
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
  constructor(public id: number, public killerId?: number) { super(); }
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
export const dt = 1 / 20 / 1;
export const updatePeriod = 1 / 20 / 1;
// physics timestep per real timestep
export const timeWarp = dt / updatePeriod;

export let doAsserts = true;
export function setDoAsserts(x: boolean) { doAsserts = x; }
export function assert(pred, msg = "Assertion failed") {
  if (doAsserts && !pred) throw new Error(msg);
}

function updateVel(bod, f) {
  bod.setLinearVelocity(f(bod.getLinearVelocity()));
}

function feedInputs(player: Player, dt: number, gameState: GameState) {

  if (player.state == 'startingSmash') {
    updateVel(player.bod, (old) => Pl.Vec2(0, 0));
  } else if (player.state == 'smashing') {
    updateVel(player.bod, (old) => Pl.Vec2(0, -settings.smashSpeed));
  } else if (player.state == 'normal') {
    if (player.dir == Dir.Left || alwaysMoveLeft) {
      //  Move to the left
      updateVel(player.bod, ({x, y}) => Pl.Vec2(Math.max(x - settings.accel * dt, -5), y));
    } else if (player.dir == Dir.Right) {
      //  Move to the right
      updateVel(player.bod, ({x, y}) => Pl.Vec2(Math.min(x + settings.accel * dt, 5), y));
    } else {
      ////  Reset the players velocity (movement)
      if (player.bod.getLinearVelocity().x < 0) {
        updateVel(player.bod, ({x, y}) => Pl.Vec2(Math.min(x + settings.accel * dt, 0), y));
      } else {
        updateVel(player.bod, ({x, y}) => Pl.Vec2(Math.max(x - settings.accel * dt, 0), y));
      }
    }
  } else {
    assert(false);
  }

}

export function oscillate(ledge: Ledge, time: number) {
  ledge.bod.setLinearVelocity(Pl.Vec2(Math.cos(time * 2 * Math.PI / ledge.oscPeriod) * +settings.doOsc * settings.oscDist / 2 / ratio, 0));
}

export function update(gameState: GameState, _dt: number = dt, _world: Pl.World = world) {
  gameState.timerMgr.advanceBy(_dt);

  // TODO we're feeding inputs every physics tick here, but we send inputs to
  // clients bucketed into the bcasts, which are less frequent.
  for (let player of gameState.players) feedInputs(player, _dt, gameState);
  for (let ledge of gameState.ledges) oscillate(ledge, gameState.time);
  gameState.bursters = gameState.bursters.filter(b => b.step(_dt));

  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  _world.step(_dt);
  for (let f of postSteps) {
    f();
  }

  // Clear this after every step!
  entToHitter.clear();
  for (let player of gameState.players) {
    updateVel(player.bod, ({x,y}) => Pl.Vec2(x, clamp(y, player.state == 'smashing' ? settings.smashSpeed : settings.maxFallSpeed)));
    if (
      doLava &&
      player.bod.getFixtureList().getAABB(0).lowerBound.y <=
      gameState.lava.bod.getFixtureList().getAABB(0).upperBound.y
    ) {
      player.bod.setPosition(Pl.Vec2(player.bod.getPosition().x, -99999));
      gameState.destroy(player);
    }
  }
  clearArray(postSteps);

  gameState.time += _dt;

  return dt;
}

// Cannot use getAABB(0) because that is the collision detection box, which stretches based on the velocity!
export function fixtureDims(fix) {
  const v = [0,1,2,3].map(i => fix.getShape().getVertex(i)),
    xs = v.map(p => p.x),
    ys = v.map(p => p.y),
    xmax = _(xs).max(),
    xmin = _(xs).min(),
    ymax = _(ys).max(),
    ymin = _(ys).min();
  return {width: xmax - xmin, height: ymax - ymin};
}

export class Box {
  constructor(public x: number, public y: number, public w: number, public h: number) {}
  xf() { return this.x + this.w; }
  yf() { return this.y + this.h; }
  upper() { return new Vec2(this.xf(), this.yf()); }
  lower() { return new Vec2(this.x, this.y); }
  above(other: Box) { return this.lower().y > other.upper().y; }
  below(other: Box) { return this.upper().y < other.lower().y; }
  static fromBounds(x: number, y: number, xf: number, yf: number) {
    return new Box(x, y, xf - x, yf - y);
  }
}

export function bbox(body) {
  const pos = body.getPosition();
  const fix = body.getFixtureList();
  const dims = fixtureDims(fix);
  return new Box(pos.x - dims.width / 2, pos.y - dims.height / 2, dims.width, dims.height);
}

export function updateEntPhysFromPl(ent) {
  const newPos = entPosFromPl(ent);
  const newVel = new Vec2(
    ratio * ent.bod.getLinearVelocity().x,
    ratio * -ent.bod.getLinearVelocity().y
  );
  if (ent.x != newPos.x || ent.y != newPos.y || ent.vel.x != newVel.x || ent.vel.y != newVel.y) {
    ({x: ent.x, y: ent.y} = newPos);
    ({x: ent.vel.x, y: ent.vel.y} = newVel);
    ent.dirty = true;
  }
}

export function copyVec(v: Pl.Vec2): Pl.Vec2 {
  return Pl.Vec2(v.x, v.y);
}

// For smaller delta between client & server.
let forceDateNow = false;
export const now = forceDateNow || typeof performance == 'undefined' ? Date.now : () => performance.now();

export function time(f) {
  const start = now();
  const res = f();
  const end = now();
  console.log(end - start);
  return res;
}

function deepCloneWorld(world: Pl.World): Pl.World {
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

function manuallyCloneWorld(world: Pl.World): Pl.World {
  const newWorld = Pl.World(Pl.Vec2(0, gravity));
  for (let body of Array.from(iterBodies(world)).reverse()) {
    const clone = createBody(newWorld, body.getUserData(), body.getType());
    clone.setLinearVelocity(copyVec(body.getLinearVelocity()));
    clone.setPosition(copyVec(body.getPosition()));
  }
  assert(_.isEqual(
    Array.from(iterBodies(world)).map(body => body.getUserData()),
    Array.from(iterBodies(newWorld)).map(body => body.getUserData())));
  return newWorld;
}

interface BodyData {
  userData: Ent;
  type: string;
  vel: Pl.Vec2;
  pos: Pl.Vec2;
}

interface WorldData {
  bodyData: [BodyData];
}

export function saveWorldWithoutBackRef(world: Pl.World): WorldData {
  const worldData = <WorldData> {
    bodyData: Array.from(iterBodies(world)).reverse().map(body => ({
      userData: body.getUserData() && _(body.getUserData()).chain().clone().extend({bod: null}).value(),
      type: body.getType(),
      // Must snapshot these because vectors can be mutated before postMessage.
      vel: copyVec(body.getLinearVelocity()),
      pos: copyVec(body.getPosition())
    }))
  };
  return worldData;
}

export function restoreWorld(worldData: WorldData) {
  const newWorld = Pl.World(Pl.Vec2(0, gravity));
  for (let bodyData of worldData.bodyData) {
    const clone = createBody(newWorld, bodyData.userData, bodyData.type);
    clone.setLinearVelocity(copyVec(bodyData.vel));
    clone.setPosition(copyVec(bodyData.pos));
  }
  return newWorld;
}

function restoreWorldWithBackRef(worldData: WorldData): Pl.World {
  const newWorld = restoreWorld(worldData);
  for (let body of Array.from(iterBodies(newWorld))) {
    body.setUserData(restoreEnt(body.getUserData()));
    body.getUserData().bod = body;
  }
  return newWorld;
}

function restoreEnt(entData) {
  const entTypes = {Player, Ledge, Lava, Star};
  const ent = new entTypes[entData.type]();
  _.merge(ent, entData);
  return ent;
}

function saveRestoreWorld(world: Pl.World) {
  const newWorld = restoreWorldWithBackRef(_.cloneDeep(saveWorldWithoutBackRef(world)));
  assert(_.isEqual(
    Array.from(iterBodies(world)).map(body => body.getUserData().id),
    Array.from(iterBodies(newWorld)).map(body => body.getUserData().id)));
  return newWorld;
}

export function cloneWorld(world: Pl.World): Pl.World {
  return 1/1 ? saveRestoreWorld(world) : 1/1 ? manuallyCloneWorld(world) : deepCloneWorld(world);
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
  const chance = new Chance(0);
  const weights = [1,1,1].concat(playerStyles.map(() => 0.1).slice(0, -3));
  while (true) {
    yield chance.weighted(playerStyles, weights);
  }
}

export class BodyState {
  constructor(public bod: Pl.Body, public pos: Pl.Vec2, public vel: Pl.Vec2) {}
}

export type PlState = [Ent, BodyState][];

export class WorldState {
  constructor(
    public endTime: number,
    public dir: Dir,
    public dur: number,
    public startTime: number,
    public minDistToTarget: number,
    public finalDistToTarget: number,
    public plState: PlState,
    public mePath: Pl.Vec2[],
    public meVels: Pl.Vec2[],
    public gameState: GameState
  ) {}

  ser() {
    const clone = _(this).clone();
    clone.gameState = null;
    return clone;
  }

  deser(data) {
    _.merge(this, data);
    this.mePath = data.mePath.map(({x,y}) => Pl.Vec2(x,y));
    this.meVels = data.meVels.map(({x,y}) => Pl.Vec2(x,y));
  }
}

export const enum Dir { Left, Right }

export function opp(dir: Dir) {
  return dir == Dir.Left ? Dir.Right : Dir.Left;
}

export function restoreBody(ent, bodyState) {
  ent.bod.setPosition(copyVec(bodyState.pos));
  ent.bod.setLinearVelocity(copyVec(bodyState.vel));
}

export function dist(a: Vec2, b: Vec2) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return Math.sqrt(x*x + y*y);
}

export function setInputsByDir(player: Player, dir: Dir) {
  player.dir = dir;
}

export function getDir(player: Player) {
  return player.dir;
}

export interface BfsParams<V,E> {
  start: V;
  edges: (v: V) => E[];
  traverseEdge: (v: V, e: E) => V;
  cost: (v: V) => number;
}

export interface BfsResult<V,E> {
  bestCost: number;
  bestNode: V;
  bestPath: [V,E][];
  visitedNodes: V[];
}

export function bfs<V,E>({start, edges, traverseEdge, cost}: BfsParams<V,E>): BfsResult<V,E> {
  const queue = [start];
  const cameFrom = new Map<V,[V,E]>();
  let bestNode = start;
  let bestCost = cost(start);
  const visitedNodes = [];
  while (queue.length > 0) {
    const [node] = queue.splice(0,1);
    visitedNodes.push(node);
    if (cost(node) < bestCost) {
      bestNode = node;
      bestCost = cost(node);
    }
    for (let edge of edges(node)) {
      const next = traverseEdge(node, edge);
      queue.push(next);
      cameFrom.set(next, [node, edge]);
    }
  }
  const bestPath = [];
  let node = bestNode;
  while (true) {
    if (node == start) {
      break;
    }
    bestPath.push(cameFrom.get(node));
    node = cameFrom.get(node)[0];
  }
  bestPath.reverse();
  return {bestCost, bestNode, bestPath, visitedNodes};
}

export enum ReplayMode { TIME, STEPS }
export let replayMode = ReplayMode.STEPS;

export const simPeriod = 3000;

//const chunk = 1 / 5, horizon = 6 / 5;
export const chunk = 1, horizon = 6;
export const simDt = dt;

// This enables easier debugging---no runaway server-side simulation while setting breakpoints, no skipped frames,
// no latency/interpolation, exact same resutls between predicted and actual physics.
export let runLocally = false;
export function setRunLocally(x: boolean) {
  runLocally = x;
}

if (replayMode == ReplayMode.STEPS)
  assert(simDt == dt);

export const pathDivergenceEps = .1;
export const steadySimComputeTimeAllowance = 1;
export const initSimComputeTimeAllowance = 1.5;
export const simComputeTimeAllowance = initSimComputeTimeAllowance; // this.lastBestSeq ? steadySimComputeTimeAllowance : initSimComputeTimeAllowance;

// doCloneWorlds is necessary for accurate prediction (proper cloning of collision state), but currently takes 307ms
// vs. 167ms for non-cloning - most of the time goes into _.deepClone().
export let doSimInWorker = false, doCloneWorlds = true, doLava = false;

export let drawAllPaths = false, drawPlans = true, simStars = true, simStarRadius = 500, drawAllPathsIfBestPathDies = true

export const defaultColor = 0xffffff, bestColor = 0xFF0000, bestColors = [
  0xff0000,
  0xffff00,
  0x00ff00,
  0x00ffff,
  0xff00ff,
  0xffffff
];

export let bodiesByType = function (world: Pl.World) {
  const typeToInstances = new Map();
  for (let body of Array.from(iterBodies(world))) {
    const ent = body.getUserData();
    if (!typeToInstances.has(ent.constructor)) {
      typeToInstances.set(ent.constructor, []);
    }
    typeToInstances.get(ent.constructor).push(ent);
  }
  return typeToInstances;
};

export function serSimResults({worldStates, bestWorldState, bestPath}) {
  const wsToIndex = new Map(worldStates.map((x, i) => [x, i]));
  return {
    bestWorldStateIndex: wsToIndex.get(bestWorldState),
    bestPath: bestPath.map(([ws, [dir, dur]]) => [wsToIndex.get(ws), [dir, dur]]),
    worldStatesData: worldStates.map(s => s.ser())
  };
};

export function deserSimResults({worldStatesData, bestWorldStateIndex, bestPath}) {
  const worldStates = worldStatesData.map(data => {
    const ws = new WorldState(null, null, null, null, null, null, null, null, null, null);
    ws.deser(data);
    return ws;
  });
  const results = {
    bestWorldState: worldStates[bestWorldStateIndex],
    bestPath: bestPath.map(([wsi, [dir, dur]]) => [worldStates[wsi], [dir, dur]]),
    worldStates: worldStates
  };
  return results;
};

export class EntMgr {
  constructor(
    public world: Pl.World,
    public gameState: GameState,
    public onEntAdded: (ent: Ent) => void
  ) {}

  addEnt(ent) {
    switch (ent.type) {
      case 'Player':
        this.addPlayer(ent);
        break;
      case 'Ledge':
        this.addLedge(ent);
        break;
      case 'Star':
        this.addStar(ent);
        break;
      case 'Block':
        this.addBlock(ent);
        break;
      default:
        throw new Error();
    }
  }

  addBody(ent, type, fixtureOpts = {}) {
    ent.bod = createBody(this.world, ent, type, fixtureOpts);
    return ent.bod;
  }

  addPlayer(playerObj) {
    const players = this.gameState.players;
    const found = players.find((p) => p.id == playerObj.id);
    if (!found) {
      const player = new Player(playerObj.name, playerObj.x, playerObj.y, playerObj.style);
      _.extend(player, playerObj);
      player.baseDims = Vec2.fromObj(player.baseDims);
      players.push(player);
      this.addBody(player, 'dynamic');
      this.onEntAdded(player);
      return player;
    }
    return found;
  }

  addLedge(ledgeObj) {
    const ledges = this.gameState.ledges;
    if (!ledges.find((p) => p.id == ledgeObj.id)) {
      const ledge = new Ledge(ledgeObj.x, ledgeObj.y, ledgeObj.oscPeriod);
      _.extend(ledge, ledgeObj);
      ledges.push(ledge);
      this.addBody(ledge, 'kinematic');
      this.onEntAdded(ledge);
    }
  }

  addStar(starObj) {
    const gameState = this.gameState;
    if (!gameState.stars.find(s => s.id == starObj.id)) {
      const star = new Star(starObj.x, starObj.y);
      _.extend(star, starObj);
      gameState.stars.push(star);
      this.addBody(star, 'kinematic');
      this.onEntAdded(star);
    }
  }

  addBlock(blockObj) {
    if (!this.gameState.blocks.find(block => block.id == blockObj.id)) {
      const block = new Block(blockObj.x, blockObj.y, blockObj.width, blockObj.height);
      _.extend(block, blockObj);
      this.gameState.blocks.push(block);
      this.addBody(block, 'kinematic');
      this.onEntAdded(block);
    }
  }

}

