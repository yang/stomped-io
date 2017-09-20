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

var omit = function(obj, key) {
    var newObj = {};

    for (var name in obj){
        if (name !== key) {
            newObj[name] = obj[name];
        }
    }

    return newObj;
};

export class GameObj {
  width: number;
  height: number;
  x: number;
  y: number;
  ser() {
    return omit(this, 'bod');
  }
}

export class Lava extends GameObj {
  width = 800;
  height = 64;
  constructor(public x: number, public y: number) {super();}
}

export class Player extends GameObj {
  inputState = new InputState();
  width = 32;
  height = 48;
  constructor(public name: string, public x: number, public y: number) {super();}
}

export const ledgeWidth = 300, ledgeHeight = 32;

export class Ledge extends GameObj {
  bod: Pl.Body;
  width = ledgeWidth;
  height = ledgeHeight;
  constructor(public x: number, public y: number) {super();}
}

//export interface Event {}
//
//export class AddObj extends Event {
//  constructor(public obj: GameObj) {}
//}
//
//export class RemObj extends Event {
//  constructor(public id: number) {}
//}

export function addBody(gameObj, type, fixtureOpts = {}) {
  gameObj.bod = world.createBody({
    type: type,
    fixedRotation: true,
    position: Pl.Vec2((gameObj.x + gameObj.width / 2) / ratio, -(gameObj.y + gameObj.height / 2) / ratio),
    userData: gameObj
  });
  gameObj.bod.createFixture(Object.assign({
    shape: Pl.Box(gameObj.width / 2 / ratio, gameObj.height / 2 / ratio),
    density: 1,
    restitution: 1,
    friction: 0
  }, fixtureOpts));
  return gameObj.bod;
}

let lastTime = null;
const dt = 1 / 60.;
export const updatePeriod = dt;

export function update() {
  const currTime = Date.now() / 1000;

  if (lastTime == null) lastTime = Date.now() / 1000;

  world.step(dt);
}
