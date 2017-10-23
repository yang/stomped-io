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
  doBuffer = false;
  file;
  log(name, msg) {
    if (this.doBuffer) {
      this.buffer.push([name, msg]);
    }
    if (this.enabled.has(name)) {
      console.log(`${name}:`, ...msg);
    }
    if (this.file) {
      this.file.write(`${name}: ${msg.join(' ')}\n`);
    }
  }
  // For convenient copy(baseHandler.toText()) in browser console
  toText() {
    return this.buffer.map(([tag, msg]) => `${tag}: ${msg.join(' ')}`).join('\n');
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
export const accel = 10;

export const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));
const gWorld = world;

export const gameWorld = {
  width: 1600,
  height: 800
};

export function* cumsum(xs: number[]) {
  let sum = 0;
  for (let x of xs) {
    sum += x;
    yield sum;
  }
}

export const debugMode = true;
export const oscDist = debugMode ? 0 : gameWorld.width / 8 * 2;

export let alwaysMoveLeft = false;

export class GameState {
  public time = 0;
  public players: Player[] = [];
  public ledges: Ledge[] = [];
  public lava: Lava;
  public stars: Star[] = [];
  public blocks: Block[] = [];
  onJumpoff = new Signals.Signal();
  constructor(public world: Pl.World = gWorld, public destroy = _.noop) {}
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
    this.lava = new Lava(0,0);
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
  const entToKiller = new Map<Ent, Player>();
  const log = getLogger('jumpoff');
  const destroy = gameState.destroy;

