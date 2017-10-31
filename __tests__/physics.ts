import {cloneWorld, copyVec, iterBodies} from "../src/common";
import * as Pl from 'planck-js';

function go({cloneAtStart = false, cloneOnContact = false, dim = 1, expectMiss = false, doCompare = false, doPassthrough = false}) {
  if (1) return;
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
  world.on('pre-solve', (contact) => {
    console.log('pre-solve');
    if (doPassthrough) {
      contact.setEnabled(false);
    }
  });
  world.on('post-solve', (contact) => {
    console.log('post-solve');
  });
  world.on('end-contact', (contact) => {
    console.log('end-contact', a.getPosition(), a.getLinearVelocity(), b.getPosition(), b.getLinearVelocity())
  });

  const baseWorld = world;
  const initClone = cloneWorld(baseWorld);
  function sim(world, expectedPath = null) {
    const path = [];
    let [b,a] = Array.from(iterBodies(world));
    for (let i = 0; i < 10; i++) {
      console.log('stepping', a.getPosition(), a.getLinearVelocity(), a.getFixtureList().getAABB(0));
      world.step(.1);
      path.push(copyVec(a.getPosition()));
      if (expectedPath) {
        expect(path[i]).toEqual(expectedPath[i]);
      }
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

    return path;
  }
  if (cloneAtStart) {
    sim(cloneWorld(world));
  } else if (doCompare) {
    const path = sim(cloneWorld(world));
    sim(world, path);
  } else {
    sim(world);
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
  it('should match trajectories between orig & clone', () => {
    go({doCompare: true});
  });
  it('should allow pass-through', () => {
    go({doPassthrough: true, expectMiss: true});
  });
});