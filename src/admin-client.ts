import * as dat from 'dat.gui/build/dat.gui';
import * as Client from './client';
import {
  ControlPanel,
  cp,
  delta,
  entMgr,
  entToLabel,
  entToSprite,
  feedInputs,
  game,
  gameState,
  getEnts,
  gfx,
  gPool,
  isDebug,
  mkScoreText,
  onNextBcastPersistentCallbacks,
  players,
  refollow,
  rescale,
  scoreText,
  socket,
  styleGen,
  svrSettings,
  updateSpriteFromEnt,
  vecStr
} from './client';
import {BotMgr} from "./common-admin";
import * as Common from "./common";
import {
  baseHandler,
  clearArray,
  defaultColor,
  deserSimResults,
  fixtureDims,
  iterBodies,
  iterFixtures,
  Player,
  ratio,
  runLocally,
  totalSquishTime,
  updateEntPhysFromPl,
  updatePeriod,
  Vec2,
  world
} from "./common";
import * as _ from "lodash";

export let botMgr;

export function main(pool) {
  console.log('This is the admin client!');

  Client.setCp(new ControlPanelWithBots());

  botMgr = new BotMgr(styleGen, entMgr, gameState, socket, gPool, null);

  Client.main(
    pool,
    new GuiMgr(),
    (socket) => {
      socket.on('botProxy', (botData) => {
        onNextBcastPersistentCallbacks.push(() => botMgr.maybeAddProxy(botData));
      });

      socket.on('botPlan', ({botData, bestWorldStateIndex, bestPath, worldStatesData}) => {
        onNextBcastPersistentCallbacks.push(() => {
          const bot = botMgr.bots.find(b => b.player.id == botData.playerId);
          if (bot) {
            const {worldStates, bestPath: realBestPath, bestWorldState} = deserSimResults({
              bestWorldStateIndex,
              bestPath,
              worldStatesData
            });
            bot.deser(botData);
            bot.lastWorldStates = worldStates;
            bot.lastBestSeq = realBestPath.map(([ws, dir]) => ws).concat([bestWorldState]);
            return true;
          } else {
            return false;
          }
        });
      });
    },
    extraSteps,
    mkDebugText
  );

}

export class GuiMgr {
  gui = isDebug ? new dat.GUI() : null;
  cliControllers = [];
  cliOpts;
  svrOpts;

  constructor() {
    if (!isDebug) return;
    this.cliOpts = this.gui.addFolder('Client');
    this.svrOpts = this.gui.addFolder('Server');
    this.cliOpts.open();
    this.svrOpts.open();
    const svrOpts = this.svrOpts;
    const svrControllers = [
      svrOpts.add(svrSettings, 'dt'),
      svrOpts.add(svrSettings, 'burstLimit'),
      svrOpts.add(svrSettings, 'doSmashes'),
      svrOpts.add(svrSettings, 'doSpeedups'),
      svrOpts.add(svrSettings, 'speedup'),
      svrOpts.add(svrSettings, 'holdForSpeedups'),
      svrOpts.add(svrSettings, 'speedupDur'),
      svrOpts.add(svrSettings, 'doProtobuf'),
      svrOpts.add(svrSettings, 'doDiff'),
      svrOpts.add(svrSettings, 'accel'),
      svrOpts.add(svrSettings, 'doOsc'),
      svrOpts.add(svrSettings, 'oscDist'),
      svrOpts.add(svrSettings, 'smashSpeed'),
      svrOpts.add(svrSettings, 'smashDelay'),
      svrOpts.add(svrSettings, 'maxFallSpeed'),
      svrOpts.add(svrSettings, 'oneWayLedges')
    ];
    const uploadSettings = () => socket.emit('svrSettings', svrSettings.ser());
    for (let c of svrControllers) {
      c.onFinishChange(uploadSettings);
    }
  }

  private clear() {
    this.cliControllers.forEach(c => this.cliOpts.remove(c));
    clearArray(this.cliControllers);
    // if (this.gui) this.gui.destroy();
    // this.gui = new dat.GUI();
  }

