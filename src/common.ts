import * as Pl from 'planck-js';

export const ratio = 24;

const gravity = -10;
export const world = Pl.World(Pl.Vec2(0, gravity));

export class InputState {
  isDown = false;
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

export class Ent {
  width: number;
  height: number;
  x: number;
  y: number;
  type: string;
  constructor() {
    this.type = this.constructor.name;
  }
  id = ids.next().value;
  ser() {
    return omit(this, 'bod');
  }
}

export class Lava extends Ent {
  width = 800;
  height = 64;
  constructor(public x: number, public y: number) {super();}
}

export class Player extends Ent {
  inputState = new InputState();
  width = 32;
  height = 48;
  constructor(public name: string, public x: number, public y: number) {super();}
}

export const ledgeWidth = 300, ledgeHeight = 32;

export class Ledge extends Ent {
  bod: Pl.Body;
  width = ledgeWidth;
  height = ledgeHeight;
  constructor(public x: number, public y: number) {super();}
}

export interface Event {}

export class AddEnt implements Event {
  constructor(public ent: Ent) {}
}

export class RemEnt implements Event {
  constructor(public id: number) {}
}

export function addBody(ent, type, fixtureOpts = {}) {
  ent.bod = world.createBody({
    type: type,
    fixedRotation: true,
    position: Pl.Vec2((ent.x + ent.width / 2) / ratio, -(ent.y + ent.height / 2) / ratio),
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
const dt = 1 / 60.;
export const updatePeriod = dt;

export function update() {
  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  world.step(dt);
}
