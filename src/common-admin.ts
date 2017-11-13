import * as Pl from 'planck-js';
import * as _ from "lodash";
import {
  assert,
  bestColors,
  bfs,
  bodiesByType,
  BodyState,
  chunk,
  clearArray,
  cloneWorld,
  copyVec,
  create,
  cumsum,
  defaultColor,
  deserSimResults,
  Dir,
  dist,
  doCloneWorlds,
  doSimInWorker,
  drawAllPaths,
  drawAllPathsIfBestPathDies,
  drawPlans,
  Ent,
  EntMgr,
  entPosFromPl,
  fixed,
  GameState,
  gameWorld,
  getDir,
  getLogger,
  getRandomIntRange,
  horizon,
  InputEvent,
  iterBodies,
  Ledge,
  now, opp,
  pathDivergenceEps,
  Player,
  plPosFromEnt,
  PlState,
  pushAll,
  ratio,
  replayMode,
  ReplayMode,
  restoreBody,
  runLocally,
  setInputsByDir,
  simComputeTimeAllowance,
  simDt,
  simPeriod,
  simStarRadius,
  simStars,
  Star,
  time,
  timeWarp,
  update,
  Vec2,
  veq,
  world,
  WorldState
} from "./common";
import * as Signals from "signals";
import {Chance} from 'chance';

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
  chance = new Chance(0);

  constructor(public player: Player,
              public gameState: GameState,
              public socket,
              public pool,
              public isDumb: boolean,
              private keepPlayingFor = 0,
              private onRejoin = null) {
  }

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
      const dir = this.lastNearest.x <= me.x ? Dir.Left : Dir.Right;
      // Randomly diverging from plan helps add some unpredictability and also prevents getting stuck in the same
      // thing, e.g. a big bot pinning you against a wall forever.
      this.reallySetInput(this.chance.bool({likelihood: 10}) ? opp(dir) : dir, currTime);
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
      _.zip<[Dir, number] | number>(initPlan, sums)
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
      const origDir = me.dir;
      setInputsByDir(me, dir);
      const stars = gameState.stars;
      clearArray(gameState.stars);
      const res = this.sim(dir, chunk, world, gameState, init, world => this.capturePlState());
      setInputsByDir(me, origDir);
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
      if (0 / 1) {
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
          setInputsByDir(q, p.dir);
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
      this.socket.emit('input', {time: currTime, events: [new InputEvent(me.dir)]});
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
      gfx.lineStyle(1, defaultColor, 1);

      gfx.drawCircle(this.target.x, this.target.y, 100);

      if (this.lastWorldStates) {
        const poly = [{x: -1, y: -1}, {x: -1, y: 1}, {x: 1, y: 0}, {x: -1, y: -1}].map(({x, y}) => ({
          x: 5 * x,
          y: 5 * y
        }));
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
            gfx.drawPolygon(poly.map(({x, y}) => ({x: dirSign * x + startPos[0], y: y + startPos[1]})));
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
            gfx.drawPolygon(poly.map(({x, y}) => ({x: dirSign * x + entPos.x, y: y + entPos.y})));
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

  private playStart = now();

  checkDeath() {
    if (this.isDead() && (!this.keepPlayingFor || now() - this.playStart < this.keepPlayingFor + 5000)) {
      this.player = this.onRejoin();
    }
  }
}

export class BotMgr {
  bots: Bot[] = [];
  chance = new Chance(0);

  constructor(public styleGen,
              public entMgr: EntMgr,
              public gameState: GameState,
              public socket,
              public pool,
              private nameGen) {
  }

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
    const period = this.chance.integer({min: 3, max: 30}) * 60 * 1000;
    const self = this;
    function* genNames() {
      let name: string, lastSwitch: number;
      while (true) {
        if (!name || now() - lastSwitch > period) {
          name = self.nameGen ? self.nameGen.next().value : 'bot';
          lastSwitch = now();
        }
        yield name;
      }
    }
    const names = genNames();
    const player = this.joinGame(names.next().value);
    const bot = new Bot(
      player, this.gameState, this.socket, this.pool, isDumb, null,
      () => this.joinGame(names.next().value)
    );
    bot.target = new Vec2(0, 0);
    this.bots.push(bot);
    return bot;
  }

  private joinGame = (name: string) => {
    getLogger('bot').log('bot', name, 'joining');
    const entMgr = this.entMgr, gameState = this.gameState;
    const player = entMgr.addPlayer(_.assign({}, new Player(
      name,
      getRandomIntRange(0, gameWorld.width),
      50,
      this.styleGen.next().value
    )));
    player.dir = Dir.Left;
    return player;
  };
}