  function uniqueKill(player, ent, f) {
    if (!entToKiller.has(ent)) {
      entToKiller.set(ent, player);
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
          postStep(() => {
            updateVel(bA, ({x,y}) => Pl.Vec2(x,8));
            if (bB.getUserData() instanceof Player) {
              const playerB: Player = bB.getUserData();
              uniqueKill(playerA, playerB, () => {
                destroy(playerB, playerA);
                playerB.dead = true;
                playerA.grow(playerB.size);
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
              player.dead = true;
              destroy(player);
            }
          });
        } else if (bB.getUserData() instanceof Star) {
          // Star may collide with multiple players simultaneously - must attribute the star to only one player.
          contact.setEnabled(false);
          const star: Star = bB.getUserData();
          uniqueKill(player, star, () => {
            postStep(() => {
              player.grow(.1);
              if (destroy) destroy(star);
            });
          });
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
  constructor() {
    this.type = this.constructor.name;
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
  ser(): this { return <this>_.omit(this, 'bod', 'stack'); }
  pos() { return new Vec2(this.x, this.y); }
  dims() { return new Vec2(this.width, this.height); }
  dispDims() { return this.dims(); }
  dispPos(): Vec2 { return this.pos().add(this.dims().sub(this.dispDims()).div(2)); }
  midDispPos(): Vec2 { return this.dispPos().add(this.dispDims().div(2)); }
}

export class Lava extends Ent {
  width = gameWorld.width;
  height = 64;
  constructor(public x: number, public y: number) {super();}
}

export const totalSquishTime = 0.25;
export class Player extends Ent {
  width = 24;
  height = 32;
  baseDims = new Vec2(this.width, this.height);
  inputs = new Inputs();
  size = 1;
  currentSquishTime: number = null;
  dead = false;
  constructor(public name: string, public x: number, public y: number, public style: string) {super();}
  dispDims() {
    const dims = super.dispDims().mul(1.2);
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

export class Block extends Ent {
  constructor(public x: number, public y: number, public width: number, public height: number) {
    super();
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
      doLava &&
      player.bod.getFixtureList().getAABB(0).lowerBound.y <=
      gameState.lava.bod.getFixtureList().getAABB(0).upperBound.y
    ) {
      player.bod.setPosition(Pl.Vec2(player.bod.getPosition().x, -99999));
      gameState.destroy(player);
    }
  }
  clearArray(postSteps);

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

export function updateEntPhysFromPl(ent) {
  // Destroyed objects have no fixtures
  if (ent.bod.getFixtureList()) {
    const d = fixtureDims(ent.bod.getFixtureList());
    [ent.width, ent.height] = [d.width * ratio, d.height * ratio];
  }
  [ent.x, ent.y] = entPosFromPl(ent).toTuple();
  ent.vel.x = ratio * ent.bod.getLinearVelocity().x;
  ent.vel.y = ratio * -ent.bod.getLinearVelocity().y;
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
      userData: _(body.getUserData()).chain().clone().extend({bod: null}).value(),
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
  while (true) {
    yield 'white';
    yield 'red';
    yield 'yellow';
    yield 'green';
  }
}

class BodyState {
  constructor(public bod: Pl.Body, public pos: Pl.Vec2, public vel: Pl.Vec2) {}
}

type PlState = [Ent, BodyState][];

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

function restoreBody(ent, bodyState) {
  ent.bod.setPosition(copyVec(bodyState.pos));
  ent.bod.setLinearVelocity(copyVec(bodyState.vel));
}

function dist(a: Vec2, b: Vec2) {
  const x = a.x - b.x;
  const y = a.y - b.y;
  return Math.sqrt(x*x + y*y);
}

function setInputs(player: Player, [left, right]: [boolean, boolean]) {
  player.inputs.left.isDown = left;
  player.inputs.right.isDown = right;
}

export function setInputsByDir(player: Player, dir: Dir) {
  setInputs(player, dir == Dir.Left ? [true, false] : [false, true]);
}

export function getDir(player) {
  return player.inputs.left.isDown ? Dir.Left :
    player.inputs.right.isDown ? Dir.Right : null;
}

interface BfsParams<V,E> {
  start: V;
  edges: (v: V) => E[];
  traverseEdge: (v: V, e: E) => V;
  cost: (v: V) => number;
}

interface BfsResult<V,E> {
  bestCost: number;
  bestNode: V;
  bestPath: [V,E][];
  visitedNodes: V[];
}

function bfs<V,E>({start, edges, traverseEdge, cost}: BfsParams<V,E>): BfsResult<V,E> {
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

enum ReplayMode { TIME, STEPS }
let replayMode = ReplayMode.STEPS;

const simPeriod = 3000;

//const chunk = 1 / 5, horizon = 6 / 5;
const chunk = 1, horizon = 6;
const simDt = dt;

// This enables easier debugging---no runaway server-side simulation while setting breakpoints, no skipped frames,
// no latency/interpolation, exact same resutls between predicted and actual physics.
export let runLocally = false;
export function setRunLocally(x: boolean) {
  runLocally = x;
}

if (replayMode == ReplayMode.STEPS)
  assert(simDt == dt);

const pathDivergenceEps = .1;
const steadySimComputeTimeAllowance = 1;
const initSimComputeTimeAllowance = 1.5;
const simComputeTimeAllowance = initSimComputeTimeAllowance; // this.lastBestSeq ? steadySimComputeTimeAllowance : initSimComputeTimeAllowance;

// doCloneWorlds is necessary for accurate prediction (proper cloning of collision state), but currently takes 307ms
// vs. 167ms for non-cloning - most of the time goes into _.deepClone().
export let doSimInWorker = false, doCloneWorlds = true, doLava = false;

let drawAllPaths = false, drawPlans = true, simStars = true, simStarRadius = 500, drawAllPathsIfBestPathDies = true

export const defaultColor = 0xffffff, bestColor = 0xFF0000, bestColors = [
  0xff0000,
  0xffff00,
  0x00ff00,
  0x00ffff,
  0xff00ff,
  0xffffff
];

let bodiesByType = function (world: Pl.World) {
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

export class Bot {
  target: Vec2;
  lastSimTime = null;
  lastWorldStates;
  lastBestSeq: WorldState[];
  lastChunk: WorldState;
  chunkSteps: number = 0;
  chunkStepsAtStartOfSim = 0;
  simRunning = false;
  initPlan: [Dir, number][];
  onSim = new Signals.Signal();

  constructor(
    public player: Player,
    public gameState: GameState,
    public socket,
    public pool,
    public isDumb: boolean
  ) {}

  ser() {
    return {
      playerId: this.player.id,
      target: this.target,
      initPlan: this.initPlan
    };
  }
  deser(botData) {
    this.target = Vec2.fromObj(botData.target);
    this.initPlan = botData.initPlan;
  }

  private lastDumbTime = 0;
  private lastNearest: Player = null;
  private lastDirChange = 0;
  dumbPlan() {
    const me = this.player;
    const currTime = now();
    if (currTime - this.lastDumbTime > 5000) {
      const players = this.gameState.players.filter(p => p != me);
      if (players.length > 0) {
        this.lastNearest = _(players).minBy(p => p.pos().sub(me.pos()).len());
        this.lastDumbTime = currTime;
        this.lastDirChange = 0;
      }
    }
    if (this.lastNearest && currTime - this.lastDirChange > 500) {
      if (this.lastNearest.dead) {
        // so next round we will look for someone new
        this.lastDumbTime = 0;
      }
      this.reallySetInput(this.lastNearest.x <= me.x ? Dir.Left : Dir.Right, currTime);
      this.lastDirChange = currTime;
    }
  }

  capturePlState(): PlState {
    return this.gameState.getEnts().map((ent) => <[Ent, BodyState]> [
      ent, new BodyState(
        ent.bod, copyVec(ent.bod.getPosition()), copyVec(ent.bod.getLinearVelocity())
      )
    ]);
  }

  getWorldState(plState: PlState, gameState: GameState): WorldState {
    const me = this.player;
    return new WorldState(
      0,
      null,
      0,
      0,
      dist(entPosFromPl(me), this.target),
      dist(entPosFromPl(me), this.target),
      plState,
      [plPosFromEnt(me)],
      [],
      gameState
    );
  }

  getCurrChunk(currTime: number): [WorldState, number, number] {
    if (replayMode == ReplayMode.TIME) {
      let currChunk;
      const elapsed = (currTime - this.lastSimTime) / 1000;
      let index;
      for (let i = 0; elapsed >= this.lastBestSeq[i].endTime; i++) {
        currChunk = this.lastBestSeq[i + 1];
        index = i;
      }
      return [currChunk, index, 0];
    } else if (replayMode == ReplayMode.STEPS) {
      const cumsums = Array.from(cumsum(this.lastBestSeq.map(s => s.mePath.length - 1)));
      let i = 1;
      let currChunk;
      const chunkSteps = this.chunkSteps || 0;
      while (true) {
        currChunk = this.lastBestSeq[i];
        if (cumsums[i] <= chunkSteps) {
          i++;
          continue;
        } else {
          return [currChunk, i, chunkSteps - (i == 0 ? 0 : cumsums[i - 1])];
        }
      }
    } else {
      throw new Error();
    }
  }

  getInitPlan(): [Dir, number][] {
    const me = this.player;
    if (this.lastBestSeq) {
      const [currChunk, idx, steps] = this.getCurrChunk(-1);
      const startTimeInCurrentPlan = fixed(currChunk.startTime + steps * simDt);
      const simEndTimeInCurrentPlan = fixed(startTimeInCurrentPlan + simComputeTimeAllowance);
      // simPeriod = 2 steps:
      //
      // L L R R L L R R
      // 0 1 0 1 0 1 0 1
      //       [____) simtime = 1.5: R L L
      //       [__) simtime = 1.0: R L
      //       ^ chunkSteps
      return _(this.lastBestSeq)
        .dropWhile(c => c != currChunk)
        .takeWhile(c => c.startTime < simEndTimeInCurrentPlan)
        .map<[Dir, number]>(c => [
          c.dir,
          fixed(
            c == currChunk ? c.dur - steps * simDt :
              c.endTime < simEndTimeInCurrentPlan ? c.dur :
                simEndTimeInCurrentPlan - c.startTime
          )
        ])
        .value();
    } else {
      return [[getDir(me), simComputeTimeAllowance]];
    }
  }

  runSims(startState: WorldState, simFunc: (node: WorldState, edge: [Dir, number]) => WorldState) {
    const me = this.player;
    const initPlan: [Dir, number][] = this.initPlan;
    const sums = [0].concat(Array.from(cumsum(initPlan.map(([dir, dur]) => fixed(dur)))));
    assert(_(sums).last() == simComputeTimeAllowance);
    const initPlanMap = new Map<number, [Dir, number]>(
      _.zip<[Dir, number]|number>(initPlan, sums)
        .map(([edge, sum]) => <[number, [Dir, number]]> [sum, edge])
    );
    return time(() => {
      const {bestNode: bestWorldState, bestCost, bestPath, visitedNodes: worldStates} = bfs<WorldState, [Dir, number]>({
        start: startState,
        edges: (worldState) =>
          worldState.endTime < simComputeTimeAllowance ?
            [initPlanMap.get(worldState.endTime)] :
            worldState.endTime < horizon ?
              [[Dir.Left, chunk], [Dir.Right, chunk]] :
              [],
        traverseEdge: simFunc,
        cost: (worldState) => worldState.endTime < horizon ? 9999999 : worldState.finalDistToTarget
      });
      return {bestWorldState, bestPath, worldStates};
    });
  }

  runSimsReuse() {
    const me = this.player, gameState = this.gameState;
    const startState = this.getWorldState(this.capturePlState(), gameState);
    const res = this.runSims(startState, (init, [dir, chunk]) => {
      // restore world state
      for (let [ent, bodyState] of init.plState) restoreBody(ent, bodyState);
      const origInputs: [boolean, boolean] = [me.inputs.left.isDown, me.inputs.right.isDown];
      setInputsByDir(me, dir);
      const stars = gameState.stars;
      clearArray(gameState.stars);
      const res = this.sim(dir, chunk, world, gameState, init, world => this.capturePlState());
      setInputs(me, origInputs);
      pushAll(gameState.stars, stars);
      return res;
    });
    // revert bodies to their original states
    for (let [ent, bodSt] of startState.plState) {
      ent.bod.setPosition(copyVec(bodSt.pos));
      ent.bod.setLinearVelocity(copyVec(bodSt.vel));
    }
    return res;
  }

  runSimsInWorker() {
    const log = getLogger('worker');
    const startTime = now();
    const gameStateData = this.gameState.ser();
    const botData = this.ser();
    this.simRunning = true;
    log.log('spawning worker for player', this.player.id);
    const promise = this.pool.exec('sim', [botData, gameStateData]);
    this.chunkStepsAtStartOfSim = this.chunkSteps;
    getLogger('worker.consistency').log(
      'from outside worker:',
      plPosFromEnt(this.player),
      copyVec(this.player.bod.getPosition())
    );
    return new Promise((resolve, reject) =>
      promise.then(({bestWorldStateIndex, bestPath, worldStatesData}) =>
        setImmediate(() => {
          log.log('returned from worker for player', this.player.id, 'in', now() - startTime, ', chunkSteps =', this.chunkSteps);
          this.simRunning = false;
          this.chunkSteps -= this.chunkStepsAtStartOfSim;
          resolve(deserSimResults({worldStatesData, bestWorldStateIndex, bestPath}));
        })
      ).catch(err => {
        console.error(err);
      })
    );
  }

  runSimsClone() {
    const me = this.player, gameState = this.gameState;
    const initGameState = _.clone(gameState);
    initGameState.destroy = _.noop;
    if (!simStars) {
      initGameState.stars = [];
    } else if (simStarRadius) {
      _.remove(initGameState.stars, s =>
        s.pos().sub(me.pos()).len() >= simStarRadius);
    }
    initGameState.players = [me];
    initGameState.world = cloneWorld(gameState.world);
    const starIds = new Set(gameState.stars.map(s => s.id));
    for (let body of Array.from(iterBodies(initGameState.world))) {
      if (body.getUserData() instanceof Star && !starIds.has(body.getUserData().id)) {
        initGameState.world.destroyBody(body);
      }
      if (body.getUserData() instanceof Player && me.id != body.getUserData().id) {
        initGameState.world.destroyBody(body);
      }
    }
    const startState = this.getWorldState([], initGameState);
    getLogger('worker.consistency').log(
      'from in worker:',
      plPosFromEnt(this.player),
      copyVec(this.player.bod.getPosition())
    );
    assert(veq(plPosFromEnt(this.player), this.player.bod.getPosition()));
    return this.runSims(startState, (init, [dir, chunk]) => {
      const world = cloneWorld(init.gameState.world);
      world._listeners = {};
      let newPlayers, newLedges;
      if (0/1) {
        const entToNewBody = new Map(
          Array.from(iterBodies(world)).map<[Ent, Pl.Body]>(b => [b.getUserData(), b])
        );
        newLedges = init.gameState.ledges.map(l => {
          const m = new Ledge(l.x, l.y, l.oscPeriod);
          m.id = l.id;
          m.bod = entToNewBody.get(l);
          return m;
        });
        newPlayers = init.gameState.players.map(p => {
          const q = new Player(p.name, p.x, p.y, p.style);
          q.id = p.id;
          q.bod = entToNewBody.get(p);
          q.size = p.size;
          q.width = p.width;
          q.height = p.height;
          setInputs(q, [p.inputs.left.isDown, p.inputs.right.isDown]);
          return q;
        });
        for (let ent of [].concat(newLedges).concat(newPlayers)) {
          ent.bod.setUserData(ent);
        }
      } else {
        const typeToInstances = bodiesByType(world);
        newLedges = typeToInstances.get(Ledge);
        newPlayers = typeToInstances.get(Player);
      }
      // What needs to be cloned depends on how .bod is traversed in Common.update() and potentially how the collision
      // handlers use it.
      // No need to clone lava.
      const newMe = newPlayers.find(p => p.id == me.id);
      setInputsByDir(newMe, dir);
      const newGameState = _.clone(init.gameState);
      newGameState.ledges = newLedges;
      newGameState.players = newPlayers;
      newGameState.world = world;
      newGameState.onJumpoff = new Signals.Signal();
      create(newGameState);
      return this.sim(dir, chunk, world, newGameState, init, world => []);
    });
  }

  // simulate core logic
  sim(dir: Dir, chunk: number, world: Pl.World, gameState: GameState, init: WorldState, capturePlState: (world: Pl.World) => PlState) {
    const me = this.player;
    let minDistToTarget = 9999999, distance = null;
    const mePath = [], meVels = [];
    const meBody = Array.from(iterBodies(world)).find(b => b.getUserData().id == me.id);
    mePath.push(copyVec(meBody.getPosition()));
    meVels.push(copyVec(meBody.getLinearVelocity()));
    for (let i = 0; i < chunk / simDt; i++) {
      update(gameState, simDt, world);
      if (Math.abs(mePath[mePath.length - 1].y) > gameWorld.height / ratio &&
        Math.abs(meBody.getPosition().y) < gameWorld.height / ratio) {
        console.log('jerking');
      }
      mePath.push(copyVec(meBody.getPosition()));
      meVels.push(copyVec(meBody.getLinearVelocity()));
      distance = dist(entPosFromPl(me, meBody.getPosition()), this.target);
      minDistToTarget = Math.min(minDistToTarget, distance);
    }
    return new WorldState(
      init.endTime + chunk,
      dir,
      chunk,
      init.endTime,
      minDistToTarget,
      distance,
      capturePlState(world),
      mePath,
      meVels,
      gameState
    );
  }

  reallySetInput(dir: Dir, currTime: number) {
    const me = this.player;
    setInputsByDir(me, dir);
    if (this.socket)
      this.socket.emit('input', {time: currTime, events: [new InputEvent(me.inputs)]});
  }

  replayChunkStep(currTime: number, resetting: boolean) {
    const me = this.player;
    const log = getLogger('replay');
    const [currChunk, idx, steps] = this.getCurrChunk(currTime);
    if (this.lastChunk != currChunk) {
      log.log('switching from old chunk to new chunk',
        (this.lastChunk || <any>{}).startTime,
        (currChunk || <any>{}).startTime);
      if (!resetting && this.chunkSteps && this.chunkSteps < chunk / simDt) {
        log.log('switching from old chunk ', this.lastChunk && this.lastChunk.endTime, ' to new chunk ', currChunk.endTime, ', but did not execute all steps in last chunk!');
      }
    }
    this.lastChunk = currChunk;
//  console.log(currChunk.dir, this.chunkSteps, (currTime - this.lastSimTime) / (1000 * chunk / timeWarp), currTime - this.lastSimTime, 1000 * chunk / timeWarp, currTime, this.lastSimTime);
    if (currChunk && getDir(me) != currChunk.dir) {
      //console.log(getDir(me), currChunk.dir, (currTime - this.lastSimTime) / (1000 * chunk / timeWarp))
      this.reallySetInput(currChunk.dir, currTime);
    }
  }

  replayPlan(updating: boolean, currTime: number) {
    // High-level structure:
    // Replay existing plan step
    // If simming: sim, then replay that first plan step
    // Finally, increment step counter, to keep pace with later Common.update() call
    const log = getLogger('replay');
    if (!this.isDead() && (!runLocally || updating)) {
      if (this.lastBestSeq) {
        this.replayChunkStep(currTime, false);
      }
      let doSim = false;
      if (replayMode == ReplayMode.TIME) {
        doSim = this.lastSimTime == null || currTime - this.lastSimTime > simPeriod / timeWarp;
      } else if (replayMode == ReplayMode.STEPS) {
        log.log(this.lastChunk && this.lastChunk.endTime - chunk, this.chunkSteps, this.lastChunk && (this.chunkSteps * simDt / chunk) * 1000);
        doSim = !this.simRunning && (!this.lastChunk || (this.chunkSteps * simDt / chunk) * 1000 > simPeriod);
      } else {
        throw new Error();
      }
      if (doSim) {
        const handleRes = ({worldStates, bestPath, bestWorldState}) => {
          this.lastWorldStates = worldStates;
          this.lastBestSeq = bestPath.map(([ws, dir]) => ws).concat([bestWorldState]);
          getLogger('sim-res').log('simulated', this.lastBestSeq);
          this.onSim.dispatch({worldStates, bestPath, bestWorldState});
        };
        this.lastSimTime = currTime;
        this.initPlan = this.getInitPlan();
        if (doSimInWorker) {
          this.runSimsInWorker().then(handleRes);
        } else {
          handleRes(doCloneWorlds ? this.runSimsClone() : this.runSimsReuse());
          this.chunkSteps = 0;
          if (this.lastBestSeq.length > 1 && !doSimInWorker) {
            this.replayChunkStep(currTime, true);
          }
        }
      }
      this.chunkSteps += 1;
    }
  }

  isDead() {
    return this.player.dead;
  }

  drawPlan(gfx) {
    const me = this.player;
    if (drawPlans && this.target && !this.isDead()) {
      gfx.lineStyle(1,defaultColor,1);

      gfx.drawCircle(this.target.x, this.target.y, 100);

      if (this.lastWorldStates) {
        const poly = [{x: -1,y: -1}, {x: -1, y: 1}, {x: 1, y: 0}, {x: -1, y: -1}].map(({x,y}) => ({x: 5*x, y: 5*y}));
        const bcolors = bestColors.concat(bestColors).concat(bestColors)[Symbol.iterator]();
        const bestPathDies = this.lastBestSeq.find(s => s.finalDistToTarget > 9999);
        const doDrawAllPaths = drawAllPaths || drawAllPathsIfBestPathDies && bestPathDies;
        const pathsToDraw = (doDrawAllPaths ? this.lastWorldStates : []).concat(this.lastBestSeq);
        for (let worldState of pathsToDraw) {
          gfx.lineStyle(1, this.lastBestSeq.includes(worldState) ? bcolors.next().value : defaultColor, 1);
          const startPos = entPosFromPl(me, worldState.mePath[0], true).toTuple();
          if (worldState.dir == null) {
            gfx.drawCircle(...startPos, 10);
          } else {
            const dirSign = Dir.Left == worldState.dir ? -1 : 1;
            gfx.drawPolygon(poly.map(({x,y}) => ({x: dirSign*x+startPos[0], y: y+startPos[1]})));
          }
          gfx.moveTo(...startPos);
          // if (_.find(worldState.mePath, (pos: Pl.Vec2) => Math.abs(pos.y) > 9999)) {
          //   console.log(worldState.mePath.map((pos) => entPosFromPl(me, pos).y).join(' '));
          // }
          for (let pos of worldState.mePath.slice(1)) {
            gfx.lineTo(...entPosFromPl(me, pos, true).toTuple());
          }
          for (let pos of worldState.mePath.slice(1)) {
            const dirSign = Dir.Left == worldState.dir ? -1 : 1;
            const entPos = entPosFromPl(me, pos, true);
            gfx.drawPolygon(poly.map(({x,y}) => ({x: dirSign*x+entPos.x, y: y+entPos.y})));
          }
        }
        if (bestPathDies && this.chunkSteps == 1) {
          console.error('best path dies!');
        }
      }
    }
  }

  checkPlan(currTime: number) {
    const me = this.player;
    if (this.target && !this.isDead() && replayMode == ReplayMode.STEPS && this.lastBestSeq) {
      const [currChunk, idx, steps] = this.getCurrChunk(currTime);
      if (currChunk && !veq(me.bod.getPosition(), currChunk.mePath[steps], pathDivergenceEps)) {
        console.error('diverging from predicted path!');
      }
    }
  }
}

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

export class BotMgr {
  bots: Bot[] = [];

  constructor(
    public styleGen,
    public entMgr: EntMgr,
    public gameState: GameState,
    public socket,
    public pool,
    private nameGen
  ) {}

  maybeAddProxy(botData) {
    const player = this.gameState.players.find(p => p.id == botData.playerId);
    if (player) {
      const bot = new Bot(
        player,
        this.gameState,
        this.socket,
        this.pool,
        false
      );
      this.bots.push(bot);
      return bot;
    } else {
      return null;
    }
  }

  makeBot(isDumb: boolean) {
    const entMgr = this.entMgr, gameState = this.gameState;
    const player = entMgr.addPlayer(_.assign({}, new Player(
      this.nameGen ? this.nameGen.next().value : 'bot',
      gameState.ledges[2].x + ledgeWidth / 2,
      gameState.ledges[2].y - 50,
      this.styleGen.next().value
    )));
    player.inputs.left.isDown = true;
    const bot = new Bot(player, gameState, this.socket, this.pool, isDumb);
    bot.target = new Vec2(0,0);
    this.bots.push(bot);
    return bot;
  }
}