  refresh() {
    if (!isDebug) return;
    this.clear();
    const targetPlayerIndex = players.findIndex(p => entToSprite.get(p) == game.camera.target);
    cp.currentPlayer = targetPlayerIndex >= 0 ? targetPlayerIndex : null;
    refollow();

    const cliOpts = this.cliOpts;
    this.cliControllers = [
      cliOpts.add(cp, 'currentPlayer', players.map((p, i) => i)).onFinishChange(() => refollow()),
      cliOpts.add(cp, 'runLocally').onFinishChange(() => Common.setRunLocally(cp.runLocally)),
      cliOpts.add(cp, 'makeBot'),
      cliOpts.add(cp, 'viewAll').onFinishChange(rescale),
      cliOpts.add(cp, 'instantTurn'),
      cliOpts.add(cp, 'drawPlanckBoxes'),
      cliOpts.add(cp, 'doShake'),
      cliOpts.add(cp, 'alwaysStep'),
      cliOpts.add(cp, 'testNotif'),
      cliOpts.add(cp, 'boundCameraWithinWalls'),
      cliOpts.add(cp, 'useKeyboard'),
      cliOpts.add(cp, 'camWidth').onFinishChange(rescale),
      cliOpts.add(cp, 'camHeight').onFinishChange(rescale),
      cliOpts.add(cp, 'spectate'),
      cliOpts.add(cp, 'backToSplash'),
      cliOpts.add(cp, 'doPings'),
      cliOpts.add(cp, 'smashFrames'),
      cliOpts.add(cp, 'doUpdatePl'),
      cliOpts.add(cp, 'boundCameraAboveGround'),
      cliOpts.add(cp, 'showScores').onFinishChange(() => scoreText.text = ''),
      cliOpts.add(cp, 'showIds').onFinishChange(() =>
        cp.showIds ? 0 : Array.from(entToLabel.values()).map(t => t.destroy())),
      cliOpts.add(cp, 'doBuffer').onFinishChange(() => baseHandler.doBuffer = cp.doBuffer),
      cliOpts.add(cp, 'showDebug').onFinishChange(() => cp.showDebug ? 0 : game.debug.reset())
    ];
  }

}

class ControlPanelWithBots extends ControlPanel {
  makeBot() {
    runLocally ? botMgr.makeBot() : socket.emit('makeBot');
  }
}

export let lastTime = 0;
let getBot = function (currentPlayer) {
  return botMgr.bots.find(b => b.player == currentPlayer);
};
let extraSteps = function (currentPlayer: Player, updating: boolean, currTime: number) {
  const bot = getBot(currentPlayer);
  if (runLocally) {
    updating = cp.alwaysStep || currTime - lastTime >= updatePeriod * 1000;
  }

  gfx.clear();
  gfx.lineStyle(1, 0x555555, 1);
  if (cp.drawPlanckBoxes) {
    for (let body of Array.from(iterBodies(world))) {
      const [fix] = Array.from(iterFixtures(body)), dims = fixtureDims(fix);
      gfx.drawRect(
        ratio * (body.getPosition().x - dims.width / 2),
        ratio * -(body.getPosition().y + dims.height / 2),
        dims.width * ratio, dims.height * ratio
      );
    }
  }
  gfx.lineStyle(1, defaultColor, 1);
  if (game.input.activePointer.isDown) {
    if (bot) {
      bot.target = new Vec2(game.input.worldX, game.input.worldY);
    }
  }
  if (runLocally) {
    for (let bot of botMgr.bots) {
      bot.isDumb ? bot.dumbPlan() : bot.replayPlan(updating, currTime);
    }
  }
  for (let bot of botMgr.bots) {
    bot.drawPlan(gfx);
  }

  if (runLocally && updating) {
    const origEnts = getEnts();
    const totalStepTime = Common.update(gameState);
    for (let player of gameState.players) {
      if (player.currentSquishTime != null) {
        player.currentSquishTime += totalStepTime;
        if (player.currentSquishTime > totalSquishTime) {
          player.currentSquishTime = null;
        }
      }
    }
    for (let bot of botMgr.bots) {
      bot.checkPlan(currTime);
    }
    for (let player of players) {
      feedInputs(player);
    }
    // update sprites. iterate over all origEnts, including ones that may have been destroyed & removed, since we can then update their Entity positions to their final physics body positions.
    for (let ent of origEnts) {
      updateEntPhysFromPl(ent);
      updateSpriteFromEnt(ent);
    }
    lastTime = currTime;
  }

  if (cp.showIds) {
    const style = {font: "12px Arial", fill: "#ff0044", wordWrap: true, align: "center"};
    for (let ent of getEnts()) {
      let label = entToLabel.get(ent);
      if (!label) {
        entToLabel.set(ent, label = game.add.text(ent.x, ent.y, "" + ent.id, style));
      }
      [label.x, label.y] = [ent.x, ent.y];
    }
  }
};
let mkDebugText = function (ptr: Vec2, currentPlayer: Player) {
  const bot = getBot(currentPlayer);
  return `
Bot:
Target: ${bot && bot.target ? vecStr(bot.target) : ''}
Step: ${bot ?
    `${bot.chunkSteps} total ${bot.lastBestSeq ?
      JSON.stringify((([chunk, index, steps]) =>
        _(chunk)
          .pick('startTime', 'endTime', 'dur')
          .extend({index, steps})
          .value())(bot.getCurrChunk(-1))) : ''
      }` : ''}
    `.trim();
};