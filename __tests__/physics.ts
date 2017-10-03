import {cloneWorld} from "../src/common";
import * as Pl from 'planck-js';

function go({cloneAtStart = false, cloneOnContact = false, dim = 1, expectMiss = false}) {
  console.log(arguments);
  let world = Pl.World(Pl.Vec2(0, -10));
  const a = world.createBody({
    type: 'dynamic',
    fixedRotation: true,
    position: Pl.Vec2(0, 0),
    linearVelocity: Pl.Vec2(1, 0)
  });
  a.createFixture({
    shape: Pl.Box(dim, dim),
    density: 1,
    restitution: 1,
    friction: 0
  });

  const b = world.createBody({
    type: 'dynamic',
    gravityScale: 0,
    fixedRotation: true,
    position: Pl.Vec2(0, -2.5),
    linearVelocity: Pl.Vec2(1, 0)
  });
  b.createFixture({
    shape: Pl.Box(dim, dim),
    density: 1,
    restitution: 1,
    friction: 0
  });

  let contacting = false;
  world.on('begin-contact', (contact) => {
    contacting = true;
    console.log('begin-contact', a.getPosition(), a.getLinearVelocity(), b.getPosition(), b.getLinearVelocity())
  });
  world.on('end-contact', (contact) => {
    console.log('end-contact', a.getPosition(), a.getLinearVelocity(), b.getPosition(), b.getLinearVelocity())
  });

  const baseWorld = world;
  const initClone = cloneWorld(baseWorld);
  if (cloneAtStart) {
    world = cloneWorld(world);
  }
  for (let i = 0; i < 10; i++) {
    console.log(a.getPosition(), a.getLinearVelocity(), a.getFixtureList().getAABB(0));
    world.step(.1);
    if (contacting && cloneOnContact) {
      world = cloneWorld(world);
    }
    contacting = false;
  }

  if (expectMiss) {
    expect(a.getPosition().y).toBeLessThan(b.getPosition().y);
  } else {
    expect(a.getPosition().y).toBeGreaterThan(b.getPosition().y);
  }
}

describe('collisions', () => {
  it('should work even when broken up by cloneWorld', () => {
    go({cloneOnContact: true});
  });
  it('should work after cloneWorld', () => {
    go({cloneAtStart: true});
  });
  it('should work with bodies smaller than velocity', () => {
    // we almost tunnel through - we travel from -2.1 to -2.8, with the other item at -2.5.  box2d still somehow
    // figures out this needs to bounce backward, rather than "bounce through."
    go({dim: .2});
  });
  it('should fail (expected limitation) when velocity >> body', () => {
    go({dim: .19, expectMiss: true});
  });
});
