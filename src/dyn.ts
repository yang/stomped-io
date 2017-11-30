import {GameState, LoadedCode, makeBurst, Player, playerStyles} from './common';

export function stomp(playerA: Player, playerB: Player, gameState: GameState) {
  const requestedDamage = Math.max(playerA.size, playerB.size / 10);
  const cappedDamage = Math.min(requestedDamage, playerB.size);
  const effectSize = cappedDamage / 2 * 10;
  const burstSize = cappedDamage / 2 * 10;
  playerB.grow(-cappedDamage);
  playerA.grow(cappedDamage / 2);
  gameState.onStomp.dispatch(playerA, playerB, Math.round(effectSize));
  makeBurst(playerB.x, playerB.y, burstSize, gameState);
  playerB.state = 'normal';
  if (playerB.size < 1) {
    gameState.destroy(playerB, playerA);
    playerB.dead = true;
  }
}

export function selectChar(playerData) {
  return playerStyles.includes(playerData.char) ? playerData.char : 'plain-0';
};


// Only uncomment this briefly to verify no compilation errors, but *do not leave it in* or else it will fail to
// compile in the live runnin gserver (since the running LoadedCode may not recognize a newly added function
// signature).
// const loadedCodeVerification: LoadedCode = {stomp, selectChar};
